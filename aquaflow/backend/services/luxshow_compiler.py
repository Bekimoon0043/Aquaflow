"""
luxshow_compiler.py — AquaFlow Phase 7
Compiles a show project from the editor into a validated .luxshow deployment bundle.

Pipeline:
  Editor JSON  →  schema validation  →  device binding  →  safety rule expansion
               →  timing normalization  →  checksum  →  .luxshow package

The runtime loads ONLY compiled .luxshow bundles — never raw editor JSON.
This is the compile step that separates Design Mode from Live Runtime Mode.
"""

import json
import hashlib
import zipfile
import shutil
import time
import uuid
import logging
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional

log = logging.getLogger("aquaflow.compiler")

COMPILED_DIR = Path(__file__).parent.parent.parent / "compiled"
COMPILED_DIR.mkdir(exist_ok=True)

LUXSHOW_VERSION = "1.0"


# ─── Compile result ───────────────────────────────────────────────────────────
@dataclass
class CompileError:
    stage: str
    message: str
    severity: str = "error"   # error | warning


@dataclass
class CompileResult:
    success: bool
    bundle_id: str = ""
    bundle_path: str = ""
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    duration_ms: float = 0.0

    def to_dict(self):
        return {
            "success": self.success,
            "bundle_id": self.bundle_id,
            "bundle_path": self.bundle_path,
            "errors": [asdict(e) if isinstance(e, CompileError) else e for e in self.errors],
            "warnings": [asdict(w) if isinstance(w, CompileError) else w for w in self.warnings],
            "stats": self.stats,
            "duration_ms": round(self.duration_ms, 1),
        }


# ─── Compiler ─────────────────────────────────────────────────────────────────
class LuxShowCompiler:
    """
    Compiles editor show state into a validated .luxshow deployment bundle.

    A .luxshow bundle is a ZIP containing:
      manifest.json      — version, checksum, hardware profile, audit
      show.json          — normalized show data (tracks, clips, nodes)
      devices.json       — resolved device patch with safety limits
      safety_rules.json  — expanded safety rules
      deploy.json        — runtime deployment config
    """

    def __init__(self):
        self._bundle_counter = 0

    def compile(self, show_payload: dict, device_list: list, options: dict = None) -> CompileResult:
        """
        Main compile entry point.
        show_payload: raw editor show state (tracks, clips, nodes, bpm, etc.)
        device_list:  current device manager device list
        options:      { dry_run, target_hardware, operator_notes }
        """
        t0 = time.monotonic()
        options = options or {}
        result = CompileResult(success=False)
        errors = []
        warnings = []

        log.info("Compiler starting...")

        try:
            # Stage 1: Schema validation
            log.info("Stage 1: Schema validation")
            self._validate_schema(show_payload, errors, warnings)
            if any(e.severity == "error" for e in errors):
                result.errors = errors
                result.warnings = warnings
                return result

            # Stage 2: Normalize timing
            log.info("Stage 2: Timing normalization")
            show_normalized = self._normalize_timing(show_payload, warnings)

            # Stage 3: Device binding
            log.info("Stage 3: Device binding")
            devices_resolved = self._bind_devices(show_normalized, device_list, warnings)

            # Stage 4: Safety rule expansion
            log.info("Stage 4: Safety rule expansion")
            safety_rules = self._expand_safety_rules(show_normalized, devices_resolved, warnings)

            # Stage 5: Build deployment config
            log.info("Stage 5: Build deployment config")
            deploy_config = self._build_deploy_config(show_normalized, devices_resolved, options)

            # Stage 6: Package into .luxshow bundle
            log.info("Stage 6: Packaging")
            bundle_id, bundle_path = self._package_bundle(
                show_normalized, devices_resolved, safety_rules, deploy_config, options
            )

            elapsed = (time.monotonic() - t0) * 1000
            result.success = True
            result.bundle_id = bundle_id
            result.bundle_path = str(bundle_path)
            result.errors = errors
            result.warnings = warnings
            result.duration_ms = elapsed
            result.stats = {
                "track_count":  len(show_normalized.get("tracks", [])),
                "clip_count":   sum(len(t.get("clips", [])) for t in show_normalized.get("tracks", [])),
                "device_count": len(devices_resolved),
                "safety_rules": len(safety_rules),
                "bundle_size_kb": round(Path(bundle_path).stat().st_size / 1024, 1),
            }
            log.info(f"Compile complete: {bundle_id} in {elapsed:.0f}ms")

        except Exception as e:
            log.error(f"Compiler exception: {e}", exc_info=True)
            result.errors = errors + [CompileError(stage="compiler", message=str(e))]
            result.warnings = warnings
            result.duration_ms = (time.monotonic() - t0) * 1000

        return result

    # ─── Stage 1: Schema validation ──────────────────────────────────────────
    def _validate_schema(self, show: dict, errors: list, warnings: list):
        if not isinstance(show, dict):
            errors.append(CompileError("schema", "Show payload must be a JSON object"))
            return
        if "tracks" not in show:
            warnings.append(CompileError("schema", "No tracks in show — empty timeline", "warning"))
        tracks = show.get("tracks", [])
        if not isinstance(tracks, list):
            errors.append(CompileError("schema", "tracks must be an array"))
            return
        for i, track in enumerate(tracks):
            if not isinstance(track, dict):
                errors.append(CompileError("schema", f"Track {i} is not an object"))
                continue
            if "id" not in track:
                warnings.append(CompileError("schema", f"Track {i} missing id — will be assigned", "warning"))
            clips = track.get("clips", [])
            for j, clip in enumerate(clips):
                if not isinstance(clip, dict):
                    errors.append(CompileError("schema", f"Track {i} clip {j} is not an object"))
                    continue
                if "start" not in clip or "duration" not in clip:
                    errors.append(CompileError("schema", f"Track {i} clip {j} missing start/duration"))
                if clip.get("duration", 1) <= 0:
                    errors.append(CompileError("schema", f"Track {i} clip {j} has zero/negative duration"))

    # ─── Stage 2: Timing normalization ───────────────────────────────────────
    def _normalize_timing(self, show: dict, warnings: list) -> dict:
        import copy
        normalized = copy.deepcopy(show)
        bpm = float(normalized.get("bpm", 128))
        if bpm <= 0:
            warnings.append(CompileError("timing", "Invalid BPM — defaulting to 128", "warning"))
            bpm = 128.0
            normalized["bpm"] = bpm

        beat_ms = 60000.0 / bpm
        normalized["beat_ms"] = beat_ms
        normalized["compiled_at"] = time.time()

        # Ensure all clips have integer ms positions
        for track in normalized.get("tracks", []):
            track.setdefault("id", str(uuid.uuid4())[:8])
            for clip in track.get("clips", []):
                clip.setdefault("id", str(uuid.uuid4())[:8])
                clip["start"]    = max(0, int(clip.get("start", 0)))
                clip["duration"] = max(1, int(clip.get("duration", beat_ms * 4)))
                clip["end"]      = clip["start"] + clip["duration"]

        # Calculate total show duration
        max_end = 0
        for track in normalized.get("tracks", []):
            for clip in track.get("clips", []):
                max_end = max(max_end, clip.get("end", 0))
        normalized["duration_ms"] = max_end
        return normalized

    # ─── Stage 3: Device binding ──────────────────────────────────────────────
    def _bind_devices(self, show: dict, device_list: list, warnings: list) -> list:
        resolved = []
        for device in device_list:
            d = dict(device)
            # Add safety defaults if missing
            d.setdefault("safety", {})
            d["safety"].setdefault("default_state", "off")
            d["safety"].setdefault("fail_safe", "zero_output")
            d["safety"].setdefault("max_value", 255)
            # Add compile metadata
            d["bound_at"] = time.time()
            d["compile_status"] = "bound"
            resolved.append(d)

        if not resolved:
            warnings.append(CompileError("devices", "No devices bound — show will run in simulation mode", "warning"))
        return resolved

    # ─── Stage 4: Safety rule expansion ──────────────────────────────────────
    def _expand_safety_rules(self, show: dict, devices: list, warnings: list) -> list:
        rules = []

        # Always include base safety rules
        rules.append({
            "id": "sr-001",
            "name": "No output without safety permit",
            "condition": "safety.permit == false",
            "action": "zero_all_outputs",
            "priority": 1,
            "latching": True,
        })
        rules.append({
            "id": "sr-002",
            "name": "Pump requires water level OK",
            "condition": "inputs.water_level_ok == false",
            "action": "disable_pump",
            "priority": 2,
            "latching": True,
        })
        rules.append({
            "id": "sr-003",
            "name": "No flame without explicit permit",
            "condition": "inputs.flame_permit == false",
            "action": "disable_flame",
            "priority": 1,
            "latching": False,
        })
        rules.append({
            "id": "sr-004",
            "name": "No laser without explicit permit",
            "condition": "inputs.laser_permit == false",
            "action": "disable_laser",
            "priority": 1,
            "latching": False,
        })
        rules.append({
            "id": "sr-005",
            "name": "E-stop zeroes all outputs immediately",
            "condition": "safety.state == EMERGENCY_STOP",
            "action": "zero_all_outputs_hard",
            "priority": 0,
            "latching": True,
        })

        # Device-specific rules
        for device in devices:
            kind = device.get("kind", device.get("type", ""))
            if kind in ("pump", "vfd"):
                rules.append({
                    "id": f"sr-dev-{device.get('id','?')}",
                    "name": f"Pump {device.get('id')} over-pressure protection",
                    "condition": "inputs.pressure_ok == false",
                    "action": f"disable_device:{device.get('id')}",
                    "priority": 2,
                    "latching": True,
                })

        return rules

    # ─── Stage 5: Build deployment config ────────────────────────────────────
    def _build_deploy_config(self, show: dict, devices: list, options: dict) -> dict:
        return {
            "target_hardware": options.get("target_hardware", "development"),
            "dry_run": options.get("dry_run", False),
            "operator_notes": options.get("operator_notes", ""),
            "runtime_version_required": "0.1.0",
            "safety_mode": "full",
            "output_hz": 100,
            "watchdog_timeout_s": 2.0,
            "auto_arm": False,
            "created_by": "AquaFlow Studio v0.1.0",
        }

    # ─── Stage 6: Package .luxshow bundle ────────────────────────────────────
    def _package_bundle(
        self, show: dict, devices: list, safety_rules: list,
        deploy_config: dict, options: dict
    ) -> tuple[str, Path]:
        bundle_id = f"bundle-{str(uuid.uuid4())[:8]}"
        bundle_dir = COMPILED_DIR / bundle_id
        bundle_dir.mkdir(parents=True, exist_ok=True)

        # Write component files
        show_json    = json.dumps(show, indent=2, ensure_ascii=False)
        devices_json = json.dumps(devices, indent=2, ensure_ascii=False)
        safety_json  = json.dumps(safety_rules, indent=2, ensure_ascii=False)
        deploy_json  = json.dumps(deploy_config, indent=2, ensure_ascii=False)

        # newline="" disables platform newline translation, so the bytes on disk (and
        # therefore inside the ZIP) match the exact strings the checksums are computed
        # over. Without this, Windows rewrites \n → \r\n and every bundle fails its own
        # checksum verification on-site.
        (bundle_dir / "show.json").write_text(show_json, encoding="utf-8", newline="")
        (bundle_dir / "devices.json").write_text(devices_json, encoding="utf-8", newline="")
        (bundle_dir / "safety_rules.json").write_text(safety_json, encoding="utf-8", newline="")
        (bundle_dir / "deploy.json").write_text(deploy_json, encoding="utf-8", newline="")

        # Build manifest with checksums
        manifest = {
            "luxshow_version": LUXSHOW_VERSION,
            "bundle_id": bundle_id,
            "show_name": show.get("name", "Untitled Show"),
            "compiled_at": time.time(),
            "duration_ms": show.get("duration_ms", 0),
            "bpm": show.get("bpm", 128),
            "track_count": len(show.get("tracks", [])),
            "device_count": len(devices),
            "safety_rule_count": len(safety_rules),
            "operator_notes": options.get("operator_notes", ""),
            "target_hardware": deploy_config.get("target_hardware", "development"),
            "checksums": {
                "show":    hashlib.sha256(show_json.encode()).hexdigest()[:16],
                "devices": hashlib.sha256(devices_json.encode()).hexdigest()[:16],
                "safety":  hashlib.sha256(safety_json.encode()).hexdigest()[:16],
                "deploy":  hashlib.sha256(deploy_json.encode()).hexdigest()[:16],
            },
            "hardware_profile": {
                "requires_plc": any(d.get("protocol") == "modbus_tcp" for d in devices),
                "requires_artnet": any(d.get("protocol") in ("artnet", "dmx") for d in devices),
                "requires_sacn": any(d.get("protocol") == "sacn" for d in devices),
                "has_flame": any(d.get("kind") == "flame" for d in devices),
                "has_laser": any(d.get("kind") == "laser" for d in devices),
            },
        }
        manifest_json = json.dumps(manifest, indent=2, ensure_ascii=False)
        (bundle_dir / "manifest.json").write_text(manifest_json, encoding="utf-8", newline="")

        # Package into .luxshow ZIP
        luxshow_path = COMPILED_DIR / f"{bundle_id}.luxshow"
        with zipfile.ZipFile(luxshow_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in bundle_dir.iterdir():
                zf.write(f, f.name)

        # Clean up temp dir
        shutil.rmtree(bundle_dir, ignore_errors=True)

        log.info(f"Bundle packaged: {luxshow_path} ({luxshow_path.stat().st_size} bytes)")
        return bundle_id, luxshow_path


# ─── Bundle loader / verifier (AQ-X-003) ──────────────────────────────────────

REQUIRED_MEMBERS = ["manifest.json", "show.json", "devices.json",
                    "safety_rules.json", "deploy.json"]

# Manifest checksum key → the member it covers.
_CHECKSUM_MEMBERS = {"show": "show.json", "devices": "devices.json",
                     "safety": "safety_rules.json", "deploy": "deploy.json"}


def load_luxshow(path) -> dict:
    """
    Open and VERIFY a compiled .luxshow bundle — the inverse of the packager.

    A bundle is valid only when it is a well-formed ZIP that contains every required
    member, each member parses as JSON, and every manifest checksum matches the
    SHA-256 of the member it covers (so tampering or corruption is detected before a
    show ever reaches hardware). Returns a dict with `valid`, `errors`, `checksum_ok`
    and the parsed manifest/show/devices/safety_rules/deploy.
    """
    path = Path(path)
    if not path.exists():
        return {"valid": False, "errors": [f"bundle not found: {path}"], "checksum_ok": False}

    errors: list[str] = []
    raw: dict[str, Optional[str]] = {}
    try:
        with zipfile.ZipFile(path) as zf:
            bad = zf.testzip()
            if bad is not None:
                errors.append(f"corrupt member in ZIP: {bad}")
            names = set(zf.namelist())
            missing = [m for m in REQUIRED_MEMBERS if m not in names]
            if missing:
                errors.append(f"missing required members: {missing}")
            for m in REQUIRED_MEMBERS:
                raw[m] = zf.read(m).decode("utf-8") if m in names else None
    except zipfile.BadZipFile:
        return {"valid": False, "errors": ["not a valid ZIP / .luxshow archive"], "checksum_ok": False}

    parsed: dict[str, object] = {}
    for m, txt in raw.items():
        if txt is None:
            continue
        try:
            parsed[m] = json.loads(txt)
        except json.JSONDecodeError:
            errors.append(f"{m} is not valid JSON")

    manifest = parsed.get("manifest.json", {}) or {}
    checks = manifest.get("checksums", {}) if isinstance(manifest, dict) else {}
    checksum_ok = True
    for key, member in _CHECKSUM_MEMBERS.items():
        txt = raw.get(member)
        want = checks.get(key)
        if txt is None or not want:
            continue
        got = hashlib.sha256(txt.encode("utf-8")).hexdigest()[:16]
        if got != want:
            checksum_ok = False
            errors.append(f"checksum mismatch for {member}: manifest={want} actual={got}")

    return {
        "valid": (not errors) and checksum_ok,
        "errors": errors,
        "checksum_ok": checksum_ok,
        "manifest": manifest,
        "show": parsed.get("show.json"),
        "devices": parsed.get("devices.json"),
        "safety_rules": parsed.get("safety_rules.json"),
        "deploy": parsed.get("deploy.json"),
    }


# ─── Singleton ────────────────────────────────────────────────────────────────
_compiler: Optional[LuxShowCompiler] = None

def get_compiler() -> LuxShowCompiler:
    global _compiler
    if _compiler is None:
        _compiler = LuxShowCompiler()
    return _compiler
