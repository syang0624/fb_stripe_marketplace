# RunPod Backend: BrightData Scraping + VLM Defect Detection — Design

**Date:** 2026-06-30
**Branch:** `nori`
**Status:** Approved design, pending implementation plan

## Summary

Build a Python backend, hosted on **RunPod serverless** (via the `runpod-flash` SDK),
that powers a Facebook Marketplace deal agent for the demo. It does two things:

1. **Web scraping** of Facebook Marketplace listings via **BrightData** — pulling price,
   images, description, and seller info.
2. **Image processing** — running a vision-language model (VLM) on RunPod GPU to detect
   visible **defects** in listing photos (cracked screens, scratches, dents).

The demo target is **iPhones**. The backend exposes clean HTTP endpoints that a teammate
(Steven) will call from a rebuilt UI; this spec does **not** cover the UI.

## Goals

- BrightData-backed scraping returning structured listing data (price, image URLs,
  description, seller).
- GPU-hosted VLM that returns a **structured defect report** per listing image.
- Both deployed on RunPod via `flash deploy`, individually callable over HTTP.
- A thin Python orchestrator + CLI that chains scrape → defects into one **DealReport**,
  serving as the end-to-end demo and smoke test.
- Works without external credentials in `flash dev` via seeded iPhone fixtures.

## Non-Goals (deferred)

- Scam detection and the "self-improving" loop.
- Negotiation message generation / LLM negotiation.
- The Next.js UI (Steven owns this).
- Comparable-price negotiation evidence beyond a **stubbed** phase-2 route.
- Touching the existing Next.js / GMI tree — it stays in place, unused.

## Context

The repo currently holds **PedalBot**, a Next.js/TypeScript demo for used-bike deals using
**GMI Cloud (Nemotron)** for inference and **ScrapeCreators** for Marketplace data. We keep
that tree untouched and unused, and add a new, isolated Python backend under `runpod/`.

The RunPod Flash skill is vendored at `.agents/skills/flash/SKILL.md`. Key constraints it
imposes on our design:

- **Only the decorated function body ships under `flash dev`** — all `import`s, model loads,
  and helper references must live *inside* the function body (or be lazily imported there).
- **10 MB payload limit** — pass image **URLs** between endpoints, never raw bytes.
- **`runsync` 60 s timeout** — cold starts/model loads can exceed it; use `run()` + `wait()`
  or a generous timeout for first calls.
- Load-balanced endpoints share a worker pool across multiple HTTP routes.

## BrightData integration

- Product: **Facebook Marketplace Scraper API** (Web Scraper / Dataset API), free tier
  (~5K records/mo). Auth: `Authorization: Bearer ${BRIGHTDATA_API_TOKEN}`.
- Detail-by-URL uses the **sync `/scrape`** endpoint (≤20 URLs, returns in-request) — ideal
  for enriching a handful of iPhone listings without long polling that would bill idle
  workers.
- Discovery (keyword + location → listing URLs) uses the **async `/trigger`** endpoint,
  which returns a `snapshot_id` to poll. `/search` triggers and the orchestrator (or Steven)
  polls a `/snapshot` route, so workers don't block on long jobs.
- The official `brightdata-sdk` (`client.scrape.facebook.marketplace(url=...)`) is the
  preferred client; if its marketplace coverage is insufficient we fall back to direct REST
  calls. The exact `dataset_id` and field names are confirmed during implementation against
  the live dataset; the parser is tolerant regardless.
- Returned fields are normalized to our `Listing` schema; the original payload is always
  preserved under `raw` (mirrors the tolerant approach in the existing `lib/marketplace.ts`).

## Architecture

One Flash project at `runpod/` with **two endpoints**:

### `scraper` endpoint (CPU)

- `cpu=CpuInstanceType.CPU5C_2_4`, load-balanced routes.
- `POST /search` — input `{ query, location, limit }` → triggers BrightData discovery →
  returns `{ snapshot_id }` (async) or inline cards if available.
- `POST /snapshot` — input `{ snapshot_id }` → returns discovered listing cards when ready,
  else a `pending` status.
- `POST /listing` — input `{ url }` (or `{ urls: [...] }`, ≤20) → BD sync `/scrape` →
  normalized `Listing`(s) with price/images/description/seller.
- `POST /comparables` — **phase 2, stubbed first**: input `{ title, model }` → comparable
  prices for negotiation evidence (BD SERP). Returns a typed empty/stub result initially.

### `vision` endpoint (GPU)

- `gpu=GpuGroup.ADA_24` (RTX 4090, 24 GB). Default model **Qwen2.5-VL-7B-Instruct**.
- Model is **lazy-loaded once per warm worker** (module-level singleton initialized inside
  the function body; loaded on first request).
- `POST /defects` — input `{ image_urls: [...], context?: {...} }` → per-image structured
  defect report. Output per image: `defects[]` (each `{ type, component, severity,
  confidence, note }`), an overall `condition_grade`, and a short `negotiation_summary`.

## Components

```
runpod/
  scraper_ep.py        # Flash CPU endpoint: /search, /snapshot, /listing, /comparables
  vision_ep.py         # Flash GPU endpoint: /defects (Qwen2.5-VL)
  lib/
    brightdata.py      # trigger/poll/normalize; tolerant parser; raw preserved
    defects.py         # VLM prompt construction + defect-JSON parse/repair
    schema.py          # typed Listing, DefectReport, DealReport (dataclasses/pydantic)
    pipeline.py        # orchestrator: search -> listing -> defects -> DealReport
  demo.py              # CLI: runs the full iPhone pipeline, prints a DealReport
  fixtures/
    iphone_listings.json   # seeded listings for keyless `flash dev`
    images/                # sample cracked/clean iPhone photos (or hosted URLs)
  tests/
    test_brightdata.py # normalization against fixtures (no network)
    test_defects.py    # defect-JSON parsing/repair (no GPU)
    test_pipeline.py   # DealReport assembly from fixtures
  requirements.txt / pyproject
  AGENTS.md (+ CLAUDE.md)  # from `flash init`
```

## Data flow

```
/search(query="iPhone 13", location, limit)
   -> snapshot_id -> /snapshot -> [listing cards]
/listing(url)  (per card, batched <=20)
   -> Listing { price, images[], description, seller, raw }
/defects(image_urls = Listing.images)
   -> per-image DefectReport
pipeline merges -> DealReport {
     listing, defects_by_image[], overall_condition_grade,
     comparables (phase 2), negotiation_evidence
   }
```

Image URLs flow from scrape output directly into the vision endpoint; raw bytes are never
passed across endpoints.

## Error handling & fallbacks

- **No `BRIGHTDATA_API_TOKEN`** → `scraper` serves seeded iPhone fixtures (parallels the
  current ScrapeCreators 503 → seeded-data fallback), so `flash dev` works with no account.
- **BD timeout / unexpected shape** → tolerant parser; original payload kept under `raw`;
  endpoint returns a typed error with partial data where possible.
- **Bad/unreachable image URL** → `vision` returns a per-image error entry and continues
  with the rest; the pipeline never aborts on one bad image.
- **VLM returns non-JSON** → one structured-repair retry; on second failure, a typed
  `unparseable` defect result (raw text preserved) rather than a crash.
- **Cold start / model load > 60 s** → first vision calls use `run()` + `wait(timeout=...)`,
  not `runsync`.

## Testing strategy

- **Pure-function unit tests** (no network, no GPU): BrightData normalization, defect-JSON
  parse/repair, DealReport assembly — all against `fixtures/`.
- **Live `vision` validation** via `flash dev` against sample cracked vs. clean iPhone images;
  assert defects are detected on the cracked one and the grade differs.
- **`demo.py`** is the end-to-end smoke test over the seeded (or live) iPhone listings.

## Open implementation details (resolved during build, not blocking)

- Exact BrightData `dataset_id` and precise JSON field names (confirmed against the live
  dataset; parser is tolerant either way).
- Whether `brightdata-sdk` marketplace coverage suffices or we use direct REST.
- Final VLM serving path (transformers vs. vLLM) and exact GPU tier if 24 GB is tight.

## Milestones

1. Flash project scaffold (`flash init`) + `schema.py` + fixtures + tests skeleton.
2. `scraper` endpoint: `/listing` (sync detail) + normalization + keyless fallback.
3. `scraper` endpoint: `/search` + `/snapshot` (async discovery).
4. `vision` endpoint: Qwen2.5-VL `/defects` with structured output + repair.
5. `pipeline.py` + `demo.py` end-to-end on iPhones.
6. `comparables` phase-2 route (stub → real).
7. `flash deploy` both endpoints; document HTTP contracts for Steven.
