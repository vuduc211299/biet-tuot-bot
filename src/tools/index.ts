import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCryptoTools } from "./crypto/index.js";
import { registerVnStockTools } from "./vn-stock/index.js";
import { registerNewsTools } from "./news/index.js";

export function registerAllTools(server: McpServer): void {
  registerCryptoTools(server);
  registerVnStockTools(server);
  registerNewsTools(server);
}
