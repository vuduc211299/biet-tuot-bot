import { isFresh, kbsHttp as http } from "../_shared/http.js";
import { fetchStockOHLCV, type OHLCVBar } from "./stock-market.js";

const BASE_IIS = "https://kbbuddywts.kbsec.com.vn/iis-server/investment";
const CACHE_TTL_ATHALT = 60 * 60 * 1000; // 1 hour

const N = (v: any): number => parseFloat(v ?? 0);

function toKBSDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

// ── Interfaces ───────────────────────────────────────────────────────────────

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

// ── Cache ────────────────────────────────────────────────────────────────────

const athAtlCache = new Map<string, { data: StockATHATL; timestamp: number }>();

// ── Technical Analysis (computed in-process from OHLCV) ──────────────────────

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

// ── ATH/ATL — fetches ALL available history from KBS (since HOSE inception 2000)

export async function fetchStockATHATL(symbol: string): Promise<StockATHATL | null> {
  const sym = symbol.toUpperCase();
  const cached = athAtlCache.get(sym);
  if (cached && isFresh(cached.timestamp, CACHE_TTL_ATHALT)) return cached.data;

  try {
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

    athAtlCache.set(sym, { data: result, timestamp: Date.now() });
    return result;
  } catch {
    return null;
  }
}
