"""
ai_critic_routes.py — the show critic (plan strip → ✦ AI critic).

  POST /api/ai/critique { description, sections: [ids], phrases: [{ id, groups: [ids] }], groups: [ids], looks: [ids] }
                        → { summary, findings: [{ severity, title, detail, fix: { kind, … } }], model }
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services import ai_critic

router = APIRouter()


class Phrase(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    groups: list[str] = Field(default_factory=list, max_length=200)


class CritiqueRequest(BaseModel):
    description: str = Field(min_length=20, max_length=60000)
    sections: list[str] = Field(min_length=1, max_length=64)
    phrases: list[Phrase] = Field(min_length=1, max_length=400)
    groups: list[str] = Field(min_length=1, max_length=200)
    looks: list[str] = Field(min_length=1, max_length=100)


@router.post("/critique")
def critique(req: CritiqueRequest):
    phrases = {p.id: p.groups for p in req.phrases}
    try:
        return ai_critic.critique(req.description, req.sections, phrases, req.groups, req.looks)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
