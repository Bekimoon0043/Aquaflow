"""
validate_multiuniverse_audio.py — AquaFlow Stage 1, Priority 5 (AQ-S1-005)

Proves the three acceptance criteria for multi-universe + audio end-to-end:
  1. More than 4 universes supported (Art-Net driver no longer wraps at % 4).
  2. A real audio file drives beat markers (a generated click track is analysed).
  3. The numpy/librosa path is working (analysis uses librosa, not the estimate).

Runs in-process — no server. Generates its own WAV so it needs no assets.
Exit code 0 = all checks pass.

Run:  python validate_multiuniverse_audio.py
"""
import asyncio
import sys
import time
import wave
import struct
import math
import tempfile
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, PASS if ok else FAIL, detail))


# ── Criterion 1: more than 4 universes ─────────────────────────────────────────
async def test_multiuniverse() -> None:
    from engine.protocol_bus import ArtNetDriver

    driver = ArtNetDriver(target_ip="127.0.0.1")  # loopback — no real network traffic
    await driver.connect()

    # Drive 8 universes (0..7), each with a distinct sentinel value on channel 0.
    for u in range(8):
        ok = await driver.send({"universe": u, "channels": {0: (u + 1) * 10}})
        check(f"Universe {u}: send accepted", ok is True, f"send returned {ok}")

    check("More than 4 universes allocated",
          len(driver._universes) == 8, f"allocated={sorted(driver._universes)}")

    # No aliasing: universe 4 must NOT share a buffer with universe 0 (the old % 4 bug).
    distinct = all(
        driver._universes[u][0] == (u + 1) * 10 for u in range(8)
    )
    check("Each universe keeps its own frame (no % 4 wrap)", distinct,
          f"ch0 values={[driver._universes[u][0] for u in range(8)]}")

    # Universe 4 specifically survives (the first one the old cap would have clobbered).
    check("Universe 4 addressable (beyond legacy cap of 4)",
          4 in driver._universes and driver._universes[4][0] == 50,
          f"u4 ch0={driver._universes.get(4, [None])[0]}")

    # Out-of-range universe is rejected, not wrapped.
    bad = await driver.send({"universe": 99999, "channels": {0: 1}})
    check("Out-of-range universe rejected", bad is False, f"send returned {bad}")

    await driver.disconnect()


# ── Criteria 2 + 3: real audio file drives beats via librosa/numpy ─────────────
def _write_click_track(path: Path, bpm: float = 120.0, seconds: float = 8.0,
                       sr: int = 22050) -> None:
    """Write a real WAV metronome: short tone bursts at a known tempo."""
    total = int(seconds * sr)
    interval = int(sr * 60.0 / bpm)         # samples between clicks
    burst = int(sr * 0.03)                  # 30 ms click
    samples = [0.0] * total
    for start in range(0, total, interval):
        for n in range(burst):
            i = start + n
            if i < total:
                env = 1.0 - (n / burst)     # decaying envelope
                samples[i] = 0.9 * env * math.sin(2 * math.pi * 1000 * n / sr)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples)
        w.writeframes(frames)


def test_audio_beats() -> None:
    from api.routes import audio as audio_route

    tmp = Path(tempfile.mkdtemp())
    wav = tmp / "clicktrack_120.wav"
    _write_click_track(wav, bpm=120.0, seconds=8.0)
    check("Real WAV file created on disk", wav.exists() and wav.stat().st_size > 1000,
          f"size={wav.stat().st_size if wav.exists() else 0}")

    job_id = "testjob1"
    audio_route._jobs[job_id] = {
        "job_id": job_id, "filename": wav.name, "stored_name": wav.name,
        "size_bytes": wav.stat().st_size, "status": "queued",
        "created_at": time.time(), "result": None, "error": None,
    }
    # Run the real analysis pipeline used by the /audio/upload background task.
    audio_route._analyze_audio(job_id, wav)

    job = audio_route._jobs[job_id]
    check("Analysis completed", job.get("status") == "complete",
          f"status={job.get('status')} error={job.get('error')}")

    result = job.get("result") or {}
    beats = result.get("beats") or []
    check("Real audio drives beat markers", len(beats) > 0, f"beat_count={len(beats)}")
    check("Beats carry timing + type", bool(beats) and "time" in beats[0] and "type" in beats[0],
          f"first_beat={beats[0] if beats else None}")

    # bpm_confidence 0.92 is set ONLY on the librosa path; the estimate uses 0.75.
    check("librosa/numpy path was used (not the estimate fallback)",
          abs(result.get("bpm_confidence", 0) - 0.92) < 1e-6,
          f"bpm_confidence={result.get('bpm_confidence')}")

    # Detected tempo should land near the 120 BPM we synthesised (allow octave error).
    bpm = result.get("bpm", 0)
    near = any(abs(bpm - t) < 6 for t in (60, 120, 240))
    check("Detected BPM matches the real click track (~120)", near, f"bpm={bpm}")


def main() -> int:
    asyncio.run(test_multiuniverse())
    test_audio_beats()

    print("\n" + "=" * 70)
    print("AQ-S1-005 Multi-Universe + Audio End-to-End — Verification")
    print("=" * 70)
    passed = 0
    for name, status, detail in results:
        mark = "[PASS]" if status == PASS else "[FAIL]"
        line = f"{mark} {name}"
        if status == FAIL and detail:
            line += f"  --> {detail}"
        print(line)
        if status == PASS:
            passed += 1
    total = len(results)
    print("-" * 70)
    print(f"{passed}/{total} checks passed")
    print("=" * 70)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
