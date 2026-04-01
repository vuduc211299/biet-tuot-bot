import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "vnexpress-finance",
    version: "1.0.0",
  });

  registerAllTools(server);

  return server;
}

// Standalone export for index.ts (dev/inspect mode)
export const server = createServer();
