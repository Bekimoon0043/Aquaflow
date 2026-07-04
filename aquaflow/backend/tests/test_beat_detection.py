"""
Contract tests for the Beat Detection Engine (AQ-X-013).

Asserts the three acceptance criteria against known-tempo click tracks:
  1. BPM detection works correctly,
  2. beat detection latency is under 50 ms (algorithmic + steady-state processing),
  3. it works with both recorded (buffer) and live (streaming) audio.
"""
import numpy as np
import pytest

from services.beat_detection import (
    generate_click_track, detect_beats, estimate_bpm, onset_envelope,
    LiveBeatDetector, frame_latency_ms, demo_detect, DEFAULT_HOP,
)

SR = 44100


# ── 1. BPM correctness ────────────────────────────────────────────────────────

@pytest.mark.parametrize("bpm", [90, 100, 120, 128, 140])
def test_bpm_detection_matches_ground_truth(bpm):
    res = detect_beats(generate_click_track(bpm, 8.0, SR), SR)
    assert abs(res["bpm"] - bpm) <= 2.0, res["bpm"]


def test_beat_count_and_spacing_for_120():
    r = detect_beats(generate_click_track(120, 8.0, SR), SR)
    assert 14 <= r["beat_count"] <= 18                     # ~16 over 8 s
    gaps = np.diff(r["beat_times"])
    assert abs(np.median(gaps) - 0.5) < 0.05               # 120 BPM → 0.5 s


def test_noise_tolerant():
    r = detect_beats(generate_click_track(120, 8.0, SR, noise=0.02), SR)
    assert abs(r["bpm"] - 120) <= 3.0


def test_silence_returns_zero_bpm():
    assert detect_beats(np.zeros(SR), SR)["bpm"] == 0.0


def test_estimate_bpm_on_envelope():
    nov, env_sr = onset_envelope(generate_click_track(120, 6.0, SR), SR)
    assert nov.size > 10 and nov.max() > 0
    assert abs(estimate_bpm(nov, env_sr) - 120) <= 2.0


# ── 2. latency < 50 ms ────────────────────────────────────────────────────────

def test_algorithmic_latency_under_50ms():
    assert frame_latency_ms(SR, DEFAULT_HOP) < 50.0        # ~11.6 ms at hop 512


def test_streaming_processing_latency_under_50ms():
    det = LiveBeatDetector(SR)
    x = generate_click_track(120, 6.0, SR)
    # warm up numpy/BLAS so cold-start allocation doesn't skew the measurement
    for i in range(0, 20 * DEFAULT_HOP, DEFAULT_HOP):
        det.push(x[i:i + DEFAULT_HOP])
    lats = []
    for i in range(0, x.size - DEFAULT_HOP + 1, DEFAULT_HOP):
        lats.append(det.push(x[i:i + DEFAULT_HOP])["latency_ms"])
    lats.sort()
    p95 = lats[int(len(lats) * 0.95)]
    assert np.median(lats) < 50.0
    assert p95 < 50.0                                      # 95th percentile within budget


# ── 3. recorded + live ────────────────────────────────────────────────────────

def test_recorded_buffer_path():
    r = detect_beats(generate_click_track(128, 8.0, SR), SR)
    assert abs(r["bpm"] - 128) <= 2.0
    assert r["beat_count"] > 0
    assert r["duration_s"] == pytest.approx(8.0, abs=0.05)


def test_live_streaming_path_locks_tempo():
    det = LiveBeatDetector(SR)
    det.run_stream(generate_click_track(120, 8.0, SR))
    assert abs(det.bpm - 120) <= 4.0
    assert 13 <= det.beat_count <= 19


def test_live_tracks_different_tempo():
    det = LiveBeatDetector(SR)
    det.run_stream(generate_click_track(100, 8.0, SR))
    assert abs(det.bpm - 100) <= 5.0


def test_live_push_returns_running_state():
    det = LiveBeatDetector(SR)
    r = det.push(np.zeros(DEFAULT_HOP))
    assert set(r) >= {"beat", "bpm", "time_s", "latency_ms", "beat_count"}
    assert r["beat"] is False                              # silence → no beat


# ── demo helper ───────────────────────────────────────────────────────────────

def test_demo_detect_offline_and_live():
    d = demo_detect(120, 8.0, SR, live=True)
    assert abs(d["offline"]["bpm"] - 120) <= 2.0
    assert abs(d["live"]["bpm"] - 120) <= 4.0
    assert d["live"]["max_push_latency_ms"] < 50.0
    assert d["frame_latency_ms"] < 50.0
