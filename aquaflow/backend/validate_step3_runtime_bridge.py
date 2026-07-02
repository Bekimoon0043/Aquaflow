"""Validate Step 3 runtime bridge endpoints and service helpers."""
from __future__ import annotations

from app_state import show_engine
from services.compiler_bridge import (
    build_canonical_package,
    build_compile_report,
    build_deploy_request,
    build_deployment_bundle,
    build_runtime_session,
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
    canonical = build_canonical_package(snapshot)
    session = build_runtime_session(snapshot, mode="simulation")
    bundle = build_deployment_bundle(snapshot)
    report = build_compile_report(snapshot, mode="live")
    deploy = build_deploy_request(snapshot, mode="live")

    assert canonical["compile"]["validated"] is True
    assert len(session.commands) == 1
    assert bundle["runtime_target"] == "industrial_pc"
    assert report["summary"]["clip_count"] == 1
    assert deploy.mode.value == "live"

    # Smoke-check current engine snapshot path remains accessible.
    engine_state = show_engine.get_state()
    assert "state" in engine_state

    print("Step 3 validation OK")
    print({
        "engine_state": engine_state,
        "bundle_id": bundle["bundle_id"],
        "compile_signature": canonical["compile"]["signature"],
        "command_count": len(session.commands),
    })


if __name__ == "__main__":
    main()
