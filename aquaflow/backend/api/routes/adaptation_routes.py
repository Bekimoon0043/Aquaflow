"""
adaptation_routes.py — AquaFlow Stage 5, AQ-S5-003

Autonomous Show Adaptation API. Given live context (weather, crowd, event) it returns
the adaptation plan that re-scales the running show, respecting safety.

  POST /api/adaptation/plan  → adaptation plan for {weather, crowd, event}
"""
from fastapi import APIRouter

from services.show_adaptation import adapt

router = APIRouter()


@router.post("/plan")
async def plan(payload: dict):
    """Compute the autonomous adaptation plan for the current context."""
    return adapt(payload or {})
