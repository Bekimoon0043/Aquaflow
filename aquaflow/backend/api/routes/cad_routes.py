"""
cad_routes.py — AquaFlow Recovery, AQ-X-009

CAD layout generator API — export a fountain design as a CAD-compatible DXF drawing.

  POST /api/cad/layout    → generate the DXF + metadata (JSON, dxf inline)
  POST /api/cad/layout.dxf → download the DXF file directly
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from services.cad_layout import generate_layout

router = APIRouter()


@router.post("/layout")
async def layout(payload: dict):
    """Generate the CAD layout payload (DXF text + layers + stats + DWG note)."""
    try:
        return generate_layout(payload or {})
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(400, f"invalid design: {exc}")


@router.post("/layout.dxf")
async def layout_dxf(payload: dict):
    """Return the DXF as a downloadable file."""
    try:
        result = generate_layout(payload or {})
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(400, f"invalid design: {exc}")
    return PlainTextResponse(
        result["dxf"], media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{result["filename"]}"'})
