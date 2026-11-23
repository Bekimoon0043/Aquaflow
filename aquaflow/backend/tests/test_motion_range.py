"""Moving nozzles: Python show frame clamps to the fixture's real range, like the JS frame."""
from engine.show_frame import evaluate_show_frame_at, motion_limits


def _show(engineering):
    return {
        "fixtures": [{"id": "m", "type": "motion_nozzle_2d_mdd_l_oase", "engineering": engineering}],
        "clips": [
            {"id": "p", "fixtureId": "m", "type": "motion_pan", "startTime": 0, "duration": 10, "value": 80},
            {"id": "t", "fixtureId": "m", "type": "motion_tilt", "startTime": 0, "duration": 10, "value": -80},
        ],
    }


def test_limits_are_half_the_published_range():
    assert motion_limits({"engineering": {"panRangeDeg": 200, "tiltRangeDeg": 140}}) == {"pan": 90.0, "tilt": 70.0}
    assert motion_limits({}) == {"pan": 45.0, "tilt": 45.0}


def test_mdd_l_reaches_its_range():
    m = evaluate_show_frame_at(_show({"panRangeDeg": 200, "tiltRangeDeg": 140}), 1)["fixtures"]["m"]
    assert m["motion"] == {"pan": 80.0, "tilt": -70.0}


def test_unknown_range_keeps_45():
    m = evaluate_show_frame_at(_show({}), 1)["fixtures"]["m"]
    assert m["motion"] == {"pan": 45.0, "tilt": -45.0}


def test_continuous_3d_roll_uses_exact_degree_mapping():
    project = {
        "fixtures": [{"id": "m", "type": "motion_nozzle_3d_robotic_module", "engineering": {"panRangeDeg": 360}}],
        "clips": [{"id": "r", "fixtureId": "m", "type": "motion_roll", "startTime": 0, "duration": 10,
                   "value": 0, "keys": [0, 0, 10, 100], "motionOffset": 0, "motionScale": 36}],
    }
    assert evaluate_show_frame_at(project, 5)["fixtures"]["m"]["motion"]["roll"] == 1800
    assert evaluate_show_frame_at(project, 2.5)["fixtures"]["m"]["motion"]["roll"] == 900
