import * as cheerio from "cheerio";
import { http, isFresh } from "../_shared/http.js";

export interface BankRate {
  name: string;
  rates: Record<string, number | null>;
}

export interface InterestRateData {
  banks: BankRate[];
  channel: string;
  updatedAt: string;
  note: string;
}

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const TERMS = ["KKH", "1T", "2T", "3T", "6T", "9T", "12T", "18T", "24T", "36T"];

const cache = {
  counter: { data: null as InterestRateData | null, timestamp: 0 },
  online: { data: null as InterestRateData | null, timestamp: 0 },
};

/** Decode obfuscated rate values from webgia.com: strip uppercase letters, parse hex pairs → chars */
function decodeNb(encoded: string): string {
  const stripped = encoded.replace(/[A-Z]/g, "");
  const chars: number[] = [];
  for (let i = 0; i < stripped.length - 1; i += 2) {
    chars.push(parseInt(stripped.substring(i, i + 2), 16));
  }
  return String.fromCharCode(...chars);
}

function parseTable($: cheerio.CheerioAPI, tableEl: ReturnType<cheerio.CheerioAPI>, channel: string): InterestRateData {
  const banks: BankRate[] = [];

  tableEl.find("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const cells = $tr.find("td");
    if (cells.length < 2) return;

    // First cell = bank name (may contain <a> link)
    const nameCell = cells.eq(0);
    const name = nameCell.find("a").text().trim() || nameCell.text().trim();
    if (!name) return;

    const rates: Record<string, number | null> = {};
    for (let i = 0; i < TERMS.length; i++) {
      const cellIndex = i + 1;
      if (cellIndex >= cells.length) {
        rates[TERMS[i]] = null;
        continue;
      }
      // Rates are obfuscated in "nb" attribute — decode them
      const nb = cells.eq(cellIndex).attr("nb");
      const decoded = nb ? decodeNb(nb) : cells.eq(cellIndex).text().trim();
      // Strip any HTML tags from decoded value (e.g. <span class="text-red">1,60</span>)
      const clean = decoded.replace(/<[^>]+>/g, "").trim().replace(",", ".");
      const val = parseFloat(clean);
      rates[TERMS[i]] = isNaN(val) || clean === "-" ? null : val;
    }

    banks.push({ name, rates });
  });

  return {
    banks,
    channel,
    updatedAt: new Date().toISOString(),
    note: "Lãi suất tiết kiệm (%/năm). Lãi suất cho vay thường cao hơn 2-4% so với lãi suất tiết kiệm. Dùng làm tham khảo khi ước tính lãi suất vay mua nhà.",
  };
}

async function fetchRaw(): Promise<{ counter: InterestRateData; online: InterestRateData }> {
  const res = await http.get("https://webgia.com/lai-suat/");
  const $ = cheerio.load(res.data as string);

  const tables = $("article#main table.table-radius");

  // First table = Quầy (counter), second table = Online
  const counterTable = tables.eq(0);
  const onlineTable = tables.eq(1);

  const counter = parseTable($, counterTable, "counter");
  const online = parseTable($, onlineTable, "online");

  return { counter, online };
}

export async function fetchInterestRates(channel: "counter" | "online" | "all" = "all"): Promise<InterestRateData | { counter: InterestRateData; online: InterestRateData }> {
  const needCounter = channel === "counter" || channel === "all";
  const needOnline = channel === "online" || channel === "all";

  const counterFresh = cache.counter.data && isFresh(cache.counter.timestamp, CACHE_TTL);
  const onlineFresh = cache.online.data && isFresh(cache.online.timestamp, CACHE_TTL);

  if (needCounter && !counterFresh || needOnline && !onlineFresh) {
    const raw = await fetchRaw();
    cache.counter = { data: raw.counter, timestamp: Date.now() };
    cache.online = { data: raw.online, timestamp: Date.now() };
  }

  if (channel === "all") {
    return { counter: cache.counter.data!, online: cache.online.data! };
  }
  return channel === "counter" ? cache.counter.data! : cache.online.data!;
}
