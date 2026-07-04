"""
deploy_verifier.py — AquaFlow Recovery, AQ-X-003

Compile-and-deploy verification: proves the full deployment path works end to end.

  1. luxshow_compiler produces a VALID bundle — compile an editor show into a
     .luxshow, reopen it, and confirm it is a well-formed ZIP with every required
     member and matching checksums (via `load_luxshow`).
  2. runtime_exporter works end-to-end — export a show through the compiler bridge,
     persist the canonical/session/report/bundle artifacts, load them back, and
     confirm they are internally consistent (signature, bundle checksum, and a
     RuntimeSession that revalidates against its contract).
  3. On-site playback verified — take the COMPILED bundle, adapt it into a runtime
     show payload, and actually run it on the real ShowEngine (load → play → tick →
     stop), asserting the playhead advances and the timeline clips are emitted to
     the output path. This is the "does the deployed bundle actually run on site?"
     check the recovery task requires.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from services.luxshow_compiler import get_compiler, load_luxshow
from services.runtime_exporter import (
    persist_compiled_artifacts, load_bundle_manifest, load_bundle_artifact,
)
from contracts.runtime_contract import RuntimeSession
from engine.show_engine import ShowEngine, PlaybackState


# ── Sample deployable show (editor format the compiler consumes) ─────────────

def sample_editor_show() -> dict:
    """A minimal editor show with a pump clip at t=0, in the compiler's ms format."""
    return {
        "name": "Deploy Verification Show",
        "bpm": 120,
        "tracks": [
            {
                "id": "track-pump", "type": "pump", "deviceId": "pump-1",
                "clips": [{"id": "clip-1", "start": 0, "duration": 3000, "intensity": 80}],
            }
        ],
    }


def sample_device_list() -> list:
    return [{"id": "pump-1", "type": "pump", "kind": "pump", "protocol": "modbus_tcp"}]


# ── Bundle → runtime show adapter ─────────────────────────────────────────────

def bundle_to_playable_show(loaded: dict) -> dict:
    """
    Convert a loaded .luxshow bundle into a ShowEngine payload.

    The compiled show stores clip positions in integer milliseconds; the runtime
    timeline works in seconds, so positions are converted on the way into the engine.
    This is the "runtime loads the deployed bundle" step.
    """
    show = loaded.get("show") or {}
    manifest = loaded.get("manifest") or {}
    duration_s = float(manifest.get("duration_ms", show.get("duration_ms", 0))) / 1000.0

    tracks = []
    for t in show.get("tracks", []):
        clips = []
        for c in t.get("clips", []):
            start_s = float(c.get("start", 0)) / 1000.0
            end_ms = c.get("end", c.get("start", 0) + c.get("duration", 0))
            clips.append({
                "id": c.get("id"),
                "start": start_s,
                "end": float(end_ms) / 1000.0,
                "intensity": c.get("intensity", 100),
            })
        tracks.append({
            "id": t.get("id"),
            "type": t.get("type"),
            "deviceId": t.get("deviceId"),
            "clips": clips,
        })

    return {
        "show": {
            "id": manifest.get("bundle_id", "deployed-show"),
            "name": show.get("name", manifest.get("show_name", "Deployed Show")),
            "bpm": float(show.get("bpm", manifest.get("bpm", 120))),
            "duration": duration_s,
        },
        "timelineTracks": tracks,
    }


# ── Capturing bus (stand-in for on-site hardware) ─────────────────────────────

class _CapturingBus:
    def __init__(self):
        self.batches: list = []

    async def send_batch(self, commands):
        self.batches.append(list(commands))

    async def blackout(self):
        pass

    @property
    def all_commands(self):
        return [c for batch in self.batches for c in batch]


# ── Individual verifications ──────────────────────────────────────────────────

def verify_compiler_bundle(editor_show: Optional[dict] = None,
                           devices: Optional[list] = None) -> dict:
    """Compile an editor show and confirm the produced .luxshow bundle is valid."""
    editor_show = editor_show or sample_editor_show()
    devices = devices if devices is not None else sample_device_list()

    result = get_compiler().compile(editor_show, devices)
    if not result.success:
        return {"name": "compiler_bundle", "status": "fail",
                "reason": "compile failed", "errors": [str(e) for e in result.errors]}

    loaded = load_luxshow(result.bundle_path)
    ok = loaded["valid"] and loaded["checksum_ok"]
    return {
        "name": "compiler_bundle",
        "status": "pass" if ok else "fail",
        "bundle_id": result.bundle_id,
        "bundle_path": result.bundle_path,
        "valid": loaded["valid"],
        "checksum_ok": loaded["checksum_ok"],
        "errors": loaded["errors"],
        "stats": result.stats,
        "_loaded": loaded,            # reused by playback verification
    }


def verify_runtime_exporter(payload: Optional[dict] = None) -> dict:
    """Export → persist → reload → confirm the artifacts are internally consistent."""
    if payload is None:
        from tests.sample_data import sample_aqua_show
        payload = sample_aqua_show()

    manifest = persist_compiled_artifacts(payload, mode="simulation")
    bundle_id = manifest["bundle_id"]

    reloaded_manifest = load_bundle_manifest(bundle_id)
    canonical = load_bundle_artifact(bundle_id, "canonical")
    session = load_bundle_artifact(bundle_id, "session")
    bundle = load_bundle_artifact(bundle_id, "bundle")

    errors = []
    if reloaded_manifest is None:
        errors.append("manifest not persisted / not reloadable")
    if not canonical or not canonical.get("compile", {}).get("validated"):
        errors.append("canonical package missing or not validated")

    signature = (canonical or {}).get("compile", {}).get("signature")
    bundle_checksum = (bundle or {}).get("checksums", [{}])[0].get("sha256")
    if not signature or signature != bundle_checksum:
        errors.append(f"bundle checksum {bundle_checksum} != canonical signature {signature}")

    session_ok = False
    try:
        RuntimeSession.model_validate(session)
        session_ok = True
    except Exception as exc:                       # pydantic ValidationError etc.
        errors.append(f"runtime_session failed contract validation: {exc}")

    ok = not errors
    return {
        "name": "runtime_exporter",
        "status": "pass" if ok else "fail",
        "bundle_id": bundle_id,
        "signature_matches": signature == bundle_checksum,
        "runtime_session_valid": session_ok,
        "artifacts": list((manifest.get("files") or {}).keys()),
        "errors": errors,
    }


def verify_onsite_playback(loaded_bundle: Optional[dict] = None) -> dict:
    """Play a compiled bundle on the real ShowEngine and confirm output flows."""
    if loaded_bundle is None:
        compiled = verify_compiler_bundle()
        if compiled["status"] != "pass":
            return {"name": "onsite_playback", "status": "fail",
                    "reason": "bundle did not compile/validate"}
        loaded_bundle = compiled["_loaded"]

    playable = bundle_to_playable_show(loaded_bundle)

    async def run():
        engine = ShowEngine()
        bus = _CapturingBus()
        await engine.start(device_manager=None, protocol_bus=bus)
        engine.load_show(playable)
        duration = engine.show_state.duration
        started = await engine.play()
        await asyncio.sleep(0.15)                  # ~15 ticks at 100 Hz
        playhead = engine.show_state.playhead
        cmds = list(bus.all_commands)
        await engine.stop_playback()
        stopped = engine.show_state.state == PlaybackState.STOPPED
        await engine.stop()
        return started, duration, playhead, cmds, stopped

    started, duration, playhead, cmds, stopped = asyncio.run(run())
    pump_cmds = [c for c in cmds if c.get("type") == "pump"]
    intensity_ok = bool(pump_cmds) and abs(pump_cmds[0].get("intensity", 0) - 0.8) < 1e-6

    ok = bool(started) and duration >= 3.0 and playhead > 0.0 and pump_cmds and intensity_ok and stopped
    return {
        "name": "onsite_playback",
        "status": "pass" if ok else "fail",
        "started": bool(started),
        "duration_s": round(duration, 3),
        "playhead_advanced": playhead > 0.0,
        "playhead_s": round(playhead, 3),
        "commands_emitted": len(cmds),
        "pump_intensity_correct": intensity_ok,
        "stopped_clean": stopped,
    }


def run_deploy_verification() -> dict:
    """Run the full AQ-X-003 compile-and-deploy verification and report."""
    compiled = verify_compiler_bundle()
    exporter = verify_runtime_exporter()
    playback = (verify_onsite_playback(compiled.get("_loaded"))
                if compiled["status"] == "pass" else
                {"name": "onsite_playback", "status": "fail", "reason": "no valid bundle"})

    compiled.pop("_loaded", None)
    checks = [compiled, exporter, playback]
    failed = [c for c in checks if c["status"] != "pass"]
    return {
        "task": "AQ-X-003",
        "title": "Compile and Deploy Bundle (recovery)",
        "deploy_ready": len(failed) == 0,
        "summary": {"passed": len(checks) - len(failed), "failed": len(failed),
                    "total": len(checks)},
        "checks": checks,
    }
