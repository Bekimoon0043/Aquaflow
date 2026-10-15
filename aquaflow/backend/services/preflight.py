"""AF-NEXT-009 - preflight compiler gate.

One pass over a show that is about to leave the editor. The show is resolved ONCE through
the canonical show frame (``engine.show_frame.prepare_show``: mute/solo, tempo, half-open
windows, overlap policy) and every check then runs on that resolved clip list, so the gate
judges exactly what the timeline, the 3D preview and the PLC frame evaluate.

Unlike the old first-failure compilers, every problem is collected and returned as a
Diagnostic (the shape shared with ``frontend/src/engineering/showDiagnostics.js``)::

    {code, severity: "error"|"warning"|"info", timeMs|None, fixtureId|None, clipId|None,
     engineeringItemId|None, message,
     fix: {kind: "open_clip"|"open_engineering_item"|"open_panel", target}|None, source}

Errors block hardware output (``assert_preflight_ok`` / ``PreflightError``); warnings and
info never do. Preview-only targets are evaluated with the same checks but are labelled
``PREVIEW_ONLY_LABEL`` and are never refused.

Pure: no I/O, no network, no hardware. Callers decide what to do with the result; this
module never arms, starts, pulses or deploys anything.
"""
from __future__ import annotations

import json
import math
import zlib

from engine.show_frame import evaluate_show_frame_at, expand_keyed_clips, prepare_show

PREVIEW_ONLY_LABEL = "PREVIEW ONLY — not sent to hardware"
HARDWARE_TARGETS = {"siemens", "dmx", "artnet", "ican", "modbus", "runtime"}
PREVIEW_TARGETS = {"preview", "simulation", "simulated", ""}

# Same limits the output path enforces (engine.protocol_bus.ProtocolBus) - the preflight
# reports what the bus would otherwise cut off silently at runtime.
FLAME_MAX_ON_S = 3.0
FLAME_GAP_RESET_S = 0.5
FLAME_MIN_OFF_S = 5.0          # frontend DEFAULT_SAFETY_LIMITS.flame.minOffDurationMs
MAX_ISSUES_PER_KEY = 10        # timed issues per (code, fixture) before they are summarised
EPS = 1e-6

_SIEMENS_TRACKS = {"pump": {"pump_speed"}, "valve": {"solenoid_open"},
                   "light": {"lighting_master", "lighting_red", "lighting_green", "lighting_blue"}}
_DMX_KINDS = {"light", "effect"}
_ICAN_TRACKS = {"solenoid_open", "pump_speed", "device_intensity", "device_enable",
                "motion_intensity"}
_MOTION_POSITION = {"motion_pan", "motion_tilt", "motion_angle"}


# ─── diagnostics ───────────────────────────────────────────────────────

def diagnostic(code, severity, message, *, time_ms=None, fixture_id=None, clip_id=None,
               item_id=None, fix=None, source="preflight"):
    assert severity in ("error", "warning", "info")
    return {"code": code, "severity": severity,
            "timeMs": None if time_ms is None else round(float(time_ms)),
            "fixtureId": None if fixture_id is None else str(fixture_id),
            "clipId": None if clip_id is None else str(clip_id),
            "engineeringItemId": None if item_id is None else str(item_id),
            "message": str(message), "fix": fix, "source": source}


def fix_clip(target):
    return {"kind": "open_clip", "target": str(target)} if target is not None else None


def fix_item(target):
    return {"kind": "open_engineering_item", "target": str(target)} if target is not None else None


def fix_panel(target):
    return {"kind": "open_panel", "target": str(target)}


def summarize(issues):
    counts = {"error": 0, "warning": 0, "info": 0}
    by_code = {}
    for issue in issues:
        counts[issue["severity"]] += 1
        by_code[issue["code"]] = by_code.get(issue["code"], 0) + 1
    return {"errors": counts["error"], "warnings": counts["warning"], "infos": counts["info"],
            "total": len(issues), "by_code": by_code}


class PreflightError(ValueError):
    """Raised by gated hardware paths. ``issues`` holds the full Diagnostic list."""

    def __init__(self, result, prefix=""):
        self.result = result
        self.issues = result["issues"]
        self.summary = result["summary"]
        self.resolved_revision = result.get("resolved_revision")
        errors = [i for i in self.issues if i["severity"] == "error"]
        if len(errors) == 1:
            text = errors[0]["message"]
        else:
            shown = "; ".join(i["message"] for i in errors[:3])
            more = f" (+{len(errors) - 3} more)" if len(errors) > 3 else ""
            text = f"{len(errors)} preflight errors: {shown}{more}"
        super().__init__(f"{prefix}{text}")


# ─── helpers ───────────────────────────────────────────────────────────

def _num(value, fallback=None):
    if isinstance(value, bool) or value is None or value == "":
        return fallback
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _eng(fx):
    eng = fx.get("engineering")
    return eng if isinstance(eng, dict) else {}


def _first(*values):
    for value in values:
        if value not in (None, ""):
            return value
    return None


def _label(fx, fid):
    return str((fx or {}).get("label") or (fx or {}).get("name") or fid)


def _clip_target(raw, clip_id):
    """Timeline item that owns a resolved clip: the Studio recipe, else the clip itself."""
    raw = raw or {}
    return _first(raw.get("studioRecipeId"), raw.get("patternBlockId"), raw.get("keyedFrom"), clip_id)


def _fixture_class(fx, frame_kind, clip_types=()):
    """pump | valve | water | light | flame | effect | equipment."""
    text = " ".join(str((fx or {}).get(k) or "") for k in ("type", "fixtureType", "kind")).lower()
    text += " " + " ".join(str(t) for t in clip_types).lower()
    if "flame" in text or "fire" in text:
        return "flame"
    return frame_kind or "water"


def _merge(intervals, gap=EPS):
    out = []
    for start, end, ref in sorted(intervals, key=lambda i: (i[0], i[1])):
        if out and start <= out[-1][1] + gap:
            if end > out[-1][1]:
                out[-1][1] = end
            continue
        out.append([start, end, ref])
    return out


def _subtract(base, cut):
    """Intervals of ``base`` not covered by ``cut`` (both merged, sorted)."""
    out = []
    for start, end, ref in base:
        pieces = [(start, end)]
        for c_start, c_end, _ in cut:
            nxt = []
            for p_start, p_end in pieces:
                if c_end <= p_start or c_start >= p_end:
                    nxt.append((p_start, p_end))
                    continue
                if c_start > p_start:
                    nxt.append((p_start, c_start))
                if c_end < p_end:
                    nxt.append((c_end, p_end))
            pieces = nxt
        out.extend([p_start, p_end, ref] for p_start, p_end in pieces if p_end - p_start > 1e-3)
    return out


def _covers(intervals, t):
    return any(start - EPS <= t < end - EPS for start, end, _ in intervals)


def _ending_at(intervals, t):
    return next((ref for start, end, ref in intervals if abs(end - t) <= 1e-3), None)


def _active_clip(clips, t):
    return next((c for c in clips if c["start"] - EPS <= t < c["end"] and c["value"] > 0), None)


# ─── target ────────────────────────────────────────────────────────────

def siemens_target(site):
    return {"kind": "siemens", "site": site}


def _target_kind(target):
    return str((target or {}).get("kind") or "preview").lower()


def _site_fixtures(site):
    fixtures = []
    for channel in site.get("channels") or []:
        fixtures.append({
            "id": channel["id"], "kind": channel["kind"], "label": channel.get("name") or channel["id"],
            "supplyingPumpId": channel.get("pump_id"), "nozzle_ids": list(channel.get("nozzle_ids") or []),
            "max_percent": channel.get("max_percent"), "min_on_ms": channel.get("min_on_ms"),
            "min_off_ms": channel.get("min_off_ms"), "bypass": channel.get("bypass"),
        })
    return fixtures


# ─── topology (pump -> valve -> nozzle) ─────────────────────────────────

def _topology(fixtures, project):
    pump_of, valve_of, bypass = {}, {}, set()
    for fx in fixtures:
        fid = str(fx["id"])
        eng = _eng(fx)
        pump = _first(fx.get("supplyingPumpId"), fx.get("pump_id"), fx.get("pumpId"), eng.get("pumpId"))
        valve = _first(fx.get("linkedValveId"), fx.get("valveId"), eng.get("valveId"))
        if pump:
            pump_of[fid] = str(pump)
        if valve:
            valve_of[fid] = str(valve)
        for nozzle in fx.get("nozzle_ids") or []:
            valve_of.setdefault(str(nozzle), fid)
        if any(bool(v) for v in (fx.get("bypass"), fx.get("hasBypass"), eng.get("bypass"), eng.get("hasBypass"))):
            bypass.add(fid)
    network = (project or {}).get("hydraulic_network") or {}
    for group in network.get("groups") or [] if isinstance(network, dict) else []:
        if not isinstance(group, dict) or not group.get("pumpId"):
            continue
        pump = str(group["pumpId"])
        for member in list(group.get("valveIds") or []) + list(group.get("nozzleIds") or []):
            pump_of.setdefault(str(member), pump)
        if group.get("bypass"):
            bypass.add(pump)
    return pump_of, valve_of, bypass


# ─── main entry ────────────────────────────────────────────────────────

def run_preflight(project, target=None):
    """Return ``{ok, issues, summary, resolved_revision, target, hardware, label}``."""
    project = dict(project or {})
    target = dict(target or {})
    kind = _target_kind(target)
    hardware = kind in HARDWARE_TARGETS
    site = target.get("site") if kind == "siemens" else None
    issues = []

    # Keyed clips are flattened into constant clips: every check below reads `value`.
    raw_clips = expand_keyed_clips([c for c in (project.get("clips") or []) if isinstance(c, dict)],
                                   tempo=project.get("tempo"))
    fixtures = [f for f in (project.get("fixtures") or []) if isinstance(f, dict) and f.get("id") is not None]
    if site:
        fixtures = _site_fixtures(site)
    by_id = {str(f["id"]): f for f in fixtures}

    # ── resolve once ────────────────────────────────────────────────────
    frame_project = {
        "fixtures": [{"id": str(f["id"]), **({"kind": f["kind"]} if f.get("kind") else {}),
                      **({"type": f.get("type") or f.get("fixtureType")} if (f.get("type") or f.get("fixtureType")) else {})}
                     for f in fixtures],
        "clips": raw_clips, "recipes": project.get("recipes") or [], "groups": project.get("groups") or [],
        "tempo": project.get("tempo"), "sections": project.get("sections") or [],
        "duration": project.get("duration"),
    }
    prepared = prepare_show(frame_project)
    resolved = prepared["clips"]
    raw_of = {c["index"]: raw_clips[c["index"]] for c in resolved}
    clips_by_fixture = {}
    for clip in resolved:
        clips_by_fixture.setdefault(str(clip["fixtureId"]), []).append(clip)
    kinds = {fid: _fixture_class(by_id.get(fid), prepared["kinds"].get(fid),
                                 [c["type"] for c in clips_by_fixture.get(fid, [])])
             for fid in prepared["fixture_ids"]}

    # Canonical-frame diagnostics (invalid clips, unsupported curves, overlaps).
    for d in prepared["diagnostics"]:
        if kind == "siemens" and d["code"] in ("invalid-clip", "unsupported-curve"):
            continue   # the Siemens rules below report these with the controller's own limits
        if d["code"] == "invalid-clip":
            issues.append(diagnostic("invalid-clip", "error", d["message"], fixture_id=d.get("fixtureId"),
                                     clip_id=d.get("clipId"), fix=fix_clip(d.get("clipId"))))
        elif d["code"] == "unsupported-curve":
            issues.append(diagnostic("unsupported-curve", "warning",
                                     f"Curve {d.get('curve')!r} is not supported; it is evaluated as linear.",
                                     clip_id=d.get("clipId"), fix=fix_clip(d.get("clipId"))))
        elif d["code"] == "overlap" and kind != "siemens":
            first = d["clipIds"][-1]
            raw = next((raw_of[c["index"]] for c in resolved if c["id"] == first), None)
            issues.append(diagnostic("overlap", "warning",
                                     f"Overlapping clips on {d['fixtureId']} {d['channel']}: highest takes precedence; "
                                     "event lists and the Siemens compiler cannot express this.",
                                     time_ms=d["startMs"], fixture_id=d["fixtureId"], clip_id=first,
                                     item_id=d["fixtureId"], fix=fix_clip(_clip_target(raw, first))))

    if kind == "siemens" and site is not None:
        issues.extend(_siemens_checks(site, raw_clips))
    else:
        issues.extend(_missing_links(resolved, raw_of, by_id, target, hardware))
        issues.extend(_unsupported_channels(kind, resolved, raw_of, kinds))
        issues.extend(_output_limits(resolved, raw_of, by_id))
        issues.extend(_min_on_off(clips_by_fixture, by_id, raw_of))
    issues.extend(_address_conflicts(fixtures, site, kind))
    issues.extend(_dependency_graph(fixtures))
    issues.extend(_dependencies(project, fixtures, by_id, kinds, clips_by_fixture, raw_of, kind, prepared, frame_project))
    issues.extend(_flame_rules(clips_by_fixture, kinds, by_id, raw_of))
    issues.extend(_hydraulics(project, target))

    issues = _dedupe(issues)
    order = {"error": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda i: (order[i["severity"]], i["timeMs"] if i["timeMs"] is not None else -1, i["code"]))
    if not hardware:
        issues.append(diagnostic("preview-only", "info", f"{PREVIEW_ONLY_LABEL}. Choose a controller to gate hardware output."))
    summary = summarize(issues)
    return {"ok": summary["errors"] == 0, "issues": issues, "summary": summary,
            "resolved_revision": resolved_revision(resolved, fixtures, target),
            "target": kind, "hardware": hardware, "label": None if hardware else PREVIEW_ONLY_LABEL}


def resolved_revision(resolved, fixtures, target):
    """Stable fingerprint of what would be sent: resolved clips + routing + target."""
    site = (target or {}).get("site") if _target_kind(target) == "siemens" else None
    routing_keys = ("type", "kind", "supplyingPumpId", "linkedValveId", "dmxUniverse", "dmxAddress", "dmxChannel",
                    "universe", "channel", "register", "plcRegister", "plcChannel", "plcHost", "output",
                    "ican_group", "ican_channel", "icanGroup", "icanChannel", "max_percent", "min_on_ms", "min_off_ms")
    payload = {
        "clips": [[c["id"], c["fixtureId"], c["type"], round(c["start"], 6), round(c["end"], 6), c["value"],
                   c["fadeIn"], c["fadeOut"], c["curve"], c["color"]] for c in resolved],
        "fixtures": sorted([[str(f["id"])] + [str(f.get(k)) for k in routing_keys] + [json.dumps(_eng(f), sort_keys=True, default=str)]
                            for f in fixtures]),
        "target": _target_kind(target),
        "site": [site.get("id"), site.get("revision")] if site else None,
    }
    return "pf-%08x" % (zlib.crc32(json.dumps(payload, sort_keys=True, default=str).encode()) & 0xFFFFFFFF)


def assert_preflight_ok(project, target, prefix="Preflight refused hardware output: "):
    """Fail closed: raise PreflightError when the current resolved show has errors."""
    result = run_preflight(project, target)
    if not result["ok"]:
        raise PreflightError(result, prefix)
    return result


def _dedupe(issues):
    seen, out = set(), []
    for issue in issues:
        key = (issue["code"], issue["severity"], issue["timeMs"], issue["fixtureId"], issue["clipId"],
               issue["engineeringItemId"], issue["message"])
        if key not in seen:
            seen.add(key)
            out.append(issue)
    return out


# ─── Siemens controller rules (formerly compile_show's first-failure checks) ──

def _siemens_checks(site, clips):
    from engine.siemens_site import finite
    issues = []
    try:
        from engine.siemens_site import validate_site
        validate_site(site)
    except (ValueError, KeyError, TypeError) as exc:
        issues.append(diagnostic("site-invalid", "error", f"Siemens site mapping is invalid: {exc}",
                                 fix=fix_panel("plc")))
    channels = {c["id"]: c for c in site.get("channels") or []}
    accepted, windows = [], {}
    for index, clip in enumerate(clips):
        if clip.get("muted") is True or clip.get("disabled") is True:
            continue
        cid = clip.get("fixtureId")
        clip_id = clip.get("id", f"clip-{index}")
        target = _clip_target(clip, clip_id)

        def err(code, message, time_ms=None, item=None):
            issues.append(diagnostic(code, "error", message, time_ms=time_ms, fixture_id=cid, clip_id=clip_id,
                                     item_id=item, fix=fix_clip(target)))

        if cid not in channels:
            err("unmapped-fixture", f"Unmapped fixture: {cid}; load this Siemens site's engineering layout")
            continue
        channel = channels[cid]
        expected = clip.get("type")
        if expected not in _SIEMENS_TRACKS[channel["kind"]]:
            err("unsupported-channel", f"Unsupported track {expected} for {channel['name']}", item=cid)
            continue
        effects = clip.get("effects") or []
        basic = (len(effects) == 1 and isinstance(effects[0], dict) and effects[0].get("type") == "basic"
                 and set(effects[0].get("params", {})) <= {"value"})
        if effects and not basic:
            err("effects-not-baked", "Bake clip effects into ordinary clips before compiling for Siemens")
            continue
        try:
            start = finite(clip.get("startTime", 0), "Clip start", 0, 1800)
            duration = finite(clip.get("duration"), "Clip duration", .1, 1800)
            if start + duration > 1800:
                raise ValueError("Shows must be at most 30 minutes")
            value = finite(clip.get("value"), "Clip value", 0, 100)
            fade_in = finite(clip.get("fadeIn", 0), "Fade in", 0, duration)
            fade_out = finite(clip.get("fadeOut", 0), "Fade out", 0, duration)
        except (ValueError, TypeError) as exc:
            err("invalid-clip", f"{channel['name']}: {exc}", item=cid)
            continue
        t_ms = start * 1000
        if fade_in + fade_out > duration or clip.get("curveType", "linear") not in (None, "linear"):
            err("unsupported-fade", "Siemens currently supports linear, non-overlapping fades", t_ms, cid)
            continue
        if channel["kind"] == "pump" and value > channel["max_percent"]:
            err("output-limit", f"{channel['name']} exceeds its commissioned speed ceiling "
                                f"({value:g}% > {channel['max_percent']:g}%)", t_ms, cid)
            continue
        if channel["kind"] == "valve" and (value not in (0, 100) or fade_in or fade_out):
            err("valve-not-binary", f"{channel['name']} requires binary 0/100 clips without fades and its minimum on time",
                t_ms, cid)
            continue
        if channel["kind"] == "valve" and value and duration * 1000 < channel["min_on_ms"]:
            err("min-on-time", f"{channel['name']} requires binary 0/100 clips without fades and its minimum on time "
                               f"({duration * 1000:.0f} ms < {channel['min_on_ms']} ms)", t_ms, cid)
            continue
        record = {"fixtureId": cid, "type": expected, "startTime": start, "duration": duration, "value": value,
                  "id": clip_id, "target": target}
        accepted.append(record)
        windows.setdefault((cid, expected), []).append(record)
    for (cid, _track), group in windows.items():
        group.sort(key=lambda c: c["startTime"])
        channel = channels[cid]
        for previous, current in zip(group, group[1:]):
            gap = current["startTime"] - previous["startTime"] - previous["duration"]
            if gap < -1e-6:
                issues.append(diagnostic("overlap", "error", "Overlapping clips on the same Siemens output",
                                         time_ms=current["startTime"] * 1000, fixture_id=cid, clip_id=current["id"],
                                         item_id=cid, fix=fix_clip(current["target"])))
        if channel["kind"] == "valve":
            on = [c for c in group if c["value"]]
            for previous, current in zip(on, on[1:]):
                gap = current["startTime"] - previous["startTime"] - previous["duration"]
                if gap > 1e-6 and gap * 1000 < channel["min_off_ms"]:
                    issues.append(diagnostic(
                        "min-off-time", "error",
                        f"{channel['name']} has a gap below its minimum off time ({gap * 1000:.0f} ms < {channel['min_off_ms']} ms)",
                        time_ms=(previous["startTime"] + previous["duration"]) * 1000, fixture_id=cid,
                        clip_id=current["id"], item_id=cid, fix=fix_clip(current["target"])))
    if not accepted and not any(i["severity"] == "error" for i in issues):
        issues.append(diagnostic("no-enabled-clips", "error", "The show has no enabled output clips"))
    return issues


# ─── generic checks ────────────────────────────────────────────────────

def _mapped_predicate(target):
    mapped = target.get("mapped")
    if mapped is None:
        return None
    if callable(mapped):
        return lambda fid: bool(mapped(fid))
    ids = {str(m) for m in mapped}
    return lambda fid: str(fid) in ids


def _missing_links(resolved, raw_of, by_id, target, hardware):
    issues, reported = [], set()
    is_mapped = _mapped_predicate(target)
    for clip in resolved:
        fid = str(clip["fixtureId"])
        if fid in reported:
            continue
        raw = raw_of[clip["index"]]
        fx = by_id.get(fid)
        if fx is None and by_id:
            reported.add(fid)
            issues.append(diagnostic(
                "missing-fixture", "error" if hardware else "warning",
                f"Clip targets {fid}, which is not a fixture in the Engineering design.",
                time_ms=clip["start"] * 1000, fixture_id=fid, clip_id=clip["id"],
                fix=fix_clip(_clip_target(raw, clip["id"]))))
            continue
        if hardware and is_mapped is not None and not is_mapped(fid):
            reported.add(fid)
            issues.append(diagnostic(
                "unmapped-fixture", "error",
                f"{_label(fx, fid)} has no valid controller address; it would never reach hardware.",
                time_ms=clip["start"] * 1000, fixture_id=fid, clip_id=clip["id"], item_id=fid,
                fix=fix_item(fid)))
    return issues


def _unsupported_channels(kind, resolved, raw_of, kinds):
    issues, reported = [], set()
    for clip in resolved:
        fid = str(clip["fixtureId"])
        fclass = kinds.get(fid)
        raw = raw_of[clip["index"]]
        key = (fid, clip["type"])
        if key in reported:
            continue
        message = None
        if kind in ("dmx", "artnet") and fclass not in _DMX_KINDS and fclass != "flame":
            message = f"{clip['type']} on {fid} ({fclass}) is not a DMX/Art-Net channel; it is not sent by this controller."
        elif kind == "ican":
            if clip["type"] not in _ICAN_TRACKS:
                message = f"{clip['type']} on {fid} is not an I-CAN relay channel; relays are on/off only."
            elif clip["fadeIn"] or clip["fadeOut"] or clip["value"] not in (0, 100):
                message = (f"{fid}: I-CAN relays are on/off; levels and fades are thresholded at 50% "
                           "(preview levels will differ).")
        if message:
            reported.add(key)
            issues.append(diagnostic("unsupported-channel", "warning", message, time_ms=clip["start"] * 1000,
                                     fixture_id=fid, clip_id=clip["id"], item_id=fid,
                                     fix=fix_clip(_clip_target(raw, clip["id"]))))
    return issues


def _limit_percent(fx):
    if not fx:
        return None
    eng = _eng(fx)
    pct = _num(_first(fx.get("max_percent"), fx.get("maxPercent"), eng.get("maxPercent"), eng.get("max_percent")))
    if pct is not None:
        return pct
    frac = _num(_first(fx.get("maxIntensity"), fx.get("safety_max"), eng.get("maxIntensity"), eng.get("safetyMax")))
    return frac * 100 if frac is not None and frac <= 1 else frac


def _output_limits(resolved, raw_of, by_id):
    issues, reported = [], set()
    for clip in resolved:
        fid = str(clip["fixtureId"])
        limit = _limit_percent(by_id.get(fid))
        if limit is None or clip["type"] in _MOTION_POSITION or clip["value"] <= limit + EPS or fid in reported:
            continue
        reported.add(fid)
        raw = raw_of[clip["index"]]
        issues.append(diagnostic(
            "output-limit", "warning",
            f"{_label(by_id.get(fid), fid)} is programmed to {clip['value']:g}% but its safety output limit is "
            f"{limit:g}%; the output path clamps it (preview shows the unclamped level).",
            time_ms=clip["start"] * 1000, fixture_id=fid, clip_id=clip["id"], item_id=fid,
            fix=fix_clip(_clip_target(raw, clip["id"]))))
    return issues


def _ms(fx, *names):
    if not fx:
        return None
    eng = _eng(fx)
    for name in names:
        value = _num(_first(fx.get(name), eng.get(name)))
        if value is not None and value > 0:
            return value
    return None


def _episodes(clips, raw_of):
    return _merge([(c["start"], c["end"], c) for c in clips if c["value"] > 0 and c["type"] not in _MOTION_POSITION])


def _min_on_off(clips_by_fixture, by_id, raw_of):
    issues = []
    for fid, clips in clips_by_fixture.items():
        fx = by_id.get(fid)
        min_on = _ms(fx, "min_on_ms", "minOnMs")
        min_off = _ms(fx, "min_off_ms", "minOffMs")
        if not (min_on or min_off):
            continue
        episodes = _episodes(clips, raw_of)
        count = 0
        for start, end, clip in episodes:
            if min_on and (end - start) * 1000 < min_on - EPS and count < MAX_ISSUES_PER_KEY:
                count += 1
                issues.append(diagnostic("min-on-time", "error",
                                         f"{_label(fx, fid)} is on for {(end - start) * 1000:.0f} ms; minimum on time is {min_on:.0f} ms.",
                                         time_ms=start * 1000, fixture_id=fid, clip_id=clip["id"], item_id=fid,
                                         fix=fix_clip(_clip_target(raw_of[clip["index"]], clip["id"]))))
        for (_s, end, _c), (start, _e, clip) in zip(episodes, episodes[1:]):
            gap = (start - end) * 1000
            if min_off and gap < min_off - EPS and count < MAX_ISSUES_PER_KEY:
                count += 1
                issues.append(diagnostic("min-off-time", "error",
                                         f"{_label(fx, fid)} restarts after {gap:.0f} ms; minimum off time is {min_off:.0f} ms.",
                                         time_ms=end * 1000, fixture_id=fid, clip_id=clip["id"], item_id=fid,
                                         fix=fix_clip(_clip_target(raw_of[clip["index"]], clip["id"]))))
    return issues


# ─── address / channel conflicts ───────────────────────────────────────

def _address_conflicts(fixtures, site, kind):
    if site is not None:
        return []   # validate_site (in _siemens_checks) owns Siemens %Q overlap detection
    from services.fixture_registry_bridge import _has_explicit_dmx, derive_device_type, fixture_to_address, parse_plc_register
    issues = []
    dmx, modbus, outputs, ican = {}, {}, {}, {}

    def conflict(code, message, fid, other):
        issues.append(diagnostic(code, "error", message, fixture_id=fid, item_id=fid, fix=fix_item(fid)))

    for fx in fixtures:
        if fx.get("_synthetic"):
            continue
        fid = str(fx["id"])
        eng = _eng(fx)
        dclass = derive_device_type(fx.get("type") or fx.get("fixtureType") or "")
        if dclass in ("lighting", "fog", "laser") and _has_explicit_dmx(fx):
            addr = fixture_to_address(fx)
            footprint = int(_num(_first(fx.get("dmxFootprint"), eng.get("dmxFootprint")), addr.dmx_channels) or 1)
            last = addr.dmx_channel + footprint - 1
            if addr.dmx_channel < 1 or last > 512:
                conflict("dmx-overflow", f"{_label(fx, fid)} uses DMX universe {addr.dmx_universe} channels "
                                         f"{addr.dmx_channel}-{last}, outside 1-512.", fid, None)
            for ch in range(addr.dmx_channel, last + 1):
                other = dmx.get((addr.dmx_universe, ch))
                if other and other != fid:
                    conflict("dmx-conflict", f"DMX universe {addr.dmx_universe} channel {ch} is used by both "
                                             f"{other} and {fid}.", fid, other)
                    break
                dmx[(addr.dmx_universe, ch)] = fid
        if dclass in ("pump", "valve", "flame", "sensor"):
            reg = _first(fx.get("register"), fx.get("plcRegister"), eng.get("register"))
            if reg is None:
                reg = parse_plc_register(eng.get("plcChannel") or fx.get("plcChannel")) if (eng.get("plcChannel") or fx.get("plcChannel")) else None
            if reg is not None:
                host = str(fx.get("plcHost") or eng.get("plcHost") or fx.get("ip") or "PLC-default")
                unit = str(_first(fx.get("unitId"), eng.get("unitId")) or 1)
                key = (host, unit, int(_num(reg, -1)))
                other = modbus.get(key)
                if other:
                    conflict("plc-conflict", f"PLC {host} unit {unit} register {key[2]} is used by both {other} and {fid}.", fid, other)
                modbus[key] = fid
        out = _first(fx.get("output"), eng.get("output"), fx.get("plcOutput"), eng.get("plcOutput"))
        if out:
            key = str(out).strip().upper().lstrip("%")
            other = outputs.get(key)
            if other:
                conflict("valve-output-conflict", f"Output %{key} is wired to both {other} and {fid}.", fid, other)
            outputs[key] = fid
        group = _first(fx.get("ican_group"), fx.get("icanGroup"), eng.get("icanGroup"), eng.get("ican_group"))
        channel = _first(fx.get("ican_channel"), fx.get("icanChannel"), eng.get("icanChannel"), eng.get("ican_channel"))
        if group is not None and channel is not None:
            g, c = int(_num(group, -1)), int(_num(channel, 0))
            if c <= 0:
                conflict("ican-conflict", f"{_label(fx, fid)} has I-CAN channel {channel}; channels are 1-based "
                                          "(0 would address the whole group).", fid, None)
            other = ican.get((g, c))
            if other:
                conflict("ican-conflict", f"I-CAN group {g} channel {c} is used by both {other} and {fid}.", fid, other)
            ican[(g, c)] = fid
    return issues


def _dependency_graph(fixtures):
    real = [f for f in fixtures if not f.get("_synthetic")]
    if not any(f.get("dependsOn") for f in real):
        return []
    from services.dependency_graph import build_dependency_graph
    issues = []
    for conflict in build_dependency_graph(real)["conflicts"]:
        if conflict["type"] not in ("missing_dependency", "cycle"):
            continue
        fid = conflict["nodes"][0] if conflict.get("nodes") else None
        issues.append(diagnostic("dependency-" + conflict["type"].replace("_", "-"), "error", conflict["message"],
                                 fixture_id=fid, item_id=fid, fix=fix_item(fid)))
    return issues


# ─── pump / valve / nozzle dependencies over time ───────────────────────

def _dependencies(project, fixtures, by_id, kinds, clips_by_fixture, raw_of, target_kind, prepared, frame_project):
    issues = []
    pump_of, valve_of, bypass = _topology(fixtures, project)
    pumps = {fid for fid, k in kinds.items() if k == "pump"} | {str(f["id"]) for f in fixtures if f.get("kind") == "pump"}
    valves = {fid for fid, k in kinds.items() if k == "valve"} | {str(f["id"]) for f in fixtures if f.get("kind") == "valve"}
    interlocked = target_kind == "siemens"   # frame_from_values holds a pump at 0 with no outlet open
    episodes = {fid: _episodes(clips, raw_of) for fid, clips in clips_by_fixture.items()}

    def raw_target(clip):
        return _clip_target(raw_of[clip["index"]], clip["id"]) if clip else None

    def confirm(t, predicate):
        """Re-check one instant against the canonical frame (half-open windows, HTP)."""
        frame = evaluate_show_frame_at(frame_project, t, prepared=prepared)
        return predicate(frame)

    # Static links.
    for fid in sorted(valves):
        if fid in clips_by_fixture and fid not in pump_of and pumps:
            issues.append(diagnostic("valve-without-pump", "error",
                                     f"Valve {_label(by_id.get(fid), fid)} is programmed but has no supplying pump in the design.",
                                     fixture_id=fid, item_id=fid, fix=fix_item(fid)))
        elif fid in pump_of and pump_of[fid] not in by_id and by_id:
            issues.append(diagnostic("valve-without-pump", "error",
                                     f"Valve {_label(by_id.get(fid), fid)} names pump {pump_of[fid]}, which is not in the design.",
                                     fixture_id=fid, item_id=fid, fix=fix_item(fid)))
    for fid, fclass in kinds.items():
        if fclass == "water" and fid in clips_by_fixture and valves and fid not in valve_of:
            issues.append(diagnostic("nozzle-without-valve", "warning",
                                     f"Nozzle {_label(by_id.get(fid), fid)} is programmed but is not linked to a valve; "
                                     "no controller output opens it.",
                                     fixture_id=fid, item_id=fid, fix=fix_item(fid)))

    # Effective valve state: its own clips; a valve with no clips follows its nozzles.
    nozzles_of = {}
    for nozzle, valve in valve_of.items():
        nozzles_of.setdefault(valve, []).append(nozzle)
    valve_open = {}
    for valve in valves:
        if episodes.get(valve):
            valve_open[valve] = episodes[valve]
        else:
            valve_open[valve] = _merge([e for n in nozzles_of.get(valve, []) for e in episodes.get(n, [])])

    # Valve open while its pump is stopped.
    for valve in sorted(valves):
        pump = pump_of.get(valve)
        if not pump or pump not in pumps or not valve_open.get(valve):
            continue
        dry = _subtract(valve_open[valve], episodes.get(pump, []))
        if dry:
            start, _end, clip = dry[0]
            issues.append(diagnostic(
                "valve-open-pump-off", "warning",
                f"Valve {_label(by_id.get(valve), valve)} is open while pump {_label(by_id.get(pump), pump)} is stopped "
                f"({len(dry)} time(s), first at {start:.2f}s): no water will flow.",
                time_ms=start * 1000, fixture_id=valve, clip_id=clip["id"], item_id=pump, fix=fix_clip(raw_target(clip))))

    # Nozzle playing while its (programmed) valve is closed.
    for nozzle, valve in sorted(valve_of.items()):
        if not episodes.get(nozzle) or not episodes.get(valve):
            continue
        closed = _subtract(episodes[nozzle], valve_open[valve])
        if closed:
            start, _end, clip = closed[0]
            issues.append(diagnostic(
                "nozzle-valve-closed", "warning",
                f"Nozzle {_label(by_id.get(nozzle), nozzle)} plays while valve {_label(by_id.get(valve), valve)} is closed "
                f"({len(closed)} time(s), first at {start:.2f}s).",
                time_ms=start * 1000, fixture_id=nozzle, clip_id=clip["id"], item_id=valve, fix=fix_clip(raw_target(clip))))

    # Pump running with every outlet closed (dead-head), and the transition that causes it.
    outlets = {}
    for valve in valves:
        if pump_of.get(valve):
            outlets.setdefault(pump_of[valve], []).append(valve)
    for pump in sorted(pumps):
        if pump not in outlets or not episodes.get(pump):
            continue
        any_open = _merge([e for v in outlets[pump] for e in valve_open.get(v, [])])
        dead = _subtract(episodes[pump], any_open)
        safe = interlocked or pump in bypass
        severity = "warning" if safe else "error"
        consequence = ("the PLC interlock holds the pump at 0 (abrupt stop)" if interlocked else
                       "it recirculates through its bypass" if pump in bypass else
                       "no bypass is configured")
        count = 0
        for start, end, pump_clip in dead:
            mid = (start + end) / 2
            if not confirm(mid, lambda f: f["pumps"].get(pump, {}).get("run") and
                           not any(f["valves"].get(v, {}).get("open") for v in outlets[pump] if episodes.get(v))):
                continue
            closing = next((v for v in outlets[pump] if _ending_at(valve_open.get(v, []), start)), None)
            active = _active_clip(clips_by_fixture.get(pump, []), mid) or pump_clip
            if count >= MAX_ISSUES_PER_KEY:
                count += 1
                continue
            count += 1
            if closing is not None:
                sources = clips_by_fixture.get(closing) or [c for n in nozzles_of.get(closing, [])
                                                            for c in clips_by_fixture.get(n, [])]
                closer = next((c for c in sources if abs(c["end"] - start) <= 1e-3), None) or (sources or [None])[0]
                issues.append(diagnostic(
                    "valve-close-against-pump", severity,
                    f"Valve {_label(by_id.get(closing), closing)} closes at {start:.2f}s while pump "
                    f"{_label(by_id.get(pump), pump)} is running and no other outlet is open; {consequence}.",
                    time_ms=start * 1000, fixture_id=closing, clip_id=closer["id"] if closer else None, item_id=pump,
                    fix=fix_clip(raw_target(closer)) if closer else fix_item(closing)))
            else:
                issues.append(diagnostic(
                    "pump-deadhead", severity,
                    f"Pump {_label(by_id.get(pump), pump)} runs from {start:.2f}s to {end:.2f}s with every outlet valve "
                    f"closed; {consequence}.",
                    time_ms=start * 1000, fixture_id=pump, clip_id=active["id"], item_id=pump,
                    fix=fix_clip(raw_target(active))))
        if count > MAX_ISSUES_PER_KEY:
            issues.append(diagnostic("pump-deadhead", "info", f"{count - MAX_ISSUES_PER_KEY} more dead-head interval(s) on {pump}.",
                                     fixture_id=pump, item_id=pump, fix=fix_item(pump)))

    # Rapid pump stop/restart (short-cycling) inside the pump's minimum off time.
    for pump in sorted(pumps):
        min_off = _ms(by_id.get(pump), "min_off_ms", "minOffMs") or 2000.0
        eps = episodes.get(pump, [])
        for (_s, end, _c), (start, _e, clip) in zip(eps, eps[1:]):
            gap = (start - end) * 1000
            if gap < min_off:
                issues.append(diagnostic(
                    "pump-short-cycle", "warning",
                    f"Pump {_label(by_id.get(pump), pump)} stops at {end:.2f}s and restarts after {gap:.0f} ms "
                    f"(minimum {min_off:.0f} ms): rapid stop/restart stresses the motor and drive.",
                    time_ms=end * 1000, fixture_id=pump, clip_id=clip["id"], item_id=pump, fix=fix_clip(raw_target(clip))))
                break
    return issues


def _flame_rules(clips_by_fixture, kinds, by_id, raw_of):
    issues = []
    for fid, fclass in kinds.items():
        if fclass != "flame" or fid not in clips_by_fixture:
            continue
        bursts = _merge([(c["start"], c["end"], c) for c in clips_by_fixture[fid] if c["value"] > 0], gap=FLAME_GAP_RESET_S)
        for start, end, clip in bursts:
            if end - start > FLAME_MAX_ON_S + EPS:
                issues.append(diagnostic(
                    "flame-duration", "error",
                    f"Flame {_label(by_id.get(fid), fid)} burns {end - start:.2f}s continuously from {start:.2f}s; the hardware "
                    f"limit is {FLAME_MAX_ON_S:.1f}s (gaps under {FLAME_GAP_RESET_S}s count as one burst).",
                    time_ms=start * 1000, fixture_id=fid, clip_id=clip["id"], item_id=fid,
                    fix=fix_clip(_clip_target(raw_of[clip["index"]], clip["id"]))))
        for (_s, end, _c), (start, _e, clip) in zip(bursts, bursts[1:]):
            if start - end < FLAME_MIN_OFF_S:
                issues.append(diagnostic(
                    "flame-min-off", "warning",
                    f"Flame {_label(by_id.get(fid), fid)} re-fires {start - end:.2f}s after the previous burst "
                    f"(recommended minimum {FLAME_MIN_OFF_S:.0f}s).",
                    time_ms=start * 1000, fixture_id=fid, clip_id=clip["id"], item_id=fid,
                    fix=fix_clip(_clip_target(raw_of[clip["index"]], clip["id"]))))
                break
    return issues


def _hydraulics(project, target):
    """Hydraulic and splash diagnostics from services.show_hydraulics (AF-NEXT-007/008) when present."""
    try:
        from services import show_hydraulics  # noqa: WPS433 - optional module owned by AF-NEXT-007/008
    except Exception:
        return []
    issues = []
    for name, source in (("get_hydraulic_diagnostics", "hydraulics"), ("get_splash_diagnostics", "splash")):
        producer = getattr(show_hydraulics, name, None)
        if not callable(producer):
            continue
        try:
            produced = producer(project, (target or {}).get("show") or project)
        except TypeError:
            try:
                produced = producer(project)
            except Exception as exc:  # pragma: no cover - never let an optional producer hide the gate
                produced = [diagnostic("diagnostics-failed", "warning", f"{source} diagnostics failed: {exc}", source=source)]
        except Exception as exc:  # pragma: no cover
            produced = [diagnostic("diagnostics-failed", "warning", f"{source} diagnostics failed: {exc}", source=source)]
        for d in produced or []:
            if not isinstance(d, dict) or d.get("severity") not in ("error", "warning", "info"):
                continue
            issues.append(diagnostic(str(d.get("code") or source), d["severity"], d.get("message") or source,
                                     time_ms=d.get("timeMs"), fixture_id=d.get("fixtureId"), clip_id=d.get("clipId"),
                                     item_id=d.get("engineeringItemId"), fix=d.get("fix"), source=d.get("source") or source))
    return issues


# ─── adapters for the gated hardware paths ──────────────────────────────

def engine_project(engine):
    """Project for the legacy show_engine runtime: designed fixtures + timeline track clips."""
    fixtures = [dict(f) for f in (engine.fixtures or []) if isinstance(f, dict) and (f.get("id") or f.get("fixtureId"))]
    for f in fixtures:
        f.setdefault("id", f.get("fixtureId"))
    known = {str(f["id"]) for f in fixtures}
    clips = []
    for track in engine.timeline_tracks or []:
        device = track.get("deviceId")
        if device is None:
            continue   # not addressed to a device; the bus routes nothing device-specific for it
        device = str(device)
        track_type = str(track.get("type") or "device_intensity")
        if device not in known:
            known.add(device)
            fixtures.append({"id": device, "type": track_type, "_synthetic": True})
        for clip in track.get("clips") or []:
            start = _num(clip.get("start"), 0.0)
            end = _num(clip.get("end"), start)
            clips.append({"id": clip.get("id"), "fixtureId": device, "type": _runtime_type(track_type),
                          "startTime": start, "duration": end - start,
                          "value": _num(clip.get("intensity"), 100.0), "fadeIn": clip.get("fadeIn", 0),
                          "fadeOut": clip.get("fadeOut", 0), "curveType": clip.get("curveType"),
                          "muted": clip.get("muted") is True or track.get("muted") is True,
                          "disabled": clip.get("disabled"),
                          **({"keys": clip["keys"], "keyMode": clip.get("keyMode")} if "keys" in clip else {})})
    return {"fixtures": fixtures, "clips": clips}


def _runtime_type(track_type):
    t = track_type.lower()
    if "pump" in t:
        return "pump_speed"
    if "valve" in t or "solenoid" in t:
        return "solenoid_open"
    if "light" in t or "rgb" in t or "led" in t:
        return "lighting_master"
    return track_type


def ican_pattern_project(pattern, devices=()):
    """Project for an I-CAN manual pattern: each (group, channel) relay is a fixture."""
    labelled = {(int(d.get("ican_group", -1)), int(d.get("ican_channel", 0))): d for d in devices or []
                if isinstance(d, dict)}
    fixtures, clips, seen, t = [], [], set(), 0.0
    active = {}
    steps = pattern.get("steps") or []
    for index, step in enumerate(steps + [None]):
        duration = (step or {}).get("duration_ms", 0) / 1000
        now = set()
        for group, channels in ((step or {}).get("groups") or {}).items():
            now |= {(int(group), int(c)) for c in channels}
        for key in list(active):
            if key not in now:
                start = active.pop(key)
                clips.append({"id": f"step-{index}:{key[0]}.{key[1]}", "fixtureId": f"ican:{key[0]}.{key[1]}",
                              "type": "solenoid_open", "startTime": start, "duration": t - start, "value": 100})
        for key in now:
            active.setdefault(key, t)
            if key not in seen:
                seen.add(key)
                device = labelled.get(key) or {}
                fixtures.append({"id": f"ican:{key[0]}.{key[1]}", "label": device.get("device_id") or f"I-CAN {key[0]}.{key[1]}",
                                 "type": device.get("device_type") or "relay", "ican_group": key[0], "ican_channel": key[1]})
        t += duration
    return {"fixtures": fixtures, "clips": clips}
