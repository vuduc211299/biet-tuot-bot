import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@anthropic-ai/sdk/resources/messages.js";

export interface ToolCallResult {
  success: boolean;
  data: string;
  toolName: string;
  errorReason?: string;
}

export class McpClientWrapper {
  private client: Client;
  private serverUrl: string;
  private connected = false;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
    this.client = new Client({ name: "vnexpress-bot-client", version: "1.0.0" });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl));
    await this.client.connect(transport);
    this.connected = true;
    console.log(`MCP Client connected to ${this.serverUrl}`);
  }

  async getToolDefinitions(): Promise<Tool[]> {
    const { tools } = await this.client.listTools();

    return tools.map(t => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: (t.inputSchema as Tool["input_schema"]) ?? {
        type: "object",
        properties: {},
      },
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    try {
      const result = await this.client.callTool({ name, arguments: args });

      const text = Array.isArray(result.content)
        ? result.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map(c => c.text)
          .join("\n")
        : JSON.stringify(result.content ?? result);

      if (result.isError) {
        // Parse the [TOOL_ERROR] prefix emitted by the server
        const errorReason = text.replace(/^\[TOOL_ERROR\]\s*[^:]*:\s*/, "");
        return { success: false, data: text, toolName: name, errorReason };
      }

      return { success: true, data: text, toolName: name };
    } catch (networkError: unknown) {
      const msg = networkError instanceof Error ? networkError.message : String(networkError);
      return {
        success: false,
        data: msg,
        toolName: name,
        errorReason: `Network error: ${msg}`,
      };
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }
}
