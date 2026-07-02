"""Validate Step 2 canonical schema adapters and runtime contracts."""
from __future__ import annotations

import json
from pathlib import Path

from contracts.runtime_contract import RuntimeSession
from schema_adapter import aqua_to_canonical, canonical_to_aqua, runtime_session_from_canonical

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIR = ROOT / "shared" / "lux-schema"


def load_json(path: Path):
    return json.loads(path.read_text())


def build_sample_aqua() -> dict:
    return {
        "aquaflow": "0.1.0",
        "savedAt": "2026-05-24T00:00:00Z",
        "show": {
            "id": "show-001",
            "name": "Untitled Show",
            "bpm": 128,
            "duration": 240,
            "sampleRate": 48000,
            "loop": False,
        },
        "nodes": [
            {
                "id": "node-master-pump",
                "type": "pump",
                "label": "Master Pump Array",
                "x": 160,
                "y": 100,
                "width": 180,
                "height": 80,
                "ports": {"in": ["trigger"], "out": ["flow"]},
                "params": {"speed": 75},
                "protocol": "modbus",
                "deviceId": "pump-01",
                "status": "online",
            }
        ],
        "connections": [
            {"id": "conn-1", "from": "node-master-pump", "fromPort": "flow", "to": "node-light", "toPort": "trigger"}
        ],
        "timelineTracks": [
            {
                "id": "track-1",
                "label": "Master Pump",
                "type": "pump",
                "color": "#00d4ff",
                "deviceId": "pump-01",
                "muted": False,
                "solo": False,
                "clips": [
                    {"id": "clip-1", "start": 0, "end": 16, "label": "Intro Surge", "intensity": 60}
                ],
            }
        ],
        "devices": [
            {
                "id": "pump-01",
                "label": "Master Pump Array",
                "type": "pump",
                "protocol": "modbus",
                "ip": "192.168.1.10",
                "port": 502,
                "status": "online",
                "health": 98,
            }
        ],
        "ui": {"timelineZoom": 4, "showGrid": True},
    }


def main() -> None:
    required = [
        "clip.schema.json",
        "track.schema.json",
        "node.schema.json",
        "connection.schema.json",
        "device.schema.json",
        "show-package.schema.json",
        "runtime-session.schema.json",
        "telemetry-frame.schema.json",
        "deployment-bundle.schema.json",
        "safety-rule.schema.json",
        "calibration-profile.schema.json",
        "runtime-command.schema.json",
        "fault-event.schema.json",
    ]
    for filename in required:
        load_json(SCHEMA_DIR / filename)

    aqua = build_sample_aqua()
    canonical = aqua_to_canonical(aqua)
    round_trip = canonical_to_aqua(canonical)
    runtime_session = runtime_session_from_canonical(canonical, mode="simulation")
    RuntimeSession.model_validate(runtime_session)

    assert canonical["format"]["extension"] == ".luxshow"
    assert canonical["show"]["duration_ms"] == 240000
    assert canonical["timeline"][0]["clips"][0]["start_ms"] == 0
    assert canonical["timeline"][0]["clips"][0]["end_ms"] == 16000
    assert round_trip["show"]["duration"] == 240.0
    assert round_trip["timelineTracks"][0]["clips"][0]["intensity"] == 60
    assert runtime_session["commands"][0]["device_id"] == "pump-01"

    print("Step 2 validation OK")
    print(json.dumps({
        "canonical_show": canonical["show"],
        "runtime_session_summary": {
            "session_id": runtime_session["session_id"],
            "command_count": len(runtime_session["commands"]),
            "mode": runtime_session["mode"],
        }
    }, indent=2))


if __name__ == "__main__":
    main()
