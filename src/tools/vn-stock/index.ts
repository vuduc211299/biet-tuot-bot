import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logTool } from "../_shared/http.js";
import {
  fetchStockOHLCV,
  fetchIndexData,
  fetchPriceBoard,
  fetchCompanyProfile,
  fetchTopVolume,
  fetchForeignRanking,
  fetchFinancialRatios,
} from "./stock-market.js";
import { computeTechnicals, fetchStockATHATL } from "./stock-technical.js";
import { fetchCompanyNews, fetchInsiderTrading } from "./stock-news.js";

export function registerVnStockTools(server: McpServer): void {
  server.registerTool(
    "stock_vn_overview",
    {
      title: "Vietnam Stock Market Overview",
      description:
        "Get Vietnam stock market overview: top stocks by volume and foreign investor buy/sell rankings. " +
        "Data from KBS Securities. Use stock_get_index for VNINDEX/HNX/UPCOM index price data. " +
        "Calling again returns the same data. Call only ONCE per conversation.",
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
        "and shareholder transactions. Optionally filter by category keyword. " +
        "NOT paginated — calling again for the same symbol returns the same results. Call only ONCE per symbol.",
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
        "Includes registered buy/sell transactions by board members, executives, and large shareholders. " +
        "NOT paginated — calling again for the same symbol returns the same results. Call only ONCE per symbol.",
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
        "Get comprehensive technical analysis for a Vietnam stock: " +
        "SMA-20/50/200, EMA-12/26, RSI-14, MACD (line/signal/histogram), " +
        "ATH/ATL (true all-time high/low from full listing history since 2000), " +
        "latest close/date, and last 30 OHLCV bars.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker symbol, e.g. 'VNM', 'FPT'"),
        days: z.number().min(20).max(365).optional()
          .describe("Days of OHLCV data for indicator calculation (SMA/EMA/RSI/MACD). Default: 200. ATH/ATL always uses full history."),
      },
    },
    async ({ symbol, days }) => {
      try {
        const sym = symbol.toUpperCase();
        const [ohlcv, athAtl] = await Promise.all([
          fetchStockOHLCV(sym, days ?? 200),
          fetchStockATHATL(sym),
        ]);
        if (ohlcv.length === 0) {
          return { content: [{ type: "text", text: `No OHLCV data for ${sym}.` }] };
        }
        const technicals = computeTechnicals(sym, ohlcv);
        const result = { ...technicals, ...(athAtl ?? { ath: null, atl: null, dataRange: null }) };
        logTool("stock_get_technical", { symbol, days }, result);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] stock_get_technical: ${msg}` }], isError: true };
      }
    }
  );
}
