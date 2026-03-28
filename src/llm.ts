import {
  generateText,
  tool,
  jsonSchema,
  stepCountIs,
  type ModelMessage,
  type Tool,
  type LanguageModel,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { McpClientWrapper, type McpToolDefinition } from "./mcp-client.js";
import { SYSTEM_PROMPT } from "./prompts/index.js";

const MAX_HISTORY = 20;
const MAX_STEPS = 10;
const TOOL_MAX_RETRIES = 3;
const TOOL_RETRY_DELAY_MS = 1000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface LlmConfig {
  provider: "openai" | "anthropic" | "google";
  model: string;
  apiKey: string;
  baseUrl?: string;
}

function createModel(config: LlmConfig): LanguageModel {
  switch (config.provider) {
    case "anthropic": {
      const provider = createAnthropic({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return provider(config.model);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return provider(config.model);
    }
    case "openai":
    default: {
      // Also works with any OpenAI-compatible API (Ollama, Groq, Together, etc.)
      const provider = createOpenAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return provider(config.model);
    }
  }
}

export class LlmAssistant {
  private model: LanguageModel;
  private mcpClient: McpClientWrapper;
  private mcpToolDefs: McpToolDefinition[] = [];
  private conversations = new Map<string, ModelMessage[]>();

  constructor(config: LlmConfig, mcpClient: McpClientWrapper) {
    this.model = createModel(config);
    this.mcpClient = mcpClient;
  }

  async initialize(): Promise<void> {
    await this.mcpClient.connect();
    this.mcpToolDefs = await this.mcpClient.getToolDefinitions();
    console.log(`Loaded ${this.mcpToolDefs.length} MCP tools`);
  }

  private buildTools(
    notifyUser: (msg: string) => Promise<void>
  ): Record<string, Tool> {
    const tools: Record<string, Tool> = {};

    for (const def of this.mcpToolDefs) {
      const toolName = def.name;
      tools[toolName] = tool<Record<string, unknown>, unknown>({
        description: def.description,
        inputSchema: jsonSchema<Record<string, unknown>>(
          def.inputSchema as Parameters<typeof jsonSchema>[0]
        ),
        execute: async (args) => {
          console.log(`[Tool] ${toolName}(${JSON.stringify(args)})`);

          for (let attempt = 1; attempt <= TOOL_MAX_RETRIES; attempt++) {
            const result = await this.mcpClient.callTool(
              toolName,
              args as Record<string, unknown>
            );

            if (result.success) {
              if (attempt > 1) {
                await notifyUser(
                  `✅ Tool \`${toolName}\` succeeded on attempt ${attempt}.`
                );
              }
              return result.data;
            }

            if (attempt < TOOL_MAX_RETRIES) {
              await notifyUser(
                `⚠️ Tool \`${toolName}\` failed (attempt ${attempt}/${TOOL_MAX_RETRIES}).\n` +
                `Reason: ${result.errorReason ?? "Unknown error"}.\n` +
                `Retrying in ${TOOL_RETRY_DELAY_MS / 1000}s...`
              );
              await delay(TOOL_RETRY_DELAY_MS);
            } else {
              await notifyUser(
                `❌ Tool \`${toolName}\` failed after ${TOOL_MAX_RETRIES} attempts.\n` +
                `Reason: ${result.errorReason ?? "Unknown error"}.`
              );
            }
          }

          return `[TOOL_ERROR] ${toolName} failed after ${TOOL_MAX_RETRIES} retries`;
        },
      });
    }

    return tools;
  }

  async chat(
    chatId: string,
    userMessage: string,
    notifyUser: (msg: string) => Promise<void> = async () => { }
  ): Promise<string> {
    const history = this.conversations.get(chatId) ?? [];
    history.push({ role: "user", content: userMessage });

    const tools = this.buildTools(notifyUser);

    const result = await generateText({
      model: this.model,
      system: SYSTEM_PROMPT,
      messages: history,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    const finalText =
      result.text || "I was unable to generate a response. Please try again.";

    // Append all response messages (assistant + tool calls/results) to history
    history.push(...(result.response.messages as ModelMessage[]));

    // Trim history to prevent token bloat
    const trimmed =
      history.length > MAX_HISTORY
        ? history.slice(history.length - MAX_HISTORY)
        : history;
    this.conversations.set(chatId, trimmed);

    return finalText;
  }

  clearHistory(chatId: string): void {
    this.conversations.delete(chatId);
  }

  getHistoryLength(chatId: string): number {
    return this.conversations.get(chatId)?.length ?? 0;
  }
}
