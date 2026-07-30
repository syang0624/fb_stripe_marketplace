// MRI v3 — shared type contract between the `nori` (backend) and `steven`
// (frontend) branches. Agreed at Sync Point 1; breaking changes need a heads-up.
//
// Listing carries a few UI-compat fields (images, condition, link) alongside the
// canonical v3 fields (image, url) so the frontend components keep compiling.

// Buyer profile + negotiation authority — collected at onboarding.
export interface BuyerProfile {
  // Item / search preferences
  bikeType: string; // legacy field name — holds the item type (e.g. "iPhone 15 Pro")
  frameSize: string;
  budgetMin: number;
  budgetMax: number;
  preferences: string;
  location: string;
  lat?: number;
  lng?: number;
  searchRadiusKm: number;

  // Negotiation authority
  walkAwayPrice: number; // hard ceiling — agent never exceeds
  autoAcceptThreshold: number; // if seller offers <= this, agent closes immediately
  deadline: string; // "by Saturday", "in 3 days", "no rush"
  meetRadius: number; // miles from location
  meetWindows: string; // "weekday evenings, weekend mornings"
  nonNegotiables: string[]; // ["must test ride", "no crash history"]
}

export interface SearchPlan {
  location: string;
  lat?: number;
  lng?: number;
  radiusKm: number;
  minPrice?: number;
  maxPrice?: number;
  queries: string[]; // e.g. ["iPhone 15 Pro", "iPhone 14 Pro Max", "used iPhone"]
  includeTerms: string[]; // terms that improve relevance
  excludeTerms: string[]; // e.g. ["kids", "parts", "broken"]
  condition?: string;
  dateListed?: string;
  countPerQuery: number;
}

export interface MarketplaceRawListing {
  id?: string;
  url?: string;
  title?: string;
  price?: number;
  location?: string;
  image?: string;
  images?: string[];
  sellerName?: string;
  description?: string;
  distance?: string;
  listingDateText?: string;
  availabilityText?: string;
  raw: unknown;
}

export interface Listing {
  id: string;
  url?: string;
  title: string;
  price: number;
  fairValue: number; // estimated by scoring layer / LLM
  specs: string;
  image: string; // primary image
  images: string[]; // all images (UI gallery)
  sellerName: string;
  distance: string;
  description: string;
  condition: string; // free-text condition (UI compat)
  location?: string;
  link: string; // marketplace URL (UI compat; mirrors `url`)
  listingDateText?: string;
  availabilityText?: string;
  source: "scrapecreators" | "seeded_fallback";
  riskFlags: string[];
}

export interface RankedDeal {
  listing: Listing;
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

export interface Message {
  role: "buyer" | "seller" | "system" | "agent_note" | "draft";
  content: string;
  timestamp: number;
}

export type NegotiationStage =
  | "outreach"
  | "price_discovery"
  | "condition_qa"
  | "counter_offer"
  | "logistics"
  | "final_offer"
  | "withdrawn"
  | "scam_detected";

export interface ScamAlert {
  severity: "high" | "medium" | "low";
  flags: string[];
  summary: string;
  detectedAt: number;
}

export interface SellerPersona {
  name: string;
  style: string;
  priceFloor: number;
  hiddenInfo: string;
  concessionPattern: "easy_drop" | "firm_price" | "condition_issue" | "slow_reply";
}

export interface FinalOffer {
  listingId: string;
  sellerName: string;
  bikeTitle: string; // legacy field name — holds the item title
  finalPrice: number;
  meetTime: string;
  meetPlace: string;
  extras: string[];
  notes: string;
}

export interface Negotiation {
  sellerId: string;
  sellerName: string;
  listing: Listing;
  messages: Message[];
  stage: NegotiationStage;
  currentPrice: number;
  agentReasoning: string;
  persona: SellerPersona;
  finalOffer?: FinalOffer;
  userTookOver: boolean;
  scamAlert?: ScamAlert;
}

// Draft message options (used by the take-over / draft UI).
export interface DraftOption {
  label: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Chat API contract — request/response shapes for /api/chat (mode-switched).
// ---------------------------------------------------------------------------

export type ChatMode =
  | "onboarding"
  | "query_plan"
  | "normalize_listing"
  | "rank"
  | "persona_from_listing"
  | "agent_turn"
  | "seller"
  | "evaluate_offer"
  | "modify_logistics"
  | "reopen_counter"
  | "scam_check";

export interface ChatRequest {
  mode: ChatMode;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  context?: Record<string, unknown>;
}

export interface ChatResponse {
  reply: string;
}

// Structured payloads returned (inside `reply` JSON) by specific modes.

export interface AgentMove {
  message: string;
  newStage: NegotiationStage;
  currentPrice: number;
  reasoning: string;
}

export interface SellerReply {
  reply: string;
  newPrice: number | null;
}

export interface OfferVerdict {
  verdict: "accept" | "continue" | "walk_away";
  reasoning: string;
}
