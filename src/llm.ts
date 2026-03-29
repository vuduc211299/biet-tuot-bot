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
import { CHAT_SYSTEM_PROMPT, REASONER_SYSTEM_PROMPT } from "./prompts/index.js";

const MAX_HISTORY = 20;
const MAX_STEPS = 10;
const TOOL_MAX_RETRIES = 3;
const TOOL_RETRY_DELAY_MS = 1000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type LlmMode = "chat" | "reasoner";

export interface LlmConfig {
  provider: "openai" | "anthropic" | "google";
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface LlmReasonerConfig {
  model: string;
  /** Defaults to "openai" (OpenAI-compatible, works with DeepSeek etc.) */
  provider?: LlmConfig["provider"];
  /** Falls back to main LlmConfig.apiKey if omitted */
  apiKey?: string;
  /** Falls back to main LlmConfig.baseUrl if omitted */
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
      // Also works with any OpenAI-compatible API (Ollama, Groq, Together, DeepSeek, etc.)
      // Use .chat() to force Chat Completions API (/chat/completions) instead of
      // the Responses API (/responses) which is the new default in @ai-sdk/openai@3.x
      // but not supported by OpenAI-compatible providers (DeepSeek, Groq, Ollama, etc.)
      const provider = createOpenAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return provider.chat(config.model);
    }
  }
}

export class LlmAssistant {
  private chatModel: LanguageModel;
  private chatModelName: string;
  private reasonerModel: LanguageModel | null = null;
  private reasonerModelName: string | null = null;
  private mcpClient: McpClientWrapper;
  private mcpToolDefs: McpToolDefinition[] = [];
  private conversations = new Map<string, ModelMessage[]>();

  constructor(config: LlmConfig, mcpClient: McpClientWrapper, reasonerConfig?: LlmReasonerConfig) {
    this.chatModel = createModel(config);
    this.chatModelName = config.model;
    this.mcpClient = mcpClient;

    if (reasonerConfig) {
      this.reasonerModel = createModel({
        provider: reasonerConfig.provider ?? "openai",
        model: reasonerConfig.model,
        apiKey: reasonerConfig.apiKey ?? config.apiKey,
        baseUrl: reasonerConfig.baseUrl ?? config.baseUrl,
      });
      this.reasonerModelName = reasonerConfig.model;
    }
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
    notifyUser: (msg: string) => Promise<void> = async () => { },
    mode: LlmMode = "chat"
  ): Promise<string> {
    // Resolve active model — fall back to chat model if reasoner not configured
    const activeModel = mode === "reasoner" && this.reasonerModel
      ? this.reasonerModel
      : this.chatModel;
    const activeModelName = mode === "reasoner" && this.reasonerModel
      ? this.reasonerModelName!
      : this.chatModelName;
    const effectiveMode: LlmMode = mode === "reasoner" && this.reasonerModel
      ? "reasoner"
      : "chat";
    const systemPrompt = effectiveMode === "reasoner"
      ? REASONER_SYSTEM_PROMPT
      : CHAT_SYSTEM_PROMPT;

    console.log(`[LLM] chatId=${chatId} | mode=${effectiveMode} | model=${activeModelName}`);

    const history = this.conversations.get(chatId) ?? [];
    history.push({ role: "user", content: userMessage });

    const tools = this.buildTools(notifyUser);

    const result = await generateText({
      model: activeModel,
      system: systemPrompt,
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

  getModelInfo(): { chat: string; reasoner: string | null } {
    return { chat: this.chatModelName, reasoner: this.reasonerModelName };
  }
}
