"""
choreography_engine.py — AquaFlow Stage 3, Priority 3 (AQ-S3-003)

AI Choreography Engine.

Builds a *full* fountain show timeline from a natural-language prompt and the
*actual designed fixtures*, and supports iterative prompt revisions on an
existing show. Unlike the base AI Show Generator (AQ-S3-001), the choreographer
is fixture-aware and constraint-respecting:

  * it only choreographs track types for which fixtures actually exist,
  * it clamps every clip to each fixture's maximum intensity,
  * it enforces the flame hardware limit (bursts never exceed the max continuous
    on-time; a cooldown gap separates bursts),
  * it supports prompt revisions — "make it calmer", "add lasers at the finale",
    "remove the flames" — applied to an existing timeline with a revision history.

The output is the canonical AquaFlow show payload (`{show, timelineTracks}`) so it
loads directly into the ShowEngine and plays.
"""
from __future__ import annotations

import random
from typing import Optional

from services.ai_show_generator import (
    interpret_prompt, SHOW_ARC, TRACK_COLORS, EFFECT_KEYWORDS,
)

# Hardware flame limit — mirrors ProtocolBus.FLAME_MAX_DURATION (AQ-S1-007).
FLAME_MAX_ON_TIME = 3.0
FLAME_COOLDOWN = 1.0

# Track types that are always choreographed when a fixture exists (vs. effect
# types that are only added when the prompt/mood calls for them).
_ALWAYS = {"pump", "lighting"}
_EFFECT_TYPES = {"flame", "fog", "laser"}

# Sections an effect type is allowed to fire in (choreography discipline).
_EFFECT_SECTIONS = {
    "flame": {"Peak", "Finale", "Rise"},
    "laser": {"Peak", "Rise", "Finale"},
    "fog": {"Intro", "Build", "Release", "Outro"},
}
_TRACK_LABEL = {"pump": "Water Jets", "lighting": "RGB Lighting", "flame": "Flame",
                "fog": "Fog", "laser": "Laser"}
_TRACK_ORDER = {"pump": 0, "lighting": 1, "fog": 2, "laser": 3, "flame": 4}


def derive_track_type(fx: dict) -> str:
    """Map a designed fixture to the timeline track type it drives."""
    t = str(fx.get("type") or fx.get("fixtureType") or "").lower()
    g = str(fx.get("groupId") or fx.get("group") or "").lower()
    s = t + " " + g
    if any(k in s for k in ("light", "rgb", "led", "par", "wash", "spot", "pixel", "flood")):
        return "lighting"
    if any(k in s for k in ("flame", "fire", "burner")):
        return "flame"
    if any(k in s for k in ("fog", "mist", "haze", "smoke")):
        return "fog"
    if any(k in s for k in ("laser", "beam")):
        return "laser"
    # everything watery defaults to the pump track
    return "pump"


def derive_constraints(fixtures: list) -> dict:
    """
    Build per-track-type constraints from the designed fixtures:
      present, count, device_ids, max_intensity (0..1), max_on_time (flame).
    """
    cons: dict = {}
    for fx in fixtures or []:
        if not isinstance(fx, dict):
            continue
        tt = derive_track_type(fx)
        c = cons.setdefault(tt, {
            "present": True, "count": 0, "device_ids": [],
            "max_intensity": 1.0,
            "max_on_time": FLAME_MAX_ON_TIME if tt == "flame" else None,
        })
        c["count"] += 1
        fid = fx.get("id") or fx.get("key") or fx.get("fixtureId")
        if fid:
            c["device_ids"].append(str(fid))
        # Per-fixture max intensity (fraction or percentage).
        eng = fx.get("engineering") or {}
        mi = fx.get("maxIntensity", fx.get("max_intensity", eng.get("maxIntensity")))
        if mi is not None:
            try:
                mi = float(mi)
                if mi > 1.0:
                    mi /= 100.0
                c["max_intensity"] = min(c["max_intensity"], max(0.0, min(1.0, mi)))
            except (TypeError, ValueError):
                pass
        mot = fx.get("maxOnTime", eng.get("maxOnTime"))
        if mot is not None and tt == "flame":
            try:
                c["max_on_time"] = min(c["max_on_time"] or 1e9, float(mot))
            except (TypeError, ValueError):
                pass
    return cons


def _sections(duration: float, energy: float) -> list:
    out = []
    for label, rs, re_, mult in SHOW_ARC:
        start = round(rs * duration, 3)
        end = round(re_ * duration, 3)
        if end - start < 0.5:
            continue
        out.append({"label": label, "start": start, "end": end,
                    "energy": min(1.0, energy * mult)})
    return out


def _pct(x: float) -> int:
    return int(max(0, min(100, round(x))))


def _build_track(track_type: str, sections: list, bpm: float, energy: float,
                 palette: list, constraint: dict, rng: random.Random) -> dict:
    """Build one constraint-respecting track of clips over the sections."""
    cap = float(constraint.get("max_intensity", 1.0))  # 0..1
    device_id = (constraint.get("device_ids") or [f"{track_type}-01"])[0]
    clips = []
    cid = 0
    bar = (60.0 / max(bpm, 1e-6)) * 4

    for sec in sections:
        base = _pct(sec["energy"] * 100 * cap)
        if track_type in _EFFECT_TYPES and sec["label"] not in _EFFECT_SECTIONS.get(track_type, set()):
            continue

        if track_type == "flame":
            # Bursts that never exceed the hardware max on-time, cooldown between.
            max_on = float(constraint.get("max_on_time") or FLAME_MAX_ON_TIME)
            t = sec["start"]
            while t < sec["end"] - 0.05:
                burst = min(max_on, sec["end"] - t)
                if burst < 0.1:
                    break
                clips.append(_clip(track_type, cid, t, t + burst, min(base + 5, _pct(100 * cap)),
                                   sec, palette))
                cid += 1
                t += burst + FLAME_COOLDOWN
        elif track_type == "pump":
            # Beat-quantised, contiguous → full coverage of the timeline.
            bars = max(1, int((sec["end"] - sec["start"]) / max(bar, 0.5)))
            bd = (sec["end"] - sec["start"]) / bars
            for b in range(bars):
                s = round(sec["start"] + b * bd, 3)
                e = round(s + bd, 3)
                inten = min(_pct(base + rng.randint(-6, 6)), _pct(100 * cap))
                clips.append(_clip(track_type, cid, s, e, inten, sec, palette))
                cid += 1
        else:
            # lighting / fog / laser: one clip per (eligible) section.
            clips.append(_clip(track_type, cid, sec["start"], sec["end"], base, sec, palette))
            cid += 1

    return {
        "id": f"choreo-track-{track_type}",
        "label": f"AI {_TRACK_LABEL.get(track_type, track_type.title())}",
        "type": track_type,
        "deviceId": device_id,
        "color": TRACK_COLORS.get(track_type, "#888888"),
        "clips": clips,
    }


def _clip(track_type, cid, start, end, intensity, sec, palette) -> dict:
    c = {
        "id": f"choreo-{track_type}-{cid}",
        "start": round(start, 3),
        "end": round(end, 3),
        "intensity": _pct(intensity),
        "label": sec["label"],
    }
    if track_type == "lighting" and palette:
        c["color"] = palette[(cid) % len(palette)]
    return c


def _tracks_to_build(intent, cons: dict) -> list:
    """Which track types to choreograph: present 'always' types + requested,
    present effect types. Absent fixture types are never choreographed."""
    want = []
    for tt in cons.keys():
        if tt in _ALWAYS:
            want.append(tt)
        elif tt in _EFFECT_TYPES and intent.effects.get(tt, False):
            want.append(tt)
    want.sort(key=lambda t: _TRACK_ORDER.get(t, 9))
    return want


def generate_choreography(prompt: str = "", fixtures: Optional[list] = None, *,
                          duration: Optional[float] = None, bpm: Optional[float] = None,
                          mood: Optional[str] = None, loop: bool = False) -> dict:
    """Generate a full, fixture-aware, constraint-respecting show timeline."""
    fixtures = fixtures or []
    intent = interpret_prompt(prompt, duration=duration, bpm=bpm, mood=mood)
    cons = derive_constraints(fixtures)
    rng = random.Random(f"{intent.prompt}|{intent.mood}|{len(fixtures)}|{intent.duration}")
    sections = _sections(intent.duration, intent.energy)

    warnings = []
    for tt in _EFFECT_TYPES:
        if intent.effects.get(tt) and tt not in cons:
            warnings.append(f"Prompt requested {tt} but no {tt} fixture is present — skipped.")

    build = _tracks_to_build(intent, cons)
    tracks = [_build_track(tt, sections, intent.bpm, intent.energy, intent.palette, cons[tt], rng)
              for tt in build]

    show = {"id": "choreo-show", "name": intent.name, "bpm": round(intent.bpm, 1),
            "duration": round(intent.duration, 2), "loop": bool(loop)}
    return {
        "show": show,
        "timelineTracks": tracks,
        "interpretation": {
            "source_prompt": intent.prompt, "mood": intent.mood, "energy": intent.energy,
            "bpm": round(intent.bpm, 1), "duration": round(intent.duration, 2),
            "palette": intent.palette, "effects": intent.effects, "name": intent.name,
        },
        "constraints": {tt: {"count": c["count"], "max_intensity": c["max_intensity"],
                             "max_on_time": c["max_on_time"]} for tt, c in cons.items()},
        "warnings": warnings,
        "revisions": [],
        "revisionCount": 0,
        "stats": {"track_count": len(tracks),
                  "clip_count": sum(len(t["clips"]) for t in tracks),
                  "section_count": len(sections),
                  "fixture_types": sorted(cons.keys())},
    }


# ── Prompt revisions ───────────────────────────────────────────────────────────
_REMOVE_VERBS = ("remove", "without", "drop", "kill", "get rid", "take out", "delete", "no ", "lose the")
_ADD_VERBS = ("add", "include", "bring in", "introduce", "with ", "throw in")


def _parse_revision(text: str) -> dict:
    import re
    p = str(text or "").lower()
    intent = {"scale": 1.0, "add": set(), "remove": set(), "bpm": None, "notes": []}

    if any(w in p for w in ("more energetic", "stronger", "intense", "bigger", "punchier",
                            "amplify", "more powerful", "hype", "crank", "louder", "wilder")):
        intent["scale"] = 1.25
    if any(w in p for w in ("calmer", "softer", "gentler", "calm", "quieter", "subtle",
                            "less intense", "tone down", "mellow", "relax", "chill")):
        intent["scale"] = 0.75

    # Parse per clause so "remove the flames and add lasers" is handled correctly.
    clauses = re.split(r"\band\b|[,;+]|\bthen\b|\bbut\b", p)
    for cl in clauses:
        remove_verb = any(v in cl for v in _REMOVE_VERBS)
        add_verb = any(v in cl for v in _ADD_VERBS)
        for eff, kws in EFFECT_KEYWORDS.items():
            tt = "pump" if eff == "water" else eff
            if any(k in cl for k in kws):
                if remove_verb:
                    intent["remove"].add(tt)
                elif add_verb:
                    intent["add"].add(tt)

    mm = re.search(r"(\d{2,3})\s*bpm", p)
    if mm:
        intent["bpm"] = float(mm.group(1))
    elif any(w in p for w in ("faster", "speed up", "quicker")):
        intent["bpm"] = "faster"
    elif any(w in p for w in ("slower", "slow it", "slow down")):
        intent["bpm"] = "slower"
    return intent


def revise_show(show: dict, revision_prompt: str, fixtures: Optional[list] = None) -> dict:
    """
    Apply a natural-language revision to an existing choreography show.
    Respects fixture constraints (cannot add a track with no fixture; clamps to
    max intensity). Records a revision-history entry.
    """
    show = {**show}
    tracks = [dict(t, clips=[dict(c) for c in t.get("clips", [])])
              for t in show.get("timelineTracks", [])]
    rev = _parse_revision(revision_prompt)
    cons = derive_constraints(fixtures) if fixtures is not None else {}
    changes, warnings = [], []

    # 1) Intensity scaling (clamped to fixture caps).
    if rev["scale"] != 1.0:
        for t in tracks:
            cap = float((cons.get(t["type"], {}) or {}).get("max_intensity", 1.0)) if cons else 1.0
            for c in t["clips"]:
                c["intensity"] = _pct(min(c["intensity"] * rev["scale"], 100 * cap))
        changes.append(("scaled intensity x%.2f" % rev["scale"]))

    # 2) Remove tracks.
    if rev["remove"]:
        before = {t["type"] for t in tracks}
        tracks = [t for t in tracks if t["type"] not in rev["remove"]]
        removed = before & rev["remove"]
        for tt in sorted(removed):
            changes.append("removed " + tt + " track")

    # 3) Add tracks (only if a fixture exists for the type).
    interp = show.get("interpretation", {}) or {}
    dur = float(show.get("show", {}).get("duration", interp.get("duration", 120)))
    bpm = float(show.get("show", {}).get("bpm", interp.get("bpm", 120)))
    energy = float(interp.get("energy", 0.7))
    palette = interp.get("palette", [])
    present = {t["type"] for t in tracks}
    for tt in sorted(rev["add"]):
        if tt in present:
            continue
        if fixtures is not None and tt not in cons:
            warnings.append(f"Cannot add {tt} — no {tt} fixture in the design.")
            continue
        constraint = cons.get(tt, {"max_intensity": 1.0, "device_ids": [], "count": 1,
                                   "max_on_time": FLAME_MAX_ON_TIME if tt == "flame" else None})
        rng = random.Random(f"add|{tt}|{revision_prompt}")
        tracks.append(_build_track(tt, _sections(dur, energy), bpm, energy, palette, constraint, rng))
        changes.append("added " + tt + " track")

    # 4) Tempo.
    if rev["bpm"] is not None:
        cur = float(show.get("show", {}).get("bpm", bpm))
        new = rev["bpm"] if isinstance(rev["bpm"], (int, float)) else (cur + 16 if rev["bpm"] == "faster" else max(50, cur - 16))
        show.setdefault("show", {})["bpm"] = round(new, 1)
        changes.append("bpm → %.0f" % new)

    if not changes:
        warnings.append("No actionable revision detected in the prompt.")

    show["timelineTracks"] = tracks
    history = list(show.get("revisions", []))
    n = len(history) + 1
    history.append({"n": n, "prompt": revision_prompt, "changes": changes, "warnings": warnings})
    show["revisions"] = history
    show["revisionCount"] = n
    show["warnings"] = warnings
    show["stats"] = {"track_count": len(tracks),
                     "clip_count": sum(len(t["clips"]) for t in tracks),
                     "revision": n}
    return show
