"""
Compatibility adapters between current AquaFlow .aqua payloads and the
future canonical .luxshow structure.

This module is additive: it preserves the current prototype payloads while
introducing a stable canonical format for the future compiler/runtime split.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

CANONICAL_VERSION = "0.2.0"


def _ms(seconds: float | int | None) -> int:
    return int(round(float(seconds or 0) * 1000))


def _sec(milliseconds: int | float | None) -> float:
    return round(float(milliseconds or 0) / 1000.0, 3)


def _normalize_protocol(proto: str | None) -> str:
    mapping = {
        None: "mqtt",
        "modbus": "modbus_tcp",
        "modbus_tcp": "modbus_tcp",
        "modbus_rtu": "modbus_rtu",
        "dmx": "artnet",
        "artnet": "artnet",
        "sacn": "sacn",
        "mqtt": "mqtt",
        "opcua": "opc_ua",
        "opc_ua": "opc_ua",
        "osc": "osc",
        "midi": "midi",
        "timecode": "timecode",
        "smpte": "smpte",
        "ndi": "ndi",
    }
    return mapping.get(proto, str(proto))


def _legacy_protocol(proto: str | None) -> str | None:
    mapping = {
        "modbus_tcp": "modbus",
        "modbus_rtu": "modbus",
        "artnet": "artnet",
        "sacn": "sacn",
        "opc_ua": "opcua",
        "mqtt": "mqtt",
        "osc": "osc",
        "midi": "midi",
        "timecode": "timecode",
        "smpte": "smpte",
        "ndi": "ndi",
    }
    return mapping.get(proto or "", proto)


def device_to_canonical(device: dict[str, Any]) -> dict[str, Any]:
    protocol = _normalize_protocol(device.get("protocol"))
    address: dict[str, Any] = {}
    if device.get("ip"):
        address["host"] = device.get("ip")
    if device.get("port") is not None:
        address["port"] = device.get("port")
    if device.get("unit_id") is not None:
        address["unit_id"] = device.get("unit_id")
    if device.get("universe") is not None:
        address["universe"] = device.get("universe")
    if device.get("channel") is not None:
        address["channel"] = device.get("channel")
    return {
        "id": device.get("id", "unknown-device"),
        "kind": device.get("type", "unknown"),
        "protocol": protocol,
        "address": address,
        "capabilities": deepcopy(device.get("capabilities", [])),
        "safety": {
            "default_state": "stop" if device.get("type") in {"pump", "flame", "laser"} else "off",
            "requires_pressure_ok": device.get("type") in {"pump", "valve", "flame"},
            "requires_water_ok": device.get("type") in {"pump", "valve", "fog"},
            "max_speed": device.get("max_speed"),
        },
    }


def device_from_canonical(device: dict[str, Any]) -> dict[str, Any]:
    address = device.get("address", {}) or {}
    return {
        "id": device.get("id"),
        "label": device.get("label", device.get("id")),
        "type": device.get("kind", "unknown"),
        "protocol": _legacy_protocol(device.get("protocol")),
        "ip": address.get("host"),
        "port": address.get("port"),
        "unit_id": address.get("unit_id"),
        "status": device.get("status", "online"),
        "health": device.get("health", 100),
        "capabilities": deepcopy(device.get("capabilities", [])),
    }


def node_to_canonical(node: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node.get("id"),
        "type": node.get("type"),
        "label": node.get("label"),
        "position": {"x": node.get("x", 0), "y": node.get("y", 0)},
        "size": {"width": node.get("width", 0), "height": node.get("height", 0)},
        "ports": deepcopy(node.get("ports", {"in": [], "out": []})),
        "params": deepcopy(node.get("params", {})),
        "binding": {
            "protocol": _normalize_protocol(node.get("protocol")) if node.get("protocol") else None,
            "device_id": node.get("deviceId"),
            "status": node.get("status"),
        },
    }


def node_from_canonical(node: dict[str, Any]) -> dict[str, Any]:
    position = node.get("position", {}) or {}
    size = node.get("size", {}) or {}
    binding = node.get("binding", {}) or {}
    return {
        "id": node.get("id"),
        "type": node.get("type"),
        "label": node.get("label"),
        "x": position.get("x", 0),
        "y": position.get("y", 0),
        "width": size.get("width", 0),
        "height": size.get("height", 0),
        "ports": deepcopy(node.get("ports", {"in": [], "out": []})),
        "params": deepcopy(node.get("params", {})),
        "protocol": _legacy_protocol(binding.get("protocol")),
        "deviceId": binding.get("device_id"),
        "status": binding.get("status"),
    }


def connection_to_canonical(conn: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": conn.get("id"),
        "from": conn.get("from"),
        "from_port": conn.get("fromPort"),
        "to": conn.get("to"),
        "to_port": conn.get("toPort"),
    }


def connection_from_canonical(conn: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": conn.get("id"),
        "from": conn.get("from"),
        "fromPort": conn.get("from_port"),
        "to": conn.get("to"),
        "toPort": conn.get("to_port"),
    }


def clip_to_canonical(clip: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": clip.get("id"),
        "start_ms": _ms(clip.get("start")),
        "end_ms": _ms(clip.get("end")),
        "label": clip.get("label", "Cue"),
        "intensity": max(0.0, min(1.0, float(clip.get("intensity", 100)) / 100.0)),
        "behavior": {
            "preset_id": clip.get("presetId"),
            "easing": clip.get("easing", "linear"),
            "blend": clip.get("blend", "replace"),
            "loop": bool(clip.get("loop", False)),
            "parameters": deepcopy(clip.get("params", {})),
        },
        "safety_class": clip.get("safetyClass", "normal"),
        "tags": deepcopy(clip.get("tags", [])),
    }


def clip_from_canonical(clip: dict[str, Any]) -> dict[str, Any]:
    behavior = clip.get("behavior", {}) or {}
    return {
        "id": clip.get("id"),
        "start": _sec(clip.get("start_ms")),
        "end": _sec(clip.get("end_ms")),
        "label": clip.get("label", "Cue"),
        "intensity": int(round(float(clip.get("intensity", 1.0)) * 100)),
        "presetId": behavior.get("preset_id"),
        "easing": behavior.get("easing", "linear"),
        "blend": behavior.get("blend", "replace"),
        "loop": bool(behavior.get("loop", False)),
        "params": deepcopy(behavior.get("parameters", {})),
        "safetyClass": clip.get("safety_class", "normal"),
        "tags": deepcopy(clip.get("tags", [])),
    }


def track_to_canonical(track: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": track.get("id"),
        "label": track.get("label"),
        "type": track.get("type"),
        "color": track.get("color"),
        "device_id": track.get("deviceId"),
        "muted": bool(track.get("muted", False)),
        "solo": bool(track.get("solo", False)),
        "clips": [clip_to_canonical(c) for c in track.get("clips", [])],
        "automation": deepcopy(track.get("automation", [])),
    }


def track_from_canonical(track: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": track.get("id"),
        "label": track.get("label"),
        "type": track.get("type"),
        "color": track.get("color"),
        "deviceId": track.get("device_id"),
        "muted": bool(track.get("muted", False)),
        "solo": bool(track.get("solo", False)),
        "clips": [clip_from_canonical(c) for c in track.get("clips", [])],
        "automation": deepcopy(track.get("automation", [])),
    }


def aqua_to_canonical(payload: dict[str, Any]) -> dict[str, Any]:
    current_show = payload.get("show") or payload.get("currentShow") or {}
    devices = payload.get("devices", [])
    nodes = payload.get("nodes", [])
    connections = payload.get("connections", [])
    timeline = payload.get("timelineTracks") or payload.get("tracks") or []

    return {
        "format": {
            "extension": ".luxshow",
            "version": CANONICAL_VERSION,
        },
        "show": {
            "id": current_show.get("id", "show-001"),
            "name": current_show.get("name", "Untitled Show"),
            "duration_ms": _ms(current_show.get("duration", 240)),
            "mode": payload.get("mode", "design"),
            "bpm": current_show.get("bpm", 128),
            "sample_rate": current_show.get("sampleRate", 48000),
            "loop": bool(current_show.get("loop", False)),
        },
        "assets": deepcopy(payload.get("assets", [])),
        "devices": [device_to_canonical(d) for d in devices],
        "patch": {
            "nodes": [node_to_canonical(n) for n in nodes],
            "connections": [connection_to_canonical(c) for c in connections],
        },
        "timeline": [track_to_canonical(t) for t in timeline],
        "safety_rules": deepcopy(payload.get("safetyRules", [])),
        "calibration_profile": deepcopy(payload.get("calibrationProfile", {})),
        "ui": deepcopy(payload.get("ui", {})),
        "compile": {
            "compiled_at": datetime.now(UTC).isoformat(),
            "target_runtime": "lux-runtime-core",
            "validated": False,
            "signature": payload.get("signature", "pending"),
            "source_format": payload.get("aquaflow", "prototype-aqua"),
        },
    }


def canonical_to_aqua(payload: dict[str, Any]) -> dict[str, Any]:
    show = payload.get("show", {}) or {}
    patch = payload.get("patch", {}) or {}
    return {
        "aquaflow": "0.1.0",
        "savedAt": datetime.now(UTC).isoformat(),
        "show": {
            "id": show.get("id", "show-001"),
            "name": show.get("name", "Untitled Show"),
            "bpm": show.get("bpm", 128),
            "duration": _sec(show.get("duration_ms", 240000)),
            "sampleRate": show.get("sample_rate", 48000),
            "loop": bool(show.get("loop", False)),
        },
        "nodes": [node_from_canonical(n) for n in patch.get("nodes", [])],
        "connections": [connection_from_canonical(c) for c in patch.get("connections", [])],
        "timelineTracks": [track_from_canonical(t) for t in payload.get("timeline", [])],
        "devices": [device_from_canonical(d) for d in payload.get("devices", [])],
        "ui": deepcopy(payload.get("ui", {})),
    }


def runtime_session_from_canonical(payload: dict[str, Any], *, mode: str = "design") -> dict[str, Any]:
    commands: list[dict[str, Any]] = []
    for track in payload.get("timeline", []):
        for clip in track.get("clips", []):
            commands.append({
                "command_id": f"{track.get('id')}::{clip.get('id')}",
                "timestamp_us": int(clip.get("start_ms", 0)) * 1000,
                "device_id": track.get("device_id") or "unbound",
                "action": f"trigger_{track.get('type', 'cue')}",
                "value": float(clip.get("intensity", 1.0)),
                "safety_class": clip.get("safety_class", "normal"),
            })

    return {
        "session_id": f"session-{payload.get('show', {}).get('id', 'show-001')}",
        "mode": mode,
        "transport": "stopped",
        "bundle_id": payload.get("show", {}).get("id", "show-001"),
        "sync": {
            "source": "internal",
            "locked": False,
            "offset_us": 0,
        },
        "safety": {
            "state": "safe_idle",
            "permit_live": False,
            "active_faults": [],
        },
        "commands": commands,
    }
