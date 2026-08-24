"""
API Routes - I-CAN fountain gateway discovery & connection.

Backs the operator connection panel. Discovery and status are READ-ONLY. The output
endpoint is deliberately gated (requires an armed connection + explicit confirmation)
and is NOT reachable with arbitrary user-supplied frames. Semantics of output frames
are capture-derived and unproven on hardware, so output stays disabled by default.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from engine import ican_discovery as disco
from engine.ican_connection import ICANConnection, ICANConfig
from engine.ican_mapping import ChannelMap

router = APIRouter()

# One persistent channel map for the app, loaded from disk on first use.
_channel_map: Optional[ChannelMap] = None


def _map() -> ChannelMap:
    global _channel_map
    if _channel_map is None:
        _channel_map = ChannelMap().load()
    return _channel_map

# One process-wide manager for the connection panel. dry_run defaults False; the
# manager only ever transmits the SAFE probe until output is explicitly enabled.
_conn: Optional[ICANConnection] = None


def _manager() -> ICANConnection:
    global _conn
    if _conn is None:
        _conn = ICANConnection(ICANConfig())
    return _conn


class DiscoverRequest(BaseModel):
    include_virtual: bool = False
    timeout: float = 0.4
    gateway_port: int = 200
    local_port: int = 2002
    candidate_ips: Optional[list[str]] = None   # manual/retry override


class ManualConnect(BaseModel):
    gateway_ip: str
    gateway_port: int = 200
    local_port: int = 2002


class ReconnectToggle(BaseModel):
    enabled: bool


@router.post("/discover")
async def discover(req: DiscoverRequest):
    """Run read-only discovery and return structured, explainable results."""
    report = await disco.discover(
        include_virtual=req.include_virtual, timeout=req.timeout,
        gateway_port=req.gateway_port, local_port=req.local_port,
        candidate_ips=req.candidate_ips,
    )
    return report.to_dict()


@router.get("/status")
async def status():
    return _manager().status()


@router.post("/connect")
async def connect(req: ManualConnect):
    """Manual override: connect to an explicit gateway IP/port (read-only verify)."""
    m = _manager()
    m.cfg.gateway_ip = req.gateway_ip
    m.cfg.gateway_port = req.gateway_port
    m.cfg.local_port = req.local_port
    ok = await m.connect()
    if not ok:
        raise HTTPException(503, m.last_error or "gateway did not answer probe")
    return m.status()


@router.post("/auto-connect")
async def auto_connect(req: DiscoverRequest):
    """Discover then connect in one call. Emits no output."""
    m = _manager()
    m.cfg.gateway_port = req.gateway_port
    m.cfg.local_port = req.local_port
    ok = await m.discover_and_connect(
        include_virtual=req.include_virtual, timeout=req.timeout,
        candidate_ips=req.candidate_ips)
    if not ok:
        raise HTTPException(503, m.last_error or "no I-CAN gateway found")
    return m.status()


@router.post("/probe")
async def probe():
    """Read-only liveness probe against the connected gateway."""
    ok = await _manager().probe()
    return {"ok": ok, "status": _manager().status()}


@router.post("/disconnect")
async def disconnect():
    await _manager().close()
    return _manager().status()


@router.post("/auto-reconnect")
async def auto_reconnect(req: ReconnectToggle):
    _manager().set_auto_reconnect(req.enabled)
    return _manager().status()


@router.get("/audit")
async def audit():
    """The output-command audit trail, for support/diagnostics export."""
    return {"entries": _manager().audit_log}


# ── channel mapping (pure data; the method to label each channel) ────────────
class AssignRequest(BaseModel):
    group: int
    channel: int
    label: Optional[str] = None
    device_type: Optional[str] = None      # lighting|jet|pump|valve|flame|fog|...
    safety_max: Optional[float] = None
    notes: Optional[str] = None


class ImportRequest(BaseModel):
    detections: list[dict]                  # [{"group": int, "channels": [int,...]}]


@router.get("/map")
async def get_map():
    return _map().to_dict()


@router.post("/map/assign")
async def assign(req: AssignRequest):
    try:
        a = _map().assign(req.group, req.channel, label=req.label,
                          device_type=req.device_type, safety_max=req.safety_max,
                          notes=req.notes)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _map().save()
    return a.to_dict()


@router.post("/map/import")
async def import_detections(req: ImportRequest):
    """Seed the map from a decoded capture's detected channels."""
    added = _map().import_detections(req.detections)
    _map().save()
    return {"added": added, "summary": _map().summary()}


@router.get("/map/registry")
async def map_registry():
    """The labelled channels as AquaFlow device-registry entries."""
    return {"devices": _map().to_device_registry()}


# ── AF-ICAN-003 — join the gateway to the runtime output path ────────────────
# Discovery and mapping alone never let a show reach the cabinet: the bus had no
# I-CAN route at all. These two endpoints are the operator's remaining steps, kept
# separate on purpose — attaching decides WHERE output would go, arming decides
# WHETHER it may go at all. Neither is implied by connecting.

class ArmRequest(BaseModel):
    enabled: bool
    confirm: str = ""          # must be exactly "ARM OUTPUT" to enable


@router.post("/output/attach")
async def attach_output():
    """Route this gateway's labelled channels onto the runtime protocol bus."""
    from app_state import protocol_bus

    m = _manager()
    if m.state.value != "connected":
        raise HTTPException(status_code=409,
                            detail=f"gateway not connected (state={m.state.value})")

    devices = _map().to_device_registry()
    if not devices:
        raise HTTPException(status_code=409,
                            detail="no labelled channels — assign channels before attaching")

    from engine.ican_connection import ICANDriver
    routed = protocol_bus.attach_ican(ICANDriver(m), devices)
    return {
        "attached": True,
        "channels_routed": routed,
        "devices": [d["device_id"] for d in devices],
        # Attaching does not arm. Say so explicitly so nobody reads this as "live".
        "output_armed": m.status().get("output_enabled", False),
        "note": "Attached to the output bus. Output remains DISABLED until /output/arm.",
    }


@router.post("/output/arm")
async def arm_output(req: ArmRequest):
    """
    Arm or disarm the physical output path.

    Arming requires an explicit confirmation phrase because this is the step that
    lets software close real relays. The 0x08 output semantics are capture-derived
    and unproven on hardware, so this must never be reachable by accident.
    Disarming is always allowed and needs no confirmation — stopping is never gated.
    """
    m = _manager()
    if req.enabled and req.confirm != "ARM OUTPUT":
        raise HTTPException(
            status_code=400,
            detail='arming requires confirm="ARM OUTPUT"',
        )
    m.enable_output(bool(req.enabled))
    if not req.enabled:
        # Disarming should also drop anything currently energised, not merely stop
        # future frames.
        try:
            await m.blackout()
        except Exception:
            pass
    return {"output_armed": bool(req.enabled), "status": m.status()}
