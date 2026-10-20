"""Phase 3 deep music analysis — synthetic songs with known structure."""
import base64
import time

import numpy as np
from fastapi.testclient import TestClient

from services import deep_music

SR = 11025
BPM = 120
BEAT = 60 / BPM


def section(kind: str, bars: int, level: float, seed: int) -> np.ndarray:
    """4/4 bars: 'A' = kick + low chord, 'B' = kick + hats + bright chord, 'quiet' = pad only."""
    rng = np.random.default_rng(seed)
    n = int(bars * 4 * BEAT * SR)
    t = np.arange(n) / SR
    if kind == "quiet":
        x = 0.15 * np.sin(2 * np.pi * 220 * t)
    else:
        notes = (110, 138.6, 164.8) if kind == "A" else (329.6, 415.3, 493.9, 659.3)
        x = sum(0.12 * np.sin(2 * np.pi * f * t) for f in notes)
        for b in range(bars * 4):
            k = int(b * BEAT * SR)
            m = min(n - k, int(0.15 * SR))
            x[k:k + m] += 0.9 * np.exp(-np.arange(m) / (0.03 * SR)) * np.sin(2 * np.pi * 55 * np.arange(m) / SR)
            if kind == "B":
                h = k + int(BEAT * SR / 2)
                mh = min(n - h, int(0.03 * SR))
                if mh > 0:
                    x[h:h + mh] += 0.3 * rng.standard_normal(mh) * np.exp(-np.arange(mh) / (0.005 * SR))
    return (level * x).astype(np.float32)


def song(plan):
    return np.concatenate([section(k, b, lv, i) for i, (k, b, lv) in enumerate(plan)])


def beats_for(x):
    return [round(i * BEAT, 3) for i in range(int(len(x) / SR / BEAT))]


def test_loudness_orders_quiet_and_loud():
    quiet = section("quiet", 4, 0.3, 1)
    loud = section("B", 4, 1.0, 2)
    lq = deep_music.loudness_curves(deep_music.stft_mag(quiet))[1].mean()
    ll = deep_music.loudness_curves(deep_music.stft_mag(loud))[1].mean()
    assert ll > lq + 6


def test_structure_finds_boundaries_and_repeats():
    x = song([("A", 8, 0.6), ("B", 8, 1.0), ("A", 8, 0.6), ("B", 8, 1.0)])
    r = deep_music.analyze(x, SR, bpm=BPM, beats=beats_for(x))
    starts = [s["start"] for s in r["sections"]]
    for want in (16.0, 32.0, 48.0):
        assert min(abs(s - want) for s in starts) <= 2 * 4 * BEAT + 0.01, (want, starts)
    groups = [s["group"] for s in r["sections"]]
    # The two A sections share a group, the two B sections share another.
    by_time = {round(s["start"]): s["group"] for s in r["sections"]}
    assert by_time.get(0) == by_time.get(32), groups
    assert by_time.get(16) == by_time.get(48), groups
    assert by_time.get(0) != by_time.get(16)
    assert len(r["energy"]["values"]) == int(np.ceil(len(x) / SR / 0.25))


def test_build_and_drop():
    parts = [("A", 4, 0.3, 0)] + [("A", 1, 0.3 + 0.1 * k, k + 1) for k in range(6)] + [("B", 8, 1.0, 20)]
    x = np.concatenate([section(k, b, lv, s) for k, b, lv, s in parts])
    r = deep_music.analyze(x, SR, bpm=BPM, beats=beats_for(x))
    assert r["builds"], r["builds"]
    drop_at = 10 * 4 * BEAT
    assert any(abs(d["time"] - drop_at) <= 4 * BEAT + 0.01 for d in r["drops"]), r["drops"]


def test_mood_louder_and_faster_is_more_aroused():
    calm = section("quiet", 16, 0.3, 3)
    hot = section("B", 16, 1.0, 4)
    a = deep_music.analyze(calm, SR, bpm=80)["mood"]["arousal"]
    b = deep_music.analyze(hot, SR, bpm=140)["mood"]["arousal"]
    assert b > a + 0.2


def test_tempo_fallback_without_beats():
    x = song([("B", 16, 1.0)])
    r = deep_music.analyze(x, SR)
    assert abs(r["bpm"] - BPM) < 3 or abs(r["bpm"] - BPM / 2) < 2 or abs(r["bpm"] - 2 * BPM) < 4


def test_api_runs_and_caches(tmp_path, monkeypatch):
    from api.routes import music_deep_routes as routes
    monkeypatch.setattr(routes, "CACHE", tmp_path)
    from main import app
    client = TestClient(app)
    x = song([("A", 4, 0.6), ("B", 4, 1.0)])
    body = {"pcm16": base64.b64encode((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()).decode(), "rate": SR, "bpm": BPM}
    r = client.post("/api/music/deep?wait=true", json=body).json()
    assert r["status"] == "done", r
    assert r["result"]["sections"] and r["result"]["mood"]["key"]
    again = client.post("/api/music/deep", json=body).json()
    assert again.get("cached") is True
    assert client.get(f"/api/music/deep/{again['job_id']}").json()["status"] == "done"
    assert "beat_this" in client.get("/api/music/plugins").json()["plugins"]


def test_speed_four_minutes_under_a_minute():
    x = np.tile(song([("A", 8, 0.6), ("B", 8, 1.0)]), 4)[: 240 * SR]
    t0 = time.time()
    deep_music.analyze(x, SR, bpm=BPM, beats=beats_for(x))
    assert time.time() - t0 < 60
