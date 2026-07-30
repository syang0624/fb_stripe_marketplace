# PedalBot v3 — Task List

> Steven: Frontend + Infra (branch: `steven`) | Nori: Data + Backend (branch: `nori`)
>
> Both branches merge into `main`. Coordinate merges at sync points marked below.

---

## Dependency Graph

```
Phase 1 (Steven: scaffold)  ──┐
                               ├──> SYNC POINT 1: merge scaffold + types into main
Phase 2 (Nori: types/prompts) ┘
        │                               │
        v                               v
Phase 3 (Nori: API routes)      Phase 5 (Steven: onboarding UI)
        │                               │
        v                               │
Phase 4 (Nori: search agent)            │
        │                               │
        └──────────┬────────────────────┘
                   v
           SYNC POINT 2: merge backend + frontend into main
                   │
        ┌──────────┴────────────────────┐
        v                               v
Phase 7 (Nori: negotiation engine)  Phase 6 (Steven: search/deal UI)
        │                               │
        └──────────┬────────────────────┘
                   v
           SYNC POINT 3: merge negotiation engine + deal UI into main
                   │
        ┌──────────┴────────────────────┐
        v                               v
(Nori: fallback/hardening)      Phase 8-9 (Steven: dashboard + final offers UI)
        │                               │
        └──────────┬────────────────────┘
                   v
           SYNC POINT 4: final merge into main
                   │
                   v
          Phase 10 (Both: integration + polish + demo run)
```

---

## Phase 1: Scaffold & Infra — Steven (`steven` branch)

No dependencies — start immediately.

- [ ] **S1** Set up project folder structure per spec (`app/`, `components/`, `lib/`, `app/api/`)
- [ ] **S2** Configure `.env.local` with `GMI_API_BASE_URL`, `GMI_API_KEY`, `GMI_MODEL`, `SCRAPECREATORS_API_KEY`
- [ ] **S3** Install dependencies (`next`, `react`, `react-dom`, `openai`)
- [ ] **S4** Set up Tailwind config and global styles
- [ ] **S5** Create `app/layout.tsx` and `app/page.tsx` with step-based state machine (`onboarding → searching → deals → negotiate → review`)

---

## Phase 2: Types & Prompts — Nori (`nori` branch)

No dependencies — start immediately. Can run parallel with Phase 1.

- [ ] **N1** Create `lib/types.ts` — all interfaces (`BuyerProfile`, `SearchPlan`, `MarketplaceRawListing`, `Listing`, `RankedDeal`, `Message`, `Negotiation`, `FinalOffer`, `SellerPersona`, `NegotiationStage`)
- [ ] **N2** Create `lib/prompts.ts` — all system prompts (`onboarding`, `query_plan`, `normalize_listing`, `rank`, `persona_from_listing`, `agent_turn`, `seller`, `evaluate_offer`, `modify_logistics`, `reopen_counter`)

### SYNC POINT 1

> Both merge into `main`. Steven pulls Nori's types; Nori pulls Steven's scaffold.
> After this point both branches share `lib/types.ts` as the contract.

---

## Phase 3: API Routes — Nori (`nori` branch)

Depends on: **N1**, **N2**, **S2** (env vars)

- [ ] **N3** Build `/api/chat/route.ts` — mode-switched Nemotron calls via OpenAI SDK pointed at GMI Cloud
- [ ] **N4** Build `/api/marketplace/search/route.ts` — proxy to ScrapeCreators search endpoint
- [ ] **N5** Build `/api/marketplace/item/route.ts` — proxy to ScrapeCreators item detail endpoint
- [ ] **N6** Build `/api/marketplace/location/route.ts` — proxy to ScrapeCreators location search (or hardcode SF coords as fallback)

---

## Phase 4: Search Agent Logic — Nori (`nori` branch)

Depends on: **N3–N6** (API routes), **N1** (types)

- [ ] **N7** Create `lib/marketplace.ts` — ScrapeCreators client helpers (`searchMarketplace`, `getItemDetails`, `resolveLocation`)
- [ ] **N8** Create `lib/searchAgent.ts` — `findTopDeals()` orchestration: query planning → multi-query search → dedupe → normalize → pre-score → enrich → hybrid rank → top 3
- [ ] **N9** Create `lib/scoring.ts` — deterministic scoring helpers (`quickScore`, scoring formula: 30% value, 25% relevance, 15% condition, 10% distance, 10% recency, 10% risk)
- [ ] **N10** Create `lib/data.ts` — seller persona templates + fallback seeded listings

---

## Phase 5: Onboarding UI — Steven (`steven` branch)

Depends on: **S5** (page shell), **N1** (types — available after Sync Point 1)

- [ ] **S6** Build `components/ChatBubble.tsx` — shared chat bubble (buyer, seller, system, agent_note styles)
- [ ] **S7** Build `components/OnboardingChat.tsx` — chat interface that collects `BuyerProfile` via `/api/chat` onboarding mode
- [ ] **S8** Wire onboarding completion → parse JSON → set `profile` state → transition to `searching` step

> Steven can stub `/api/chat` responses locally until Nori's N3 is merged.

### SYNC POINT 2

> Both merge into `main`. Steven gets working API routes + search agent. Nori gets onboarding UI.

---

## Phase 6: Search & Deal Cards UI — Steven (`steven` branch)

Depends on: **S8** (onboarding wired), **N8** (searchAgent), **N9** (scoring) — available after Sync Point 2

- [ ] **S9** Build `components/SearchProgress.tsx` — animated progress display showing query expansion, search, dedupe, enrichment, ranking steps
- [ ] **S10** Build `components/DealCards.tsx` — display top 3 `RankedDeal` cards (image, price, fair value, score, risk flags, suggested offer, source badge)
- [ ] **S11** Wire search flow: `searching` step calls `findTopDeals()` → shows `SearchProgress` → renders `DealCards` → buyer confirms → transition to `negotiate`

---

## Phase 7: Negotiation Engine — Nori (`nori` branch)

Depends on: **N3** (chat route), **N1–N2** (types/prompts), **N10** (persona templates)

- [ ] **N11** Create `lib/agent.ts` — `runNegotiation()` async loop + `startAll()` for parallel execution
- [ ] **N12** Implement seller persona generation from live listings via `persona_from_listing` mode
- [ ] **N13** Implement offer evaluation logic (`evaluate_offer` mode) and stage progression rules
- [ ] **N14** Wire `modify_logistics` and `reopen_counter` modes for post-negotiation changes

### SYNC POINT 3

> Both merge into `main`. Steven gets negotiation engine. Nori gets deal cards UI.

---

## Phase 8: Negotiation Dashboard UI — Steven (`steven` branch)

Depends on: **N11** (agent loop), **N12** (personas) — available after Sync Point 3

- [ ] **S12** Build `components/StageTracker.tsx` — pill row (Outreach → Price → Condition → Counter → Logistics → Final) with active/completed/future states + withdrawn badge
- [ ] **S13** Build `components/NegotiationLane.tsx` — single lane card (thumbnail, stage tracker, current price, reasoning, message preview, "View chat" / "Take over" buttons)
- [ ] **S14** Build `components/NegotiationDashboard.tsx` — 3-lane layout, header with honesty copy, re-renders on agent loop updates
- [ ] **S15** Build `components/ChatDrawer.tsx` — slide-out panel with full message history, agent_note styling, take-over toggle, manual text input, "Return control to PedalBot" button

---

## Phase 9: Final Offers UI — Steven (`steven` branch)

Depends on: **S14** (dashboard), **N13–N14** (offer evaluation + modify/reopen)

- [ ] **S16** Build `components/FinalOffersReview.tsx` — final offer cards (price, savings, meet time/place, extras, summary) + Accept / Modify / Decline buttons; collapsed withdrawn cards below
- [ ] **S17** Build `components/ModifyDialog.tsx` — two tabs: Logistics (edit meet time/place) and Price (enter new target, reopen counter)

---

## Phase 10: Integration & Polish — Both

Depends on: all previous phases merged into `main`

### SYNC POINT 4 (final merge)

- [ ] **S18** Wire full end-to-end flow: onboarding → search → deals → negotiate → review → accept
- [ ] **N15** Add fallback to seeded listings if ScrapeCreators API fails (with "fallback data" label in UI)
- [ ] **S19** Add animations on price changes and stage transitions
- [ ] **S20** Add `Live Marketplace via ScrapeCreators` source badge on deal cards
- [ ] **S21** Full end-to-end demo run with demo script (Both)

---

## Parallel Work Windows

| Time Block | Steven (`steven` branch) | Nori (`nori` branch) |
|------------|--------------------------|----------------------|
| Block 1    | Phase 1: Scaffold & infra | Phase 2: Types & prompts |
| *Sync 1*   | *Merge both into main, pull each other's work* | |
| Block 2    | Phase 5: Onboarding UI (stub API) | Phase 3–4: API routes + search agent |
| *Sync 2*   | *Merge both into main, pull each other's work* | |
| Block 3    | Phase 6: Search & deal cards UI | Phase 7: Negotiation engine |
| *Sync 3*   | *Merge both into main, pull each other's work* | |
| Block 4    | Phase 8–9: Dashboard + final offers UI | Hardening, fallback data (N15) |
| *Sync 4*   | *Final merge into main* | |
| Block 5    | Phase 10: Integration & polish (Both) | Phase 10: Integration & polish (Both) |

---

## Summary

| Owner  | Tasks | Scope |
|--------|-------|-------|
| Steven | S1–S21 (21 tasks) | Infra, all components, UI wiring, polish |
| Nori   | N1–N15 (15 tasks) | Types, prompts, API routes, search agent, scoring, negotiation engine |

## Shared Contract

`lib/types.ts` is the interface contract between branches. Agree on types at Sync Point 1 — any breaking changes after that require a heads-up in chat.
