import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logTool } from "../_shared/http.js";
import { fetchInterestRates } from "./realestate-interest.js";
import { fetchRealEstateNews, fetchBdsArticleContent } from "./realestate-news.js";
import { fetchListings, fetchListingDetail, buildNhaTotUrls } from "./realestate-listings.js";

export function registerVnRealestateTools(server: McpServer): void {
  // ─── Tool 1: Interest Rates ───
  server.registerTool(
    "realestate_get_interest_rates",
    {
      title: "Vietnam Bank Interest Rates",
      description:
        "Get current savings interest rates from 29+ Vietnamese banks (webgia.com). " +
        "Returns rates for terms: KKH, 1-36 months, for counter and/or online deposits. " +
        "Useful as a proxy for mortgage/loan rate estimation (loan rates are typically 2-4% higher). " +
        "VIETNAM ONLY. Call only ONCE per conversation.",
      inputSchema: {
        channel: z.enum(["counter", "online", "all"]).optional()
          .describe("Deposit channel: 'counter' (tại quầy), 'online' (trực tuyến), or 'all' (both). Default: 'all'"),
      },
    },
    async ({ channel }) => {
      try {
        const data = await fetchInterestRates(channel ?? "all");
        const result = { ...data, sourceUrl: "https://webgia.com/lai-suat-ngan-hang/" };
        logTool("realestate_get_interest_rates", { channel }, result);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] realestate_get_interest_rates: ${msg}` }], isError: true };
      }
    },
  );

  // ─── Tool 2: BĐS News ───
  server.registerTool(
    "realestate_get_news",
    {
      title: "Vietnam Real Estate News",
      description:
        "Get latest Vietnamese real estate news from CafeF BĐS section and/or Batdongsan.com.vn Wiki. " +
        "Returns articles from the last 60 days only. Includes: title, URL, date, summary, source. " +
        "For full CafeF article content, use cafef_get_article_content. " +
        "For full batdongsan wiki article content, use realestate_get_article_content. " +
        "VIETNAM ONLY.",
      inputSchema: {
        source: z.enum(["cafef", "batdongsan", "all"]).optional()
          .describe("News source: 'cafef', 'batdongsan', or 'all' (merge both). Default: 'all'"),
        limit: z.number().min(1).max(20).optional()
          .describe("Max number of articles to return (1-20, default 15)"),
      },
    },
    async ({ source, limit }) => {
      try {
        const news = await fetchRealEstateNews(source ?? "all", limit ?? 15);
        const result = {
          articles: news,
          sourceUrls: {
            cafef: "https://cafef.vn/bat-dong-san.chn",
            batdongsan: "https://wiki.batdongsan.com.vn/tin-tuc",
          },
        };
        logTool("realestate_get_news", { source, limit }, result);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] realestate_get_news: ${msg}` }], isError: true };
      }
    },
  );

  // ─── Tool 3: Article Reader (batdongsan wiki) ───
  server.registerTool(
    "realestate_get_article_content",
    {
      title: "Batdongsan Wiki Article Reader",
      description:
        "Read full content of a wiki.batdongsan.com.vn article by URL. " +
        "For CafeF BĐS articles, use cafef_get_article_content instead. " +
        "Returns: title, full text content, date, author.",
      inputSchema: {
        url: z.string().url().describe("Full URL of the wiki.batdongsan.com.vn article"),
      },
    },
    async ({ url }) => {
      try {
        const article = await fetchBdsArticleContent(url);
        logTool("realestate_get_article_content", { url }, article);
        return { content: [{ type: "text", text: JSON.stringify(article, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] realestate_get_article_content: ${msg}` }], isError: true };
      }
    },
  );

  // ─── Tool 4: Listing Search (Chotot/NhaTot API) ───
  server.registerTool(
    "realestate_search_listings",
    {
      title: "Vietnam Real Estate Listing Search",
      description:
        "Search for property listings on NhaTot/Chotot (nhatot.com). " +
        "Returns: title, price, price/m², size, rooms, location, category, URL, seller info, coordinates. " +
        "Data source: gateway.chotot.com public API. VIETNAM ONLY. " +
        "Supports buy (ban) and rent (cho-thue). Filter by city, property type, price range, area range, keyword.",
      inputSchema: {
        type: z.enum(["ban", "cho-thue"]).describe("Transaction type: 'ban' (buy) or 'cho-thue' (rent)"),
        city: z.string().optional()
          .describe("City slug: ha-noi, hcm (or tp-hcm, ho-chi-minh), da-nang, hai-phong, can-tho, binh-duong, dong-nai, ba-ria-vung-tau, khanh-hoa, quang-ninh"),
        propertyType: z.string().optional()
          .describe("Property type: can-ho/chung-cu (apartment), nha-rieng/nha-o (house), dat/dat-nen (land), van-phong/mat-bang (office/commercial), phong-tro (room). Same codes for both sale and rent."),
        keyword: z.string().optional()
          .describe("Search keyword (e.g. 'vinhomes', 'ocean park', 'view sông')"),
        priceRange: z.string().optional()
          .describe("Price range in VND (e.g. '2000000000-5000000000' for 2-5 billion). Use full numbers."),
        areaRange: z.string().optional()
          .describe("Area/size range in m² (e.g. '50-100' for 50-100 m²)"),
        limit: z.number().min(1).max(20).optional()
          .describe("Max listings to return (1-20, default 10)"),
      },
    },
    async ({ type, city, propertyType, keyword, priceRange, areaRange, limit }) => {
      try {
        const data = await fetchListings({ type, city, propertyType, keyword, priceRange, areaRange, limit: limit ?? 10 });
        const urls = buildNhaTotUrls(type, city, propertyType);
        const result = { ...data, ...urls };
        logTool("realestate_search_listings", { type, city, propertyType, keyword, priceRange, areaRange, limit }, result);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] realestate_search_listings: ${msg}` }], isError: true };
      }
    },
  );

  // ─── Tool 5: Listing Detail (Chotot/NhaTot API) ───
  server.registerTool(
    "realestate_get_listing_detail",
    {
      title: "Vietnam Real Estate Listing Detail",
      description:
        "Get full details of a specific property listing from NhaTot/Chotot by listing ID. " +
        "Returns: full description, price, size, rooms, bathrooms, floor, legal status, furnishing, " +
        "address, seller phone, images, coordinates, and all property parameters. " +
        "Use listing IDs from realestate_search_listings results (extract from URL: nhatot.com/{listId}.htm). " +
        "VIETNAM ONLY.",
      inputSchema: {
        listId: z.number().describe("Listing ID (from search results URL: nhatot.com/{listId}.htm)"),
      },
    },
    async ({ listId }) => {
      try {
        const detail = await fetchListingDetail(listId);
        logTool("realestate_get_listing_detail", { listId }, detail);
        return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `[TOOL_ERROR] realestate_get_listing_detail: ${msg}` }], isError: true };
      }
    },
  );
}
