"""
Contract tests for Cue Stack management and Scene Recall (AQ-X-004).

Asserts the three acceptance criteria:
  1. a cue stack saves and recalls scenes correctly (exact recall + persistence),
  2. scene transitions are smooth (monotonic crossfade, exact endpoints/midpoint),
  3. multiple cue stacks are supported and run independently.
"""
from services.cue_engine import (
    CueStack, CueStackManager, Scene, make_scene, crossfade, ease,
    scene_values_from_commands, get_cue_manager,
)


def _approx(a, b, tol=1e-9):
    return abs(a - b) <= tol


# ── 1. save + recall ──────────────────────────────────────────────────────────

def test_recall_lands_exactly_on_scene():
    stack = CueStack("s1", "Main")
    stack.add_cue(make_scene("A", {"jet": 0.8, "rgb": 0.4}), number=1, fade_in=2.0)
    stack.add_cue(make_scene("B", {"jet": 0.3, "rgb": 1.0}), number=2, fade_in=2.0)
    stack.go_to(2, now=0.0)
    # mid-fade the output is between the looks, not yet the target
    partial = stack.output_at(now=1.0)
    assert 0.0 < partial["jet"] < 0.8
    # fade complete → exact recall
    assert stack.recalled_values(now=2.0) == {"jet": 0.3, "rgb": 1.0}
    assert stack.current_cue().number == 2


def test_instant_fade_recalls_immediately():
    stack = CueStack("s", "S")
    stack.add_cue(make_scene("A", {"d": 1.0}), number=1, fade_in=0.0)
    stack.go(now=5.0)
    assert stack.recalled_values(now=5.0) == {"d": 1.0}   # zero fade → instant


def test_cue_stack_round_trips():
    stack = CueStack("s1", "Main")
    stack.add_cue(make_scene("A", {"jet": 0.8}), number=1, fade_in=2.5, notes="opener")
    stack.add_cue(make_scene("B", {"jet": 0.3, "rgb": 1.0}), number=2, fade_in=1.0)
    restored = CueStack.from_dict(stack.to_dict())
    assert restored.cue_numbers() == [1, 2]
    assert restored.cues[1].scene.values == {"jet": 0.3, "rgb": 1.0}
    assert restored.cues[0].fade_in == 2.5
    assert restored.cues[0].notes == "opener"


def test_cues_stay_sorted_by_number():
    stack = CueStack("s", "S")
    stack.add_cue(make_scene("c", {}), number=3)
    stack.add_cue(make_scene("a", {}), number=1)
    stack.add_cue(make_scene("b", {}), number=2)
    assert stack.cue_numbers() == [1, 2, 3]


def test_remove_cue_keeps_playhead_stable():
    stack = CueStack("s", "S")
    stack.add_cue(make_scene("a", {"x": 1.0}), number=1)
    keep = stack.add_cue(make_scene("b", {"x": 0.5}), number=2)
    stack.add_cue(make_scene("c", {"x": 0.2}), number=3)
    stack.go_to(2, now=0.0)
    stack.remove_cue(stack.cues[0].id)          # remove cue 1
    assert stack.current_cue().id == keep.id     # still pointing at cue 2


# ── 2. smooth transitions ─────────────────────────────────────────────────────

def test_crossfade_endpoints_and_midpoint():
    frm, to = {"x": 1.0, "y": 0.0}, {"x": 0.0, "y": 1.0}
    assert crossfade(frm, to, 0.0) == frm
    assert crossfade(frm, to, 1.0) == to
    mid = crossfade(frm, to, 0.5)
    assert _approx(mid["x"], 0.5) and _approx(mid["y"], 0.5)


def test_crossfade_is_monotonic():
    frm, to = {"y": 0.0}, {"y": 1.0}
    ys = [crossfade(frm, to, i / 20.0)["y"] for i in range(21)]
    assert all(ys[i] <= ys[i + 1] + 1e-12 for i in range(len(ys) - 1))
    assert ys[0] == 0.0 and ys[-1] == 1.0


def test_missing_channels_fade_from_and_to_zero():
    # target only in `to` fades up from 0; target only in `from` fades down to 0.
    out = crossfade({"a": 1.0}, {"b": 1.0}, 0.5)
    assert _approx(out["a"], 0.5) and _approx(out["b"], 0.5)


def test_ease_curves_keep_endpoints():
    for curve in ("linear", "smooth", "ease_in", "ease_out"):
        assert ease(0.0, curve) == 0.0
        assert ease(1.0, curve) == 1.0


def test_go_fades_from_blackout_smoothly():
    stack = CueStack("s", "S")
    stack.add_cue(make_scene("full", {"d": 1.0}), number=1, fade_in=2.0)
    stack.go(now=0.0)
    assert _approx(stack.output_at(now=1.0)["d"], 0.5)   # halfway
    assert stack.is_transitioning(now=1.0)
    assert _approx(stack.output_at(now=2.0)["d"], 1.0)   # complete
    assert not stack.is_transitioning(now=2.0)


# ── 3. multiple cue stacks ────────────────────────────────────────────────────

def test_multiple_stacks_are_independent():
    mgr = CueStackManager()
    main = mgr.create("Main", id="main")
    lasers = mgr.create("Lasers", id="lasers")
    main.add_cue(make_scene("m1", {"jet": 0.5}), number=1, fade_in=0.0)
    main.add_cue(make_scene("m2", {"jet": 1.0}), number=2, fade_in=0.0)
    lasers.add_cue(make_scene("l1", {"laser": 0.2}), number=1, fade_in=0.0)
    main.go(now=0.0); main.go(now=0.0)
    lasers.go(now=0.0)
    assert set(mgr.list_stacks()) == {"main", "lasers"}
    assert main.current_cue().number == 2
    assert lasers.current_cue().number == 1        # unaffected by Main's GOs
    assert main.recalled_values(now=1.0) == {"jet": 1.0}
    assert lasers.recalled_values(now=1.0) == {"laser": 0.2}


def test_manager_round_trips_all_stacks():
    mgr = CueStackManager()
    mgr.create("A", id="a").add_cue(make_scene("s", {"x": 1.0}), number=1)
    mgr.create("B", id="b").add_cue(make_scene("s", {"y": 0.5}), number=1)
    restored = CueStackManager()
    restored.load_dict(mgr.to_dict())
    assert set(restored.list_stacks()) == {"a", "b"}
    assert restored.get("a").cues[0].scene.values == {"x": 1.0}


def test_manager_delete_and_singleton():
    mgr = CueStackManager()
    mgr.create("tmp", id="tmp")
    assert mgr.delete("tmp") is True
    assert mgr.delete("tmp") is False
    assert get_cue_manager() is get_cue_manager()


# ── capture ───────────────────────────────────────────────────────────────────

def test_scene_captured_from_commands():
    vals = scene_values_from_commands([
        {"device_id": "jet-1", "intensity": 0.8},
        {"device_id": "rgb-1", "intensity": 1.5},   # clamped to 1.0
    ])
    assert vals == {"jet-1": 0.8, "rgb-1": 1.0}
