import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages.js";
import { McpClientWrapper, type ToolCallResult } from "./mcp-client.js";
import { SYSTEM_PROMPT } from "./prompts/index.js";

const MAX_HISTORY = 20; // messages per conversation (not counting system)
const MODEL = "claude-sonnet-4-6";
const TOOL_MAX_RETRIES = 3;
const TOOL_RETRY_DELAY_MS = 1000;

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export class ClaudeAssistant {
  private anthropic: Anthropic;
  private mcpClient: McpClientWrapper;
  private tools: Anthropic.Tool[] = [];
  private conversations = new Map<string, MessageParam[]>();

  constructor(apiKey: string, mcpClient: McpClientWrapper) {
    this.anthropic = new Anthropic({ apiKey });
    this.mcpClient = mcpClient;
  }

  async initialize(): Promise<void> {
    await this.mcpClient.connect();
    this.tools = await this.mcpClient.getToolDefinitions();
    console.log(`Loaded ${this.tools.length} MCP tools for Claude`);
  }

  async chat(
    chatId: string,
    userMessage: string,
    notifyUser: (msg: string) => Promise<void> = async () => { }
  ): Promise<string> {
    const history = this.conversations.get(chatId) ?? [];

    // Append user message
    history.push({ role: "user", content: userMessage });

    let response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: history,
      tools: this.tools,
    });

    // Tool-use loop
    while (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      // Append assistant turn (with tool_use blocks)
      history.push({ role: "assistant", content: response.content });

      // Execute all tool calls sequentially (retrying each independently)
      const toolResults: ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        console.log(`[Tool] ${block.name}(${JSON.stringify(block.input)})`);
        const result = await this.callToolWithRetry(
          block.name,
          block.input as Record<string, unknown>,
          notifyUser
        );
        toolResults.push({
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: result.data,
          ...(result.success ? {} : { is_error: true }),
        });
      }

      // Append tool results as user turn
      history.push({ role: "user", content: toolResults });

      // Continue conversation
      response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: history,
        tools: this.tools,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const finalText = textBlocks.map(b => b.text).join("\n").trim();

    // Append assistant final response
    history.push({ role: "assistant", content: response.content });

    // Trim history to prevent token bloat (keep last MAX_HISTORY messages)
    const trimmed = history.length > MAX_HISTORY
      ? history.slice(history.length - MAX_HISTORY)
      : history;

    this.conversations.set(chatId, trimmed);

    return finalText || "I was unable to generate a response. Please try again.";
  }

  private async callToolWithRetry(
    toolName: string,
    toolInput: Record<string, unknown>,
    notifyUser: (msg: string) => Promise<void>
  ): Promise<ToolCallResult> {
    let lastResult: ToolCallResult = {
      success: false,
      toolName,
      data: `Tool failed after ${TOOL_MAX_RETRIES} retries.`,
      errorReason: "Max retries exceeded",
    };

    for (let attempt = 1; attempt <= TOOL_MAX_RETRIES; attempt++) {
      lastResult = await this.mcpClient.callTool(toolName, toolInput);

      if (lastResult.success) {
        if (attempt > 1) {
          await notifyUser(`✅ Tool \`${toolName}\` succeeded on attempt ${attempt}.`);
        }
        return lastResult;
      }

      const isLastAttempt = attempt === TOOL_MAX_RETRIES;
      if (!isLastAttempt) {
        await notifyUser(
          `⚠️ Tool \`${toolName}\` failed (attempt ${attempt}/${TOOL_MAX_RETRIES}).\n` +
          `Reason: ${lastResult.errorReason ?? "Unknown error"}.\n` +
          `Retrying in ${TOOL_RETRY_DELAY_MS / 1000}s...`
        );
        await delay(TOOL_RETRY_DELAY_MS);
      } else {
        await notifyUser(
          `❌ Tool \`${toolName}\` failed after ${TOOL_MAX_RETRIES} attempts.\n` +
          `Reason: ${lastResult.errorReason ?? "Unknown error"}.\n` +
          `Please try again later.`
        );
      }
    }

    return lastResult;
  }

  clearHistory(chatId: string): void {
    this.conversations.delete(chatId);
  }

  getHistoryLength(chatId: string): number {
    return this.conversations.get(chatId)?.length ?? 0;
  }
}
