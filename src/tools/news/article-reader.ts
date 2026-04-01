import * as cheerio from "cheerio";
import { isFresh } from "../_shared/http.js";
import { http as sharedHttp } from "../_shared/http.js";

export interface CafefArticleDetail {
  title: string;
  content: string;
  url: string;
  date: string;
  author?: string;
}

const CACHE_TTL_ARTICLE = 60 * 60 * 1000; // 1 hour

const articleCache = new Map<string, { data: CafefArticleDetail; timestamp: number }>();

export async function fetchCafefArticleContent(articleUrl: string): Promise<CafefArticleDetail> {
  const cached = articleCache.get(articleUrl);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_ARTICLE)) return cached.data;

  const res = await sharedHttp.get(articleUrl);
  const $ = cheerio.load(res.data as string);

  const title = $("h1.title").first().text().trim()
    || $("h1").first().text().trim();

  const date = $(".datemark, .pdate, .time, .date-post, [class*='time']").first().text().trim();

  const author = $(".author, .source, [class*='author']").first().text().trim();

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
