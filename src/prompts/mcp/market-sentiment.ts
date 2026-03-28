import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerMarketSentimentPrompt(server: McpServer): void {
  server.registerPrompt(
    "market_sentiment",
    {
      title: "Market Sentiment Analysis",
      description: "Analyzes overall market sentiment across crypto and/or Vietnam stocks.",
      argsSchema: {
        market: z
          .enum(["crypto", "stock", "all"])
          .optional()
          .describe("Which market to analyze. Default: all"),
      },
    },
    ({ market }) => {
      const scope = market ?? "all";
      const dataSteps =
        scope === "crypto"
          ? "1. Call crypto_get_overview for global data and top coins\n2. Call vnexpress_search_news with 'crypto bitcoin' or 'tiền mã hóa'"
          : scope === "stock"
            ? "1. Call stock_vn_overview for VNINDEX, top volume, foreign flow\n2. Call vnexpress_search_news with 'chứng khoán' or 'VN-Index'"
            : "1. Call crypto_get_overview AND stock_vn_overview in parallel\n2. Call vnexpress_get_latest_news with category 'kinh-doanh'";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Perform a market sentiment analysis for: ${scope === "all" ? "crypto + Vietnam stocks" : scope}

DATA COLLECTION:
${dataSteps}

ANALYSIS:
- Overall sentiment: Bullish / Bearish / Neutral + confidence %
- Key momentum indicators (volume, price change, trends)
- Fear & Greed signals (extreme moves, news tone)
- Vietnam market vs global comparison
- Top opportunities and risks right now
- What the data suggests for the next 24-48 hours

End with a clear verdict: "📈 Bullish", "📉 Bearish", or "➡️ Neutral" with reasoning.

Respond in the same language the user is using.`,
            },
          },
        ],
      };
    }
  );
}
