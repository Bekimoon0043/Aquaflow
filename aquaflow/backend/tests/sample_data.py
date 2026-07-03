"""Shared sample show payloads for the AquaFlow backend test suite (AQ-S1-009)."""


def sample_aqua_show() -> dict:
    """A minimal but complete AquaFlow show payload used across contract tests."""
    return {
        "aquaflow": "0.1.0",
        "savedAt": "2026-07-03T00:00:00Z",
        "show": {
            "id": "show-smoke",
            "name": "Smoke Test Show",
            "bpm": 120,
            "duration": 4,
            "sampleRate": 48000,
            "loop": False,
        },
        "nodes": [
            {
                "id": "node-pump",
                "type": "pump",
                "label": "Master Pump",
                "x": 100, "y": 100, "width": 180, "height": 80,
                "ports": {"in": ["trigger"], "out": ["flow"]},
                "params": {"speed": 75},
            }
        ],
        "connections": [],
        "devices": [],
        "timelineTracks": [
            {
                "id": "track-pump",
                "type": "pump",
                "deviceId": "pump-1",
                "clips": [
                    {"id": "clip-1", "start": 0.0, "end": 3.0, "intensity": 80},
                ],
            }
        ],
    }
