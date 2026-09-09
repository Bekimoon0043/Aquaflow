"""Site-aware choreography generation for the proven I-CAN fountain.

The generator deliberately emits only the 64 valve positions supported by the
capture and legacy database.  Suspected VFD, pump and fire groups never come from
free-form text or music analysis.  The one permitted support state is immutable and
was copied byte-for-byte from the sequence that operated the real fountain.
"""
from __future__ import annotations

import re
from typing import Iterable

from engine.ican_manual_patterns import (
    CAPTURED_GROUP17_SUPPORT,
    MAX_STEPS,
    MAX_TOTAL_MS,
    MIN_STEP_MS,
    normalize_pattern,
)


STYLES = ("wave", "reverse-wave", "center-out", "edges-in", "alternate", "pulse", "cascade", "calm", "dramatic")


def _empty_groups(*, support: bool) -> dict[str, list[int]]:
    return {
        "1": [], "2": [], "9": [],
        "17": list(CAPTURED_GROUP17_SUPPORT) if support else [],
        "25": [],
    }


def valve_groups(indices: Iterable[int], *, support: bool = True) -> dict[str, list[int]]:
    """Translate legacy valve positions 1..64 to captured group/channel states."""
    groups = _empty_groups(support=support)
    for value in sorted({int(item) for item in indices if 1 <= int(item) <= 64}):
        if value <= 32:
            groups["1"].append(value + 8)
        else:
            groups["9"].append(value - 24)
    return groups


def infer_style(prompt: str, requested: str | None = None) -> str:
    if requested in STYLES:
        return requested
    text = (prompt or "").lower()
    rules = [
        (("reverse", "right to left", "rtl"), "reverse-wave"),
        (("center", "centre", "inside out"), "center-out"),
        (("edge", "outside in"), "edges-in"),
        (("alternate", "alternating", "odd", "even"), "alternate"),
        (("pulse", "beat", "strobe"), "pulse"),
        (("cascade", "chase", "running"), "cascade"),
        (("calm", "gentle", "slow", "soft"), "calm"),
        (("dramatic", "powerful", "big", "finale"), "dramatic"),
    ]
    for words, style in rules:
        if any(word in text for word in words):
            return style
    return "wave"


def _state(style: str, phase: int, energy: float) -> set[int]:
    energy = max(0.0, min(1.0, float(energy)))
    width = max(4, min(32, 4 + int(round(energy * 28))))
    if style == "pulse":
        # Keep a relief path open between full pulses. If group 17 contains pump
        # support, an all-valves-closed beat could dead-head it and repeatedly cycle it.
        return set(range(1, 65)) if phase % 2 == 0 else set(range(1, 65, 2))
    if style == "alternate":
        return set(range(1 + phase % 2, 65, 2))
    if style == "center-out":
        half = max(2, width // 2)
        return set(range(max(1, 33 - half), min(64, 32 + half) + 1))
    if style == "edges-in":
        half = max(2, width // 2)
        return set(range(1, half + 1)) | set(range(65 - half, 65))
    if style == "calm":
        bank = phase % 4
        return set(range(bank * 16 + 1, bank * 16 + 9))
    if style == "dramatic":
        if phase % 4 == 3:
            return set(range(1, 65))
        return set(range(1, 65, 2)) if phase % 2 else set(range(2, 65, 2))
    block = max(6, min(16, width))
    start = (phase * (8 if style == "cascade" else 16)) % 64
    values = {((start + offset) % 64) + 1 for offset in range(block)}
    if style == "reverse-wave":
        return {65 - value for value in values}
    return values


def _energy_at(analysis: dict | None, time_s: float, duration_s: float) -> float:
    profile = (analysis or {}).get("energy_profile") or []
    if not profile or duration_s <= 0:
        return 0.65
    index = min(len(profile) - 1, max(0, int(time_s / duration_s * len(profile))))
    try:
        return float(profile[index])
    except (TypeError, ValueError):
        return 0.65


def _boundaries(duration_s: float, bpm: float, analysis: dict | None) -> list[float]:
    duration_s = max(0.1, min(MAX_TOTAL_MS / 1000, float(duration_s)))
    beats = []
    for beat in (analysis or {}).get("beats", []):
        try:
            value = float(beat.get("time") if isinstance(beat, dict) else beat)
        except (TypeError, ValueError):
            continue
        if 0 <= value <= duration_s:
            beats.append(value)
    # One state per musical bar. This preserves musical phrasing and stays under the
    # 500-step hardware limit for the six three-to-six-minute legacy tracks.
    if len(beats) >= 8:
        points = sorted(set([0.0] + beats[::4] + [duration_s]))
    else:
        bar_s = max(0.4, 240.0 / max(40.0, min(240.0, float(bpm or 120))))
        points = [0.0]
        while points[-1] + bar_s < duration_s:
            points.append(points[-1] + bar_s)
        points.append(duration_s)
    if len(points) - 1 > MAX_STEPS:
        stride = (len(points) - 2) // (MAX_STEPS - 1) + 1
        points = points[::stride]
        if points[-1] != duration_s:
            points.append(duration_s)
    return points


def generate_site_pattern(*, prompt: str, duration_s: float = 60.0, bpm: float = 120.0,
                          style: str | None = None, analysis: dict | None = None,
                          include_proven_support: bool = True, name: str | None = None) -> dict:
    selected_style = infer_style(prompt, style)
    if analysis:
        duration_s = float(analysis.get("duration") or duration_s)
        bpm = float(analysis.get("bpm") or bpm)
    points = _boundaries(duration_s, bpm, analysis)
    steps = []
    carry_ms = 0
    for index, (start, end) in enumerate(zip(points, points[1:])):
        duration_ms = int(round((end - start) * 1000)) + carry_ms
        if duration_ms < MIN_STEP_MS:
            carry_ms = duration_ms
            continue
        carry_ms = 0
        energy = _energy_at(analysis, start, duration_s)
        states = _state(selected_style, index, energy)
        steps.append({"duration_ms": duration_ms, "groups": valve_groups(states, support=include_proven_support)})
    if carry_ms and steps:
        steps[-1]["duration_ms"] += carry_ms
    if not steps:
        steps = [{"duration_ms": MIN_STEP_MS, "groups": valve_groups([], support=include_proven_support)}]
    prompt_text = (prompt or "").lower()
    if any(word in prompt_text for word in ("finale", "big ending", "strong ending")):
        steps[-1]["groups"] = valve_groups(range(1, 65), support=include_proven_support)
    elif any(word in prompt_text for word in ("blackout ending", "fade to off", "end off")):
        steps[-1]["groups"] = valve_groups([], support=False)
    title = name or re.sub(r"\s+", " ", (prompt or "AI Site Pattern").strip())[:60]
    pattern = {
        "name": title or "AI Site Pattern",
        "description": f"Site-safe {selected_style} choreography at {bpm:.1f} BPM.",
        "steps": steps,
        "provenance": {
            "kind": "site-ai-prompt" if not analysis else "site-audio-analysis",
            "prompt": (prompt or "")[:500],
            "style": selected_style,
        },
        "music": {
            "filename": (analysis or {}).get("filename", ""),
            "duration_s": round(float(duration_s), 3),
            "bpm": round(float(bpm), 2),
            "analysis_method": (analysis or {}).get("analysis_method", "operator-bpm"),
        },
        "safety": {
            "designable_outputs": "legacy valves 1-64 only",
            "commissioning_locked_groups": [2, 25],
            "support_mode": "exact-proven-state" if include_proven_support else "off",
            "arbitrary_pump_or_frequency_commands": False,
        },
    }
    return normalize_pattern(pattern)
