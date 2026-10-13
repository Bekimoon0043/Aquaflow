"""AF-NEXT-004/005: backend mirror of the canonical show frame and Siemens parity.

Reuses the frontend golden files so the timeline, 3D preview and PLC are checked
against one show:
  frontend/src/show/__tests__/golden/golden-show.json   (hand-derived expectations)
  frontend/src/show/__tests__/golden/frame-trace.json   (JS evaluator trace)
No hardware is touched: sites are simulated and only frames are encoded.
"""
import copy
import hashlib
import json
import random
import struct
from pathlib import Path

import pytest

from engine.show_frame import (SHOW_FRAME_VERSION, evaluate_show_frame, evaluate_show_frame_at, light_bytes,
                               show_diagnostics, beats_to_seconds, prepare_show)
from engine.siemens_contract import LIGHT_COMMAND_OFFSET, PUMP_COMMAND_OFFSET
from engine.siemens_site import (compile_show, create_site, evaluate_site_frame, frame_at, validate_site)
from engine.siemens_devices import translate_show

GOLDEN_DIR = Path(__file__).resolve().parents[2] / "frontend" / "src" / "show" / "__tests__" / "golden"
GOLDEN = json.loads((GOLDEN_DIR / "golden-show.json").read_text(encoding="utf-8"))
CURVES = json.loads((GOLDEN_DIR / "curves-show.json").read_text(encoding="utf-8"))
TRACE = json.loads((GOLDEN_DIR / "frame-trace.json").read_text(encoding="utf-8"))
LEVEL = GOLDEN["tolerance"]["level"]
PROJECT = {"fixtures": GOLDEN["fixtures"], "clips": GOLDEN["clips"]}


def golden_site():
    """A simulated Siemens site whose channel ids are the golden fixture ids."""
    site = create_site(name="Golden show", pumps=1, valves=1, lights=2)
    by_kind = {}
    for channel in site["channels"]:
        by_kind.setdefault(channel["kind"], []).append(channel)
    for fid, spec in GOLDEN["siemens"].items():
        channel = by_kind[spec["kind"]][spec["index"]]
        channel["id"] = fid
        if "max_percent" in spec:
            channel["max_percent"] = spec["max_percent"]
    for fid, spec in GOLDEN["siemens"].items():
        if "pump_id" in spec:
            next(c for c in site["channels"] if c["id"] == fid)["pump_id"] = spec["pump_id"]
    return validate_site(site)


def siemens_clips():
    mapped = set(GOLDEN["siemens"])
    return [c for c in GOLDEN["clips"] if c["fixtureId"] in mapped]


def test_contract_version_matches_frontend():
    js = (GOLDEN_DIR.parent.parent / "evaluateShowFrame.js").read_text(encoding="utf-8")
    assert f'SHOW_FRAME_VERSION = "{SHOW_FRAME_VERSION}"' in js


@pytest.mark.parametrize("checkpoint", GOLDEN["checkpoints"], ids=lambda c: c["name"])
def test_mirror_matches_golden_expectations(checkpoint):
    frame = evaluate_show_frame(PROJECT, checkpoint["timeMs"], checkpoint["opts"])
    expect = checkpoint["expect"]
    assert frame["state"] == expect["state"]
    if "passIndex" in expect:
        assert frame["passIndex"] == expect["passIndex"]
    for fid, level in expect["levels"].items():
        assert abs(frame["fixtures"][fid]["level"] - level) <= LEVEL + 1e-12, fid
    for fid, speed in expect["pumps"].items():
        assert abs(frame["pumps"][fid]["speed"] - speed) <= LEVEL + 1e-12
    for fid, is_open in expect["valves"].items():
        assert frame["valves"][fid]["open"] is is_open
    for fid, rgb in expect["lights"].items():
        assert all(abs(a - b) <= 1 for a, b in zip(light_bytes(frame["fixtures"][fid]), rgb)), fid
    for fid, clip_id in expect.get("source", {}).items():
        assert frame["fixtures"][fid]["source"]["clipId"] == clip_id
    for code in expect.get("diagnostics", []):
        assert code in [d["code"] for d in frame["diagnostics"]]


@pytest.mark.parametrize("checkpoint", GOLDEN["checkpoints"], ids=lambda c: c["name"])
def test_siemens_frame_at_matches_golden(checkpoint):
    """The PLC command bank carries the same pump, valve and light colour as every view."""
    site = golden_site()
    show = compile_show(site, siemens_clips())
    opts = checkpoint["opts"]
    payload, values = frame_at(site, show, checkpoint["timeMs"] / 1000,
                               loop=bool(opts.get("loop")), blackout=bool(opts.get("blackout")))
    expect = checkpoint["expect"]
    pump = next(c for c in site["channels"] if c["id"] == "P1")
    word = struct.unpack_from(">H", payload, PUMP_COMMAND_OFFSET - PUMP_COMMAND_OFFSET + pump["index"] * 2)[0]
    assert abs(values["P1"] - expect["pumps"]["P1"] * 100) <= 100 * LEVEL + 1e-9
    assert abs(word - expect["pumps"]["P1"] * 27648) <= 27648 * LEVEL
    assert (values["V1"] == 100) is expect["valves"]["V1"]
    for fid, rgb in expect["lights"].items():
        index = next(c for c in site["channels"] if c["id"] == fid)["index"]
        start = LIGHT_COMMAND_OFFSET - PUMP_COMMAND_OFFSET + index * 3
        assert all(abs(a - b) <= 1 for a, b in zip(payload[start:start + 3], rgb)), (fid, list(payload[start:start + 3]))


def test_programmed_light_colour_reaches_the_rgb_outputs():
    """Regression: a coloured lighting_master clip used to go out black."""
    site = golden_site()
    show = compile_show(site, siemens_clips())
    assert next(c for c in show["clips"] if c["fixtureId"] == "L1")["color"] == "#ff8000"
    payload, values = frame_at(site, show, 4.0)
    start = LIGHT_COMMAND_OFFSET - PUMP_COMMAND_OFFSET
    assert list(payload[start:start + 3]) == [204, 102, 0]
    assert values["L1"] == {"master": pytest.approx(80.0), "red": 204, "green": 102, "blue": 0}


def test_translate_show_keeps_light_colour():
    site = golden_site()
    clips, _ = translate_show(site, [dict(c, color="#FF8000") if c["id"] == "c5" else c for c in siemens_clips()])
    light = next(c for c in clips if c["fixtureId"] == "L1")
    assert light["color"] == "#ff8000"


def test_overlaps_surface_as_diagnostics_and_are_still_rejected_by_siemens():
    overlap = [d for d in show_diagnostics(PROJECT) if d["code"] == "overlap"]
    assert len(overlap) == 1 and overlap[0]["clipIds"] == ["c3", "c4"]
    site = golden_site()
    clip = next(c for c in siemens_clips() if c["id"] == "c5")
    with pytest.raises(ValueError, match="Overlapping"):
        compile_show(site, [clip, dict(clip, id="dup", startTime=1, duration=2)])


def test_mirror_reproduces_the_javascript_frame_trace():
    projects = {"golden": PROJECT, "curves": CURVES}
    prepared = {name: prepare_show(p) for name, p in projects.items()}
    assert len(TRACE["samples"]) > 300
    for sample in TRACE["samples"]:
        project = projects[sample["project"]]
        frame = evaluate_show_frame_at(project, sample["timeMs"] / 1000, sample["opts"], prepared=prepared[sample["project"]])
        label = (sample["project"], sample["timeMs"], json.dumps(sample["opts"]))
        assert frame["state"] == sample["state"], label
        assert frame["passIndex"] == sample["passIndex"], label
        for fid, level in sample["levels"].items():
            assert abs(frame["fixtures"][fid]["level"] - level) <= 1e-12, (label, fid)
        for fid, rgb in sample["bytes"].items():
            assert light_bytes(frame["fixtures"][fid]) == rgb, (label, fid)
        for fid, clip_id in sample["sources"].items():
            assert (frame["fixtures"][fid]["source"] or {}).get("clipId") == clip_id, (label, fid)
        assert {k: v["open"] for k, v in frame["valves"].items()} == {k: v["open"] for k, v in sample["valves"].items()}
        for fid, pump in sample["pumps"].items():
            assert abs(frame["pumps"][fid]["speed"] - pump["speed"]) <= 1e-12


def test_tempo_map_matches_frontend():
    assert beats_to_seconds(CURVES["tempo"], 8) == pytest.approx(4)
    assert beats_to_seconds(CURVES["tempo"], 16) == pytest.approx(12)
    assert evaluate_show_frame_at(CURVES, 4.5)["fixtures"]["W6"]["level"] == pytest.approx(0.35)


def _generated_show(seed=20261013, seconds=300):
    rng = random.Random(seed)
    fixtures = ([{"id": f"N{i:03d}", "kind": "water"} for i in range(200)] +
                [{"id": f"L{i:03d}", "kind": "light"} for i in range(80)] +
                [{"id": f"P{i:03d}", "kind": "pump"} for i in range(10)] +
                [{"id": f"V{i:03d}", "kind": "valve"} for i in range(10)])
    curves = ["linear", "ease-in", "ease-out", "ease-in-out", "step"]
    clips = []
    for fixture in fixtures:
        t = round(rng.random() * 4, 3)
        while t < seconds - 1:
            duration = round(min(seconds - t, 1 + rng.random() * 11), 3)
            kind = fixture["kind"]
            channel = {"light": rng.choice(["lighting_master", "lighting_master", "lighting_red", "lighting_blue"]),
                       "pump": "pump_speed", "valve": "solenoid_open"}.get(kind, "device_intensity")
            fades = kind != "valve"
            clips.append({"id": f"g{len(clips)}", "fixtureId": fixture["id"], "type": channel, "startTime": t,
                          "duration": duration, "value": 100 if kind == "valve" else rng.randint(0, 100),
                          "fadeIn": round(rng.random() * duration / 2, 3) if fades else 0,
                          "fadeOut": round(rng.random() * duration / 2, 3) if fades else 0,
                          "curveType": rng.choice(curves) if fades else "linear",
                          "color": f"#{rng.randrange(0x1000000):06x}"})
            t = round(t + duration + (-duration / 2 if rng.random() < 0.06 else rng.random() * 3), 3)
    return {"fixtures": fixtures, "clips": clips, "duration": seconds}


def _hash(frame):
    body = {k: frame[k] for k in ("state", "fixtures", "pumps", "valves")}
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def test_deterministic_replay_of_a_five_minute_300_fixture_show():
    show = _generated_show()
    assert len(show["fixtures"]) == 300 and len(show["clips"]) > 5000
    prepared = prepare_show(show)
    rng = random.Random(7)
    times = [rng.randrange(300000) / 1000 for _ in range(200)]
    first = [_hash(evaluate_show_frame_at(show, t, prepared=prepared)) for t in times]
    again = [_hash(evaluate_show_frame_at(show, t, prepared=prepared)) for t in reversed(times)][::-1]
    fresh = copy.deepcopy(show)
    rebuilt = [_hash(evaluate_show_frame_at(fresh, t)) for t in times[:20]]
    assert again == first
    assert rebuilt == first[:20]
    assert len(set(first)) > 150


def test_siemens_site_frame_uses_the_canonical_evaluator():
    site = golden_site()
    show = compile_show(site, siemens_clips())
    frame = evaluate_site_frame(site, show, 2.0)
    assert frame["version"] == SHOW_FRAME_VERSION
    assert frame["fixtures"]["L2"]["color"]["source"] == "channels"
    assert frame_at(site, show, 2.0)[0] == frame_at(site, show, 2.0)[0]


def test_show_engine_timeline_uses_canonical_fades_and_highest_takes_precedence():
    from engine.show_engine import ShowEngine
    engine = ShowEngine.__new__(ShowEngine)
    engine.timeline_tracks = [
        {"id": "a", "deviceId": "J1", "type": "pump", "clips": [{"id": "x", "start": 0, "end": 4, "intensity": 100, "fadeIn": 2}]},
        {"id": "b", "deviceId": "J1", "type": "pump", "clips": [{"id": "y", "start": 0, "end": 4, "intensity": 30}]},
    ]
    commands = engine._evaluate_timeline(0.5)  # x is at 0.25 (fading in), y holds 0.3
    assert len(commands) == 1 and commands[0]["clip_id"] == "y" and commands[0]["intensity"] == pytest.approx(0.3)
    commands = engine._evaluate_timeline(3.0)
    assert len(commands) == 1 and commands[0]["clip_id"] == "x" and commands[0]["intensity"] == pytest.approx(1.0)
