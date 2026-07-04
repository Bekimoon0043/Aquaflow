"""
dependency_routes.py — AquaFlow Recovery, AQ-X-008

Equipment dependency graph API.

  POST /api/dependencies/graph  → build the dependency graph (nodes/edges/conflicts)
                                  from a set of fixtures. Body: {fixtures:[...], spof_threshold?}
"""
from fastapi import APIRouter, HTTPException

from services.dependency_graph import build_dependency_graph, DEFAULT_SPOF_THRESHOLD

router = APIRouter()


@router.post("/graph")
async def graph(payload: dict):
    """Build the equipment dependency graph from designed fixtures."""
    fixtures = payload.get("fixtures", payload.get("engineeringFixtures"))
    if fixtures is None:
        raise HTTPException(400, "fixtures required")
    try:
        return build_dependency_graph(
            fixtures, spof_threshold=int(payload.get("spof_threshold", DEFAULT_SPOF_THRESHOLD)))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, f"invalid dependency request: {exc}")
