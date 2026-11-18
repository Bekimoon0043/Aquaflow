import pytest

from aquaflow_studio.animation import build_animation
from aquaflow_studio.core import normalize_project
from aquaflow_studio.dynamics import apply_hydraulic_response


def hydraulic_project(pipe_length=0.0):
    return normalize_project({
        "show": {"duration": 3},
        "engineering": {
            "params": {"width": 8, "length": 8},
            "fixtures": [
                {"id": "pump", "type": "pump_vfd", "x": -3, "y": 0, "engineering": {"rampTimeConstantS": 1.0}},
                {"id": "valve", "type": "valve_solenoid", "x": -2, "y": 0, "engineering": {"responseTimeS": 0.3}},
                {"id": "jet-a", "type": "nozzle_straight_dn25", "x": 0, "y": 0, "groupId": "jets",
                 "engineering": {"flowLpm": 60, "nozzleDiaMm": 15, "pumpId": "pump", "valveId": "valve", "pipeLengthM": pipe_length, "pipeDiameterM": 0.05}},
                {"id": "jet-b", "type": "nozzle_straight_dn25", "x": 1, "y": 0, "groupId": "jets",
                 "engineering": {"flowLpm": 60, "nozzleDiaMm": 15, "pumpId": "pump", "valveId": "valve", "pipeLengthM": pipe_length, "pipeDiameterM": 0.05}},
            ],
        },
        "timelineTracks": [{"type": "jets", "clips": [{"start": 0, "end": 3, "intensity": 100}]}],
        "clips": [
            {"fixtureId": "pump", "type": "pump_speed", "startTime": 0, "duration": 3, "value": 100},
            {"fixtureId": "valve", "type": "solenoid_open", "startTime": 0, "duration": 3, "value": 100},
        ],
        "render": {"exportFps": 30},
    })


def test_pump_ramp_and_valve_stroke_are_shared_and_simultaneous():
    project = hydraulic_project()
    animation, diagnostics = apply_hydraulic_response(project, build_animation(project, 1))
    assert diagnostics["pumps"] == 1 and diagnostics["valves"] == 1
    for time in (0.5, 1.0, 2.0):
        a = next(key for key in animation["jet-a"] if abs(key["time"] - time) < 1e-8)
        b = next(key for key in animation["jet-b"] if abs(key["time"] - time) < 1e-8)
        assert a["level"] == b["level"]
        assert a["pump_speed"] == b["pump_speed"]
    half = next(key for key in animation["jet-a"] if abs(key["time"] - 0.5) < 1e-8)
    late = next(key for key in animation["jet-a"] if abs(key["time"] - 2.0) < 1e-8)
    assert 0 < half["level"] < 0.5
    assert late["level"] > 0.8


def test_pipe_volume_must_fill_before_jet_appears():
    project = hydraulic_project(pipe_length=0.2)
    animation, _ = apply_hydraulic_response(project, build_animation(project, 1))
    early = next(key for key in animation["jet-a"] if abs(key["time"] - 0.5) < 1e-8)
    late = next(key for key in animation["jet-a"] if abs(key["time"] - 2.5) < 1e-8)
    assert early["level"] == 0.0
    assert early["hydraulic_fill"] < 1.0
    assert late["level"] > 0.9
    assert late["hydraulic_fill"] == 1.0


def test_solenoid_valve_alias_controls_linked_nozzle():
    project = hydraulic_project()
    for fixture in project["fixtures"]:
        if fixture["category"] == "water":
            fixture["raw"]["engineering"].pop("valveId")
            fixture["raw"]["engineering"]["solenoidValveId"] = "valve"
    animation, _ = apply_hydraulic_response(project, build_animation(project, 1))
    early = next(key for key in animation["jet-a"] if abs(key["time"] - 0.1) < 1e-8)
    late = next(key for key in animation["jet-a"] if abs(key["time"] - 0.5) < 1e-8)
    assert early["valve_open"] < 0.5
    assert late["valve_open"] == 1.0
