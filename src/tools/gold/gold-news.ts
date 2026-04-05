import { http, isFresh } from "../_shared/http.js";

export interface GoldNewsItem {
  title: string;
  url: string;
  date: string;
  summary: string;
  thumb: string;
}

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const cache: { data: GoldNewsItem[] | null; timestamp: number } = {
  data: null,
  timestamp: 0,
};

function parseCafefDate(raw: string): string {
  // CafeF returns "/Date(1775358240000)/" format
  const match = raw.match(/\/Date\((\d+)\)\//);
  if (!match) return "";
  const d = new Date(Number(match[1]));
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function fetchGoldNews(limit = 10): Promise<GoldNewsItem[]> {
  if (cache.data && isFresh(cache.timestamp, CACHE_TTL)) return cache.data.slice(0, limit);

  const url = `https://cafef.vn/du-lieu/ajax/GoldNews/GoldRelNews.ashx?Type=NEWS&PageIndex=1&PageSize=20`;

  const res = await http.get(url, {
    headers: {
      Referer: "https://cafef.vn/du-lieu/gia-vang-hom-nay/trong-nuoc.chn",
    },
  });

  const body = res.data as { Data?: Array<{ Title: string; Link: string; Date: string; SubContent: string; Thumb: string }>; Success?: boolean };
  if (!body.Success || !Array.isArray(body.Data)) return [];

  const items: GoldNewsItem[] = body.Data.map((item) => {
    let link = item.Link ?? "";
    // Remove utm params
    link = link.split("?")[0];
    // Ensure full URL
    if (link && !link.startsWith("http")) {
      link = `https://cafef.vn${link.startsWith("/") ? "" : "/"}${link}`;
    }

    return {
      title: item.Title ?? "",
      url: link,
      date: parseCafefDate(item.Date ?? ""),
      summary: item.SubContent ?? "",
      thumb: item.Thumb ?? "",
    };
  }).filter((n) => n.title && n.url);

  cache.data = items;
  cache.timestamp = Date.now();
  return items.slice(0, limit);
}
