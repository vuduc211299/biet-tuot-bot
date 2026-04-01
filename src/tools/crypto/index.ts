import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logTool } from "../_shared/http.js";
import { getCryptoOverview, fetchCryptoPrices } from "./crypto-market.js";
import { getCryptoTechnical } from "./crypto-technical.js";
import {
  fetchCryptocurrencyNews,
  fetchThuanCapitalNews,
  fetchThuanCapitalArticle,
} from "./crypto-news.js";

export function registerCryptoTools(server: McpServer): void {
  server.registerTool(
    "crypto_get_overview",
    {
      title: "Crypto Market Overview",
      description:
        "Get a comprehensive crypto market overview from CoinGecko: global market cap, BTC dominance, " +
        "top 10 coins by market cap with prices/changes, and trending coins. Free API, no key required. " +
        "Calling again returns the same data. Call only ONCE per conversation.",
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

  server.registerTool(
    "cryptocurrency_get_news",
    {
      title: "Cryptocurrency News (English)",
      description:
        "Get latest crypto market news in English aggregated from 200+ international sources " +
        "(Bitcoinist, Bitcoin.com, NYTimes, Yahoo Finance, ZeroHedge, etc.). " +
        "Covers Bitcoin, altcoins, regulation, ETFs, mining, and broader crypto market. " +
        "Returns title, source name, original article link, summary, and publication date. " +
        "NOT paginated — calling again returns the same articles. Call only ONCE per conversation.",
      inputSchema: {
        limit: z.number().min(1).max(20).optional()
          .describe("Max number of articles to return (1-20, default 15)"),
      },
    },
    async ({ limit }) => {
      try {
        const articles = await fetchCryptocurrencyNews(limit ?? 15);
        logTool("cryptocurrency_get_news", { limit }, articles);
        return { content: [{ type: "text", text: JSON.stringify(articles, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] cryptocurrency_get_news: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "thuancapital_get_news",
    {
      title: "ThuanCapital Crypto News (Vietnamese)",
      description:
        "Get Vietnamese crypto news and knowledge from ThuanCapital. " +
        "Categories: tin-tuc (daily crypto news, market updates, author analysis on specific coins/events), " +
        "kien-thuc (educational: what is Bitcoin, BTC vs gold, crypto philosophy, market education). " +
        "Returns article titles, summaries, and URLs.",
      inputSchema: {
        category: z.enum(["tin-tuc", "kien-thuc"]).optional()
          .describe("tin-tuc (daily news & analysis, default) or kien-thuc (definitions, education, crypto philosophy)"),
        page: z.number().min(1).max(5).optional()
          .describe("Page number 1-5 (default 1)"),
      },
    },
    async ({ category, page }) => {
      try {
        const articles = await fetchThuanCapitalNews(category ?? "tin-tuc", page ?? 1);
        logTool("thuancapital_get_news", { category, page }, articles);
        return { content: [{ type: "text", text: JSON.stringify(articles, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] thuancapital_get_news: ${msg}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "thuancapital_get_article",
    {
      title: "ThuanCapital Article Content",
      description:
        "Read full content of a ThuanCapital article by URL. " +
        "Use after thuancapital_get_news to get detailed Vietnamese crypto analysis. " +
        "Returns title, summary, full article content, and publication date.",
      inputSchema: {
        url: z.string()
          .describe("Full ThuanCapital article URL from thuancapital_get_news results"),
      },
    },
    async ({ url }) => {
      try {
        const detail = await fetchThuanCapitalArticle(url);
        logTool("thuancapital_get_article", { url }, { title: detail.title, url: detail.url, contentLength: detail.content?.length });
        return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] thuancapital_get_article: ${msg}` }], isError: true };
      }
    }
  );
}
