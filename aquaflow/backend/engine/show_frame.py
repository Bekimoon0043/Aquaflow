"""Canonical evaluated show frame - Python mirror of frontend/src/show/evaluateShowFrame.js.

AF-NEXT-004. The Siemens runtime evaluates every PLC frame through this module so the
PLC follows exactly what the timeline and the 3D preview show. Keep it line-for-line
equivalent to the JavaScript module; the golden parity tests
(frontend/src/show/__tests__/golden/golden-show.json, tests/test_show_frame.py) fail
when the two drift.

Policies (see docs/AF-NEXT-005-timing.md):
* active window is half-open: start <= t < end, end = start + duration;
* fade factor = shape(min(1, (t-start)/fadeIn, (end-t)/fadeOut)) with shapes
  linear / ease-in / ease-out / ease-in-out / step;
* overlapping clips on one fixture+channel: highest takes precedence, ties go to the
  clip later in the list; overlaps are reported as diagnostics;
* lights: active RGB channel clips define the colour, otherwise the master clip
  colour (white if absent); master is 1.0 when only RGB channels play;
* stop / end of range / blackout produce an all-off frame.

Pure: no I/O, no hardware access.
"""
from __future__ import annotations

import math
import re

SHOW_FRAME_VERSION = "1.0.0"
SHOW_FRAME_CONTRACT = "aquaflow-show-frame"
FRAME_TOLERANCE = 1 / 255
CURVES = ("linear", "ease-in", "ease-out", "ease-in-out", "step")
_CURVE_ALIASES = {
    "": "linear", "linear": "linear",
    "ease-in": "ease-in", "ease_in": "ease-in", "easein": "ease-in",
    "ease-out": "ease-out", "ease_out": "ease-out", "easeout": "ease-out",
    "ease-in-out": "ease-in-out", "ease_in_out": "ease-in-out", "ease_both": "ease-in-out",
    "ease-both": "ease-in-out", "step": "step",
}
LIGHT_CHANNELS = ("lighting_red", "lighting_green", "lighting_blue")
_MASTER_TYPES = ("lighting_master", "device_intensity")
_MOTION_POSITION = {"motion_pan", "motion_tilt", "motion_angle"}
_WATER_MOTION_SOURCES = {"device_intensity", "device_enable", "solenoid_open", "motion_intensity", "pump_speed"}
_KINDS = {"water", "light", "pump", "valve", "effect", "equipment"}
_DEFAULT_LIGHT = "#ffffff"
_BUCKET_SECONDS = 1

_EQUIPMENT = ("pump", "valve", "filter", "sensor", "control", "controller", "panel", "plc", "vfd", "manifold",
              "air_compressor", "compressor", "air_tank", "tank", "chemical", "dosing", "uv", "junction", "power",
              "cable", "pipe", "return", "drain", "supply")
_EFFECT = ("flame", "fire", "fog", "smoke", "haze", "fog_machine", "smoke_machine", "laser", "laser_", "co2",
           "spark", "special_fx", "effect_")
_LIGHT = ("light", "rgb", "rgbw", "led", "moving_head", "spot", "spotlight", "underwater")


def _finite(value, fallback=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _clamp(value, low, high):
    return max(low, min(high, value))


def _clamp01(value):
    return _clamp(value, 0.0, 1.0)


# ─── curves and envelopes ─────────────────────────────────────────────────

def normalize_curve(raw):
    key = str("" if raw is None else raw).strip().lower()
    return _CURVE_ALIASES.get(key)


def shape_ramp(curve, x):
    t = _clamp01(x)
    if curve == "ease-in":
        return t * t
    if curve == "ease-out":
        return 1 - (1 - t) * (1 - t)
    if curve == "ease-in-out":
        return 2 * t * t if t < 0.5 else 1 - math.pow(-2 * t + 2, 2) / 2
    if curve == "step":
        return 0.0 if t < 0.5 else 1.0  # switches at the middle of each ramp
    return t


def fade_factor(clip, t):
    if not (clip["start"] <= t < clip["end"]):
        return 0.0
    ramp = 1.0
    if clip["fadeIn"] > 0:
        ramp = min(ramp, (t - clip["start"]) / clip["fadeIn"])
    if clip["fadeOut"] > 0:
        ramp = min(ramp, (clip["end"] - t) / clip["fadeOut"])
    return shape_ramp(clip["curve"], min(1.0, ramp))


def clip_level(clip, t):
    return _clamp01(clip["value"] / 100 * fade_factor(clip, t))


# ─── colour ────────────────────────────────────────────────────────────

def valid_hex(value):
    return str(value).lower() if isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value) else None


def hex_to_srgb(value):
    h = valid_hex(value)
    if not h:
        return None
    return {"r": int(h[1:3], 16) / 255, "g": int(h[3:5], 16) / 255, "b": int(h[5:7], 16) / 255}


def _round_half_up(value):
    return int(math.floor(value + 0.5))


def srgb_to_hex(srgb):
    return "#" + "".join(f"{_round_half_up(_clamp01(srgb[k]) * 255):02x}" for k in ("r", "g", "b"))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else math.pow((c + 0.055) / 1.055, 2.4)


def _color_record(srgb, source):
    return {"hex": srgb_to_hex(srgb), "srgb": dict(srgb),
            "linear": {k: srgb_to_linear(srgb[k]) for k in ("r", "g", "b")}, "source": source}


# ─── tempo map ─────────────────────────────────────────────────────────

def normalize_tempo(tempo):
    entries = []
    for entry in tempo or []:
        time, bpm = _finite((entry or {}).get("time"), float("nan")), _finite((entry or {}).get("bpm"), float("nan"))
        if math.isfinite(time) and time >= 0 and 20 <= bpm <= 300:
            entries.append({"time": time, "bpm": bpm})
    entries.sort(key=lambda e: e["time"])
    if not entries or entries[0]["time"] > 0:
        entries.insert(0, {"time": 0.0, "bpm": entries[0]["bpm"] if entries else 120.0})
    return entries


def beats_to_seconds(tempo, beat):
    tempo_map = normalize_tempo(tempo)
    beats = 0.0
    for i, entry in enumerate(tempo_map):
        nxt = tempo_map[i + 1] if i + 1 < len(tempo_map) else None
        segment = (nxt["time"] - entry["time"]) * entry["bpm"] / 60 if nxt else math.inf
        if beat <= beats + segment:
            return entry["time"] + (beat - beats) * 60 / entry["bpm"]
        beats += segment
    return 0.0


# ─── mute / solo ───────────────────────────────────────────────────────

def group_inherits(groups, group_id, flag):
    seen, group = set(), groups.get(group_id)
    while group and group.get("id") not in seen:
        if group.get(flag):
            return True
        seen.add(group.get("id"))
        group = groups.get(group.get("parentId"))
    return False


def recipe_audible(recipe, groups):
    if not recipe or recipe.get("muted"):
        return False
    if group_inherits(groups, recipe.get("groupId"), "muted"):
        return False
    has_solo = any(g.get("solo") for g in groups.values())
    return not has_solo or group_inherits(groups, recipe.get("groupId"), "solo")


# ─── kinds ─────────────────────────────────────────────────────────────

def _classify_type(type_string):
    k = str(type_string or "").strip().lower()
    if not k:
        return "nozzle"
    if any(w in k for w in _EQUIPMENT):
        return "equipment"
    if any(w in k for w in _EFFECT):
        return "effect"
    if any(w in k for w in _LIGHT):
        return "light"
    return "nozzle"


def fixture_kind(fixture, channel_types=()):
    explicit = (fixture or {}).get("kind")
    if explicit in _KINDS:
        return explicit
    if fixture and fixture.get("type"):
        category, text = _classify_type(fixture["type"]), str(fixture["type"]).lower()
        if category == "light":
            return "light"
        if category == "effect":
            return "effect"
        if category == "equipment":
            return "pump" if "pump" in text else "valve" if "valve" in text else "equipment"
        return "water"
    types = set(channel_types)
    if any(str(t).startswith("lighting_") for t in types):
        return "light"
    if types and all(t in ("pump_speed", "pump_pressure") for t in types):
        return "pump"
    if types and all(t == "solenoid_open" for t in types):
        return "valve"
    return "water"


# ─── preparation ───────────────────────────────────────────────────────

def _normalize_clip(raw, index, tempo, diagnostics):
    if raw.get("startBeat") is not None and raw.get("startTime") is None and raw.get("start") is None:
        start_beat = _finite(raw.get("startBeat"), float("nan"))
        start = beats_to_seconds(tempo, start_beat)
        end = beats_to_seconds(tempo, start_beat + _finite(raw.get("durationBeats"), 0))
    else:
        start = _finite(raw.get("startTime", raw.get("start", 0)), float("nan"))
        if raw.get("end") is not None and raw.get("startTime") is None:
            end = _finite(raw.get("end"), float("nan"))
        else:
            end = start + _finite(raw.get("duration"), float("nan"))
    value = _finite(raw.get("value", 100), float("nan"))
    if not all(math.isfinite(v) for v in (start, end, value)) or end <= start or not raw.get("fixtureId"):
        diagnostics.append({"code": "invalid-clip", "severity": "error", "clipId": raw.get("id"),
                            "fixtureId": raw.get("fixtureId"), "message": "Invalid timing, value or fixture; ignored."})
        return None
    curve = normalize_curve(raw.get("curveType"))
    if curve is None:
        diagnostics.append({"code": "unsupported-curve", "severity": "warning", "clipId": raw.get("id"),
                            "curve": raw.get("curveType"), "message": "Unsupported curve evaluated as linear."})
    return {
        "index": index, "id": raw.get("id", f"clip-{index}"), "fixtureId": raw["fixtureId"],
        "type": str(raw.get("type") or "device_intensity"), "start": start, "end": end, "value": value,
        "fadeIn": max(0.0, _finite(raw.get("fadeIn"))), "fadeOut": max(0.0, _finite(raw.get("fadeOut"))),
        "curve": curve or "linear", "color": valid_hex(raw.get("color")),
        "pan": _finite(raw.get("pan")), "tilt": _finite(raw.get("tilt")),
        "recipeId": raw.get("studioRecipeId", raw.get("patternBlockId")), "trackId": raw.get("trackId"),
    }


def _find_overlaps(clips):
    by_key = {}
    for clip in clips:
        by_key.setdefault((clip["fixtureId"], clip["type"]), []).append(clip)
    overlaps = []
    for items in by_key.values():
        if len(items) < 2:
            continue
        open_clips = []
        for clip in sorted(items, key=lambda c: (c["start"], c["index"])):
            open_clips = [o for o in open_clips if o["end"] > clip["start"] + 1e-9]
            for other in open_clips:
                end = min(other["end"], clip["end"])
                overlaps.append({"code": "overlap", "severity": "warning", "fixtureId": clip["fixtureId"],
                                 "channel": clip["type"], "clipIds": [other["id"], clip["id"]],
                                 "startMs": round(clip["start"] * 1000), "endMs": round(end * 1000),
                                 "start": clip["start"], "end": end,
                                 "message": "Overlapping clips on one output: highest takes precedence in preview; "
                                            "the Siemens compiler rejects this."})
            open_clips.append(clip)
    return overlaps


def prepare_show(project):
    diagnostics = []
    tempo = normalize_tempo(project.get("tempo"))
    groups = {g["id"]: g for g in project.get("groups") or [] if isinstance(g, dict) and "id" in g}
    recipes = {r["id"]: r for r in project.get("recipes") or [] if isinstance(r, dict) and "id" in r}
    audible, clips = {}, []
    for index, raw in enumerate(project.get("clips") or []):
        if not isinstance(raw, dict) or raw.get("muted") is True or raw.get("disabled") is True or raw.get("isMuted") is True:
            continue
        recipe_id = raw.get("studioRecipeId")
        if recipe_id and recipe_id in recipes:
            if recipe_id not in audible:
                audible[recipe_id] = recipe_audible(recipes[recipe_id], groups)
            if not audible[recipe_id]:
                continue
        elif raw.get("groupId") and groups and not recipe_audible({"groupId": raw["groupId"]}, groups):
            continue
        clip = _normalize_clip(raw, index, tempo, diagnostics)
        if clip:
            clips.append(clip)
    known = {f["id"]: f for f in project.get("fixtures") or [] if isinstance(f, dict) and "id" in f}
    channel_types = {}
    for clip in clips:
        channel_types.setdefault(clip["fixtureId"], set()).add(clip["type"])
        if known and clip["fixtureId"] not in known:
            diagnostics.append({"code": "missing-fixture", "severity": "warning", "clipId": clip["id"],
                                "fixtureId": clip["fixtureId"], "message": "Fixture is not in the project."})
    fixture_ids = list(dict.fromkeys([*known.keys(), *(c["fixtureId"] for c in clips)]))
    kinds = {fid: fixture_kind(known.get(fid), channel_types.get(fid, ())) for fid in fixture_ids}
    motion = {fid for fid in fixture_ids
              if str((known.get(fid) or {}).get("type", "")).startswith("motion")
              or any(t in _MOTION_POSITION for t in channel_types.get(fid, ()))}
    buckets = {}
    for clip in clips:
        for bucket in range(math.floor(clip["start"] / _BUCKET_SECONDS), math.floor(clip["end"] / _BUCKET_SECONDS) + 1):
            buckets.setdefault(bucket, []).append(clip)
    overlaps = _find_overlaps(clips)
    duration = _finite(project.get("duration"), 0)
    if duration <= 0:
        duration = max((c["end"] for c in clips), default=0.0)
    sections = [{"id": s.get("id"), "start": float(s["start"]), "end": float(s["end"])}
                for s in project.get("sections") or []
                if isinstance(s, dict) and math.isfinite(_finite(s.get("start"), float("nan")))
                and _finite(s.get("end"), float("nan")) > _finite(s.get("start"), float("nan"))]
    return {"clips": clips, "buckets": buckets, "fixture_ids": fixture_ids, "kinds": kinds, "motion": motion,
            "duration": duration, "sections": sections, "diagnostics": diagnostics + overlaps, "overlaps": overlaps}


def show_diagnostics(project):
    return [dict(d) for d in prepare_show(project)["diagnostics"]]


# ─── play range ────────────────────────────────────────────────────────

def resolve_play_time(prepared, seconds, opts):
    range_start, range_end, bounded = 0.0, prepared["duration"], False
    section = opts.get("section")
    if section is not None:
        found = section if isinstance(section, dict) else next((s for s in prepared["sections"] if s["id"] == section), None)
        if found:
            range_start, range_end, bounded = float(found["start"]), float(found["end"]), True
    loop = opts.get("loop")
    if isinstance(loop, dict):
        if loop.get("startMs") is not None:
            range_start = float(loop["startMs"]) / 1000
        if loop.get("endMs") is not None:
            range_end = float(loop["endMs"]) / 1000
    t = max(0.0, _finite(seconds))
    if loop:
        start_ms, span_ms = range_start * 1000, (range_end - range_start) * 1000
        repeat = float(loop["repeat"]) if isinstance(loop, dict) and loop.get("repeat") is not None else math.inf
        if not span_ms > 0:
            return t, 1, True
        if t < range_start:
            return t, 1, False
        elapsed_ms = t * 1000 - start_ms
        current = math.floor(elapsed_ms / span_ms)
        if current >= repeat:
            return range_end, int(repeat), True
        return (start_ms + math.fmod(elapsed_ms, span_ms)) / 1000, current + 1, False
    return t, 1, bounded and t >= range_end


# ─── evaluation ────────────────────────────────────────────────────────

def _empty_record(kind, motion):
    record = {"kind": kind, "level": 0.0, "channels": {}, "color": None, "source": None}
    if kind == "light":
        record["color"] = _color_record(hex_to_srgb(_DEFAULT_LIGHT), "default")
        record["output"] = {"r": 0.0, "g": 0.0, "b": 0.0}
    if motion:
        record["motion"] = {"pan": 0.0, "tilt": 0.0}
    return record


def _source(clip):
    return {"clipId": clip["id"], "recipeId": clip["recipeId"], "trackId": clip["trackId"]} if clip else None


def _better(win, best):
    return best is None or win["level"] > best["level"] or (
        win["level"] == best["level"] and win["clip"]["index"] > best["clip"]["index"])


def evaluate_show_frame_at(project, seconds, opts=None, prepared=None):
    """Evaluate at `seconds` of absolute show time. Pass `prepared` to reuse an index."""
    opts = opts or {}
    prepared = prepared or prepare_show(project)
    show_time, pass_index, ended = resolve_play_time(prepared, seconds, opts)
    state = ("blackout" if opts.get("blackout") or project.get("blackout") else
             "stopped" if opts.get("stopped") else "ended" if ended else "playing")
    fixtures, pumps, valves, winners, poses, diagnostics = {}, {}, {}, {}, {}, []
    t = show_time
    if state == "playing":
        for clip in prepared["buckets"].get(math.floor(t / _BUCKET_SECONDS), []):
            if not (clip["start"] <= t < clip["end"]):
                continue
            level = clip_level(clip, t)
            channels = winners.setdefault(clip["fixtureId"], {})
            current = channels.get(clip["type"])
            if current is None or level >= current["level"]:
                channels[clip["type"]] = {"level": level, "clip": clip}
            if clip["fixtureId"] in prepared["motion"]:
                pose = poses.setdefault(clip["fixtureId"], {"pan": 0.0, "tilt": 0.0})
                if clip["type"] in _WATER_MOTION_SOURCES:
                    pose["pan"], pose["tilt"] = _clamp(clip["pan"], -45, 45), _clamp(clip["tilt"], -45, 45)
                elif clip["type"] in _MOTION_POSITION:
                    pose["tilt" if clip["type"] == "motion_tilt" else "pan"] = _clamp(clip["value"], -45, 45)
        diagnostics.extend(dict(o) for o in prepared["overlaps"] if o["start"] <= t < o["end"])
    else:
        diagnostics.append({"code": state, "severity": "info", "message": f"{state}: every output is off."})
    for fid in prepared["fixture_ids"]:
        kind = prepared["kinds"][fid]
        record = _empty_record(kind, fid in prepared["motion"])
        channels = winners.get(fid)
        if channels:
            best = None
            for channel_type, win in channels.items():
                record["channels"][channel_type] = win["level"]
                if _better(win, best):
                    best = win
            if kind == "light":
                master = None
                for channel_type in _MASTER_TYPES:
                    win = channels.get(channel_type)
                    if win and _better(win, master):
                        master = win
                rgb = any(c in channels for c in LIGHT_CHANNELS)
                record["level"] = master["level"] if master else 1.0 if rgb else 0.0
                if rgb:
                    record["color"] = _color_record({
                        "r": channels["lighting_red"]["level"] if "lighting_red" in channels else 0.0,
                        "g": channels["lighting_green"]["level"] if "lighting_green" in channels else 0.0,
                        "b": channels["lighting_blue"]["level"] if "lighting_blue" in channels else 0.0}, "channels")
                elif master and master["clip"]["color"]:
                    record["color"] = _color_record(hex_to_srgb(master["clip"]["color"]), "clip")
                srgb = record["color"]["srgb"]
                record["output"] = {k: srgb[k] * record["level"] for k in ("r", "g", "b")}
                record["source"] = _source((master or best)["clip"])
            else:
                level = 0.0
                for channel_type, win in channels.items():
                    if channel_type not in _MOTION_POSITION:
                        level = max(level, win["level"])
                record["level"] = channels["pump_speed"]["level"] if kind == "pump" and "pump_speed" in channels else level
                color = best["clip"]["color"]
                record["color"] = _color_record(hex_to_srgb(color), "clip") if color else None
                record["source"] = _source(best["clip"])
        if "motion" in record and fid in poses:
            record["motion"] = poses[fid]
        fixtures[fid] = record
        if kind == "pump":
            pumps[fid] = {"speed": record["level"], "run": record["level"] > 0}
        if kind == "valve":
            valves[fid] = {"open": record["level"] > 0}
    return {"contract": SHOW_FRAME_CONTRACT, "version": SHOW_FRAME_VERSION,
            "timeMs": max(0.0, _finite(seconds)) * 1000, "showTimeMs": t * 1000, "state": state,
            "passIndex": pass_index, "fixtures": fixtures, "pumps": pumps, "valves": valves,
            "diagnostics": diagnostics}


def evaluate_show_frame(project, time_ms, opts=None):
    return evaluate_show_frame_at(project, _finite(time_ms) / 1000, opts)


def light_bytes(record):
    out = (record or {}).get("output") or {"r": 0, "g": 0, "b": 0}
    return [_round_half_up(_clamp01(out[k]) * 255) for k in ("r", "g", "b")]
