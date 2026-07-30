// MRI v3 — the search agent. Turns a buyer profile into the top 3 ranked
// deals via: query planning → multi-query live search → dedupe → normalize →
// cheap pre-score → item enrichment → hybrid (deterministic + LLM) rank.
//
// Runs in the browser. Talks to /api/chat (Nemotron) and the /api/marketplace
// proxy routes through lib/marketplace helpers. Falls back to seeded listings
// (N15) if live search yields nothing or errors out.

import { fallbackListings } from "@/lib/data";
import { getItemDetails, resolveLocation, searchMarketplace } from "@/lib/marketplace";
import {
  dealQualityFor,
  quickScore,
  scoreBreakdown,
} from "@/lib/scoring";
import {
  BuyerProfile,
  Listing,
  MarketplaceRawListing,
  RankedDeal,
  SearchPlan,
} from "@/lib/types";

// Progress events for SearchProgress.tsx (Steven's S9). Emitted as the pipeline
// advances so live search feels like an agent, not a spinner.
export interface SearchProgressEvent {
  step:
    | "planning"
    | "locating"
    | "searching"
    | "dedupe"
    | "enriching"
    | "ranking"
    | "fallback"
    | "done";
  label: string;
  detail?: string;
}

export type ProgressFn = (event: SearchProgressEvent) => void;

// --- chat helper ------------------------------------------------------------

function extractJson<T>(text: string, kind: "object" | "array"): T | null {
  const pattern = kind === "array" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const match = text.match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

async function callChat<T>(
  mode: string,
  messages: Array<{ role: string; content: string }>,
  context: Record<string, unknown>,
  kind: "object" | "array" = "object"
): Promise<T | null> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, messages, context }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { reply?: string };
    return extractJson<T>(data.reply ?? "", kind);
  } catch {
    return null;
  }
}

// --- normalization ----------------------------------------------------------

function estimateFairValue(price: number): number {
  // Neutral prior — real fair value is refined by enrichment / LLM summary.
  return price > 0 ? Math.round(price * 1.2) : 0;
}

function detectRiskFlags(raw: MarketplaceRawListing): string[] {
  const flags: string[] = [];
  const desc = (raw.description ?? "").toLowerCase();
  if (!raw.image) flags.push("no photo");
  if ((raw.description ?? "").trim().length < 15) flags.push("very short description");
  if (/crash|crack|bent|broken|does not|doesn't|not work|issue|repair/.test(desc)) {
    flags.push("possible condition issue mentioned");
  }
  return flags;
}

export function normalizeMarketplaceListing(raw: MarketplaceRawListing): Listing {
  const price = raw.price ?? 0;
  const image = raw.image || "";
  return {
    id: raw.id || raw.url || `${raw.title ?? "listing"}-${price}`,
    url: raw.url,
    title: raw.title || "Untitled listing",
    price,
    fairValue: estimateFairValue(price),
    specs: "",
    image,
    images: raw.images?.length ? raw.images : image ? [image] : [],
    sellerName: raw.sellerName || "Marketplace Seller",
    distance: raw.distance || "",
    description: raw.description || "",
    condition: "",
    location: raw.location,
    link: raw.url || "",
    listingDateText: raw.listingDateText,
    availabilityText: raw.availabilityText,
    source: "scrapecreators",
    riskFlags: detectRiskFlags(raw),
  };
}

export function dedupeListings(raw: MarketplaceRawListing[]): MarketplaceRawListing[] {
  const seen = new Set<string>();
  return raw.filter((item) => {
    const key = item.id || item.url || `${item.title}-${item.price}-${item.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Fetch item detail for a candidate and merge richer description/specs in.
async function enrichListing(listing: Listing): Promise<Listing> {
  if (!listing.url && !listing.id) return listing;
  const detail = await getItemDetails({ id: listing.id, url: listing.url });
  if (!detail) return listing;

  const merged: Listing = {
    ...listing,
    description: detail.description || listing.description,
    image: listing.image || detail.image || "",
    sellerName: detail.sellerName || listing.sellerName,
    price: detail.price ?? listing.price,
  };
  merged.fairValue = estimateFairValue(merged.price);
  merged.riskFlags = detectRiskFlags({ ...detail, raw: detail.raw });
  // Use the (usually longer) detail description as the specs seed.
  merged.specs = merged.description.slice(0, 160);
  return merged;
}

// --- ranking ----------------------------------------------------------------

interface LlmRankItem {
  listingId: string;
  score: number;
  dealQuality: "great" | "good" | "fair";
  valueScore: number;
  relevanceScore: number;
  conditionScore: number;
  distanceScore: number;
  riskScore: number;
  summary: string;
  suggestedFirstOffer: number;
  maxRecommendedPrice: number;
}

interface ImageDefectReport {
  image_url: string;
  defects?: Array<{
    type?: string;
    component?: string;
    severity?: string;
    confidence?: number;
    note?: string;
  }>;
  condition_grade?: string;
  negotiation_summary?: string;
  error?: string | null;
}

async function detectDefects(imageUrls: string[]): Promise<ImageDefectReport[]> {
  const unique = Array.from(new Set(imageUrls.filter(Boolean)));
  if (!unique.length) return [];

  try {
    const res = await fetch("/api/vision/defects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_urls: unique }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { reports?: ImageDefectReport[] };
    return data.reports ?? [];
  } catch {
    return [];
  }
}

async function annotateDefects(listings: Listing[]): Promise<Listing[]> {
  const imageUrls = listings.flatMap((listing) => listing.images.length ? listing.images : [listing.image]);
  const reports = await detectDefects(imageUrls);
  if (!reports.length) return listings;

  const byUrl = new Map(reports.map((report) => [report.image_url, report]));
  return listings.map((listing) => {
    const urls = listing.images.length ? listing.images : [listing.image];
    const listingReports = urls.map((url) => byUrl.get(url)).filter(Boolean) as ImageDefectReport[];
    const defectNotes = listingReports.flatMap((report) =>
      (report.defects ?? []).map((defect) =>
        [defect.severity, defect.component, defect.type].filter(Boolean).join(" ")
      )
    );
    const summaries = listingReports
      .map((report) => report.negotiation_summary)
      .filter((summary): summary is string => Boolean(summary));
    const grades = listingReports
      .map((report) => report.condition_grade)
      .filter((grade): grade is string => Boolean(grade) && grade !== "unknown");

    if (!defectNotes.length && !summaries.length && !grades.length) return listing;

    return {
      ...listing,
      condition: grades[0] ?? listing.condition,
      specs: summaries[0] ? `${listing.specs} ${summaries[0]}`.trim() : listing.specs,
      riskFlags: Array.from(new Set([...listing.riskFlags, ...defectNotes, ...summaries])),
    };
  });
}

// Deterministic ranking — always available, never random. Used as the base
// ordering and as the fallback if the LLM rank call fails.
function deterministicRank(
  listings: Listing[],
  profile: BuyerProfile,
  plan?: SearchPlan
): RankedDeal[] {
  return listings
    .map((listing) => {
      const b = scoreBreakdown(listing, profile, plan);
      const suggestedFirstOffer = Math.round(listing.price * 0.85);
      const maxRecommendedPrice = Math.min(
        Math.round(listing.price * 0.98),
        profile.walkAwayPrice
      );
      return {
        listing,
        score: b.total,
        dealQuality: dealQualityFor(b.total),
        valueScore: b.value,
        relevanceScore: b.relevance,
        conditionScore: b.condition,
        distanceScore: b.distance,
        riskScore: b.risk,
        summary:
          listing.riskFlags.length > 0
            ? `${listing.title} at $${listing.price}. Watch: ${listing.riskFlags[0]}.`
            : `${listing.title} at $${listing.price}. Solid fit for "${profile.bikeType}".`,
        suggestedFirstOffer,
        maxRecommendedPrice,
      } as RankedDeal;
    })
    .sort((a, b) => b.score - a.score);
}

// Merge LLM rank output over the deterministic base.
function mergeLlmRank(
  base: RankedDeal[],
  llm: LlmRankItem[],
  profile: BuyerProfile
): RankedDeal[] {
  const byId = new Map(base.map((d) => [d.listing.id, d]));
  const merged: RankedDeal[] = [];
  for (const item of llm) {
    const deal = byId.get(item.listingId);
    if (!deal) continue;
    merged.push({
      ...deal,
      score: item.score ?? deal.score,
      dealQuality: item.dealQuality ?? deal.dealQuality,
      valueScore: item.valueScore ?? deal.valueScore,
      relevanceScore: item.relevanceScore ?? deal.relevanceScore,
      conditionScore: item.conditionScore ?? deal.conditionScore,
      distanceScore: item.distanceScore ?? deal.distanceScore,
      riskScore: item.riskScore ?? deal.riskScore,
      summary: item.summary ?? deal.summary,
      suggestedFirstOffer: item.suggestedFirstOffer ?? deal.suggestedFirstOffer,
      // Never recommend above the buyer's hard ceiling.
      maxRecommendedPrice: Math.min(
        item.maxRecommendedPrice ?? deal.maxRecommendedPrice,
        profile.walkAwayPrice
      ),
    });
    byId.delete(item.listingId);
  }
  // Append any deterministic deals the LLM omitted, keeping ordering stable.
  return merged.length ? merged : base;
}

// --- main orchestration -----------------------------------------------------

export async function findTopDeals(
  profile: BuyerProfile,
  onProgress: ProgressFn = () => {}
): Promise<RankedDeal[]> {
  // 1. Plan the search.
  onProgress({ step: "planning", label: "Expanding your request into search queries" });
  const plan =
    (await callChat<SearchPlan>("query_plan", [], { profile })) ?? defaultPlan(profile);
  onProgress({
    step: "planning",
    label: "Search plan ready",
    detail: plan.queries.join(", "),
  });

  // 2. Resolve location.
  onProgress({ step: "locating", label: `Locating ${plan.location}` });
  const { lat, lng } = await resolveLocation(plan.location);

  // 3. Multi-query live search.
  onProgress({
    step: "searching",
    label: `Searching Marketplace within ${plan.radiusKm} km`,
    detail: `${plan.queries.length} queries`,
  });
  const rawResults: MarketplaceRawListing[] = [];
  for (const query of plan.queries) {
    try {
      const results = await searchMarketplace({
        query,
        lat,
        lng,
        location: plan.location,
        radius_km: plan.radiusKm,
        min_price: plan.minPrice,
        max_price: plan.maxPrice,
        count: plan.countPerQuery,
        condition: plan.condition,
        date_listed: plan.dateListed,
        availability: "available",
      });
      rawResults.push(...results);
    } catch {
      // One failing query shouldn't abort the whole search.
    }
  }

  // N15 fallback — if live search produced nothing, use seeded listings.
  if (rawResults.length === 0) {
    onProgress({
      step: "fallback",
      label: "Live search unavailable — using fallback marketplace data",
    });
    const ranked = await rankListings(fallbackListings, profile, plan, onProgress);
    onProgress({ step: "done", label: "Top deals ready (fallback data)" });
    return ranked.slice(0, 3);
  }

  onProgress({ step: "searching", label: `Found ${rawResults.length} listings` });

  // 4. Dedupe.
  const deduped = dedupeListings(rawResults);
  onProgress({
    step: "dedupe",
    label: `Removed ${rawResults.length - deduped.length} duplicates`,
    detail: `${deduped.length} unique listings`,
  });

  // 5. Normalize.
  const normalized = deduped.map(normalizeMarketplaceListing);

  // 5b. Filter out junk — listings with absurdly low prices or that have
  // nothing to do with the buyer's query. Without this, $4 unrelated items
  // from Marketplace can end up as "top deals".
  const minReasonablePrice = Math.max(200, profile.budgetMin, Math.round(profile.budgetMax * 0.1));
  const queryTerms = (profile.bikeType || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const filtered = normalized.filter((listing) => {
    // Drop listings with no price or priced below minimum (likely junk/unrelated)
    if (listing.price < minReasonablePrice) return false;
    // Drop listings priced over 2x budget (way out of range)
    if (listing.price > profile.budgetMax * 2) return false;
    // Require at least one query term in title or description
    if (queryTerms.length > 0) {
      const haystack = `${listing.title} ${listing.description}`.toLowerCase();
      const hasMatch = queryTerms.some((term) => haystack.includes(term));
      if (!hasMatch) return false;
    }
    return true;
  });

  // If filtering removed everything, fall back to seeded listings.
  if (filtered.length === 0) {
    onProgress({
      step: "fallback",
      label: "No relevant results after filtering — using fallback data",
    });
    const ranked = await rankListings(fallbackListings, profile, plan, onProgress);
    onProgress({ step: "done", label: "Top deals ready (fallback data)" });
    return ranked.slice(0, 3);
  }

  // 6. Pre-score cheaply, keep the best dozen for enrichment.
  const candidates = filtered
    .map((listing) => ({ listing, preScore: quickScore(listing, profile, plan) }))
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, 12)
    .map((x) => x.listing);

  // 7. Enrich the likely candidates with item detail.
  onProgress({
    step: "enriching",
    label: `Fetching details for ${candidates.length} likely candidates`,
  });
  const enriched = await Promise.all(candidates.map(enrichListing));
  const visionAnnotated = await annotateDefects(enriched);

  // 8. Hybrid rank → top 3.
  const ranked = await rankListings(visionAnnotated, profile, plan, onProgress);
  onProgress({ step: "done", label: "Ranked top 3 by value, fit, risk, and pickup" });
  return ranked.slice(0, 3);
}

async function rankListings(
  listings: Listing[],
  profile: BuyerProfile,
  plan: SearchPlan,
  onProgress: ProgressFn
): Promise<RankedDeal[]> {
  const base = deterministicRank(listings, profile, plan);
  onProgress({ step: "ranking", label: "Scoring deals by value, fit, risk, and pickup" });

  // Send the top candidates to the LLM for explanations + suggested offers.
  const topForLlm = base.slice(0, Math.min(6, base.length)).map((d) => d.listing);
  const llm = await callChat<LlmRankItem[]>(
    "rank",
    [],
    { profile, listings: topForLlm },
    "array"
  );

  if (llm && llm.length) {
    const merged = mergeLlmRank(base, llm, profile);
    return merged.sort((a, b) => b.score - a.score);
  }
  return base;
}

function defaultPlan(profile: BuyerProfile): SearchPlan {
  return {
    location: profile.location || "San Francisco, CA",
    lat: profile.lat,
    lng: profile.lng,
    radiusKm: profile.searchRadiusKm || 25,
    minPrice: profile.budgetMin,
    maxPrice: profile.budgetMax,
    queries: [profile.bikeType || "iPhone", "used iPhone", "iPhone for sale"].filter(Boolean),
    includeTerms: [profile.bikeType, profile.frameSize].filter(Boolean) as string[],
    excludeTerms: ["broken", "parts only", "iCloud locked", "cracked"],
    condition: "used",
    dateListed: "last_7_days",
    countPerQuery: 20,
  };
}
