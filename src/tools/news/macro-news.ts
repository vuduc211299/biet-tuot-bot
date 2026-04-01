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

export const MACRO_CATEGORIES: Record<string, { path: string; label: string }> = {
  "chung-khoan": { path: "thi-truong-chung-khoan.chn", label: "Chứng khoán" },
  "vi-mo": { path: "vi-mo-dau-tu.chn", label: "Vĩ mô - Đầu tư" },
  "quoc-te": { path: "tai-chinh-quoc-te.chn", label: "Tài chính quốc tế" },
  "thi-truong": { path: "thi-truong.chn", label: "Thị trường (vàng, hàng hóa)" },
  "ngan-hang": { path: "tai-chinh-ngan-hang.chn", label: "Ngân hàng" },
};

const CACHE_TTL_NEWS = 10 * 60 * 1000; // 10 minutes

const cache = {
  news: new Map<string, { data: NewsItem[]; timestamp: number }>(),
};

export async function fetchMacroNews(category: string): Promise<NewsItem[]> {
  const cat = MACRO_CATEGORIES[category];
  if (!cat) {
    const valid = Object.keys(MACRO_CATEGORIES).join(", ");
    throw new Error(`Unknown CafeF macro category: ${category}. Valid: ${valid}`);
  }

  const cacheKey = `macro_${category}`;
  const cached = cache.news.get(cacheKey);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_NEWS)) return cached.data;

  const url = `https://cafef.vn/${cat.path}`;

  try {
    const res = await sharedHttp.get(url);
    const $ = cheerio.load(res.data as string);
    const items: NewsItem[] = [];
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

      items.push({
        title,
        url: fullUrl,
        date: dateText,
        category: cat.label,
        summary,
      });
    });

    // Fallback: pick anchors pointing to .chn articles
    if (items.length === 0) {
      $("a[href*='/']").each((_, el) => {
        const $a = $(el);
        const title = $a.text().trim();
        const href = $a.attr("href") ?? "";
        if (title.length < 20 || !href.includes(".chn")) return;
        const fullUrl = href.startsWith("http") ? href : `https://cafef.vn${href}`;
        if (seen.has(fullUrl)) return;
        seen.add(fullUrl);
        items.push({ title, url: fullUrl, date: "", category: cat.label, summary: "" });
      });
    }

    const result = items.slice(0, 20);
    if (result.length > 0) cache.news.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    return [];
  }
}
