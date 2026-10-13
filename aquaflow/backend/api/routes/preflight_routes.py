"""AF-NEXT-009 - POST /api/preflight: run the preflight compiler gate on a show.

Read-only: it resolves the show and returns every Diagnostic. It never connects to,
arms, starts or writes any controller.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.preflight import run_preflight, siemens_target

router = APIRouter()


class PreflightTarget(BaseModel):
    kind: str = Field("preview", max_length=32)   # preview | siemens | dmx | artnet | ican | modbus | runtime
    site_id: str = ""                             # Siemens site for kind == "siemens"
    translate: bool = False                       # Show Programmer design clips -> Siemens channel clips
    mapped: list[str] | None = None               # optional ids with a known controller address


class PreflightRequest(BaseModel):
    project: dict = {}
    target: PreflightTarget = PreflightTarget()


@router.post("")
async def preflight(request: PreflightRequest):
    project = dict(request.project or {})
    target = {"kind": request.target.kind.lower()}
    if request.target.mapped is not None:
        target["mapped"] = request.target.mapped
    translation = None
    if target["kind"] == "siemens":
        if not request.target.site_id:
            raise HTTPException(400, detail="Choose a Siemens site to preflight against")
        from api.routes.siemens_sites import store
        from engine import siemens_devices
        try:
            site = store.get(request.target.site_id)
        except KeyError as exc:
            raise HTTPException(404, detail=str(exc)) from exc
        clips = [c for c in project.get("clips") or [] if isinstance(c, dict)]
        known = {c["id"] for c in site["channels"]}
        if clips and (request.target.translate or any(c.get("fixtureId") not in known for c in clips)):
            clips, translation = siemens_devices.translate_show(site, clips)
        project = {"clips": clips}
        target = siemens_target(site)
    result = run_preflight(project, target)
    if translation is not None:
        result["translation"] = translation
    return result
