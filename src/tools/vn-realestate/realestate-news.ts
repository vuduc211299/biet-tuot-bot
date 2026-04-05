import * as cheerio from "cheerio";
import { http, isFresh } from "../_shared/http.js";

// ─── Types ───

export interface RealEstateNewsItem {
  title: string;
  url: string;
  date: string;
  summary: string;
  source: "cafef" | "batdongsan";
}

export interface RealEstateArticleDetail {
  title: string;
  content: string;
  url: string;
  date: string;
  author?: string;
}

// ─── Constants ───

const NEWS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ARTICLE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_AGE_DAYS = 60;

// ─── Caches ───

const newsCache = {
  cafef: { data: null as RealEstateNewsItem[] | null, timestamp: 0 },
  batdongsan: { data: null as RealEstateNewsItem[] | null, timestamp: 0 },
};

const articleCache = new Map<string, { data: RealEstateArticleDetail; timestamp: number }>();

// ─── Helpers ───

function isWithinMaxAge(dateStr: string): boolean {
  if (!dateStr) return true; // keep items with unparseable dates
  // Try "dd/mm/yyyy HH:MM" or "dd/mm/yyyy"
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return true;
  const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  if (isNaN(d.getTime())) return true;
  const diffDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= MAX_AGE_DAYS;
}

// ─── CafeF BĐS News ───

async function fetchCafefBdsNews(): Promise<RealEstateNewsItem[]> {
  if (newsCache.cafef.data && isFresh(newsCache.cafef.timestamp, NEWS_CACHE_TTL)) {
    return newsCache.cafef.data;
  }

  const res = await http.get("https://cafef.vn/bat-dong-san.chn");
  const $ = cheerio.load(res.data as string);
  const items: RealEstateNewsItem[] = [];
  const seen = new Set<string>();

  $("ul.list-news li, .news-list li, .box-news li, .item-news, li.clearfix, .list-item, .knswli, .tlitem").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("a").filter((_, a) => $(a).text().trim().length > 15).first();
    const title = titleEl.text().trim();
    const href = titleEl.attr("href") ?? "";
    if (!title || !href) return;

    const fullUrl = href.startsWith("http") ? href : `https://cafef.vn${href}`;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const dateText = $el.find(".time, .date, span.gray, .txt-gray, [class*='time'], .datemark").first().text().trim();
    const summary = $el.find("p, .sapo, [class*='sapo'], .summary, .knswli-sapo").first().text().trim();

    if (!isWithinMaxAge(dateText)) return;

    items.push({ title, url: fullUrl, date: dateText, summary, source: "cafef" });
  });

  // Fallback: anchors pointing to .chn articles
  if (items.length === 0) {
    $("a[href*='/']").each((_, el) => {
      const $a = $(el);
      const title = $a.text().trim();
      const href = $a.attr("href") ?? "";
      if (title.length < 20 || !href.includes(".chn")) return;
      const fullUrl = href.startsWith("http") ? href : `https://cafef.vn${href}`;
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);
      items.push({ title, url: fullUrl, date: "", summary: "", source: "cafef" });
    });
  }

  const result = items.slice(0, 20);
  if (result.length > 0) {
    newsCache.cafef = { data: result, timestamp: Date.now() };
  }
  return result;
}

// ─── Batdongsan Wiki News ───

async function fetchBdsWikiNews(): Promise<RealEstateNewsItem[]> {
  if (newsCache.batdongsan.data && isFresh(newsCache.batdongsan.timestamp, NEWS_CACHE_TTL)) {
    return newsCache.batdongsan.data;
  }

  const res = await http.get("https://wiki.batdongsan.com.vn/tin-tuc");
  const $ = cheerio.load(res.data as string);
  const items: RealEstateNewsItem[] = [];
  const seen = new Set<string>();

  // Article links contain /tin-tuc/ path with numeric suffix
  $("a[href*='/tin-tuc/']").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") ?? "";
    if (!href.match(/\/tin-tuc\/[\w-]+-\d+$/)) return;

    // Prefer img alt for clean title (featured cards wrap entire content in <a>)
    const imgAlt = $a.find("img").first().attr("alt")?.trim();
    const rawText = $a.text().trim();
    // Clean title: strip leading date/time + bullet + category labels
    let title = imgAlt || rawText.replace(/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*•?\s*(Tin tức|Kiến thức|Phân tích)?/i, "").trim();
    if (title.length < 15) return;

    const fullUrl = href.startsWith("http") ? href : `https://wiki.batdongsan.com.vn${href}`;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    // Date is typically in a sibling or parent text node, or within the <a> itself (featured cards)
    const parent = $a.parent();
    const searchText = parent.text() || rawText;
    const dateMatch = searchText.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+\d{1,2}:\d{2}/);
    const dateText = dateMatch ? dateMatch[0] : "";

    if (dateText && !isWithinMaxAge(dateText)) return;

    // Summary from nearby <p> or description element
    const summary = parent.find("p").first().text().trim() ||
      parent.next("p").text().trim() || "";

    items.push({ title, url: fullUrl, date: dateText, summary: summary.slice(0, 200), source: "batdongsan" });
  });

  // Dedup by title
  const dedupItems: RealEstateNewsItem[] = [];
  const seenTitles = new Set<string>();
  for (const item of items) {
    const key = item.title.toLowerCase().slice(0, 50);
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    dedupItems.push(item);
  }

  const result = dedupItems.slice(0, 20);
  if (result.length > 0) {
    newsCache.batdongsan = { data: result, timestamp: Date.now() };
  }
  return result;
}

// ─── Public API ───

export async function fetchRealEstateNews(
  source: "cafef" | "batdongsan" | "all" = "all",
  limit = 15,
): Promise<RealEstateNewsItem[]> {
  if (source === "cafef") {
    const items = await fetchCafefBdsNews();
    return items.slice(0, limit);
  }
  if (source === "batdongsan") {
    const items = await fetchBdsWikiNews();
    return items.slice(0, limit);
  }

  // source === "all": merge both, sort by date descending
  const [cafef, bds] = await Promise.all([fetchCafefBdsNews(), fetchBdsWikiNews()]);
  const merged = [...cafef, ...bds];

  // Sort by date descending (best effort)
  merged.sort((a, b) => {
    const da = a.date.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const db = b.date.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    const dateA = new Date(Number(da[3]), Number(da[2]) - 1, Number(da[1]));
    const dateB = new Date(Number(db[3]), Number(db[2]) - 1, Number(db[1]));
    return dateB.getTime() - dateA.getTime();
  });

  return merged.slice(0, limit);
}

// ─── Article Reader (batdongsan wiki only) ───

export async function fetchBdsArticleContent(articleUrl: string): Promise<RealEstateArticleDetail> {
  if (!articleUrl.includes("wiki.batdongsan.com.vn")) {
    throw new Error("This tool only reads wiki.batdongsan.com.vn articles. For CafeF articles, use cafef_get_article_content.");
  }

  const cached = articleCache.get(articleUrl);
  if (cached && isFresh(cached.timestamp, ARTICLE_CACHE_TTL)) return cached.data;

  const res = await http.get(articleUrl);
  const $ = cheerio.load(res.data as string);

  // Article data is in Next.js SSR payload
  let title = "";
  let date = "";
  let author = "";
  let content = "";

  try {
    const nextDataRaw = $("script#__NEXT_DATA__").html();
    if (nextDataRaw) {
      const nextData = JSON.parse(nextDataRaw) as {
        props?: {
          pageProps?: {
            articleDetails?: {
              title?: string; postDate?: string; author?: { name?: string };
              content?: string; excerpt?: string;
            }
          }
        };
      };
      const details = nextData.props?.pageProps?.articleDetails;
      if (details) {
        title = details.title ?? "";
        date = details.postDate ?? "";
        author = details.author?.name ?? "";
        // Content is HTML — strip tags to plain text
        const htmlContent = details.content ?? "";
        const $content = cheerio.load(htmlContent);
        const paragraphs: string[] = [];
        $content("p, h2, h3, li").each((_i, el) => {
          const text = $content(el).text().trim();
          if (text && text.length > 5) paragraphs.push(text);
        });
        content = paragraphs.join("\n\n") || details.excerpt || "";
      }
    }
  } catch {
    // Fall through to DOM parsing
  }

  // Fallback: DOM parsing if __NEXT_DATA__ failed
  if (!title) title = $("h1").first().text().trim();
  if (!content) {
    const paragraphs: string[] = [];
    $("p").each((_i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 30) paragraphs.push(text);
    });
    content = paragraphs.slice(0, 30).join("\n\n");
  }

  if (!content) {
    content = "[Không thể trích xuất nội dung bài viết]";
  }

  const detail: RealEstateArticleDetail = {
    title,
    content,
    url: articleUrl,
    date,
    author: author || undefined,
  };

  articleCache.set(articleUrl, { data: detail, timestamp: Date.now() });
  return detail;
}
