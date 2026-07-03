"""
pid_routes.py — AquaFlow Stage 2, Priority 7 (AQ-S2-007)

API surface for the automatic P&ID generator: build a printable P&ID (ISA-5.1
symbols) from an equipment model or straight from a hydraulic network, with
revision tracking.
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from services.pid_generator import generate_pid, generate_from_network

router = APIRouter()


def _emit(gen, fmt: str):
    if fmt == "svg":
        return Response(content=gen.render_svg(), media_type="image/svg+xml")
    if fmt == "html":
        return Response(content=gen.to_printable_html(), media_type="text/html")
    return {
        "drawing_number": gen.drawing_number,
        "title": gen.title,
        "revision": gen.current_revision,
        "revisions": [vars(r) for r in gen.revisions],
        "equipment_count": len(gen.equipment),
        "svg": gen.render_svg(),
        "html": gen.to_printable_html(),
    }


@router.post("/generate")
async def generate(model: dict, format: str = Query("json", pattern="^(json|svg|html)$")):
    """
    Generate a P&ID from an equipment model.

    Body: {"title","drawing_number","equipment":[...],"lines":[...],
           "instruments":[...],"revisions":[...]}
    ?format=svg or html returns the raw drawing; default returns JSON with both.
    """
    try:
        return _emit(generate_pid(model), format)
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.post("/from-network")
async def from_network(network: dict, format: str = Query("json", pattern="^(json|svg|html)$")):
    """Auto-generate a P&ID directly from a hydraulic-solver network (AQ-S2-001)."""
    try:
        return _emit(generate_from_network(network), format)
    except Exception as e:
        raise HTTPException(400, detail=str(e))
