import axios from "axios";
import * as cheerio from "cheerio";

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface CryptoNewsArticle {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
  sourceUrl: string;
  category: string;
}

export interface ThuanCapitalArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
}

export interface ThuanCapitalArticleDetail extends ThuanCapitalArticle {
  content: string;
  publishedAt?: string;
}

// ── Constants & Cache ────────────────────────────────────────────────────────

const RSS_URL = "https://cryptocurrency.cv/api/rss?feed=bitcoin";

const THUANCAPITAL_BASE = "https://thuancapital.com";
const THUANCAPITAL_CATEGORIES: Record<string, string> = {
  "tin-tuc": "c1",
  "kien-thuc": "c12",
};

const CACHE_TTL_NEWS = 5 * 60 * 1000;     // 5 min
const CACHE_TTL_ARTICLE = 60 * 60 * 1000; // 1 hour

const cache = {
  rssNews: null as { data: CryptoNewsArticle[]; timestamp: number } | null,
  thuanList: new Map<string, { data: ThuanCapitalArticle[]; timestamp: number }>(),
  thuanArticle: new Map<string, { data: ThuanCapitalArticleDetail; timestamp: number }>(),
};

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.5",
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, retries = 2): Promise<string> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await http.get<string>(url, { responseType: "text" });
      return res.data;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error("unreachable");
}

function isFresh(timestamp: number, ttl: number): boolean {
  return Date.now() - timestamp < ttl;
}

// ── cryptocurrency.cv RSS ────────────────────────────────────────────────────

export async function fetchCryptocurrencyNews(limit = 15): Promise<CryptoNewsArticle[]> {
  if (cache.rssNews && isFresh(cache.rssNews.timestamp, CACHE_TTL_NEWS)) {
    return cache.rssNews.data.slice(0, limit);
  }

  const xml = await fetchWithRetry(RSS_URL);
  const $ = cheerio.load(xml, { xmlMode: true });
  const articles: CryptoNewsArticle[] = [];

  $("item").each((_i, el) => {
    const title = $(el).find("title").first().text().trim();
    const link = $(el).find("link").first().text().trim()
      || $(el).find("link").first().attr("href")?.trim() || "";
    const description = $(el).find("description").first().text().trim();
    const pubDate = $(el).find("pubDate").first().text().trim();
    const sourceEl = $(el).find("source").first();
    const source = sourceEl.text().trim();
    const sourceUrl = sourceEl.attr("url")?.trim() || "";
    const category = $(el).find("category").first().text().trim() || "bitcoin";

    if (!title || !link) return;

    articles.push({
      title,
      link,
      description,
      pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      source,
      sourceUrl,
      category,
    });
  });

  if (articles.length === 0) {
    throw new Error("No articles found in cryptocurrency.cv RSS feed");
  }

  cache.rssNews = { data: articles, timestamp: Date.now() };
  return articles.slice(0, limit);
}

// ── ThuanCapital Scraping ────────────────────────────────────────────────────

export async function fetchThuanCapitalNews(
  category = "tin-tuc",
  page = 1,
): Promise<ThuanCapitalArticle[]> {
  const code = THUANCAPITAL_CATEGORIES[category];
  if (!code) {
    throw new Error(
      `Unknown category: ${category}. Valid: ${Object.keys(THUANCAPITAL_CATEGORIES).join(", ")}`,
    );
  }

  const cacheKey = `${category}_${page}`;
  const cached = cache.thuanList.get(cacheKey);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_NEWS)) return cached.data;

  const slug = `${category}-${code}`;
  const url = page > 1
    ? `${THUANCAPITAL_BASE}/${slug}-trang-${page}.html`
    : `${THUANCAPITAL_BASE}/${slug}.html`;

  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);
  const articles: ThuanCapitalArticle[] = [];
  const seen = new Set<string>();

  $("h2").each((_i, el) => {
    const anchor = $(el).find("a[href]").first();
    if (!anchor.length) return;

    const href = anchor.attr("href") || "";
    const title = anchor.text().trim();
    if (!title || !href) return;

    // Extract article ID from URL pattern: -i{ID}.html
    const idMatch = href.match(/-i(\d+)\.html$/);
    if (!idMatch) return;

    const id = idMatch[1];
    if (seen.has(id)) return;
    seen.add(id);

    const fullUrl = href.startsWith("http") ? href : `${THUANCAPITAL_BASE}${href.startsWith("/") ? "" : "/"}${href}`;

    // Find summary — look at next sibling paragraphs
    let summary = "";
    const parent = $(el).parent();
    const nextP = parent.find("p").first();
    if (nextP.length) {
      summary = nextP.text().trim();
    }
    // Fallback: look at the sibling element after h2
    if (!summary) {
      let next = $(el).next();
      while (next.length && !summary) {
        if (next.is("p") || next.find("p").length) {
          summary = next.is("p") ? next.text().trim() : next.find("p").first().text().trim();
        }
        next = next.next();
      }
    }

    articles.push({ id, title, summary, url: fullUrl });
  });

  if (articles.length === 0) {
    throw new Error(`No articles found on ThuanCapital ${category} page ${page}`);
  }

  cache.thuanList.set(cacheKey, { data: articles, timestamp: Date.now() });
  return articles;
}

export async function fetchThuanCapitalArticle(url: string): Promise<ThuanCapitalArticleDetail> {
  // Validate URL belongs to ThuanCapital
  if (!url.includes("thuancapital.com")) {
    throw new Error("URL must be from thuancapital.com");
  }

  const cached = cache.thuanArticle.get(url);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_ARTICLE)) return cached.data;

  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);

  // Extract article ID from URL
  const idMatch = url.match(/-i(\d+)\.html$/);
  const id = idMatch?.[1] || url;

  // Title: h1
  const title = $("h1").first().text().trim();

  // Summary: h3 near the title (subtitle/lead)
  const summary = $("h3").first().text().trim();

  // Published date — look for date pattern near top
  let publishedAt: string | undefined;
  $("*").each((_i, el) => {
    if (publishedAt) return false; // break
    const text = $(el).children().length === 0 ? $(el).text().trim() : "";
    // Match pattern like "31 Tháng 03, 2026 00:04"
    const dateMatch = text.match(/(\d{1,2})\s+Tháng\s+(\d{2}),\s+(\d{4})\s+(\d{2}:\d{2})/);
    if (dateMatch) {
      const [, day, month, year, time] = dateMatch;
      publishedAt = new Date(`${year}-${month}-${day}T${time}:00+07:00`).toISOString();
    }
  });

  // Content: collect all section paragraphs
  // Article body is between h3 (summary) and the affiliate/sidebar section
  const contentParts: string[] = [];
  const stopKeywords = ["Bài Nổi Bật", "Tham gia các Sàn", "THUANCAPITAL", "Điều Khoản"];

  $("h2, p").each((_i, el) => {
    const text = $(el).text().trim();
    if (!text) return;

    // Stop at sidebar/footer content
    if (stopKeywords.some(kw => text.includes(kw))) return false;

    // Skip affiliate links
    if ($(el).find('a[href*="binance.com"], a[href*="bybit"], a[href*="okx.com"], a[href*="pipaffiliates"]').length) return;

    if ($(el).is("h2")) {
      contentParts.push(`\n## ${text}\n`);
    } else {
      contentParts.push(text);
    }
  });

  const content = contentParts.join("\n\n").trim();

  if (!title && !content) {
    throw new Error(`Could not extract article content from: ${url}`);
  }

  const detail: ThuanCapitalArticleDetail = { id, title, summary, url, content, publishedAt };
  cache.thuanArticle.set(url, { data: detail, timestamp: Date.now() });
  return detail;
}
