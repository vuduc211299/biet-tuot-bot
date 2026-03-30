import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  fetchCategoryFeed,
  fetchArticleContent,
  searchArticles,
} from "./vnexpress.js";
import { getCryptoOverview, fetchCryptoPrices, getCryptoTechnical } from "./crypto.js";
import {
  fetchStockOHLCV,
  fetchIndexData,
  fetchPriceBoard,
  fetchCompanyProfile,
  fetchTopVolume,
  fetchForeignRanking,
  computeTechnicals,
} from "./stock.js";
import {
  fetchCompanyNews,
  fetchInsiderTrading,
  fetchFinancialRatios,
  fetchMacroNews,
  fetchCafefArticleContent,
  MACRO_CATEGORIES,
} from "./cafef.js";

const CATEGORIES = [
  "tin-moi-nhat", "the-gioi", "thoi-su", "kinh-doanh",
  "bat-dong-san", "khoa-hoc", "so-hoa", "phap-luat",
] as const;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "vnexpress-finance",
    version: "1.0.0",
  });

  function logTool(name: string, input: Record<string, unknown>, data: unknown): void {
    const json = JSON.stringify(data);
    const preview = json.length > 800 ? json.slice(0, 800) + `... (${json.length} chars)` : json;
    console.log(`[TOOL] ${name} | input: ${JSON.stringify(input)} | response: ${preview}`);
  }

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
        logTool("vnexpress_get_latest_news", { category, limit }, result);
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
        logTool("vnexpress_search_news", { keyword, category }, articles);
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
        logTool("vnexpress_get_article_content", { article_id, url }, { title: detail.title, url: detail.url, contentLength: detail.content?.length });
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
        logTool("crypto_get_overview", {}, overview);
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
        logTool("crypto_get_prices", { coins }, prices);
        return { content: [{ type: "text", text: JSON.stringify(prices, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] crypto_get_prices: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "crypto_get_technical",
    {
      title: "Crypto Technical Analysis",
      description:
        "Get comprehensive technical analysis for a specific cryptocurrency: RSI-14, SMA-50, SMA-200, " +
        "EMA-12, EMA-26, MACD (line/signal/histogram), ATH/ATL with dates, multi-timeframe price changes " +
        "(1h/24h/7d/30d/1y), and supply data. Use this for any crypto deep analysis — it replaces multiple " +
        "separate calls. Common coin IDs: bitcoin, ethereum, solana, ripple, cardano, binancecoin, dogecoin, " +
        "tether, usd-coin, shiba-inu, avalanche-2, chainlink, polkadot, tron.",
      inputSchema: {
        coin: z.string().describe("CoinGecko coin ID, e.g. 'bitcoin', 'ethereum', 'solana'"),
      },
    },
    async ({ coin }) => {
      try {
        const technical = await getCryptoTechnical(coin.trim().toLowerCase());
        logTool("crypto_get_technical", { coin }, technical);
        return { content: [{ type: "text", text: JSON.stringify(technical, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] crypto_get_technical: ${msg}` }], isError: true };
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
        "Get Vietnam stock market overview: top stocks by volume and foreign investor buy/sell rankings. " +
        "Data from KBS Securities. Use stock_get_index for VNINDEX/HNX/UPCOM index price data.",
      inputSchema: {},
    },
    async () => {
      try {
        const [topVolume, foreignFlow] = await Promise.all([
          fetchTopVolume(10),
          fetchForeignRanking(10),
        ]);
        logTool("stock_vn_overview", {}, { topVolume, foreignFlow });
        return { content: [{ type: "text", text: JSON.stringify({ topVolume, foreignFlow }, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] stock_vn_overview: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "stock_get_ohlcv",
    {
      title: "Get VN Stock OHLCV History",
      description:
        "Get historical OHLCV (open/high/low/close/volume) price data for a Vietnam stock over N days. " +
        "Prices are in VND (thousands). Data from KBS Securities. " +
        "Examples: VNM, FPT, VIC, HPG, TCB, MBB, VHM, MSN, VCB, BID.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol, e.g. 'VNM', 'FPT'"),
        days: z.number().min(1).max(365).optional()
          .describe("Number of calendar days to look back. Default: 90"),
      },
    },
    async ({ symbol, days }) => {
      try {
        const bars = await fetchStockOHLCV(symbol.toUpperCase(), days ?? 90);
        logTool("stock_get_ohlcv", { symbol, days }, { count: bars.length, last: bars[bars.length - 1] });
        return { content: [{ type: "text", text: JSON.stringify(bars, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] stock_get_ohlcv: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "stock_get_index",
    {
      title: "Get VN Market Index OHLCV",
      description:
        "Get historical OHLCV data for a Vietnam market index over N days. " +
        "Supported indices: VNINDEX, HNX, UPCOM, VN30, HNX30. Data from KBS Securities.",
      inputSchema: {
        index: z.string().describe("Index name, e.g. 'VNINDEX', 'HNX', 'UPCOM', 'VN30'"),
        days: z.number().min(1).max(365).optional()
          .describe("Number of calendar days to look back. Default: 30"),
      },
    },
    async ({ index, days }) => {
      try {
        const bars = await fetchIndexData(index.toUpperCase(), days ?? 30);
        logTool("stock_get_index", { index, days }, { count: bars.length, last: bars[bars.length - 1] });
        return { content: [{ type: "text", text: JSON.stringify(bars, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] stock_get_index: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "stock_price_board",
    {
      title: "VN Stock Real-Time Price Board",
      description:
        "Get real-time L1 price board data for multiple Vietnam stocks at once: " +
        "current price, open/high/low, change, volume, foreign buy/sell, ceiling/floor/ref. " +
        "Data from KBS Securities. Cached for 1 minute.",
      inputSchema: {
        symbols: z.string()
          .describe("Comma-separated ticker symbols, e.g. 'VNM,FPT,VIC,HPG'"),
      },
    },
    async ({ symbols }) => {
      try {
        const syms = symbols.split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean);
        const board = await fetchPriceBoard(syms);
        logTool("stock_price_board", { symbols }, board);
        return { content: [{ type: "text", text: JSON.stringify(board, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] stock_price_board: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "stock_get_profile",
    {
      title: "VN Stock Company Profile",
      description:
        "Get company profile for a Vietnam stock: full name, exchange (HOSE/HNX/UPCOM), " +
        "industry/sector, website, address, business description, listed date, listed shares, " +
        "and chartered capital. Data from KBS Securities.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol, e.g. 'VNM', 'FPT'"),
      },
    },
    async ({ symbol }) => {
      try {
        const profile = await fetchCompanyProfile(symbol.toUpperCase());
        logTool("stock_get_profile", { symbol }, profile);
        if (!profile) {
          return { content: [{ type: "text", text: `No profile found for ${symbol.toUpperCase()}` }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] stock_get_profile: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cafef_get_company_news",
    {
      title: "CafeF Company News & Events",
      description:
        "Get recent company news and corporate events for a Vietnam stock from CafeF. " +
        "Includes: business updates, dividend announcements, personnel changes, capital events " +
        "and shareholder transactions. Optionally filter by category keyword.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol, e.g. 'VNM', 'FPT'"),
        category: z.string().optional()
          .describe("Optional category filter keyword, e.g. 'cổ tức', 'nhân sự', 'cổ đông'"),
      },
    },
    async ({ symbol, category }) => {
      try {
        const news = await fetchCompanyNews(symbol.toUpperCase(), category);
        logTool("cafef_get_company_news", { symbol, category }, news);
        if (news.length === 0) {
          return { content: [{ type: "text", text: `No news found for ${symbol.toUpperCase()}.` }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(news, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] cafef_get_company_news: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cafef_get_insider_trading",
    {
      title: "CafeF Insider & Shareholder Trading",
      description:
        "Get insider trading and major shareholder transaction disclosures for a Vietnam stock from CafeF. " +
        "Includes registered buy/sell transactions by board members, executives, and large shareholders.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol, e.g. 'VNM', 'FPT'"),
      },
    },
    async ({ symbol }) => {
      try {
        const insider = await fetchInsiderTrading(symbol.toUpperCase());
        logTool("cafef_get_insider_trading", { symbol }, insider);
        if (insider.length === 0) {
          return { content: [{ type: "text", text: `No insider trading disclosures found for ${symbol.toUpperCase()}.` }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(insider, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] cafef_get_insider_trading: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cafef_get_financials",
    {
      title: "CafeF Financial Ratios",
      description:
        "Get key financial ratios for a Vietnam stock from CafeF: " +
        "EPS (earnings per share in VND), P/E ratio, P/B ratio, market capitalization (tỷ VND), " +
        "last close price, and book value per share.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol, e.g. 'VNM', 'FPT'"),
      },
    },
    async ({ symbol }) => {
      try {
        const ratios = await fetchFinancialRatios(symbol.toUpperCase());
        logTool("cafef_get_financials", { symbol }, ratios);
        return { content: [{ type: "text", text: JSON.stringify(ratios, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] cafef_get_financials: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "stock_get_technical",
    {
      title: "VN Stock Technical Analysis",
      description:
        "Get comprehensive technical analysis for a Vietnam stock computed from KBS OHLCV data: " +
        "SMA-20/50/200, EMA-12/26, RSI-14, MACD (line/signal/histogram), ATH/ATL (high/low within period), " +
        "latest close/date, and last 30 OHLCV bars. Use days=200 or more for SMA-200 to be meaningful. " +
        "Use days=365 for 1-year ATH/ATL.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol, e.g. 'VNM', 'FPT'"),
        days: z.number().min(20).max(365).optional()
          .describe("Days of OHLCV data to fetch for indicator calculation. Default: 200"),
      },
    },
    async ({ symbol, days }) => {
      try {
        const ohlcv = await fetchStockOHLCV(symbol.toUpperCase(), days ?? 200);
        if (ohlcv.length === 0) {
          return { content: [{ type: "text", text: `No OHLCV data for ${symbol.toUpperCase()}.` }] };
        }
        const result = computeTechnicals(symbol.toUpperCase(), ohlcv);
        logTool("stock_get_technical", { symbol, days }, result);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] stock_get_technical: ${msg}` }], isError: true };
      }
    }
  );

  // ============================================================
  // CAFEF MACRO NEWS & ARTICLE TOOLS
  // ============================================================

  const CAFEF_CATEGORIES = Object.keys(MACRO_CATEGORIES) as [string, ...string[]];

  server.registerTool(
    "cafef_get_macro_news",
    {
      title: "CafeF Macro & Market News",
      description:
        "Fetch latest macro/market news articles from CafeF by category. " +
        "Categories: chung-khoan (stock market), vi-mo (macro economy/investment), " +
        "quoc-te (international finance), thi-truong (gold/commodities/market), ngan-hang (banking). " +
        "Returns titles, summaries, URLs, and dates. Best for Vietnam macro analysis, gold, foreign investors.",
      inputSchema: {
        category: z.enum(CAFEF_CATEGORIES)
          .describe("CafeF macro category: chung-khoan, vi-mo, quoc-te, thi-truong, ngan-hang"),
        limit: z.number().min(1).max(20).optional()
          .describe("Max number of articles. Default: 10"),
      },
    },
    async ({ category, limit }) => {
      try {
        const articles = await fetchMacroNews(category);
        const result = articles.slice(0, limit ?? 10);
        logTool("cafef_get_macro_news", { category, limit }, result);
        if (result.length === 0) {
          return { content: [{ type: "text", text: `No macro news found for category: ${category}` }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] cafef_get_macro_news: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "cafef_get_article_content",
    {
      title: "Get CafeF Article Full Content",
      description:
        "Fetch the full text content of a specific CafeF article by URL. " +
        "Use after getting article list from cafef_get_macro_news or cafef_get_company_news to read the article in detail.",
      inputSchema: {
        url: z.string()
          .describe("Full CafeF article URL, e.g. https://cafef.vn/..."),
      },
    },
    async ({ url }) => {
      try {
        const detail = await fetchCafefArticleContent(url);
        logTool("cafef_get_article_content", { url }, { title: detail.title, url: detail.url, contentLength: detail.content?.length });
        return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] cafef_get_article_content: ${msg}` }], isError: true };
      }
    }
  );

  return server;
}

// Standalone export for index.ts (dev/inspect mode)
export const server = createServer();
