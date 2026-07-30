# PedalBot

PedalBot is a Facebook Marketplace buying-agent demo. It turns a buyer request into live Marketplace searches, ranks the best listings, flags risk, and simulates negotiation with sellers.

The current app is a Next.js frontend with server-side API proxy routes for chat and Marketplace data. The RunPod/BrightData/VLM work under `runpod/` is in progress and currently includes schema, fixtures, normalization logic, and tests.

## What It Does

- Collects buyer preferences through an onboarding chat.
- Expands the request into Marketplace search queries.
- Searches Facebook Marketplace through ScrapeCreators proxy routes.
- Normalizes listings, images, seller info, prices, location, and descriptions.
- Ranks listings with deterministic scoring plus optional GMI/Nemotron responses.
- Falls back to seeded Facebook Marketplace listings when live search is unavailable.
- Displays top deals and runs simulated seller negotiation lanes.

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- GMI Cloud Model Hub, OpenAI-compatible API, for Nemotron chat/ranking
- ScrapeCreators for live Facebook Marketplace search and item detail
- Python/pytest under `runpod/` for the BrightData/vision backend work in progress

## Setup

Install Node dependencies:

```bash
npm install
```

Create local environment variables:

```bash
cp .env.example .env.local
```

Fill in the values you have:

```bash
GMI_API_BASE_URL=https://api.gmi-serving.com
GMI_API_KEY=your-gmi-api-key
GMI_MODEL=nvidia/nemotron-3-ultra-550b-a55b
SCRAPECREATORS_API_KEY=your-scrapecreators-api-key
```

## Auth0

The buyer app is protected by Auth0. It uses the Auth0 Next.js v4 SDK and
automatically mounts login, logout, callback, profile, and access-token routes
under `/auth/*`.

Following the Stripe Projects workflow from the Auth0 tutorial:

```bash
stripe plugin install projects
stripe projects init solid-marketplace
stripe projects link auth0
stripe projects add auth0/free
stripe projects add auth0/client
```

Stripe Projects is currently a developer preview and requires an eligible
Stripe account. Linking Auth0 is interactive and asks the account owner to
accept Auth0's terms. If Stripe Projects cannot link the account, create a
**Regular Web Application** in the Auth0 Dashboard and add these values to
`.env.local`:

```bash
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret
AUTH0_SECRET=your-64-character-session-secret
APP_BASE_URL=http://localhost:3000
```

Generate the session secret with `openssl rand -hex 32`. Configure the Auth0
application with:

- Allowed Callback URL: `http://localhost:3000/auth/callback`
- Allowed Logout URL: `http://localhost:3000`
- Allowed Web Origin: `http://localhost:3000`

Restart the dev server after changing Auth0 environment variables.

The app still runs without these keys:

- Missing GMI config makes `/api/chat` use deterministic fallback responses.
- Missing ScrapeCreators config makes Marketplace search fall back to seeded listings from `lib/data.ts`.

## Development

Run the Next.js app:

```bash
npm run dev
```

Then open the local URL printed by Next.js, usually `http://localhost:3000`.

Useful checks:

```bash
npm run typecheck
npm run build
```

Payment backend checks:

```bash
npm run test:payments
```

## Stripe Connect Demo Backend

The `nori` branch adds the server-side trusted meetup payment flow described in
`STRIPE-CONNECT-PRD.md`:

- the AI chat route registers a server-trusted final offer
- the buyer creates a transaction and Stripe PaymentIntent
- the seller completes Stripe-hosted Connect onboarding
- buyer and seller confirmations are stored separately
- the second confirmation creates a Connect Transfer
- either party can cancel first and trigger a full Refund
- Stripe webhooks are signature-verified and idempotently reconciled

Copy the Stripe variables from `.env.example` into `.env.local`. For local
webhook testing, forward Stripe events to:

```text
http://localhost:3000/api/stripe/webhook
```

With an authenticated Stripe CLI, the repository can configure and verify the
local test environment without printing secrets:

```bash
npm run stripe:setup-local
npm run stripe:verify
npm run stripe:listen
```

The CLI login creates an expiring restricted test key. Re-run `stripe login`
and `npm run stripe:setup-local` when that credential expires.

Local payment state is stored in `.data/solid-payments.sqlite`. This is suitable
for a single-process hackathon demo. Use managed Postgres before deploying to a
serverless or multi-instance environment.

`npm run lint` is defined, but this repo uses Next 15 with the older `next lint` script shape, so verify the lint setup before relying on it in CI.

## RunPod / Vision Work

The `runpod/` directory is the start of a Python backend for scraping and image-defect analysis:

- `runpod/lib/schema.py` defines listing and defect-report dataclasses.
- `runpod/lib/brightdata.py` normalizes BrightData-shaped Marketplace records.
- `runpod/fixtures/` contains keyless dev fixtures.
- `runpod/tests/` covers schema, fixtures, and normalization.

Install Python dependencies in a virtualenv if needed:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r runpod/requirements.txt
python -m pytest runpod/tests -v
```

Note: the checked-in Wikimedia image URLs are fixture/dev-test data only. The active Next.js Marketplace path uses live Marketplace image URLs from ScrapeCreators, or Facebook CDN URLs from the seeded fallback listings.

## Repository Notes

- Secrets belong in `.env.local` or `.env`; do not commit them.
- `runpod/**/__pycache__` and `.pytest_cache` are generated locally and ignored.
- Product docs and planning notes live in `FULL-TECH.md`, `HACKATHON-MVP.md`, `TASK-LIST.md`, and `docs/superpowers/`.
