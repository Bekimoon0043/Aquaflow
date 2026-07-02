"""Validate Step 4 persistent artifact export flow."""
from __future__ import annotations

from app_state import show_engine
from services.runtime_exporter import (
    COMPILED_DIR,
    list_compiled_artifacts,
    load_bundle_artifact,
    load_bundle_manifest,
    persist_compiled_artifacts,
)


def build_sample_snapshot() -> dict:
    return {
        "currentShow": {
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
        "connections": [],
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
    snapshot = build_sample_snapshot()
    manifest = persist_compiled_artifacts(snapshot, mode="simulation", runtime_target="industrial_pc")
    bundle_id = manifest["bundle_id"]

    assert (COMPILED_DIR / bundle_id / "manifest.json").exists()
    assert load_bundle_manifest(bundle_id)["bundle_id"] == bundle_id
    assert load_bundle_artifact(bundle_id, "canonical")["show"]["id"] == "show-001"
    assert load_bundle_artifact(bundle_id, "session")["session_id"] == "session-show-001"
    assert load_bundle_artifact(bundle_id, "bundle")["runtime_target"] == "industrial_pc"
    assert any(item["bundle_id"] == bundle_id for item in list_compiled_artifacts())
    assert "state" in show_engine.get_state()

    print("Step 4 validation OK")
    print({
        "bundle_id": bundle_id,
        "compiled_dir": str(COMPILED_DIR),
        "artifact_count": len(list_compiled_artifacts()),
    })


if __name__ == "__main__":
    main()
