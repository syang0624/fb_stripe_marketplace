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


def test_moderate_in_reasons_minor_excluded():
    listing = Listing(url="u", title="iPhone", price=300.0)
    reps = [_rep("fair", [Defect("dent", "corner", "moderate", 0.6, ""), Defect("scratch", "back", "minor", 0.3, "")])]
    ev = negotiation_evidence(listing, reps)
    assert ev["defect_count"] == 2
    assert any("corner" in r for r in ev["reasons"])
    assert not any("back" in r for r in ev["reasons"])


def test_overall_grade_unknown_for_nonstandard_grades():
    assert overall_grade([_rep("n/a"), _rep("???")]) == "unknown"
