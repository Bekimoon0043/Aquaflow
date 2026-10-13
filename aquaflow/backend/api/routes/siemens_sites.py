"""Isolated Siemens site API. GETs and Verify never send actuator commands."""
from pathlib import Path
import asyncio
import os

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from engine.siemens_site import (
    SiteStore, create_site, create_tia_plcsim_test, create_tia_plcsim_large_io_test,
    bench_clips, create_1212c_starter,
)
from engine.siemens_runtime import SiemensRuntime
from services.siemens_tia_package import build_tia_package
from services.siemens_openness import SiemensEngineeringService
from services.siemens_readiness import commissioning_readiness
from services.siemens_acceptance import AcceptanceRunner, AcceptanceStore
from engine import siemens_devices as devices_model
from safety.safety_kernel import get_safety_kernel
from services.preflight import run_preflight, siemens_target

router = APIRouter()
store = SiteStore(Path(os.getenv("AQUAFLOW_DATA_DIR", Path.home() / ".aquaflow")) / "siemens_sites.json")
siemens_runtime = SiemensRuntime(store, permit=lambda: get_safety_kernel().get_status())
engineering = SiemensEngineeringService(store, Path(os.getenv("AQUAFLOW_DATA_DIR", Path.home() / ".aquaflow")))
acceptance = AcceptanceRunner(siemens_runtime, store, AcceptanceStore(
    Path(os.getenv("AQUAFLOW_DATA_DIR", Path.home() / ".aquaflow")) / "siemens_acceptance.json"))


class CreateSite(BaseModel):
    name: str = "New Siemens Test Site"
    pumps: int = Field(1, ge=1, le=16)
    valves: int = Field(4, ge=1, le=512)
    lights: int = Field(0, ge=0, le=32)
    mode: str = "simulated"
    ip: str = ""
    db: int = 100


class CreatePlcSimTest(BaseModel):
    name: str = Field("TIA V17 PLCSIM Test - 20s", min_length=1, max_length=120)
    tia_version: int = Field(17, ge=17, le=21)


class CompileRequest(BaseModel):
    revision: int
    clips: list[dict]
    # True: clips come from the Show Programmer design (nozzles, pumps, lights) and are
    # translated into valve/pump commands. Unknown fixture ids also switch translation on.
    translate: bool = False


class DesignRequest(BaseModel):
    name: str = Field("Fountain", min_length=1, max_length=120)
    project_id: str = ""
    devices: list[dict]
    options: dict = {}
    hardware: dict | None = None


class SyncDesignRequest(BaseModel):
    revision: int
    devices: list[dict]
    options: dict = {}


class AssignRequest(BaseModel):
    revision: int
    hardware: dict
    options: dict = {}
    save: bool = False


class TagFileRequest(BaseModel):
    filename: str = ""
    data_base64: str


class ApplyTagsRequest(BaseModel):
    revision: int
    accepted: list[dict]


class TranslateRequest(BaseModel):
    clips: list[dict]


class ArmRequest(BaseModel):
    flow_path_confirmed: bool = False


class OutletTestRequest(ArmRequest):
    valve_id: str
    seconds: float = Field(3, ge=.5, le=5)


class DeviceTestRequest(ArmRequest):
    device_id: str
    seconds: float = Field(3, ge=.5, le=6)


class AcceptanceRequest(ArmRequest):
    device_ids: list[str] = []
    seconds: float = Field(2, ge=1, le=5)
    include_watchdog: bool = True


class ManualCommandRequest(BaseModel):
    values: dict[str, object]


class EngineeringRequest(BaseModel):
    revision: int = Field(ge=1)


class DownloadRequest(EngineeringRequest):
    confirmation: str
    cpu_stop_acknowledged: bool = False
    target_hardware_confirmed: bool = False
    memory_reinitialization_confirmed: bool = False
    password: str = Field("", max_length=256)


def failure(exc):
    # AF-NEXT-009: a refused preflight carries the full Diagnostic list (clip/fixture IDs and
    # fix targets) so the UI can list every problem, not just the first.
    issues = getattr(exc, "issues", None)
    if isinstance(issues, list):
        return HTTPException(400, detail={"message": str(exc), "issues": issues,
                                          "summary": getattr(exc, "summary", None),
                                          "resolved_revision": getattr(exc, "resolved_revision", None)})
    return HTTPException(404 if isinstance(exc, KeyError) else 400, detail=str(exc))


@router.get("")
async def list_sites():
    return {"sites": store.all()}


@router.get("/engineering/status")
async def engineering_status():
    return await asyncio.to_thread(engineering.status)


@router.post("")
async def add_site(request: CreateSite):
    try:
        return store.save(create_site(**request.model_dump()))
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/quick-test")
async def add_plcsim_test(request: CreatePlcSimTest):
    """Create a mapped, compiled, simulation-only Siemens starter site."""
    try:
        return store.save(create_tia_plcsim_test(**request.model_dump()))
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/large-io-test")
async def add_large_io_plcsim_test(request: CreatePlcSimTest):
    """Create the full integrated-I/O CPU 1215C training project and show."""
    try:
        return store.save(create_tia_plcsim_large_io_test(**request.model_dump()))
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/1212c-starter")
async def add_1212c_starter(request: CreatePlcSimTest):
    try:
        return store.save(create_1212c_starter(**request.model_dump()))
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.get("/{sid}/readiness")
async def site_readiness(sid: str):
    try:
        return commissioning_readiness(store.get(sid))
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.put("/{sid}")
async def update_site(sid: str, request: dict):
    try:
        old = store.get(sid)
        if request.get("id") != sid or request.get("revision") != old["revision"]:
            raise ValueError("Site id/revision changed; reload the saved mapping")
        # Validate before disarming or changing any persistent state.
        from engine.siemens_site import validate_site
        validate_site(request)
        await siemens_runtime.invalidate(sid)
        return store.save(request, expected_revision=request["revision"])
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.get("/{sid}/status")
async def site_status(sid: str):
    try:
        return siemens_runtime.status(sid)
    except KeyError as exc:
        raise failure(exc)


@router.get("/{sid}/runtime/diagnostics")
async def runtime_diagnostics(sid: str):
    try:
        return siemens_runtime.diagnostics(sid)
    except KeyError as exc:
        raise failure(exc)


@router.post("/{sid}/identify")
async def identify_site_plc(sid: str):
    try:
        return await siemens_runtime.identify(sid)
    except Exception as exc:
        raise failure(exc)


@router.post("/{sid}/reconnect")
async def reconnect_site(sid: str):
    try:
        return await siemens_runtime.reconnect(sid)
    except Exception as exc:
        raise failure(exc)


@router.get("/{sid}/engineering/status")
async def site_engineering_status(sid: str):
    try:
        return await asyncio.to_thread(engineering.status, sid)
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/{sid}/engineering/generate")
async def generate_tia_project(sid: str, request: EngineeringRequest):
    try:
        siemens_runtime.ensure_idle(sid)
        return await asyncio.to_thread(engineering.generate_project, sid, request.revision)
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/{sid}/engineering/compile")
async def compile_tia_project(sid: str, request: EngineeringRequest):
    try:
        siemens_runtime.ensure_idle(sid)
        return await asyncio.to_thread(engineering.compile_project, sid, request.revision)
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/{sid}/engineering/download")
async def download_tia_project(sid: str, request: DownloadRequest):
    try:
        siemens_runtime.ensure_idle(sid)
        result = await asyncio.to_thread(engineering.download, sid, request.revision, request.confirmation,
                                         request.cpu_stop_acknowledged, request.target_hardware_confirmed,
                                         request.memory_reinitialization_confirmed, request.password)
        await siemens_runtime.invalidate(sid)
        return result
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/{sid}/engineering/diagnostics")
async def tia_diagnostics(sid: str, request: EngineeringRequest):
    try:
        siemens_runtime.ensure_idle(sid)
        return await asyncio.to_thread(engineering.diagnostics, sid, request.revision)
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.get("/{sid}/tia-package")
async def export_package(sid: str):
    try:
        return Response(build_tia_package(store.get(sid)), media_type="application/zip",
                        headers={"Content-Disposition": 'attachment; filename="AquaFlow-Siemens-TIA-Package.zip"'})
    except (ValueError, KeyError) as exc:
        raise failure(exc)


@router.post("/{sid}/compile")
async def compile_site_show(sid: str, request: CompileRequest):
    try:
        siemens_runtime.ensure_idle(sid)
        clips, report = request.clips, None
        site = store.get(sid)
        known = {c["id"] for c in site["channels"]}
        if request.translate or any(c.get("fixtureId") not in known for c in clips):
            clips, report = devices_model.translate_show(site, clips)
            if not clips:
                raise ValueError(
                    f"None of the {report['input']} timeline clips are on devices of \"{site['name']}\". "
                    "Open the design this site was created from, or create a Siemens site from the open design "
                    "(Devices → PLC → Siemens Setup → New site from my design).")
        show = store.save_show(sid, clips, request.revision)
        # Warnings/info from the same preflight the compile just passed (errors would have raised).
        preflight = run_preflight({"clips": clips}, siemens_target(store.get(sid)))
        show = {**show, "preflight": {"ok": preflight["ok"], "issues": preflight["issues"],
                                      "summary": preflight["summary"],
                                      "resolved_revision": preflight["resolved_revision"]}}
        return {**show, "translation": report} if report else show
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.get("/{sid}/example")
async def example_clips(sid: str):
    try:
        return {"clips": bench_clips(store.get(sid))}
    except (ValueError, KeyError) as exc:
        raise failure(exc)


@router.post("/{sid}/verify")
async def verify_site(sid: str):
    try:
        return await siemens_runtime.verify(sid)
    except Exception as exc:
        raise failure(exc)


@router.post("/{sid}/arm")
async def arm_site(sid: str, request: ArmRequest):
    try:
        return await siemens_runtime.arm(sid, request.flow_path_confirmed)
    except Exception as exc:
        raise failure(exc)


@router.post("/{sid}/start")
async def start_site(sid: str):
    try:
        return await siemens_runtime.start(sid)
    except Exception as exc:
        raise failure(exc)


@router.post("/{sid}/stop")
async def stop_site(sid: str):
    try:
        return await siemens_runtime.stop(sid)
    except Exception as exc:
        raise failure(exc)


@router.post("/{sid}/manual/start")
async def start_manual(sid: str, request: ManualCommandRequest):
    try:
        return await siemens_runtime.start_manual(sid, request.values)
    except Exception as exc:
        raise failure(exc)


@router.post("/{sid}/test-outlet")
async def test_outlet(sid: str, request: OutletTestRequest):
    try:
        return await siemens_runtime.test_outlet(sid, request.valve_id, request.seconds, request.flow_path_confirmed)
    except Exception as exc:
        raise failure(exc)


# ── Device model: design → devices → hardware → tags ───────────────────────────

def _revision(sid, revision):
    site = store.get(sid)
    if revision != site["revision"]:
        raise ValueError("Site changed; reload before saving")
    return site


@router.get("/hardware/catalog")
async def hardware_catalog():
    return {"catalog": devices_model.HARDWARE_CATALOG, "default": devices_model.default_hardware(),
            "note": devices_model.CATALOG_NOTE}


@router.post("/from-design")
async def site_from_design(request: DesignRequest):
    try:
        site, report = devices_model.site_from_design(request.name, request.devices, project_id=request.project_id,
                                                      options=request.options, hardware=request.hardware)
        site, assignment = devices_model.assign_addresses(site, site["hardware"], request.options)
        site = store.save(devices_model.validate_site(site))
        return {"site": site, "design": report, "assignment": assignment}
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/{sid}/sync-design")
async def sync_design(sid: str, request: SyncDesignRequest):
    try:
        siemens_runtime.ensure_idle(sid)
        site = _revision(sid, request.revision)
        updated, report = devices_model.sync_from_design(site, request.devices, request.options)
        await siemens_runtime.invalidate(sid)
        return {"site": store.save(updated, expected_revision=request.revision), "design": report}
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/{sid}/assign-addresses")
async def assign_addresses(sid: str, request: AssignRequest):
    try:
        site = _revision(sid, request.revision)
        updated, report = devices_model.assign_addresses(site, request.hardware, request.options)
        updated = devices_model.validate_site(updated)
        report["program_changed"] = devices_model.signature(updated) != devices_model.signature(site)
        if request.save:
            siemens_runtime.ensure_idle(sid)
            await siemens_runtime.invalidate(sid)
            updated = store.save(updated, expected_revision=request.revision)
        return {"site": updated, "assignment": report, "points": devices_model.io_points(updated),
                "bom": devices_model.hardware_bom(updated["hardware"])}
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.get("/{sid}/io-map")
async def io_map(sid: str):
    try:
        site = store.get(sid)
        hardware = site.get("hardware")
        return {"site_id": sid, "revision": site["revision"], "hardware": hardware,
                "points": devices_model.io_points(site),
                "bom": devices_model.hardware_bom(hardware) if hardware else [],
                "safety_devices": site.get("safety_devices") or {}, "source": site.get("source"),
                "note": devices_model.CATALOG_NOTE}
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.get("/{sid}/tag-table.xlsx")
async def export_tag_table(sid: str):
    try:
        site = store.get(sid)
        safe = "".join(ch if ch.isalnum() else "-" for ch in site["name"]).strip("-") or "Site"
        return Response(devices_model.tia_tag_table_xlsx(site),
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="AquaFlow-{safe}-PLC-Tags.xlsx"'})
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/{sid}/tag-table/recognize")
async def recognize_tags(sid: str, request: TagFileRequest):
    import base64
    import binascii
    try:
        data = base64.b64decode(request.data_base64, validate=True)
        if len(data) > 10 * 1024 * 1024:
            raise ValueError("Tag table file is larger than 10 MB")
        tags = devices_model.read_tag_table(data, request.filename)
        return devices_model.suggest_mapping(store.get(sid), tags)
    except (binascii.Error, ValueError, KeyError, TypeError) as exc:
        raise failure(exc)
    except Exception as exc:  # corrupt spreadsheet
        raise HTTPException(400, detail=f"Could not read the tag table: {exc}")


@router.post("/{sid}/tag-table/apply")
async def apply_tags(sid: str, request: ApplyTagsRequest):
    try:
        siemens_runtime.ensure_idle(sid)
        site = _revision(sid, request.revision)
        updated, applied = devices_model.apply_mapping(site, request.accepted)
        await siemens_runtime.invalidate(sid)
        return {"site": store.save(updated, expected_revision=request.revision), "applied": applied}
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/{sid}/translate-preview")
async def translate_preview(sid: str, request: TranslateRequest):
    try:
        clips, report = devices_model.translate_show(store.get(sid), request.clips)
        return {"clips": clips, "translation": report}
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.post("/{sid}/test-device")
async def test_device(sid: str, request: DeviceTestRequest):
    try:
        return await siemens_runtime.test_device(sid, request.device_id, request.seconds, request.flow_path_confirmed)
    except Exception as exc:
        raise failure(exc)


@router.post("/{sid}/watchdog-test")
async def watchdog_test(sid: str, request: ArmRequest):
    try:
        return await siemens_runtime.watchdog_probe(sid, request.flow_path_confirmed)
    except Exception as exc:
        raise failure(exc)


@router.post("/{sid}/acceptance")
async def start_acceptance(sid: str, request: AcceptanceRequest):
    try:
        return acceptance.start(sid, device_ids=request.device_ids, seconds=request.seconds,
                                include_watchdog=request.include_watchdog,
                                flow_path_confirmed=request.flow_path_confirmed)
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.get("/{sid}/acceptance")
async def acceptance_status(sid: str):
    try:
        store.get(sid)
        return {**acceptance.progress(sid), "history": acceptance.records.all(sid)[-10:]}
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)


@router.get("/{sid}/plc-live")
async def plc_live(sid: str):
    """Read-only live view of the PLC data block (heartbeat, status, applied outputs)."""
    try:
        return await siemens_runtime.peek(sid)
    except (ValueError, KeyError, TypeError) as exc:
        raise failure(exc)
