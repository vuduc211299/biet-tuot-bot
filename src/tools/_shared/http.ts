import axios from "axios";

export const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.5",
  },
});

export function isFresh(timestamp: number, ttl: number): boolean {
  return Date.now() - timestamp < ttl;
}

export async function fetchWithRetry(url: string, retries = 2): Promise<string> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await http.get<string>(url, { responseType: "text" });
      return res.data;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error("unreachable");
}

export const kbsHttp = axios.create({
  timeout: 15000,
  headers: { "User-Agent": "McpNewsBot/1.0" },
});

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY?.trim();

export const coingeckoHttp = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "McpNewsBot/1.0",
    ...(COINGECKO_API_KEY ? { "x-cg-demo-api-key": COINGECKO_API_KEY } : {}),
  },
});

export function logTool(name: string, input: Record<string, unknown>, data: unknown): void {
  const json = JSON.stringify(data);
  const preview = json.length > 800 ? json.slice(0, 800) + `... (${json.length} chars)` : json;
  console.log(`[TOOL] ${name} | input: ${JSON.stringify(input)}`);
}
