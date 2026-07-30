"""BrightData Web Unlocker client + tolerant Facebook Marketplace normalization.

We use the BrightData **Web Unlocker** Web Access API (not the paid Marketplace
dataset): hand it a listing/search URL, it returns the fully rendered HTML, and
we extract the JSON Facebook embeds in <script> tags and normalize it into our
`Listing` schema. Normalization is intentionally tolerant — Facebook's embedded
shapes (e.g. `{"text": ...}` wrappers, `listing_price`, `primary_listing_photo`)
and the legacy dataset shapes are both handled, and the original payload is kept
under `raw`.

Only `requests` is third-party; the normalize/parse/fixture path is stdlib-only
so it imports and runs without `requests` installed.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Optional

try:
    import requests
except ImportError:  # keeps the pure normalize/parse/fixture/demo path stdlib-only
    requests = None

from runpod.lib.schema import Listing

BD_BASE = "https://api.brightdata.com"
# BrightData Web Unlocker zone name (from your BrightData dashboard).
WEB_UNLOCKER_ZONE = os.environ.get("BRIGHTDATA_WEB_UNLOCKER_ZONE", "web_unlocker1")
_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "iphone_listings.json"


# --- tolerant field extraction ----------------------------------------------

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


def _as_text(value: Any) -> Optional[str]:
    """A string, or the `.text`/`.display_name` of a Facebook `{text: ...}` wrapper."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for k in ("text", "display_name"):
            inner = value.get(k)
            if isinstance(inner, str):
                return inner
    return None


def _extract_price(node: dict) -> Optional[float]:
    raw = _pick(node, ["final_price", "listing_price", "price", "formatted_price", "initial_price", "amount"])
    if isinstance(raw, dict):
        formatted = _pick(raw, ["formatted_amount_zeros_stripped", "formatted_amount", "amount"])
        return _to_number(formatted)
    return _to_number(raw)


def _photo_url(item: Any) -> Optional[str]:
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        direct = item.get("url") or item.get("uri")
        if direct:
            return str(direct)
        nested = item.get("image") or item.get("listing_image") or item.get("photo_image")
        if isinstance(nested, dict):
            u = nested.get("uri") or nested.get("url")
            if u:
                return str(u)
    return None


def _extract_images(node: dict) -> list[str]:
    out: list[str] = []
    images = _pick(node, ["images", "photos", "listing_photos"])
    if isinstance(images, list):
        for item in images:
            u = _photo_url(item)
            if u:
                out.append(u)
    if not out:
        single = _pick(node, ["image", "primary_photo", "thumbnail", "primary_listing_photo"])
        u = _photo_url(single)
        if u:
            out.append(u)
    return out


def _extract_seller(node: dict) -> Optional[str]:
    raw = _pick(node, ["seller_name", "seller", "marketplace_listing_seller", "actor"])
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        name = raw.get("name")
        return str(name) if name is not None else None
    return None


def _extract_location(node: dict) -> Optional[str]:
    # Prefer an explicit text field; a bare `location` dict may be lat/lng coords
    # (no display name) and must not produce garbage. Facebook search nodes nest
    # the place under `location.reverse_geocode`.
    text = _as_text(_pick(node, ["location_text"]))
    if text:
        return text
    loc = _pick(node, ["location", "city"])
    if isinstance(loc, str):
        return loc
    if isinstance(loc, dict):
        rg = loc.get("reverse_geocode")
        src = rg if isinstance(rg, dict) else loc
        for k in ("text", "display_name"):
            if isinstance(src.get(k), str):
                return src[k]
        parts = [p for p in (src.get("city"), src.get("state")) if isinstance(p, str)]
        if parts:
            return ", ".join(parts)
    return None


def normalize_listing(raw: dict) -> Listing:
    node = raw.get("node") if isinstance(raw.get("node"), dict) else raw
    listing_id = _pick(node, ["id", "listing_id", "item_id", "product_id"])
    return Listing(
        url=str(_pick(node, ["url", "listing_url", "link", "permalink"]) or ""),
        title=_as_text(_pick(node, ["title", "name", "marketplace_listing_title"])),
        id=str(listing_id) if listing_id is not None else None,
        price=_extract_price(node),
        currency=_pick(node, ["currency"]),
        condition=_as_text(_pick(node, ["condition"])),
        description=_as_text(_pick(node, ["description", "redacted_description", "body"])),
        seller=_extract_seller(node),
        location=_extract_location(node),
        images=_extract_images(node),
        raw=raw,
    )


def normalize_listings(items: list[dict]) -> list[Listing]:
    return [normalize_listing(it) for it in items]


def load_fixture_listings() -> list[Listing]:
    raw = json.loads(_FIXTURE_PATH.read_text())
    return normalize_listings(raw)


# --- HTML -> embedded JSON listing extraction -------------------------------

def _iter_json_blobs(html: str):
    """Yield parsed JSON objects from <script> tags whose body is JSON."""
    for match in re.finditer(r"<script[^>]*>(.*?)</script>", html, re.DOTALL):
        body = match.group(1).strip()
        if body[:1] in "{[":
            try:
                yield json.loads(body)
            except ValueError:
                continue


def _looks_like_listing(d: dict) -> bool:
    if "marketplace_listing_title" in d:
        return True
    has_title = any(k in d for k in ("title", "name"))
    has_price = any(k in d for k in ("listing_price", "formatted_price", "price", "final_price"))
    return has_title and has_price


def _walk(obj: Any, found: list[dict]) -> None:
    if isinstance(obj, dict):
        if _looks_like_listing(obj):
            found.append(obj)
        for v in obj.values():
            _walk(v, found)
    elif isinstance(obj, list):
        for v in obj:
            _walk(v, found)


def extract_listings_from_html(html: str) -> list[dict]:
    """Find Facebook-Marketplace listing nodes embedded in a page's JSON blobs."""
    found: list[dict] = []
    for blob in _iter_json_blobs(html):
        _walk(blob, found)
    seen: set[str] = set()
    out: list[dict] = []
    for d in found:
        key = str(_pick(d, ["id", "listing_id", "marketplace_listing_title", "title"]) or id(d))
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out


# --- Web Unlocker fetch ------------------------------------------------------

def _unlock_html(url: str, token: str) -> str:
    """Fetch a URL's rendered HTML via the BrightData Web Unlocker API."""
    if requests is None:
        raise RuntimeError("the 'requests' package is required for live BrightData calls")
    resp = requests.post(
        f"{BD_BASE}/request",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"zone": WEB_UNLOCKER_ZONE, "url": url, "format": "raw"},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.text


def _search_url(query: str, location: str) -> str:
    from urllib.parse import quote
    base = "https://www.facebook.com/marketplace/search"
    qs = f"query={quote(query)}"
    if location:
        qs += f"&location={quote(location)}"
    return f"{base}?{qs}"


def _item_id_from_url(url: str) -> Optional[str]:
    match = re.search(r"/item/(\d+)", url)
    return match.group(1) if match else None


def _has_description(record: dict) -> bool:
    desc = record.get("redacted_description")
    if isinstance(desc, dict) and desc.get("text"):
        return True
    return isinstance(record.get("description"), str) and bool(record["description"])


def _select_target_node(records: list[dict], target_id: Optional[str]) -> Optional[dict]:
    """An item page embeds the target listing (often as both a lightweight feed
    node and a rich detail node with the same id) plus a recommendation rail.
    Prefer the id-matched node that carries a description, then any id match, then
    any description-bearing node, then the first."""
    id_matches = [r for r in records if target_id and str(r.get("id")) == target_id]
    for record in id_matches:
        if _has_description(record):
            return record
    if id_matches:
        return id_matches[0]
    for record in records:
        if _has_description(record):
            return record
    return records[0] if records else None


def scrape_listings(urls: list[str], token: Optional[str]) -> list[Listing]:
    """Detail-by-URL via Web Unlocker. No token -> seeded fixtures. Returns the
    target listing per item URL (not the page's recommendation rail)."""
    if not token:
        return load_fixture_listings()
    out: list[Listing] = []
    for url in urls:
        html = _unlock_html(url, token)
        records = extract_listings_from_html(html)
        node = _select_target_node(records, _item_id_from_url(url))
        if node is None:
            continue
        node.setdefault("url", url)
        out.append(normalize_listing(node))
    return out


def search_listings(query: str, location: str, limit: int, token: Optional[str]) -> list[Listing]:
    """Keyword search via Web Unlocker (single fetch). No token -> seeded fixtures."""
    if not token:
        listings = load_fixture_listings()
        return listings[:limit] if limit else listings
    html = _unlock_html(_search_url(query, location), token)
    listings = normalize_listings(extract_listings_from_html(html))
    return listings[:limit] if limit else listings
