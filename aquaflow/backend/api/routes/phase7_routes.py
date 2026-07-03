"""
phase7_routes.py — AquaFlow Phase 7
API routes for .luxshow compiler, diagnostics, and operator panel.
Mount in main.py: app.include_router(phase7_router, prefix="/api")
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

log = logging.getLogger("aquaflow.phase7_routes")
phase7_router = APIRouter(tags=["Phase7"])


# ─── Compiler routes ──────────────────────────────────────────────────────────
class CompileRequest(BaseModel):
    show_payload: dict
    operator_notes: Optional[str] = ""
    target_hardware: Optional[str] = "development"
    dry_run: Optional[bool] = False


@phase7_router.post("/compiler/compile")
async def compile_show(body: CompileRequest):
    """Compile current show into a .luxshow deployment bundle."""
    try:
        from services.luxshow_compiler import get_compiler
        from app_state import device_manager
        from services.diagnostics import get_diagnostics

        devices = device_manager.get_all_devices()
        result = get_compiler().compile(
            show_payload=body.show_payload,
            device_list=devices,
            options={
                "operator_notes": body.operator_notes,
                "target_hardware": body.target_hardware,
                "dry_run": body.dry_run,
            }
        )
        # Log compile event
        diag = get_diagnostics()
        if result.success:
            diag.record("info", "compiler", "luxshow_compiler",
                f"Compiled bundle {result.bundle_id} — {result.stats.get('clip_count',0)} clips, "
                f"{result.stats.get('device_count',0)} devices in {result.duration_ms:.0f}ms",
                result.stats)
        else:
            diag.record("error", "compiler", "luxshow_compiler",
                f"Compile failed: {[e['message'] for e in result.errors]}")

        return result.to_dict()
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@phase7_router.get("/compiler/bundles")
async def list_bundles():
    """List all compiled .luxshow bundles."""
    from pathlib import Path
    import json
    compiled_dir = Path("compiled")
    if not compiled_dir.exists():
        return {"bundles": []}
    bundles = []
    for f in sorted(compiled_dir.glob("*.luxshow"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            import zipfile
            with zipfile.ZipFile(f) as zf:
                manifest = json.loads(zf.read("manifest.json"))
            bundles.append({
                "bundle_id":   manifest["bundle_id"],
                "show_name":   manifest.get("show_name", "Untitled"),
                "compiled_at": manifest.get("compiled_at"),
                "duration_ms": manifest.get("duration_ms", 0),
                "track_count": manifest.get("track_count", 0),
                "device_count":manifest.get("device_count", 0),
                "size_kb":     round(f.stat().st_size / 1024, 1),
                "filename":    f.name,
            })
        except Exception:
            pass
    return {"bundles": bundles}


@phase7_router.post("/compiler/load/{bundle_id}")
async def load_bundle(bundle_id: str):
    """Load a .luxshow bundle into the runtime transport."""
    from pathlib import Path
    import json, zipfile
    from engine.runtime_transport import get_transport
    from services.diagnostics import get_diagnostics

    bundle_path = Path("compiled") / f"{bundle_id}.luxshow"
    if not bundle_path.exists():
        raise HTTPException(404, f"Bundle {bundle_id} not found")
    try:
        with zipfile.ZipFile(bundle_path) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        transport = get_transport()
        transport.load_show(bundle_id, manifest.get("duration_ms", 0))
        get_diagnostics().record("info", "transport", "bundle_loader",
            f"Loaded bundle {bundle_id}: {manifest.get('show_name')} "
            f"({manifest.get('duration_ms',0)}ms)")
        return {"ok": True, "bundle_id": bundle_id, "manifest": manifest}
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@phase7_router.delete("/compiler/bundles/{bundle_id}")
async def delete_bundle(bundle_id: str):
    from pathlib import Path
    bundle_path = Path("compiled") / f"{bundle_id}.luxshow"
    if bundle_path.exists():
        bundle_path.unlink()
    return {"ok": True, "deleted": bundle_id}


# ─── Diagnostics routes ───────────────────────────────────────────────────────
@phase7_router.get("/diagnostics/events")
async def get_diag_events(
    limit: int = 100,
    level: Optional[str] = None,
    category: Optional[str] = None,
    since: Optional[float] = None,
):
    from services.diagnostics import get_diagnostics
    return {
        "events": get_diagnostics().get_events(
            limit=limit, level=level, category=category, since=since
        )
    }


@phase7_router.get("/diagnostics/summary")
async def get_diag_summary():
    from services.diagnostics import get_diagnostics
    return get_diagnostics().get_summary()


@phase7_router.post("/diagnostics/record")
async def record_diag_event(body: dict):
    from services.diagnostics import get_diagnostics
    ev = get_diagnostics().record(
        level=body.get("level", "info"),
        category=body.get("category", "system"),
        source=body.get("source", "frontend"),
        message=body.get("message", ""),
        data=body.get("data", {}),
    )
    return {"ok": True, "id": ev.id}


@phase7_router.delete("/diagnostics/clear")
async def clear_diagnostics():
    from services.diagnostics import get_diagnostics
    get_diagnostics().clear()
    return {"ok": True}


# ─── Operator panel status route ──────────────────────────────────────────────
@phase7_router.get("/operator/status")
async def get_operator_status():
    """Single endpoint returning everything the operator panel needs."""
    try:
        from safety.safety_kernel import get_safety_kernel
        from engine.runtime_transport import get_transport
        from app_state import show_engine, device_manager, protocol_bus
        from services.diagnostics import get_diagnostics

        safety    = get_safety_kernel()
        transport = get_transport()
        diag      = get_diagnostics()

        return {
            "safety":    safety.get_status(),
            "transport": transport.get_status(),
            "engine":    show_engine.get_state(),
            "devices":   device_manager.get_summary(),
            "protocols": protocol_bus.get_status(),
            "diagnostics": diag.get_summary(),
            "recent_faults": diag.get_events(limit=5, level="error"),
            # Hardware conflict detection (Stage 1, Priority 3): duplicate/overflowing
            # fixture addresses that block the show from running. Empty = safe to run.
            "hardware_conflicts": show_engine.get_hardware_conflicts(),
        }
    except Exception as e:
        raise HTTPException(500, detail=str(e))


# ─── PLC supervision routes ───────────────────────────────────────────────────
@phase7_router.get("/plc/tag-map")
async def get_plc_tag_map():
    """Return the formal PLC tag map."""
    return {
        "tag_map": [
            {"tag": "W001", "name": "Water Level OK",     "type": "bool", "register": 0,   "safety": True},
            {"tag": "P001", "name": "Pump A Run",          "type": "bool", "register": 1,   "safety": False},
            {"tag": "P002", "name": "Pump B Run",          "type": "bool", "register": 2,   "safety": False},
            {"tag": "V001", "name": "Main Valve Open",     "type": "bool", "register": 3,   "safety": False},
            {"tag": "PR01", "name": "Manifold Pressure",   "type": "int",  "register": 100, "safety": True,  "unit": "kPa", "max": 600},
            {"tag": "TH01", "name": "Pump Room Temp",      "type": "int",  "register": 101, "safety": True,  "unit": "°C",  "max": 60},
            {"tag": "ES01", "name": "E-Stop Chain",        "type": "bool", "register": 10,  "safety": True},
            {"tag": "FL01", "name": "Flame Subsystem OK",  "type": "bool", "register": 11,  "safety": True},
            {"tag": "VF01", "name": "VFD A Fault",         "type": "bool", "register": 12,  "safety": True},
            {"tag": "VF02", "name": "VFD B Fault",         "type": "bool", "register": 13,  "safety": True},
        ]
    }


@phase7_router.get("/plc/fault-matrix")
async def get_plc_fault_matrix():
    """Return the PLC fault code → safety kernel interlock mapping."""
    return {
        "fault_matrix": [
            {"plc_code": "F001", "description": "Low water level",    "safety_interlock": "LOW_WATER",       "action": "disable_pump", "latching": True},
            {"plc_code": "F002", "description": "Over pressure",      "safety_interlock": "OVER_PRESSURE",   "action": "disable_pump", "latching": True},
            {"plc_code": "F003", "description": "VFD A fault",        "safety_interlock": "VFD_FAULT",       "action": "disable_pump", "latching": True},
            {"plc_code": "F004", "description": "VFD B fault",        "safety_interlock": "VFD_FAULT",       "action": "disable_pump", "latching": True},
            {"plc_code": "F005", "description": "Thermal overload",   "safety_interlock": "THERMAL_OVERLOAD","action": "disable_all",  "latching": True},
            {"plc_code": "F006", "description": "E-stop open",        "safety_interlock": "ESTOP_OPEN",      "action": "emergency_stop","latching": True},
            {"plc_code": "F007", "description": "Comm timeout",       "safety_interlock": "PLC_COMM_LOSS",   "action": "safe_state",   "latching": False},
            {"plc_code": "F008", "description": "Flame inhibit",      "safety_interlock": "FLAME_INHIBIT",   "action": "disable_flame","latching": False},
        ]
    }
