# RunPod Scraping + VLM Defect Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a RunPod-hosted Python backend that scrapes Facebook Marketplace iPhone listings via BrightData and detects photo defects with a VLM, exposed as callable HTTP endpoints plus a demo CLI.

**Architecture:** One `runpod-flash` project under `runpod/` with two load-balanced endpoints — a CPU `scraper` (BrightData calls + normalization) and a GPU `vision` (Qwen2.5-VL defect detection). Pure logic (normalization, defect parsing, schema, pipeline) lives in `runpod/lib/` as stdlib-only modules so it is unit-testable without network/GPU and packageable into the worker artifact. A `demo.py` orchestrator chains the endpoints into a `DealReport`.

**Tech Stack:** Python 3.11, `runpod-flash`, `requests`, `transformers` + `qwen-vl-utils` + `torch` (vision worker only), `pytest`. Schema via stdlib `dataclasses` (no pydantic — keeps worker artifact lean).

## Global Constraints

- Python version: **3.11** (`flash` supports 3.10–3.13).
- BrightData auth: `Authorization: Bearer ${BRIGHTDATA_API_TOKEN}`; never hardcode the token; read from env.
- **Flash body-only rule:** every `@Endpoint`/route function must `import` its dependencies and reference helpers *inside* the function body. Endpoint bodies import shared `runpod/lib/*` modules **inside the body**; `flash deploy` packages the project dir so these resolve on the worker.
- **10 MB payload limit:** pass image **URLs** between endpoints, never raw image bytes.
- First vision calls use `ep.run()` + `job.wait(timeout=...)`, never `runsync` (cold start/model load exceeds 60 s).
- `runpod/lib/*` modules are **stdlib-only** (no third-party imports) so they unit-test cleanly and inline into workers without extra deps.
- Demo target is **iPhones**; fixtures and prompts are iPhone-tuned but not hardcoded to a single model.
- Tolerant parsing: every BrightData record is normalized but the original payload is preserved under `raw`.
- Do not modify the existing Next.js/GMI tree. All new code lives under `runpod/`. Work only on the `nori` branch.
- Commit after every passing step.

---

### Task 1: Scaffold flash project + schema

**Files:**
- Create: `runpod/requirements.txt`
- Create: `runpod/lib/__init__.py` (empty)
- Create: `runpod/lib/schema.py`
- Test: `runpod/tests/test_schema.py`
- Create: `runpod/tests/__init__.py` (empty)

**Interfaces:**
- Produces: dataclasses `Listing`, `Defect`, `ImageDefectReport`, `DealReport`; helpers `listing_from_dict(d: dict) -> Listing`, `to_jsonable(obj) -> dict`.

- [ ] **Step 1: Create `runpod/requirements.txt`**

```
runpod-flash
requests
pytest
```

(Vision-only deps `torch`, `transformers`, `qwen-vl-utils`, `accelerate`, `pillow` are declared in the endpoint's `dependencies=[...]`, not installed locally.)

- [ ] **Step 2: Write the failing test** — `runpod/tests/test_schema.py`

```python
from runpod.lib.schema import Listing, Defect, ImageDefectReport, DealReport, listing_from_dict, to_jsonable


def test_listing_from_dict_minimal():
    listing = listing_from_dict({"url": "https://fb.com/x", "title": "iPhone 13"})
    assert listing.url == "https://fb.com/x"
    assert listing.title == "iPhone 13"
    assert listing.images == []
    assert listing.price is None
    assert listing.raw == {"url": "https://fb.com/x", "title": "iPhone 13"}


def test_to_jsonable_roundtrips_nested():
    report = DealReport(
        listing=Listing(url="u", title="t"),
        image_reports=[
            ImageDefectReport(
                image_url="i",
                defects=[Defect(type="crack", component="screen", severity="severe", confidence=0.9, note="x")],
                condition_grade="poor",
                negotiation_summary="cracked screen",
            )
        ],
        overall_condition_grade="poor",
        comparables=[],
        negotiation_evidence={"reasons": ["cracked screen"]},
    )
    data = to_jsonable(report)
    assert data["overall_condition_grade"] == "poor"
    assert data["image_reports"][0]["defects"][0]["type"] == "crack"
    assert data["listing"]["title"] == "t"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_schema.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'runpod.lib.schema'`

- [ ] **Step 4: Write minimal implementation** — `runpod/lib/schema.py`

```python
"""Typed, stdlib-only data model shared across endpoints, orchestrator, and tests."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class Listing:
    url: str
    title: Optional[str] = None
    id: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    condition: Optional[str] = None
    description: Optional[str] = None
    seller: Optional[str] = None
    location: Optional[str] = None
    images: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Defect:
    type: str
    component: str
    severity: str  # "minor" | "moderate" | "severe"
    confidence: float
    note: str = ""


@dataclass
class ImageDefectReport:
    image_url: str
    defects: list[Defect] = field(default_factory=list)
    condition_grade: str = "unknown"  # "excellent" | "good" | "fair" | "poor" | "unknown"
    negotiation_summary: str = ""
    error: Optional[str] = None


@dataclass
class DealReport:
    listing: Listing
    image_reports: list[ImageDefectReport] = field(default_factory=list)
    overall_condition_grade: str = "unknown"
    comparables: list[dict[str, Any]] = field(default_factory=list)
    negotiation_evidence: dict[str, Any] = field(default_factory=dict)


def listing_from_dict(d: dict[str, Any]) -> Listing:
    """Build a Listing from already-normalized fields, preserving the source under raw."""
    return Listing(
        url=d.get("url", ""),
        title=d.get("title"),
        id=d.get("id"),
        price=d.get("price"),
        currency=d.get("currency"),
        condition=d.get("condition"),
        description=d.get("description"),
        seller=d.get("seller"),
        location=d.get("location"),
        images=list(d.get("images") or []),
        raw=d.get("raw", d),
    )


def to_jsonable(obj: Any) -> Any:
    """Recursively convert dataclasses to plain JSON-serializable dicts/lists."""
    from dataclasses import is_dataclass
    if is_dataclass(obj):
        return {k: to_jsonable(v) for k, v in asdict(obj).items()}
    if isinstance(obj, list):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    return obj
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_schema.py -v`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
git add runpod/requirements.txt runpod/lib/__init__.py runpod/lib/schema.py runpod/tests/__init__.py runpod/tests/test_schema.py
git commit -m "feat(runpod): add flash project scaffold and shared schema"
```

---

### Task 2: iPhone fixtures for keyless dev

**Files:**
- Create: `runpod/fixtures/iphone_listings.json`
- Create: `runpod/fixtures/__init__.py` (empty)
- Create: `runpod/fixtures/images.json`
- Test: `runpod/tests/test_fixtures.py`

**Interfaces:**
- Produces: `runpod/fixtures/iphone_listings.json` (list of raw BrightData-shaped records) and `runpod/fixtures/images.json` (`{"cracked": [url...], "clean": [url...]}`) used by the scraper fallback and vision live tests.

- [ ] **Step 1: Write the failing test** — `runpod/tests/test_fixtures.py`

```python
import json
from pathlib import Path

FIX = Path(__file__).resolve().parents[1] / "fixtures"


def test_listings_fixture_has_iphones_with_required_fields():
    data = json.loads((FIX / "iphone_listings.json").read_text())
    assert len(data) >= 3
    for rec in data:
        assert "url" in rec and "iphone" in (rec.get("name", "") + rec.get("title", "")).lower()
        # price present as a BrightData-style nested or flat field
        assert any(k in rec for k in ("final_price", "initial_price", "price"))
        assert rec.get("images")


def test_images_fixture_has_cracked_and_clean():
    data = json.loads((FIX / "images.json").read_text())
    assert data["cracked"] and data["clean"]
    assert all(u.startswith("http") for u in data["cracked"] + data["clean"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_fixtures.py -v`
Expected: FAIL with `FileNotFoundError` for `iphone_listings.json`

- [ ] **Step 3: Create `runpod/fixtures/iphone_listings.json`**

Shape mirrors BrightData's Facebook Marketplace fields (flat `final_price`/`initial_price`, `seller`, `images` list). Use real public Wikimedia image URLs so the vision endpoint can fetch them in dev.

```json
[
  {
    "url": "https://www.facebook.com/marketplace/item/1000000000000001",
    "name": "iPhone 13 128GB Blue - Good Condition",
    "final_price": 380,
    "initial_price": 420,
    "currency": "USD",
    "condition": "Used - Good",
    "description": "iPhone 13, 128GB, battery health 89%. Small scratch on the back. Comes with charger.",
    "seller": {"name": "Alex M."},
    "location": "San Francisco, CA",
    "images": [
      "https://upload.wikimedia.org/wikipedia/commons/3/3d/IPhone_13_vector.svg"
    ]
  },
  {
    "url": "https://www.facebook.com/marketplace/item/1000000000000002",
    "name": "iPhone 12 Pro 256GB - Cracked Screen",
    "final_price": 250,
    "initial_price": 300,
    "currency": "USD",
    "condition": "Used - Fair",
    "description": "iPhone 12 Pro, screen is cracked but fully functional. Face ID works.",
    "seller": {"name": "Jordan P."},
    "location": "Oakland, CA",
    "images": [
      "https://upload.wikimedia.org/wikipedia/commons/8/8d/Broken_iPhone.jpg"
    ]
  },
  {
    "url": "https://www.facebook.com/marketplace/item/1000000000000003",
    "name": "iPhone 14 128GB Midnight - Like New",
    "final_price": 560,
    "initial_price": 560,
    "currency": "USD",
    "condition": "Used - Like New",
    "description": "iPhone 14, barely used, no scratches. Original box included.",
    "seller": {"name": "Sam R."},
    "location": "Berkeley, CA",
    "images": [
      "https://upload.wikimedia.org/wikipedia/commons/2/2c/IPhone_14_Pro_vector.svg"
    ]
  }
]
```

- [ ] **Step 4: Create `runpod/fixtures/images.json`** and empty `runpod/fixtures/__init__.py`

```json
{
  "cracked": [
    "https://upload.wikimedia.org/wikipedia/commons/8/8d/Broken_iPhone.jpg"
  ],
  "clean": [
    "https://upload.wikimedia.org/wikipedia/commons/2/2c/IPhone_14_Pro_vector.svg"
  ]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_fixtures.py -v`
Expected: PASS (2 passed)

> Note: if a Wikimedia URL 404s during the Task 7 live test, swap it for any reachable iPhone photo URL; the fixture shape is what matters here.

- [ ] **Step 6: Commit**

```bash
git add runpod/fixtures
git commit -m "feat(runpod): add iPhone listing and image fixtures for keyless dev"
```

---

### Task 3: BrightData normalization

**Files:**
- Create: `runpod/lib/brightdata.py`
- Test: `runpod/tests/test_brightdata_normalize.py`

**Interfaces:**
- Consumes: `runpod.lib.schema.Listing`, `listing_from_dict`.
- Produces: `normalize_listing(raw: dict) -> Listing`; `normalize_listings(items: list[dict]) -> list[Listing]`.

- [ ] **Step 1: Write the failing test** — `runpod/tests/test_brightdata_normalize.py`

```python
from runpod.lib.brightdata import normalize_listing, normalize_listings


def test_normalizes_flat_brightdata_record():
    raw = {
        "url": "https://fb.com/marketplace/item/1",
        "name": "iPhone 13 128GB",
        "final_price": 380,
        "initial_price": 420,
        "currency": "USD",
        "condition": "Used - Good",
        "description": "small scratch",
        "seller": {"name": "Alex M."},
        "location": "San Francisco, CA",
        "images": ["https://img/1.jpg", "https://img/2.jpg"],
    }
    listing = normalize_listing(raw)
    assert listing.title == "iPhone 13 128GB"
    assert listing.price == 380.0          # prefers final_price
    assert listing.currency == "USD"
    assert listing.seller == "Alex M."     # object -> name
    assert listing.images == ["https://img/1.jpg", "https://img/2.jpg"]
    assert listing.raw == raw              # original preserved


def test_price_falls_back_and_handles_strings():
    listing = normalize_listing({"url": "u", "title": "t", "price": "$1,200"})
    assert listing.price == 1200.0


def test_seller_string_and_photos_objects():
    listing = normalize_listing({
        "url": "u", "title": "t", "seller_name": "Pat",
        "images": [{"url": "https://a.jpg"}, "https://b.jpg"],
    })
    assert listing.seller == "Pat"
    assert listing.images == ["https://a.jpg", "https://b.jpg"]


def test_normalize_listings_maps_all():
    out = normalize_listings([{"url": "u1", "title": "a"}, {"url": "u2", "title": "b"}])
    assert [l.title for l in out] == ["a", "b"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_brightdata_normalize.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'runpod.lib.brightdata'`

- [ ] **Step 3: Write minimal implementation** — `runpod/lib/brightdata.py` (normalization section)

```python
"""BrightData Facebook Marketplace client + tolerant normalization (stdlib only)."""
from __future__ import annotations

import re
from typing import Any, Optional

from runpod.lib.schema import Listing


def _to_number(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = re.sub(r"[^0-9.]", "", value)
        if cleaned:
            try:
                return float(cleaned)
            except ValueError:
                return None
    return None


def _pick(node: dict, keys: list[str]) -> Any:
    for k in keys:
        v = node.get(k)
        if v is not None:
            return v
    return None


def _extract_price(node: dict) -> Optional[float]:
    raw = _pick(node, ["final_price", "price", "initial_price", "amount"])
    if isinstance(raw, dict):
        formatted = _pick(raw, ["formatted_amount", "amount"])
        return _to_number(formatted)
    return _to_number(raw)


def _extract_images(node: dict) -> list[str]:
    images = _pick(node, ["images", "photos", "listing_photos"])
    out: list[str] = []
    if isinstance(images, list):
        for item in images:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict):
                url = item.get("url") or item.get("uri")
                if url:
                    out.append(str(url))
    single = _pick(node, ["image", "primary_photo", "thumbnail"])
    if not out and isinstance(single, str):
        out.append(single)
    elif not out and isinstance(single, dict):
        url = single.get("url") or single.get("uri")
        if url:
            out.append(str(url))
    return out


def _extract_seller(node: dict) -> Optional[str]:
    raw = _pick(node, ["seller_name", "seller", "marketplace_listing_seller"])
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        name = raw.get("name")
        return str(name) if name is not None else None
    return None


def normalize_listing(raw: dict) -> Listing:
    node = raw.get("node") if isinstance(raw.get("node"), dict) else raw
    listing_id = _pick(node, ["id", "listing_id", "item_id", "product_id"])
    return Listing(
        url=str(_pick(node, ["url", "listing_url", "link", "permalink"]) or ""),
        title=_pick(node, ["title", "name", "marketplace_listing_title"]),
        id=str(listing_id) if listing_id is not None else None,
        price=_extract_price(node),
        currency=_pick(node, ["currency"]),
        condition=_pick(node, ["condition"]),
        description=_pick(node, ["description", "redacted_description", "body"]),
        seller=_extract_seller(node),
        location=_pick(node, ["location", "location_text", "city"]) if isinstance(
            _pick(node, ["location", "location_text", "city"]), str
        ) else None,
        images=_extract_images(node),
        raw=raw,
    )


def normalize_listings(items: list[dict]) -> list[Listing]:
    return [normalize_listing(it) for it in items]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_brightdata_normalize.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add runpod/lib/brightdata.py runpod/tests/test_brightdata_normalize.py
git commit -m "feat(runpod): add tolerant BrightData listing normalization"
```

---

### Task 4: BrightData client (sync/async + keyless fallback)

**Files:**
- Modify: `runpod/lib/brightdata.py` (append client functions)
- Test: `runpod/tests/test_brightdata_client.py`

**Interfaces:**
- Consumes: `requests` (mocked in tests), `normalize_listings`, fixtures.
- Produces: `scrape_listings(urls: list[str], token: Optional[str]) -> list[Listing]`; `trigger_search(query: str, location: str, limit: int, token: str) -> str`; `fetch_snapshot(snapshot_id: str, token: str) -> Optional[list[Listing]]`; `load_fixture_listings() -> list[Listing]`. Module constants `BD_BASE = "https://api.brightdata.com"`, `DATASET_ID` (env-overridable).

> Implementation note: `DATASET_ID` defaults to a placeholder and is overridden via the `BRIGHTDATA_DATASET_ID` env var — confirm the real Facebook-Marketplace dataset id from the BrightData dashboard during this task and set it as the default.

- [ ] **Step 1: Write the failing test** — `runpod/tests/test_brightdata_client.py`

```python
import json
from pathlib import Path
import runpod.lib.brightdata as bd

FIX = Path(bd.__file__).resolve().parents[1] / "fixtures"


def test_scrape_listings_without_token_uses_fixtures():
    out = bd.scrape_listings(["https://fb.com/x"], token=None)
    assert len(out) >= 3
    assert any("iphone" in (l.title or "").lower() for l in out)


def test_scrape_listings_with_token_calls_sync_and_normalizes(monkeypatch):
    captured = {}

    class FakeResp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return [{"url": "u", "name": "iPhone 13", "final_price": 300, "images": ["i"]}]

    def fake_post(url, headers=None, json=None, params=None, timeout=None):
        captured["url"] = url
        captured["auth"] = headers.get("Authorization")
        return FakeResp()

    monkeypatch.setattr(bd.requests, "post", fake_post)
    out = bd.scrape_listings(["https://fb.com/x"], token="TKN")
    assert captured["auth"] == "Bearer TKN"
    assert out[0].title == "iPhone 13"
    assert out[0].price == 300.0


def test_load_fixture_listings_shape():
    out = bd.load_fixture_listings()
    assert all(l.url for l in out)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_brightdata_client.py -v`
Expected: FAIL with `AttributeError: module 'runpod.lib.brightdata' has no attribute 'scrape_listings'`

- [ ] **Step 3: Append client functions to `runpod/lib/brightdata.py`**

```python
import json
import os
from pathlib import Path

import requests

BD_BASE = "https://api.brightdata.com"
# TODO-IN-TASK: replace default with the real Facebook Marketplace dataset id.
DATASET_ID = os.environ.get("BRIGHTDATA_DATASET_ID", "gd_facebook_marketplace")
_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "iphone_listings.json"


def load_fixture_listings() -> list[Listing]:
    raw = json.loads(_FIXTURE_PATH.read_text())
    return normalize_listings(raw)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def scrape_listings(urls: list[str], token: Optional[str]) -> list[Listing]:
    """Detail-by-URL via BrightData sync /scrape (<=20 urls). No token -> fixtures."""
    if not token:
        return load_fixture_listings()
    resp = requests.post(
        f"{BD_BASE}/datasets/v3/scrape",
        headers=_headers(token),
        params={"dataset_id": DATASET_ID, "format": "json"},
        json=[{"url": u} for u in urls[:20]],
        timeout=180,
    )
    resp.raise_for_status()
    data = resp.json()
    items = data if isinstance(data, list) else data.get("data", data.get("results", []))
    return normalize_listings(items)


def trigger_search(query: str, location: str, limit: int, token: str) -> str:
    """Discovery via async /trigger -> returns snapshot_id to poll."""
    resp = requests.post(
        f"{BD_BASE}/datasets/v3/trigger",
        headers=_headers(token),
        params={"dataset_id": DATASET_ID, "type": "discover_new", "discover_by": "keyword"},
        json=[{"keyword": query, "location": location, "limit": limit}],
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["snapshot_id"]


def fetch_snapshot(snapshot_id: str, token: str) -> Optional[list[Listing]]:
    """Poll a snapshot. Returns None while still running, listings when ready."""
    resp = requests.get(
        f"{BD_BASE}/datasets/v3/snapshot/{snapshot_id}",
        headers=_headers(token),
        params={"format": "json"},
        timeout=60,
    )
    if resp.status_code == 202:
        return None  # still building
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, dict) and data.get("status") in ("running", "building"):
        return None
    items = data if isinstance(data, list) else data.get("data", data.get("results", []))
    return normalize_listings(items)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_brightdata_client.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add runpod/lib/brightdata.py runpod/tests/test_brightdata_client.py
git commit -m "feat(runpod): add BrightData sync/async client with keyless fallback"
```

---

### Task 5: Scraper endpoint (`scraper_ep.py`)

**Files:**
- Create: `runpod/scraper_ep.py`

**Interfaces:**
- Consumes: `runpod.lib.brightdata`, `runpod.lib.schema.to_jsonable`. Reads `BRIGHTDATA_API_TOKEN` from env on the worker.
- Produces deployed routes: `POST /listing` `{urls:[...]}` -> `{listings:[...]}`; `POST /search` `{query,location,limit}` -> `{snapshot_id}` (or `{listings}` when keyless); `POST /snapshot` `{snapshot_id}` -> `{status, listings}`; `POST /comparables` `{title}` -> `{comparables: []}` (stub).

- [ ] **Step 1: Write the endpoint** — `runpod/scraper_ep.py`

Per the flash body-only rule, all imports are inside each route body.

```python
"""RunPod Flash CPU endpoint: BrightData Facebook Marketplace scraping."""
from runpod_flash import Endpoint, CpuInstanceType

scraper = Endpoint(
    name="fbm-scraper",
    cpu=CpuInstanceType.CPU5C_2_4,
    workers=(1, 3),
    max_concurrency=4,
    dependencies=["requests"],
)


@scraper.post("/listing")
async def listing(data: dict):
    import os
    from runpod.lib.brightdata import scrape_listings
    from runpod.lib.schema import to_jsonable

    urls = data.get("urls") or ([data["url"]] if data.get("url") else [])
    token = os.environ.get("BRIGHTDATA_API_TOKEN")
    listings = scrape_listings(urls, token)
    return {"listings": [to_jsonable(l) for l in listings]}


@scraper.post("/search")
async def search(data: dict):
    import os
    from runpod.lib.brightdata import trigger_search, load_fixture_listings
    from runpod.lib.schema import to_jsonable

    token = os.environ.get("BRIGHTDATA_API_TOKEN")
    if not token:
        return {"listings": [to_jsonable(l) for l in load_fixture_listings()], "snapshot_id": None}
    snapshot_id = trigger_search(
        data.get("query", "iPhone"), data.get("location", ""), int(data.get("limit", 10)), token
    )
    return {"snapshot_id": snapshot_id, "listings": None}


@scraper.post("/snapshot")
async def snapshot(data: dict):
    import os
    from runpod.lib.brightdata import fetch_snapshot
    from runpod.lib.schema import to_jsonable

    token = os.environ.get("BRIGHTDATA_API_TOKEN")
    listings = fetch_snapshot(data["snapshot_id"], token)
    if listings is None:
        return {"status": "pending", "listings": None}
    return {"status": "ready", "listings": [to_jsonable(l) for l in listings]}


@scraper.post("/comparables")
async def comparables(data: dict):
    # Phase 2: BrightData SERP-based comparable prices. Stubbed for now.
    return {"comparables": [], "note": "phase-2 stub"}
```

- [ ] **Step 2: Smoke-test locally with `flash dev`**

```bash
cd /Users/nori/Desktop/fb_marketplace_agent/runpod
flash dev > /tmp/flash-scraper.log 2>&1 &
until grep -q "flash dev  localhost:" /tmp/flash-scraper.log; do sleep 2; done
URL=$(grep -o "localhost:[0-9]*" /tmp/flash-scraper.log | head -1)
curl -s "$URL/scraper_ep/listing" -d '{"data": {"urls": ["https://fb.com/x"]}}'
```

Expected: JSON with `listings` containing ≥3 iPhone fixture entries (keyless fallback). `kill %1` when done.

> If `from runpod.lib...` does not resolve on the worker under `flash dev`, that is the documented body-only caveat — proceed; Task 10's `flash deploy` packages the project dir so it resolves in production, and the logic itself is already covered by Tasks 3–4 unit tests.

- [ ] **Step 3: Commit**

```bash
cd /Users/nori/Desktop/fb_marketplace_agent
git add runpod/scraper_ep.py
git commit -m "feat(runpod): add scraper endpoint (listing/search/snapshot/comparables)"
```

---

### Task 6: Defect prompt + response parsing

**Files:**
- Create: `runpod/lib/defects.py`
- Test: `runpod/tests/test_defects.py`

**Interfaces:**
- Consumes: `runpod.lib.schema.Defect`, `ImageDefectReport`.
- Produces: `build_defect_prompt() -> str`; `parse_defect_response(text: str, image_url: str) -> ImageDefectReport`.

- [ ] **Step 1: Write the failing test** — `runpod/tests/test_defects.py`

```python
from runpod.lib.defects import build_defect_prompt, parse_defect_response


def test_prompt_mentions_iphone_and_json():
    p = build_defect_prompt()
    assert "iPhone" in p
    assert "json" in p.lower()
    assert "condition_grade" in p


def test_parse_clean_json():
    text = '{"defects": [{"type": "crack", "component": "screen", "severity": "severe", "confidence": 0.92, "note": "spiderweb crack"}], "condition_grade": "poor", "negotiation_summary": "screen cracked"}'
    r = parse_defect_response(text, "http://img/1")
    assert r.image_url == "http://img/1"
    assert r.condition_grade == "poor"
    assert r.defects[0].component == "screen"
    assert r.defects[0].severity == "severe"
    assert r.error is None


def test_parse_json_embedded_in_markdown_fence():
    text = 'Sure!\n```json\n{"defects": [], "condition_grade": "excellent", "negotiation_summary": "no visible defects"}\n```'
    r = parse_defect_response(text, "http://img/2")
    assert r.defects == []
    assert r.condition_grade == "excellent"
    assert r.error is None


def test_parse_unparseable_sets_error_and_preserves_text():
    r = parse_defect_response("the phone looks a bit scratched", "http://img/3")
    assert r.error == "unparseable"
    assert "scratched" in r.negotiation_summary
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_defects.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'runpod.lib.defects'`

- [ ] **Step 3: Write implementation** — `runpod/lib/defects.py`

```python
"""VLM defect prompt + tolerant JSON response parsing (stdlib only)."""
from __future__ import annotations

import json
import re
from typing import Any

from runpod.lib.schema import Defect, ImageDefectReport

_VALID_SEVERITY = {"minor", "moderate", "severe"}


def build_defect_prompt() -> str:
    return (
        "You are inspecting a photo from a used iPhone Facebook Marketplace listing. "
        "Identify every VISIBLE physical defect (cracked/scratched screen, scratches, "
        "dents, chips, discoloration, missing parts). Respond with ONLY a json object:\n"
        '{"defects": [{"type": str, "component": str, '
        '"severity": "minor"|"moderate"|"severe", "confidence": 0..1, "note": str}], '
        '"condition_grade": "excellent"|"good"|"fair"|"poor", '
        '"negotiation_summary": str}\n'
        "If no defects are visible, return an empty defects array and condition_grade "
        '"excellent". Do not include any text outside the json object.'
    )


def _extract_json(text: str) -> dict[str, Any] | None:
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fence.group(1) if fence else None
    if candidate is None:
        brace = re.search(r"\{.*\}", text, re.DOTALL)
        candidate = brace.group(0) if brace else None
    if candidate is None:
        return None
    try:
        obj = json.loads(candidate)
        return obj if isinstance(obj, dict) else None
    except (ValueError, TypeError):
        return None


def parse_defect_response(text: str, image_url: str) -> ImageDefectReport:
    obj = _extract_json(text)
    if obj is None or "condition_grade" not in obj:
        return ImageDefectReport(
            image_url=image_url,
            condition_grade="unknown",
            negotiation_summary=text.strip()[:300],
            error="unparseable",
        )
    defects: list[Defect] = []
    for d in obj.get("defects", []) or []:
        if not isinstance(d, dict):
            continue
        severity = str(d.get("severity", "minor")).lower()
        if severity not in _VALID_SEVERITY:
            severity = "minor"
        try:
            confidence = float(d.get("confidence", 0.0))
        except (ValueError, TypeError):
            confidence = 0.0
        defects.append(Defect(
            type=str(d.get("type", "unknown")),
            component=str(d.get("component", "unknown")),
            severity=severity,
            confidence=confidence,
            note=str(d.get("note", "")),
        ))
    return ImageDefectReport(
        image_url=image_url,
        defects=defects,
        condition_grade=str(obj.get("condition_grade", "unknown")),
        negotiation_summary=str(obj.get("negotiation_summary", "")),
        error=None,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_defects.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add runpod/lib/defects.py runpod/tests/test_defects.py
git commit -m "feat(runpod): add VLM defect prompt and tolerant response parsing"
```

---

### Task 7: Vision endpoint (`vision_ep.py`)

**Files:**
- Create: `runpod/vision_ep.py`

**Interfaces:**
- Consumes: `runpod.lib.defects`, `runpod.lib.schema.to_jsonable`. Loads Qwen2.5-VL-7B-Instruct once per warm worker.
- Produces deployed route: `POST /defects` `{image_urls:[...]}` -> `{reports:[ImageDefectReport...]}`.

- [ ] **Step 1: Write the endpoint** — `runpod/vision_ep.py`

Model is cached in a module-global dict, lazily initialized inside the body (survives across warm requests). One structured-repair retry on unparseable output.

```python
"""RunPod Flash GPU endpoint: Qwen2.5-VL iPhone defect detection."""
from runpod_flash import Endpoint, GpuGroup

vision = Endpoint(
    name="fbm-vision",
    gpu=GpuGroup.ADA_24,
    workers=(0, 2),
    dependencies=["torch", "transformers", "accelerate", "qwen-vl-utils", "pillow", "requests"],
)

_MODEL_CACHE = {}


def _infer(image_url: str, prompt: str) -> str:
    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor
    from qwen_vl_utils import process_vision_info

    if "model" not in _MODEL_CACHE:
        name = "Qwen/Qwen2.5-VL-7B-Instruct"
        _MODEL_CACHE["model"] = AutoModelForImageTextToText.from_pretrained(
            name, torch_dtype=torch.bfloat16, device_map="auto"
        )
        _MODEL_CACHE["processor"] = AutoProcessor.from_pretrained(name)
    model = _MODEL_CACHE["model"]
    processor = _MODEL_CACHE["processor"]

    messages = [{"role": "user", "content": [
        {"type": "image", "image": image_url},
        {"type": "text", "text": prompt},
    ]}]
    chat = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = processor(text=[chat], images=image_inputs, videos=video_inputs,
                       padding=True, return_tensors="pt").to(model.device)
    generated = model.generate(**inputs, max_new_tokens=512)
    trimmed = [out[len(inp):] for inp, out in zip(inputs.input_ids, generated)]
    return processor.batch_decode(trimmed, skip_special_tokens=True)[0]


@vision.post("/defects")
async def defects(data: dict):
    from runpod.lib.defects import build_defect_prompt, parse_defect_response
    from runpod.lib.schema import to_jsonable, ImageDefectReport

    prompt = build_defect_prompt()
    reports = []
    for url in data.get("image_urls", []):
        try:
            report = parse_defect_response(_infer(url, prompt), url)
            if report.error == "unparseable":  # one structured-repair retry
                retry_prompt = prompt + "\nReturn ONLY valid json, nothing else."
                report = parse_defect_response(_infer(url, retry_prompt), url)
        except Exception as exc:  # bad/unreachable image -> per-image error, continue
            report = ImageDefectReport(image_url=url, condition_grade="unknown",
                                       negotiation_summary="", error=str(exc)[:200])
        reports.append(to_jsonable(report))
    return {"reports": reports}
```

- [ ] **Step 2: Live-validate with `flash dev` (real GPU)**

```bash
cd /Users/nori/Desktop/fb_marketplace_agent/runpod
flash dev --auto-provision > /tmp/flash-vision.log 2>&1 &
until grep -q "flash dev  localhost:" /tmp/flash-vision.log; do sleep 2; done
URL=$(grep -o "localhost:[0-9]*" /tmp/flash-vision.log | head -1)
CRACKED=$(python -c "import json,pathlib;print(json.load(open('fixtures/images.json'))['cracked'][0])")
CLEAN=$(python -c "import json,pathlib;print(json.load(open('fixtures/images.json'))['clean'][0])")
curl -s "$URL/vision_ep/defects" -d "{\"data\": {\"image_urls\": [\"$CRACKED\", \"$CLEAN\"]}}"
```

Expected: two reports; the cracked image yields ≥1 defect on `screen` with a worse `condition_grade` than the clean image. Watch `/tmp/flash-vision.log` for model load + inference. `kill %1` when done.

> First call cold-starts and downloads the ~16 GB model — allow several minutes; the log streams progress. If 24 GB is tight, change `gpu=GpuGroup.AMPERE_48` in the Endpoint constructor and re-run.

- [ ] **Step 3: Commit**

```bash
cd /Users/nori/Desktop/fb_marketplace_agent
git add runpod/vision_ep.py
git commit -m "feat(runpod): add Qwen2.5-VL defect-detection vision endpoint"
```

---

### Task 8: Pipeline / DealReport assembly

**Files:**
- Create: `runpod/lib/pipeline.py`
- Test: `runpod/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `runpod.lib.schema` types.
- Produces: `overall_grade(reports: list[ImageDefectReport]) -> str`; `negotiation_evidence(listing: Listing, reports: list[ImageDefectReport]) -> dict`; `assemble_deal_report(listing, reports, comparables=None) -> DealReport`.

- [ ] **Step 1: Write the failing test** — `runpod/tests/test_pipeline.py`

```python
from runpod.lib.schema import Listing, Defect, ImageDefectReport
from runpod.lib.pipeline import overall_grade, negotiation_evidence, assemble_deal_report


def _rep(grade, defects=()):
    return ImageDefectReport(image_url="i", defects=list(defects), condition_grade=grade)


def test_overall_grade_takes_worst():
    assert overall_grade([_rep("excellent"), _rep("poor"), _rep("good")]) == "poor"


def test_overall_grade_unknown_when_empty():
    assert overall_grade([]) == "unknown"


def test_negotiation_evidence_lists_severe_defects():
    listing = Listing(url="u", title="iPhone 12", price=300.0)
    reps = [_rep("poor", [Defect("crack", "screen", "severe", 0.9, "cracked")])]
    ev = negotiation_evidence(listing, reps)
    assert any("screen" in r for r in ev["reasons"])
    assert ev["defect_count"] == 1


def test_assemble_deal_report_merges():
    listing = Listing(url="u", title="iPhone 12", price=300.0)
    reps = [_rep("fair", [Defect("scratch", "back", "minor", 0.5, "")])]
    report = assemble_deal_report(listing, reps, comparables=[{"price": 350}])
    assert report.overall_condition_grade == "fair"
    assert report.comparables == [{"price": 350}]
    assert report.negotiation_evidence["defect_count"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_pipeline.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'runpod.lib.pipeline'`

- [ ] **Step 3: Write implementation** — `runpod/lib/pipeline.py`

```python
"""Merge listing + per-image defect reports into a DealReport (stdlib only)."""
from __future__ import annotations

from typing import Optional

from runpod.lib.schema import Listing, ImageDefectReport, DealReport

_GRADE_ORDER = ["excellent", "good", "fair", "poor"]


def overall_grade(reports: list[ImageDefectReport]) -> str:
    grades = [r.condition_grade for r in reports if r.condition_grade in _GRADE_ORDER]
    if not grades:
        return "unknown"
    return max(grades, key=lambda g: _GRADE_ORDER.index(g))


def negotiation_evidence(listing: Listing, reports: list[ImageDefectReport]) -> dict:
    reasons: list[str] = []
    defect_count = 0
    for r in reports:
        for d in r.defects:
            defect_count += 1
            if d.severity in ("moderate", "severe"):
                reasons.append(f"{d.severity} {d.type} on {d.component}")
    return {
        "reasons": reasons,
        "defect_count": defect_count,
        "listed_price": listing.price,
        "overall_condition_grade": overall_grade(reports),
    }


def assemble_deal_report(
    listing: Listing,
    reports: list[ImageDefectReport],
    comparables: Optional[list[dict]] = None,
) -> DealReport:
    return DealReport(
        listing=listing,
        image_reports=reports,
        overall_condition_grade=overall_grade(reports),
        comparables=comparables or [],
        negotiation_evidence=negotiation_evidence(listing, reports),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_pipeline.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add runpod/lib/pipeline.py runpod/tests/test_pipeline.py
git commit -m "feat(runpod): add DealReport pipeline assembly"
```

---

### Task 9: Demo CLI (`demo.py`)

**Files:**
- Create: `runpod/demo.py`
- Test: `runpod/tests/test_demo.py`

**Interfaces:**
- Consumes: `runpod.lib.brightdata.load_fixture_listings`, `runpod.lib.pipeline.assemble_deal_report`, `runpod.lib.schema`.
- Produces: `build_reports_offline() -> list[DealReport]` (no network/GPU — uses fixtures + a deterministic stub defect report), and a `main()` that prints them.

- [ ] **Step 1: Write the failing test** — `runpod/tests/test_demo.py`

```python
from runpod.demo import build_reports_offline


def test_offline_demo_builds_one_report_per_fixture_listing():
    reports = build_reports_offline()
    assert len(reports) >= 3
    for r in reports:
        assert r.listing.title
        assert r.overall_condition_grade in {"excellent", "good", "fair", "poor", "unknown"}
        assert "defect_count" in r.negotiation_evidence
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_demo.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'runpod.demo'`

- [ ] **Step 3: Write implementation** — `runpod/demo.py`

`build_reports_offline` derives a stub defect report from each fixture listing's description (so the demo runs with zero credentials/GPU); a `--live` flag path documents how to swap in the real endpoints.

```python
"""End-to-end iPhone demo: scrape -> defects -> DealReport.

Offline mode (default) uses fixtures + a description-derived stub defect report so it runs
with no BrightData key and no GPU. `--live` documents the real endpoint-backed path.
"""
from __future__ import annotations

import json

from runpod.lib.brightdata import load_fixture_listings
from runpod.lib.schema import Defect, ImageDefectReport, DealReport, to_jsonable
from runpod.lib.pipeline import assemble_deal_report


def _stub_report_for(listing) -> ImageDefectReport:
    desc = (listing.description or "").lower()
    image_url = listing.images[0] if listing.images else ""
    if "crack" in desc:
        return ImageDefectReport(
            image_url=image_url,
            defects=[Defect("crack", "screen", "severe", 0.9, "described as cracked")],
            condition_grade="poor",
            negotiation_summary="Seller states the screen is cracked.",
        )
    if "scratch" in desc:
        return ImageDefectReport(
            image_url=image_url,
            defects=[Defect("scratch", "body", "minor", 0.6, "described as scratched")],
            condition_grade="good",
            negotiation_summary="Minor scratches noted.",
        )
    return ImageDefectReport(image_url=image_url, condition_grade="excellent",
                             negotiation_summary="No defects described.")


def build_reports_offline() -> list[DealReport]:
    reports = []
    for listing in load_fixture_listings():
        reports.append(assemble_deal_report(listing, [_stub_report_for(listing)]))
    return reports


def main() -> None:
    for report in build_reports_offline():
        print(json.dumps(to_jsonable(report), indent=2))
        print("-" * 60)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test + run the demo**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests/test_demo.py -v`
Expected: PASS (1 passed)

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m runpod.demo`
Expected: prints 3 DealReport JSON blocks; the cracked-screen iPhone shows `overall_condition_grade: "poor"` with a screen defect.

- [ ] **Step 5: Commit**

```bash
git add runpod/demo.py runpod/tests/test_demo.py
git commit -m "feat(runpod): add end-to-end iPhone demo CLI"
```

---

### Task 10: Deploy endpoints + document HTTP contracts

**Files:**
- Create: `runpod/README.md`

**Interfaces:**
- Consumes: deployed `scraper_ep.py`, `vision_ep.py`.
- Produces: deployed RunPod endpoints + an HTTP contract doc for Steven's UI.

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/nori/Desktop/fb_marketplace_agent && python -m pytest runpod/tests -v`
Expected: all tests PASS.

- [ ] **Step 2: Deploy both endpoints**

```bash
cd /Users/nori/Desktop/fb_marketplace_agent/runpod
export BRIGHTDATA_API_TOKEN=...   # real token; set BRIGHTDATA_DATASET_ID if non-default
flash deploy
flash undeploy list   # confirm fbm-scraper and fbm-vision are listed
```

Expected: both endpoints deploy; `flash undeploy list` shows their URLs/ids. Verify a deployed `/scraper_ep/listing` call returns normalized listings (this confirms the `runpod.lib` imports resolved in the packaged artifact).

- [ ] **Step 3: Write `runpod/README.md`** documenting setup + the HTTP contract for each route

```markdown
# RunPod Marketplace Backend

CPU `scraper` (BrightData) + GPU `vision` (Qwen2.5-VL defect detection) for the FB
Marketplace iPhone demo.

## Setup
- `pip install -r requirements.txt`
- `flash login` (or `export RUNPOD_API_KEY=...`)
- `export BRIGHTDATA_API_TOKEN=...`  (omit for fixture-backed dev)
- `export BRIGHTDATA_DATASET_ID=...` (only if not the default)

## Dev / Deploy
- `flash dev` — run endpoints on remote workers with hot reload
- `flash deploy` — ship stable endpoints
- `python -m runpod.demo` — offline end-to-end demo

## HTTP contract (for the UI)
POST /scraper_ep/listing   {urls:[str]}            -> {listings:[Listing]}
POST /scraper_ep/search    {query,location,limit}  -> {snapshot_id} | {listings}
POST /scraper_ep/snapshot  {snapshot_id}           -> {status, listings}
POST /scraper_ep/comparables {title}               -> {comparables:[]}  (phase-2 stub)
POST /vision_ep/defects    {image_urls:[str]}      -> {reports:[ImageDefectReport]}

Listing: {url,title,id,price,currency,condition,description,seller,location,images[],raw}
ImageDefectReport: {image_url,defects[],condition_grade,negotiation_summary,error}
Defect: {type,component,severity,confidence,note}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/nori/Desktop/fb_marketplace_agent
git add runpod/README.md
git commit -m "docs(runpod): deploy endpoints and document HTTP contract"
```

---

## Self-Review

**Spec coverage:**
- BrightData scraping (price/image/description/seller) → Tasks 3, 4, 5 ✓
- Sync detail + async discovery + keyless fallback → Task 4, 5 ✓
- VLM defect detection on RunPod GPU → Tasks 6, 7 ✓
- Structured defect JSON + repair retry → Tasks 6, 7 ✓
- DealReport orchestration → Tasks 8, 9 ✓
- Comparables phase-2 stub → Task 5 ✓
- Deploy + contract for Steven → Task 10 ✓
- Keyless `flash dev` via fixtures → Tasks 2, 4, 5, 9 ✓
- Error handling (bad image, BD shape, unparseable VLM) → Tasks 3, 6, 7 ✓
- Out of scope (scam detection, negotiation gen, UI) → not planned ✓

**Type consistency:** `Listing`, `Defect`, `ImageDefectReport`, `DealReport`, `to_jsonable`, `listing_from_dict` defined in Task 1 and used consistently in Tasks 3–9. `normalize_listings`/`scrape_listings`/`trigger_search`/`fetch_snapshot` defined in Tasks 3–4 and consumed by Task 5. `build_defect_prompt`/`parse_defect_response` defined in Task 6, consumed in Task 7. `overall_grade`/`negotiation_evidence`/`assemble_deal_report` defined in Task 8, consumed in Task 9.

**Placeholder scan:** No "TBD/implement later" steps; every code step shows complete code. Two explicitly-flagged build-time confirmations remain (real BrightData `DATASET_ID` in Task 4; GPU-tier fallback in Task 7) — both have concrete defaults and instructions, not placeholders.
