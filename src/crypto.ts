import axios from "axios";

const BASE_URL = "https://api.coingecko.com/api/v3";
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes
const OHLC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY?.trim();

export interface CryptoPrice {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  price_change_percentage_1h: number | null;
  price_change_percentage_7d: number | null;
  price_change_percentage_30d: number | null;
  price_change_percentage_1y: number | null;
  market_cap: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  ath: number;
  ath_change_percentage: number;
  ath_date: string;
  atl: number;
  atl_change_percentage: number;
  atl_date: string;
  circulating_supply: number;
  total_supply: number | null;
  max_supply: number | null;
}

export interface GlobalCryptoData {
  total_market_cap_usd: number;
  total_volume_24h_usd: number;
  btc_dominance: number;
  market_cap_change_percentage_24h: number;
  active_cryptocurrencies: number;
}

export interface TrendingCoin {
  name: string;
  symbol: string;
  market_cap_rank: number;
  price_btc: number;
}

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

const cache = {
  prices: new Map<string, { data: CryptoPrice; timestamp: number }>(),
  topCoins: null as { data: CryptoPrice[]; timestamp: number } | null,
  globalData: null as { data: GlobalCryptoData; timestamp: number } | null,
  trending: null as { data: TrendingCoin[]; timestamp: number } | null,
  ohlc: new Map<string, { data: OHLCCandle[]; timestamp: number }>(),
};

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "McpNewsBot/1.0",
    ...(COINGECKO_API_KEY ? { "x-cg-demo-api-key": COINGECKO_API_KEY } : {}),
  },
});

function isFresh(timestamp: number, ttl = CACHE_TTL): boolean {
  return Date.now() - timestamp < ttl;
}

function mapCoin(coin: any): CryptoPrice {
  return {
    id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    current_price: coin.current_price ?? 0,
    price_change_24h: coin.price_change_24h ?? 0,
    price_change_percentage_24h: coin.price_change_percentage_24h ?? 0,
    price_change_percentage_1h: coin.price_change_percentage_1h_in_currency ?? null,
    price_change_percentage_7d: coin.price_change_percentage_7d_in_currency ?? null,
    price_change_percentage_30d: coin.price_change_percentage_30d_in_currency ?? null,
    price_change_percentage_1y: coin.price_change_percentage_1y_in_currency ?? null,
    market_cap: coin.market_cap ?? 0,
    total_volume: coin.total_volume ?? 0,
    high_24h: coin.high_24h ?? 0,
    low_24h: coin.low_24h ?? 0,
    ath: coin.ath ?? 0,
    ath_change_percentage: coin.ath_change_percentage ?? 0,
    ath_date: coin.ath_date ?? "",
    atl: coin.atl ?? 0,
    atl_change_percentage: coin.atl_change_percentage ?? 0,
    atl_date: coin.atl_date ?? "",
    circulating_supply: coin.circulating_supply ?? 0,
    total_supply: coin.total_supply ?? null,
    max_supply: coin.max_supply ?? null,
  };
}

export async function fetchCryptoPrices(ids: string[]): Promise<CryptoPrice[]> {
  const cleanIds = ids.map(id => id.trim().toLowerCase()).filter(Boolean);
  if (cleanIds.length === 0) return [];

  const uncached = cleanIds.filter(id => {
    const entry = cache.prices.get(id);
    return !entry || !isFresh(entry.timestamp);
  });

  if (uncached.length > 0) {
    const res = await http.get(`${BASE_URL}/coins/markets`, {
      params: {
        vs_currency: "usd",
        ids: uncached.join(","),
        order: "market_cap_desc",
        per_page: uncached.length,
        page: 1,
        sparkline: false,
        price_change_percentage: "1h,7d,14d,30d,200d,1y",
      },
    });
    for (const coin of res.data) {
      cache.prices.set(coin.id, { data: mapCoin(coin), timestamp: Date.now() });
    }
  }

  return cleanIds
    .map(id => cache.prices.get(id)?.data)
    .filter(Boolean) as CryptoPrice[];
}

export async function fetchTopCoins(limit = 10): Promise<CryptoPrice[]> {
  if (cache.topCoins && isFresh(cache.topCoins.timestamp)) {
    return cache.topCoins.data.slice(0, limit);
  }

  const res = await http.get(`${BASE_URL}/coins/markets`, {
    params: {
      vs_currency: "usd",
      order: "market_cap_desc",
      per_page: Math.min(limit, 50),
      page: 1,
      sparkline: false,
      price_change_percentage: "1h,7d,14d,30d,200d,1y",
    },
  });

  const coins: CryptoPrice[] = res.data.map(mapCoin);

  cache.topCoins = { data: coins, timestamp: Date.now() };
  return coins.slice(0, limit);
}

export async function fetchGlobalData(): Promise<GlobalCryptoData> {
  if (cache.globalData && isFresh(cache.globalData.timestamp)) {
    return cache.globalData.data;
  }

  const res = await http.get(`${BASE_URL}/global`);
  const d = res.data.data;

  const global: GlobalCryptoData = {
    total_market_cap_usd: d.total_market_cap?.usd ?? 0,
    total_volume_24h_usd: d.total_volume?.usd ?? 0,
    btc_dominance: d.market_cap_percentage?.btc ?? 0,
    market_cap_change_percentage_24h: d.market_cap_change_percentage_24h_usd ?? 0,
    active_cryptocurrencies: d.active_cryptocurrencies ?? 0,
  };

  cache.globalData = { data: global, timestamp: Date.now() };
  return global;
}

export async function fetchTrending(): Promise<TrendingCoin[]> {
  if (cache.trending && isFresh(cache.trending.timestamp)) {
    return cache.trending.data;
  }

  const res = await http.get(`${BASE_URL}/search/trending`);
  const coins: TrendingCoin[] = (res.data.coins ?? []).map((item: any) => ({
    name: item.item.name,
    symbol: item.item.symbol,
    market_cap_rank: item.item.market_cap_rank ?? 0,
    price_btc: item.item.price_btc ?? 0,
  }));

  cache.trending = { data: coins, timestamp: Date.now() };
  return coins;
}

export async function getCryptoOverview(): Promise<{
  global: GlobalCryptoData;
  topCoins: CryptoPrice[];
  trending: TrendingCoin[];
}> {
  const [global, topCoins, trending] = await Promise.all([
    fetchGlobalData(),
    fetchTopCoins(10),
    fetchTrending(),
  ]);
  return { global, topCoins, trending };
}

// ── OHLC ─────────────────────────────────────────────────────────────────────

export async function fetchCoinOHLC(id: string, days = 365): Promise<OHLCCandle[]> {
  const key = `${id}_${days}`;
  const cached = cache.ohlc.get(key);
  if (cached && isFresh(cached.timestamp, OHLC_CACHE_TTL)) return cached.data;

  const res = await http.get(`${BASE_URL}/coins/${id}/ohlc`, {
    params: { vs_currency: "usd", days },
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

  cache.ohlc.set(key, { data: candles, timestamp: Date.now() });
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

  // EMA-12 series: ema12Series[j] = EMA-12 at closes[11 + j]
  let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  const ema12Series: number[] = [e12];
  for (let i = 12; i < closes.length; i++) {
    e12 = closes[i] * k12 + e12 * (1 - k12);
    ema12Series.push(e12);
  }

  // EMA-26 series: ema26Series[j] = EMA-26 at closes[25 + j]
  let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  const ema26Series: number[] = [e26];
  for (let i = 26; i < closes.length; i++) {
    e26 = closes[i] * k26 + e26 * (1 - k26);
    ema26Series.push(e26);
  }

  // MACD line: macdLine[j] = ema12Series[14+j] - ema26Series[j]
  const macdLine: number[] = [];
  for (let j = 0; j < ema26Series.length; j++) {
    macdLine.push(ema12Series[14 + j] - ema26Series[j]);
  }
  if (macdLine.length < 9) return null;

  // Signal = EMA-9 of MACD line
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
