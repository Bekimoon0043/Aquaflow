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

router = APIRouter()

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
