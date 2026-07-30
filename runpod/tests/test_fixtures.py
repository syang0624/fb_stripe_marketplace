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
