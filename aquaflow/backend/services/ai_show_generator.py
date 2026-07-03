"""
ai_show_generator.py — AquaFlow Stage 3, Priority 1 (AQ-S3-001)

AI show generator: turn a natural-language prompt / mood description into a
*playable* fountain show timeline.

Pipeline:
  1. interpret_prompt(text) — parse free text into a ShowIntent: mood, energy,
     tempo (bpm), duration, requested effects (flame/fog/laser/lighting/water),
     colour palette, and a show name.
  2. generate_show(...) — turn the intent into a timeline of tracks + clips laid
     out over a mood-shaped energy arc, in the canonical AquaFlow show payload
     shape (`{show, timelineTracks}`) that ShowEngine.load_show consumes directly.

Deterministic: the same prompt always yields the same show (RNG seeded from the
prompt), so results are reproducible and testable.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from typing import Optional

# ── Mood lexicon ───────────────────────────────────────────────────────────────
# Each mood maps to a base energy (0..1), a default tempo, an effect emphasis and
# a colour palette. Keywords are matched against the prompt to infer the mood.
MOOD_PROFILES = {
    "calm": {
        "energy": 0.32, "bpm": 74, "palette": ["#0a3d62", "#3c6382", "#60a3bc", "#82ccdd"],
        "effects": {"fog": True}, "keywords": [
            "calm", "serene", "zen", "peaceful", "tranquil", "relaxing", "gentle",
            "soothing", "meditative", "ambient", "quiet", "still"]},
    "romantic": {
        "energy": 0.46, "bpm": 90, "palette": ["#6d214f", "#b33771", "#e056a0", "#f8a5c2"],
        "effects": {"fog": True}, "keywords": [
            "romantic", "romance", "intimate", "elegant", "wedding", "love",
            "tender", "warm", "sunset", "candlelit", "dreamy"]},
    "playful": {
        "energy": 0.7, "bpm": 118, "palette": ["#f6b93b", "#e55039", "#4a69bd", "#78e08f"],
        "effects": {"fog": True}, "keywords": [
            "playful", "fun", "whimsical", "joyful", "happy", "cheerful",
            "bouncy", "lighthearted", "quirky"]},
    "energetic": {
        "energy": 0.88, "bpm": 128, "palette": ["#12CBC4", "#0652DD", "#FDA7DF", "#ED4C67"],
        "effects": {"fog": True, "laser": True}, "keywords": [
            "energetic", "party", "celebration", "festive", "upbeat", "lively",
            "exciting", "high-energy", "high energy", "dance", "club", "vibrant", "pump"]},
    "dramatic": {
        "energy": 0.92, "bpm": 108, "palette": ["#1B1464", "#5758BB", "#B53471", "#EA2027"],
        "effects": {"fog": True, "flame": True}, "keywords": [
            "dramatic", "epic", "cinematic", "powerful", "grand", "intense",
            "majestic", "monumental", "aggressive", "bold", "film", "movie"]},
    "mysterious": {
        "energy": 0.55, "bpm": 96, "palette": ["#2C3A47", "#4b6584", "#341f97", "#5f27cd"],
        "effects": {"fog": True, "laser": True}, "keywords": [
            "mysterious", "mystery", "dark", "moody", "enigmatic", "haunting",
            "eerie", "shadowy", "noir"]},
    "patriotic": {
        "energy": 0.8, "bpm": 116, "palette": ["#EA2027", "#ffffff", "#1B1464", "#EA2027"],
        "effects": {"fog": True, "flame": True}, "keywords": [
            "patriotic", "national", "independence", "anthem", "military", "parade"]},
}
DEFAULT_MOOD = "energetic"

EFFECT_KEYWORDS = {
    "flame": ["flame", "fire", "burst", "pyro", "inferno", "blaze"],
    "fog": ["fog", "mist", "haze", "smoke", "cloud"],
    "laser": ["laser", "beam", "sci-fi", "scifi"],
    "lighting": ["light", "colour", "color", "rgb", "rainbow", "neon", "glow"],
    "water": ["water", "jet", "fountain", "spray", "geyser", "cascade"],
}

TRACK_COLORS = {
    "pump": "#00d4ff", "lighting": "#f59e0b", "flame": "#ef4444",
    "fog": "#6b7280", "laser": "#f97316",
}

# Mood-shaped energy arc: (label, rel_start, rel_end, energy_multiplier).
SHOW_ARC = [
    ("Intro", 0.00, 0.12, 0.35),
    ("Build", 0.12, 0.30, 0.60),
    ("Peak", 0.30, 0.52, 1.00),
    ("Release", 0.52, 0.64, 0.50),
    ("Rise", 0.64, 0.82, 0.90),
    ("Finale", 0.82, 0.94, 1.00),
    ("Outro", 0.94, 1.00, 0.30),
]


@dataclass
class ShowIntent:
    prompt: str
    mood: str
    energy: float
    bpm: float
    duration: float
    effects: dict            # {"flame":bool,"fog":bool,"laser":bool,"lighting":bool,"water":bool}
    palette: list
    name: str
    matched_keywords: list = field(default_factory=list)


# ── Prompt interpretation ──────────────────────────────────────────────────────
def interpret_prompt(text: str, *, duration: Optional[float] = None,
                     bpm: Optional[float] = None, mood: Optional[str] = None) -> ShowIntent:
    p = str(text or "").lower()

    # Mood: explicit override, else best keyword match, else default.
    matched = []
    if mood and mood in MOOD_PROFILES:
        chosen = mood
    else:
        best, best_hits = DEFAULT_MOOD, 0
        for name, prof in MOOD_PROFILES.items():
            hits = [k for k in prof["keywords"] if k in p]
            if len(hits) > best_hits:
                best, best_hits, matched = name, len(hits), hits
        chosen = best
    prof = MOOD_PROFILES[chosen]

    # Tempo: explicit "NNN bpm", else fast/slow modifiers, else mood default.
    resolved_bpm = bpm
    if resolved_bpm is None:
        m = re.search(r"(\d{2,3})\s*bpm", p)
        if m:
            resolved_bpm = float(m.group(1))
        else:
            resolved_bpm = prof["bpm"]
            if any(w in p for w in ("fast", "faster", "upbeat", "rapid", "frenetic")):
                resolved_bpm += 16
            if any(w in p for w in ("slow", "slower", "gentle", "relaxed")):
                resolved_bpm = max(50, resolved_bpm - 18)
    resolved_bpm = max(40, min(200, float(resolved_bpm)))

    # Duration: explicit "N min/sec", else default 120 s.
    resolved_dur = duration
    if resolved_dur is None:
        mmin = re.search(r"(\d+(?:\.\d+)?)\s*(?:min|minute)", p)
        msec = re.search(r"(\d+(?:\.\d+)?)\s*(?:sec|second)", p)
        if mmin:
            resolved_dur = float(mmin.group(1)) * 60.0
        elif msec:
            resolved_dur = float(msec.group(1))
        else:
            resolved_dur = 120.0
    resolved_dur = max(8.0, min(3600.0, float(resolved_dur)))

    # Effects: mood defaults + anything explicitly requested; lighting + water on.
    effects = {"lighting": True, "water": True, "fog": False, "flame": False, "laser": False}
    effects.update(prof.get("effects", {}))
    for eff, kws in EFFECT_KEYWORDS.items():
        if any(k in p for k in kws):
            effects[eff] = True
    # Explicit negation ("no fire", "without flame").
    for eff, kws in EFFECT_KEYWORDS.items():
        if any(f"no {k}" in p or f"without {k}" in p for k in kws):
            effects[eff] = False

    energy = prof["energy"]
    if any(w in p for w in ("max", "maximum", "full power", "all out", "extreme")):
        energy = min(1.0, energy + 0.1)
    if any(w in p for w in ("subtle", "minimal", "understated", "soft")):
        energy = max(0.2, energy - 0.15)

    return ShowIntent(
        prompt=str(text or ""), mood=chosen, energy=round(energy, 3),
        bpm=resolved_bpm, duration=resolved_dur, effects=effects,
        palette=list(prof["palette"]), name=_extract_name(text, chosen),
        matched_keywords=matched,
    )


def _extract_name(text: str, mood: str) -> str:
    if not text:
        return f"{mood.title()} Show"
    # Quoted title or "called/named/titled X".
    q = re.search(r'["“](.+?)["”]', text)
    if q:
        return q.group(1).strip().title()
    m = re.search(r"(?:called|named|titled|title[d]?)\s+([A-Za-z0-9 ]{2,40})", text, re.I)
    if m:
        return m.group(1).strip().title()
    return f"{mood.title()} Fountain Show"


# ── Timeline generation ────────────────────────────────────────────────────────
def generate_show(prompt: str = "", *, duration: Optional[float] = None,
                  bpm: Optional[float] = None, mood: Optional[str] = None,
                  loop: bool = False) -> dict:
    """Generate a playable show payload from a text prompt / parameters."""
    intent = interpret_prompt(prompt, duration=duration, bpm=bpm, mood=mood)
    rng = random.Random(f"{intent.prompt}|{intent.mood}|{intent.bpm}|{intent.duration}")

    sections = []
    for label, rs, re_, mult in SHOW_ARC:
        start = round(rs * intent.duration, 3)
        end = round(re_ * intent.duration, 3)
        if end - start < 0.5:
            continue
        sections.append({"label": label, "start": start, "end": end,
                         "energy": min(1.0, intent.energy * mult)})

    tracks = []
    if intent.effects.get("water", True):
        tracks.append(_track("pump", "AI Water Jets", "pump-01", sections, intent, rng, beats=True))
    if intent.effects.get("lighting", True):
        tracks.append(_track("lighting", "AI RGB Lighting", "light-01", sections, intent, rng, color=True))
    if intent.effects.get("fog"):
        tracks.append(_track("fog", "AI Fog", "fog-01", sections, intent, rng,
                             only_sections={"Intro", "Release", "Outro", "Build"}))
    if intent.effects.get("flame"):
        tracks.append(_track("flame", "AI Flame", "flame-01", sections, intent, rng,
                             only_sections={"Peak", "Finale", "Rise"}, accent=True))
    if intent.effects.get("laser"):
        tracks.append(_track("laser", "AI Laser", "laser-01", sections, intent, rng,
                             only_sections={"Peak", "Rise", "Finale"}))

    show = {
        "id": "ai-show",
        "name": intent.name,
        "bpm": round(intent.bpm, 1),
        "duration": round(intent.duration, 2),
        "loop": bool(loop),
    }
    return {
        "show": show,
        "timelineTracks": tracks,
        "interpretation": {
            "source_prompt": intent.prompt,
            "mood": intent.mood,
            "energy": intent.energy,
            "bpm": round(intent.bpm, 1),
            "duration": round(intent.duration, 2),
            "effects": intent.effects,
            "palette": intent.palette,
            "matched_keywords": intent.matched_keywords,
            "name": intent.name,
        },
        "stats": {
            "track_count": len(tracks),
            "clip_count": sum(len(t["clips"]) for t in tracks),
            "section_count": len(sections),
        },
    }


def _track(ttype, label, device_id, sections, intent: ShowIntent, rng, *,
           beats=False, color=False, accent=False, only_sections=None) -> dict:
    clips = []
    cid = 0
    beat_bar = (60.0 / intent.bpm) * 4  # one bar
    for si, sec in enumerate(sections):
        if only_sections and sec["label"] not in only_sections:
            continue
        base = int(sec["energy"] * 100)
        if ttype == "flame":
            base = min(100, base + 5)      # flame is an accent — punchy
        seg_start, seg_end = sec["start"], sec["end"]
        # Beat-quantised sub-clips for pump; whole-section clips otherwise.
        if beats:
            bars = max(1, int((seg_end - seg_start) / max(beat_bar, 0.5)))
            bar_dur = (seg_end - seg_start) / bars
            for b in range(bars):
                s = round(seg_start + b * bar_dur, 3)
                e = round(s + bar_dur, 3)
                inten = max(8, min(100, base + rng.randint(-8, 8)))
                clips.append(_clip(ttype, cid, s, e, inten, sec, intent, color))
                cid += 1
        elif accent:
            # Short accent bursts at the start of each eligible bar.
            bars = max(1, int((seg_end - seg_start) / max(beat_bar, 0.5)))
            bar_dur = (seg_end - seg_start) / bars
            for b in range(bars):
                s = round(seg_start + b * bar_dur, 3)
                e = round(min(s + min(0.6, bar_dur * 0.4), seg_end), 3)
                if e - s < 0.1:
                    continue
                clips.append(_clip(ttype, cid, s, e, min(100, base + 10), sec, intent, color))
                cid += 1
        else:
            clips.append(_clip(ttype, cid, seg_start, seg_end, base, sec, intent, color))
            cid += 1
    return {
        "id": f"ai-track-{ttype}",
        "label": label, "type": ttype, "deviceId": device_id,
        "color": TRACK_COLORS.get(ttype, "#888888"),
        "clips": clips,
    }


def _clip(ttype, cid, start, end, intensity, sec, intent: ShowIntent, color: bool) -> dict:
    c = {
        "id": f"ai-{ttype}-{cid}",
        "start": round(start, 3),
        "end": round(end, 3),
        "intensity": int(max(0, min(100, intensity))),
        "label": sec["label"],
    }
    if color and intent.palette:
        idx = (hash((sec["label"], cid)) % len(intent.palette))
        c["color"] = intent.palette[idx]
    return c
