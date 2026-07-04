"""
validate_cue_engine.py — AQ-X-004 verification

Hand-checked scenarios for cue stack management and scene recall:
  1. a cue stack saves and recalls scenes correctly (recall lands exactly on the
     scene, and the stack round-trips through persistence),
  2. scene transitions are smooth (monotonic crossfade with exact endpoints/midpoint),
  3. multiple cue stacks run independently.

Run:  python backend/validate_cue_engine.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.cue_engine import (
    CueStack, CueStackManager, Scene, make_scene, crossfade, ease,
    scene_values_from_commands,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def approx(a, b, tol=1e-9):
    return abs(a - b) <= tol


print("== 1. cue stack saves and recalls correctly ==")
stack = CueStack(id="s1", name="Main")
a = stack.add_cue(make_scene("Warm Wash", {"jet-1": 0.8, "rgb-1": 0.4}), number=1, fade_in=2.0)
b = stack.add_cue(make_scene("Cool Peak", {"jet-1": 0.3, "rgb-1": 1.0}), number=2, fade_in=2.0)
c = stack.add_cue(make_scene("Blackout Edge", {"jet-1": 0.1}), number=3, fade_in=1.0)
check("three cues added, sorted by number", stack.cue_numbers() == [1, 2, 3])

# Recall cue 2 and let the fade complete → output must equal scene B exactly.
stack.go_to(2, now=0.0)
mid = stack.output_at(now=1.0)          # halfway through the 2s fade
done = stack.recalled_values(now=2.0)   # fade complete
check("recall lands exactly on scene B", done == {"jet-1": 0.3, "rgb-1": 1.0}, str(done))
check("current cue is #2", stack.current_cue().number == 2)

# Persistence round-trip.
restored = CueStack.from_dict(stack.to_dict())
check("round-trip preserves cue numbers", restored.cue_numbers() == [1, 2, 3])
check("round-trip preserves scene values",
      restored.cues[1].scene.values == {"jet-1": 0.3, "rgb-1": 1.0})
check("round-trip preserves fade times",
      [cu.fade_in for cu in restored.cues] == [2.0, 2.0, 1.0])

print("== 2. scene transitions are smooth ==")
frm = {"x": 1.0, "y": 0.0}
to = {"x": 0.0, "y": 1.0}
t0 = crossfade(frm, to, 0.0)
tmid = crossfade(frm, to, 0.5)
t1 = crossfade(frm, to, 1.0)
check("progress 0 == from", t0 == frm, str(t0))
check("progress 1 == to", t1 == to, str(t1))
check("progress 0.5 is the midpoint", approx(tmid["x"], 0.5) and approx(tmid["y"], 0.5), str(tmid))
# Monotonic across a fine sweep.
xs = [crossfade(frm, to, i / 20.0)["y"] for i in range(21)]
check("channel rises monotonically", all(xs[i] <= xs[i + 1] + 1e-12 for i in range(len(xs) - 1)))
check("smoothstep keeps exact endpoints", ease(0, "smooth") == 0 and ease(1, "smooth") == 1)
check("smoothstep midpoint is 0.5", approx(ease(0.5, "smooth"), 0.5))

# Smooth fade inside a real stack GO (from blackout to cue A over 2s).
st = CueStack(id="s2", name="Fade")
st.add_cue(make_scene("Full", {"d1": 1.0}), number=1, fade_in=2.0)
st.go(now=0.0)
half = st.output_at(now=1.0)["d1"]
full = st.output_at(now=2.0)["d1"]
check("GO fades 0 → full smoothly", approx(half, 0.5) and approx(full, 1.0), f"half={half}, full={full}")

print("== 3. multiple cue stacks run independently ==")
mgr = CueStackManager()
main = mgr.create("Main Fountains", id="main")
lasers = mgr.create("Laser Rig", id="lasers")
main.add_cue(make_scene("M1", {"jet": 0.5}), number=1, fade_in=0.0)
main.add_cue(make_scene("M2", {"jet": 1.0}), number=2, fade_in=0.0)
lasers.add_cue(make_scene("L1", {"laser": 0.2}), number=1, fade_in=0.0)
main.go(now=0.0); main.go(now=0.0)     # advance Main to cue 2
lasers.go(now=0.0)                      # Laser at cue 1
check("two independent stacks registered", set(mgr.list_stacks()) == {"main", "lasers"})
check("Main is on cue 2", main.current_cue().number == 2)
check("Lasers is on cue 1 (unaffected by Main)", lasers.current_cue().number == 1)
check("independent outputs", main.recalled_values(now=1.0) == {"jet": 1.0}
      and lasers.recalled_values(now=1.0) == {"laser": 0.2})

# Manager persistence round-trip across both stacks.
mgr2 = CueStackManager()
mgr2.load_dict(mgr.to_dict())
check("manager round-trips both stacks", set(mgr2.list_stacks()) == {"main", "lasers"})
check("restored Main keeps its 2 cues", len(mgr2.get("main").cues) == 2)

print("== 4. capture a live look from output commands ==")
vals = scene_values_from_commands([
    {"device_id": "jet-1", "type": "pump", "intensity": 0.8},
    {"device_id": "rgb-1", "type": "lighting", "intensity": 0.4},
])
check("scene captured from commands", vals == {"jet-1": 0.8, "rgb-1": 0.4}, str(vals))

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
