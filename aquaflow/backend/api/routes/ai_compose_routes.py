"""
ai_compose_routes.py — words → patterns (Show Studio's AI tab).

  POST /api/ai/compose  { description, groups: [ids], looks: [ids], duration }
                        → { summary, placements: [{ groupId, look, start, end, color, low, high, why }], model }
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services import ai_compose

router = APIRouter()


class ComposeRequest(BaseModel):
    description: str = Field(min_length=20, max_length=40000)
    groups: list[str] = Field(min_length=1, max_length=200)
    looks: list[str] = Field(min_length=1, max_length=100)
    duration: float = Field(gt=0, le=600)


@router.post("/compose")
def compose(req: ComposeRequest):
    try:
        return ai_compose.compose(req.description, req.groups, req.looks, req.duration)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
