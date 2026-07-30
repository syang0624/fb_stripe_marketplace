# RunPod Marketplace Backend

CPU `scraper` (BrightData Web Unlocker) + GPU `vision` (Qwen2.5-VL defect
detection) for the FB Marketplace iPhone demo.

## Setup
- `pip install -r requirements.txt`
- `flash login` (or `export RUNPOD_API_KEY=...`)
- `export BRIGHTDATA_API_TOKEN=...`  (omit for fixture-backed dev)
- `export BRIGHTDATA_WEB_UNLOCKER_ZONE=...` (only if not the default `web_unlocker1`)

## Scraping approach
The scraper uses the BrightData **Web Unlocker** Web Access API — not the paid
Marketplace dataset. It fetches a listing/search URL's rendered HTML and parses
the JSON Facebook embeds in the page into our `Listing` schema. Normalization is
tolerant; if Facebook walls a logged-out fetch, the keyless fixture fallback keeps
the demo working.

## Dev / Deploy
- `flash dev` — run endpoints on remote workers with hot reload
- `flash deploy` — ship stable endpoints
- `python -m runpod.demo` — offline end-to-end demo

## HTTP contract (for the UI)
POST /scraper_ep/listing     {urls:[str]}             -> {listings:[Listing]}
POST /scraper_ep/search      {query,location,limit}   -> {listings:[Listing]}
POST /scraper_ep/comparables {title}                  -> {comparables:[]}  (phase-2 stub)
POST /vision_ep/defects      {image_urls:[str]}       -> {reports:[ImageDefectReport]}

Listing: {url,title,id,price,currency,condition,description,seller,location,images[],raw}
ImageDefectReport: {image_url,defects[],condition_grade,negotiation_summary,error}
Defect: {type,component,severity,confidence,note}

## Notes
- The `vision` endpoint requires a GPU worker. The first call cold-starts and downloads the ~16GB Qwen2.5-VL model — use `ep.run()` + `job.wait(timeout=...)` for first calls, not `runsync` (60s timeout).
- `search` and `listing` are synchronous (Web Unlocker is single-step) — no snapshot polling.
- The exact JSON Facebook embeds can shift; the parser is tolerant, but validate field extraction against a real Web Unlocker response before relying on live data.
