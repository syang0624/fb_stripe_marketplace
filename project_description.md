# MRI — Market Research Intelligence

> An AI-powered marketplace agent that scrapes live listings, detects scams, negotiates deals autonomously, and uses vision models to inspect product photos for defects — all so the buyer doesn't have to.

## What It Does

MRI is an end-to-end buying agent for Facebook Marketplace. You tell it what you want, and it handles everything: finding listings, filtering junk, spotting scams, negotiating prices, and closing deals. The buyer stays in control but doesn't have to do the grunt work.

### The Problem

Buying used items on Facebook Marketplace is a painful, manual process. A search for "iPhone 15 Pro" returns hundreds of results — overpriced listings, vague descriptions, scammers asking for Venmo deposits, and maybe 2-3 genuinely good deals buried in the noise. Finding those deals takes expertise. Negotiating with multiple sellers in parallel takes time. Spotting scams before you've already driven across town takes experience most buyers don't have.

### The Solution

MRI automates the entire pipeline:

1. **Conversational onboarding** — A chat-based AI intake that collects what you're looking for, your budget, location, and availability in 3-4 natural questions
2. **Live marketplace scraping** — Pulls real listings from Facebook Marketplace via Bright Data's web scraping infrastructure, deduplicates, normalizes, and filters
3. **AI-powered ranking** — Scores listings on value, relevance, condition, distance, and risk. Surfaces the top 3 deals with explanations
4. **Autonomous parallel negotiation** — Runs 3 simultaneous negotiations against sellers, each with distinct personalities and strategies
5. **Scam detection** — Two-layer system that catches payment scams, shipping fraud, and social engineering in real-time, auto-stopping dangerous negotiations
6. **Visual defect detection** — Uses vision models to analyze product photos for scratches, cracks, screen damage, and other defects that sellers don't mention
7. **Deal closing** — Confirms price, meetup time/place, and extras. Buyer reviews and accepts.

---

## Architecture

### Infrastructure

**RunPod** — Hosts GPU-accelerated inference workloads for the AI pipeline:
- **LLM inference** — Runs the negotiation engine, deal analysis, scam checking, and conversational onboarding on NVIDIA GPU instances via RunPod's serverless endpoints. This keeps latency low and allows scaling to multiple simultaneous negotiations without queuing.
- **Vision model inference** — Powers the product image defect detection pipeline. Product photos are sent to a vision model hosted on RunPod that analyzes for physical damage (scratches, cracks, dents, screen burns, discoloration) and returns a structured condition report. This runs as a serverless function that spins up on demand when new listings are being evaluated.
- **Model flexibility** — RunPod's infrastructure allows swapping between models (Nemotron, LLaMA, Qwen) without changing application code, enabling rapid experimentation with negotiation strategies.

**Bright Data** — Powers the live marketplace data pipeline:
- **Web Scraper API** — Scrapes Facebook Marketplace search results and individual listing pages at scale. Handles Facebook's anti-bot protections, CAPTCHAs, and rate limiting transparently.
- **Structured data extraction** — Returns normalized listing data (title, price, location, seller, images, description) from raw Marketplace pages.
- **Geo-targeted scraping** — Searches are scoped to the buyer's location and radius, ensuring results are actually pickupable.
- **Image collection** — Pulls all product photos from listings for downstream visual analysis on RunPod.

### Application Stack

- **Next.js** (App Router) — Full-stack React framework
- **TypeScript** — End-to-end type safety
- **Tailwind CSS** — Styling
- **Single API route** (`/api/chat`) — Mode-switched endpoint handling onboarding, search planning, ranking, negotiation, seller simulation, scam checking, and offer evaluation

---

## Key Features

### Scam Detection

The scam detection system runs after every seller message during negotiation. It operates in two layers:

**Layer 1 — Pattern Matching (instant, zero latency)**
Nine regex-based rules catch the most common marketplace scams:
- Payment scams: Venmo, Zelle, CashApp, crypto, wire transfer, gift cards
- Shipping fraud: Offering to ship local-pickup items
- Pressure tactics: Fake competing buyers, artificial urgency
- Info harvesting: Requesting personal/financial information
- Off-platform: Pushing to external links or websites
- Refusal to meet: Won't allow in-person inspection

**Layer 2 — LLM Deep Analysis (for medium/high severity)**
When pattern matching flags something suspicious, the full conversation is sent to an LLM for contextual analysis. The LLM evaluates whether the flags are genuinely concerning or innocent (e.g., a seller mentioning "another buyer" in passing vs. using it as a pressure tactic).

**Severity levels:**
- **High** — Negotiation auto-stops immediately. Red shield badge, full-width alert banner, and flagged conversation view.
- **Medium** — Warning shown, negotiation continues with caution note.
- **Low** — Minor concern noted in agent reasoning.

In the demo, the third negotiation lane always uses a scam persona that triggers high-severity detection (requests Venmo deposit, offers shipping, refuses inspection), showcasing the system catching and stopping a scam in real-time.

### Self-Improving Negotiation Strategy

The negotiation engine doesn't use a fixed script. It adapts based on:

- **Conversation state tracking** — The agent tracks which stage it's in (outreach, price discovery, condition Q&A, counter offer, logistics, final offer) and progresses forward, never backward.
- **Seller behavior analysis** — Different seller personas (easy drop, firm price, condition issue, slow reply) trigger different negotiation tactics. The agent reads seller responses to detect flexibility signals and adjusts accordingly.
- **Buyer authority enforcement** — The agent operates within pre-set limits (walk-away price, auto-accept threshold, non-negotiables) and validates every potential deal against these before committing.
- **Offer evaluation loop** — Before locking a final offer, an independent evaluation step checks the deal against the buyer's constraints. If the price exceeds limits or a non-negotiable is triggered, the agent walks away automatically.
- **Cross-deal awareness** — Running 3 negotiations in parallel means the agent implicitly creates competition pressure. If one seller drops to a great price, the agent can close quickly instead of over-negotiating elsewhere.

The strategy improves across sessions by adjusting opening offers, concession patterns, and timing based on which approaches yield better price outcomes against different seller types.

### Web Scraping Pipeline

The search pipeline uses Bright Data to source live marketplace data:

1. **Query planning** — LLM converts the buyer profile into 3-6 search query variants (e.g., "iPhone 15 Pro", "iPhone 15 Pro Max", "used iPhone unlocked")
2. **Geo-located search** — Each query hits Facebook Marketplace through Bright Data's scraping API, scoped to the buyer's location and radius
3. **Deduplication** — Cross-query dedup removes listings that appeared in multiple searches
4. **Normalization** — Raw scrape data is normalized into a structured listing format with title, price, specs, images, seller info, and risk flags
5. **Relevance filtering** — Listings under $200, over 2x budget, or missing all search terms are dropped to prevent junk results
6. **Enrichment** — Top candidates get detailed item pages scraped for fuller descriptions, more photos, and seller history
7. **Hybrid ranking** — Deterministic scoring (value, relevance, condition, distance, risk) combined with LLM-powered analysis produces the final top 3

If live scraping returns no usable results, the system falls back to curated seed listings so the demo always works.

### Image Processing for Defect Detection

Product photos from listings are analyzed using vision models hosted on RunPod:

- **Scratch and crack detection** — Identifies surface damage on screens, backs, and edges that may not be mentioned in the listing description
- **Screen condition analysis** — Detects screen burns, dead pixels, discoloration, and display artifacts from photos
- **Cosmetic grading** — Assigns a condition grade (mint, good, fair, poor) based on visible wear patterns
- **Photo quality flags** — Warns when listing photos are blurry, stock images, or suspiciously few in number (a common scam indicator)
- **Inconsistency detection** — Cross-references visible condition in photos against the seller's text description. If the listing says "mint condition" but photos show scratches, it's flagged as a risk

The defect analysis feeds into the deal ranking score (condition component) and is surfaced to the buyer as part of each deal card's risk assessment.

---

## Demo Flow

1. **Chat with MRI** — Tell it what you want (e.g., "iPhone 15 Pro"), your location, budget, and availability. 4 questions, feels like texting a friend.

2. **Review top deals** — MRI presents 3 ranked listings with scores, pricing analysis, and risk flags. Select which ones to negotiate.

3. **Watch negotiations unfold** — 3 parallel lanes negotiate simultaneously:
   - Lane 1 (Mike): Friendly seller, drops price quickly, deal closes smoothly
   - Lane 2 (Sarah): Firm on price, eventually sweetens with extras (case, cable, original box)
   - Lane 3 (Rick): Asks for Venmo deposit — **scam detected**, negotiation auto-stopped with red shield badge and detailed flags

4. **Review final offers** — Accept the best deal, modify meetup logistics (defaults to Powell Station, SF), or decline. Scam-detected lane shown separately with full flag breakdown.

---

## Tech Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js, React, Tailwind CSS | Single-page app with chat UI, deal cards, negotiation dashboard |
| Backend | Next.js API Routes | Mode-switched endpoint for all AI operations |
| GPU Inference | RunPod (Serverless) | LLM negotiation, vision defect detection, scam analysis |
| Web Scraping | Bright Data | Facebook Marketplace search, listing detail, image collection |
| LLM | Nemotron / configurable | Onboarding, ranking, negotiation, seller simulation, evaluation |
| Vision | RunPod-hosted model | Product photo defect detection and condition grading |

---

## Project Structure

```
fb_marketplace_agent/
├── app/
│   ├── page.tsx                    # Main orchestrator (5-step state machine)
│   ├── layout.tsx                  # Root layout
│   ├── globals.css                 # Tailwind + custom styles
│   └── api/
│       ├── chat/route.ts           # Single mode-switched AI endpoint
│       └── marketplace/            # Bright Data proxy routes
│           ├── search/route.ts
│           ├── item/route.ts
│           └── location/route.ts
├── components/
│   ├── OnboardingChat.tsx          # AI chat intake
│   ├── SearchProgress.tsx          # Live search animation
│   ├── DealCards.tsx               # Top 3 deal presentation
│   ├── NegotiationDashboard.tsx    # 3-lane negotiation view
│   ├── NegotiationLane.tsx         # Individual deal lane (+ scam UI)
│   ├── ChatDrawer.tsx              # Full chat history drawer
│   ├── ChatBubble.tsx              # Message bubble component
│   ├── FinalOffersReview.tsx       # Accept/decline/modify offers
│   ├── StageTracker.tsx            # Negotiation stage progress
│   ├── ModifyDialog.tsx            # Edit meetup logistics
│   └── ProductImage.tsx            # Image with fallback
├── lib/
│   ├── types.ts                    # Shared type definitions
│   ├── prompts.ts                  # All LLM system prompts
│   ├── agent.ts                    # Autonomous negotiation engine
│   ├── scamDetection.ts           # Two-layer scam detection
│   ├── searchAgent.ts             # Search pipeline orchestrator
│   ├── scoring.ts                 # Deterministic deal scoring
│   ├── marketplace.ts             # Bright Data client helpers
│   ├── data.ts                    # Seller personas + fallback listings
│   └── parse.ts                   # JSON extraction utilities
└── package.json
```
