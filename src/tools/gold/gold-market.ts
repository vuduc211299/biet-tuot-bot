import * as cheerio from "cheerio";
import { http, isFresh } from "../_shared/http.js";

export interface GoldPrice {
  brand: string;
  region: string;
  buy: string;
  sell: string;
}

export interface WorldGoldPrice {
  priceUsd: string;
  changeUsd: string;
  changePct: string;
}

export interface GoldPriceData {
  vietnam: GoldPrice[];
  world: WorldGoldPrice | null;
  updatedAt: string;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const cache: { data: GoldPriceData | null; timestamp: number } = {
  data: null,
  timestamp: 0,
};

export async function fetchGoldPrices(): Promise<GoldPriceData> {
  if (cache.data && isFresh(cache.timestamp, CACHE_TTL)) return cache.data;

  const res = await http.get("https://webgia.com/gia-vang/");
  const $ = cheerio.load(res.data as string);

  // --- Vietnam gold prices ---
  const vnPrices: GoldPrice[] = [];
  let currentRegion = "";

  $("article#main table.table-radius tbody tr").each((_, tr) => {
    const $tr = $(tr);

    // Update region from <th rowspan>
    const regionTh = $tr.find("th[rowspan]");
    if (regionTh.length) {
      currentRegion = regionTh.text().trim();
    }

    // Brand name from <td> a strong
    const brand = $tr.find("td a strong").first().text().trim();
    if (!brand) return;

    // Get buy/sell cells (td.text-right)
    const priceCells = $tr.find("td.text-right");
    if (priceCells.length < 2) return;

    const buyCell = priceCells.eq(0);
    const sellCell = priceCells.eq(1);

    // Skip obfuscated cells (bgvtk class with nb attribute)
    if (buyCell.hasClass("bgvtk") || sellCell.hasClass("bgvtk")) return;

    const buy = buyCell.text().trim();
    const sell = sellCell.text().trim();

    // Only include rows with numeric prices
    if (!buy || !sell || !/\d/.test(buy)) return;

    vnPrices.push({ brand, region: currentRegion, buy, sell });
  });

  // --- World gold price (sidebar) ---
  let world: WorldGoldPrice | null = null;
  const sidebarBoxes = $("#sidebar .box");
  sidebarBoxes.each((_, box) => {
    const $box = $(box);
    const header = $box.find("th a, th").first().text().trim().toLowerCase();
    if (!(header.includes("vàng") && header.includes("thế giới"))) return;

    const cells = $box.find("tbody td");
    if (cells.length >= 3) {
      world = {
        priceUsd: cells.eq(0).text().trim(),
        changeUsd: cells.eq(1).text().trim(),
        changePct: cells.eq(2).text().trim(),
      };
    }
  });

  const result: GoldPriceData = {
    vietnam: vnPrices,
    world,
    updatedAt: new Date().toISOString(),
  };

  cache.data = result;
  cache.timestamp = Date.now();
  return result;
}
