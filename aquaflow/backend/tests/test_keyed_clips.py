"""Keyed clips: one clip per fixture carrying an automation curve (`keys`, `keyMode`).

Mirrors the frontend evaluateShowFrame.js keyed-clip contract and checks the
expand_keyed_clips() flattening used by the compilers that read `value` directly.
"""
import math
import random

import pytest

from engine.show_frame import (FRAME_TOLERANCE, evaluate_show_frame_at, expand_keyed_clips, prepare_show,
                               show_diagnostics)
from engine.siemens_site import compile_show, create_site
from services.preflight import run_preflight


def level(clip, t, fixtures=None):
    project = {"fixtures": fixtures or [{"id": "W1", "type": "nozzle_jet"}], "clips": [clip]}
    return evaluate_show_frame_at(project, t)["fixtures"]["W1"]["level"]


def keyed(**extra):
    clip = {"id": "k", "fixtureId": "W1", "type": "device_intensity", "startTime": 2, "duration": 4,
            "value": 100, "keys": [1, 0, 3, 100]}
    clip.update(extra)
    return clip


def test_keyed_linear_interpolates():
    clip = keyed()
    assert level(clip, 3.0) == pytest.approx(0.0)
    assert level(clip, 4.0) == pytest.approx(0.5)
    assert level(clip, 4.5) == pytest.approx(0.75)
    assert level(clip, 4.999) == pytest.approx(0.9995)


def test_keyed_step_holds_previous_key():
    clip = keyed(keys=[0, 20, 1, 80, 2.5, 40], keyMode="step")
    assert level(clip, 2.0) == pytest.approx(0.2)
    assert level(clip, 2.99) == pytest.approx(0.2)
    assert level(clip, 3.0) == pytest.approx(0.8)
    assert level(clip, 4.49) == pytest.approx(0.8)
    assert level(clip, 4.5) == pytest.approx(0.4)
    assert level(clip, 5.99) == pytest.approx(0.4)


def test_before_first_and_after_last_key_hold_and_window_is_half_open():
    clip = keyed(keys=[1, 30, 3, 60])
    assert level(clip, 2.0) == pytest.approx(0.3)     # u=0 < t0
    assert level(clip, 2.5) == pytest.approx(0.3)
    assert level(clip, 5.5) == pytest.approx(0.6)     # u > t_last
    assert level(clip, 6.0) == 0                      # end is exclusive
    assert level(clip, 1.99) == 0


def test_single_key_is_constant():
    assert level(keyed(keys=[0, 42]), 3.3) == pytest.approx(0.42)


def test_many_keys_binary_search():
    keys = [v for i in range(400) for v in (i * 0.01, (i * 7) % 101)]
    clip = keyed(keys=keys)
    for i in range(399):
        u = i * 0.01 + 0.005
        expected = ((i * 7) % 101 + ((i + 1) * 7 % 101)) / 2 / 100
        assert level(clip, 2 + u) == pytest.approx(expected, abs=1e-9)


@pytest.mark.parametrize("bad", [
    [0, 50, 1],                # odd length
    [0],                       # < 2 numbers
    [],                        # empty
    [0, 50, float("nan"), 60],  # non-finite
    [-0.5, 50, 1, 60],         # negative time
    [0, 50, 1, 60, 1, 70],     # not strictly increasing
    [1, 50, 0.5, 60],          # decreasing
    [0, 50, 1, 101],           # value > 100
    [0, -1, 1, 50],            # value < 0
    [0, True, 1, 50],          # not a number
    "0,50,1,60",               # not an array
])
def test_invalid_keys_fall_back_to_value_with_diagnostic(bad):
    clip = keyed(keys=bad, value=70)
    assert level(clip, 4.0) == pytest.approx(0.7)
    diags = [d for d in show_diagnostics({"clips": [clip]}) if d["code"] == "invalid-keys"]
    assert len(diags) == 1
    assert diags[0]["severity"] == "warning" and diags[0]["clipId"] == "k" and diags[0]["message"]


def test_valid_keys_produce_no_diagnostic_and_keep_value():
    clip = keyed()
    prepared = prepare_show({"clips": [clip]})
    assert not prepared["diagnostics"]
    assert prepared["clips"][0]["value"] == 100


def test_fade_applies_on_top_of_keys():
    clip = keyed(keys=[0, 80, 4, 80], fadeIn=1, fadeOut=2, curveType="linear")
    assert level(clip, 2.5) == pytest.approx(0.8 * 0.5)
    assert level(clip, 4.0) == pytest.approx(0.8)
    assert level(clip, 5.0) == pytest.approx(0.8 * 0.5)
    eased = keyed(keys=[0, 0, 4, 100], fadeIn=2, curveType="ease-in")
    assert level(eased, 3.0) == pytest.approx(0.25 * 0.25)   # key 25 x ease-in(0.5)


# ─── expand_keyed_clips ──────────────────────────────────────────────────

def _check_expansion(clip, step=0.25):
    pieces = expand_keyed_clips([clip], step)
    start = clip["startTime"]
    end = start + clip["duration"]
    assert pieces[0]["startTime"] == pytest.approx(start, abs=1e-12)
    for a, b in zip(pieces, pieces[1:]):
        assert a["startTime"] + a["duration"] == pytest.approx(b["startTime"], abs=1e-9)   # no gap/overlap
    assert pieces[-1]["startTime"] + pieces[-1]["duration"] == pytest.approx(end, abs=1e-9)
    assert len({p["id"] for p in pieces}) == len(pieces)
    for p in pieces:
        assert "keys" not in p and "keyMode" not in p
        assert p["keyedFrom"] == clip["id"] and p["id"].startswith(clip["id"] + "~")
        assert p["fadeIn"] == 0 and p["fadeOut"] == 0 and 0 <= p["value"] <= 100
        assert p["fixtureId"] == clip["fixtureId"] and p["type"] == clip["type"]
        mid = p["startTime"] + p["duration"] / 2
        # the documented sample point (piece midpoint) matches the evaluator
        assert p["value"] / 100 == pytest.approx(level(clip, mid), abs=FRAME_TOLERANCE)
        flat = level({k: v for k, v in p.items()}, mid)
        assert flat == pytest.approx(level(clip, mid), abs=FRAME_TOLERANCE)
    return pieces


def test_expand_step_cuts_at_key_times():
    clip = keyed(keys=[0, 20, 1, 80, 2.5, 40], keyMode="step", color="#ff0000")
    pieces = _check_expansion(clip)
    assert [(p["startTime"], p["duration"], p["value"]) for p in pieces] == [
        (2, 1, 20), (3, 1.5, 80), (4.5, 1.5, 40)]
    assert all(p["color"] == "#ff0000" for p in pieces)
    assert [p["id"] for p in pieces] == ["k~0", "k~1", "k~2"]


def test_expand_linear_samples_midpoints_and_holds_outside_keys():
    pieces = _check_expansion(keyed())   # constant 0 on [2,3), ramp [3,5), constant 100 on [5,6)
    assert pieces[0]["startTime"] == 2 and pieces[0]["duration"] == pytest.approx(1) and pieces[0]["value"] == 0
    assert pieces[-1]["value"] == 100 and pieces[-1]["duration"] == pytest.approx(1)
    assert len(pieces) == 10
    assert pieces[1]["value"] == pytest.approx(6.25)


def test_expand_bakes_fades_and_merges_equal_pieces():
    clip = keyed(keys=[0, 60], fadeIn=0.5, fadeOut=1, curveType="ease-out")
    pieces = _check_expansion(clip)
    assert all(p["curveType"] == "linear" for p in pieces)
    assert any(p["value"] == 60 for p in pieces) and len(pieces) == 2 + 1 + 4


def test_expand_random_shows_cover_exactly():
    rng = random.Random(7)
    for n in range(60):
        duration = rng.uniform(0.5, 20)
        times = sorted({round(rng.uniform(0, duration), 3) for _ in range(rng.randint(1, 30))})
        keys = [v for t in times for v in (t, rng.uniform(0, 100))]
        clip = {"id": f"r{n}", "fixtureId": "W1", "type": "device_intensity",
                "startTime": rng.uniform(0, 30), "duration": duration, "value": 100, "keys": keys,
                "keyMode": rng.choice(["linear", "step"]),
                "fadeIn": rng.choice([0, 0, 0.3, 1]), "fadeOut": rng.choice([0, 0, 0.7]),
                "curveType": rng.choice(["linear", "ease-in", "step"])}
        pieces = _check_expansion(clip, step=rng.choice([0.1, 0.25, 0.5]))
        if clip["keyMode"] == "step" and not clip["fadeIn"] and not clip["fadeOut"]:
            for p in pieces:   # step pieces are exact everywhere, not just at the midpoint
                for f in (0.001, 0.999):
                    t = p["startTime"] + p["duration"] * f
                    assert p["value"] / 100 == pytest.approx(level(clip, t), abs=1e-6)


def test_expand_passes_through_unkeyed_muted_and_invalid():
    plain = {"id": "p", "fixtureId": "W1", "startTime": 0, "duration": 1, "value": 50}
    muted = keyed(id="m", muted=True)
    invalid = keyed(id="i", keys=[0, 500])
    out = expand_keyed_clips([plain, muted, invalid])
    assert out[0] is plain and out[1] is muted and out[2] is invalid


def test_expand_supports_start_end_and_beat_timing():
    out = expand_keyed_clips([{"id": "e", "fixtureId": "W1", "start": 1, "end": 3, "keys": [0, 0, 1, 100],
                               "keyMode": "step"}])
    assert [(p["startTime"], p["duration"], p["value"]) for p in out] == [(1, 1, 0), (2, 1, 100)]
    assert "start" not in out[0] and "end" not in out[0]
    beat = expand_keyed_clips([{"id": "b", "fixtureId": "W1", "startBeat": 4, "durationBeats": 4,
                                "keys": [0, 10, 1, 90], "keyMode": "step"}], tempo=[{"time": 0, "bpm": 120}])
    assert [(p["startTime"], p["duration"], p["value"]) for p in beat] == [(2, 1, 10), (3, 1, 90)]


# ─── compilers ───────────────────────────────────────────────────────────

def test_preflight_sees_keyed_values_and_points_fixes_at_the_keyed_clip():
    fixtures = [{"id": "W1", "type": "nozzle_jet", "maxPercent": 50}]
    under = keyed(value=100, keys=[0, 10, 1, 30], keyMode="step")
    result = run_preflight({"fixtures": fixtures, "clips": [under]}, {"kind": "preview"})
    assert not [i for i in result["issues"] if i["code"] == "output-limit"]
    over = keyed(value=40, keys=[0, 10, 1, 90], keyMode="step")
    result = run_preflight({"fixtures": fixtures, "clips": [over]}, {"kind": "preview"})
    limits = [i for i in result["issues"] if i["code"] == "output-limit"]
    assert len(limits) == 1 and limits[0]["clipId"] == "k~1" and limits[0]["timeMs"] == 3000
    assert "k" in str(limits[0]["fix"]) and "k~" not in str(limits[0]["fix"])


def test_siemens_compile_show_flattens_keyed_pump_clip():
    site = create_site(name="Keyed", pumps=1, valves=1, lights=1)
    pump = next(c for c in site["channels"] if c["kind"] == "pump")
    clip = {"id": "kp", "fixtureId": pump["id"], "type": "pump_speed", "startTime": 0, "duration": 4,
            "value": 30, "keys": [0, 10, 2, 30], "keyMode": "step", "fadeIn": 0, "fadeOut": 0}
    show = compile_show(site, [clip])
    assert [(c["id"], c["startTime"], c["duration"], c["value"]) for c in show["clips"]] == [
        ("kp~0", 0, 2, 10), ("kp~1", 2, 2, 30)]
    assert all("keys" not in c for c in show["clips"])
