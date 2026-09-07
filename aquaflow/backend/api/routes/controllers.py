"""
API Routes — Controller catalog + auto-detection (AF-CAT-001 / AF-DISC)

GET  /api/controllers/catalog            — every known fountain controller/PLC, with
                                           drivability tier and pre-fill config
GET  /api/controllers/catalog/{id}       — one entry (the manual-add prefill)
GET  /api/controllers/adapters           — real IPv4 adapters + masks + the subnets a
                                           default scan would sweep
POST /api/controllers/discover           — synchronous read-only sweep + identification
POST /api/controllers/discover/start     — same, as a background job (progress + cancel)
GET  /api/controllers/discover/jobs      — recent jobs
GET  /api/controllers/discover/jobs/{id} — job status + result when done
POST /api/controllers/discover/jobs/{id}/cancel

Discovery is READ-ONLY by construction: protocol handshakes and standard
identification requests only — never a write, never an output frame (the
AF-ICAN-005 lesson, kept). The specialised /api/ican/* routes and the Fountain
Control panel are untouched by anything here.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from engine.controller_catalog import catalog_dict, get_entry
from engine.controller_identify import discover_controllers, DEFAULT_MAX_SECONDS
from engine.discovery_jobs import JobAlreadyRunning, registry, set_progress
from engine.net_adapters import ScanRangeError, list_adapters, resolve_scan_targets

router = APIRouter()


class DiscoverRequest(BaseModel):
    subnet: Optional[str] = None          # explicit CIDR → ONLY that range is swept
    adapter: Optional[str] = None         # explicit adapter name → its real subnet only
    include_ican: bool = True
    include_virtual: bool = False
    unit_ids: list[int] = Field(default_factory=lambda: [1])   # Modbus unit ids to try
    max_seconds: float = DEFAULT_MAX_SECONDS


@router.get("/catalog")
async def controller_catalog():
    return catalog_dict()


@router.get("/catalog/{entry_id}")
async def controller_entry(entry_id: str):
    entry = get_entry(entry_id)
    if entry is None:
        raise HTTPException(404, f"unknown catalog entry {entry_id!r}")
    return entry.to_dict()


@router.get("/adapters")
async def adapters(include_virtual: bool = False):
    """Real adapters with their real masks, and what an unqualified scan sweeps."""
    ads = list_adapters()
    try:
        targets = resolve_scan_targets(ads, include_virtual=include_virtual)
    except ScanRangeError:
        targets = []
    return {"adapters": [a.to_dict() for a in ads],
            "default_targets": [t.to_dict() for t in targets]}


def _kwargs(req: DiscoverRequest) -> dict:
    ids = [int(u) for u in (req.unit_ids or [1]) if 0 <= int(u) <= 247][:8] or [1]
    return dict(subnet=req.subnet or None, adapter=req.adapter or None,
                include_ican=req.include_ican, include_virtual=req.include_virtual,
                unit_ids=tuple(ids), max_seconds=max(5.0, min(600.0, float(req.max_seconds))))


@router.post("/discover")
async def discover(req: DiscoverRequest):
    """Sweep + identify, synchronously. READ-ONLY."""
    try:
        return await discover_controllers(**_kwargs(req))
    except ScanRangeError as e:
        raise HTTPException(400, str(e))


@router.post("/discover/start")
async def discover_start(req: DiscoverRequest):
    """Start the sweep as a background job. Returns 409 while one is running."""
    kwargs = _kwargs(req)
    # Validate the range up front so a bad CIDR is a 400 now, not a failed job later.
    try:
        resolve_scan_targets(list_adapters(), adapter_name=kwargs["adapter"],
                             cidr=kwargs["subnet"], include_virtual=kwargs["include_virtual"])
    except ScanRangeError as e:
        raise HTTPException(400, str(e))

    async def runner(job):
        return await discover_controllers(cancel=job.cancel, progress=set_progress(job), **kwargs)

    try:
        job = registry.start(runner, req.model_dump())
    except JobAlreadyRunning as e:
        raise HTTPException(409, {"detail": "a discovery is already running", "job_id": e.job_id})
    return job.to_dict(include_result=False)


@router.get("/discover/jobs")
async def discover_jobs():
    return {"jobs": registry.list()}


@router.get("/discover/jobs/{job_id}")
async def discover_job(job_id: str):
    job = registry.get(job_id)
    if job is None:
        raise HTTPException(404, f"unknown discovery job {job_id!r}")
    return job.to_dict(include_result=job.status != "running")


@router.post("/discover/jobs/{job_id}/cancel")
async def discover_cancel(job_id: str):
    job = registry.cancel(job_id)
    if job is None:
        raise HTTPException(404, f"unknown discovery job {job_id!r}")
    return job.to_dict(include_result=False)
