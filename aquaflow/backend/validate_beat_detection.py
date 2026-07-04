"""
validate_beat_detection.py — AQ-X-013 verification

Verifies the beat detection engine against click tracks of known tempo:
  1. BPM detection works correctly (offline detection matches the ground-truth BPM),
  2. beat detection latency is under 50 ms (per-frame streaming latency + algorithmic),
  3. it works with both live (streaming) and recorded (buffer) audio.

Run:  python backend/validate_beat_detection.py   (from the aquaflow/ dir)
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.beat_detection import (
    generate_click_track, detect_beats, estimate_bpm, onset_envelope,
    LiveBeatDetector, frame_latency_ms, demo_detect, DEFAULT_HOP,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


SR = 44100

print("== 1. BPM detection works correctly (recorded audio) ==")
for bpm in (90, 100, 120, 128, 140):
    x = generate_click_track(bpm, 8.0, SR)
    res = detect_beats(x, SR)
    err = abs(res["bpm"] - bpm)
    check(f"{bpm} BPM click detected (±2)", err <= 2.0, f'got {res["bpm"]} (err {err:.2f})')

# Beat count is about right for 120 BPM over 8 s (~16 beats).
x120 = generate_click_track(120, 8.0, SR)
r120 = detect_beats(x120, SR)
check("120 BPM / 8 s → ~16 beats", 14 <= r120["beat_count"] <= 18, f'{r120["beat_count"]} beats')
check("beat times are ~0.5 s apart",
      abs((r120["beat_times"][2] - r120["beat_times"][1]) - 0.5) < 0.06
      if len(r120["beat_times"]) > 2 else False,
      str(r120["beat_times"][:4]))

# A little noise doesn't break detection.
xn = generate_click_track(120, 8.0, SR, noise=0.02)
check("noisy 120 BPM still detected", abs(detect_beats(xn, SR)["bpm"] - 120) <= 3.0,
      f'{detect_beats(xn, SR)["bpm"]}')

print("== 2. beat detection latency under 50 ms ==")
algo = frame_latency_ms(SR, DEFAULT_HOP)
check(f"algorithmic (hop) latency {algo:.1f} ms < 50 ms", algo < 50.0)

det = LiveBeatDetector(SR)
x = generate_click_track(120, 6.0, SR)
max_lat = 0.0
frames = 0
for i in range(0, x.size - DEFAULT_HOP + 1, DEFAULT_HOP):
    r = det.push(x[i:i + DEFAULT_HOP])
    max_lat = max(max_lat, r["latency_ms"])
    frames += 1
check(f"max per-frame processing latency < 50 ms", max_lat < 50.0, f"{max_lat:.3f} ms over {frames} frames")

print("== 3. works with live (streaming) audio ==")
det2 = LiveBeatDetector(SR)
beats = det2.run_stream(generate_click_track(120, 8.0, SR))
check("live detector locks onto ~120 BPM", abs(det2.bpm - 120) <= 4.0, f"{det2.bpm}")
check("live detector fires ~16 beats", 13 <= det2.beat_count <= 19, f"{det2.beat_count} beats")
det3 = LiveBeatDetector(SR)
det3.run_stream(generate_click_track(100, 8.0, SR))
check("live detector tracks a different tempo (100)", abs(det3.bpm - 100) <= 5.0, f"{det3.bpm}")

print("== 4. onset envelope + estimate_bpm internals ==")
nov, env_sr = onset_envelope(generate_click_track(120, 6.0, SR), SR)
check("onset envelope produced", nov.size > 10 and nov.max() > 0)
check("estimate_bpm on envelope ≈ 120", abs(estimate_bpm(nov, env_sr) - 120) <= 2.0,
      f"{estimate_bpm(nov, env_sr):.2f}")
check("silence → 0 BPM", detect_beats([0.0] * SR, SR)["bpm"] == 0.0)

print("== 5. demo_detect (offline + live in one call) ==")
d = demo_detect(128, 8.0, SR, live=True)
check("demo offline BPM ≈ 128", abs(d["offline"]["bpm"] - 128) <= 2.0, str(d["offline"]["bpm"]))
check("demo live BPM ≈ 128", abs(d["live"]["bpm"] - 128) <= 4.0, str(d["live"]["bpm"]))
check("demo reports max push latency < 50 ms", d["live"]["max_push_latency_ms"] < 50.0,
      f'{d["live"]["max_push_latency_ms"]} ms')

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
