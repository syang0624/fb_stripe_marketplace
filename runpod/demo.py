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
    # naive keyword stub: skip negated mentions like "no scratches"
    if "scratch" in desc and "no scratch" not in desc:
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
