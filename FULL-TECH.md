# Tech Spec: PedalBot (Hackathon Build — 1 Hour)

> An AI assistant that scans Facebook Marketplace bike listings to surface the top 3 deals and manages parallel negotiations with sellers so buyers get the best bike at the best price.

## Scope: What We're Actually Building in 1 Hour

A single-page Next.js app with 3 steps, driven by state — no complex routing.

**Step 1 — Onboarding Chat:** AI asks what bike you want, follows up, builds a profile.
**Step 2 — Top 3 Deals:** AI scores pre-seeded listings against profile, shows 3 cards.
**Step 3 — Negotiation Chat:** Buyer picks a deal, chats with a simulated seller via tabbed conversations. Seller replies are LLM-generated. Buyer approves AI-drafted messages.

That's it. No closing screen, no inspection checklists, no comparison panel. The demo ends when the buyer accepts a price or the audience claps.

---

## Architecture

```
Single Page App (app/page.tsx)
   │
   ├── Step 1: <OnboardingChat />    ← Claude API
   ├── Step 2: <DealCards />         ← Claude API + demo data
   └── Step 3: <NegotiationView />   ← Claude API (buyer draft + seller sim)
         ├── Tab bar (Seller A | Seller B | Seller C)
         └── <ChatWindow /> per seller

API Routes (server-side, keeps API key safe):
   /api/chat   → single route, handles all Claude calls via "mode" param
```

Everything goes through **one API route** with a `mode` field to keep it simple. No separate routes per feature.

---

## Project Structure

```
pedalbot/
├── app/
│   ├── layout.tsx          # Root layout, font, global styles
│   ├── page.tsx            # Single page — all 3 steps live here
│   └── api/
│       └── chat/
│           └── route.ts    # Single API route for all Claude calls
├── components/
│   ├── OnboardingChat.tsx  # Step 1: conversational intake
│   ├── DealCards.tsx       # Step 2: top 3 deal cards
│   ├── NegotiationView.tsx # Step 3: tabbed chat with sellers
│   ├── ChatBubble.tsx      # Shared: single message bubble
│   └── DraftOptions.tsx    # Shared: approve/pick AI draft
├── lib/
│   ├── types.ts            # All TypeScript types
│   ├── prompts.ts          # All system prompts
│   └── data.ts             # Demo listings + seller personas
├── .env.local
├── tailwind.config.ts
├── package.json
└── tsconfig.json
```

10 files that matter. That's the whole app.

---

## Data Models (`lib/types.ts`)

Keep types minimal. Only what's needed to render UI and call APIs.

```typescript
// Buyer profile — extracted by onboarding AI
interface BuyerProfile {
    bikeType: string;
    frameSize: string;
    budgetMin: number;
    budgetMax: number;
    preferences: string; // freeform catch-all from conversation
    location: string;
}

// A marketplace listing (demo data)
interface Listing {
    id: string;
    title: string; // "2021 Specialized Diverge Comp"
    price: number;
    fairValue: number;
    specs: string; // "Shimano GRX 600, aluminum, disc brakes"
    condition: string;
    image: string; // URL or /bikes/1.jpg
    sellerName: string;
    distance: string; // "8 miles away"
    description: string;
}

// AI-scored deal
interface RankedDeal {
    listing: Listing;
    score: number;
    dealQuality: "great" | "good" | "fair";
    summary: string; // AI one-liner
}

// Chat message
interface Message {
    role: "buyer" | "seller" | "system" | "draft";
    content: string;
    timestamp: number;
}

// Per-seller negotiation
interface Negotiation {
    sellerId: string;
    sellerName: string;
    listing: Listing;
    messages: Message[];
    currentPrice: number;
    persona: SellerPersona;
}

// Seller behavior config
interface SellerPersona {
    name: string;
    style: string; // prompt snippet: "friendly, drops price easily"
    priceFloor: number; // lowest they'll go (absolute $)
    hiddenInfo: string; // revealed after 3+ messages, e.g. "was in a crash"
}
```

---

## Single API Route (`app/api/chat/route.ts`)

One route, one Claude call, switched by `mode`.

```typescript
// POST /api/chat
// Body: { mode, messages, context }

export async function POST(req: Request) {
    const { mode, messages, context } = await req.json();

    let systemPrompt: string;

    switch (mode) {
        case "onboarding":
            systemPrompt = ONBOARDING_PROMPT;
            break;
        case "rank":
            systemPrompt = rankingPrompt(context.profile, context.listings);
            break;
        case "draft":
            systemPrompt = draftPrompt(context.negotiation, context.profile);
            break;
        case "seller":
            systemPrompt = sellerPrompt(context.negotiation, context.persona);
            break;
        default:
            return Response.json({ error: "Invalid mode" }, { status: 400 });
    }

    const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages,
    });

    const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

    return Response.json({ reply: text });
}
```

---

## Prompts (`lib/prompts.ts`)

### Onboarding

```
You are PedalBot, a friendly bike expert helping someone find a used bike.

Collect: bike type, frame size (or height), budget range, key preferences,
and location/pickup radius. Ask ONE question at a time. Be conversational
— you're a friend at a bike shop, not a form.

After collecting everything, summarize and ask to confirm. When confirmed,
respond with ONLY a JSON block: {"bikeType": "...", "frameSize": "...",
"budgetMin": N, "budgetMax": N, "preferences": "...", "location": "..."}
```

### Ranking

```
You are a used bike market expert. Score these listings for this buyer.
Return ONLY a JSON array of the top 3:
[{"listingId": "...", "score": N, "dealQuality": "great|good|fair",
  "summary": "one line why"}]

Buyer: {profile}
Listings: {listings}
```

### Buyer Draft

```
Draft a short Messenger reply for this buyer. Context:
- Buyer style: {profile.preferences}
- Conversation so far: {messages}
- Bike: {listing.title} at ${currentPrice}

Give 2 options as JSON: [{"label": "short label", "content": "message"}]
Keep messages to 1-3 sentences. Sound human, not corporate.
```

### Seller Simulation

```
You are {persona.name}, selling a {listing.title} on Facebook Marketplace.
Style: {persona.style}
Your lowest price: ${persona.priceFloor}. Never go below this.
Hidden info (reveal naturally after a few messages): {persona.hiddenInfo}

Conversation so far: {messages}

Reply in 1-2 sentences. Stay in character. Respond as JSON:
{"reply": "...", "newPrice": null_or_number}
```

---

## Component Specs

### `app/page.tsx` — Main Page

```typescript
// State machine — just one useState
const [step, setStep] = useState<"onboarding" | "deals" | "negotiate">("onboarding");
const [profile, setProfile] = useState<BuyerProfile | null>(null);
const [deals, setDeals] = useState<RankedDeal[]>([]);
const [negotiations, setNegotiations] = useState<Negotiation[]>([]);

// Render
switch (step) {
  case "onboarding":  return <OnboardingChat onComplete={handleProfileDone} />;
  case "deals":       return <DealCards deals={deals} onSelect={handleStartNegotiation} />;
  case "negotiate":   return <NegotiationView negotiations={negotiations} profile={profile} />;
}
```

No context provider, no reducer. Just `useState` at the top level, pass props down.

### `OnboardingChat.tsx`

- Renders a scrollable list of `ChatBubble` components
- Text input at bottom
- On send: POST to `/api/chat` with `mode: "onboarding"` and full message history
- Watches for JSON in AI reply → parse as `BuyerProfile` → call `onComplete(profile)`
- Auto-scrolls to bottom on new messages

### `DealCards.tsx`

- Receives `deals: RankedDeal[]` as props
- Renders 3 cards in a row (grid or flex)
- Each card: image, title, price vs fair value, deal badge (color-coded), AI summary
- "Negotiate" button on each card → selects that deal
- "Start Negotiating" button at bottom → calls `onSelect` with selected deals

### `NegotiationView.tsx`

- Tab bar at top: one tab per active negotiation (seller name + bike)
- Active tab shows `ChatBubble` list for that conversation
- Flow per conversation:
    1. On mount: call `/api/chat` with `mode: "draft"` to get opening message options
    2. Show `DraftOptions` — buyer picks one or edits
    3. On approve: add to messages as `role: "buyer"`, then call `mode: "seller"` after a 2-3s fake delay
    4. Seller reply appears with typing indicator animation
    5. Immediately call `mode: "draft"` again for next buyer options
    6. Repeat until buyer says "accept" or demo ends

### `ChatBubble.tsx`

- Props: `role`, `content`, `timestamp`
- Buyer = right-aligned, blue background
- Seller = left-aligned, gray background
- Draft = right-aligned, dashed border, yellow tint
- System = centered, muted text

### `DraftOptions.tsx`

- Props: `options: {label, content}[]`, `onApprove(content)`
- Renders 2 option buttons (e.g., "Counter at $900", "Ask about condition")
- Clicking one calls `onApprove` with that message content
- Optional: "Edit" mode where buyer can modify text before sending

---

## Demo Data (`lib/data.ts`)

Hardcode 6 listings. The AI will rank and pick the best 3 for any given profile.

```typescript
export const demoListings: Listing[] = [
    {
        id: "1",
        title: "2021 Specialized Diverge Comp",
        price: 1400,
        fairValue: 1700,
        specs: "Shimano GRX 810, carbon frame, disc brakes, tubeless ready",
        condition: "Excellent — garage kept, ~1,200 miles",
        image: "/bikes/diverge.jpg",
        sellerName: "Mike",
        distance: "12 miles",
        description:
            "Selling my Diverge, upgraded to a new build. All original components, no crashes.",
    },
    {
        id: "2",
        title: "2022 Trek Checkpoint ALR 5",
        price: 1200,
        fairValue: 1250,
        specs: "Shimano GRX 600, aluminum, disc brakes",
        condition: "Good — some cosmetic scratches on top tube",
        image: "/bikes/checkpoint.jpg",
        sellerName: "Sarah",
        distance: "5 miles",
        description:
            "Great gravel bike, moving and need to sell. Price is firm.",
    },
    {
        id: "3",
        title: "2020 Canyon Grail 7",
        price: 950,
        fairValue: 1100,
        specs: "Shimano 105 R7000, aluminum, disc brakes",
        condition: "Fair — needs new bar tape, chain has some wear",
        image: "/bikes/grail.jpg",
        sellerName: "Dave",
        distance: "20 miles",
        description: "Good bike. Selling as is.",
    },
    {
        id: "4",
        title: "2023 Giant Defy Advanced 2",
        price: 2200,
        fairValue: 2000,
        specs: "Shimano 105 Di2, carbon, disc brakes",
        condition: "Like new — 200 miles",
        image: "/bikes/defy.jpg",
        sellerName: "Jen",
        distance: "8 miles",
        description:
            "Bought it and realized I prefer mountain biking. Basically brand new.",
    },
    {
        id: "5",
        title: "2019 Cannondale Topstone 105",
        price: 800,
        fairValue: 750,
        specs: "Shimano 105 R7000, aluminum, disc brakes",
        condition: "Rough — needs new tires and brake pads",
        image: "/bikes/topstone.jpg",
        sellerName: "Alex",
        distance: "30 miles",
        description:
            "Used for commuting for 3 years. Works fine but showing its age.",
    },
    {
        id: "6",
        title: "2021 Surly Midnight Special",
        price: 1100,
        fairValue: 1300,
        specs: "SRAM Apex 1x, steel, disc brakes",
        condition: "Good — patina on steel frame, mechanically solid",
        image: "/bikes/surly.jpg",
        sellerName: "Pat",
        distance: "15 miles",
        description:
            "Bulletproof bike. Steel is real. Moving to a cargo bike setup.",
    },
];

export const sellerPersonas: Record<string, SellerPersona> = {
    Mike: {
        name: "Mike",
        style: "friendly, enthusiastic, willing to negotiate, uses exclamation marks",
        priceFloor: 1100,
        hiddenInfo: "",
    },
    Sarah: {
        name: "Sarah",
        style: "polite but firm on price, might throw in accessories",
        priceFloor: 1150,
        hiddenInfo: "willing to include a saddle bag and spare tubes",
    },
    Dave: {
        name: "Dave",
        style: "short replies, slow to respond, eventually drops price a lot",
        priceFloor: 700,
        hiddenInfo: "front fork was replaced after a minor crash",
    },
    Jen: {
        name: "Jen",
        style: "eager to sell quickly, friendly, flexible",
        priceFloor: 1800,
        hiddenInfo: "",
    },
    Alex: {
        name: "Alex",
        style: "honest about condition, open to lowball offers",
        priceFloor: 550,
        hiddenInfo: "bottom bracket makes a clicking noise",
    },
    Pat: {
        name: "Pat",
        style: "knowledgeable, loves talking about the bike, moderate flexibility",
        priceFloor: 950,
        hiddenInfo: "",
    },
};
```

No database. No API. Just a TypeScript file imported at build time.

---

## Environment Variables

```env
# .env.local — only one key needed
ANTHROPIC_API_KEY=sk-ant-...
```

That's it. No Meta API, no database URL, no auth.

---

## Build Plan (60 Minutes)

### Minute 0–10: Scaffold

- `npx create-next-app@latest pedalbot --typescript --tailwind --app`
- Create folder structure (components/, lib/)
- Write `lib/types.ts`, `lib/data.ts` (copy from this spec)
- Write `lib/prompts.ts` (copy from this spec)
- Add `@anthropic-ai/sdk` dependency
- Set up `.env.local` with API key

### Minute 10–25: API Route + Onboarding

- Build `/api/chat/route.ts` — single route with mode switch
- Build `ChatBubble.tsx` (simple div with conditional styling)
- Build `OnboardingChat.tsx` — message list + input + API calls
- Wire into `page.tsx` with step state
- Test: can have a conversation, profile JSON gets extracted

### Minute 25–40: Deal Cards

- Build `DealCards.tsx` — 3-column grid of cards
- Call `/api/chat` with `mode: "rank"` when profile completes
- Parse JSON response, render cards with deal badges
- Add "Negotiate" selection + CTA button
- Test: onboarding → deals transition works

### Minute 40–55: Negotiation Chat

- Build `DraftOptions.tsx` — 2 buttons for AI-drafted options
- Build `NegotiationView.tsx` — tabs + chat per seller
- Wire up the loop: draft → approve → fake delay → seller reply → draft
- Add typing indicator (simple CSS animation)
- Test: can negotiate with at least one seller

### Minute 55–60: Polish & Prep

- Fix any broken styling
- Add a header/logo
- Test the full flow end-to-end once
- Prep a demo script: "I'm looking for a gravel bike, around $1,000..."

---

## What We're Cutting (Compared to Full Spec)

| Full Spec                          | Hackathon Build                     |
| ---------------------------------- | ----------------------------------- |
| 5 routes                           | 1 page + 1 API route                |
| React Context + useReducer         | useState at page level              |
| shadcn/ui component library        | Raw Tailwind divs                   |
| 3-panel negotiation layout         | Tabbed chat, no comparison panel    |
| Cross-deal comparison API          | Cut entirely                        |
| Deal closure screen                | Cut — demo ends at negotiation      |
| Inspection checklists              | Cut                                 |
| Exit messages for rejected sellers | Cut                                 |
| Responsive design                  | Desktop only                        |
| Error handling                     | Minimal (console.log)               |
| Loading states                     | Basic spinner or "Thinking..." text |
| Meta/Facebook API integration      | Pre-seeded data only                |

---

## Demo Script (What to Show)

1. **Open the app.** "PedalBot helps you find the best used bike deals and negotiates for you."
2. **Type:** "I'm looking for a gravel bike for weekend rides, around $1,000"
3. **AI asks follow-ups.** Answer naturally. Takes 30 seconds.
4. **Profile confirmed.** App shows top 3 deals with scores and AI summaries.
5. **Select all 3.** "Now I'm negotiating with all three sellers at once."
6. **Show Tab 1 (Mike):** AI drafts opener. Approve. Mike replies. AI suggests counter. Approve. Mike accepts.
7. **Show Tab 3 (Dave):** Short replies, then reveals crash history. "See — PedalBot caught that the fork was replaced. That's a red flag."
8. **Show Tab 2 (Sarah):** Firm on price, but offers accessories. "Different sellers, different strategies."
9. **Wrap:** "In 2 minutes I found 3 deals, negotiated all of them in parallel, and caught a hidden crash history. Without PedalBot, that's 3 hours of scrolling and texting."

---

## Dependencies

```json
{
    "dependencies": {
        "next": "^15",
        "react": "^19",
        "react-dom": "^19",
        "@anthropic-ai/sdk": "^0.39"
    }
}
```

Three dependencies. Ship it.
