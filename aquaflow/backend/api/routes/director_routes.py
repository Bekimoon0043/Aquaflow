"""
director_routes.py — optional AI director (Phase 5).

  GET  /api/director/status  → { sdk, configured, model }   (never returns the key)
  POST /api/director/key     { key }  — save an Anthropic API key on this machine
  POST /api/director/plan    { description, areas: [ids], looks: [ids], sections: n } → plan
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services import show_director

router = APIRouter()


class KeyRequest(BaseModel):
    key: str = Field(min_length=10, max_length=400)


class PlanRequest(BaseModel):
    description: str = Field(min_length=20, max_length=40000)
    areas: list[str] = Field(min_length=1, max_length=200)
    looks: list[str] = Field(min_length=1, max_length=100)
    sections: int = Field(ge=1, le=64)


@router.get("/status")
def status():
    return {"sdk": show_director.sdk_available(), "configured": show_director.credentials_configured(), "model": show_director.MODEL}


@router.post("/key")
def set_key(req: KeyRequest):
    show_director.save_key(req.key)
    return {"configured": True}


@router.post("/plan")
def plan(req: PlanRequest):
    try:
        return show_director.direct(req.description, req.areas, req.looks, req.sections)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
