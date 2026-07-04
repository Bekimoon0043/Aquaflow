"""
valve_routes.py — AquaFlow Recovery, AQ-X-007

Valve authority engine API.

  POST /api/valves/authority          → authority + flow-control recommendation from
                                        {kv|dp_valve_bar, dp_rest_bar, flow_m3h, sg}
  POST /api/valves/authority-network  → authority derived from a solved hydraulic
                                        network {network, valve_pipe_id}
"""
from fastapi import APIRouter, HTTPException

from services.valve_authority import analyze, authority_from_network

router = APIRouter()


@router.post("/authority")
async def valve_authority(payload: dict):
    """Compute valve authority + recommendations from pressure drops or a Kv."""
    try:
        return analyze(payload)
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, f"invalid valve request: {exc}")


@router.post("/authority-network")
async def valve_authority_network(payload: dict):
    """Derive authority by running a hydraulic network with the valve as a minor loss."""
    network = payload.get("network")
    valve_pipe_id = payload.get("valve_pipe_id")
    if not network or not valve_pipe_id:
        raise HTTPException(400, "'network' and 'valve_pipe_id' are required")
    try:
        return authority_from_network(network, valve_pipe_id, sg=float(payload.get("sg", 1.0)))
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, f"invalid network request: {exc}")
