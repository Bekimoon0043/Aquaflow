"""
API Routes - I-CAN fountain gateway discovery & connection.

Backs the operator connection panel. Discovery and status are READ-ONLY. The output
endpoint is deliberately gated (requires an armed connection + explicit confirmation)
and is NOT reachable with arbitrary user-supplied frames. The captured output sequence
has driven the real site fountain, but output stays disabled by default.
"""
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from typing import Optional

from engine import ican_discovery as disco
from engine.ican_connection import ICANConnection, ICANConfig
from engine.ican_manual_patterns import (
    ICANManualPatternRunner,
    MANUAL_RUN_CONFIRMATION,
    ManualPatternError,
    ManualPatternStore,
    SITE_FOUNTAIN_LAYOUT,
)
from engine.ican_mapping import ChannelMap
from engine.ican_site_demo import ICANSiteDemo, SiteDemoStartError
from engine.ican_site_choreography import STYLES, generate_site_pattern
from engine.ican_legacy_importer import LegacyImportError, import_legacy_programs

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
_site_demo: Optional[ICANSiteDemo] = None
_manual_pattern_runner: Optional[ICANManualPatternRunner] = None
_manual_pattern_store: Optional[ManualPatternStore] = None


def _manager() -> ICANConnection:
    global _conn
    if _conn is None:
        _conn = ICANConnection(ICANConfig())
    return _conn


def _demo() -> ICANSiteDemo:
    global _site_demo
    if _site_demo is None:
        _site_demo = ICANSiteDemo()
    return _site_demo


def _manual_runner() -> ICANManualPatternRunner:
    global _manual_pattern_runner
    if _manual_pattern_runner is None:
        _manual_pattern_runner = ICANManualPatternRunner()
    return _manual_pattern_runner


def _manual_store() -> ManualPatternStore:
    global _manual_pattern_store
    if _manual_pattern_store is None:
        _manual_pattern_store = ManualPatternStore()
    return _manual_pattern_store


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
    await _demo().stop("reconnected")
    await _manual_runner().stop("reconnected")
    m = _manager()
    m.cfg.gateway_ip = req.gateway_ip
    m.cfg.gateway_port = req.gateway_port
    m.cfg.local_port = req.local_port
    ok = await m.connect()
    if not ok:
        # Only a local failure lands here now (no IP, socket refused to open). A gateway
        # that simply does not answer the read-only poll connects UNVERIFIED — I-CAN
        # control is fire-and-forget and does not need a reply. `verified` in the
        # returned status is what tells the operator which of the two they have.
        raise HTTPException(503, m.last_error or "could not open the local UDP socket")
    return m.status()


@router.post("/auto-connect")
async def auto_connect(req: DiscoverRequest):
    """Discover then connect in one call. Emits no output."""
    await _demo().stop("reconnected")
    await _manual_runner().stop("reconnected")
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
    m = _manager()
    await _demo().stop("disconnected")
    await _manual_runner().stop("disconnected")
    await m.blackout()
    await m.close()
    return m.status()


@router.post("/auto-reconnect")
async def auto_reconnect(req: ReconnectToggle):
    _manager().set_auto_reconnect(req.enabled)
    return _manager().status()


@router.get("/audit")
async def audit():
    """The output-command audit trail, for support/diagnostics export."""
    return {"entries": _manager().audit_log}


# ── Hardware-proven one-minute site choreography ─────────────────────────────
@router.get("/demo/status")
async def site_demo_status():
    return _demo().status()


@router.post("/demo/start")
async def start_site_demo():
    """Start the one-minute choreography captured from the original site software."""
    try:
        await _manual_runner().stop("replaced")
        return await _demo().start(_manager())
    except SiteDemoStartError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/demo/stop")
async def stop_site_demo():
    """Stop the captured choreography immediately and hold every driven group off."""
    state = await _demo().stop("stopped")
    await _manager().blackout()
    return state


async def shutdown_ican():
    """Application shutdown hook: stop the site demo, blackout, then release UDP 2002."""
    await _demo().stop("shutdown")
    await _manual_runner().stop("shutdown")
    if _conn is not None:
        await _conn.blackout()
        await _conn.close()


# ── Operator-authored site patterns ──────────────────────────────────────────
class ManualPatternSaveRequest(BaseModel):
    id: str = ""
    name: str
    description: str = ""
    layout_id: str = "curved-six-pump-fountain-v1"
    steps: list[dict]
    created_at: float = 0.0
    provenance: Optional[dict] = None
    music: Optional[dict] = None
    safety: Optional[dict] = None


class ManualPatternRunRequest(BaseModel):
    pattern: dict
    repeat: int = 1
    confirm: str = ""


class SiteGenerateRequest(BaseModel):
    prompt: str = "Create a flowing wave"
    duration_s: float = 60.0
    bpm: float = 120.0
    style: Optional[str] = None
    include_proven_support: bool = True
    save: bool = False


class SiteAudioGenerateRequest(BaseModel):
    job_id: str
    prompt: str = "Create a fountain dance that follows this music"
    style: Optional[str] = None
    bpm_override: Optional[float] = None
    include_proven_support: bool = True
    save: bool = False


@router.get("/site-layout")
async def get_site_layout():
    """Physical layout plus capture-derived, explicitly provisional address presets."""
    return SITE_FOUNTAIN_LAYOUT


@router.get("/manual-patterns")
async def list_manual_patterns():
    return {"patterns": _manual_store().list()}


@router.post("/manual-patterns")
async def save_manual_pattern(req: ManualPatternSaveRequest):
    try:
        payload = req.model_dump() if hasattr(req, "model_dump") else req.dict()
        return _manual_store().save(payload)
    except ManualPatternError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/manual-patterns/{pattern_id}")
async def delete_manual_pattern(pattern_id: str):
    if not _manual_store().delete(pattern_id):
        raise HTTPException(status_code=404, detail="manual pattern was not found")
    return {"deleted": pattern_id}


@router.get("/manual-pattern/status")
async def manual_pattern_status():
    return _manual_runner().status()


@router.post("/manual-pattern/run")
async def run_manual_pattern(req: ManualPatternRunRequest):
    if req.confirm != MANUAL_RUN_CONFIRMATION:
        raise HTTPException(
            status_code=400,
            detail=f'manual hardware playback requires confirm="{MANUAL_RUN_CONFIRMATION}"',
        )
    await _demo().stop("replaced")
    try:
        return await _manual_runner().start(_manager(), req.pattern, req.repeat)
    except ManualPatternError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/manual-pattern/stop")
async def stop_manual_pattern():
    state = await _manual_runner().stop("stopped")
    await _manager().blackout()
    return state


def _maybe_save_generated(pattern: dict, save: bool) -> dict:
    return _manual_store().save(pattern) if save else pattern


@router.get("/choreography/capabilities")
async def choreography_capabilities():
    return {
        "styles": list(STYLES),
        "designable_outputs": "legacy valve positions 1-64",
        "protected": {
            "groups": [2, 25],
            "group_17": "all-off or exact hardware-proven support state",
            "legacy": "pumps, frequency, lights, fire and valve outputs 65-76 omitted",
        },
        "legacy_program_count": 6,
    }


@router.post("/choreography/generate")
async def generate_choreography(req: SiteGenerateRequest):
    try:
        pattern = generate_site_pattern(
            prompt=req.prompt, duration_s=req.duration_s, bpm=req.bpm,
            style=req.style, include_proven_support=req.include_proven_support)
        return {"pattern": _maybe_save_generated(pattern, req.save)}
    except (ManualPatternError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/choreography/from-audio")
async def generate_choreography_from_audio(req: SiteAudioGenerateRequest):
    from api.routes import audio as audio_routes
    job = audio_routes._jobs.get(req.job_id)
    if not job or job.get("status") != "complete" or not job.get("result"):
        raise HTTPException(status_code=400, detail="audio analysis is not complete")
    try:
        analysis = dict(job["result"])
        if req.bpm_override:
            analysis["bpm"] = req.bpm_override
            analysis["analysis_method"] = (
                f"{analysis.get('analysis_method', 'audio')} + operator BPM override")
        pattern = generate_site_pattern(
            prompt=req.prompt, style=req.style, analysis=analysis,
            include_proven_support=req.include_proven_support)
        return {"pattern": _maybe_save_generated(pattern, req.save), "analysis": job["result"]}
    except (ManualPatternError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _save_imported(result: dict) -> dict:
    saved = [_manual_store().save(pattern) for pattern in result["patterns"]]
    return {**result, "patterns": saved, "saved": len(saved)}


@router.post("/legacy/import")
async def import_legacy_archive(file: UploadFile = File(...), include_proven_support: bool = True):
    """Convert an exported 4KILO analysis ZIP without launching the legacy program."""
    try:
        return _save_imported(import_legacy_programs(
            await file.read(), include_proven_support=include_proven_support))
    except LegacyImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/legacy/import-bundled")
async def import_bundled_legacy_programs(include_proven_support: bool = True):
    """Install the six recovered site programs shipped as inert CSV evidence."""
    import io
    import zipfile
    from pathlib import Path

    source = Path(__file__).resolve().parents[2] / "data" / "legacy_4kilo"
    buffer = io.BytesIO()
    try:
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in ("schemes.csv", "scheme_audio_sections.csv", "scheme_events.csv", "music_manifest.csv"):
                archive.writestr(name, (source / name).read_bytes())
        return _save_imported(import_legacy_programs(
            buffer.getvalue(), include_proven_support=include_proven_support))
    except (OSError, LegacyImportError) as exc:
        raise HTTPException(status_code=500, detail=f"bundled legacy evidence unavailable: {exc}") from exc


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


class ImportCaptureRequest(BaseModel):
    text: str                               # contents of changes.txt or capture.jsonl
    device_type: Optional[str] = "unknown"  # applied to newly imported channels


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


@router.post("/map/import-capture")
async def import_capture(req: ImportCaptureRequest):
    """Build the channel map from a capture of the ORIGINAL fountain software.

    Every (group, channel) the real show drove is, by definition, wired to something.
    That is the one question hand-typing a channel number cannot answer, and getting it
    wrong looks exactly like a broken control path: every step green, nothing moves.
    """
    from engine.ican_capture_import import parse_capture

    detections = parse_capture(req.text)
    if not detections:
        raise HTTPException(
            400,
            "no I-CAN frames found in that file — expected changes.txt or capture.jsonl "
            "from the capture tool")

    m = _map()
    added = m.import_detections(detections)
    if req.device_type and req.device_type != "unknown":
        for det in detections:
            for ch in det["channels"]:
                try:
                    m.assign(det["group"], ch, device_type=req.device_type)
                except ValueError:
                    pass
    m.save()
    return {
        "imported": added,
        "groups": [d["group"] for d in detections],
        "channels_seen": sum(len(d["channels"]) for d in detections),
        "devices": m.to_device_registry(),
    }


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


class ChannelDrive(BaseModel):
    device_id: str
    on: bool


@router.post("/output/channel")
async def drive_channel(req: ChannelDrive):
    """
    Drive one attached channel on or off — the operator's commissioning toggle.

    Deliberately scoped to channels already attached to the bus rather than exposing a
    general "command any device at any intensity" endpoint: this is a test control, and
    a route that can actuate arbitrary hardware over HTTP is a far larger surface than
    the task needs. The command goes through the normal bus path, so the safety kernel
    permit, the per-fixture ceilings and the driver's arm gate all still apply — this is
    the same route a show uses, not a private bypass that could pass while playback is
    broken.
    """
    from app_state import protocol_bus

    if _site_demo is not None and _site_demo.running:
        raise HTTPException(
            status_code=409,
            detail="stop the one-minute site demo before driving individual channels",
        )
    if _manual_pattern_runner is not None and _manual_pattern_runner.running:
        raise HTTPException(
            status_code=409,
            detail="stop the manual pattern before driving individual channels",
        )
    if req.device_id not in getattr(protocol_bus, "_ican_devices", {}):
        raise HTTPException(status_code=404,
                            detail=f"{req.device_id} is not an attached I-CAN channel")

    entry = protocol_bus._ican_devices[req.device_id]
    await protocol_bus.send_batch([{
        "device_id": req.device_id,
        "type": entry.get("device_type", "pump"),
        "intensity": 1.0 if req.on else 0.0,
    }])
    group = entry["group"]
    confirmed = sorted(protocol_bus._ican_confirmed.get(group, set()))
    desired = sorted(protocol_bus._ican_state.get(group, set()))
    # The exact bytes the transport put on the wire, so an operator standing at the
    # cabinet can compare them against ican_client.py without a packet capture. When a
    # command does nothing, "which frame did you actually send" is the first question,
    # and it should not require a developer to answer it.
    last = (_manager().audit_log or [{}])[-1]
    return {
        "device_id": req.device_id,
        "requested": "on" if req.on else "off",
        "group": group,
        # What was SENT, not what was intended. If the frame was refused — output not
        # armed, safety permit withdrawn, socket error — the channel is absent here even
        # though it is present in `desired`. The caller must show this one, or it would
        # light a button for a command that never left the machine. Note this is not an
        # acknowledgement: the gateway does not ack 0x08 frames.
        "live_channels": confirmed,
        "desired_channels": desired,
        "pending": group in protocol_bus._ican_dirty,
        "frame_hex": last.get("frame_hex", ""),
        "frame_result": last.get("result", ""),
        "local_port": _manager().cfg.local_port,
    }


@router.post("/output/stop")
async def stop_output():
    """Blackout every attached channel. Never gated — stopping is always allowed."""
    from app_state import protocol_bus
    await _demo().stop("stopped")
    await _manual_runner().stop("stopped")
    await protocol_bus.blackout()
    await _manager().blackout()
    return {"stopped": True}


@router.post("/output/arm")
async def arm_output(req: ArmRequest):
    """
    Arm or disarm the physical output path.

    Arming requires an explicit confirmation phrase because this is the step that
    lets software close real relays. The 0x08 output path is proven on this fountain,
    but it must never be reachable by accident.
    Disarming is always allowed and needs no confirmation — stopping is never gated.
    """
    m = _manager()
    if req.enabled and req.confirm != "ARM OUTPUT":
        raise HTTPException(
            status_code=400,
            detail='arming requires confirm="ARM OUTPUT"',
        )
    if not req.enabled:
        await _demo().stop("disarmed")
        await _manual_runner().stop("disarmed")
    m.enable_output(bool(req.enabled))
    if not req.enabled:
        # Disarming should also drop anything currently energised, not merely stop
        # future frames.
        try:
            await m.blackout()
        except Exception:
            pass
    return {"output_armed": bool(req.enabled), "status": m.status()}
