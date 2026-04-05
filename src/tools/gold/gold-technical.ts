import { isFresh } from "../_shared/http.js";
import axios from "axios";

// Yahoo Finance for gold futures (GC=F) — free, no API key
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const GOLD_SYMBOL = "GC=F";
const OHLC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const yahooHttp = axios.create({
  timeout: 15000,
  headers: { "User-Agent": "McpNewsBot/1.0" },
});

export interface GoldOHLC {
  timestamp: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GoldTechnicalAnalysis {
  symbol: string;
  name: string;
  currency: string;
  current_price: number;
  previous_close: number;
  price_change: {
    d1_pct: number;
    d7_pct: number | null;
    d30_pct: number | null;
    y1_pct: number | null;
  };
  ath: { price: number; date: string } | null;
  atl: { price: number; date: string } | null;
  indicators: {
    rsi_14: number | null;
    sma_50: number | null;
    sma_200: number | null;
    ema_12: number | null;
    ema_26: number | null;
    macd: { macd_line: number; signal_line: number; histogram: number } | null;
  };
  ohlc_days: number;
}

const cache: { data: GoldOHLC[] | null; timestamp: number } = {
  data: null,
  timestamp: 0,
};

// ── OHLC from Yahoo Finance ──────────────────────────────────────────────────

export async function fetchGoldOHLC(): Promise<GoldOHLC[]> {
  if (cache.data && isFresh(cache.timestamp, OHLC_CACHE_TTL)) return cache.data;

  const res = await yahooHttp.get(`${YAHOO_BASE}/${GOLD_SYMBOL}`, {
    params: { range: "10y", interval: "1d" },
  });

  const chart = (res.data as {
    chart: {
      result: Array<{
        timestamp: number[];
        indicators: { quote: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }> };
      }>
    }
  }).chart.result[0];

  const timestamps = chart.timestamp ?? [];
  const quote = chart.indicators.quote[0];

  const candles: GoldOHLC[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open[i];
    const h = quote.high[i];
    const l = quote.low[i];
    const c = quote.close[i];
    if (o == null || h == null || l == null || c == null) continue;

    const d = new Date(timestamps[i] * 1000);
    candles.push({
      timestamp: timestamps[i] * 1000,
      date: d.toISOString().slice(0, 10),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: quote.volume[i] ?? 0,
    });
  }

  cache.data = candles;
  cache.timestamp = Date.now();
  return candles;
}

// ── Technical Indicator Calculations ─────────────────────────────────────────

function calculateRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

function calculateSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(2));
}

function calculateEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return parseFloat(ema.toFixed(2));
}

function calculateMACD(
  closes: number[]
): { macd_line: number; signal_line: number; histogram: number } | null {
  if (closes.length < 35) return null;

  const k12 = 2 / 13;
  const k26 = 2 / 27;
  const k9 = 2 / 10;

  let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  const ema12Series: number[] = [e12];
  for (let i = 12; i < closes.length; i++) {
    e12 = closes[i] * k12 + e12 * (1 - k12);
    ema12Series.push(e12);
  }

  let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  const ema26Series: number[] = [e26];
  for (let i = 26; i < closes.length; i++) {
    e26 = closes[i] * k26 + e26 * (1 - k26);
    ema26Series.push(e26);
  }

  const macdLine: number[] = [];
  for (let j = 0; j < ema26Series.length; j++) {
    macdLine.push(ema12Series[14 + j] - ema26Series[j]);
  }
  if (macdLine.length < 9) return null;

  let signal = macdLine.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
  for (let i = 9; i < macdLine.length; i++) signal = macdLine[i] * k9 + signal * (1 - k9);

  const last = macdLine[macdLine.length - 1];
  return {
    macd_line: parseFloat(last.toFixed(4)),
    signal_line: parseFloat(signal.toFixed(4)),
    histogram: parseFloat((last - signal).toFixed(4)),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getGoldTechnical(): Promise<GoldTechnicalAnalysis> {
  const candles = await fetchGoldOHLC();
  const closes = candles.map((c) => c.close);

  const current = closes.length > 0 ? closes[closes.length - 1] : 0;
  const prevClose = closes.length > 1 ? closes[closes.length - 2] : current;

  // Price changes
  const pctChange = (now: number, then: number) =>
    then > 0 ? parseFloat(((now - then) / then * 100).toFixed(2)) : null;

  const d1Pct = prevClose > 0 ? parseFloat(((current - prevClose) / prevClose * 100).toFixed(2)) : 0;
  const d7Pct = closes.length >= 7 ? pctChange(current, closes[closes.length - 7]) : null;
  const d30Pct = closes.length >= 30 ? pctChange(current, closes[closes.length - 30]) : null;
  const y1Pct = closes.length >= 252 ? pctChange(current, closes[closes.length - 252]) : null;

  // ATH / ATL from available data
  let ath: GoldTechnicalAnalysis["ath"] = null;
  let atl: GoldTechnicalAnalysis["atl"] = null;
  if (candles.length > 0) {
    let maxPrice = -Infinity;
    let minPrice = Infinity;
    let maxIdx = 0;
    let minIdx = 0;
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].high > maxPrice) { maxPrice = candles[i].high; maxIdx = i; }
      if (candles[i].low < minPrice) { minPrice = candles[i].low; minIdx = i; }
    }
    ath = { price: parseFloat(maxPrice.toFixed(2)), date: candles[maxIdx].date };
    atl = { price: parseFloat(minPrice.toFixed(2)), date: candles[minIdx].date };
  }

  return {
    symbol: "XAU/USD",
    name: "Gold Futures (GC=F)",
    currency: "USD",
    current_price: parseFloat(current.toFixed(2)),
    previous_close: parseFloat(prevClose.toFixed(2)),
    price_change: { d1_pct: d1Pct, d7_pct: d7Pct, d30_pct: d30Pct, y1_pct: y1Pct },
    ath,
    atl,
    indicators: {
      rsi_14: calculateRSI(closes),
      sma_50: calculateSMA(closes, 50),
      sma_200: calculateSMA(closes, 200),
      ema_12: calculateEMA(closes, 12),
      ema_26: calculateEMA(closes, 26),
      macd: calculateMACD(closes),
    },
    ohlc_days: closes.length,
  };
}
