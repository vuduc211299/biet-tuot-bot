import * as cheerio from "cheerio";
import { fetchWithRetry } from "../_shared/http.js";

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  category: string;
  categoryLabel: string;
  thumbnailUrl?: string;
}

export interface ArticleDetail extends NewsArticle {
  content: string;
  author?: string;
}

const RSS_FEEDS: Record<string, { url: string; label: string }> = {
  "tin-moi-nhat": { url: "https://vnexpress.net/rss/tin-moi-nhat.rss", label: "Tin mới nhất" },
  "the-gioi": { url: "https://vnexpress.net/rss/the-gioi.rss", label: "Thế giới" },
  "thoi-su": { url: "https://vnexpress.net/rss/thoi-su.rss", label: "Thời sự" },
  "kinh-doanh": { url: "https://vnexpress.net/rss/kinh-doanh.rss", label: "Kinh doanh" },
  "bat-dong-san": { url: "https://vnexpress.net/rss/bat-dong-san.rss", label: "Bất động sản" },
  "khoa-hoc": { url: "https://vnexpress.net/rss/khoa-hoc.rss", label: "Khoa học" },
  "so-hoa": { url: "https://vnexpress.net/rss/so-hoa.rss", label: "Số hóa" },
  "phap-luat": { url: "https://vnexpress.net/rss/phap-luat.rss", label: "Pháp luật" },
};

export const CATEGORIES = Object.keys(RSS_FEEDS) as [string, ...string[]];

const CACHE_TTL_RSS = 5 * 60 * 1000;
const CACHE_TTL_ARTICLE = 60 * 60 * 1000;
const MAX_CACHED_ARTICLES = 500;

const cache = {
  articles: new Map<string, NewsArticle>(),
  fullContent: new Map<string, ArticleDetail>(),
  categoryLastFetch: new Map<string, number>(),
  articleFetchTime: new Map<string, number>(),
};



function extractArticleId(url: string): string {
  const match = url.match(/(\d+)\.html$/);
  return match ? match[1] : url;
}

function extractSummary(descriptionHtml: string): string {
  const $ = cheerio.load(descriptionHtml);
  $("a:has(img)").remove();
  $("img").remove();
  return $.text().replace(/\s+/g, " ").trim();
}

function parseRSSFeed(xml: string, category: string): NewsArticle[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const feed = RSS_FEEDS[category];
  const articles: NewsArticle[] = [];

  $("item").each((_i, el) => {
    const title = $(el).find("title").first().text().trim();
    const link = $(el).find("link").first().text().trim()
      || $(el).find("link").first().attr("href")?.trim() || "";
    const pubDate = $(el).find("pubDate").first().text().trim();
    const desc = $(el).find("description").first().text();
    const thumb = $(el).find("enclosure").first().attr("url");

    if (!title || !link) return;

    const id = extractArticleId(link);
    const summary = extractSummary(desc);
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();

    articles.push({
      id,
      title,
      summary,
      url: link,
      publishedAt,
      category,
      categoryLabel: feed?.label ?? category,
      thumbnailUrl: thumb,
    });
  });

  if (articles.length === 0) {
    throw new Error(`No articles found in RSS feed for category: ${category}`);
  }
  return articles;
}

export async function fetchCategoryFeed(category: string): Promise<NewsArticle[]> {
  if (!RSS_FEEDS[category]) {
    throw new Error(`Unknown category: ${category}. Valid categories: ${Object.keys(RSS_FEEDS).join(", ")}`);
  }

  const lastFetch = cache.categoryLastFetch.get(category) ?? 0;
  const fresh = Date.now() - lastFetch < CACHE_TTL_RSS;

  if (fresh) {
    const cached = [...cache.articles.values()].filter(a => a.category === category);
    if (cached.length > 0) return cached.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  const xml = await fetchWithRetry(RSS_FEEDS[category].url);
  const articles = parseRSSFeed(xml, category);

  for (const article of articles) {
    cache.articles.set(article.id, article);
  }
  cache.categoryLastFetch.set(category, Date.now());

  // Evict oldest articles if over the limit
  if (cache.articles.size > MAX_CACHED_ARTICLES) {
    const sorted = [...cache.articles.entries()]
      .sort(([, a], [, b]) => a.publishedAt.localeCompare(b.publishedAt));
    for (const [id] of sorted.slice(0, cache.articles.size - MAX_CACHED_ARTICLES)) {
      cache.articles.delete(id);
      cache.fullContent.delete(id);
      cache.articleFetchTime.delete(id);
    }
  }

  return articles;
}

export async function fetchArticleContent(urlOrId: string): Promise<ArticleDetail> {
  let url = urlOrId;
  let id = urlOrId;

  if (!urlOrId.startsWith("http")) {
    const cached = cache.articles.get(urlOrId);
    if (!cached) throw new Error(`Article ID ${urlOrId} not found in cache. Fetch category first.`);
    url = cached.url;
    id = urlOrId;
  } else {
    id = extractArticleId(urlOrId);
  }

  const cachedFull = cache.fullContent.get(id);
  const fetchTime = cache.articleFetchTime.get(id) ?? 0;
  if (cachedFull && Date.now() - fetchTime < CACHE_TTL_ARTICLE) {
    return cachedFull;
  }

  const baseArticle = cache.articles.get(id);

  try {
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);

    const title = $("h1.title-detail").first().text().trim()
      || $("h1").first().text().trim()
      || baseArticle?.title || "";

    const author = $("p.author_mail strong").first().text().trim()
      || $('p[style*="text-align:right"] strong').first().text().trim()
      || $(".author").first().text().trim();

    let content = "";
    const bodySelectors = [
      "article.fck_detail p.Normal",
      ".fck_detail p.Normal",
      ".fck_detail p",
      "article p",
    ];
    for (const sel of bodySelectors) {
      const paragraphs: string[] = [];
      $(sel).each((_i, el) => {
        const text = $(el).text().trim();
        if (text) paragraphs.push(text);
      });
      if (paragraphs.length > 0) {
        content = paragraphs.join("\n\n");
        break;
      }
    }

    if (!content && baseArticle) {
      content = `[Full content unavailable. Summary: ${baseArticle.summary}]`;
    }

    const detail: ArticleDetail = {
      ...(baseArticle ?? {
        id,
        title,
        summary: "",
        url,
        publishedAt: new Date().toISOString(),
        category: "unknown",
        categoryLabel: "Unknown",
      }),
      title,
      content,
      author: author || undefined,
    };

    cache.fullContent.set(id, detail);
    cache.articleFetchTime.set(id, Date.now());
    return detail;
  } catch (err) {
    if (baseArticle) {
      return {
        ...baseArticle,
        content: `[Could not fetch full article. Summary: ${baseArticle.summary}]`,
      };
    }
    throw err;
  }
}

export async function searchArticles(keyword: string, category?: string): Promise<NewsArticle[]> {
  if (cache.articles.size === 0) {
    await fetchCategoryFeed("tin-moi-nhat");
  }
  if (category) {
    const lastFetch = cache.categoryLastFetch.get(category) ?? 0;
    if (Date.now() - lastFetch >= CACHE_TTL_RSS) {
      await fetchCategoryFeed(category);
    }
  }

  const lower = keyword.toLowerCase();
  let articles = [...cache.articles.values()];
  if (category) articles = articles.filter(a => a.category === category);

  const scored = articles.map(a => {
    const titleLower = a.title.toLowerCase();
    const summaryLower = a.summary.toLowerCase();
    let score = 0;
    if (titleLower === lower) score = 3;
    else if (titleLower.includes(lower)) score = 2;
    else if (summaryLower.includes(lower)) score = 1;
    return { article: a, score };
  }).filter(x => x.score > 0);

  scored.sort((a, b) => b.score - a.score || b.article.publishedAt.localeCompare(a.article.publishedAt));
  return scored.slice(0, 20).map(x => x.article);
}

export async function getMultiCategoryOverview(
  categories: string[],
  limitPerCategory = 5
): Promise<Record<string, NewsArticle[]>> {
  const results = await Promise.allSettled(
    categories.map(cat => fetchCategoryFeed(cat))
  );

  const overview: Record<string, NewsArticle[]> = {};
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const result = results[i];
    if (result.status === "fulfilled") {
      overview[cat] = result.value.slice(0, limitPerCategory);
    } else {
      overview[cat] = [];
    }
  }
  return overview;
}
