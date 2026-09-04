"""
API Routes — Controller catalog + auto-detection (AF-CAT-001)

GET  /api/controllers/catalog       — every known fountain controller/PLC, with
                                      drivability tier and pre-fill config
GET  /api/controllers/catalog/{id}  — one entry (the manual-add prefill)
POST /api/controllers/discover      — read-only network sweep + identification;
                                      body {"subnet": "192.168.5.0/24"} optional
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from engine.controller_catalog import catalog_dict, get_entry
from engine.controller_identify import discover_controllers

router = APIRouter()


class DiscoverRequest(BaseModel):
    subnet: Optional[str] = None      # default: every local /24
    include_ican: bool = True


@router.get("/catalog")
async def controller_catalog():
    return catalog_dict()


@router.get("/catalog/{entry_id}")
async def controller_entry(entry_id: str):
    entry = get_entry(entry_id)
    if entry is None:
        raise HTTPException(404, f"unknown catalog entry {entry_id!r}")
    return entry.to_dict()


@router.post("/discover")
async def discover(req: DiscoverRequest):
    """Sweep + identify. READ-ONLY by construction: protocol handshakes and
    standard identification requests only — never a write, never an output
    frame (the AF-ICAN-005 lesson, kept)."""
    return await discover_controllers(req.subnet, include_ican=req.include_ican)
