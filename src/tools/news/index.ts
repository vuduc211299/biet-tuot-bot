import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logTool } from "../_shared/http.js";
import {
  CATEGORIES,
  fetchCategoryFeed,
  fetchArticleContent,
  searchArticles,
} from "./vnexpress.js";
import { MACRO_CATEGORIES, fetchMacroNews } from "./macro-news.js";
import { fetchCafefArticleContent } from "./article-reader.js";

const CAFEF_CATEGORIES = Object.keys(MACRO_CATEGORIES) as [string, ...string[]];

export function registerNewsTools(server: McpServer): void {
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
}
