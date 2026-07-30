"""Typed, stdlib-only data model shared across endpoints, orchestrator, and tests."""
from __future__ import annotations

from dataclasses import dataclass, field, fields, is_dataclass
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
    """Recursively convert dataclasses/lists/dicts to JSON-serializable values."""
    if is_dataclass(obj) and not isinstance(obj, type):
        return {f.name: to_jsonable(getattr(obj, f.name)) for f in fields(obj)}
    if isinstance(obj, list):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    return obj
