import axios from "axios";

const BASE_IIS = "https://kbbuddywts.kbsec.com.vn/iis-server/investment";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL_REALTIME = 60 * 1000; // 1 minute for price board
const CACHE_TTL_PROFILE = 60 * 60 * 1000; // 1 hour for company profile

// KBS prices are in raw VND (e.g. 60600 = 60,600 VND). No division needed.
const N = (v: any): number => parseFloat(v ?? 0);

// Format Date as DD-MM-YYYY (KBS param format)
function toKBSDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

// ============================================================
// INTERFACES
// ============================================================

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

export interface TechnicalIndicators {
  symbol: string;
  period: number;
  latestClose: number;
  latestDate: string;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macd: {
    macdLine: number | null;
    signalLine: number | null;
    histogram: number | null;
  };
  ohlcv: OHLCVBar[];
}

export interface StockATHATL {
  ath: { price: number; date: string };
  atl: { price: number; date: string };
  dataRange: { from: string; to: string; bars: number };
}

// ============================================================
// CACHE
// ============================================================

const CACHE_TTL_ATHALT = 60 * 60 * 1000; // 1 hour — ATH/ATL rarely changes

const cache = {
  ohlcv: new Map<string, { data: OHLCVBar[]; timestamp: number }>(),
  index: new Map<string, { data: IndexBar[]; timestamp: number }>(),
  priceBoard: new Map<string, { data: PriceBoardEntry[]; timestamp: number }>(),
  profile: new Map<string, { data: CompanyProfile; timestamp: number }>(),
  athAtl: new Map<string, { data: StockATHATL; timestamp: number }>(),
  topVolume: null as { data: RankingEntry[]; timestamp: number } | null,
  foreignFlow: null as { data: { topBuy: RankingEntry[]; topSell: RankingEntry[] }; timestamp: number } | null,
};

const http = axios.create({
  timeout: 15000,
  headers: { "User-Agent": "McpNewsBot/1.0" },
});

function isFresh(timestamp: number, ttl = CACHE_TTL): boolean {
  return Date.now() - timestamp < ttl;
}

// ============================================================
// TECHNICAL ANALYSIS (computed in-process from OHLCV)
// ============================================================

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
  }
  return val;
}

function emaFull(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(val);
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
    result.push(val);
  }
  return result;
}

function rsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const last15 = closes.slice(-15);
  const changes = last15.slice(1).map((v, i) => v - last15[i]);
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? -c : 0));
  const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function computeTechnicals(symbol: string, ohlcv: OHLCVBar[]): TechnicalIndicators {
  const sorted = [...ohlcv].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map(b => b.close);
  const latest = sorted[sorted.length - 1] ?? { close: 0, date: "" };

  // MACD: need full EMA series of length >= 35 (26 + 9)
  let macdLine: number | null = null;
  let signalLine: number | null = null;
  let histogram: number | null = null;

  const ema26Full = emaFull(closes, 26);
  const ema12Full = emaFull(closes, 12);
  if (ema12Full.length > 0 && ema26Full.length > 0) {
    macdLine = ema12Full[ema12Full.length - 1] - ema26Full[ema26Full.length - 1];
    const offset = 26 - 12;
    const macdSeries = ema26Full.map((v26, i) => ema12Full[i + offset] - v26);
    if (macdSeries.length >= 9) {
      signalLine = ema(macdSeries, 9);
      if (signalLine !== null) histogram = macdLine - signalLine;
    }
  }

  return {
    symbol,
    period: sorted.length,
    latestClose: latest.close,
    latestDate: latest.date,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ema12: ema(closes, 12),
    ema26: ema(closes, 26),
    rsi14: rsi14(closes),
    macd: { macdLine, signalLine, histogram },
    ohlcv: sorted.slice(-30),
  };
}

// ============================================================
// ATH/ATL — fetches ALL available history from KBS (since HOSE inception 2000)
// ============================================================

export async function fetchStockATHATL(symbol: string): Promise<StockATHATL | null> {
  const sym = symbol.toUpperCase();
  const cached = cache.athAtl.get(sym);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_ATHALT)) return cached.data;

  try {
    // Fetch from 01-01-2000 (HOSE inception) to today — covers ALL VN stock history
    const edate = toKBSDate(new Date());
    const sdate = "01-01-2000";
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

    if (bars.length === 0) return null;

    const sorted = bars.sort((a, b) => a.date.localeCompare(b.date));
    let athBar = sorted[0];
    let atlBar = sorted[0];
    for (const bar of sorted) {
      if (bar.high > athBar.high) athBar = bar;
      if (bar.low > 0 && (bar.low < atlBar.low || atlBar.low === 0)) atlBar = bar;
    }

    const result: StockATHATL = {
      ath: { price: athBar.high, date: athBar.date },
      atl: { price: atlBar.low, date: atlBar.date },
      dataRange: { from: sorted[0].date, to: sorted[sorted.length - 1].date, bars: sorted.length },
    };

    cache.athAtl.set(sym, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    return null;
  }
}

// ============================================================
// KBS API FUNCTIONS
// ============================================================

export async function fetchStockOHLCV(symbol: string, days = 90): Promise<OHLCVBar[]> {
  const sym = symbol.toUpperCase();
  const key = `${sym}_${days}`;
  const cached = cache.ohlcv.get(key);
  if (cached && isFresh(cached.timestamp)) return cached.data;

  const edate = toKBSDate(new Date());
  const sdate = toKBSDate(new Date(Date.now() - days * 86400000));

  try {
    const res = await http.get(`${BASE_IIS}/stocks/${sym}/data_day`, {
      params: { sdate, edate },
    });
    // KBS nests OHLCV under "data_day" key: {symbol, data_day: [{t,o,h,l,c,v}]}
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
  if (cached && isFresh(cached.timestamp)) return cached.data;

  const edate = toKBSDate(new Date());
  const sdate = toKBSDate(new Date(Date.now() - days * 86400000));

  try {
    const res = await http.get(`${BASE_IIS}/index/${idx}/data_day`, {
      params: { sdate, edate },
    });
    // KBS nests index data under "data_day" key
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
    // KBS price board fields: SB/IN=symbol, CP=close/match price, OP=open, HI=high, LO=low,
    // CH=change, CHP=change%, TT=total volume, FB=foreign buy, FS=foreign sell,
    // CL=ceiling, FL=floor, RE=reference
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
    // KBS profile fields: SB=symbol, SM=summary(HTML), FD=founding date, LD=listed date,
    // EX=exchange, CC=chartered capital, VL=listed shares, FV=face value, LP=listed price
    const profile: CompanyProfile = {
      symbol: d.SB ?? sym,
      companyName: d.SB ?? sym, // KBS has no separate company name field
      exchange: d.EX ?? "",
      industry: "", // not available in KBS profile
      website: "", // not available in KBS profile
      address: "", // not available in KBS profile
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
  if (cache.topVolume && isFresh(cache.topVolume.timestamp)) {
    return cache.topVolume.data.slice(0, limit);
  }

  try {
    const res = await http.get(`${BASE_IIS}/rtranking/volume`);
    const raw = res.data?.data ?? res.data ?? [];
    // KBS ranking fields: sb=symbol(lowercase!), FMP=matched price, CH=change,
    // CHPE=change%, VAL=value, ORIGINAL_VAL=original value
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
  if (cache.foreignFlow && isFresh(cache.foreignFlow.timestamp)) {
    const { topBuy, topSell } = cache.foreignFlow.data;
    return { topBuy: topBuy.slice(0, limit), topSell: topSell.slice(0, limit) };
  }

  try {
    const res = await http.get(`${BASE_IIS}/rtranking/foreignTotal`);
    // KBS foreignTotal returns FLAT array: [{SB, CP, FB=foreign buy vol, FS=foreign sell vol, FT=total}]
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

export async function getVNStockOverview(): Promise<{
  topVolume: RankingEntry[];
  foreignFlow: { topBuy: RankingEntry[]; topSell: RankingEntry[] };
}> {
  const [topVolume, foreignFlow] = await Promise.all([
    fetchTopVolume(10),
    fetchForeignRanking(10),
  ]);
  return { topVolume, foreignFlow };
}

// Backward-compat aliases
export const fetchStockHistory = fetchStockOHLCV;
export const fetchStockPrice = (symbol: string) => fetchPriceBoard([symbol]).then(r => r[0] ?? null);
