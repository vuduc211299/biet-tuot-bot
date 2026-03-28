import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerTradingPlanPrompt(server: McpServer): void {
  server.registerPrompt(
    "trading_plan",
    {
      title: "Trading Plan",
      description: "Creates a data-driven trading plan for crypto or Vietnam stocks.",
      argsSchema: {
        market: z.enum(["crypto", "stock"]).describe("Which market to plan for"),
        timeframe: z
          .enum(["day", "week", "month"])
          .optional()
          .describe("Trading timeframe. Default: week"),
      },
    },
    ({ market, timeframe }) => {
      const tf = timeframe ?? "week";
      const dataSteps =
        market === "crypto"
          ? `1. Call crypto_get_overview
2. Call crypto_get_prices for "bitcoin,ethereum,solana,ripple"
3. Call vnexpress_search_news with "crypto" or "tiền số" for news catalysts`
          : `1. Call stock_vn_overview
2. Call stock_get_history for 2-3 top symbols (e.g. VNM, FPT, VIC) with days=30
3. Call vnexpress_search_news with "chứng khoán" for market news`;

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Create a ${tf} trading plan for the ${market} market.

DATA COLLECTION:
${dataSteps}

TRADING PLAN FORMAT:

## Market Context
- Current trend, key levels, sentiment

## Watchlist (3-5 specific assets)
| Asset | Entry Zone | Stop-Loss | Target 1 | Target 2 | Rationale |

## Key Catalysts (next ${tf})
- News events that could move prices significantly

## Risk Management
- Position sizing recommendation
- Maximum drawdown tolerance
- Correlation risks

## Action Items
Priority-ordered list of what to monitor / execute

---
⚠️ DISCLAIMER: This is analysis for educational purposes only. NOT financial advice.
Always do your own research and consider your personal risk tolerance.

Respond in the same language the user is using.`,
            },
          },
        ],
      };
    }
  );
}
