"""
cad_exchange_routes.py — AquaFlow AF-CAD-003 / 015 / 019 / 020

CAD exchange API (mounted at /api/cad, beside cad_routes):

  POST /api/cad/export.dxf      → ezdxf DXF (AC1027) of an engineering project design
  POST /api/cad/topology        → pipe network + pump/valve/nozzle groups + solver_input
  POST /api/cad/import/aqf-json → ingest AQFEXPORT JSON from the AutoCAD LISP tool

Shapes are defined in docs/CAD-IMPORT-CONTRACT.md.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from services.cad_export import export_dxf
from services.cad_lisp_import import import_aqf_json
from services.cad_topology import infer_topology, solve_topology, DEFAULT_TOLERANCE_M

router = APIRouter()


def _safe_name(design: dict) -> str:
    name = str(design.get("name") or design.get("projectName") or "fountain_layout")
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name) or "fountain_layout"


@router.post("/export.dxf")
async def export_design_dxf(payload: dict, dimensions: bool = True):
    """Return the design as an AC1027 DXF (blocks, attributes, AQUAFLOW XDATA, +Y up).

    Body: the engineering project (or ``{"design": {...}}``).
    """
    design = payload.get("design") if isinstance(payload.get("design"), dict) else payload
    try:
        text = export_dxf(design or {}, dimensions=dimensions)
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(400, f"invalid design: {exc}")
    return Response(
        content=text.encode("utf-8"), media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{_safe_name(design or {})}.dxf"'})


@router.post("/topology")
async def topology(payload: dict):
    """Infer the pipe network from recognised pipes + candidates.

    Body: ``{"pipes": [...], "candidates": [...], "tolerance_m": 0.05,
    "pump_head_m": null, "solve": false}``. With ``solve: true`` the response also
    carries ``solution`` — the hydraulic solver's result for ``solver_input``.
    """
    pipes = payload.get("pipes") or []
    candidates = payload.get("candidates") or []
    if not isinstance(pipes, list) or not isinstance(candidates, list):
        raise HTTPException(400, "pipes and candidates must be lists")
    try:
        result = infer_topology(pipes, candidates,
                                payload.get("tolerance_m", DEFAULT_TOLERANCE_M),
                                pump_head_m=payload.get("pump_head_m"))
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(400, f"invalid topology input: {exc}")
    if payload.get("solve"):
        try:
            result["solution"] = solve_topology(result)
        except (ValueError, ArithmeticError) as exc:
            result["solution"] = None
            result["warnings"].append(f"Hydraulic solve failed: {exc}")
    return result


@router.post("/import/aqf-json")
async def import_aqf(payload: dict, units: Optional[str] = None):
    """Ingest the JSON written by AQFEXPORT (tools/autocad/aquaflow_export.lsp).

    Body: the AQFEXPORT document itself, or ``{"data": <document>, "filename": "..."}``.
    """
    data = payload.get("data") if "data" in payload and "inserts" not in payload else payload
    try:
        return import_aqf_json(data, units=units, filename=payload.get("filename"))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
