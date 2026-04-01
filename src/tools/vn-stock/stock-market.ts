import axios from "axios";
import * as cheerio from "cheerio";
import { isFresh } from "../_shared/http.js";

const BASE_IIS = "https://kbbuddywts.kbsec.com.vn/iis-server/investment";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL_REALTIME = 60 * 1000; // 1 minute for price board
const CACHE_TTL_PROFILE = 60 * 60 * 1000; // 1 hour for company profile
const CACHE_TTL_RATIOS = 30 * 60 * 1000; // 30 minutes

const N = (v: any): number => parseFloat(v ?? 0);

function toKBSDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndexBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceBoardEntry {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePercent: number;
  volume: number;
  foreignBuy: number;
  foreignSell: number;
  ceiling: number;
  floor: number;
  ref: number;
}

export interface CompanyProfile {
  symbol: string;
  companyName: string;
  exchange: string;
  industry: string;
  website: string;
  address: string;
  description: string;
  listedDate: string;
  listedShares: number;
  charteredCapital: number;
}

export interface RankingEntry {
  symbol: string;
  value: number;
  price: number;
  changePercent: number;
}

export interface FinancialRatios {
  symbol: string;
  eps: number | null;
  pe: number | null;
  pb: number | null;
  marketCap: number | null;
  priceClose: number | null;
  bookValue: number | null;
}

// ── Cache ────────────────────────────────────────────────────────────────────

const cache = {
  ohlcv: new Map<string, { data: OHLCVBar[]; timestamp: number }>(),
  index: new Map<string, { data: IndexBar[]; timestamp: number }>(),
  priceBoard: new Map<string, { data: PriceBoardEntry[]; timestamp: number }>(),
  profile: new Map<string, { data: CompanyProfile; timestamp: number }>(),
  topVolume: null as { data: RankingEntry[]; timestamp: number } | null,
  foreignFlow: null as { data: { topBuy: RankingEntry[]; topSell: RankingEntry[] }; timestamp: number } | null,
  ratios: new Map<string, { data: FinancialRatios; timestamp: number }>(),
};

const http = axios.create({
  timeout: 15000,
  headers: { "User-Agent": "McpNewsBot/1.0" },
});

const httpCafef = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
  },
});

// ── KBS API Functions ────────────────────────────────────────────────────────

export async function fetchStockOHLCV(symbol: string, days = 90): Promise<OHLCVBar[]> {
  const sym = symbol.toUpperCase();
  const key = `${sym}_${days}`;
  const cached = cache.ohlcv.get(key);
  if (cached && isFresh(cached.timestamp, CACHE_TTL)) return cached.data;

  const edate = toKBSDate(new Date());
  const sdate = toKBSDate(new Date(Date.now() - days * 86400000));

  try {
    const res = await http.get(`${BASE_IIS}/stocks/${sym}/data_day`, {
      params: { sdate, edate },
    });
    const raw = res.data?.data_day ?? res.data?.data ?? res.data ?? [];
    const bars: OHLCVBar[] = (Array.isArray(raw) ? raw : []).map((item: any) => ({
      date: String(item.t ?? "").split(" ")[0],
      open: N(item.o),
      high: N(item.h),
      low: N(item.l),
      close: N(item.c),
      volume: N(item.v),
    })).filter((b: OHLCVBar) => b.date && b.close > 0);

    if (bars.length > 0) cache.ohlcv.set(key, { data: bars, timestamp: Date.now() });
    return bars;
  } catch {
    return [];
  }
}

export async function fetchIndexData(index: string, days = 30): Promise<IndexBar[]> {
  const idx = index.toUpperCase();
  const key = `${idx}_${days}`;
  const cached = cache.index.get(key);
  if (cached && isFresh(cached.timestamp, CACHE_TTL)) return cached.data;

  const edate = toKBSDate(new Date());
  const sdate = toKBSDate(new Date(Date.now() - days * 86400000));

  try {
    const res = await http.get(`${BASE_IIS}/index/${idx}/data_day`, {
      params: { sdate, edate },
    });
    const raw = res.data?.data_day ?? res.data?.data ?? res.data ?? [];
    const bars: IndexBar[] = (Array.isArray(raw) ? raw : []).map((item: any) => ({
      date: String(item.t ?? "").split(" ")[0],
      open: N(item.o),
      high: N(item.h),
      low: N(item.l),
      close: N(item.c),
      volume: N(item.v),
    })).filter((b: IndexBar) => b.date && b.close > 0);

    if (bars.length > 0) cache.index.set(key, { data: bars, timestamp: Date.now() });
    return bars;
  } catch {
    return [];
  }
}

export async function fetchPriceBoard(symbols: string[]): Promise<PriceBoardEntry[]> {
  const syms = symbols.map(s => s.toUpperCase());
  const key = [...syms].sort().join(",");
  const cached = cache.priceBoard.get(key);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_REALTIME)) return cached.data;

  try {
    const res = await http.post(`${BASE_IIS}/stock/iss`, { code: syms.join(",") });
    const raw = res.data?.data ?? res.data ?? [];
    const entries: PriceBoardEntry[] = (Array.isArray(raw) ? raw : []).map((item: any) => ({
      symbol: item.SB ?? item.IN ?? "",
      price: N(item.CP),
      open: N(item.OP),
      high: N(item.HI),
      low: N(item.LO),
      change: N(item.CH),
      changePercent: N(item.CHP),
      volume: N(item.TT),
      foreignBuy: N(item.FB),
      foreignSell: N(item.FS),
      ceiling: N(item.CL),
      floor: N(item.FL),
      ref: N(item.RE),
    })).filter((e: PriceBoardEntry) => e.symbol);

    if (entries.length > 0) cache.priceBoard.set(key, { data: entries, timestamp: Date.now() });
    return entries;
  } catch {
    return [];
  }
}

export async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const sym = symbol.toUpperCase();
  const cached = cache.profile.get(sym);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_PROFILE)) return cached.data;

  try {
    const res = await http.get(`${BASE_IIS}/stockinfo/profile/${sym}`, { params: { l: 1 } });
    const d = res.data?.data ?? res.data ?? {};
    const profile: CompanyProfile = {
      symbol: d.SB ?? sym,
      companyName: d.SB ?? sym,
      exchange: d.EX ?? "",
      industry: "",
      website: "",
      address: "",
      description: (d.SM ?? "").replace(/<[^>]*>/g, "").trim(),
      listedDate: d.LD ?? "",
      listedShares: N(d.VL),
      charteredCapital: N(d.CC),
    };
    cache.profile.set(sym, { data: profile, timestamp: Date.now() });
    return profile;
  } catch {
    return null;
  }
}

export async function fetchTopVolume(limit = 10): Promise<RankingEntry[]> {
  if (cache.topVolume && isFresh(cache.topVolume.timestamp, CACHE_TTL)) {
    return cache.topVolume.data.slice(0, limit);
  }

  try {
    const res = await http.get(`${BASE_IIS}/rtranking/volume`);
    const raw = res.data?.data ?? res.data ?? [];
    const stocks: RankingEntry[] = (Array.isArray(raw) ? raw : []).map((item: any) => ({
      symbol: String(item.sb ?? item.SB ?? "").toUpperCase(),
      value: N(item.ORIGINAL_VAL ?? item.VAL),
      price: N(item.FMP),
      changePercent: N(item.CHPE),
    })).filter((s: RankingEntry) => s.symbol);

    cache.topVolume = { data: stocks, timestamp: Date.now() };
    return stocks.slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchForeignRanking(limit = 10): Promise<{ topBuy: RankingEntry[]; topSell: RankingEntry[] }> {
  if (cache.foreignFlow && isFresh(cache.foreignFlow.timestamp, CACHE_TTL)) {
    const { topBuy, topSell } = cache.foreignFlow.data;
    return { topBuy: topBuy.slice(0, limit), topSell: topSell.slice(0, limit) };
  }

  try {
    const res = await http.get(`${BASE_IIS}/rtranking/foreignTotal`);
    const raw = res.data?.data ?? res.data ?? [];
    const all = (Array.isArray(raw) ? raw : []).map((item: any) => ({
      symbol: String(item.SB ?? "").toUpperCase(),
      price: N(item.CP),
      foreignBuy: N(item.FB),
      foreignSell: N(item.FS),
      foreignTotal: N(item.FT),
    })).filter((x: any) => x.symbol);

    const topBuy: RankingEntry[] = [...all]
      .sort((a, b) => b.foreignBuy - a.foreignBuy)
      .slice(0, limit)
      .map(x => ({ symbol: x.symbol, value: x.foreignBuy, price: x.price, changePercent: 0 }));

    const topSell: RankingEntry[] = [...all]
      .sort((a, b) => b.foreignSell - a.foreignSell)
      .slice(0, limit)
      .map(x => ({ symbol: x.symbol, value: x.foreignSell, price: x.price, changePercent: 0 }));

    cache.foreignFlow = { data: { topBuy, topSell }, timestamp: Date.now() };
    return { topBuy, topSell };
  } catch {
    return { topBuy: [], topSell: [] };
  }
}

// ── CafeF Financial Ratios ──────────────────────────────────────────────────

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

  const urls = [
    `https://cafef.vn/thi-truong-chung-khoan/co-phieu/${sym.toLowerCase()}-28.chn`,
    `https://cafef.vn/du-lieu/hose/${sym.toLowerCase()}.chn`,
    `https://cafef.vn/co-phieu/${sym.toLowerCase()}-28.chn`,
  ];

  for (const url of urls) {
    try {
      const res = await httpCafef.get(url);
      const $ = cheerio.load(res.data as string);
      const ratios: FinancialRatios = { ...empty };

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

      $("[class*='eps'], [class*='pe-'], [class*='pb-'], [id*='eps'], [id*='pe'], [id*='pb']").each((_, el) => {
        const cls = ($(el).attr("class") ?? "") + ($(el).attr("id") ?? "");
        const val = parseFloat($(el).text().replace(/[,\s]/g, "")) || null;
        if (/\beps\b/.test(cls)) ratios.eps = ratios.eps ?? val;
        else if (/\bp[\-_]?e\b/.test(cls)) ratios.pe = ratios.pe ?? val;
        else if (/\bp[\-_]?b\b/.test(cls)) ratios.pb = ratios.pb ?? val;
      });

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

// Backward-compat aliases
export const fetchStockHistory = fetchStockOHLCV;
export const fetchStockPrice = (symbol: string) => fetchPriceBoard([symbol]).then(r => r[0] ?? null);
