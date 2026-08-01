# SOLID Marketplace

SOLID Marketplace is an authenticated Facebook Marketplace buying-agent demo. A buyer describes what they want, SOLID searches and ranks nearby listings, runs simulated negotiations, flags scam signals, and can carry an accepted offer through a Stripe Connect meetup-payment flow.

## Current product flow

1. The buyer signs in with Auth0.
2. The onboarding chat collects the item, location, budget, and meetup availability.
3. SOLID plans several searches, resolves the location, retrieves listings, removes duplicates, enriches the strongest candidates, and ranks the top three.
4. Optional RunPod vision analysis adds image-defect evidence to listing risk and condition data.
5. SOLID runs parallel simulated seller negotiations. The buyer can inspect each chat, take over, modify a final offer, or walk away. Pattern matching plus an optional model check warns about suspicious messages and automatically stops high-risk negotiations.
6. An accepted offer becomes a server-trusted transaction. The buyer pays through Stripe, the seller receives a tokenized deal link and completes Stripe Connect onboarding, and each party confirms the meetup independently.
7. The second confirmation releases the funds to the seller. A cancellation before release cancels a pending PaymentIntent or fully refunds a funded payment; the protected cron endpoint handles expired, unconfirmed deals.

Seller conversations are simulated for this demo; the app does not message real Facebook sellers.

## Data-provider and fallback behavior

Marketplace search uses the first available source in this order:

1. RunPod scraper, when `RUNPOD_SCRAPER_BASE_URL` or `RUNPOD_BACKEND_BASE_URL` is set.
2. ScrapeCreators, when `SCRAPECREATORS_API_KEY` is set or the RunPod request fails.
3. Seeded listings from `lib/data.ts`, when live search returns no usable results.

OpenAI powers onboarding, query planning, ranking explanations, seller personas, negotiation turns, and deeper scam checks. If `OPENAI_API_KEY` is missing or a model request fails, deterministic responses keep the search and negotiation demo usable.

Vision analysis is optional. When `RUNPOD_VISION_BASE_URL` or `RUNPOD_BACKEND_BASE_URL` is absent, the ranking pipeline continues without image-defect annotations.

## Stack

- Next.js 15, React 19, TypeScript, and Tailwind CSS
- Auth0 Next.js SDK v4 for buyer sessions and `/auth/*` routes
- OpenAI Chat Completions with deterministic fallbacks
- RunPod Flash, BrightData Web Unlocker, and Qwen2.5-VL for optional scraping and vision
- ScrapeCreators as the secondary live Marketplace provider
- Stripe Payment Element and Connect Express for trusted meetup payments
- Node's built-in SQLite for local payment state

## Prerequisites

- Node.js 22.5 or newer (the payment store uses `node:sqlite`); Node 22 LTS is recommended
- npm
- An Auth0 Regular Web Application to use the buyer UI
- Optional: Python 3.10+ for the RunPod backend and its tests
- Optional: an authenticated Stripe CLI for the payment demo and local webhooks

## Local setup

Install dependencies and create a developer-owned environment file:

```bash
npm install
cp .env.example .env.local
```

At minimum, configure Auth0 in `.env.local`:

```bash
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret
AUTH0_SECRET=your-32-byte-hex-secret
APP_BASE_URL=http://localhost:3000
```

Generate the cookie-encryption secret with:

```bash
openssl rand -hex 32
```

The Auth0 application must be a **Regular Web Application** with these exact local URLs:

- Allowed Callback URL: `http://localhost:3000/auth/callback`
- Allowed Logout URL: `http://localhost:3000`
- Allowed Web Origin: `http://localhost:3000`

The middleware mounts login, logout, callback, profile, and access-token handlers under `/auth/*`. Restart the dev server after changing Auth0 settings.

### Using this repository's Stripe Projects configuration

This repository is initialized as the Stripe project `solid-marketplace`, with an Auth0 client and free plan already defined. Stripe Projects is a developer preview and requires an eligible Stripe account. Inspect the current project, re-link Auth0 if the provider session has expired, and pull the project-managed environment:

```bash
DEV_MODE=true stripe projects status
DEV_MODE=true stripe projects link auth0
DEV_MODE=true stripe projects env --pull
```

`stripe projects env --pull` writes the managed configuration to `.env`. Do not hand-edit `.env` or files under `.projects`; use Stripe Projects commands to change managed values.

### Environment-file ownership

- `.env` is generated and owned by Stripe Projects.
- `.env.local` contains developer-specific overrides and the Stripe CLI credentials written by `npm run stripe:setup-local`.
- Next.js loads both files, with `.env.local` taking precedence.

For a fully manual setup, keep all values in `.env.local`. Do not concatenate `.env` and `.env.local`.

The complete variable reference is in `.env.example`. Service-specific variables are summarized below:

| Capability | Variables | Required behavior |
| --- | --- | --- |
| Auth0 | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL` | The four Auth0 values are required for the buyer UI; set the base URL for local development and stable deployments |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional; defaults to deterministic inference and `gpt-5.6-sol` |
| ScrapeCreators | `SCRAPECREATORS_API_KEY` | Optional secondary live-search provider |
| RunPod proxies | `RUNPOD_BACKEND_BASE_URL`, or separate `RUNPOD_SCRAPER_BASE_URL` and `RUNPOD_VISION_BASE_URL` | Optional live scraper and image-defect analysis |
| RunPod deployment | `RUNPOD_API_KEY`, `BRIGHTDATA_API_TOKEN`, `BRIGHTDATA_WEB_UNLOCKER_ZONE` | Optional; BrightData may be omitted for fixture-backed scraper development |
| Stripe payments | `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Required only for checkout, webhooks, refunds, and transfers |
| Payment service | `PAYMENT_TOKEN_SECRET`, `PAYMENTS_DB_PATH`, `CRON_SECRET` | Token secret is required in production; database path has a local default; cron secret protects the refund scheduler |

## Run the app

```bash
npm run dev
```

Open `http://localhost:3000`, sign in, and complete the onboarding chat.

Production-style commands:

```bash
npm run build
npm run start
```

## Stripe Connect payment demo

The payment flow uses Stripe test mode. It creates a platform PaymentIntent, onboards the seller to a Connect Express account, and transfers the full transaction amount only after buyer and seller confirmation. Webhook processing and Stripe mutations use durable operation records and idempotency keys.

With the Stripe CLI installed and authenticated, configure `.env.local` without printing secrets:

```bash
stripe login
npm run stripe:setup-local
npm run stripe:verify
```

Start the app and webhook listener in separate terminals:

```bash
npm run dev
npm run stripe:listen
```

The listener forwards the implemented event set to `http://localhost:3000/api/stripe/webhook`. `stripe:setup-local` preserves existing `.env.local` values, writes the CLI's test credentials and webhook secret, and generates the local payment-token and cron secrets. The Stripe CLI restricted key expires; re-run `stripe login` and `npm run stripe:setup-local` when needed.

After a transaction is created, the buyer UI exposes a demo handoff link for the seller page at `/seller/deal/[token]`.

Local state is stored in `.data/solid-payments.sqlite` unless `PAYMENTS_DB_PATH` overrides it. This SQLite store is suitable for a single-process demo, not a serverless or multi-instance deployment; use a shared production database before deploying that way.

To invoke the expired-deal refund job, send `POST /api/cron/refund-expired` with `Authorization: Bearer <CRON_SECRET>`.

## RunPod scraper and vision backend

The `runpod/` package contains two deployable RunPod Flash endpoints:

- `scraper_ep.py`: CPU endpoints for Marketplace search, listing detail, and a phase-two comparables stub. It uses BrightData Web Unlocker and falls back to checked-in fixtures when no BrightData token is set.
- `vision_ep.py`: a GPU endpoint that runs Qwen2.5-VL-7B-Instruct against listing images and returns structured defect, condition, and negotiation evidence.

Set up the Python environment from the repository root:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r runpod/requirements.txt
python -m pytest runpod/tests -v
python -m runpod.demo
```

For remote development or deployment, authenticate with `flash login` or set `RUNPOD_API_KEY`, then run `flash dev` or `flash deploy` from the repository root. See `runpod/README.md` for the HTTP contract and GPU cold-start notes.

The Next.js proxy calls these paths on the configured base URL:

```text
POST /scraper_ep/search
POST /scraper_ep/listing
POST /vision_ep/defects
```

## Verification

```bash
npm run typecheck
npm run test:payments
npm run build
python3 -m pytest runpod/tests -v
```

`npm run lint` still invokes the deprecated, interactive `next lint` setup flow. It is not CI-safe until the repository receives a standalone ESLint configuration.

## Repository map

| Path | Purpose |
| --- | --- |
| `app/` | Authenticated buyer page, seller deal page, and API routes |
| `components/MarketplaceApp.tsx` | Buyer-side search, negotiation, review, and payment-flow orchestration |
| `components/` | Search, negotiation, review, buyer payment, and seller UI |
| `lib/searchAgent.ts` | Search planning, provider calls, filtering, enrichment, vision annotation, and ranking |
| `lib/agent.ts`, `lib/scamDetection.ts` | Reusable negotiation utilities and the scam-detection engine |
| `lib/server/` | Trusted offers, token authorization, SQLite state, Stripe operations, rate limits, and RunPod proxies |
| `runpod/` | BrightData normalization, RunPod Flash endpoints, Qwen vision pipeline, fixtures, demo, and tests |
| `tests/paymentStore.test.ts` | Payment-store state and authorization tests |
| `STRIPE-CONNECT-PRD.md` | Trusted meetup payment product and state-machine design |

Planning and implementation notes also live in `FULL-TECH.md`, `HACKATHON-MVP.md`, `TASK-LIST.md`, and `docs/superpowers/`.
