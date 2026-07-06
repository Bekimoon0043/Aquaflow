"""
phase6_routes.py — AquaFlow Phase 6
API routes for safety kernel, runtime transport, and protocol drivers.
Mount these in main.py: app.include_router(phase6_router, prefix="/api")
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any

log = logging.getLogger("aquaflow.phase6_routes")
phase6_router = APIRouter(tags=["phase6"])


# ─── Safety routes ────────────────────────────────────────────────────────────
@phase6_router.get("/safety/status")
async def get_safety_status():
    from safety.safety_kernel import get_safety_kernel
    return get_safety_kernel().get_status()


@phase6_router.post("/safety/arm")
async def safety_arm():
    from safety.safety_kernel import get_safety_kernel
    k = get_safety_kernel()
    ok = k.arm()
    if not ok:
        raise HTTPException(400, detail=f"ARM rejected — state={k.state}, faults={k.latched_faults}")
    return {"ok": True, "state": k.state}


@phase6_router.post("/safety/disarm")
async def safety_disarm():
    from safety.safety_kernel import get_safety_kernel
    k = get_safety_kernel()
    k.disarm()
    return {"ok": True, "state": k.state}


@phase6_router.post("/safety/estop")
async def safety_estop():
    from safety.safety_kernel import get_safety_kernel
    k = get_safety_kernel()
    k.emergency_stop(source="api")
    return {"ok": True, "state": k.state}


@phase6_router.post("/safety/reset")
async def safety_reset():
    from safety.safety_kernel import get_safety_kernel
    k = get_safety_kernel()
    ok = k.reset_faults()
    return {"ok": ok, "state": k.state}


@phase6_router.post("/safety/dry-run")
async def safety_dry_run():
    from safety.safety_kernel import get_safety_kernel
    k = get_safety_kernel()
    k.enter_dry_run()
    return {"ok": True, "state": k.state}


@phase6_router.post("/safety/maintenance")
async def safety_maintenance():
    from safety.safety_kernel import get_safety_kernel
    k = get_safety_kernel()
    k.enter_maintenance()
    return {"ok": True, "state": k.state}


class SafetyInputsUpdate(BaseModel):
    water_level_ok:      Optional[bool] = None
    pressure_ok:         Optional[bool] = None
    estop_chain_closed:  Optional[bool] = None
    flame_permit:        Optional[bool] = None
    laser_permit:        Optional[bool] = None
    plc_heartbeat_ok:    Optional[bool] = None
    vfd_ok:              Optional[bool] = None
    thermal_ok:          Optional[bool] = None


@phase6_router.post("/safety/inputs")
async def update_safety_inputs(body: SafetyInputsUpdate):
    """Inject sensor values (used by PLC driver and hardware monitors)."""
    from safety.safety_kernel import get_safety_kernel
    k = get_safety_kernel()
    updates = {k2: v for k2, v in body.dict().items() if v is not None}
    k.update_inputs(**updates)
    return {"ok": True, "updated": list(updates.keys())}


# ─── Transport routes ─────────────────────────────────────────────────────────
@phase6_router.get("/transport/status")
async def get_transport_status():
    from engine.runtime_transport import get_transport
    return get_transport().get_status()


class LoadShowBody(BaseModel):
    show_id: str
    duration_ms: int


@phase6_router.post("/transport/load")
async def transport_load(body: LoadShowBody):
    from engine.runtime_transport import get_transport
    t = get_transport()
    t.load_show(body.show_id, body.duration_ms)
    return {"ok": True, "state": t._state}


@phase6_router.post("/transport/play")
async def transport_play():
    from engine.runtime_transport import get_transport
    t = get_transport()
    ok = t.play()
    if not ok:
        raise HTTPException(400, detail=f"PLAY rejected — state={t._state}, permit={t._safety_permit()}")
    return {"ok": True, "state": t._state, "position_ms": t._position_ms}


@phase6_router.post("/transport/pause")
async def transport_pause():
    from engine.runtime_transport import get_transport
    t = get_transport()
    ok = t.pause()
    return {"ok": ok, "state": t._state, "position_ms": t._position_ms}


@phase6_router.post("/transport/stop")
async def transport_stop():
    from engine.runtime_transport import get_transport
    t = get_transport()
    ok = t.stop()
    return {"ok": ok, "state": t._state}


class SeekBody(BaseModel):
    position_ms: int


@phase6_router.post("/transport/seek")
async def transport_seek(body: SeekBody):
    from engine.runtime_transport import get_transport
    t = get_transport()
    ok = t.seek(body.position_ms)
    return {"ok": ok, "position_ms": t._position_ms}


@phase6_router.post("/transport/recover")
async def transport_recover():
    from engine.runtime_transport import get_transport
    t = get_transport()
    ok = t.recover()
    return {"ok": ok, "state": t._state}


class RollbackBody(BaseModel):
    steps: int = 1


@phase6_router.post("/transport/rollback")
async def transport_rollback(body: RollbackBody):
    from engine.runtime_transport import get_transport
    t = get_transport()
    snap = t.rollback(body.steps)
    if snap is None:
        raise HTTPException(400, detail="Not enough snapshots for rollback")
    return {"ok": True, "restored": snap.to_dict()}


@phase6_router.get("/transport/snapshots")
async def get_snapshots():
    from engine.runtime_transport import get_transport
    return {"snapshots": get_transport().get_snapshots()}


# ─── Protocol status routes ───────────────────────────────────────────────────
# AF-HUB-006 — these routes previously did `from app_state import app_state` and read
# `artnet_driver`/`sacn_driver` off it. There is no `app_state` object and those driver
# attributes never existed, so every call raised ImportError (swallowed → "error"/500).
# They now talk to the ONE shared protocol bus (app_state.protocol_bus), which owns the
# Art-Net driver and exposes get_status()/blackout().
@phase6_router.get("/protocols/artnet/status")
async def artnet_status():
    try:
        from app_state import protocol_bus
        status = protocol_bus.get_status()
        drivers = status.get("drivers", {})
        artnet = drivers.get("artnet") or drivers.get("dmx")
        if artnet is None:
            return {"running": False, "note": "Art-Net driver not initialised"}
        return {"running": status.get("running", False), "driver": artnet,
                "dmx_map_count": status.get("dmx_map_count", 0)}
    except Exception as e:
        return {"error": str(e)}


@phase6_router.get("/protocols/sacn/status")
async def sacn_status():
    try:
        from app_state import protocol_bus
        drivers = protocol_bus.get_status().get("drivers", {})
        sacn = drivers.get("sacn")
        if sacn is None:
            return {"running": False, "note": "sACN driver not initialised"}
        return {"running": True, "driver": sacn}
    except Exception as e:
        return {"error": str(e)}


@phase6_router.post("/protocols/artnet/blackout")
async def artnet_blackout():
    try:
        from app_state import protocol_bus
        await protocol_bus.blackout()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@phase6_router.post("/protocols/sacn/blackout")
async def sacn_blackout():
    try:
        from app_state import protocol_bus
        await protocol_bus.blackout()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, detail=str(e))
