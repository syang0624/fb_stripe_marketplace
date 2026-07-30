"""RunPod Flash CPU endpoint: BrightData Facebook Marketplace scraping."""
import os

from runpod_flash import Endpoint, CpuInstanceType

# Forward the local BrightData credentials into the remote worker's environment
# at deploy/dev time so the route bodies can read them via os.environ. Empty
# strings when unset keep the keyless fixture fallback working.
scraper = Endpoint(
    name="fbm-scraper",
    cpu=CpuInstanceType.CPU5C_2_4,
    workers=(1, 3),
    max_concurrency=4,
    dependencies=["requests"],
    env={
        "BRIGHTDATA_API_TOKEN": os.environ.get("BRIGHTDATA_API_TOKEN", ""),
        "BRIGHTDATA_WEB_UNLOCKER_ZONE": os.environ.get("BRIGHTDATA_WEB_UNLOCKER_ZONE", "web_unlocker1"),
    },
)


@scraper.post("/listing")
async def listing(data: dict):
    import os
    from runpod.lib.brightdata import scrape_listings
    from runpod.lib.schema import to_jsonable

    urls = data.get("urls") or ([data["url"]] if data.get("url") else [])
    if not urls:
        return {"listings": []}
    token = os.environ.get("BRIGHTDATA_API_TOKEN")
    listings = scrape_listings(urls, token)
    return {"listings": [to_jsonable(l) for l in listings]}


@scraper.post("/search")
async def search(data: dict):
    import os
    from runpod.lib.brightdata import search_listings
    from runpod.lib.schema import to_jsonable

    token = os.environ.get("BRIGHTDATA_API_TOKEN")
    try:
        limit = int(data.get("limit", 10))
    except (TypeError, ValueError):
        limit = 10
    listings = search_listings(
        data.get("query", "iPhone"), data.get("location", ""), limit, token
    )
    return {"listings": [to_jsonable(item) for item in listings]}


@scraper.post("/comparables")
async def comparables(data: dict):
    # Phase 2: BrightData SERP-based comparable prices. Stubbed for now.
    return {"comparables": [], "note": "phase-2 stub"}
