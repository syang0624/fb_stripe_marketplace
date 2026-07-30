# MVP Ideation: PedalBot — AI-Powered Used Bike Deal Finder & Negotiation Assistant

> An AI assistant that scans Facebook Marketplace bike listings to surface the top 3 deals and manages parallel negotiations with sellers so buyers get the best bike at the best price.

## Problem Definition

Facebook Marketplace is flooded with used bicycle listings. In any metro area, a search for "road bike" returns hundreds of results — different brands, component specs, conditions, prices, and sellers. Most of these listings are overpriced, poorly described, or not worth pursuing. But buried in the noise are 2–3 genuinely good deals, and the buyer who finds them first and negotiates well walks away with a great bike at a fair price.

The problem is that finding those deals requires expertise most buyers don't have, and capitalizing on them requires negotiating with multiple sellers in parallel — comparing responses, playing offers against each other, and converging on the best outcome across several simultaneous conversations.

**No tool exists for this.** The buyer is on their own — scrolling through 100+ listings, Googling component specs, and juggling 3 Messenger threads between meetings.

## Target Audience

Casual-to-enthusiast cyclists, age 25–45, buying used bikes on Facebook Marketplace in the $300–$3,000 range. They're employed full-time, buy a used bike every 1–3 years, know enough about bikes to have preferences but not enough to evaluate listings confidently, and would happily pay for a tool that does the hard work for them.

## The One Critical Pain Point

**"There are 200 listings and I have no idea which 3 are actually worth my time."**

The pain is two-layered: first, the buyer can't efficiently evaluate dozens of listings to find the best deals (discovery). Second, once they shortlist 3 sellers, they can't effectively negotiate with all of them in parallel (execution). Most buyers give up and settle for the first "good enough" listing.

---

## Demo Scope

This MVP is a **demo/prototype** designed to showcase the core user experience and value proposition. Some features use real data and AI; others are simulated on the frontend.

### What's Real

- **Onboarding flow:** AI-powered conversational intake that asks the buyer what they're looking for, follows up with smart clarifying questions, and builds a buyer profile
- **Deal discovery:** Top 3 listing recommendations (sourced via Meta/Facebook Marketplace API if available, or pre-seeded demo data as fallback)
- **AI logic:** LLM-powered question generation, deal analysis, and message drafting

### What's Faked (Frontend Simulation)

- **Seller messaging:** The negotiation UI looks and feels like a real messaging interface, but seller replies are simulated (scripted or LLM-generated responses). No actual messages are sent to real sellers.
- **Real-time notifications:** Simulated push notifications and timing suggestions
- **Seller responsiveness patterns:** Pre-programmed seller personas (e.g., one is flexible, one is firm, one goes cold)

---

## User Flow

### Screen 1: Onboarding Chat

A conversational AI interface that feels like talking to a knowledgeable friend at a bike shop.

**Step 1 — Initial ask:**
"What kind of bike are you looking for?"

User might say: "A gravel bike for weekend rides, around $1,000"

**Step 2 — Smart follow-ups (AI-generated, 2–4 questions):**

- "What size do you ride? Or tell me your height and I'll figure it out."
- "Any brand preferences, or open to anything?"
- "Do you care about disc brakes vs. rim brakes?"
- "How far are you willing to drive to pick it up?"

**Step 3 — Profile confirmation:**
AI summarizes: "Got it — you're looking for a gravel bike, size 56cm, $800–$1,200, disc brakes preferred, within 25 miles. Sound right?"

User confirms or adjusts.

### Screen 2: Top 3 Deals

The AI presents 3 ranked listings in a card layout.

Each card shows:

- Bike photo (from listing)
- Title: year, brand, model
- Listed price vs. AI-estimated fair value (e.g., "$1,100 listed · ~$1,300 fair value · 15% below market")
- Key specs: frame material, groupset, wheel size, condition
- AI's one-line take: "Best overall value" / "Needs inspection but great price" / "Motivated seller — room to negotiate"
- Deal quality badge: Great Deal / Good Deal / Fair Price
- "Start Negotiation" button

### Screen 3: Parallel Negotiation Dashboard

After the buyer selects which sellers to contact (up to 3), they enter a split-view negotiation interface.

**Layout:**

- Left panel: conversation list (like Messenger sidebar) showing all active negotiations
- Center panel: active chat thread with the selected seller
- Right panel: deal comparison card (live-updating as negotiations progress)

**Chat behavior (simulated):**

- AI drafts an opening message for each seller. Buyer reviews and "sends."
- Simulated seller replies appear after a short delay (5–15 seconds in demo mode)
- AI drafts follow-up responses. Buyer can approve, edit, or choose from 3 options (counter / accept / ask a question)
- Seller personas are pre-programmed:
    - **Seller A:** Friendly, flexible on price, available this weekend
    - **Seller B:** Firm on price but willing to throw in accessories
    - **Seller C:** Slow to reply, eventually drops price significantly

**Right panel (deal comparison) updates in real-time:**

- Current offer for each deal
- Seller flexibility rating
- Conversation stage
- AI recommendation: "Seller A is your best bet — close at $950"

### Screen 4: Deal Closed

When the buyer accepts a deal:

- Confirmation screen with final price, savings vs. listed price, and savings vs. market value
- Pre-purchase inspection checklist for the test ride
- Polite exit messages auto-drafted for the other sellers
- Summary: "You saved $200 vs. asking price and $350 vs. market value"

---

## Tech Stack

### Framework

- **Next.js** (App Router) — full-stack React framework
- **TypeScript**

### Frontend

- **React** with Next.js server and client components
- **Tailwind CSS** for styling
- **Shadcn/ui** for component primitives (cards, buttons, chat bubbles, badges)

### AI / Backend

- **Anthropic Claude API** — powers the conversational onboarding, deal analysis, and message drafting
- System prompts for each phase:
    - Onboarding prompt: extracts buyer preferences through natural conversation
    - Deal analysis prompt: evaluates listings and generates rankings
    - Negotiation prompt: drafts contextual buyer messages given conversation history and cross-deal state
    - Seller simulation prompt: generates realistic seller replies with pre-defined personas

### Data

- **Facebook Marketplace via Meta API** (if API access is available) for real listing data
- **Fallback:** Pre-seeded demo listings (6–10 realistic bike listings with photos, descriptions, and pricing) stored as JSON or in a lightweight database (SQLite / Postgres via Prisma)

### Hosting

- **Vercel** (natural fit for Next.js)

---

## Core Feature Breakdown

### F1: Conversational Onboarding

- Chat-style UI powered by Claude API
- AI asks initial question, then generates 2–4 contextual follow-ups based on the buyer's answers
- Produces a structured buyer profile (JSON) used by all downstream features
- Ends with a confirmation summary the buyer can approve or adjust

### F2: Deal Ranker

- Takes the buyer profile and evaluates available listings
- Scores on: price vs. fair value, component quality, listing completeness, distance, red flags
- Returns top 3 as ranked cards with explanations
- **Real if Meta API is available; demo data otherwise**

### F3: Simulated Negotiation Chat

- Messenger-style chat UI (chat bubbles, timestamps, typing indicators)
- AI drafts buyer messages; buyer approves/edits before "sending"
- Seller replies are LLM-generated using persona prompts (flexible, firm, cold)
- Each conversation runs independently with its own state
- **Fully simulated — no real messages sent**

### F4: Cross-Deal Dashboard

- Side panel showing all active deals compared
- Updates as conversations reveal new info (price drops, dealbreakers)
- AI generates a recommendation when a clear winner emerges
- Simple data: current price, original price, deal score, conversation status

### F5: Deal Closure Flow

- Confirmation screen with savings summary
- Auto-drafted exit messages for rejected sellers
- Inspection checklist (static content, bike-type-specific)

---

## Page Structure (Next.js Routes)

```
/                     → Landing / start page
/onboarding           → Conversational AI intake (Screen 1)
/deals                → Top 3 deal results (Screen 2)
/negotiate            → Parallel negotiation dashboard (Screen 3)
/negotiate/[sellerId] → Individual chat thread
/closed               → Deal closed summary (Screen 4)
```

---

## Key Demo Scenarios

For demo purposes, the app ships with 3 pre-built scenarios that showcase different outcomes:

**Scenario 1: "The Easy Win"**
Buyer finds a great deal, seller is flexible, deal closes quickly at 15% below asking.

**Scenario 2: "The Standoff"**
Two sellers are firm. AI helps the buyer use leverage from the third (cheaper) option to extract a concession.

**Scenario 3: "The Dealbreaker"**
Mid-negotiation, a seller reveals the bike was in a crash. AI flags the dealbreaker, buyer pivots to another deal.

---

## Features Explicitly Deferred (Post-Demo)

- Real Messenger integration (actual messages to real sellers)
- Continuous listing monitoring and alerts
- More than 3 parallel conversations
- Seller-side tool
- In-app payment or escrow
- Bike fit recommendations
- Stolen bike registry checks
- Expansion beyond Facebook Marketplace

---

_Next steps: wireframes, component architecture, and API prompt design._
