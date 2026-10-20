"""
deep_music.py — Phase 3 deep music analysis (reports/Automatic fountain shows for any site.md).

Licence-clean and numpy-only, so it ships in the desktop engine as is:

  * loudness     K-weighted (EBU R128 / ITU-R BS.1770 frequency weighting applied in the
                 STFT domain), momentary 400 ms and short-term 3 s, in LUFS-like dB
  * structure    bar-synchronous timbre + harmony features → self-similarity matrix →
                 Foote checkerboard novelty → boundaries; segments clustered into repeat
                 groups (A, B, C …) — labels only group repeats, the arc follows energy
  * build / drop rising loudness and onset density over 4–16 bars, then a loudness + bass
                 jump on a bar line (heuristic: no licence-clean drop model exists)
  * mood         arousal (loudness, onset density, tempo, brightness) and valence
                 (major / minor key correlation, brightness), each 0..1
  * vocals       phrases where the 300–3,400 Hz harmonic band is active for ≥ 1 s

Optional plug-ins, used only when installed (and licence-cleared, see licenses/MODEL_LICENSES.md):
  * beat_this (MIT code + weights) for beats / downbeats
  * HTDemucs ONNX (MIT code; weight licence to confirm) for stems — not bundled

Input: mono float32 samples in [-1, 1] at any rate (resampled to 11,025 Hz).
"""
from __future__ import annotations

import hashlib
import math
from typing import Callable, Optional

import numpy as np

RATE = 11025
N_FFT = 2048
HOP = 512
VERSION = 1


# ── Basics ──────────────────────────────────────────────────────────────────────

def resample(x: np.ndarray, rate: int, to: int = RATE) -> np.ndarray:
    """Linear-interpolation resample (with a box pre-filter when downsampling)."""
    x = np.asarray(x, dtype=np.float32)
    if rate == to or len(x) == 0:
        return x
    if rate > to:
        k = int(rate // to)
        if k > 1:
            n = len(x) // k * k
            x = x[:n].reshape(-1, k).mean(axis=1)
            rate = rate / k
    t = np.arange(0, len(x) / rate, 1 / to)
    return np.interp(t, np.arange(len(x)) / rate, x).astype(np.float32)


def stft_mag(x: np.ndarray, n_fft: int = N_FFT, hop: int = HOP) -> np.ndarray:
    """Magnitude spectrogram, frames × bins (Hann window)."""
    if len(x) < n_fft:
        x = np.pad(x, (0, n_fft - len(x)))
    n = 1 + (len(x) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n)[:, None]
    win = np.hanning(n_fft).astype(np.float32)
    frames = x[idx] * win
    return np.abs(np.fft.rfft(frames, axis=1)).astype(np.float32)


def k_weighting(freqs: np.ndarray) -> np.ndarray:
    """Magnitude of the BS.1770 K-weighting (high shelf + high pass) at `freqs` Hz."""
    f = np.maximum(freqs, 1.0)
    # Stage 1: high shelf, +4 dB above ~1.7 kHz.
    shelf_db = 4.0 / (1.0 + (1681.0 / f) ** 2)
    # Stage 2: 2nd-order high pass at ~38 Hz (RLB).
    hp = (f / 38.0) ** 2 / np.sqrt(1 + (f / 38.0) ** 4)
    return (10 ** (shelf_db / 20.0) * hp).astype(np.float32)


def loudness_curves(mag: np.ndarray, rate: int = RATE, hop: int = HOP):
    """Momentary (400 ms) and short-term (3 s) loudness in dB, per STFT frame."""
    freqs = np.fft.rfftfreq((mag.shape[1] - 1) * 2, 1 / rate)
    power = ((mag * k_weighting(freqs)[None, :]) ** 2).sum(axis=1) / (mag.shape[1] ** 2)
    fps = rate / hop

    def smooth(p, seconds):
        w = max(1, int(round(seconds * fps)))
        c = np.cumsum(np.concatenate([[0.0], p]))
        out = (c[w:] - c[:-w]) / w
        return np.concatenate([np.full(w - 1, out[0] if len(out) else 0.0), out])

    db = lambda p: 10 * np.log10(np.maximum(p, 1e-12)) - 0.691
    return db(smooth(power, 0.4)), db(smooth(power, 3.0)), fps


def onset_strength(mag: np.ndarray) -> np.ndarray:
    """Spectral flux on log magnitude (positive changes)."""
    lm = np.log1p(10 * mag)
    flux = np.maximum(0, np.diff(lm, axis=0)).sum(axis=1)
    return np.concatenate([[0.0], flux]).astype(np.float32)


def chroma(mag: np.ndarray, rate: int = RATE) -> np.ndarray:
    """12-bin pitch-class profile per frame (55 Hz – 2.5 kHz)."""
    freqs = np.fft.rfftfreq((mag.shape[1] - 1) * 2, 1 / rate)
    band = (freqs >= 55) & (freqs <= 2500)
    pc = np.mod(np.round(12 * np.log2(freqs[band] / 440.0)) + 9, 12).astype(int)
    out = np.zeros((mag.shape[0], 12), dtype=np.float32)
    for k in range(12):
        sel = pc == k
        if sel.any():
            out[:, k] = mag[:, band][:, sel].sum(axis=1)
    return out / (out.sum(axis=1, keepdims=True) + 1e-9)


def band_energy(mag: np.ndarray, lo: float, hi: float, rate: int = RATE) -> np.ndarray:
    freqs = np.fft.rfftfreq((mag.shape[1] - 1) * 2, 1 / rate)
    sel = (freqs >= lo) & (freqs < hi)
    return (mag[:, sel] ** 2).sum(axis=1)


def timbre(mag: np.ndarray, rate: int = RATE, n: int = 20) -> np.ndarray:
    """Log energies in n log-spaced bands (an MFCC-like timbre summary, no DCT needed)."""
    freqs = np.fft.rfftfreq((mag.shape[1] - 1) * 2, 1 / rate)
    edges = np.geomspace(40, rate / 2, n + 1)
    out = np.zeros((mag.shape[0], n), dtype=np.float32)
    for i in range(n):
        sel = (freqs >= edges[i]) & (freqs < edges[i + 1])
        if sel.any():
            out[:, i] = np.log1p((mag[:, sel] ** 2).sum(axis=1))
    return out


# ── Beats (fallback) ────────────────────────────────────────────────────────────

def tempo_and_beats(onset: np.ndarray, fps: float, duration: float, bpm_hint: Optional[float] = None):
    """Autocorrelation tempo (60–200 BPM, preferring ~120) and a phase-fitted beat grid."""
    o = onset - onset.mean()
    if bpm_hint and 30 <= bpm_hint <= 300:
        bpm = float(bpm_hint)
    else:
        ac = np.correlate(o, o, mode="full")[len(o) - 1:]
        lags = np.arange(len(ac))
        bpms = 60 * fps / np.maximum(lags, 1)
        ok = (bpms >= 60) & (bpms <= 200)
        weight = np.exp(-0.5 * (np.log2(bpms[ok] / 120.0) / 0.9) ** 2)
        best = lags[ok][np.argmax(ac[ok] * weight)]
        bpm = 60 * fps / best
    period = 60 * fps / bpm
    phases = np.arange(0, period, 0.5)
    scores = [onset[np.clip(np.round(np.arange(p, len(onset), period)).astype(int), 0, len(onset) - 1)].sum() for p in phases]
    phase = phases[int(np.argmax(scores))]
    beats = np.arange(phase, duration * fps, period) / fps
    return round(float(bpm), 3), [round(float(b), 3) for b in beats]


# ── Structure ───────────────────────────────────────────────────────────────────

def bar_features(frames: np.ndarray, frame_times: np.ndarray, bars: list[float]) -> np.ndarray:
    """Mean feature vector per bar (bars = bar start times)."""
    edges = list(bars) + [frame_times[-1] + 1e-3]
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        sel = (frame_times >= a) & (frame_times < b)
        out.append(frames[sel].mean(axis=0) if sel.any() else np.zeros(frames.shape[1]))
    return np.array(out, dtype=np.float32)


def novelty_curve(feat: np.ndarray, kernel: int = 4) -> np.ndarray:
    """Foote checkerboard novelty on the cosine self-similarity matrix."""
    z = feat - feat.mean(axis=0)
    z = z / (np.linalg.norm(z, axis=1, keepdims=True) + 1e-9)
    ssm = z @ z.T
    n = len(ssm)
    k = kernel
    sign = np.ones((2 * k, 2 * k))
    sign[:k, k:] = -1
    sign[k:, :k] = -1
    g = np.exp(-0.5 * ((np.arange(2 * k) - k + 0.5) / k) ** 2)
    sign *= np.outer(g, g)
    pad = np.pad(ssm, k, mode="edge")
    nov = np.array([(pad[i:i + 2 * k, i:i + 2 * k] * sign).sum() for i in range(n)])
    return np.maximum(0, nov), ssm


def segment(feat: np.ndarray, min_bars: int = 4, max_segments: int = 16):
    """Boundaries (bar indices) from novelty peaks, ≥ min_bars apart."""
    nov, ssm = novelty_curve(feat, kernel=max(2, min_bars))
    n = len(nov)
    if n < 2 * min_bars:
        return [0, n], nov, ssm
    thr = nov.mean() + 0.5 * nov.std()
    peaks = [i for i in range(1, n - 1) if nov[i] >= thr and nov[i] >= nov[i - 1] and nov[i] >= nov[i + 1]]
    peaks.sort(key=lambda i: -nov[i])
    cuts = []
    for p in peaks:
        if len(cuts) >= max_segments - 1:
            break
        if p < min_bars or n - p < min_bars // 2:
            continue
        if all(abs(p - c) >= min_bars for c in cuts):
            cuts.append(p)
    return [0] + sorted(cuts) + [n], nov, ssm


def repeat_labels(feat: np.ndarray, edges: list[int], threshold: float = 0.9) -> list[str]:
    """Group segments by similarity of their mean features: A, B, C …"""
    z = feat - feat.mean(axis=0)
    z = z / (np.linalg.norm(z, axis=1, keepdims=True) + 1e-9)
    means = [z[a:b].mean(axis=0) for a, b in zip(edges[:-1], edges[1:])]
    means = [m / (np.linalg.norm(m) + 1e-9) for m in means]
    labels, reps = [], []
    for m in means:
        sims = [float(m @ r) for _, r in reps]
        if sims and max(sims) >= threshold:
            labels.append(reps[int(np.argmax(sims))][0])
        else:
            name = chr(ord("A") + len(reps)) if len(reps) < 26 else f"S{len(reps)}"
            reps.append((name, m))
            labels.append(name)
    return labels


# ── Build-ups, drops, mood, vocals ─────────────────────────────────────────────

def builds_and_drops(bar_loud: np.ndarray, bar_onset: np.ndarray, bar_bass: np.ndarray, bars: list[float], bar_mom: Optional[np.ndarray] = None):
    """Builds: ≥ 4 bars of rising loudness or onset density; drops: the biggest one-bar jump of
    momentary loudness / bass inside or just after a build (or a big jump anywhere)."""
    n = len(bar_loud)
    builds, drops = [], []
    if n < 6:
        return builds, drops
    lz = (bar_loud - bar_loud.mean()) / (bar_loud.std() + 1e-9)
    oz = (bar_onset - bar_onset.mean()) / (bar_onset.std() + 1e-9)
    bz = (bar_bass - bar_bass.mean()) / (bar_bass.std() + 1e-9)
    mom = bar_loud if bar_mom is None else bar_mom
    mz = (mom - mom.mean()) / (mom.std() + 1e-9)
    jump = lambda k: max(mz[k] - mz[k - 1], bz[k] - bz[k - 1])
    i = 0
    while i < n - 4:
        j = i
        while j + 1 < n and (lz[j + 1] - lz[j] > 0.02 or oz[j + 1] - oz[j] > 0.05):
            j += 1
        if j - i >= 3 and (lz[j] - lz[i] > 0.6 or oz[j] - oz[i] > 0.8):
            builds.append({"start": bars[i], "end": bars[min(j + 1, n - 1)], "bars": j - i + 1})
            ks = list(range(i + 1, min(n, j + 3)))
            if ks:
                k = max(ks, key=jump)
                if jump(k) > 0.5:
                    drops.append({"time": bars[k], "strength": round(float(jump(k)), 3)})
            i = j + 1
        else:
            i += 1
    # Big standalone jumps on a bar line count as drops too.
    for k in range(1, n):
        if mz[k] - mz[k - 1] > 1.4 and bz[k] - bz[k - 1] > 0.8 and all(abs(d["time"] - bars[k]) > 1 for d in drops):
            drops.append({"time": bars[k], "strength": round(float(mz[k] - mz[k - 1]), 3)})
    drops.sort(key=lambda d: d["time"])
    return builds, drops


MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def key_mode(chroma_mean: np.ndarray):
    """Krumhansl key profile correlation → (tonic 0..11, 'major' | 'minor', strength)."""
    best = (0, "major", -1.0)
    for t in range(12):
        c = np.roll(chroma_mean, -t)
        for mode, prof in (("major", MAJOR), ("minor", MINOR)):
            r = float(np.corrcoef(c, prof)[0, 1])
            if r > best[2]:
                best = (t, mode, r)
    return best


def mood(loud_db: np.ndarray, onset_rate: float, bpm: float, centroid_hz: float, mode: str, mode_strength: float):
    """Licence-free arousal / valence estimates 0..1 (heuristic, not a trained model)."""
    sig = lambda v: 1 / (1 + math.exp(-v))
    arousal = sig(0.12 * (float(np.median(loud_db)) + 20) + 1.2 * (onset_rate - 2.5) / 2.5 + 1.5 * (bpm - 110) / 60 + 0.8 * (centroid_hz - 1500) / 1500)
    valence = sig((1.2 if mode == "major" else -1.2) * max(0.0, mode_strength) + 0.6 * (centroid_hz - 1500) / 1500 + 0.3 * (bpm - 110) / 60)
    return round(arousal, 3), round(valence, 3)


def vocal_phrases(mag: np.ndarray, fps: float, min_s: float = 1.0):
    """Phrases where the voice band (300–3,400 Hz) stands out over the rest of the mix."""
    voice = band_energy(mag, 300, 3400)
    rest = band_energy(mag, 40, 300) + band_energy(mag, 3400, RATE / 2) + 1e-9
    ratio = np.log10(voice / rest + 1e-9)
    w = max(1, int(0.25 * fps))
    ratio = np.convolve(ratio, np.ones(w) / w, mode="same")
    on = ratio > np.median(ratio) + 0.15
    out, s = [], None
    for i, v in enumerate(list(on) + [False]):
        if v and s is None:
            s = i
        if not v and s is not None:
            if (i - s) / fps >= min_s:
                out.append({"start": round(s / fps, 3), "end": round(i / fps, 3)})
            s = None
    return out


# ── Optional plug-ins ──────────────────────────────────────────────────────────

def available_plugins() -> dict:
    """Which optional models are installed in this engine."""
    out = {"beat_this": False, "htdemucs_onnx": False}
    try:  # pragma: no cover - depends on the install
        import beat_this  # noqa: F401
        out["beat_this"] = True
    except Exception:
        pass
    try:  # pragma: no cover
        import onnxruntime  # noqa: F401
        from pathlib import Path
        out["htdemucs_onnx"] = Path("models/htdemucs.onnx").exists()
    except Exception:
        pass
    return out


# ── Whole analysis ─────────────────────────────────────────────────────────────

def analyze(samples, rate: int, *, bpm: Optional[float] = None, beats: Optional[list] = None, beats_per_bar: int = 4,
            progress: Optional[Callable[[float], None]] = None) -> dict:
    """Deep analysis of one song (mono). `beats` / `bpm` from the app keep one shared grid."""
    step = progress or (lambda p: None)
    x = resample(np.asarray(samples, dtype=np.float32), int(rate))
    duration = len(x) / RATE
    mag = stft_mag(x)
    step(0.2)
    times = (np.arange(mag.shape[0]) * HOP + N_FFT / 2) / RATE
    momentary, short, fps = loudness_curves(mag)
    onset = onset_strength(mag)
    step(0.35)
    if not beats:
        bpm, beats = tempo_and_beats(onset, fps, duration, bpm)
    bpb = max(1, int(beats_per_bar))
    bars = [b for i, b in enumerate(beats) if i % bpb == 0] or [0.0]
    if bars[0] > 0.5:
        bars = [0.0] + bars
    feat = np.concatenate([timbre(mag), 4 * chroma(mag)], axis=1)
    bf = bar_features(feat, times, bars)
    step(0.55)
    edges, nov, _ = segment(bf, min_bars=4)
    labels = repeat_labels(bf, edges)
    bar_loud = bar_features(short[:, None], times, bars)[:, 0]
    bar_onset = bar_features(onset[:, None], times, bars)[:, 0]
    bar_bass = bar_features(np.log1p(band_energy(mag, 40, 160))[:, None], times, bars)[:, 0]
    sections = []
    for (a, b), lab in zip(zip(edges[:-1], edges[1:]), labels):
        start = bars[a]
        end = bars[b] if b < len(bars) else duration
        sel = (times >= start) & (times < end)
        sections.append({"start": round(float(start), 3), "end": round(float(end), 3), "bars": int(b - a), "group": lab,
                         "loudness": round(float(short[sel].mean()) if sel.any() else -60.0, 2)})
    step(0.7)
    bar_mom = bar_features(momentary[:, None], times, bars)[:, 0]
    builds, drops = builds_and_drops(bar_loud, bar_onset, bar_bass, bars, bar_mom)
    cm = chroma(mag).mean(axis=0)
    tonic, mode_name, strength = key_mode(cm)
    freqs = np.fft.rfftfreq(N_FFT, 1 / RATE)
    centroid = float((mag * freqs[None, :]).sum() / (mag.sum() + 1e-9))
    peaks = (onset > np.percentile(onset, 85)).sum()
    arousal, valence = mood(short, peaks / max(1.0, duration), float(bpm or 110), centroid, mode_name, strength)
    phrases = vocal_phrases(mag, fps)
    step(0.9)
    # Energy curve 0..1 at 4 Hz from short-term loudness (95th percentile = 1, 30 dB range).
    t4 = np.arange(0, duration, 0.25)
    st = np.interp(t4, times, short)
    ref = np.percentile(st, 95)
    energy = np.clip(1 - (ref - st) / 30.0, 0, 1)
    step(1.0)
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return {
        "version": VERSION, "source": "deep", "duration": round(duration, 3), "bpm": bpm, "beatsPerBar": bpb,
        "beats": [round(float(b), 3) for b in beats], "downbeats": [round(float(b), 3) for b in bars if b > 0 or bars[0] == 0],
        "energy": {"rate": 4, "values": [round(float(v), 3) for v in energy]},
        "loudness": {"rate": 4, "integratedDb": round(float(np.mean(st)), 2), "rangeDb": round(float(np.percentile(st, 95) - np.percentile(st, 10)), 2)},
        "sections": sections, "novelty": [round(float(v), 3) for v in nov],
        "builds": builds, "drops": drops,
        "mood": {"arousal": arousal, "valence": valence, "key": f"{names[tonic]} {mode_name}", "keyStrength": round(strength, 3)},
        "vocalPhrases": phrases, "plugins": available_plugins(),
    }


def pcm_hash(samples: np.ndarray, rate: int) -> str:
    return hashlib.sha256(np.asarray(samples, dtype=np.float32).tobytes() + str(rate).encode()).hexdigest()[:20]
