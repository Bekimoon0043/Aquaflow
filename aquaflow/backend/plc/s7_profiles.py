"""
plc/s7_profiles.py — versioned Siemens tag profiles.

The PLC panel used to ship one anonymous Siemens tag table whose addresses
CONTRADICTED the published contract (docs/S7_DB_CONTRACT.md): DB1.DBW0 was
"pump speed" (the contract says HEARTBEAT) and DB1.DBX2.0 was "pump run" (the
contract says ESTOP_OK). Writing a pump speed into the heartbeat word, or a run
bit onto the E-stop monitor, is the kind of mistake that looks like wiring.

A profile is now an explicit, versioned object the operator SELECTS and
CONFIRMS. Nothing assigns it automatically: a Siemens PLC found by discovery is
just "an S7 device" until someone says "this is the AquaFlow 1215C rack".

Field directions are from AquaFlow's point of view:
  read  — PLC → AquaFlow (the contract's "out"); discovery/verification may read
  write — AquaFlow → PLC command (the contract's "in"); NEVER touched by
          discovery or verification
"""
from __future__ import annotations

from typing import Optional

CONTRACT_DOC = "docs/S7_DB_CONTRACT.md"

AQUAFLOW_S7_1215C_V1 = {
    "id": "aquaflow-s7-1215c-v1",
    "version": "1.0",
    "label": "AquaFlow S7-1215C field I/O — DB1 \"AquaFlowIO\" (contract v1)",
    "contract": CONTRACT_DOC,
    "cpu": "CPU 1215C DC/DC/DC (6ES7215-1AG40-0XB0)",
    "order_number_prefix": "6ES7 215-1AG40",
    "rack": 0,
    "slot": 1,
    "port": 102,
    "db": 1,
    "requires_confirmation": True,
    "requirements": [
        "DB1 must be NON-OPTIMIZED (absolute addressing)",
        "PUT/GET must be permitted (CPU → Protection & Security → Connection mechanisms)",
        "HEARTBEAT must be a counter the cyclic program increments (~100 ms)",
    ],
    "fields": [
        {"id": "heartbeat",      "name": "HEARTBEAT",      "address": "DB1.DBW0",   "type": "uint", "direction": "read",  "plc_dir": "out", "role": "heartbeat",
         "description": "+1 every cyclic pass (~100 ms), wraps at 65535"},
        {"id": "estop_ok",       "name": "ESTOP_OK",       "address": "DB1.DBX2.0", "type": "bool", "direction": "read",  "plc_dir": "out",
         "description": "1 = E-stop chain closed (monitor ONLY)"},
        {"id": "vfd_ok",         "name": "VFD_OK",         "address": "DB1.DBX2.1", "type": "bool", "direction": "read",  "plc_dir": "out",
         "description": "1 = VFD fault relay closed"},
        {"id": "thermal_ok",     "name": "THERMAL_OK",     "address": "DB1.DBX2.2", "type": "bool", "direction": "read",  "plc_dir": "out",
         "description": "1 = thermal contacts closed"},
        {"id": "level_float_ok", "name": "LEVEL_FLOAT_OK", "address": "DB1.DBX2.3", "type": "bool", "direction": "read",  "plc_dir": "out",
         "description": "1 = low-level float switch closed"},
        {"id": "level_raw",      "name": "LEVEL_RAW",      "address": "DB1.DBW4",   "type": "int",  "direction": "read",  "plc_dir": "out", "min": 0, "max": 27648,
         "description": "raw AI counts"},
        {"id": "pressure_raw",   "name": "PRESSURE_RAW",   "address": "DB1.DBW6",   "type": "int",  "direction": "read",  "plc_dir": "out", "min": 0, "max": 27648,
         "description": "raw AI counts"},
        {"id": "flow_raw",       "name": "FLOW_RAW",       "address": "DB1.DBW8",   "type": "int",  "direction": "read",  "plc_dir": "out", "min": 0, "max": 27648,
         "description": "raw AI counts"},
        {"id": "vfd_speed_fb",   "name": "VFD_SPEED_FB",   "address": "DB1.DBW10",  "type": "int",  "direction": "read",  "plc_dir": "out",
         "description": "speed feedback raw counts"},
        {"id": "cmd_pump_speed", "name": "CMD_PUMP_SPEED", "address": "DB1.DBW12",  "type": "int",  "direction": "write", "plc_dir": "in",  "min": 0, "max": 27648,
         "description": "AquaFlow → PLC: AO reference (AF-IO-009). Never written by discovery/verification."},
        {"id": "cmd_enable",     "name": "CMD_ENABLE",     "address": "DB1.DBX14.0", "type": "bool", "direction": "write", "plc_dir": "in",
         "description": "AquaFlow → PLC: CMD_FLAGS bit 0 = output enable. Never written by discovery/verification."},
    ],
}

S7_PROFILES: dict[str, dict] = {
    AQUAFLOW_S7_1215C_V1["id"]: AQUAFLOW_S7_1215C_V1,
}


def get_profile(profile_id: str) -> Optional[dict]:
    return S7_PROFILES.get(profile_id)


def list_profiles() -> list[dict]:
    return [profile_summary(p) for p in S7_PROFILES.values()]


def profile_summary(profile: dict) -> dict:
    return {
        "id": profile["id"], "version": profile["version"], "label": profile["label"],
        "contract": profile["contract"], "cpu": profile["cpu"],
        "rack": profile["rack"], "slot": profile["slot"], "port": profile["port"],
        "requires_confirmation": profile.get("requires_confirmation", True),
        "requirements": list(profile.get("requirements", [])),
        "field_count": len(profile["fields"]),
        "read_fields": [f["address"] for f in profile["fields"] if f["direction"] == "read"],
        "write_fields": [f["address"] for f in profile["fields"] if f["direction"] == "write"],
    }


def read_fields(profile: dict) -> list[dict]:
    """The fields discovery/verification is allowed to touch."""
    return [f for f in profile["fields"] if f.get("direction") == "read"]


def heartbeat_field(profile: dict) -> Optional[dict]:
    return next((f for f in profile["fields"] if f.get("role") == "heartbeat"), None)


_TAG_TYPES = {"uint": "int", "int": "int", "bool": "bool", "word": "word", "real": "real"}


def profile_tags(profile: dict) -> list[dict]:
    """PLC-engine tag dicts for a profile. Write-direction fields carry
    access="write" so the UI can keep them out of monitoring views; read
    fields carry access="read" and are never written by the engine's mapping."""
    tags = []
    for f in profile["fields"]:
        tags.append({
            "id": f["id"], "name": f["name"], "address": f["address"],
            "tag_type": _TAG_TYPES.get(f["type"], "int"),
            "description": f.get("description", ""), "unit": "",
            "min_value": f.get("min", 0), "max_value": f.get("max", 65535 if f["type"] != "bool" else 1),
            "scale_factor": 1.0, "offset": 0.0, "mapped_device": "",
            "mapped_param": "", "current_value": None, "last_updated": 0.0,
            "access": f["direction"], "profile_id": profile["id"],
        })
    return tags
