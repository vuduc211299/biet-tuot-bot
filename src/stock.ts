import axios from "axios";

const BASE_IIS = "https://kbbuddywts.kbsec.com.vn/iis-server";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface MarketIndex {
  indexName: string;
  indexValue: number;
  change: number;
  changePercent: number;
  totalVolume: number;
  totalValue: number;
}

export interface StockPrice {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  foreignBuy: number;
  foreignSell: number;
}

export interface TopStock {
  symbol: string;
  volume: number;
  price: number;
  changePercent: number;
}

export interface ForeignFlow {
  buyValue: number;
  sellValue: number;
  netValue: number;
  topBuy: Array<{ symbol: string; value: number }>;
  topSell: Array<{ symbol: string; value: number }>;
}

export interface StockHistory {
  date: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

const cache = {
  indices: null as { data: MarketIndex[]; timestamp: number } | null,
  stockPrices: new Map<string, { data: StockPrice; timestamp: number }>(),
  topVolume: null as { data: TopStock[]; timestamp: number } | null,
  foreignFlow: null as { data: ForeignFlow; timestamp: number } | null,
  history: new Map<string, { data: StockHistory[]; timestamp: number }>(),
};

const http = axios.create({
  timeout: 15000,
  headers: { "User-Agent": "McpNewsBot/1.0" },
});

function isFresh(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_TTL;
}

export async function fetchMarketIndices(): Promise<MarketIndex[]> {
  if (cache.indices && isFresh(cache.indices.timestamp)) {
    return cache.indices.data;
  }

  try {
    const res = await http.get(`${BASE_IIS}/investment/index`);
    const data = res.data?.data ?? res.data ?? [];
    const indices: MarketIndex[] = (Array.isArray(data) ? data : []).map((item: any) => ({
      indexName: item.indexName ?? item.IndexName ?? item.index_name ?? "",
      indexValue: parseFloat(item.indexValue ?? item.IndexValue ?? item.index_value ?? 0),
      change: parseFloat(item.change ?? item.Change ?? 0),
      changePercent: parseFloat(item.changePercent ?? item.ChangePercent ?? item.change_percent ?? 0),
      totalVolume: parseFloat(item.totalVolume ?? item.TotalVolume ?? item.total_volume ?? 0),
      totalValue: parseFloat(item.totalValue ?? item.TotalValue ?? item.total_value ?? 0),
    })).filter((idx: MarketIndex) => idx.indexName);

    if (indices.length > 0) {
      cache.indices = { data: indices, timestamp: Date.now() };
    }
    return indices;
  } catch {
    return [
      { indexName: "VNINDEX", indexValue: 0, change: 0, changePercent: 0, totalVolume: 0, totalValue: 0 },
      { indexName: "HNX", indexValue: 0, change: 0, changePercent: 0, totalVolume: 0, totalValue: 0 },
    ];
  }
}

export async function fetchStockPrice(symbol: string): Promise<StockPrice> {
  const sym = symbol.toUpperCase();
  const cached = cache.stockPrices.get(sym);
  if (cached && isFresh(cached.timestamp)) return cached.data;

  try {
    const res = await http.get(`${BASE_IIS}/investment/stock`, {
      params: { symbol: sym },
    });
    const item = res.data?.data ?? res.data ?? {};

    const price: StockPrice = {
      symbol: sym,
      price: parseFloat(item.price ?? item.Price ?? item.close ?? 0),
      change: parseFloat(item.change ?? item.Change ?? 0),
      changePercent: parseFloat(item.changePercent ?? item.ChangePercent ?? item.change_percent ?? 0),
      volume: parseFloat(item.volume ?? item.Volume ?? 0),
      high: parseFloat(item.high ?? item.High ?? 0),
      low: parseFloat(item.low ?? item.Low ?? 0),
      foreignBuy: parseFloat(item.foreignBuy ?? item.ForeignBuy ?? 0),
      foreignSell: parseFloat(item.foreignSell ?? item.ForeignSell ?? 0),
    };

    cache.stockPrices.set(sym, { data: price, timestamp: Date.now() });
    return price;
  } catch {
    return { symbol: sym, price: 0, change: 0, changePercent: 0, volume: 0, high: 0, low: 0, foreignBuy: 0, foreignSell: 0 };
  }
}

export async function fetchTopVolume(limit = 10): Promise<TopStock[]> {
  if (cache.topVolume && isFresh(cache.topVolume.timestamp)) {
    return cache.topVolume.data.slice(0, limit);
  }

  try {
    const res = await http.get(`${BASE_IIS}/investment/stock`, {
      params: { type: "top_volume", limit },
    });
    const data = res.data?.data ?? res.data ?? [];
    const stocks: TopStock[] = (Array.isArray(data) ? data : []).map((item: any) => ({
      symbol: item.symbol ?? item.Symbol ?? "",
      volume: parseFloat(item.volume ?? item.Volume ?? 0),
      price: parseFloat(item.price ?? item.Price ?? 0),
      changePercent: parseFloat(item.changePercent ?? item.ChangePercent ?? 0),
    })).filter((s: TopStock) => s.symbol);

    cache.topVolume = { data: stocks, timestamp: Date.now() };
    return stocks.slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchForeignFlow(): Promise<ForeignFlow> {
  if (cache.foreignFlow && isFresh(cache.foreignFlow.timestamp)) {
    return cache.foreignFlow.data;
  }

  try {
    const res = await http.get(`${BASE_IIS}/investment/stock`, {
      params: { type: "foreign_flow" },
    });
    const d = res.data?.data ?? res.data ?? {};

    const flow: ForeignFlow = {
      buyValue: parseFloat(d.buyValue ?? d.buy_value ?? 0),
      sellValue: parseFloat(d.sellValue ?? d.sell_value ?? 0),
      netValue: parseFloat(d.netValue ?? d.net_value ?? 0),
      topBuy: (d.topBuy ?? d.top_buy ?? []).slice(0, 5).map((x: any) => ({ symbol: x.symbol ?? "", value: parseFloat(x.value ?? 0) })),
      topSell: (d.topSell ?? d.top_sell ?? []).slice(0, 5).map((x: any) => ({ symbol: x.symbol ?? "", value: parseFloat(x.value ?? 0) })),
    };

    cache.foreignFlow = { data: flow, timestamp: Date.now() };
    return flow;
  } catch {
    return { buyValue: 0, sellValue: 0, netValue: 0, topBuy: [], topSell: [] };
  }
}

export async function fetchStockHistory(symbol: string, days = 30): Promise<StockHistory[]> {
  const sym = symbol.toUpperCase();
  const key = `${sym}_${days}`;
  const cached = cache.history.get(key);
  if (cached && isFresh(cached.timestamp)) return cached.data;

  try {
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

    const res = await http.get(`${BASE_IIS}/sas/historical`, {
      params: { symbol: sym, from: startDate, to: endDate },
    });
    const data = res.data?.data ?? res.data ?? [];
    const history: StockHistory[] = (Array.isArray(data) ? data : []).map((item: any) => ({
      date: item.date ?? item.Date ?? item.trading_date ?? "",
      close: parseFloat(item.close ?? item.Close ?? item.closePrice ?? 0),
      open: parseFloat(item.open ?? item.Open ?? item.openPrice ?? 0),
      high: parseFloat(item.high ?? item.High ?? item.highPrice ?? 0),
      low: parseFloat(item.low ?? item.Low ?? item.lowPrice ?? 0),
      volume: parseFloat(item.volume ?? item.Volume ?? 0),
    })).filter((h: StockHistory) => h.date);

    cache.history.set(key, { data: history, timestamp: Date.now() });
    return history;
  } catch {
    return [];
  }
}

export async function getVNStockOverview(): Promise<{
  indices: MarketIndex[];
  topVolume: TopStock[];
  foreignFlow: ForeignFlow;
}> {
  const [indices, topVolume, foreignFlow] = await Promise.all([
    fetchMarketIndices(),
    fetchTopVolume(10),
    fetchForeignFlow(),
  ]);
  return { indices, topVolume, foreignFlow };
}
