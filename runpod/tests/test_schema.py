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
