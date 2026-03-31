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

const MAX_HISTORY_CHAT = 20;
const MAX_HISTORY_REASONER = 80;
const MAX_STEPS = 10;
const TOOL_MAX_RETRIES = 3;
const TOOL_RETRY_DELAY_MS = 1000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const GENERATE_MAX_RETRIES = 2;
const GENERATE_RETRY_BASE_DELAY_MS = 2000;

/** Returns true for transient network errors that are safe to retry. */
function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const transientCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "UND_ERR_SOCKET"];
  const transientMessages = ["econnreset", "etimedout", "und_err_socket", "terminated", "socket hang up"];

  // Walk the full cause chain (e.g. APICallError → TypeError → Error)
  let current: unknown = error;
  while (current instanceof Error) {
    const code = (current as any).code ?? (current as any).cause?.code;
    if (code && transientCodes.includes(code)) return true;
    const msg = current.message.toLowerCase();
    if (transientMessages.some(t => msg.includes(t))) return true;
    current = (current as any).cause;
  }
  return false;
}

/**
 * Trims history to at most maxLen messages.
 * Always ensures the first kept message is never role="tool",
 * which would cause a 400 error (orphan tool message after a cut).
 */
function trimHistory(history: ModelMessage[], maxLen: number): ModelMessage[] {
  if (history.length <= maxLen) return history;
  const sliced = history.slice(history.length - maxLen);
  let start = 0;
  while (start < sliced.length && sliced[start].role === "tool") {
    start++;
  }
  return start > 0 ? sliced.slice(start) : sliced;
}

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
    const systemPrompt = mode === "reasoner"
      ? REASONER_SYSTEM_PROMPT
      : CHAT_SYSTEM_PROMPT;

    console.log(`[LLM] chatId=${chatId} | mode=${mode} | model=${activeModelName}`);

    const history = this.conversations.get(chatId) ?? [];
    history.push({ role: "user", content: userMessage });

    const tools = this.buildTools(notifyUser);

    let result!: Awaited<ReturnType<typeof generateText>>;
    const maxAttempts = GENERATE_MAX_RETRIES + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        result = await generateText({
          model: activeModel,
          system: systemPrompt,
          messages: history,
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
        });
        break;
      } catch (err) {
        if (attempt < maxAttempts && isTransientError(err)) {
          const retryDelay = GENERATE_RETRY_BASE_DELAY_MS * attempt;
          console.warn(`[LLM] Transient network error on attempt ${attempt}/${maxAttempts}, retrying in ${retryDelay}ms`, err);
          await notifyUser(`⚠️ Connection issue, retrying... (${attempt}/${maxAttempts - 1})`);
          await delay(retryDelay);
        } else {
          throw err;
        }
      }
    }

    const finalText =
      result.text || "I was unable to generate a response. Please try again.";

    // Append all response messages (assistant + tool calls/results) to history
    history.push(...(result.response.messages as ModelMessage[]));

    // Trim history to prevent token bloat, never leaving orphan tool messages
    const maxHistory = mode === "reasoner" ? MAX_HISTORY_REASONER : MAX_HISTORY_CHAT;
    this.conversations.set(chatId, trimHistory(history, maxHistory));

    console.log(`[history] chatId=${chatId} | messages=${history.length}}`);

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
