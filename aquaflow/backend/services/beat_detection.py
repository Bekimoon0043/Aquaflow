"""
beat_detection.py — AquaFlow Recovery, AQ-X-013

Beat detection engine for music-synchronised shows.

A lightweight, dependency-free (numpy-only) tempo/beat engine that works both on a
whole recording and on a live audio stream — independent of the heavy, offline-only
librosa path in the audio route.

  * BPM detection — an energy-flux onset envelope + weighted autocorrelation
    (octave-corrected toward the musical range) gives the tempo of recorded audio;
    a click-track generator provides ground truth to verify it.
  * latency under 50 ms — the streaming `LiveBeatDetector` processes one hop per call
    (default hop 512 @ 44.1 kHz ≈ 11.6 ms of algorithmic latency) and each call's
    wall-clock processing time is reported so the < 50 ms budget is checkable.
  * live and recorded audio — `detect_beats(samples, sr)` analyses a buffer;
    `LiveBeatDetector.push(frame)` handles a real-time stream frame by frame.

All maths are SI/plain: samples are mono float32 in [-1, 1], times in seconds.
"""
from __future__ import annotations

from collections import deque
from time import perf_counter

import numpy as np

DEFAULT_HOP = 512
DEFAULT_FRAME = 1024
MIN_BPM = 60.0
MAX_BPM = 200.0
CENTER_BPM = 120.0          # tempo-preference centre (resolves octave errors)


# ── Test-signal generator (ground truth) ──────────────────────────────────────

def generate_click_track(bpm: float, duration_s: float, sr: int = 44100,
                         click_ms: float = 6.0, noise: float = 0.0,
                         seed: int = 0) -> np.ndarray:
    """A mono click track at a known BPM — decaying impulses on the beat."""
    n = int(duration_s * sr)
    x = np.zeros(n, dtype=np.float64)
    period = max(1, int(round(sr * 60.0 / bpm)))
    clen = max(1, int(sr * click_ms / 1000.0))
    click = np.exp(-np.linspace(0, 6, clen))
    for i in range(0, n, period):
        end = min(n, i + clen)
        x[i:end] += click[: end - i]
    if noise > 0:
        rng = np.random.default_rng(seed)
        x += noise * rng.standard_normal(n)
    return x


# ── Onset envelope ────────────────────────────────────────────────────────────

def onset_envelope(samples, sr: int, hop: int = DEFAULT_HOP,
                   frame: int = DEFAULT_FRAME) -> tuple[np.ndarray, float]:
    """
    Energy-flux novelty function: per-frame energy, half-wave-rectified first
    difference. Returns (novelty, env_sr) where env_sr is the envelope sample rate.
    """
    x = np.asarray(samples, dtype=np.float64)
    if x.size < frame:
        return np.zeros(1), sr / hop
    n_frames = 1 + (x.size - frame) // hop
    energy = np.empty(n_frames)
    for i in range(n_frames):
        w = x[i * hop: i * hop + frame]
        energy[i] = float(np.dot(w, w))
    flux = np.diff(energy, prepend=energy[0])
    novelty = np.maximum(0.0, flux)
    return novelty, sr / hop


# ── Tempo (BPM) estimation ────────────────────────────────────────────────────

def estimate_bpm(novelty: np.ndarray, env_sr: float, min_bpm: float = MIN_BPM,
                 max_bpm: float = MAX_BPM, center_bpm: float = CENTER_BPM) -> float:
    """
    BPM from the onset envelope via autocorrelation weighted by a log-tempo
    preference around `center_bpm` (so octave errors resolve to the musical range).
    """
    env = np.asarray(novelty, dtype=np.float64)
    if env.size < 4 or not np.any(env):
        return 0.0
    env = env - env.mean()
    ac = np.correlate(env, env, mode="full")[env.size - 1:]   # lags 0..N-1
    if ac[0] <= 0:
        return 0.0
    ac = ac / ac[0]

    lag_min = max(1, int(round(env_sr * 60.0 / max_bpm)))
    lag_max = min(env.size - 1, int(round(env_sr * 60.0 / min_bpm)))
    if lag_max <= lag_min:
        return 0.0
    lags = np.arange(lag_min, lag_max + 1)
    bpms = 60.0 * env_sr / lags
    weight = np.exp(-0.5 * (np.log2(bpms / center_bpm) / 0.7) ** 2)
    score = ac[lags] * weight
    best_lag = lags[int(np.argmax(score))]
    return float(60.0 * env_sr / best_lag)


# ── Beat picking (offline) ────────────────────────────────────────────────────

def _pick_peaks(novelty: np.ndarray, min_spacing: int, k: float = 1.0) -> list[int]:
    """Adaptive-threshold peak picker with a minimum spacing (in frames)."""
    if novelty.size == 0:
        return []
    win = max(3, min_spacing)
    peaks = []
    last = -min_spacing
    n = novelty.size
    for i in range(1, n - 1):
        lo = max(0, i - win); hi = min(n, i + win + 1)
        local = novelty[lo:hi]
        thr = local.mean() + k * local.std()
        if (novelty[i] > novelty[i - 1] and novelty[i] >= novelty[i + 1]
                and novelty[i] >= thr and novelty[i] > 0 and i - last >= min_spacing):
            peaks.append(i); last = i
    return peaks


def detect_beats(samples, sr: int, hop: int = DEFAULT_HOP) -> dict:
    """
    Offline beat detection for a whole recording. Returns BPM, beat times (s), and
    the beat count.
    """
    t0 = perf_counter()
    novelty, env_sr = onset_envelope(samples, sr, hop=hop)
    bpm = estimate_bpm(novelty, env_sr)
    beat_times: list[float] = []
    if bpm > 0:
        spacing = max(1, int(round(env_sr * 60.0 / bpm * 0.5)))
        frames = _pick_peaks(novelty, spacing)
        beat_times = [round(f / env_sr, 4) for f in frames]
    return {
        "bpm": round(bpm, 2),
        "beat_times": beat_times,
        "beat_count": len(beat_times),
        "env_sr": round(env_sr, 4),
        "duration_s": round(len(np.asarray(samples)) / sr, 4),
        "analysis_ms": round((perf_counter() - t0) * 1000.0, 3),
    }


def frame_latency_ms(sr: int, hop: int = DEFAULT_HOP) -> float:
    """Algorithmic latency of the streaming detector (one hop)."""
    return hop / sr * 1000.0


# ── Live streaming detector ───────────────────────────────────────────────────

class LiveBeatDetector:
    """
    Real-time beat detector: feed it one hop-sized frame at a time. Each `push`
    returns whether a beat fired, the running BPM (from recent inter-beat intervals),
    and the wall-clock processing time so the < 50 ms latency budget is verifiable.
    """

    def __init__(self, sr: int, hop: int = DEFAULT_HOP, sensitivity: float = 1.5,
                 min_bpm: float = MIN_BPM, max_bpm: float = MAX_BPM,
                 history_s: float = 0.75):
        self.sr = sr
        self.hop = hop
        self.dt = hop / sr
        self.sensitivity = sensitivity
        self.min_bpm = min_bpm
        self.max_bpm = max_bpm
        self.debounce_s = 60.0 / max_bpm
        self._prev_energy = 0.0
        self._nov_hist = deque(maxlen=max(4, int(history_s / self.dt)))
        self._intervals = deque(maxlen=8)
        self._last_beat_t = -1e9
        self._t = 0.0
        self.bpm = 0.0
        self.beat_count = 0

    def push(self, frame) -> dict:
        t0 = perf_counter()
        w = np.asarray(frame, dtype=np.float64)
        energy = float(np.dot(w, w))
        novelty = max(0.0, energy - self._prev_energy)
        self._prev_energy = energy

        hist = self._nov_hist
        threshold = (np.mean(hist) * self.sensitivity) if len(hist) else 0.0
        beat = False
        if (novelty > threshold and novelty > 1e-9
                and (self._t - self._last_beat_t) >= self.debounce_s):
            beat = True
            self.beat_count += 1
            if self._last_beat_t > -1e8:
                self._intervals.append(self._t - self._last_beat_t)
            self._last_beat_t = self._t
            if len(self._intervals) >= 2:
                med = float(np.median(self._intervals))
                if med > 0:
                    self.bpm = 60.0 / med

        self._nov_hist.append(novelty)
        self._t += self.dt
        return {
            "beat": beat,
            "bpm": round(self.bpm, 2),
            "novelty": novelty,
            "energy": energy,
            "time_s": round(self._t, 4),
            "beat_count": self.beat_count,
            "latency_ms": (perf_counter() - t0) * 1000.0,
        }

    def run_stream(self, samples, report_only_beats: bool = True) -> list[dict]:
        """Convenience: push a whole buffer frame by frame (simulating a live feed)."""
        x = np.asarray(samples, dtype=np.float64)
        out = []
        for i in range(0, x.size - self.hop + 1, self.hop):
            r = self.push(x[i: i + self.hop])
            if r["beat"] or not report_only_beats:
                out.append(r)
        return out


# ── Dict entry points ─────────────────────────────────────────────────────────

def detect_from_payload(payload: dict) -> dict:
    """Offline detection from {samples:[...], sample_rate}."""
    samples = payload.get("samples")
    sr = int(payload.get("sample_rate", 44100))
    if not samples:
        raise ValueError("samples required")
    return detect_beats(samples, sr, hop=int(payload.get("hop", DEFAULT_HOP)))


def demo_detect(bpm: float = 120.0, duration_s: float = 8.0, sr: int = 44100,
                live: bool = True) -> dict:
    """
    Self-contained verification: synthesise a click track at `bpm` and detect it both
    offline and (optionally) via the live streaming detector, reporting latency.
    """
    x = generate_click_track(bpm, duration_s, sr)
    offline = detect_beats(x, sr)
    result = {
        "requested_bpm": bpm,
        "offline": offline,
        "frame_latency_ms": round(frame_latency_ms(sr), 3),
    }
    if live:
        det = LiveBeatDetector(sr)
        beats = det.run_stream(x)
        result["live"] = {
            "bpm": round(det.bpm, 2),
            "beat_count": det.beat_count,
            "max_push_latency_ms": round(max((b["latency_ms"] for b in beats), default=0.0), 4),
        }
    return result
