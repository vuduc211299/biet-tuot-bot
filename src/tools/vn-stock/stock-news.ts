import * as cheerio from "cheerio";
import { isFresh } from "../_shared/http.js";
import { http as sharedHttp } from "../_shared/http.js";

export interface NewsItem {
  title: string;
  url: string;
  date: string;
  category: string;
  summary: string;
}

const CACHE_TTL_NEWS = 10 * 60 * 1000; // 10 minutes

const cache = {
  news: new Map<string, { data: NewsItem[]; timestamp: number }>(),
};

// ── Company News & Events ────────────────────────────────────────────────────

export async function fetchCompanyNews(ticker: string, category?: string): Promise<NewsItem[]> {
  const sym = ticker.toUpperCase();
  const cacheKey = `${sym}_${category ?? "all"}`;
  const cached = cache.news.get(cacheKey);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_NEWS)) return cached.data;

  const url = `https://cafef.vn/du-lieu/tin-doanh-nghiep/${sym.toLowerCase()}/Event.chn`;

  try {
    const res = await sharedHttp.get(url);
    const $ = cheerio.load(res.data as string);
    const items: NewsItem[] = [];

    $("ul.list-news li, .news-list li, .box-news li, .item-news, li.clearfix, .list-item").each((_, el) => {
      const $el = $(el);
      const titleEl = $el.find("a").filter((_, a) => $(a).text().trim().length > 10).first();
      const title = titleEl.text().trim();
      const href = titleEl.attr("href") ?? "";
      if (!title || !href) return;

      const fullUrl = href.startsWith("http") ? href : `https://cafef.vn${href}`;
      const dateText = $el.find(".time, .date, span.gray, .txt-gray, [class*='time']").first().text().trim();
      const catText = $el.find(".cate, .label, [class*='cate'], [class*='tag']").first().text().trim();
      const summary = $el.find("p, .sapo, [class*='sapo'], .summary").first().text().trim();

      items.push({
        title,
        url: fullUrl,
        date: dateText,
        category: catText || "Tin doanh nghiệp",
        summary,
      });
    });

    // Fallback: pick any anchor with a reasonable href pattern
    if (items.length === 0) {
      $("a[href*='/']").each((_, el) => {
        const $a = $(el);
        const title = $a.text().trim();
        const href = $a.attr("href") ?? "";
        if (title.length < 20 || !href.includes(".chn")) return;
        const fullUrl = href.startsWith("http") ? href : `https://cafef.vn${href}`;
        items.push({ title, url: fullUrl, date: "", category: "Tin doanh nghiệp", summary: "" });
      });
    }

    const filtered = category
      ? items.filter(item =>
        item.category.toLowerCase().includes(category.toLowerCase()) ||
        item.title.toLowerCase().includes(category.toLowerCase())
      )
      : items;

    const result = filtered.slice(0, 20);
    if (result.length > 0) cache.news.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    return [];
  }
}

// ── Insider Trading ──────────────────────────────────────────────────────────

export async function fetchInsiderTrading(ticker: string): Promise<NewsItem[]> {
  const sym = ticker.toUpperCase();
  const cacheKey = `${sym}_insider`;
  const cached = cache.news.get(cacheKey);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_NEWS)) return cached.data;

  const allNews = await fetchCompanyNews(sym);
  const keywords = ["cổ đông", "nội bộ", "giao dịch cổ phiếu", "mua vào", "bán ra", "đăng ký mua", "đăng ký bán"];
  const insider = allNews.filter(item =>
    keywords.some(kw =>
      item.category.toLowerCase().includes(kw) ||
      item.title.toLowerCase().includes(kw)
    )
  );

  cache.news.set(cacheKey, { data: insider, timestamp: Date.now() });
  return insider;
}
