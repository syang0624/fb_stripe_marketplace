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
