import { isFresh, coingeckoHttp as http } from "../_shared/http.js";

const BASE_URL = "https://api.coingecko.com/api/v3";
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

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

const cache = {
  prices: new Map<string, { data: CryptoPrice; timestamp: number }>(),
  topCoins: null as { data: CryptoPrice[]; timestamp: number } | null,
  globalData: null as { data: GlobalCryptoData; timestamp: number } | null,
  trending: null as { data: TrendingCoin[]; timestamp: number } | null,
};

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
    return !entry || !isFresh(entry.timestamp, CACHE_TTL);
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
  if (cache.topCoins && isFresh(cache.topCoins.timestamp, CACHE_TTL)) {
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
  if (cache.globalData && isFresh(cache.globalData.timestamp, CACHE_TTL)) {
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
  if (cache.trending && isFresh(cache.trending.timestamp, CACHE_TTL)) {
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
