# Tech Spec: PedalBot v3 (Hackathon Build — Real Marketplace Search + Simulated Negotiation)

> An AI buying agent that searches Facebook Marketplace bike listings through ScrapeCreators, surfaces the top 3 deals, then **simulates autonomous negotiations with all three sellers in parallel** for the hackathon demo. The buyer sets the rules upfront, watches progress, and approves the final offers.

## What Changed From v2

v2 had the right autonomous negotiation story but an internal contradiction: it claimed to scan Facebook Marketplace while Step 2 and the build plan still used pre-seeded listings. v3 fixes that.

This version separates the product into two layers:

1. **Real search layer** — ScrapeCreators pulls live Facebook Marketplace listing data for the buyer's location and query.
2. **AI deal-selection layer** — the agent expands the buyer's search intent, deduplicates listings, enriches top candidates, scores deal quality, and picks the top 3.
3. **Simulated negotiation layer** — because ScrapeCreators does not send or receive Facebook seller messages, the demo uses seller personas to simulate negotiation against the real listing cards.

This keeps the demo honest: PedalBot really searches Marketplace, but it does not pretend to have official Facebook messaging access.

---

## Scope: What We're Actually Building in 90 Minutes

A single-page Next.js app with 4 steps, driven by state.

**Step 1 — Onboarding Chat:** AI asks what bike you want and extracts both search preferences and negotiation authority: budget, walk-away price, deadline, meet windows, dealbreakers, and location.

**Step 2 — Live Top 3 Deals:** AI turns the buyer's request into multiple Marketplace search queries, calls ScrapeCreators, deduplicates listings, fetches item details for promising results, scores them, and shows 3 cards. Buyer confirms which to negotiate.

**Step 3 — Negotiation Dashboard:** All 3 negotiations run autonomously in parallel using simulated seller personas generated from the live listing data. Each lane shows stage, latest price, agent reasoning, and chat preview. Buyer can click into any lane to see the chat or take over.

**Step 4 — Final Offers:** When all 3 negotiations reach Final Offer or Withdrawn, buyer sees cards with final price, meet time/place, extras, and Accept / Modify / Decline.

Demo ends when the buyer accepts a final offer.

### Demo honesty line

Say this in the pitch if asked:

> "Search is live through ScrapeCreators. Negotiation is simulated for the hackathon because Marketplace messaging is not exposed by this API. In a production version, we would either keep the user in the loop to send messages manually or integrate only with platforms that explicitly allow messaging automation."

---

## Why Guardrails Belong at Onboarding (Not Later)

This is the core architectural decision. The reasoning matters for the demo pitch:

The agent will be negotiating **without the buyer watching**. Every turn, it has to decide:

- Is this counter-offer good enough to accept?
- Is the seller's revealed condition issue, such as "fork was replaced," a dealbreaker?
- Is the proposed meet time/place workable?
- Are we approaching the buyer's price ceiling?

There are only three ways to handle these decisions:

1. **Ask the buyer every time** → defeats the whole point. The buyer is back in the loop on every message.
2. **Let the agent guess** → risk of committing to a bad deal or walking away from a good one.
3. **Pre-authorize at onboarding** → the buyer encodes their preferences once; the agent has clear authority to act within them.

Option 3 is the only one consistent with "the agent negotiates for you." Collecting authority mid-negotiation would mean interrupting the buyer exactly when the agent has the most leverage during a live exchange, which is the worst possible moment to break flow. Onboarding is the natural place because the buyer is already in a goal-setting mindset and has not yet committed mental energy to specific listings.

---

## Architecture

### AI Model: Nemotron 3 Ultra on GMI Cloud

All inference for the hackathon build goes through GMI Cloud's OpenAI-compatible chat completions API using NVIDIA Nemotron 3 Ultra.

```text
Provider: GMI Cloud Model Hub
Endpoint: https://api.gmi-serving.com/v1/chat/completions
Model: nvidia/nemotron-3-ultra-550b-a55b
API style: OpenAI-compatible chat completions
Context length: 262,144 tokens
Quantization: fp8
Architecture: 550B total parameters, 55B active parameters
Input price: $0.80 / 1M tokens
Output price: $2.60 / 1M tokens
Cache read price: $0.10 / 1M tokens
```

Why this model fits the demo:

- Long context is useful for combining buyer preferences, multiple live listing payloads, scoring evidence, and negotiation transcripts.
- Strong reasoning and tool-use behavior map well to query planning, ranking, seller-persona generation, offer evaluation, and staged negotiation.
- OpenAI-compatible API keeps the implementation simple with the existing `openai` SDK.

Use lower `temperature` for structured planning/ranking modes and slightly higher `temperature` for simulated seller/persona modes.

```text
Single Page App (app/page.tsx)
   │
   ├── Step 1: <OnboardingChat />        ← Nemotron on GMI Cloud collects profile + authority
   ├── Step 2: <DealCards />             ← ScrapeCreators + Nemotron ranking
   │     └── search pipeline             ← query planning → live search → dedupe → enrich → score
   ├── Step 3: <NegotiationDashboard />  ← autonomous simulated negotiation loop
   │     ├── <NegotiationLane /> × 3     ← each runs independently
   │     └── <ChatDrawer />              ← slides out when user clicks a lane
   └── Step 4: <FinalOffersReview />     ← Accept / Modify / Decline per offer
         └── <ModifyDialog />            ← edit price → reopen; edit logistics → reconfirm

API Routes (server-side):
   /api/chat                    → single route, switched by "mode" param
                                 uses OpenAI-compatible SDK pointed at GMI Cloud
   /api/marketplace/location    → calls ScrapeCreators location search
   /api/marketplace/search      → calls ScrapeCreators Marketplace Search
   /api/marketplace/item        → calls ScrapeCreators Marketplace Item
```

### Search/agent data flow

```text
Buyer request
   ↓
Onboarding profile + authority
   ↓
query_planner prompt
   ↓
Marketplace location resolver
   ↓
Marketplace search API across 3-6 query variants
   ↓
Deduplication by listing id / URL
   ↓
Initial deterministic filters: price, distance, availability, title relevance
   ↓
Item detail enrichment for top 10-15 candidates
   ↓
Hybrid scoring: deterministic score + LLM explanation
   ↓
Top 3 deal cards
   ↓
Simulated seller personas generated from listing data
   ↓
Parallel negotiation dashboard
```

The negotiation dashboard is still the heart of the app. The difference is that its input is now live Marketplace listing data instead of hardcoded listing cards.

---

## ScrapeCreators Integration

ScrapeCreators is the demo data provider. Treat it as an unofficial Marketplace data layer, not as an official Facebook API.

### Endpoints used

```text
GET /v1/facebook/marketplace/location/search
Purpose: turn a location string into coordinates usable by Marketplace search.

GET /v1/facebook/marketplace/search
Purpose: search Marketplace listings by query, lat/lng, radius, price filters, condition, date listed, availability, and cursor.

GET /v1/facebook/marketplace/item
Purpose: fetch item details by Marketplace item id or listing URL.
```

### Search endpoint parameters to support in v3

```typescript
interface MarketplaceSearchParams {
    query: string;
    lat: number;
    lng: number;
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
```

### Item endpoint parameters

```typescript
interface MarketplaceItemParams {
    id?: string;
    url?: string;
}
```

### Practical demo decision

Use live search for Step 2, but keep negotiation simulated. The API returns listing data; it does not expose a safe, official channel for sending/receiving Facebook Marketplace messages.

---

## Project Structure

```text
pedalbot/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/
│       ├── chat/
│       │   └── route.ts               # Nemotron calls through GMI Cloud
│       └── marketplace/
│           ├── location/route.ts      # ScrapeCreators location search
│           ├── search/route.ts        # ScrapeCreators listing search
│           └── item/route.ts          # ScrapeCreators item detail lookup
├── components/
│   ├── OnboardingChat.tsx             # Step 1: collects profile + authority
│   ├── SearchProgress.tsx             # Step 2: shows query expansion/search/enrichment progress
│   ├── DealCards.tsx                  # Step 2: top 3 live deal cards
│   ├── NegotiationDashboard.tsx       # Step 3: 3 lanes side-by-side
│   ├── NegotiationLane.tsx            # Single negotiation card with stage tracker
│   ├── StageTracker.tsx               # Pill row showing current stage
│   ├── ChatDrawer.tsx                 # Slide-out full chat + take-over controls
│   ├── FinalOffersReview.tsx          # Step 4: 3 final offer cards
│   ├── ModifyDialog.tsx               # Edit price or logistics on a final offer
│   └── ChatBubble.tsx                 # Shared
├── lib/
│   ├── types.ts                       # All TypeScript types
│   ├── prompts.ts                     # All system prompts
│   ├── marketplace.ts                 # ScrapeCreators client helpers
│   ├── searchAgent.ts                 # Query planning, dedupe, enrichment, scoring orchestration
│   ├── scoring.ts                     # Deterministic scoring helpers
│   ├── data.ts                        # Seller persona templates + fallback seeded listings
│   └── agent.ts                       # Autonomous simulated negotiation loop
├── .env.local
├── tailwind.config.ts
├── package.json
└── tsconfig.json
```

16 files that matter. The search layer adds three route files and three lib files; this is worth it because the demo claim becomes real.

---

## Data Models (`lib/types.ts`)

```typescript
// Buyer profile + negotiation authority — collected at onboarding
interface BuyerProfile {
    // Bike/search preferences
    bikeType: string;
    frameSize: string;
    budgetMin: number;
    budgetMax: number;
    preferences: string;
    location: string;
    lat?: number;
    lng?: number;
    searchRadiusKm: number;

    // Negotiation authority
    walkAwayPrice: number;        // hard ceiling — agent never exceeds
    autoAcceptThreshold: number;  // if seller offers <= this, agent closes immediately
    deadline: string;             // "by Saturday", "in 3 days", "no rush"
    meetRadius: number;           // miles from location
    meetWindows: string;          // "weekday evenings, weekend mornings"
    nonNegotiables: string[];     // ["must test ride", "no crash history"]
}

interface SearchPlan {
    location: string;
    lat?: number;
    lng?: number;
    radiusKm: number;
    minPrice?: number;
    maxPrice?: number;
    queries: string[];            // e.g. ["gravel bike", "Specialized Diverge", "Trek Checkpoint"]
    includeTerms: string[];       // terms that improve relevance
    excludeTerms: string[];       // e.g. ["kids", "parts", "broken"]
    condition?: string;
    dateListed?: string;
    countPerQuery: number;
}

interface MarketplaceRawListing {
    id?: string;
    url?: string;
    title?: string;
    price?: number;
    location?: string;
    image?: string;
    sellerName?: string;
    description?: string;
    distance?: string;
    listingDateText?: string;
    availabilityText?: string;
    raw: unknown;
}

interface Listing {
    id: string;
    url?: string;
    title: string;
    price: number;
    fairValue: number;             // estimated by scoring layer / LLM
    specs: string;
    image: string;
    sellerName: string;
    distance: string;
    description: string;
    location?: string;
    listingDateText?: string;
    availabilityText?: string;
    source: "scrapecreators" | "seeded_fallback";
    riskFlags: string[];
}

interface RankedDeal {
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

interface Message {
    role: "buyer" | "seller" | "system" | "agent_note";
    content: string;
    timestamp: number;
}

type NegotiationStage =
    | "outreach"
    | "price_discovery"
    | "condition_qa"
    | "counter_offer"
    | "logistics"
    | "final_offer"
    | "withdrawn";

interface Negotiation {
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
}

interface FinalOffer {
    listingId: string;
    sellerName: string;
    bikeTitle: string;
    finalPrice: number;
    meetTime: string;
    meetPlace: string;
    extras: string[];
    notes: string;
}

interface SellerPersona {
    name: string;
    style: string;
    priceFloor: number;
    hiddenInfo: string;
    concessionPattern: "easy_drop" | "firm_price" | "condition_issue" | "slow_reply";
}
```

---

## API Routes

### `/api/chat/route.ts`

One route for Nemotron calls through GMI Cloud. It remains mode-switched, but v3 adds modes for search planning and listing normalization.

```typescript
import OpenAI from "openai";

const client = new OpenAI({
    baseURL: `${process.env.GMI_API_BASE_URL}/v1`,
    apiKey: process.env.GMI_API_KEY,
});

const MODEL = process.env.GMI_MODEL || "nvidia/nemotron-3-ultra-550b-a55b";

// POST /api/chat
// Body: { mode, messages, context }

export async function POST(req: Request) {
    const { mode, messages, context } = await req.json();

    let systemPrompt: string;

    switch (mode) {
        case "onboarding":
            systemPrompt = ONBOARDING_PROMPT;
            break;
        case "query_plan":
            systemPrompt = queryPlannerPrompt(context.profile);
            break;
        case "normalize_listing":
            systemPrompt = normalizeListingPrompt(context.rawListing);
            break;
        case "rank":
            systemPrompt = rankingPrompt(context.profile, context.listings);
            break;
        case "persona_from_listing":
            systemPrompt = personaFromListingPrompt(context.listing, context.profile);
            break;
        case "agent_turn":
            systemPrompt = agentTurnPrompt(context.negotiation, context.profile);
            break;
        case "seller":
            systemPrompt = sellerPrompt(context.negotiation, context.persona);
            break;
        case "evaluate_offer":
            systemPrompt = evaluatePrompt(context.negotiation, context.profile);
            break;
        case "modify_logistics":
            systemPrompt = modifyLogisticsPrompt(context.negotiation, context.changes);
            break;
        case "reopen_counter":
            systemPrompt = reopenCounterPrompt(context.negotiation, context.newTarget);
            break;
        default:
            return Response.json({ error: "Invalid mode" }, { status: 400 });
    }

    const temperature =
        mode === "seller" || mode === "persona_from_listing" ? 0.7 : 0.2;

    const response = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 1000,
        temperature,
        messages: [
            { role: "system", content: systemPrompt },
            ...messages,
        ],
    });

    const text = response.choices[0]?.message?.content || "";
    return Response.json({ reply: text });
}
```

### `/api/marketplace/search/route.ts`

```typescript
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const upstream = new URL("https://api.scrapecreators.com/v1/facebook/marketplace/search");

    for (const [key, value] of searchParams.entries()) {
        upstream.searchParams.set(key, value);
    }

    const response = await fetch(upstream.toString(), {
        headers: {
            "x-api-key": process.env.SCRAPECREATORS_API_KEY!,
        },
        cache: "no-store",
    });

    const data = await response.json();
    return Response.json(data, { status: response.status });
}
```

### `/api/marketplace/item/route.ts`

```typescript
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const upstream = new URL("https://api.scrapecreators.com/v1/facebook/marketplace/item");

    const id = searchParams.get("id");
    const url = searchParams.get("url");
    if (id) upstream.searchParams.set("id", id);
    if (url) upstream.searchParams.set("url", url);

    const response = await fetch(upstream.toString(), {
        headers: {
            "x-api-key": process.env.SCRAPECREATORS_API_KEY!,
        },
        cache: "no-store",
    });

    const data = await response.json();
    return Response.json(data, { status: response.status });
}
```

---

## Search Agent (`lib/searchAgent.ts`)

This is the new piece that makes PedalBot feel like a real search agent instead of a search bar.

```typescript
export async function findTopDeals(profile: BuyerProfile): Promise<RankedDeal[]> {
    // 1. Ask LLM to expand the buyer request into a search plan.
    const plan = await callChat<SearchPlan>("query_plan", [], { profile });

    // 2. Resolve location if needed.
    const { lat, lng } = await resolveLocation(plan.location);

    // 3. Run multiple Marketplace searches.
    const rawResults: MarketplaceRawListing[] = [];
    for (const query of plan.queries) {
        const results = await searchMarketplace({
            query,
            lat,
            lng,
            radius_km: plan.radiusKm,
            min_price: plan.minPrice,
            max_price: plan.maxPrice,
            count: plan.countPerQuery,
            condition: plan.condition,
            date_listed: plan.dateListed,
            availability: "available",
        });
        rawResults.push(...results);
    }

    // 4. Deduplicate.
    const deduped = dedupeListings(rawResults);

    // 5. Normalize into our Listing shape.
    const normalized = deduped.map(normalizeMarketplaceListing);

    // 6. Pre-score cheaply before item enrichment.
    const candidates = normalized
        .map((listing) => ({ listing, preScore: quickScore(listing, profile, plan) }))
        .sort((a, b) => b.preScore - a.preScore)
        .slice(0, 12)
        .map((x) => x.listing);

    // 7. Fetch details only for likely candidates.
    const enriched = await Promise.all(candidates.map(enrichListing));

    // 8. Hybrid rank: deterministic scores + LLM summary.
    const ranked = await callChat<RankedDeal[]>("rank", [], {
        profile,
        listings: enriched,
    });

    return ranked.slice(0, 3);
}
```

### Dedupe rule

```typescript
function dedupeListings(raw: MarketplaceRawListing[]) {
    const seen = new Set<string>();
    return raw.filter((item) => {
        const key = item.id || item.url || `${item.title}-${item.price}-${item.location}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
```

### Scoring formula

Use a deterministic score first so the demo does not feel random.

```text
Final score =
  30% price value
  25% relevance to buyer request
  15% condition/spec quality
  10% distance / pickup fit
  10% recency / availability
  10% risk penalty
```

The LLM explains the ranking and fills in suggested first offer / max recommended price, but the app should compute the basic ordering deterministically.

---

## Prompts (`lib/prompts.ts`)

### Onboarding

```text
You are PedalBot, a practical bike-buying agent helping someone find a used bike.
You will search Marketplace and then negotiate in a simulated demo, so you need both search preferences and negotiation authority.

Collect in this order, ONE question at a time:
1. Bike type, frame size or rider height, and location
2. Budget range
3. Search radius
4. Walk-away price — the highest they would actually pay if it is the perfect bike
5. Auto-accept threshold — a price where they would want you to close immediately
6. Deadline — when they need the bike by
7. Meet preferences — how far they will travel and when they are free
8. Non-negotiables — crash history, no test ride, missing parts, suspicious seller behavior, etc.

After collecting everything, summarize the authority:
"So I'll search within X km of [location], target [bike type], negotiate up to $X, auto-accept at $Y, and walk away if I see [non-negotiables]. Sound right?"

When confirmed, respond with ONLY a JSON block with all fields from BuyerProfile.
```

### Query Planner

```text
You are the search-planning brain of PedalBot.
Convert the buyer profile into a Marketplace search plan.

Generate 3-6 query variants. Do not just repeat the buyer's words.
For bikes, include category terms, likely brand/model variants, and common seller wording.

Return ONLY JSON matching SearchPlan:
{
  "location": "...",
  "radiusKm": 25,
  "minPrice": 0,
  "maxPrice": 1200,
  "queries": ["gravel bike", "Specialized Diverge", "Trek Checkpoint"],
  "includeTerms": ["gravel", "road", "disc", "56cm"],
  "excludeTerms": ["kids", "broken", "parts only"],
  "condition": "used",
  "dateListed": "last_7_days",
  "countPerQuery": 20
}

Buyer profile: {profile}
```

### Ranking

```text
You are a used-bike expert and deal analyst.
Rank these Marketplace listings for this buyer.

Return ONLY a JSON array of the top 3:
[
  {
    "listingId": "...",
    "score": 0-100,
    "dealQuality": "great|good|fair",
    "valueScore": 0-100,
    "relevanceScore": 0-100,
    "conditionScore": 0-100,
    "distanceScore": 0-100,
    "riskScore": 0-100,
    "summary": "one line why this is a good or risky deal",
    "suggestedFirstOffer": 950,
    "maxRecommendedPrice": 1150
  }
]

Rules:
- Prefer listings that match bike type, size, budget, and distance.
- Penalize vague descriptions, missing photos, suspiciously low prices, and condition uncertainty.
- Never recommend a max price above the buyer's walk-away price.
- If a listing looks risky but still interesting, keep it only if the risk is clearly explained.

Buyer: {profile}
Listings: {listings}
```

### Persona From Listing

```text
Create a simulated Facebook Marketplace seller persona for this listing.
The persona should be plausible based on the listing price, description quality, and deal quality.

Return ONLY JSON matching SellerPersona:
{
  "name": "...",
  "style": "brief but responsive | friendly | firm | slow replies | evasive",
  "priceFloor": 900,
  "hiddenInfo": "a condition or logistics detail to reveal naturally after a few turns",
  "concessionPattern": "easy_drop|firm_price|condition_issue|slow_reply"
}

Rules:
- priceFloor must be below or equal to listing price.
- Use condition_issue for one of the three deals if the demo needs a non-negotiable trigger.
- Do not make every seller easy. The three lanes should demonstrate different outcomes.

Listing: {listing}
Buyer: {profile}
```

### Agent Turn

```text
You are negotiating on behalf of a buyer. The buyer is NOT watching — you have authority to act within their pre-set limits.

Buyer's authority:
- Walk-away price: ${walkAwayPrice}
- Auto-accept at or below: ${autoAcceptThreshold}
- Deadline: {deadline}
- Meet within {meetRadius} miles, windows: {meetWindows}
- Non-negotiables: {nonNegotiables}
- Style notes: {preferences}

Bike: {listing.title}, listed at ${listing.price}, fair value ${listing.fairValue}
Current stage: {stage}
Conversation so far: {messages}

Decide your next move and return ONLY this JSON:
{
  "message": "what to send the seller, 1-3 sentences, sounds human",
  "newStage": "outreach|price_discovery|condition_qa|counter_offer|logistics|final_offer|withdrawn",
  "currentPrice": <current price under discussion>,
  "reasoning": "one sentence — why this move, for the buyer's dashboard"
}

Rules:
- If seller offers <= autoAcceptThreshold, move to logistics immediately.
- If seller will not go below walkAwayPrice, move to withdrawn with a polite exit.
- If seller reveals something matching a non-negotiable, move to withdrawn.
- Ask condition questions before locking a final offer.
- Progress stages forward, not backward, except when buyer reopens a counter.
- Once price + meet time + meet place are all agreed, move to final_offer.
```

### Seller Simulation

```text
You are {persona.name}, selling a {listing.title} on Facebook Marketplace.
Style: {persona.style}
Your lowest price: ${persona.priceFloor}. Never go below this.
Hidden info: {persona.hiddenInfo}
Concession pattern: {persona.concessionPattern}

Conversation so far: {messages}

Reply in 1-2 sentences. Stay in character. Respond as JSON:
{"reply": "...", "newPrice": null_or_number}
```

### Evaluate Offer

```text
Before locking this as a final offer, check it against the buyer's authority.
Return ONLY JSON: {"verdict": "accept|continue|walk_away", "reasoning": "..."}

Buyer's limits: walkAway=${walkAwayPrice}, autoAccept=${autoAcceptThreshold}, non-negotiables=[{nonNegotiables}]
Current state of negotiation: {negotiation}
```

### Modify Logistics

```text
The buyer wants to change the meet details on a deal that was already agreed.
The price stays the same — only the meeting time or place is changing.

Original meet: {originalMeetTime} at {originalMeetPlace}
New meet: {newMeetTime} at {newMeetPlace}

Generate a short, friendly message to the seller proposing the change.
Return ONLY JSON: {"message": "..."}
```

### Reopen Counter

```text
The buyer reviewed your final offer of ${finalPrice} and wants you to push for ${newTarget} instead.
Re-engage the seller and counter.

Context: {negotiation}

Return ONLY JSON:
{"message": "the counter to send", "reasoning": "how I'm framing this"}
```

---

## The Agent Loop (`lib/agent.ts`)

This remains the orchestration layer for simulated negotiation. Each negotiation runs as an independent async loop.

```typescript
async function runNegotiation(neg: Negotiation, profile: BuyerProfile, onUpdate: (n: Negotiation) => void) {
    while (neg.stage !== "final_offer" && neg.stage !== "withdrawn") {
        if (neg.userTookOver) {
            await waitForUserAction();
            continue;
        }

        const agentMove = await callApi("agent_turn", neg.messages, {
            negotiation: neg,
            profile,
        });

        neg.messages.push({ role: "buyer", content: agentMove.message, timestamp: Date.now() });
        neg.messages.push({ role: "agent_note", content: agentMove.reasoning, timestamp: Date.now() });
        neg.stage = agentMove.newStage;
        neg.currentPrice = agentMove.currentPrice;
        neg.agentReasoning = agentMove.reasoning;
        onUpdate(neg);

        if (neg.stage === "withdrawn" || neg.stage === "final_offer") break;

        await sleep(1500 + Math.random() * 1500);

        const sellerReply = await callApi("seller", neg.messages, {
            negotiation: neg,
            persona: neg.persona,
        });

        neg.messages.push({ role: "seller", content: sellerReply.reply, timestamp: Date.now() });
        if (sellerReply.newPrice) neg.currentPrice = sellerReply.newPrice;
        onUpdate(neg);

        await sleep(1000);
    }

    if (neg.stage === "final_offer") {
        neg.finalOffer = extractFinalOffer(neg);
        onUpdate(neg);
    }
}

function startAll(negotiations: Negotiation[], profile: BuyerProfile, onUpdate: (n: Negotiation) => void) {
    negotiations.forEach((neg) => runNegotiation(neg, profile, onUpdate));
}
```

The three negotiations run in parallel — no shared lock, each ticks at its own pace. The dashboard re-renders whenever any lane updates.

---

## Component Specs

### `app/page.tsx` — Main Page

```typescript
const [step, setStep] = useState<"onboarding" | "searching" | "deals" | "negotiate" | "review">("onboarding");
const [profile, setProfile] = useState<BuyerProfile | null>(null);
const [searchPlan, setSearchPlan] = useState<SearchPlan | null>(null);
const [deals, setDeals] = useState<RankedDeal[]>([]);
const [negotiations, setNegotiations] = useState<Negotiation[]>([]);

useEffect(() => {
  const allDone = negotiations.length === 3 &&
    negotiations.every(n => n.stage === "final_offer" || n.stage === "withdrawn");
  if (allDone && step === "negotiate") setStep("review");
}, [negotiations, step]);
```

### `OnboardingChat.tsx`

Same shape as v2, but now it must collect `searchRadiusKm` and optionally resolve `lat/lng` after location confirmation.

### `SearchProgress.tsx`

New. Shows the agentic search loop so the demo feels alive:

- "Expanding query: gravel bike → Specialized Diverge, Trek Checkpoint, endurance road bike"
- "Searching within 25 km of San Francisco"
- "Found 47 listings"
- "Removed 12 duplicates"
- "Fetching details for 10 likely candidates"
- "Ranking top 3 by value, fit, risk, and pickup convenience"

This component is important. Without it, live search feels like a normal loading spinner.

### `DealCards.tsx`

Now receives `RankedDeal[]` from live search. Each card shows:

- Bike title + image
- Price and estimated fair value
- Location / distance
- Deal score
- Risk flags
- Suggested first offer
- Max recommended price
- Short explanation
- Source badge: `Live Marketplace via ScrapeCreators`

After buyer confirms which deals to pursue, generate one seller persona per listing and transition to the negotiation dashboard.

### `NegotiationDashboard.tsx`

Three-lane layout, each lane is a `NegotiationLane`. Shared state at this level; updates from the agent loop trigger re-renders.

Header copy should be honest:

> "PedalBot is simulating negotiations against the live listings you selected."

Do not say it is messaging real Facebook sellers.

### `NegotiationLane.tsx`

Each lane shows:

- Bike title + thumbnail
- `StageTracker` pill row
- Current price
- Latest agent reasoning
- Last 1-2 messages preview
- Buttons: "View full chat" and "Take over"

### `StageTracker.tsx`

Pill row: `Outreach → Price → Condition → Counter → Logistics → Final`. Current stage highlighted; completed stages checked; future stages dimmed. If `withdrawn`, show a red "Walked away" badge.

### `ChatDrawer.tsx`

Slides out from the right. Shows message history including `agent_note` entries, styled distinctly. Has a "Take over" button that flips `neg.userTookOver = true` and gives the buyer a text input. Buyer can hit "Return control to PedalBot" to resume autonomous mode.

### `FinalOffersReview.tsx`

Three cards, one per negotiation that reached `final_offer`. Each card shows:

- Bike title + image
- Final price with savings vs original listing
- Meet time and meet place
- Extras included
- Agent's summary note
- Buttons: Accept, Modify, Decline

Withdrawn negotiations are shown collapsed below with the reason.

### `ModifyDialog.tsx`

Two tabs:

- **Logistics:** edit meet time/place. Calls `mode: "modify_logistics"`, sends confirmation message to simulated seller, waits for seller ack, updates the card.
- **Price / terms:** enter a new target price. Flips stage back to `counter_offer`, sets a new `targetPrice`, and lets the agent loop re-engage.

### `ChatBubble.tsx`

Same as v2, plus `agent_note` style: centered, italic, muted.

---

## Demo Data (`lib/data.ts`)

v3 should not use pre-seeded listings as the main path. It uses:

1. **Live listing data** from ScrapeCreators for Step 2.
2. **Seller persona templates** for simulated negotiation.
3. **Fallback seeded listings** only if the ScrapeCreators API fails during the demo.

### Persona templates

```typescript
export const personaTemplates = [
  {
    name: "Mike",
    style: "friendly and responsive",
    concessionPattern: "easy_drop",
    hiddenInfo: "has another buyer interested but prefers a quick pickup",
  },
  {
    name: "Sarah",
    style: "firm on price but willing to include extras",
    concessionPattern: "firm_price",
    hiddenInfo: "can include a saddle bag and spare tubes if buyer does not push too hard on price",
  },
  {
    name: "Dave",
    style: "brief and slightly evasive",
    concessionPattern: "condition_issue",
    hiddenInfo: "the bike had a fork replacement after a crash, revealed only when asked directly",
  },
  {
    name: "Jen",
    style: "slow replies but honest",
    concessionPattern: "slow_reply",
    hiddenInfo: "available only on Sunday afternoon",
  }
];
```

Fallback listings should exist, but the UI should label them as fallback data if used.

---

## Environment Variables

When deployed on GMI Cloud, the model API variables may be injected automatically at runtime. ScrapeCreators still needs its own API key.

```env
# GMI Cloud Model Hub — OpenAI-compatible Nemotron API
GMI_API_BASE_URL=https://api.gmi-serving.com
GMI_API_KEY=your-gmi-api-key
GMI_MODEL=nvidia/nemotron-3-ultra-550b-a55b

# ScrapeCreators — live Marketplace search data provider
SCRAPECREATORS_API_KEY=your-scrapecreators-api-key
```

| Variable | Description | Example |
| --- | --- | --- |
| `GMI_API_BASE_URL` | OpenAI-compatible base URL for GMI Cloud Model Hub. | `https://api.gmi-serving.com` |
| `GMI_API_KEY` | GMI Cloud API key. Injected by GMI at runtime if available. | injected / local secret |
| `GMI_MODEL` | Nemotron model ID your agent calls. | `nvidia/nemotron-3-ultra-550b-a55b` |
| `SCRAPECREATORS_API_KEY` | API key for ScrapeCreators Marketplace endpoints. | local secret |

No Anthropic or OpenAI API key needed — all inference goes through Nemotron on GMI Cloud.

---

## Build Plan (90 Minutes)

### Minute 0-10: Scaffold

- `npx create-next-app@latest pedalbot --typescript --tailwind --app`
- Folder structure, dependencies, `.env.local`
- Copy `lib/types.ts`, `lib/prompts.ts`, `lib/data.ts`
- Set up GMI Cloud env vars and `SCRAPECREATORS_API_KEY`

### Minute 10-25: API Route + Onboarding

- Build `/api/chat/route.ts` using OpenAI SDK pointed at GMI Cloud
- Implement modes: `onboarding`, `query_plan`, `rank`, `persona_from_listing`, `agent_turn`, `seller`, `evaluate_offer`, `modify_logistics`, `reopen_counter`
- Build `ChatBubble.tsx`
- Build `OnboardingChat.tsx`
- Test: full `BuyerProfile` JSON gets extracted

### Minute 25-45: Live Search Layer

- Build `/api/marketplace/search/route.ts`
- Build `/api/marketplace/item/route.ts`
- Optional: build `/api/marketplace/location/route.ts`; hardcode SF coordinates if time is tight
- Build `lib/marketplace.ts`
- Build `lib/searchAgent.ts`
- Test: buyer profile → query plan → live Marketplace results → normalized listings

### Minute 45-55: Deal Cards + Scoring

- Build `SearchProgress.tsx`
- Update `DealCards.tsx` to show live results
- Implement dedupe + quick deterministic score
- Hook up `mode: "rank"` for top 3 explanations and suggested offers
- Test: onboarding → search progress → top 3 live deals

### Minute 55-70: Agent Loop + Dashboard

- `lib/agent.ts` — implement `runNegotiation` and `startAll`
- `StageTracker.tsx`
- `NegotiationLane.tsx`
- `NegotiationDashboard.tsx`
- Generate seller personas from live listings
- Test: dashboard ticks, stages advance, prices update, all 3 reach terminal stage

### Minute 70-80: Chat Drawer + Take-Over

- `ChatDrawer.tsx` — full message history, take-over toggle, manual send
- Wire `userTookOver` pause into the agent loop
- Test: can interrupt one negotiation while the other two keep running

### Minute 80-88: Final Offers Review

- `FinalOffersReview.tsx` — final cards with Accept / Modify / Decline
- `ModifyDialog.tsx` — logistics tab and price tab
- Wire `modify_logistics` and `reopen_counter` modes
- Test: can modify logistics and reopen price negotiation

### Minute 88-90: Polish + Demo Prep

- Add fallback seeded listings if live API fails
- Add source badge: `Live Marketplace via ScrapeCreators`
- Animations on price changes and stage transitions
- Run the full flow end-to-end with the demo script

---

## What We're Cutting

| Possible Feature | Hackathon Build |
| --- | --- |
| Official Facebook Marketplace API | ScrapeCreators unofficial Marketplace data provider |
| Real Facebook seller messaging | Simulated seller personas based on live listings |
| Full location autocomplete | Location API if quick; otherwise hardcoded SF/Santa Clara coordinates |
| Persistent storage / accounts | In-memory `useState` only |
| Mobile responsive | Desktop only |
| Real-time streaming responses | Sequential API calls with loading states |
| Sophisticated stage classifier | LLM decides stage in `agent_turn` |
| Multi-buyer / multi-session | One buyer, one session |
| Full production compliance review | Demo-only framing and honest disclaimers |
| Agent learns buyer's negotiation style | Cut |
| Counter-offer transcript export | Cut |
| Auth + payments | Cut |

This table is the cleanest way to avoid overclaiming. The demo has real search, not real seller messaging.

---

## Demo Script

1. **Open the app.** "PedalBot is an AI buying agent for Facebook Marketplace. It searches live listings, finds the best bike deals, and simulates how it would negotiate with sellers."
2. **Type:** "Looking for a gravel bike for weekend rides, around $1,000, near San Francisco."
3. **AI asks follow-ups** — bike type, size, budget, search radius, walk-away price, auto-accept threshold, deadline, meet preferences, non-negotiables. Pause on the non-negotiables question: "I'll say no crash history — that's going to matter later."
4. **Profile confirmed.** SearchProgress appears: "Expanding search terms," "Searching Marketplace," "Removing duplicates," "Fetching details," "Ranking deals."
5. **Top 3 live deals appear.** Point to the source badge: "These listings came from the Marketplace data provider, not from a static demo file."
6. **Confirm all 3.** "Now PedalBot creates simulated seller personas from those listings and negotiates with all three at the same time."
7. **Dashboard view.** Three lanes tick through stages. Point at one lane: "The agent is pushing price down." Point at another: "This seller is firm, so the agent is trying to get accessories included." Point at the risk lane: "Here it asked directly about crash history and walked away."
8. **Click a lane → drawer opens.** Show message history and agent reasoning notes.
9. **All three reach terminal.** Auto-advance to Final Offers.
10. **Final Offers screen.** Show two final offers and one withdrawn card. Emphasize final price, meet time/place, extras, and why the agent walked away.
11. **Click Modify.** Change meet time. Watch the simulated confirmation message.
12. **Click Accept.** Done. "PedalBot turned a vague buying request into live search, ranked deals, negotiation strategy, and a final decision."

---

## Dependencies

```json
{
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "openai": "^4"
  }
}
```

Still four production deps. `fetch` is built into the Next.js runtime, so ScrapeCreators does not need another SDK.

---

## Strategic Note

The stronger demo is not "we scrape Facebook." That sounds fragile and legally messy.

The stronger demo is:

> "PedalBot is a secondhand buying agent. It turns a vague request into live marketplace search, deal ranking, scam/risk filtering, and negotiation strategy."

ScrapeCreators is just the data pipe. The agent intelligence is query planning, deduplication, deal scoring, risk detection, and autonomous negotiation behavior.
