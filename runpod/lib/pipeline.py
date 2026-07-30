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
        comparables=comparables if comparables is not None else [],
        negotiation_evidence=negotiation_evidence(listing, reports),
    )
