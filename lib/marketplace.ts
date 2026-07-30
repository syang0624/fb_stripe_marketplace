// MRI v3 — ScrapeCreators client helpers.
//
// These run in the browser and talk to our own server-side proxy routes
// (/api/marketplace/*) so the ScrapeCreators API key never reaches the client.
// ScrapeCreators' exact response shape is treated as untrusted: every parser is
// tolerant and always preserves the original payload under `raw`.

import { MarketplaceRawListing } from "@/lib/types";

export interface MarketplaceSearchParams {
  query: string;
  lat: number;
  lng: number;
  location?: string;
  radius_km?: number;
  min_price?: number;
  max_price?: number;
  count?: number;
  sort_by?: string;
  delivery_method?: string;
  condition?: string;
  date_listed?: string;
  availability?: string;
  cursor?: string;
}

// Default coordinates if location resolution fails (San Francisco).
export const DEFAULT_COORDS = { lat: 37.7749, lng: -122.4194 };

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    if (cleaned) {
      const n = parseFloat(cleaned);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ScrapeCreators returns price as an object:
//   search → { formatted_amount, amount, amount_with_offset_in_currency }
//   item   → { formatted_amount_zeros_stripped, amount, currency }
// Prefer the formatted string (already human-scaled) over raw amount fields.
function extractPrice(node: Record<string, unknown>): number | undefined {
  const raw = pick(node, ["price", "listing_price", "formatted_price"]);
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return toNumber(raw);

  const obj = asRecord(raw);
  if (obj) {
    const formatted = pick(obj, ["formatted_amount_zeros_stripped", "formatted_amount", "formatted"]);
    if (typeof formatted === "string") {
      const n = toNumber(formatted);
      if (n !== undefined) return n;
    }
    const amount = toNumber(pick(obj, ["amount"]));
    if (amount !== undefined) return amount;
  }
  // Last resort: a bare top-level amount.
  return toNumber(pick(node, ["amount"]));
}

function extractImages(node: Record<string, unknown>): string[] {
  const out: string[] = [];
  const images = pick(node, ["images", "photos", "listing_photos"]);
  if (Array.isArray(images)) {
    for (const image of images) {
      if (typeof image === "string" && image) out.push(image);
      const obj = asRecord(image);
      if (obj && typeof obj.url === "string" && obj.url) out.push(obj.url);
    }
  }
  return Array.from(new Set(out));
}

// search → primary_photo.url ; item → photos[0].url ; RunPod → images[0].
function extractImage(node: Record<string, unknown>): string {
  const primary = asRecord(pick(node, ["primary_photo", "primary_listing_photo"]));
  if (primary && typeof primary.url === "string") return primary.url;

  const images = extractImages(node);
  if (images.length) return images[0];

  const single = pick(node, ["image", "primary_image", "thumbnail", "photo", "imageUrl"]);
  if (typeof single === "string") return single;
  const singleObj = asRecord(single);
  if (singleObj) return String(singleObj.uri ?? singleObj.url ?? "");
  return "";
}

// search → location object { display_name, city, state } ; item → location_text
// string (the `location` object on item is lat/lng coords, never a display name).
function extractLocationText(node: Record<string, unknown>): string | undefined {
  const text = pick(node, ["location_text", "locationText"]);
  if (typeof text === "string") return text;

  const loc = node.location;
  if (typeof loc === "string") return loc;
  const obj = asRecord(loc);
  if (obj) {
    if (typeof obj.display_name === "string") return obj.display_name;
    const parts = [obj.city, obj.state].filter((p) => typeof p === "string");
    if (parts.length) return parts.join(", ");
  }
  return pick(node, ["city"]) as string | undefined;
}

// Find the array of listing-like objects in an unknown response body.
function extractListingArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["listings", "results", "items", "data", "edges", "marketplace_listings"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
    // Some APIs nest under data.listings etc.
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object") {
        return v as Record<string, unknown>[];
      }
    }
  }
  return [];
}

export function normalizeRawListing(item: Record<string, unknown>): MarketplaceRawListing {
  // Unwrap GraphQL-style { node: {...} } edges.
  const node =
    item && typeof item.node === "object" && item.node !== null
      ? (item.node as Record<string, unknown>)
      : item;

  // `seller` is an object (or null) on the item endpoint; coerce to a name.
  const sellerRaw = pick(node, ["seller_name", "sellerName", "seller", "marketplace_listing_seller"]);
  const sellerName =
    typeof sellerRaw === "string"
      ? sellerRaw
      : (asRecord(sellerRaw)?.name as string | undefined);

  return {
    id: (pick(node, ["id", "listing_id", "item_id", "story_id"]) as string | number | undefined)?.toString(),
    url: pick(node, ["url", "listing_url", "share_uri", "link", "permalink"]) as string | undefined,
    title: pick(node, ["title", "name", "marketplace_listing_title"]) as string | undefined,
    price: extractPrice(node),
    location: extractLocationText(node),
    image: extractImage(node),
    images: extractImages(node),
    sellerName,
    description: pick(node, ["description", "redacted_description", "body", "desc"]) as
      | string
      | undefined,
    distance: pick(node, ["distance", "distance_text", "distanceText"]) as string | undefined,
    listingDateText: pick(node, [
      "listing_date_text",
      "listingDateText",
      "creation_time",
      "date_listed",
      "created",
    ]) as string | undefined,
    availabilityText: pick(node, ["availability_text", "availabilityText", "availability"]) as
      | string
      | undefined,
    raw: item,
  };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Marketplace request failed (${res.status}): ${url}`);
  }
  return res.json();
}

// --- public helpers ---------------------------------------------------------

export async function resolveLocation(
  location: string
): Promise<{ lat: number; lng: number }> {
  try {
    const data = (await getJson(
      `/api/marketplace/location?query=${encodeURIComponent(location)}`
    )) as Record<string, unknown>;

    const lat = toNumber(pick(data, ["lat", "latitude"]));
    const lng = toNumber(pick(data, ["lng", "lon", "longitude"]));
    if (lat !== undefined && lng !== undefined) return { lat, lng };

    // Look one level deeper for a coordinates-bearing object.
    const arr = extractListingArray(data);
    if (arr.length) {
      const first = arr[0];
      const flat = toNumber(pick(first, ["lat", "latitude"]));
      const flng = toNumber(pick(first, ["lng", "lon", "longitude"]));
      if (flat !== undefined && flng !== undefined) return { lat: flat, lng: flng };
    }
  } catch {
    // fall through to default
  }
  return { ...DEFAULT_COORDS };
}

// ScrapeCreators only accepts these exact `condition` tokens and 500s on
// anything else (e.g. the generic "used" an LLM is likely to emit). Map loose
// values to valid tokens; "used" expands to all used tiers. Unmappable → drop.
const CONDITION_TOKENS: Record<string, string> = {
  new: "new",
  "like new": "used_like_new",
  like_new: "used_like_new",
  used_like_new: "used_like_new",
  good: "used_good",
  used_good: "used_good",
  fair: "used_fair",
  used_fair: "used_fair",
};

export function normalizeCondition(value?: string): string | undefined {
  if (!value) return undefined;
  const lowered = value.trim().toLowerCase();
  if (lowered === "used" || lowered === "used_*" || lowered === "any") {
    return "used_like_new,used_good,used_fair";
  }
  const mapped = lowered
    .split(/[,;]+/)
    .map((p) => CONDITION_TOKENS[p.trim()])
    .filter(Boolean);
  return mapped.length ? Array.from(new Set(mapped)).join(",") : undefined;
}

export async function searchMarketplace(
  params: MarketplaceSearchParams
): Promise<MarketplaceRawListing[]> {
  const sanitized: MarketplaceSearchParams = {
    ...params,
    condition: normalizeCondition(params.condition),
  };

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sanitized)) {
    if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
  }
  const data = await getJson(`/api/marketplace/search?${qs.toString()}`);
  return extractListingArray(data).map(normalizeRawListing);
}

export async function getItemDetails(
  idOrUrl: { id?: string; url?: string }
): Promise<MarketplaceRawListing | null> {
  const qs = new URLSearchParams();
  if (idOrUrl.id) qs.set("id", idOrUrl.id);
  if (idOrUrl.url) qs.set("url", idOrUrl.url);
  if (![...qs.keys()].length) return null;

  try {
    const data = (await getJson(`/api/marketplace/item?${qs.toString()}`)) as Record<string, unknown>;
    const listings = extractListingArray(data);
    if (listings.length) return normalizeRawListing(listings[0]);

    // Item detail may be the object itself or nested under a key.
    const inner =
      data && typeof data === "object" && (data.listing || data.item || data.data)
        ? ((data.listing || data.item || data.data) as Record<string, unknown>)
        : data;
    return normalizeRawListing(inner);
  } catch {
    return null;
  }
}
