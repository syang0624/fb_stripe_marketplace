// MRI v3 — deterministic scoring helpers.
// The app computes the basic ordering deterministically so the demo never feels
// random; the LLM (`rank` mode) layers explanations + suggested offers on top.
//
// Final score weights:
//   30% price value
//   25% relevance to buyer request
//   15% condition / spec quality
//   10% distance / pickup fit
//   10% recency / availability
//   10% risk penalty

import { BuyerProfile, Listing, SearchPlan } from "@/lib/types";

export const SCORE_WEIGHTS = {
  value: 0.3,
  relevance: 0.25,
  condition: 0.15,
  distance: 0.1,
  recency: 0.1,
  risk: 0.1,
} as const;

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

const lower = (s: string | undefined) => (s ?? "").toLowerCase();

// Pull the first number of miles/km out of a distance string like "12 mi away".
function parseDistanceKm(distance: string | undefined): number | null {
  if (!distance) return null;
  const match = distance.match(/([\d.]+)\s*(mi|mile|km)/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value)) return null;
  return /mi/i.test(match[2]) ? value * 1.609 : value;
}

// --- individual component scores (0-100) -----------------------------------

// Lower price relative to fair value (and inside budget) scores higher.
// Suspiciously low prices are NOT rewarded here — that lands as a risk flag.
export function valueScore(listing: Listing, profile: BuyerProfile): number {
  const fair = listing.fairValue > 0 ? listing.fairValue : listing.price;
  if (listing.price <= 0) return 50;

  // Ratio of fair value to asking price: >1 means a discount.
  const ratio = fair / listing.price;
  let score = clamp(40 + (ratio - 1) * 120);

  // Penalize over-budget asking prices.
  if (listing.price > profile.budgetMax) {
    const over = (listing.price - profile.budgetMax) / Math.max(profile.budgetMax, 1);
    score -= clamp(over * 100, 0, 60);
  }
  return clamp(score);
}

export function relevanceScore(
  listing: Listing,
  profile: BuyerProfile,
  plan?: SearchPlan
): number {
  const haystack = `${lower(listing.title)} ${lower(listing.specs)} ${lower(listing.description)}`;
  let score = 30;

  for (const term of lower(profile.bikeType).split(/\s+/).filter(Boolean)) {
    if (haystack.includes(term)) score += 18;
  }
  if (profile.frameSize && haystack.includes(lower(profile.frameSize))) score += 15;

  for (const term of plan?.includeTerms ?? []) {
    if (haystack.includes(lower(term))) score += 6;
  }
  for (const term of plan?.excludeTerms ?? []) {
    if (haystack.includes(lower(term))) score -= 25;
  }
  return clamp(score);
}

export function conditionScore(listing: Listing): number {
  let score = 55;
  const desc = lower(listing.description);
  const specs = lower(listing.specs);

  if (/new|excellent|like new|mint/.test(desc) || /new|excellent|mint/.test(specs)) score += 25;
  if (/good/.test(desc)) score += 10;
  if (/fair|worn|needs|issue|broken|crack|rust|does not|doesn't/.test(desc)) score -= 25;
  if (specs.length > 40) score += 10; // detailed specs signal a real, cared-for item
  if (desc.length < 15) score -= 15; // barely any description
  return clamp(score);
}

export function distanceScore(listing: Listing, profile: BuyerProfile): number {
  const km = parseDistanceKm(listing.distance);
  if (km === null) return 60; // unknown — neutral
  const radius = profile.searchRadiusKm > 0 ? profile.searchRadiusKm : 25;
  return clamp(100 - (km / radius) * 80);
}

export function recencyScore(listing: Listing): number {
  const text = lower(listing.listingDateText);
  if (!text) return 60;
  if (/just|hour|today|minute/.test(text)) return 100;
  if (/yesterday|1 day|2 day|3 day/.test(text)) return 85;
  if (/week|day/.test(text)) return 70;
  if (/month/.test(text)) return 40;
  return 60;
}

export function riskScore(listing: Listing, profile: BuyerProfile): number {
  // 100 = no risk, lower = riskier.
  let score = 100;
  score -= (listing.riskFlags?.length ?? 0) * 18;

  // A price far below fair value is a classic scam signal.
  if (listing.fairValue > 0 && listing.price > 0) {
    const ratio = listing.price / listing.fairValue;
    if (ratio < 0.4) score -= 35;
    else if (ratio < 0.6) score -= 15;
  }
  if (lower(listing.description).length < 10) score -= 15;
  if (!listing.image) score -= 15;
  // Walk-away breaches are extra risky to even pursue.
  if (listing.price > profile.walkAwayPrice) score -= 20;
  return clamp(score);
}

// --- composite quick score --------------------------------------------------

export interface ScoreBreakdown {
  total: number;
  value: number;
  relevance: number;
  condition: number;
  distance: number;
  recency: number;
  risk: number;
}

export function scoreBreakdown(
  listing: Listing,
  profile: BuyerProfile,
  plan?: SearchPlan
): ScoreBreakdown {
  const value = valueScore(listing, profile);
  const relevance = relevanceScore(listing, profile, plan);
  const condition = conditionScore(listing);
  const distance = distanceScore(listing, profile);
  const recency = recencyScore(listing);
  const risk = riskScore(listing, profile);

  const total =
    value * SCORE_WEIGHTS.value +
    relevance * SCORE_WEIGHTS.relevance +
    condition * SCORE_WEIGHTS.condition +
    distance * SCORE_WEIGHTS.distance +
    recency * SCORE_WEIGHTS.recency +
    risk * SCORE_WEIGHTS.risk;

  return {
    total: Math.round(total),
    value: Math.round(value),
    relevance: Math.round(relevance),
    condition: Math.round(condition),
    distance: Math.round(distance),
    recency: Math.round(recency),
    risk: Math.round(risk),
  };
}

// Cheap pre-enrichment score used to pick which listings to fetch details for.
export function quickScore(
  listing: Listing,
  profile: BuyerProfile,
  plan?: SearchPlan
): number {
  return scoreBreakdown(listing, profile, plan).total;
}

export function dealQualityFor(total: number): "great" | "good" | "fair" {
  if (total >= 75) return "great";
  if (total >= 55) return "good";
  return "fair";
}
