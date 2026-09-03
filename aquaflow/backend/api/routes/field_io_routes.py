"""
API Routes — Field I/O (AF-IO-007)
The input-side inventory and its live quality-tagged readings: what the Field I/O
panel reads, and where the operator declares/edits points. Edits persist to
data/field_points.json and hot-reload the poll loop.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


def _manager():
    from app_state import field_io_manager
    return field_io_manager


class FieldPointUpsert(BaseModel):
    id: str
    source: str
    address: str
    kind: str = "AI"
    raw_type: str = "uint16"
    scale: float = 1.0
    offset: float = 0.0
    unit: str = ""
    deadband: float = 0.0
    signal: str = ""
    raw_min: int = 0
    raw_max: int = 27648
    required: bool = False
    binds_to: str = ""
    invert: bool = False
    label: str = ""
    notes: str = ""


@router.get("/status")
async def field_io_status():
    """Aggregate status incl. per-source transport truth (last raw frames)."""
    return _manager().get_status()


@router.get("/points")
async def field_io_points():
    """Every declared point with its live reading, quality and age — plus the
    source detail the panel shows beside the table."""
    mgr = _manager()
    return {
        "points": mgr.points_payload(),
        "sources": mgr.get_status()["sources_detail"],
        "heartbeat_alive": mgr.heartbeat_alive(),
    }


@router.post("/points")
async def upsert_field_point(body: FieldPointUpsert):
    """Create or replace one point. Validation happens at the form (FieldPoint
    rejects malformed definitions), persists, and hot-reloads the poll loop."""
    mgr = _manager()
    try:
        point = mgr.store.upsert(**body.dict())
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    mgr.store.save()
    await mgr.reload()
    return {"ok": True, "point": point.to_dict()}


@router.delete("/points/{point_id}")
async def delete_field_point(point_id: str):
    mgr = _manager()
    if not mgr.store.remove(point_id):
        raise HTTPException(404, f"field point {point_id!r} not found")
    mgr.store.save()
    await mgr.reload()
    return {"ok": True, "removed": point_id}
