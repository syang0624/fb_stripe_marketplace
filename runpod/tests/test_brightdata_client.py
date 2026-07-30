import runpod.lib.brightdata as bd

# A minimal Facebook-Marketplace-style page: the listing data lives in JSON
# embedded in a <script> tag, wrapped the way Facebook nests it.
SAMPLE_HTML = """
<html><head>
<script type="application/json">{"require":[["ScheduledServerJS"]]}</script>
<script type="application/json">
{"data":{"viewer":{"marketplace_product_details_page":{"target":{
  "id":"123","marketplace_listing_title":"iPhone 13 128GB Blue",
  "listing_price":{"amount":"380","formatted_amount":"$380"},
  "redacted_description":{"text":"Small scratch on the back."},
  "location_text":{"text":"San Francisco, CA"},
  "primary_listing_photo":{"image":{"uri":"https://img/1.jpg"}},
  "marketplace_listing_seller":{"name":"Alex M."}
}}}}}
</script>
</head><body></body></html>
"""


def test_scrape_listings_without_token_uses_fixtures():
    out = bd.scrape_listings(["https://fb.com/x"], token=None)
    assert len(out) >= 3
    assert any("iphone" in (l.title or "").lower() for l in out)


def test_extract_listings_from_html_finds_nested_node():
    records = bd.extract_listings_from_html(SAMPLE_HTML)
    assert len(records) == 1
    assert records[0]["marketplace_listing_title"] == "iPhone 13 128GB Blue"


def test_scrape_listings_with_token_unlocks_and_normalizes(monkeypatch):
    captured = {}

    class FakeResp:
        status_code = 200
        text = SAMPLE_HTML
        def raise_for_status(self): pass

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["auth"] = headers.get("Authorization")
        captured["zone"] = (json or {}).get("zone")
        captured["target"] = (json or {}).get("url")
        return FakeResp()

    monkeypatch.setattr(bd.requests, "post", fake_post)
    out = bd.scrape_listings(["https://www.facebook.com/marketplace/item/123"], token="TKN")
    assert captured["auth"] == "Bearer TKN"
    assert captured["url"] == f"{bd.BD_BASE}/request"
    assert captured["zone"] == bd.WEB_UNLOCKER_ZONE
    assert captured["target"] == "https://www.facebook.com/marketplace/item/123"
    assert len(out) == 1
    listing = out[0]
    assert listing.title == "iPhone 13 128GB Blue"
    assert listing.price == 380.0
    assert listing.seller == "Alex M."
    assert listing.description == "Small scratch on the back."
    assert listing.location == "San Francisco, CA"
    assert listing.images == ["https://img/1.jpg"]
    # source url is backfilled when the embedded node lacks one
    assert listing.url == "https://www.facebook.com/marketplace/item/123"


def test_search_listings_without_token_uses_fixtures():
    out = bd.search_listings("iPhone 13", "San Francisco", 2, token=None)
    assert len(out) == 2


def test_search_listings_with_token_unlocks_search_url(monkeypatch):
    captured = {}

    class FakeResp:
        status_code = 200
        text = SAMPLE_HTML
        def raise_for_status(self): pass

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["target"] = (json or {}).get("url")
        return FakeResp()

    monkeypatch.setattr(bd.requests, "post", fake_post)
    out = bd.search_listings("iPhone 13", "San Francisco", 10, token="TKN")
    assert "facebook.com/marketplace/search" in captured["target"]
    assert "query=iPhone" in captured["target"]
    assert out[0].title == "iPhone 13 128GB Blue"


def test_load_fixture_listings_shape():
    out = bd.load_fixture_listings()
    assert all(l.url for l in out)


# An item page embeds the target listing (with a description) plus a
# recommendation rail of other listings that lack one.
DETAIL_HTML = """
<script type="application/json">
{"feed":[
 {"id":"999","marketplace_listing_title":"Random Bike","listing_price":{"amount":"50"}},
 {"id":"123","marketplace_listing_title":"iPhone 13 128GB","listing_price":{"amount":"380","formatted_amount":"$380"},"redacted_description":{"text":"Great condition"},"location_text":{"text":"Oakland, CA"}}
]}
</script>
"""


def test_scrape_listings_picks_detail_target_not_recommendations(monkeypatch):
    class FakeResp:
        status_code = 200
        text = DETAIL_HTML
        def raise_for_status(self): pass

    monkeypatch.setattr(bd.requests, "post", lambda *a, **k: FakeResp())
    out = bd.scrape_listings(["https://www.facebook.com/marketplace/item/123"], token="TKN")
    assert len(out) == 1
    assert out[0].title == "iPhone 13 128GB"
    assert out[0].description == "Great condition"
    assert out[0].location == "Oakland, CA"
