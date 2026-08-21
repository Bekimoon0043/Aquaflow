"""
hydraulics_routes.py — AquaFlow Stage 2, Priority 1 (AQ-S2-001)

API surface for the hydraulic network solver: solve a pipe network for the flow
in every pipe and the head/pressure at every node (branched, looped, or
closed-loop recirculating).
"""
from fastapi import APIRouter, HTTPException

from services.hydraulic_solver import solve_network
from services.pipe_sizing import size_pipes, size_network
from services.geometry_service import get_geometry_service

router = APIRouter()


@router.post("/preview-physics")
async def preview_physics(payload: dict):
    """
    Solve a DESIGN (a list of placed nozzles) and return per-nozzle physics for the
    3D preview — AQ-S2-002 Phase 2.

    The preview needs exit velocity and jet height per nozzle, not a raw network
    solution, so this wraps the geometry->network->solve path the designer already
    uses. Nozzles carrying a design pressure are solved as pressure-dependent
    emitters; those without one stay fixed-demand and are OMITTED from
    nozzle_physics rather than given a fabricated velocity.

    Request body:
        { "nozzles": [ {id, x, y, engineering:{design_flow_lps, design_pressure_m,
                                               elevation_m?, discharge_coeff?}} ],
          "params":  { "design_head_m": 40.0 },
          "volume_litres": 50000 }

    Response:
        { "nozzle_physics": { "<nozzle id>": {exitVelocityMs, jetHeightM, flowLpm,
                                              basis} },
          "validation": [ ...engineering findings... ],
          "converged": bool, "total_design_flow_lpm": float }
    """
    nozzles = payload.get("nozzles") or []
    if not isinstance(nozzles, list):
        raise HTTPException(400, "'nozzles' must be a list")
    params = payload.get("params") or {}
    volume = float(payload.get("volume_litres") or 0.0)
    try:
        res = get_geometry_service()._solve_pool_hydraulics(nozzles, params, volume)
    except Exception as exc:
        raise HTTPException(500, f"hydraulic solve failed: {exc}")
    return {
        "converged": res.get("converged"),
        "nozzle_physics": res.get("nozzle_physics", {}),
        "validation": res.get("validation", []),
        "total_design_flow_lpm": res.get("total_design_flow_lpm"),
        "turnover_time_hours": res.get("turnover_time_hours"),
    }


@router.post("/solve")
async def solve_hydraulic_network(payload: dict):
    """
    Solve a hydraulic network.

    Request body:
        {
          "nodes": [
            {"id": "R", "fixed_head": 50.0, "elevation": 0.0},
            {"id": "J", "demand": 0.01, "elevation": 0.0}
          ],
          "pipes": [
            {"id": "P1", "from": "R", "to": "J",
             "length": 100, "diameter": 0.1, "roughness": 130, "minor_loss": 0}
          ],
          "method": "hazen-williams"   # or "darcy"
        }

    Returns per-node head/pressure, per-pipe flow/velocity/head loss, the network
    topology classification, and the conservation residuals.
    """
    try:
        return solve_network(payload)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    except Exception as e:  # pragma: no cover - defensive
        raise HTTPException(500, detail=str(e))


@router.post("/size")
async def size_pipe_list(payload: dict):
    """
    Size / audit a list of pipes whose flows are already known (AQ-S2-003).

    Request body:
        {
          "pipes": [{"id": "P1", "flow_m3s": 0.03, "diameter": 0.1}, ...],
          "velocity_limits": {"v_min": 0.6, "v_max": 2.5, "v_target": 1.5}
        }

    Returns each pipe's velocity, an OK/undersized/oversized status, and a
    suggested standard diameter.
    """
    try:
        return size_pipes(payload)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    except Exception as e:  # pragma: no cover - defensive
        raise HTTPException(500, detail=str(e))


@router.post("/size-network")
async def size_hydraulic_network(payload: dict):
    """
    Solve a hydraulic network for its flows and size every pipe against them
    (AQ-S2-001 + AQ-S2-003). Body is a hydraulic-solver network plus optional
    "velocity_limits".
    """
    try:
        return size_network(payload)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    except Exception as e:  # pragma: no cover - defensive
        raise HTTPException(500, detail=str(e))
