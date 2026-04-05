import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logTool } from "../_shared/http.js";
import { fetchGoldPrices } from "./gold-market.js";
import { fetchGoldNews } from "./gold-news.js";
import { getGoldTechnical } from "./gold-technical.js";

export function registerGoldTools(server: McpServer): void {
  server.registerTool(
    "gold_get_prices",
    {
      title: "Gold Prices (Vietnam + World)",
      description:
        "Get current gold prices: Vietnam domestic prices (SJC, PNJ, DOJI, Mi Hồng, Ngọc Thẩm in HCM) " +
        "with buy/sell in VND, plus world gold price in USD/ounce with change amount and percentage. " +
        "Source: webgia.com. Call only ONCE per conversation — data does not change between calls.",
      inputSchema: {},
    },
    async () => {
      try {
        const prices = await fetchGoldPrices();
        logTool("gold_get_prices", {}, prices);
        return { content: [{ type: "text", text: JSON.stringify(prices, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] gold_get_prices: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "gold_get_news",
    {
      title: "Gold Market News (Vietnamese)",
      description:
        "Get latest Vietnamese gold market news from CafeF: price updates, market analysis, " +
        "central bank policies, SJC/jewelry brand news. Returns title, URL, date, summary. " +
        "To read full article content, use cafef_get_article_content with the article URL.",
      inputSchema: {
        limit: z.number().min(1).max(20).optional()
          .describe("Max number of articles to return (1-20, default 10)"),
      },
    },
    async ({ limit }) => {
      try {
        const news = await fetchGoldNews(limit ?? 10);
        logTool("gold_get_news", { limit }, news);
        return { content: [{ type: "text", text: JSON.stringify(news, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] gold_get_news: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "gold_get_technical",
    {
      title: "World Gold Technical Analysis",
      description:
        "Get comprehensive technical analysis for world gold (XAU/USD) from Yahoo Finance Gold Futures (GC=F): " +
        "RSI-14, SMA-50, SMA-200, EMA-12, EMA-26, MACD (line/signal/histogram), " +
        "ATH/ATL with dates from 10-year daily OHLC data, multi-timeframe price changes (1d/7d/30d/1y). " +
        "World gold ONLY — VN domestic gold prices are in gold_get_prices.",
      inputSchema: {},
    },
    async () => {
      try {
        const technical = await getGoldTechnical();
        logTool("gold_get_technical", {}, technical);
        return { content: [{ type: "text", text: JSON.stringify(technical, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] gold_get_technical: ${msg}` }], isError: true };
      }
    }
  );
}
