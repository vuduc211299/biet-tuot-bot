import axios from "axios";
import * as cheerio from "cheerio";

const CACHE_TTL_NEWS = 10 * 60 * 1000; // 10 minutes
const CACHE_TTL_RATIOS = 30 * 60 * 1000; // 30 minutes

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
  },
});

function isFresh(timestamp: number, ttl: number): boolean {
  return Date.now() - timestamp < ttl;
}

// ============================================================
// INTERFACES
// ============================================================

export interface NewsItem {
  title: string;
  url: string;
  date: string;
  category: string;
  summary: string;
}

export interface CafefArticleDetail {
  title: string;
  content: string;
  url: string;
  date: string;
  author?: string;
}

export const MACRO_CATEGORIES: Record<string, { path: string; label: string }> = {
  "chung-khoan": { path: "thi-truong-chung-khoan.chn", label: "Chứng khoán" },
  "vi-mo": { path: "vi-mo-dau-tu.chn", label: "Vĩ mô - Đầu tư" },
  "quoc-te": { path: "tai-chinh-quoc-te.chn", label: "Tài chính quốc tế" },
  "thi-truong": { path: "thi-truong.chn", label: "Thị trường (vàng, hàng hóa)" },
  "ngan-hang": { path: "tai-chinh-ngan-hang.chn", label: "Ngân hàng" },
};

export interface FinancialRatios {
  symbol: string;
  eps: number | null;
  pe: number | null;
  pb: number | null;
  marketCap: number | null;
  priceClose: number | null;
  bookValue: number | null;
}

// ============================================================
// CACHE
// ============================================================

const cache = {
  news: new Map<string, { data: NewsItem[]; timestamp: number }>(),
  ratios: new Map<string, { data: FinancialRatios; timestamp: number }>(),
};

// ============================================================
// COMPANY NEWS & EVENTS
// ============================================================

export async function fetchCompanyNews(ticker: string, category?: string): Promise<NewsItem[]> {
  const sym = ticker.toUpperCase();
  const cacheKey = `${sym}_${category ?? "all"}`;
  const cached = cache.news.get(cacheKey);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_NEWS)) return cached.data;

  const url = `https://cafef.vn/du-lieu/tin-doanh-nghiep/${sym.toLowerCase()}/Event.chn`;

  try {
    const res = await http.get(url);
    const $ = cheerio.load(res.data as string);
    const items: NewsItem[] = [];

    // Selectors covering CafeF's news list layouts
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

// ============================================================
// INSIDER TRADING (subset of company news)
// ============================================================

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

// ============================================================
// FINANCIAL RATIOS (P/E, EPS, P/B, market cap)
// ============================================================

export async function fetchFinancialRatios(ticker: string): Promise<FinancialRatios> {
  const sym = ticker.toUpperCase();
  const cached = cache.ratios.get(sym);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_RATIOS)) return cached.data;

  const empty: FinancialRatios = {
    symbol: sym,
    eps: null,
    pe: null,
    pb: null,
    marketCap: null,
    priceClose: null,
    bookValue: null,
  };

  // Try multiple CafeF URL patterns for the ticker overview page
  const urls = [
    `https://cafef.vn/thi-truong-chung-khoan/co-phieu/${sym.toLowerCase()}-28.chn`,
    `https://cafef.vn/du-lieu/hose/${sym.toLowerCase()}.chn`,
    `https://cafef.vn/co-phieu/${sym.toLowerCase()}-28.chn`,
  ];

  for (const url of urls) {
    try {
      const res = await http.get(url);
      const $ = cheerio.load(res.data as string);
      const ratios: FinancialRatios = { ...empty };

      // Strategy 1: look for labeled table rows
      $("tr, .row, .item").each((_, el) => {
        const text = $(el).text();
        const cells = $(el).find("td, .col, span, div");
        if (cells.length < 2) return;

        const label = $(cells[0]).text().trim().toLowerCase();
        const raw = $(cells[1]).text().trim().replace(/[,\s]/g, "");
        const val = parseFloat(raw) || null;

        if (label.includes("eps")) ratios.eps = ratios.eps ?? val;
        else if (label.includes("p/e")) ratios.pe = ratios.pe ?? val;
        else if (label.includes("p/b")) ratios.pb = ratios.pb ?? val;
        else if (label.includes("vốn hóa") || label.includes("market cap")) ratios.marketCap = ratios.marketCap ?? val;
        else if (label.includes("giá đóng") || label.includes("thị giá")) ratios.priceClose = ratios.priceClose ?? val;
        else if (label.includes("book value") || label.includes("sổ sách")) ratios.bookValue = ratios.bookValue ?? val;
      });

      // Strategy 2: inspect specific CafeF data attributes or class patterns
      $("[class*='eps'], [class*='pe-'], [class*='pb-'], [id*='eps'], [id*='pe'], [id*='pb']").each((_, el) => {
        const cls = ($(el).attr("class") ?? "") + ($(el).attr("id") ?? "");
        const val = parseFloat($(el).text().replace(/[,\s]/g, "")) || null;
        if (/\beps\b/.test(cls)) ratios.eps = ratios.eps ?? val;
        else if (/\bp[\-_]?e\b/.test(cls)) ratios.pe = ratios.pe ?? val;
        else if (/\bp[\-_]?b\b/.test(cls)) ratios.pb = ratios.pb ?? val;
      });

      // Return if we found at least one value
      const hasData = ratios.eps !== null || ratios.pe !== null || ratios.pb !== null || ratios.marketCap !== null;
      if (hasData) {
        cache.ratios.set(sym, { data: ratios, timestamp: Date.now() });
        return ratios;
      }
    } catch {
      // try next URL
    }
  }

  return empty;
}

// ============================================================
// MACRO / MARKET NEWS (category pages)
// ============================================================

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
    const res = await http.get(url);
    const $ = cheerio.load(res.data as string);
    const items: NewsItem[] = [];
    const seen = new Set<string>();

    // CafeF category pages: various list layouts
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

// ============================================================
// ARTICLE FULL CONTENT READER
// ============================================================

const articleCache = new Map<string, { data: CafefArticleDetail; timestamp: number }>();
const CACHE_TTL_ARTICLE = 60 * 60 * 1000; // 1 hour

export async function fetchCafefArticleContent(articleUrl: string): Promise<CafefArticleDetail> {
  const cached = articleCache.get(articleUrl);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_ARTICLE)) return cached.data;

  const res = await http.get(articleUrl);
  const $ = cheerio.load(res.data as string);

  const title = $("h1.title").first().text().trim()
    || $("h1").first().text().trim();

  const date = $(".datemark, .pdate, .time, .date-post, [class*='time']").first().text().trim();

  const author = $(".author, .source, [class*='author']").first().text().trim();

  // Extract body paragraphs — try multiple selectors
  let content = "";
  const bodySelectors = [
    ".detail-content p",
    "#mainContent p",
    ".contentdetail p",
    "article p",
    ".fck_detail p",
    ".news-content p",
  ];
  for (const sel of bodySelectors) {
    const paragraphs: string[] = [];
    $(sel).each((_i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 10) paragraphs.push(text);
    });
    if (paragraphs.length >= 2) {
      content = paragraphs.join("\n\n");
      break;
    }
  }

  // Ultimate fallback: grab all <p> in body
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

  const detail: CafefArticleDetail = {
    title,
    content,
    url: articleUrl,
    date,
    author: author || undefined,
  };

  articleCache.set(articleUrl, { data: detail, timestamp: Date.now() });
  return detail;
}
