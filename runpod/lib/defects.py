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
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
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
        confidence = max(0.0, min(1.0, confidence))
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
        condition_grade=str(obj.get("condition_grade") or "unknown"),
        negotiation_summary=str(obj.get("negotiation_summary", "")),
        error=None,
    )
