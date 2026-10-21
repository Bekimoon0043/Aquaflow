"""
ai_advice_routes.py — optional AI advice (uses the Anthropic key saved for the AI director).

  POST /api/ai/design-review      { description, areas: [ids], ids: [ids] }
        → { summary, findings: [{ severity, areas, ids, title, detail, recommendation, estimatedImpact }], model }
  POST /api/ai/commissioning-help { preflight: [..], plc: {..}|null, faults: [..], logs: [..], site }
        → { summary, steps: [{ title, detail, check, relatedIds }], safety: [..], model }

Advice only: neither route changes the design or touches equipment. AI errors are HTTP 502
with a readable message.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services import ai_commissioning, ai_design_advisor

router = APIRouter()


class DesignReviewRequest(BaseModel):
    description: str = Field(min_length=20, max_length=40000)
    areas: list[str] = Field(default_factory=list, max_length=300)
    ids: list[str] = Field(default_factory=list, max_length=5000)


class CommissioningRequest(BaseModel):
    preflight: list[dict[str, Any]] = Field(default_factory=list, max_length=1000)
    plc: Optional[dict[str, Any]] = None
    faults: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    logs: list[str] = Field(default_factory=list, max_length=1000)
    site: str = Field(default="", max_length=8000)


@router.post("/design-review")
def design_review(req: DesignReviewRequest):
    try:
        return ai_design_advisor.review(req.description, req.areas, req.ids)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/commissioning-help")
def commissioning_help(req: CommissioningRequest):
    if not (req.preflight or req.plc or req.faults or req.logs):
        raise HTTPException(400, "Nothing to explain yet: run preflight or connect the PLC first")
    try:
        return ai_commissioning.explain(req.preflight, req.plc, req.faults, req.logs, req.site)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
