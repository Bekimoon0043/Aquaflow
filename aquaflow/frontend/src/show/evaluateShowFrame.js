// src/show/evaluateShowFrame.js — AF-NEXT-004 canonical evaluated show frame.
//
// ONE pure, versioned answer to "what is every fixture doing at show time t?".
// The Show Studio timeline sampler, the embedded/full 3D preview, the video
// sampler, the dry run and both compilers consume this module, and the backend
// carries a line-for-line Python mirror (backend/engine/show_frame.py) that the
// Siemens runtime uses for every PLC frame. Golden parity tests keep them equal.
//
// Contract (SHOW_FRAME_VERSION "1.0.0")
// -------------------------------------
// evaluateShowFrame(project, timeMs, opts) -> {
//   version, timeMs, showTimeMs, state: "playing"|"stopped"|"ended"|"blackout",
//   passIndex,                                  // 1-based loop pass
//   fixtures: { [fixtureId]: {
//     kind: "water"|"light"|"pump"|"valve"|"effect"|"equipment",
//     level,                                    // 0..1. Lights: master dimmer.
//     channels: { [trackType]: 0..1 },          // winning value per active channel
//     color: { hex, srgb:{r,g,b}, linear:{r,g,b}, source } | null,
//     output: { r, g, b } (lights only),       // sRGB-encoded drive = color.srgb × level
//     motion: { pan, tilt } (motion fixtures),  // degrees, clamped ±45
//     source: { clipId, recipeId, trackId } | null,
//   } },
//   pumps:  { [fixtureId]: { speed: 0..1, run: boolean } },
//   valves: { [fixtureId]: { open: boolean } },
//   diagnostics: [{ code, severity, message, ... }],
// }
//
// Project input: { fixtures?: [{id, type, kind?}], clips: [...], groups?, recipes?,
//   tempo?: [{time, bpm}], sections?: [{id, start, end}], duration?, blackout? }.
// Clips are the resolved, flat clips every AquaFlow path already shares:
//   { id, fixtureId, type, startTime (s), duration (s), value (0..100), fadeIn, fadeOut,
//     curveType, color, trackId, studioRecipeId, muted, pan, tilt, keys?, keyMode? }
// Keyed clips: `keys` = [t0,v0,t1,v1,...] (t seconds from clip start, v 0..100) replaces
// `value` with a curve, linear between keys or held ("step"); constant before the first
// and after the last key. Invalid keys → `invalid-keys` diagnostic, constant `value`.
// Consumers that read `value` directly call expandKeyedClips() first.
// `start`/`end` (seconds) and `startBeat`/`durationBeats` (resolved through the tempo
// map) are accepted as alternative timing fields. Legacy `.aqua` data is untouched:
// this module only reads clips, it never rewrites them.
//
// Policies (documented in docs/AF-NEXT-005-timing.md)
// ---------------------------------------------------
// * Activity window is half-open: start <= t < end, end = start + duration.
// * Fade: factor = shape(min(1, (t-start)/fadeIn, (end-t)/fadeOut)), one shape for both
//   ramps. Shapes: linear, ease-in (x²), ease-out (1-(1-x)²), ease-in-out (quadratic),
//   step (switches at the midpoint of each ramp). Unknown curve names → linear + diagnostic.
// * Overlap: highest-takes-precedence (HTP) per fixture+channel; on a tie the clip later
//   in the clip array wins (matches every legacy evaluator). Overlaps are reported as
//   `overlap` diagnostics because the Siemens compiler rejects them.
// * Lights: if any lighting_red/green/blue clip is active the colour comes only from
//   those channels; otherwise from the winning master clip's `color` (white if absent).
//   Master = lighting_master (or device_intensity) value, 1.0 when only RGB channels play.
// * Colour space: `color.srgb` is the gamma-encoded sRGB value stored in the clip hex
//   and written unchanged to 8-bit DMX/PLC outputs (byte = round(srgb × level × 255)).
//   `color.linear` is the IEC 61966-2-1 linearisation for renderers.
// * Motion: array-order latest-takes-precedence (positions are not additive).
// * Stop, end of play range and blackout all produce an all-off frame.
// * Mute/solo: clip.muted/disabled; recipe muted; group muted inherited via parentId;
//   when any group is soloed only recipes whose group (or ancestor) is soloed play.

import { classifyFixtureType } from "../hooks/fixtureTypeMap.js";

export const SHOW_FRAME_VERSION = "1.0.0";
export const SHOW_FRAME_CONTRACT = "aquaflow-show-frame";
/** Cross-language and cross-path tolerance for levels/colour (one 8-bit step). */
export const FRAME_TOLERANCE = 1 / 255;

export const CURVES = Object.freeze(["linear", "ease-in", "ease-out", "ease-in-out", "step"]);
const CURVE_ALIASES = {
  "": "linear", linear: "linear",
  "ease-in": "ease-in", ease_in: "ease-in", easein: "ease-in",
  "ease-out": "ease-out", ease_out: "ease-out", easeout: "ease-out",
  "ease-in-out": "ease-in-out", ease_in_out: "ease-in-out", ease_both: "ease-in-out", "ease-both": "ease-in-out",
  step: "step",
};
export const LIGHT_CHANNELS = Object.freeze(["lighting_red", "lighting_green", "lighting_blue"]);
const MASTER_TYPES = new Set(["lighting_master", "device_intensity"]);
const MOTION_POSITION = new Set(["motion_pan", "motion_tilt", "motion_angle"]);
const WATER_MOTION_SOURCES = new Set(["device_intensity", "device_enable", "solenoid_open", "motion_intensity", "pump_speed"]);
const DEFAULT_LIGHT = "#ffffff";
const BUCKET_SECONDS = 1;

const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clamp01 = value => clamp(value, 0, 1);

// ─── Curves and envelopes ──────────────────────────────────────────────────

/** Canonical curve name, or null when the value is not a supported curve. */
export function normalizeCurve(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  return CURVE_ALIASES[key] ?? null;
}

/** Shape a 0..1 ramp position. Monotone, shape(0)=0, shape(1)=1. */
export function shapeRamp(curve, x) {
  const t = clamp01(x);
  switch (curve) {
    case "ease-in": return t * t;
    case "ease-out": return 1 - (1 - t) * (1 - t);
    case "ease-in-out": return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case "step": return t < 0.5 ? 0 : 1; // switches at the middle of each ramp
    default: return t;
  }
}

/**
 * Fade factor of a clip at absolute time t (seconds). Returns 0 outside [start, end).
 * `clip` uses normalized fields { start, end, fadeIn, fadeOut, curve }.
 */
export function fadeFactor(clip, t) {
  if (!(t >= clip.start && t < clip.end)) return 0;
  let ramp = 1;
  if (clip.fadeIn > 0) ramp = Math.min(ramp, (t - clip.start) / clip.fadeIn);
  if (clip.fadeOut > 0) ramp = Math.min(ramp, (clip.end - t) / clip.fadeOut);
  return shapeRamp(clip.curve, Math.min(1, ramp));
}

/**
 * Validated keyed curve { times, values, step } from raw `keys` ([t0,v0,t1,v1,...],
 * t relative to clip start, v 0..100) and `keyMode`, or null when invalid.
 */
export function parseKeys(keys, keyMode) {
  if (!Array.isArray(keys) || keys.length < 2 || keys.length % 2) return null;
  const n = keys.length / 2, times = new Float64Array(n), values = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = keys[2 * i], v = keys[2 * i + 1];
    if (typeof t !== "number" || typeof v !== "number" || !Number.isFinite(t) || !Number.isFinite(v) || t < 0 || v < 0 || v > 100 || (i > 0 && t <= times[i - 1])) return null;
    times[i] = t; values[i] = v;
  }
  return { times, values, step: keyMode === "step" };
}

/** Value (0..100) of a keyed curve at u seconds after the clip start. Binary search. */
export function keyedValue(curve, u) {
  const { times, values } = curve, last = times.length - 1;
  if (u <= times[0]) return values[0];
  if (u >= times[last]) return values[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= u) lo = mid; else hi = mid; }
  if (curve.step) return values[lo];
  return values[lo] + (values[hi] - values[lo]) * (u - times[lo]) / (times[hi] - times[lo]);
}

/** Normalized clip level (0..1) at time t: value (or keyed curve)/100 × fade, clamped. */
export function clipLevel(clip, t) {
  const value = clip.keys ? keyedValue(clip.keys, t - clip.start) : clip.value;
  return clamp01(value / 100 * fadeFactor(clip, t));
}

/**
 * Expand keyed clips into consecutive constant clips for consumers that read
 * `clip.value` directly (hardware compilers, PLC limit checks, legacy timelines).
 * Step mode: one clip per key segment. Linear mode: one clip per `step` seconds,
 * valued at the piece midpoint (as backend show_frame.expand_keyed_clips). Other clips pass through unchanged (same objects).
 */
export function expandKeyedClips(clips, step = 0.25) {
  if (!Array.isArray(clips) || !clips.some(c => c && Array.isArray(c.keys))) return clips || [];
  const out = [];
  for (const clip of clips) {
    const curve = clip && Array.isArray(clip.keys) ? parseKeys(clip.keys, clip.keyMode) : null;
    if (!curve) {
      if (clip && Array.isArray(clip.keys)) { const { keys, keyMode, ...rest } = clip; out.push(rest); } else out.push(clip);
      continue;
    }
    const { keys, keyMode, ...base } = clip;
    const start = Number(clip.startTime ?? clip.start ?? 0), duration = Number(clip.duration);
    if (!Number.isFinite(start) || !(duration > 0)) { out.push(base); continue; }
    const cuts = [0];
    if (curve.step) for (const t of curve.times) { if (t > 0 && t < duration) cuts.push(t); }
    else for (let t = step; t < duration - 1e-9; t += step) cuts.push(Math.round(t * 1e6) / 1e6);
    cuts.push(duration);
    let n = 0;
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b - a < 1e-9) continue;
      const value = Math.round(keyedValue(curve, (a + b) / 2) * 1e4) / 1e4;
      const prev = out.at(-1);
      if (n > 0 && prev.value === value) { prev.duration = Math.round((prev.duration + b - a) * 1e6) / 1e6; continue; }
      out.push({ ...base, id: `${clip.id}~${n++}`, startTime: Math.round((start + a) * 1e6) / 1e6, duration: Math.round((b - a) * 1e6) / 1e6, value,
        fadeIn: i === 0 ? base.fadeIn : 0, fadeOut: 0 });
    }
    if (base.fadeOut && n > 0) out.at(-1).fadeOut = Math.min(base.fadeOut, out.at(-1).duration);
  }
  return out;
}

// ─── Colour ──────────────────────────────────────────────────────────────

export function validHex(value) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? String(value).toLowerCase() : null;
}
export function hexToSrgb(hex) {
  const h = validHex(hex);
  if (!h) return null;
  return { r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 };
}
export function srgbToHex({ r, g, b }) {
  return `#${[r, g, b].map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("")}`;
}
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function colorRecord(srgb, source) {
  return { hex: srgbToHex(srgb), srgb: { ...srgb },
    linear: { r: srgbToLinear(srgb.r), g: srgbToLinear(srgb.g), b: srgbToLinear(srgb.b) }, source };
}

// ─── Tempo map ───────────────────────────────────────────────────────────

/** Valid, time-ordered tempo entries; defaults to 120 BPM from t=0. */
export function normalizeTempo(tempo) {
  const list = (Array.isArray(tempo) ? tempo : [])
    .map(e => ({ time: Number(e?.time), bpm: Number(e?.bpm) }))
    .filter(e => Number.isFinite(e.time) && e.time >= 0 && e.bpm >= 20 && e.bpm <= 300)
    .sort((a, b) => a.time - b.time);
  if (!list.length || list[0].time > 0) list.unshift({ time: 0, bpm: list[0]?.bpm ?? 120 });
  return list;
}

/** Convert a beat position (0-based quarter notes) to seconds through a tempo map. */
export function beatsToSeconds(tempo, beat) {
  const map = normalizeTempo(tempo);
  let beats = 0;
  for (let i = 0; i < map.length; i++) {
    const next = map[i + 1];
    const segmentBeats = next ? (next.time - map[i].time) * map[i].bpm / 60 : Infinity;
    if (beat <= beats + segmentBeats) return map[i].time + (beat - beats) * 60 / map[i].bpm;
    beats += segmentBeats;
  }
  return 0;
}

/** Inverse of beatsToSeconds. */
export function secondsToBeats(tempo, seconds) {
  const map = normalizeTempo(tempo);
  let beats = 0;
  for (let i = 0; i < map.length; i++) {
    const next = map[i + 1];
    if (!next || seconds < next.time) return beats + (seconds - map[i].time) * map[i].bpm / 60;
    beats += (next.time - map[i].time) * map[i].bpm / 60;
  }
  return beats;
}

// ─── Mute / solo inheritance ──────────────────────────────────────────────

/** True when `flag` is set on the group or any ancestor (cycle-safe). */
export function groupInherits(groups, groupId, flag) {
  const byId = groups instanceof Map ? groups : new Map((groups || []).map(g => [g.id, g]));
  const seen = new Set();
  let group = byId.get(groupId);
  while (group && !seen.has(group.id)) {
    if (group[flag]) return true;
    seen.add(group.id);
    group = byId.get(group.parentId);
  }
  return false;
}

/** Mute/solo rule shared by compileStudio and the evaluator. */
export function recipeAudible(recipe, groups) {
  if (!recipe || recipe.muted) return false;
  const list = groups instanceof Map ? [...groups.values()] : (groups || []);
  if (groupInherits(groups, recipe.groupId, "muted")) return false;
  const hasSolo = list.some(g => g.solo);
  return !hasSolo || groupInherits(groups, recipe.groupId, "solo");
}

// ─── Fixture kinds ───────────────────────────────────────────────────────

/** Control kind of a fixture. Explicit `kind` wins; otherwise from type, then channels. */
export function fixtureKind(fixture, channelTypes = []) {
  const explicit = fixture?.kind;
  if (["water", "light", "pump", "valve", "effect", "equipment"].includes(explicit)) return explicit;
  if (fixture?.type) {
    const category = classifyFixtureType(fixture.type);
    const type = String(fixture.type).toLowerCase();
    if (category === "light") return "light";
    if (category === "effect") return "effect";
    if (category === "equipment") return type.includes("pump") ? "pump" : type.includes("valve") ? "valve" : "equipment";
    return "water";
  }
  const types = new Set(channelTypes);
  if ([...types].some(t => String(t).startsWith("lighting_"))) return "light";
  if (types.size && [...types].every(t => t === "pump_speed" || t === "pump_pressure")) return "pump";
  if (types.size && [...types].every(t => t === "solenoid_open")) return "valve";
  return "water";
}

// ─── Preparation (cached) ─────────────────────────────────────────────────

const preparedCache = new WeakMap();

function normalizeClip(raw, index, tempo, diagnostics) {
  let start, end;
  if (Number.isFinite(Number(raw.startBeat)) && raw.startTime === undefined && raw.start === undefined) {
    const startBeat = Number(raw.startBeat);
    start = beatsToSeconds(tempo, startBeat);
    end = beatsToSeconds(tempo, startBeat + finite(raw.durationBeats, 0));
  } else {
    start = Number(raw.startTime ?? raw.start ?? 0);
    end = raw.end !== undefined && raw.startTime === undefined ? Number(raw.end) : start + Number(raw.duration);
  }
  const value = Number(raw.value ?? 100);
  if (![start, end, value].every(Number.isFinite) || end <= start || !raw.fixtureId) {
    diagnostics.push({ code: "invalid-clip", severity: "error", clipId: raw.id ?? null, fixtureId: raw.fixtureId ?? null,
      message: `${raw.name || raw.id || "clip"}: invalid timing, value or fixture; ignored.` });
    return null;
  }
  let keys = null;
  if (raw.keys !== undefined && raw.keys !== null) {
    keys = parseKeys(raw.keys, raw.keyMode);
    if (!keys) diagnostics.push({ code: "invalid-keys", severity: "warning", clipId: raw.id ?? null,
      message: `${raw.name || raw.id}: keyframes are invalid; evaluated as a constant ${value}%.` });
  }
  const curve = normalizeCurve(raw.curveType);
  if (curve === null) diagnostics.push({ code: "unsupported-curve", severity: "warning", clipId: raw.id ?? null,
    curve: raw.curveType, message: `${raw.name || raw.id}: curve "${raw.curveType}" is not supported; evaluated as linear.` });
  return {
    index, id: raw.id ?? `clip-${index}`, fixtureId: raw.fixtureId, type: String(raw.type || "device_intensity"),
    start, end, value, keys, fadeIn: Math.max(0, finite(raw.fadeIn)), fadeOut: Math.max(0, finite(raw.fadeOut)),
    curve: curve ?? "linear", color: validHex(raw.color),
    pan: finite(raw.pan), tilt: finite(raw.tilt),
    recipeId: raw.studioRecipeId ?? raw.patternBlockId ?? null, trackId: raw.trackId ?? null,
  };
}

function findOverlaps(clips) {
  const byKey = new Map();
  for (const clip of clips) {
    const key = `${clip.fixtureId}\u0000${clip.type}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(clip);
  }
  const overlaps = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.start - b.start || a.index - b.index);
    let open = [];
    for (const clip of sorted) {
      open = open.filter(o => o.end > clip.start + 1e-9);
      for (const other of open) {
        overlaps.push({ code: "overlap", severity: "warning", fixtureId: clip.fixtureId, channel: clip.type,
          clipIds: [other.id, clip.id], startMs: Math.round(clip.start * 1000), endMs: Math.round(Math.min(other.end, clip.end) * 1000),
          start: clip.start, end: Math.min(other.end, clip.end),
          message: `Overlapping clips on ${clip.fixtureId} ${clip.type}: preview uses highest-takes-precedence; the Siemens compiler rejects overlapping clips on one output.` });
      }
      open.push(clip);
    }
  }
  return overlaps;
}

/** Normalize and index a project once; cached by object identity. */
export function prepareShow(project) {
  if (project && typeof project === "object" && preparedCache.has(project)) return preparedCache.get(project);
  const diagnostics = [];
  const tempo = normalizeTempo(project?.tempo);
  const groups = new Map((project?.groups || []).map(g => [g.id, g]));
  const recipes = new Map((project?.recipes || []).map(r => [r.id, r]));
  const audible = new Map();
  const clips = [];
  (project?.clips || []).forEach((raw, index) => {
    if (!raw || raw.muted === true || raw.disabled === true || raw.isMuted === true) return;
    const recipeId = raw.studioRecipeId ?? null;
    if (recipeId && recipes.has(recipeId)) {
      if (!audible.has(recipeId)) audible.set(recipeId, recipeAudible(recipes.get(recipeId), groups));
      if (!audible.get(recipeId)) return;
    } else if (raw.groupId && groups.size && !recipeAudible({ groupId: raw.groupId }, groups)) return;
    const clip = normalizeClip(raw, index, tempo, diagnostics);
    if (clip) clips.push(clip);
  });
  const fixtureList = Array.isArray(project?.fixtures) ? project.fixtures : [];
  const known = new Map(fixtureList.filter(f => f && f.id !== undefined).map(f => [f.id, f]));
  const channelTypes = new Map();
  for (const clip of clips) {
    if (!channelTypes.has(clip.fixtureId)) channelTypes.set(clip.fixtureId, new Set());
    channelTypes.get(clip.fixtureId).add(clip.type);
    if (known.size && !known.has(clip.fixtureId)) diagnostics.push({ code: "missing-fixture", severity: "warning",
      clipId: clip.id, fixtureId: clip.fixtureId, message: `${clip.id}: fixture ${clip.fixtureId} is not in the project.` });
  }
  const fixtureIds = [...new Set([...known.keys(), ...clips.map(c => c.fixtureId)])];
  const kinds = new Map(fixtureIds.map(id => [id, fixtureKind(known.get(id), [...(channelTypes.get(id) || [])])]));
  const motionFixtures = new Set(fixtureIds.filter(id => String(known.get(id)?.type || "").startsWith("motion")
    || [...(channelTypes.get(id) || [])].some(t => MOTION_POSITION.has(t))));
  const buckets = new Map();
  for (const clip of clips) {
    const first = Math.floor(clip.start / BUCKET_SECONDS), last = Math.floor(clip.end / BUCKET_SECONDS);
    for (let b = first; b <= last; b++) {
      if (!buckets.has(b)) buckets.set(b, []);
      buckets.get(b).push(clip);
    }
  }
  const overlaps = findOverlaps(clips);
  const duration = Number.isFinite(Number(project?.duration)) && Number(project.duration) > 0
    ? Number(project.duration) : clips.reduce((m, c) => Math.max(m, c.end), 0);
  const sections = (project?.sections || []).filter(s => Number.isFinite(Number(s?.start)) && Number(s?.end) > Number(s?.start))
    .map(s => ({ id: s.id, name: s.name || s.id, start: Number(s.start), end: Number(s.end) }));
  const prepared = { clips, buckets, fixtureIds, kinds, motionFixtures, duration, sections, tempo,
    diagnostics: [...diagnostics, ...overlaps], overlaps };
  if (project && typeof project === "object") preparedCache.set(project, prepared);
  return prepared;
}

/** Static diagnostics (overlaps, invalid clips, unsupported curves, missing fixtures). */
export function showDiagnostics(project) {
  return prepareShow(project).diagnostics.map(d => ({ ...d }));
}

// ─── Play range: loop / section ────────────────────────────────────────────

/**
 * Map an absolute playback time (seconds) to show time.
 * opts.section: section id or { start, end } (seconds) — plays only that range.
 * opts.loop: true | { startMs, endMs, repeat } — wraps playback inside the range.
 * Loop arithmetic is done in milliseconds with `%`, identical in the Python mirror.
 */
export function resolvePlayTime(prepared, seconds, opts = {}) {
  let rangeStart = 0, rangeEnd = prepared.duration, bounded = false;
  if (opts.section !== undefined && opts.section !== null) {
    const section = typeof opts.section === "object" ? opts.section : prepared.sections.find(s => s.id === opts.section);
    if (section) { rangeStart = Number(section.start); rangeEnd = Number(section.end); bounded = true; }
  }
  const loop = opts.loop;
  if (loop && typeof loop === "object") {
    if (Number.isFinite(Number(loop.startMs))) rangeStart = Number(loop.startMs) / 1000;
    if (Number.isFinite(Number(loop.endMs))) rangeEnd = Number(loop.endMs) / 1000;
  }
  // `seconds` is always absolute show time. Before the range start nothing wraps.
  const t = Math.max(0, finite(seconds));
  if (loop) {
    const startMs = rangeStart * 1000, spanMs = (rangeEnd - rangeStart) * 1000;
    const repeat = typeof loop === "object" && Number.isFinite(Number(loop.repeat)) ? Number(loop.repeat) : Infinity;
    if (!(spanMs > 0)) return { showTime: t, passIndex: 1, ended: true };
    if (t < rangeStart) return { showTime: t, passIndex: 1, ended: false };
    const elapsedMs = t * 1000 - startMs;
    const pass = Math.floor(elapsedMs / spanMs);
    if (pass >= repeat) return { showTime: rangeEnd, passIndex: repeat, ended: true };
    return { showTime: (startMs + elapsedMs % spanMs) / 1000, passIndex: pass + 1, ended: false };
  }
  return { showTime: t, passIndex: 1, ended: bounded && t >= rangeEnd };
}

// ─── Evaluation ──────────────────────────────────────────────────────────

function emptyRecord(kind, motion) {
  const record = { kind, level: 0, channels: {}, color: null, source: null };
  if (kind === "light") { record.color = colorRecord(hexToSrgb(DEFAULT_LIGHT), "default"); record.output = { r: 0, g: 0, b: 0 }; }
  if (motion) record.motion = { pan: 0, tilt: 0 };
  return record;
}
const sourceOf = clip => clip ? { clipId: clip.id, recipeId: clip.recipeId, trackId: clip.trackId } : null;

/**
 * Evaluate a frame at `seconds` of playback time. Adapters that already work in
 * seconds call this directly to avoid a ms round trip; evaluateShowFrame is the
 * public millisecond contract.
 */
export function evaluateShowFrameAt(project, seconds, opts = {}) {
  const prepared = prepareShow(project);
  const play = resolvePlayTime(prepared, seconds, opts);
  const state = opts.blackout || project?.blackout ? "blackout" : opts.stopped ? "stopped" : play.ended ? "ended" : "playing";
  const fixtures = {}, pumps = {}, valves = {};
  const winners = new Map();
  const motion = new Map();
  const diagnostics = [];
  const t = play.showTime;
  if (state === "playing") {
    const candidates = prepared.buckets.get(Math.floor(t / BUCKET_SECONDS)) || [];
    for (const clip of candidates) {
      if (!(t >= clip.start && t < clip.end)) continue;
      const level = clipLevel(clip, t);
      let channels = winners.get(clip.fixtureId);
      if (!channels) { channels = {}; winners.set(clip.fixtureId, channels); }
      const current = channels[clip.type];
      if (!current || level >= current.level) channels[clip.type] = { level, clip };
      if (prepared.motionFixtures.has(clip.fixtureId)) {
        const pose = motion.get(clip.fixtureId) || { pan: 0, tilt: 0 };
        if (WATER_MOTION_SOURCES.has(clip.type)) { pose.pan = clamp(clip.pan, -45, 45); pose.tilt = clamp(clip.tilt, -45, 45); }
        else if (MOTION_POSITION.has(clip.type)) pose[clip.type === "motion_tilt" ? "tilt" : "pan"] = clamp(clip.value, -45, 45);
        motion.set(clip.fixtureId, pose);
      }
    }
    for (const overlap of prepared.overlaps) if (t >= overlap.start && t < overlap.end) diagnostics.push({ ...overlap });
  } else {
    diagnostics.push({ code: state, severity: "info", message: state === "blackout" ? "Blackout: every output is off."
      : state === "stopped" ? "Stopped: every output is off." : "Past the end of the play range: every output is off." });
  }
  for (const id of prepared.fixtureIds) {
    const kind = prepared.kinds.get(id);
    const record = emptyRecord(kind, prepared.motionFixtures.has(id));
    const channels = winners.get(id);
    if (channels) {
      let best = null;
      for (const [type, win] of Object.entries(channels)) {
        record.channels[type] = win.level;
        if (!best || win.level > best.level || (win.level === best.level && win.clip.index > best.clip.index)) best = win;
      }
      if (kind === "light") {
        let master = null;
        for (const type of MASTER_TYPES) {
          const win = channels[type];
          if (win && (!master || win.level > master.level || (win.level === master.level && win.clip.index > master.clip.index))) master = win;
        }
        const rgb = LIGHT_CHANNELS.some(type => channels[type]);
        record.level = master ? master.level : rgb ? 1 : 0;
        if (rgb) record.color = colorRecord({ r: channels.lighting_red?.level ?? 0, g: channels.lighting_green?.level ?? 0,
          b: channels.lighting_blue?.level ?? 0 }, "channels");
        else if (master?.clip.color) record.color = colorRecord(hexToSrgb(master.clip.color), "clip");
        record.output = { r: record.color.srgb.r * record.level, g: record.color.srgb.g * record.level, b: record.color.srgb.b * record.level };
        record.source = sourceOf(master?.clip ?? best.clip);
      } else {
        let level = 0;
        for (const [type, win] of Object.entries(channels)) if (!MOTION_POSITION.has(type)) level = Math.max(level, win.level);
        record.level = kind === "pump" && channels.pump_speed ? channels.pump_speed.level : level;
        const hex = best.clip.color;
        record.color = hex ? colorRecord(hexToSrgb(hex), "clip") : null;
        record.source = sourceOf(best.clip);
      }
    }
    if (record.motion && motion.has(id)) record.motion = motion.get(id);
    fixtures[id] = record;
    if (kind === "pump") pumps[id] = { speed: record.level, run: record.level > 0 };
    if (kind === "valve") valves[id] = { open: record.level > 0 };
  }
  return {
    contract: SHOW_FRAME_CONTRACT, version: SHOW_FRAME_VERSION,
    timeMs: Math.max(0, finite(seconds)) * 1000, showTimeMs: t * 1000, state, passIndex: play.passIndex,
    fixtures, pumps, valves, diagnostics,
  };
}

/** Public millisecond contract. */
export function evaluateShowFrame(project, timeMs, opts = {}) {
  return evaluateShowFrameAt(project, finite(timeMs) / 1000, opts);
}

// ─── Determinism helpers ──────────────────────────────────────────────────

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Deterministic FNV-1a hash of a frame's outputs (time fields excluded). */
export function frameHash(frame) {
  const text = stable({ state: frame.state, fixtures: frame.fixtures, pumps: frame.pumps, valves: frame.valves });
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 3D-view light state { intensity, color } from a canonical light record, chosen so
 * that colour × intensity equals the emitted `output` (the PLC/DMX drive) in every view.
 * A master clip colour is shown at the master level (unchanged legacy contract).
 */
export function lightViewState(record) {
  if (!record || record.kind !== "light") return { intensity: 0, color: DEFAULT_LIGHT };
  if (record.color?.source === "channels") {
    // Chroma at full scale + brightness, so color × intensity = the emitted output.
    const { r, g, b } = record.output;
    const peak = Math.max(r, g, b);
    return { intensity: peak, color: peak > 0 ? srgbToHex({ r: r / peak, g: g / peak, b: b / peak }) : DEFAULT_LIGHT };
  }
  return { intensity: record.level, color: record.color?.hex || DEFAULT_LIGHT };
}

/** Siemens/DMX 8-bit drive bytes for a light record (round half up). */
export function lightBytes(record) {
  const out = record?.output || { r: 0, g: 0, b: 0 };
  return [out.r, out.g, out.b].map(v => Math.round(clamp01(v) * 255));
}
