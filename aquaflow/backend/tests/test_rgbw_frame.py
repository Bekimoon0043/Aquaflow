import pytest

from engine.show_frame import evaluate_show_frame_at


def project():
    return {
        "fixtures": [{"id": "l", "type": "light_uw_rgbw_72w"}],
        "clips": [
            {"id": "master", "fixtureId": "l", "type": "lighting_master", "startTime": 0, "duration": 2, "value": 50, "color": "#0080ff"},
            {"id": "white", "fixtureId": "l", "type": "lighting_white", "startTime": 0, "duration": 2, "value": 60},
        ],
    }


def test_white_channel_is_independent():
    record = evaluate_show_frame_at(project(), 1.0)["fixtures"]["l"]
    assert record["level"] == 0.5
    assert record["output"]["w"] == pytest.approx(0.3)
    assert record["output"]["b"] == 0.5


def test_white_only_and_legacy_shape():
    data = project()
    data["clips"] = data["clips"][1:]
    assert evaluate_show_frame_at(data, 1.0)["fixtures"]["l"]["output"]["w"] == 0.6
    data = project()
    data["clips"] = data["clips"][:1]
    assert "w" not in evaluate_show_frame_at(data, 1.0)["fixtures"]["l"]["output"]
