from runpod.demo import build_reports_offline


def test_offline_demo_builds_one_report_per_fixture_listing():
    reports = build_reports_offline()
    assert len(reports) >= 3
    for r in reports:
        assert r.listing.title
        assert r.overall_condition_grade in {"excellent", "good", "fair", "poor", "unknown"}
        assert "defect_count" in r.negotiation_evidence


def test_like_new_listing_grades_excellent():
    reports = build_reports_offline()
    like_new = [r for r in reports if "like new" in (r.listing.title or "").lower()]
    assert like_new, "expected a Like New fixture listing"
    assert like_new[0].overall_condition_grade == "excellent"
    assert like_new[0].negotiation_evidence["defect_count"] == 0
