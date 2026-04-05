import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCryptoTools } from "./crypto/index.js";
import { registerVnStockTools } from "./vn-stock/index.js";
import { registerNewsTools } from "./news/index.js";
import { registerGoldTools } from "./gold/index.js";
import { fetchTopCoins, fetchGlobalData, fetchTrending } from "./crypto/crypto-market.js";
import { fetchTopVolume, fetchForeignRanking } from "./vn-stock/stock-market.js";

export function registerAllTools(server: McpServer): void {
  registerCryptoTools(server);
  registerVnStockTools(server);
  registerNewsTools(server);
  registerGoldTools(server);
}

export async function warmupCaches(): Promise<void> {
  console.log("[warmup] Warming up caches...");
  await Promise.all([
    fetchTopCoins(10).catch(() => { }),
    fetchGlobalData().catch(() => { }),
    fetchTrending().catch(() => { }),
    fetchTopVolume(10).catch(() => { }),
    fetchForeignRanking(10).catch(() => { }),
  ]);
  console.log("[warmup] Cache warmed up");
}
