import { isFresh, coingeckoHttp as http } from "../_shared/http.js";
import { fetchCryptoPrices, type CryptoPrice } from "./crypto-market.js";

const BASE_URL = "https://api.coingecko.com/api/v3";
const OHLC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface OHLCCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TechnicalAnalysis {
  coin_id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change: {
    h1: number | null;
    h24: number;
    d7: number | null;
    d30: number | null;
    y1: number | null;
  };
  ath: { price: number; change_pct: number; date: string };
  atl: { price: number; change_pct: number; date: string };
  supply: { circulating: number; total: number | null; max: number | null };
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

const ohlcCache = new Map<string, { data: OHLCCandle[]; days: number; timestamp: number }>();

// ── OHLC ─────────────────────────────────────────────────────────────────────

export async function fetchCoinOHLC(id: string, days = 365): Promise<OHLCCandle[]> {
  const cached = ohlcCache.get(id);
  if (cached && isFresh(cached.timestamp, OHLC_CACHE_TTL) && cached.days >= days) {
    return cached.data.slice(-days);
  }

  const fetchDays = Math.max(days, cached?.days ?? 0);
  const res = await http.get(`${BASE_URL}/coins/${id}/ohlc`, {
    params: { vs_currency: "usd", days: fetchDays },
  });

  const candles: OHLCCandle[] = (res.data ?? []).map(
    (item: [number, number, number, number, number]) => ({
      timestamp: item[0],
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
    })
  );

  ohlcCache.set(id, { data: candles, days: fetchDays, timestamp: Date.now() });
  return candles.slice(-days);
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

// ── Public API ────────────────────────────────────────────────────────────────

export async function getCryptoTechnical(id: string): Promise<TechnicalAnalysis> {
  const cleanId = id.trim().toLowerCase();
  const [prices, candles] = await Promise.all([
    fetchCryptoPrices([cleanId]),
    fetchCoinOHLC(cleanId, 365),
  ]);

  const price = prices[0];
  const closes = candles.map(c => c.close);
  const indicators: TechnicalAnalysis["indicators"] = {
    rsi_14: calculateRSI(closes),
    sma_50: calculateSMA(closes, 50),
    sma_200: calculateSMA(closes, 200),
    ema_12: calculateEMA(closes, 12),
    ema_26: calculateEMA(closes, 26),
    macd: calculateMACD(closes),
  };

  if (!price) {
    return {
      coin_id: cleanId,
      symbol: "",
      name: cleanId,
      current_price: 0,
      price_change: { h1: null, h24: 0, d7: null, d30: null, y1: null },
      ath: { price: 0, change_pct: 0, date: "" },
      atl: { price: 0, change_pct: 0, date: "" },
      supply: { circulating: 0, total: null, max: null },
      indicators,
      ohlc_days: closes.length,
    };
  }

  return {
    coin_id: price.id,
    symbol: price.symbol.toUpperCase(),
    name: price.name,
    current_price: price.current_price,
    price_change: {
      h1: price.price_change_percentage_1h,
      h24: price.price_change_percentage_24h,
      d7: price.price_change_percentage_7d,
      d30: price.price_change_percentage_30d,
      y1: price.price_change_percentage_1y,
    },
    ath: {
      price: price.ath,
      change_pct: price.ath_change_percentage,
      date: price.ath_date,
    },
    atl: {
      price: price.atl,
      change_pct: price.atl_change_percentage,
      date: price.atl_date,
    },
    supply: {
      circulating: price.circulating_supply,
      total: price.total_supply,
      max: price.max_supply,
    },
    indicators,
    ohlc_days: closes.length,
  };
}
