type JsonObject = Record<string, unknown>;

const SCRAPER_BASE_URL =
  process.env.RUNPOD_SCRAPER_BASE_URL || process.env.RUNPOD_BACKEND_BASE_URL || "";
const VISION_BASE_URL =
  process.env.RUNPOD_VISION_BASE_URL || process.env.RUNPOD_BACKEND_BASE_URL || "";

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function postJson(baseUrl: string, path: string, body: JsonObject): Promise<Response | null> {
  if (!baseUrl) return null;
  return fetch(joinUrl(baseUrl, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export function hasRunpodScraper(): boolean {
  return Boolean(SCRAPER_BASE_URL);
}

export function hasRunpodVision(): boolean {
  return Boolean(VISION_BASE_URL);
}

export async function searchRunpodListings(body: {
  query: string;
  location?: string;
  limit?: number;
}): Promise<Response | null> {
  return postJson(SCRAPER_BASE_URL, "/scraper_ep/search", body);
}

export async function getRunpodListings(body: {
  url?: string;
  urls?: string[];
}): Promise<Response | null> {
  return postJson(SCRAPER_BASE_URL, "/scraper_ep/listing", body);
}

export async function detectRunpodDefects(body: {
  image_urls: string[];
}): Promise<Response | null> {
  return postJson(VISION_BASE_URL, "/vision_ep/defects", body);
}
