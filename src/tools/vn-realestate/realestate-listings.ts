import { isFresh } from "../_shared/http.js";
import axios from "axios";

// ─── Types ───

export interface ListingItem {
  title: string;
  price: string;
  pricePerM2: string;
  size: string;
  rooms: number | null;
  bathrooms: number | null;
  location: string;
  district: string;
  city: string;
  address: string;
  category: string;
  url: string;
  imageUrl: string;
  postedDate: string;
  listTime: number;
  sellerName: string;
  latitude: number | null;
  longitude: number | null;
}

export interface ListingDetail {
  title: string;
  description: string;
  price: string;
  pricePerM2: string;
  size: string;
  rooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  location: string;
  address: string;
  category: string;
  propertyStatus: string;
  legalDocument: string;
  furnishing: string;
  url: string;
  imageUrls: string[];
  postedDate: string;
  listTime: number;
  isStale: boolean;
  sellerName: string;
  sellerPhone: string;
  latitude: number | null;
  longitude: number | null;
  parameters: Record<string, string>;
}

// ─── Constants ───

const LISTING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const DETAIL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_LISTING_AGE_MS = 4 * 30 * 24 * 60 * 60 * 1000; // ~4 months — filter out stale listings
const CHOTOT_BASE = "https://gateway.chotot.com/v1/public/ad-listing";

const chototHttp = axios.create({
  timeout: 15_000,
  headers: { "User-Agent": "Mozilla/5.0" },
});

/** Category codes for real estate on Chotot/NhaTot */
const CATEGORY_MAP: Record<string, number> = {
  "all": 1000,
  "can-ho": 1010,
  "chung-cu": 1010,
  "nha-rieng": 1020,
  "nha-o": 1020,
  "dat": 1040,
  "dat-nen": 1040,
  "van-phong": 1030,
  "mat-bang": 1030,
  "phong-tro": 1050,
};

/** Region codes (region_v2) for major cities */
const REGION_MAP: Record<string, number> = {
  "ha-noi": 12000,
  "hanoi": 12000,
  "hcm": 13000,
  "ho-chi-minh": 13000,
  "tp-hcm": 13000,
  "da-nang": 15000,
  "hai-phong": 14000,
  "can-tho": 21000,
  "binh-duong": 40000,
  "dong-nai": 39000,
  "ba-ria-vung-tau": 43000,
  "khanh-hoa": 34000,
  "quang-ninh": 16000,
};

/** NhaTot web URL slug for property types */
const PROPERTY_URL_SLUG: Record<string, string> = {
  "all": "bat-dong-san",
  "can-ho": "can-ho-chung-cu",
  "chung-cu": "can-ho-chung-cu",
  "nha-rieng": "nha-dat",
  "nha-o": "nha-dat",
  "dat": "dat",
  "dat-nen": "dat",
  "van-phong": "van-phong-mat-bang",
  "mat-bang": "van-phong-mat-bang",
  "phong-tro": "phong-tro",
};

/** NhaTot web URL slug for cities */
const CITY_URL_SLUG: Record<string, string> = {
  "ha-noi": "ha-noi",
  "hanoi": "ha-noi",
  "hcm": "tp-ho-chi-minh",
  "ho-chi-minh": "tp-ho-chi-minh",
  "tp-hcm": "tp-ho-chi-minh",
  "da-nang": "da-nang",
  "hai-phong": "hai-phong",
  "can-tho": "can-tho",
  "binh-duong": "binh-duong",
  "dong-nai": "dong-nai",
  "ba-ria-vung-tau": "ba-ria-vung-tau",
  "khanh-hoa": "khanh-hoa",
  "quang-ninh": "quang-ninh",
};

/** Build nhatot.com reference URLs for search results and price reference page */
export function buildNhaTotUrls(type: string, city?: string, propertyType?: string): {
  searchUrl: string;
  priceReferenceUrl: string;
} {
  const isBuy = type !== "cho-thue" && type !== "thue";
  const prefix = isBuy ? "mua-ban" : "cho-thue";
  const propSlug = PROPERTY_URL_SLUG[propertyType ?? "all"] ?? "bat-dong-san";
  const citySlug = city ? (CITY_URL_SLUG[city.toLowerCase()] ?? "") : "";

  const suffix = citySlug ? `${propSlug}-${citySlug}` : propSlug;
  return {
    searchUrl: `https://www.nhatot.com/${prefix}-${suffix}`,
    priceReferenceUrl: `https://www.nhatot.com/tham-khao-gia-${prefix}-${suffix}`,
  };
}

// ─── Caches ───

const listingCache = new Map<string, { data: ListingItem[]; timestamp: number }>();
const detailCache = new Map<string, { data: ListingDetail; timestamp: number }>();

// ─── API Response Types ───

interface ChototAd {
  ad_id: number;
  list_id: number;
  subject: string;
  body?: string;
  price: number;
  price_string: string;
  price_million_per_m2?: number;
  size?: number;
  size_unit_string?: string;
  rooms?: number;
  toilets?: number;
  floornumber?: number;
  category_name: string;
  area_name: string;
  ward_name?: string;
  region_name: string;
  street_name?: string;
  latitude?: number;
  longitude?: number;
  image?: string;
  images?: string[];
  date: string;
  list_time: number;
  account_name?: string;
  full_name?: string;
  phone?: string;
  property_status?: number;
  property_legal_document?: number;
  furnishing_sell?: number;
}

interface ChototListResponse {
  ads: ChototAd[];
  total?: number;
}

interface ChototDetailResponse {
  ad: ChototAd;
  parameters?: { id: string; label: string; value: string }[];
}

/**
 * Project/unreleased listings are exempt from the staleness filter.
 * property_status 2 = "Chưa bàn giao" (under construction / not yet released).
 */
function isProjectListing(ad: ChototAd): boolean {
  return ad.property_status === 2;
}

// ─── Listing Search ───

export async function fetchListings(params: {
  type: string;
  city?: string;
  propertyType?: string;
  keyword?: string;
  priceRange?: string;
  areaRange?: string;
  limit?: number;
}): Promise<{ total: number; listings: ListingItem[] }> {
  // Build category code
  let cg: number;
  if (params.propertyType) {
    cg = CATEGORY_MAP[params.propertyType] ?? 1000;
  } else {
    cg = 1000; // all BDS
  }

  // st=s,k for sales, st=u for rentals
  const isRental = params.type === "cho-thue" || params.type === "thue";
  const stFilter = isRental ? "u" : "s,k";

  const limit = Math.min(params.limit ?? 10, 20);
  const cacheKey = `chotot_${cg}_${stFilter}_${params.city ?? ""}_${params.keyword ?? ""}_${params.priceRange ?? ""}_${params.areaRange ?? ""}`;

  const cached = listingCache.get(cacheKey);
  if (cached && isFresh(cached.timestamp, LISTING_CACHE_TTL)) {
    return { total: cached.data.length, listings: cached.data.slice(0, limit) };
  }

  // Build query params
  const qp = new URLSearchParams();
  qp.set("cg", String(cg));
  qp.set("limit", String(Math.max(limit, 20))); // cache up to 20
  qp.set("o", "0");
  qp.set("st", stFilter);

  if (params.city) {
    const regionCode = REGION_MAP[params.city.toLowerCase()];
    if (regionCode) qp.set("region_v2", String(regionCode));
  }
  if (params.keyword) qp.set("q", params.keyword);
  if (params.priceRange) qp.set("price", params.priceRange);
  if (params.areaRange) qp.set("size", params.areaRange);

  const res = await chototHttp.get<ChototListResponse>(`${CHOTOT_BASE}?${qp.toString()}`);
  const ads = res.data.ads ?? [];
  const total = res.data.total ?? ads.length;

  // Filter out stale listings (>4 months old), keep project/unreleased listings
  const now = Date.now();
  const freshAds = ads.filter(ad => {
    const ageMs = now - ad.list_time;
    return ageMs <= MAX_LISTING_AGE_MS || isProjectListing(ad);
  });

  const items: ListingItem[] = freshAds.map(mapAdToListing);

  if (items.length > 0) {
    listingCache.set(cacheKey, { data: items, timestamp: Date.now() });
  }

  return { total, listings: items.slice(0, limit) };
}

// ─── Listing Detail ───

export async function fetchListingDetail(listId: number): Promise<ListingDetail> {
  const cacheKey = `detail_${listId}`;
  const cached = detailCache.get(cacheKey);
  if (cached && isFresh(cached.timestamp, DETAIL_CACHE_TTL)) return cached.data;

  const res = await chototHttp.get<ChototDetailResponse>(`${CHOTOT_BASE}/${listId}`);
  const ad = res.data.ad;
  const params = res.data.parameters ?? [];

  const paramMap: Record<string, string> = {};
  for (const p of params) paramMap[p.id] = p.value;

  const isStale = (Date.now() - ad.list_time > MAX_LISTING_AGE_MS) && !isProjectListing(ad);

  const detail: ListingDetail = {
    title: ad.subject,
    description: ad.body ?? "",
    price: ad.price_string,
    pricePerM2: ad.price_million_per_m2 ? `${ad.price_million_per_m2} tr/m²` : "",
    size: ad.size ? `${ad.size} ${ad.size_unit_string ?? "m²"}` : "",
    rooms: ad.rooms ?? null,
    bathrooms: ad.toilets ?? null,
    floor: ad.floornumber ?? null,
    location: [ad.ward_name, ad.area_name, ad.region_name].filter(Boolean).join(", "),
    address: paramMap["address"] ?? [ad.street_name, ad.ward_name, ad.area_name, ad.region_name].filter(Boolean).join(", "),
    category: ad.category_name,
    propertyStatus: paramMap["property_status"] ?? "",
    legalDocument: paramMap["property_legal_document"] ?? "",
    furnishing: paramMap["furnishing_sell"] ?? "",
    url: `https://www.nhatot.com/${ad.list_id}.htm`,
    imageUrls: ad.images ?? (ad.image ? [ad.image] : []),
    postedDate: ad.date,
    listTime: ad.list_time,
    isStale,
    sellerName: ad.full_name ?? ad.account_name ?? "",
    sellerPhone: ad.phone ?? "",
    latitude: ad.latitude ?? null,
    longitude: ad.longitude ?? null,
    parameters: paramMap,
  };

  detailCache.set(cacheKey, { data: detail, timestamp: Date.now() });
  return detail;
}

// ─── Helpers ───

function mapAdToListing(ad: ChototAd): ListingItem {
  return {
    title: ad.subject,
    price: ad.price_string,
    pricePerM2: ad.price_million_per_m2 ? `${ad.price_million_per_m2} tr/m²` : "",
    size: ad.size ? `${ad.size} ${ad.size_unit_string ?? "m²"}` : "",
    rooms: ad.rooms ?? null,
    bathrooms: ad.toilets ?? null,
    location: [ad.ward_name, ad.area_name, ad.region_name].filter(Boolean).join(", "),
    district: ad.area_name,
    city: ad.region_name,
    address: [ad.street_name, ad.ward_name, ad.area_name].filter(Boolean).join(", "),
    category: ad.category_name,
    url: `https://www.nhatot.com/${ad.list_id}.htm`,
    imageUrl: ad.image ?? "",
    postedDate: ad.date,
    listTime: ad.list_time,
    sellerName: ad.full_name ?? ad.account_name ?? "",
    latitude: ad.latitude ?? null,
    longitude: ad.longitude ?? null,
  };
}
