import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  registerAnalyzeNewsPrompt,
  registerMarketSentimentPrompt,
  registerRiskAssessmentPrompt,
  registerTradingPlanPrompt,
} from "./prompts/index.js";
import {
  fetchCategoryFeed,
  fetchArticleContent,
  searchArticles,
} from "./vnexpress.js";
import { getCryptoOverview, fetchCryptoPrices } from "./crypto.js";
import {
  getVNStockOverview,
  fetchStockPrice,
  fetchStockHistory,
} from "./stock.js";

const CATEGORIES = [
  "tin-moi-nhat", "the-gioi", "thoi-su", "kinh-doanh",
  "bat-dong-san", "khoa-hoc", "so-hoa", "phap-luat",
] as const;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "vnexpress-finance",
    version: "1.0.0",
  });

  // ============================================================
  // NEWS TOOLS
  // ============================================================

  server.registerTool(
    "vnexpress_get_latest_news",
    {
      title: "Get Latest VnExpress News",
      description:
        "Fetch latest news articles from VnExpress.net by category. Returns titles, summaries, URLs, and timestamps. " +
        "Categories: tin-moi-nhat (all latest), the-gioi (world/geopolitics), thoi-su (domestic politics), " +
        "kinh-doanh (business/finance), bat-dong-san (real estate), khoa-hoc (science), so-hoa (tech), phap-luat (law).",
      inputSchema: {
        category: z.enum(CATEGORIES).optional()
          .describe("News category. Default: tin-moi-nhat"),
        limit: z.number().min(1).max(50).optional()
          .describe("Max number of articles. Default: 10"),
      },
    },
    async ({ category, limit }) => {
      try {
        const articles = await fetchCategoryFeed(category ?? "tin-moi-nhat");
        const result = articles.slice(0, limit ?? 10).map(a => ({
          id: a.id,
          title: a.title,
          summary: a.summary,
          url: a.url,
          publishedAt: a.publishedAt,
          category: a.category,
          categoryLabel: a.categoryLabel,
        }));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] vnexpress_get_latest_news: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "vnexpress_search_news",
    {
      title: "Search VnExpress News",
      description:
        "Search VnExpress articles by keyword across titles and summaries. Useful for finding articles about " +
        "specific topics like 'vàng' (gold), 'FED', 'lãi suất' (interest rates), 'chiến tranh' (war), etc.",
      inputSchema: {
        keyword: z.string().describe("Search keyword(s) in Vietnamese or English"),
        category: z.enum(CATEGORIES).optional()
          .describe("Optional: limit search to a specific category"),
      },
    },
    async ({ keyword, category }) => {
      try {
        const articles = await searchArticles(keyword, category);
        if (articles.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No articles found for keyword: "${keyword}". Try different keywords or browse by category.`,
            }],
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(articles, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] vnexpress_search_news: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "vnexpress_get_article_content",
    {
      title: "Get Article Full Content",
      description:
        "Fetch the full text content of a specific VnExpress article. Provide either article_id (numeric ID) " +
        "or the full URL. Use after getting article list to read details before analysis.",
      inputSchema: {
        article_id: z.string().optional()
          .describe("Article ID number, e.g. '5055753'. Get from vnexpress_get_latest_news."),
        url: z.string().optional()
          .describe("Full VnExpress article URL, e.g. https://vnexpress.net/..."),
      },
    },
    async ({ article_id, url }) => {
      if (!article_id && !url) {
        return {
          content: [{ type: "text", text: "[TOOL_ERROR] vnexpress_get_article_content: Provide either article_id or url." }],
          isError: true,
        };
      }
      try {
        const detail = await fetchArticleContent(url ?? article_id!);
        return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] vnexpress_get_article_content: ${msg}` }], isError: true };
      }
    }
  );

  // ============================================================
  // CRYPTO TOOLS
  // ============================================================

  server.registerTool(
    "crypto_get_overview",
    {
      title: "Crypto Market Overview",
      description:
        "Get a comprehensive crypto market overview from CoinGecko: global market cap, BTC dominance, " +
        "top 10 coins by market cap with prices/changes, and trending coins. Free API, no key required.",
      inputSchema: {},
    },
    async () => {
      try {
        const overview = await getCryptoOverview();
        return { content: [{ type: "text", text: JSON.stringify(overview, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] crypto_get_overview: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "crypto_get_prices",
    {
      title: "Get Crypto Prices",
      description:
        "Get current price data for specific cryptocurrencies from CoinGecko. " +
        "Use CoinGecko coin IDs: bitcoin, ethereum, solana, ripple, cardano, binancecoin, etc.",
      inputSchema: {
        coins: z.string()
          .describe("Comma-separated CoinGecko coin IDs, e.g. 'bitcoin,ethereum,solana'"),
      },
    },
    async ({ coins }) => {
      try {
        const ids = coins.split(",").map(s => s.trim()).filter(Boolean);
        const prices = await fetchCryptoPrices(ids);
        return { content: [{ type: "text", text: JSON.stringify(prices, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] crypto_get_prices: ${msg}` }], isError: true };
      }
    }
  );

  // ============================================================
  // STOCK TOOLS
  // ============================================================

  server.registerTool(
    "stock_vn_overview",
    {
      title: "Vietnam Stock Market Overview",
      description:
        "Get Vietnam stock market overview: VNINDEX/HNX/UPCOM indices with change data, " +
        "top stocks by volume, and foreign investor buy/sell flow. Data from KBS Securities.",
      inputSchema: {},
    },
    async () => {
      try {
        const overview = await getVNStockOverview();
        return { content: [{ type: "text", text: JSON.stringify(overview, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] stock_vn_overview: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "stock_get_price",
    {
      title: "Get VN Stock Price",
      description:
        "Get current price data for a specific Vietnam stock symbol (HOSE/HNX/UPCOM). " +
        "Examples: VNM, FPT, VIC, HPG, TCB, MBB, VHM, MSN, VCB, BID.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol, e.g. 'VNM', 'FPT', 'VIC'"),
      },
    },
    async ({ symbol }) => {
      try {
        const price = await fetchStockPrice(symbol.toUpperCase());
        return { content: [{ type: "text", text: JSON.stringify(price, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] stock_get_price: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "stock_get_history",
    {
      title: "Get VN Stock Price History",
      description:
        "Get historical OHLCV price data for a Vietnam stock over N days. " +
        "Useful for technical analysis and trend identification.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol, e.g. 'VNM'"),
        days: z.number().min(1).max(365).optional()
          .describe("Number of past days. Default: 30"),
      },
    },
    async ({ symbol, days }) => {
      try {
        const history = await fetchStockHistory(symbol.toUpperCase(), days ?? 30);
        return { content: [{ type: "text", text: JSON.stringify(history, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] stock_get_history: ${msg}` }], isError: true };
      }
    }
  );

  // ============================================================
  // MCP PROMPTS
  // ============================================================

  registerAnalyzeNewsPrompt(server);
  registerMarketSentimentPrompt(server);
  registerRiskAssessmentPrompt(server);
  registerTradingPlanPrompt(server);

  return server;
}

// Standalone export for index.ts (dev/inspect mode)
export const server = createServer();
