import pytest

from aquaflow_studio.animation import build_animation, clip_level, evaluate_fixture
from aquaflow_studio.core import normalize_project


def project():
    return normalize_project({
        "show": {"duration": 4},
        "engineering": {
            "params": {"width": 4, "length": 4},
            "fixtures": [
                {"id": "jet", "type": "nozzle_straight_dn25", "x": 1, "y": 1, "groupId": "jets", "engineering": {"jetHeightM": 2}},
                {"id": "light", "type": "light_uw_rgbw_36w", "x": 2, "y": 2, "color": "#0080ff", "engineering": {"lumens": 3000}},
            ],
        },
        "timelineTracks": [{"type": "jets", "clips": [
            {"start": 0, "end": 1, "intensity": 62},
            {"start": 1, "end": 2, "intensity": 92},
        ]}],
        "clips": [
            {"fixtureId": "light", "type": "lighting_master", "startTime": 0, "duration": 4, "value": 50, "color": "#0080ff"},
            {"fixtureId": "light", "type": "lighting_white", "startTime": 0, "duration": 4, "value": 60},
        ],
    })


def test_legacy_clips_are_half_open_and_keyed_at_boundaries():
    data = project()
    animation = build_animation(data)
    levels = {round(key["time"], 3): key["level"] for key in animation["jet"]}
    assert levels[0.5] == pytest.approx(0.62)
    assert levels[1.0] == pytest.approx(0.92)
    assert levels[2.0] == 0.0


def test_independent_white_channel_changes_energy_not_show_level():
    data = project()
    frame = evaluate_fixture(data, data["fixtures"][1], 1.0)
    assert frame["level"] == pytest.approx(0.5)
    assert frame["energy_factor"] == pytest.approx(0.8)
    assert frame["color"][2] == 1.0


def test_fades_and_keyframes_are_sampled():
    clip = {"startTime": 1, "duration": 2, "value": 100, "fadeIn": 1, "curveType": "ease-in"}
    assert clip_level(clip, 0.999) == 0.0
    assert clip_level(clip, 1.5) == pytest.approx(0.25)
    keyed = {"start": 0, "end": 2, "keys": [0, 0, 1, 100, 2, 20]}
    assert clip_level(keyed, 0.5) == pytest.approx(0.5)
    assert clip_level(keyed, 2.0) == 0.0
