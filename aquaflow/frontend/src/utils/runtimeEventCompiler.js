/**
 * runtimeSignalCompiler.js — AquaFlow Team D
 * Converts ShowProgrammer timeline clips into a sorted CompiledEvent list.
 *
 * REPLACES the 30fps frame-array approach in show_programmer_service.py.
 * Instead of pre-computing 30 frames/second (memory-intensive), this compiler
 * produces only the moments when something CHANGES, plus metadata for live
 * interpolation between changes.
 *
 * Output: CompiledShow object — ready to pass to runtime_bridge.py
 *
 * Does NOT touch:
 *   - Timeline UI, drag/resize, ShowProgrammerPanel
 *   - showStore.js, engineeringStore.js
 *   - Backend persistence routes
 *
 * Imports ONLY from:
 *   - runtimeSignalSchema.js (this package)
 *   - Vanilla JS (no React, no store)
 */

import {
  SIGNAL_PRIORITY,
  SIGNAL_SOURCE,
  SIGNAL_FLAGS,
  EASING,
  CHANNEL,
  PROTOCOL,
  FIXTURE_PROFILES,
  DEVICE_TYPE_PROFILE,
  DEFAULT_SAFETY_LIMITS,
  DEVICE_EMERGENCY_STATE,
} from "./runtimeSignalSchema.js";
import { evaluateShowFrameAt, expandKeyedClips, normalizeCurve, showDiagnostics } from "../show/evaluateShowFrame.js";

// ─── Compiler Version ────────────────────────────────────────────────────────

const COMPILER_VERSION = "2.0.0";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Compile a ShowProgrammer session into a hardware-ready CompiledShow.
 *
 * @param {Object} params
 * @param {Array}  params.timelineClips    — clips from ShowProgrammerPanel local state
 * @param {Array}  params.beatMarkers      — beat timestamps
 * @param {Array}  params.cues             — named cue points
 * @param {number} params.audioDuration    — show duration in seconds
 * @param {number} params.bpm              — show BPM
 * @param {Object} params.deviceRegistry   — { deviceId: DeviceAddress }
 * @param {Object} [params.options]        — compile options
 *
 * @returns {{ compiled: CompiledShow|null, errors: string[], warnings: string[] }}
 */
/**
 * Generate a stable event ID from clip and channel data
 * Same inputs always produce same ID
 */
const toCompilerNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function generateEventId(clipId, deviceId, channelId, time, value) {
  const safeTime = toCompilerNumber(time, 0);
  const safeValue = toCompilerNumber(value, 0);

  const str = `${clipId || "clip"}|${deviceId || "device"}|${channelId || "channel"}|${safeTime.toFixed(6)}|${safeValue.toFixed(6)}`;

  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }

  return `evt_${Math.abs(hash).toString(16)}`;
}

/**
 * Compile a ShowProgrammer session into a hardware-ready CompiledShow.
 *
 * @param {Object} params
 * @param {Array}  params.timelineClips    — clips from ShowProgrammerPanel local state
 * @param {Array}  params.beatMarkers      — beat timestamps
 * @param {Array}  params.cues             — named cue points
 * @param {number} params.audioDuration    — show duration in seconds
 * @param {number} params.bpm              — show BPM
 * @param {Object} params.deviceRegistry   — { deviceId: DeviceAddress }
 * @param {Object} [params.options]        — compile options
 *
 * @returns {{ compiled: CompiledShow|null, errors: string[], warnings: string[] }}
 */
export function compileShow({
  timelineClips   = [],
  beatMarkers     = [],
  cues            = [],
  audioDuration   = 60,
  bpm             = 128,
  deviceRegistry  = {},
  options         = {},
}) {
  const errors   = [];
  const warnings = [];

  // ── 1. Validate inputs ────────────────────────────────────────────────────
  timelineClips = expandKeyedClips(timelineClips);
  const validationResult = _validateInputs(timelineClips, deviceRegistry);
  errors.push(...validationResult.errors);
  warnings.push(...validationResult.warnings);

  if (errors.length > 0 && !options.ignoreErrors) {
    return { compiled: null, errors, warnings };
  }

  // ── 2. Resolve group → individual devices ─────────────────────────────────
  const expandedClips = _expandGroupClips(timelineClips, deviceRegistry, warnings);

  // AF-NEXT-004: overlapping clips on one output are resolved highest-takes-precedence
  // by the canonical frame, but an event list cannot express that and the Siemens
  // compiler rejects them, so they surface here as diagnostics.
  for (const issue of showDiagnostics({ clips: expandedClips })) {
    if (issue.code === "overlap") warnings.push(`OVERLAP: ${issue.message} (clips ${issue.clipIds.join(", ")} at ${(issue.startMs / 1000).toFixed(3)}s)`);
  }

  // ── 3. Extract events from each clip ─────────────────────────────────────
  const rawEvents = [];
  for (const clip of expandedClips) {
    const clipEvents = _extractClipEvents(clip, deviceRegistry, warnings);
    rawEvents.push(...clipEvents);
  }

  // ── 4. Apply latency compensation ─────────────────────────────────────────
  const compensatedEvents = _applyLatencyCompensation(rawEvents, deviceRegistry, warnings);

  // ── 5. Sort events by time, then priority, then deviceId ──────────────────
  // At equal times a clip's closing event sorts before another clip's opening event
  // so back-to-back clips follow the canonical half-open [start, end) window.
  const EDGE_ORDER = { end: 0, start: 1, ramp: 2 };
  compensatedEvents.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    if (a.deviceId === b.deviceId && a.channelId === b.channelId && a.edge !== b.edge) {
      return (EDGE_ORDER[a.edge] ?? 1) - (EDGE_ORDER[b.edge] ?? 1);
    }
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.deviceId !== b.deviceId) return String(a.deviceId).localeCompare(String(b.deviceId));
    if (a.channelId !== b.channelId) return String(a.channelId).localeCompare(String(b.channelId));
    return String(a.clipId).localeCompare(String(b.clipId));
  });

  // ── 6. Add stable event IDs ───────────────────────────────────────────────
  const eventsWithIds = compensatedEvents.map(event => ({
    ...event,
    eventId: generateEventId(event.clipId, event.deviceId, event.channelId, event.time, event.value)
  }));

  // ── 7. Deduplicate redundant events ──────────────────────────────────────
  const deduped = _deduplicateEvents(eventsWithIds);

  // ── 8. Run safety validation ──────────────────────────────────────────────
  const safetyResult = _validateSafety(deduped, deviceRegistry, expandedClips);
  errors.push(...safetyResult.errors);
  warnings.push(...safetyResult.warnings);

  if (safetyResult.errors.length > 0 && !options.ignoreSafetyErrors) {
    return { compiled: null, errors, warnings };
  }

  // ── 9. Build device address map ───────────────────────────────────────────
  const deviceMap = _buildDeviceMap(deduped, deviceRegistry);

  // ── 10. Build safety limits map ───────────────────────────────────────────
  const safetyLimits = _buildSafetyLimits(deviceMap);

  // ── 11. Build sync points from cues + beat markers ───────────────────────
  const syncPoints = _buildSyncPoints(cues, beatMarkers, bpm);

  // ── 12. Build latency offset map ─────────────────────────────────────────
  const latencyOffsets = _buildLatencyOffsets(deviceMap, deviceRegistry);

  // ── 13. Assemble final CompiledShow ───────────────────────────────────────
  const compiled = {
    id:              `compiled_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version:         COMPILER_VERSION,
    compiledAt:      new Date().toISOString(),
    duration:        audioDuration,
    bpm,
    tickRate:        100,              // Hz — matches show_engine.py TICK_RATE
    audioOffset:     0,                // seconds: audio starts at show epoch 0
    events:          deduped,
    // Resolved per-fixture clips: the input of the canonical show frame (AF-NEXT-004).
    clips:           expandedClips,
    deviceMap,
    safetyLimits,
    syncPoints,
    latencyOffsets,
    cues:            cues.map(c => ({ ...c })),
    meta: {
      eventCount:    deduped.length,
      deviceCount:   Object.keys(deviceMap).length,
      clipCount:     timelineClips.length,
      compilerVersion: COMPILER_VERSION,
      warnings,
    },
  };

  return { compiled, errors, warnings };
}
export function evaluateChannel(events, deviceId, channelId, playhead) {
  const safePlayhead = Math.max(0, toCompilerNumber(playhead, 0));

  const relevant = events.filter(
    e => e.deviceId === deviceId && e.channelId === channelId
  );

  if (relevant.length === 0) return 0;

  let prevIdx = -1;

  for (let i = 0; i < relevant.length; i++) {
    if (relevant[i].time <= safePlayhead) {
      prevIdx = i;
    } else {
      break;
    }
  }

  if (prevIdx === -1) return 0;

  const prev = relevant[prevIdx];
  const next = relevant[prevIdx + 1] ?? null;

  if (!next || prev.easing === EASING.STEP) {
    return toCompilerNumber(prev.value, 0);
  }

  const span = next.time - prev.time;

  if (!Number.isFinite(span) || span <= 0) {
    return toCompilerNumber(next.value ?? prev.value, 0);
  }

  const t = Math.max(0, Math.min(1, (safePlayhead - prev.time) / span));

  return _applyEasing(
    prev.easing,
    t,
    toCompilerNumber(prev.value, 0),
    toCompilerNumber(next.value, 0),
    prev.easingParams
  );
}

/**
 * Get all device channels that are currently active at a playhead position.
 * Used for rendering the 3D preview and for sending to hardware.
 *
 * @param {Array}  events   — sorted CompiledEvent[]
 * @param {number} playhead
 * @returns {Object}        — { deviceId: { channelId: value } }
 */
export function evaluateAllChannels(events, playhead) {
  // Collect unique device+channel pairs
  const pairs = new Set(events.map(e => `${e.deviceId}::${e.channelId}`));
  const result = {};

  for (const pair of pairs) {
    const [deviceId, channelId] = pair.split("::");
    const value = evaluateChannel(events, deviceId, channelId, playhead);

    if (!result[deviceId]) result[deviceId] = {};
    result[deviceId][channelId] = value;
  }

  return result;
}

/**
 * Get all events that fall within a time window.
 * Used by the runtime to fetch newly-crossed events each tick.
 *
 * @param {Array}  events     — sorted CompiledEvent[]
 * @param {number} fromTime   — exclusive lower bound
 * @param {number} toTime     — inclusive upper bound
 * @returns {Array}           — CompiledEvent[] in time order
 */
export function getEventsInWindow(events, fromTime, toTime) {
  // Binary search for start index
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].time <= fromTime) lo = mid + 1;
    else hi = mid;
  }

  const result = [];
  for (let i = lo; i < events.length; i++) {
    if (events[i].time > toTime) break;
    result.push(events[i]);
  }
  return result;
}

// ─── Internal: Input Validation ──────────────────────────────────────────────

function _validateInputs(clips, registry) {
  const errors = [], warnings = [];

  if (!Array.isArray(clips)) {
    errors.push("timelineClips must be an array");
    return { errors, warnings };
  }

  for (const clip of clips) {
    if (!clip.id)       warnings.push(`Clip missing id — will be skipped`);
    if (!clip.trackId)  warnings.push(`Clip ${clip.id} missing trackId`);
    if (clip.duration <= 0) warnings.push(`Clip ${clip.id} has invalid duration ${clip.duration} — compiler will normalize`);
    if (clip.startTime < 0) warnings.push(`Clip ${clip.id} has negative startTime — compiler will normalize`);
  }

  if (Object.keys(registry).length === 0) {
    warnings.push("Device registry is empty — clips will compile but cannot route to hardware");
  }

  return { errors, warnings };
}

// ─── Internal: Group Expansion ───────────────────────────────────────────────

function _expandGroupClips(clips, registry, warnings) {
  const expanded = [];
  
  for (const clip of clips) {
    // Skip invalid clips
    if (!clip.id) continue;
    
    // Get fixtures for this clip
    let fixtureIds = [];
    
    // Case 1: clip has fixtures array
    if (clip.fixtures && Array.isArray(clip.fixtures) && clip.fixtures.length > 0) {
      fixtureIds = clip.fixtures;
    }
    // Case 2: clip has fixtureId (single fixture)
    else if (clip.fixtureId) {
      fixtureIds = [clip.fixtureId];
    }
    // Case 3: clip has trackId that matches a group
    else if (clip.trackId && registry[clip.trackId] && registry[clip.trackId].groupId) {
      // Find all devices in this group
      const groupId = registry[clip.trackId].groupId;
      fixtureIds = Object.keys(registry).filter(id => registry[id]?.groupId === groupId);
      if (fixtureIds.length === 0) {
        fixtureIds = [clip.trackId];
      }
    }
    // Case 4: fallback to trackId
    else if (clip.trackId) {
      fixtureIds = [clip.trackId];
    }
    // Case 5: no fixture
    else {
      warnings.push(`Clip ${clip.id} has no fixture assignment — using trackId as fallback`);
      fixtureIds = [clip.trackId || clip.id];
    }
    
    // For each fixture, create a copy of the clip
    for (const fixtureId of fixtureIds) {
      const expandedClip = {
        ...clip,
        fixtureId: fixtureId,
        // Keep original fixtures array for reference
        originalFixtures: clip.fixtures,
      };
      expanded.push(expandedClip);
    }
  }
  
  // Remove duplicates (same clipId + same fixtureId)
  const seen = new Set();
  return expanded.filter(clip => {
    const key = `${clip.id}|${clip.fixtureId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function _extractClipEvents(clip, registry, warnings) {
  const events = [];
  
  // TIMESTAMP NORMALIZATION
  let startTime = clip.startTime ?? 0;
  let duration = clip.duration ?? 2;
  
  // Fix NaN or undefined
  if (isNaN(startTime)) startTime = 0;
  if (isNaN(duration)) duration = 2;
  
  // Fix negative times
  if (startTime < 0) {
    warnings.push(`Clip ${clip.id} had negative startTime (${startTime}) — clamped to 0`);
    startTime = 0;
  }
  
  // Fix invalid duration
  if (duration <= 0) {
    warnings.push(`Clip ${clip.id} had invalid duration (${duration}) — set to 0.1s`);
    duration = 0.1;
  }
  
  const endTime = startTime + duration;

  // Resolve which device and channel this clip targets
  const deviceId  = clip.fixtureId || clip.trackId;
  const trackType = clip.type || "device_intensity";

  if (!deviceId) {
    warnings.push(`Clip ${clip.id} has no deviceId/fixtureId — skipped`);
    return events;
  }

  // Determine channels to emit based on track type
  const clipEasing = normalizeCurveType(clip.curveType);
  const channels = _getChannelsForTrackType(trackType, clip, clipEasing);

  // AF-NEXT-004: fades follow the canonical show-frame envelope. A fade-in ramps
  // 0→value with the clip curve, the level holds, a fade-out ramps value→0 with the
  // mirrored curve, and the clip closes with a step to 0 at its end.
  const curve = normalizeCurve(clip.curveType) || "linear";
  const FADE_IN_EASING = { linear: EASING.LINEAR, "ease-in": EASING.EASE_IN, "ease-out": EASING.EASE_OUT, "ease-in-out": EASING.EASE_BOTH };
  const FADE_OUT_EASING = { linear: EASING.LINEAR, "ease-in": EASING.EASE_OUT, "ease-out": EASING.EASE_IN, "ease-in-out": EASING.EASE_BOTH };
  let fadeIn = Number(clip.fadeIn ?? 0);
  let fadeOut = Number(clip.fadeOut ?? 0);
  if (!Number.isFinite(fadeIn) || fadeIn < 0) fadeIn = 0;
  if (!Number.isFinite(fadeOut) || fadeOut < 0) fadeOut = 0;
  const base = { deviceId, priority: SIGNAL_PRIORITY.TIMELINE, clipId: clip.id, easingParams: [] };

  channels.forEach(({ channelId, startValue, endValue }, index) => {
    // Binary channels (valves, triggers, shutters) and motion positions never ramp.
    // Fades apply to the primary channel only, as before.
    const ramps = index === 0 && !/^(solenoid_open|solenoid_duration|device_enable|fire_trigger|laser_intensity|motion_pan|motion_tilt|motion_angle)$/.test(String(trackType).toLowerCase());
    const fin = ramps ? fadeIn : 0, fout = ramps ? fadeOut : 0;
    const push = (time, value, eventEasing, edge, flags = SIGNAL_FLAGS.NONE) =>
      events.push({ ...base, time, channelId, value, easing: eventEasing, flags, edge });
    if (fin > 0) {
      if (curve === "step") {
        push(startTime, 0, EASING.STEP, "start", SIGNAL_FLAGS.FADE_IN);
        push(startTime + fin / 2, startValue, EASING.STEP, "ramp", SIGNAL_FLAGS.FADE_IN);
      } else {
        push(startTime, 0, FADE_IN_EASING[curve], "start", SIGNAL_FLAGS.FADE_IN);
        push(startTime + fin, startValue, EASING.STEP, "ramp", SIGNAL_FLAGS.FADE_IN);
      }
    } else {
      push(startTime, startValue, EASING.STEP, "start");
    }
    if (fout > 0) {
      if (curve === "step") push(endTime - fout / 2, endValue, EASING.STEP, "ramp", SIGNAL_FLAGS.FADE_OUT);
      else push(endTime - fout, startValue, FADE_OUT_EASING[curve], "ramp", SIGNAL_FLAGS.FADE_OUT);
    }
    push(endTime, endValue, EASING.STEP, "end");
  });

  return events;
}

function _getChannelsForTrackType(trackType, clip, clipEasing = EASING.LINEAR) {
  const type = String(trackType || "").toLowerCase();
  const intensity = Math.max(0, Math.min(1, (clip.value ?? 100) / 100));

  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v || 0)));
  const clampSigned = (v) => Math.max(-1, Math.min(1, Number(v || 0)));

  if (type === "lighting_red") {
    return [{ channelId: CHANNEL.RED, startValue: intensity, endValue: 0, easing: clipEasing }];
  }

  if (type === "lighting_green") {
    return [{ channelId: CHANNEL.GREEN, startValue: intensity, endValue: 0, easing: clipEasing }];
  }

  if (type === "lighting_blue") {
    return [{ channelId: CHANNEL.BLUE, startValue: intensity, endValue: 0, easing: clipEasing }];
  }

  if (type === "lighting_master") {
    return [{ channelId: CHANNEL.INTENSITY, startValue: intensity, endValue: 0, easing: clipEasing }];
  }

  if (type === "pump_speed") {
    return [{ channelId: CHANNEL.PUMP_SPEED, startValue: intensity, endValue: 0, easing: EASING.EASE_BOTH }];
  }

  if (type === "pump_pressure") {
    return [{ channelId: CHANNEL.PRESSURE, startValue: intensity, endValue: 0, easing: EASING.EASE_BOTH }];
  }

  if (type === "solenoid_open" || type === "solenoid_duration") {
    // Binary valve control — STEP easing: open on clip start, close at clip end
    return [{ channelId: CHANNEL.ENABLE, startValue: intensity, endValue: 0, easing: EASING.STEP }];
  }

  // B1 FIX: device_enable was missing — fell through to CHANNEL.INTENSITY (wrong)
  if (type === "device_enable") {
    return [{ channelId: CHANNEL.ENABLE, startValue: intensity > 0.5 ? 1 : 0, endValue: 0, easing: EASING.STEP }];
  }

  // B2 FIX: device_intensity was implicit fallthrough — now explicit
  if (type === "device_intensity") {
    return [{ channelId: CHANNEL.INTENSITY, startValue: intensity, endValue: 0, easing: EASING.LINEAR }];
  }

  if (type === "fire_trigger") {
    // Binary trigger — STEP: on/off with no ramp. Safety-critical.
    return [{ channelId: CHANNEL.FLAME, startValue: 1.0, endValue: 0, easing: EASING.STEP }];
  }

  if (type === "fire_intensity") {
    // Variable flame height/intensity — LINEAR allows smooth ramping.
    // NOTE: SafetyGuard still enforces max_on_duration_ms regardless of easing.
    return [{ channelId: CHANNEL.FLAME, startValue: intensity, endValue: 0, easing: EASING.LINEAR }];
  }

  if (type === "fog_density") {
    return [{ channelId: CHANNEL.FOG_DENSITY, startValue: intensity, endValue: 0, easing: EASING.LINEAR }];
  }

  if (type === "laser_intensity") {
    return [{ channelId: CHANNEL.LASER_BEAM, startValue: intensity, endValue: 0, easing: EASING.STEP }];
  }

  if (type === "laser_pattern") {
    return [{ channelId: CHANNEL.LASER_PATTERN, startValue: intensity, endValue: 0, easing: EASING.LINEAR }];
  }

  if (type === "motion_pan") {
    return [{ channelId: CHANNEL.PAN, startValue: clampSigned((clip.pan || 0) / 180), endValue: 0, easing: EASING.EASE_BOTH }];
  }

  if (type === "motion_tilt") {
    return [{ channelId: CHANNEL.TILT, startValue: clampSigned((clip.tilt || 0) / 180), endValue: 0, easing: EASING.EASE_BOTH }];
  }

  if (type === "motion_angle") {
    // B3 FIX: was emitting raw string "angle" — CHANNEL.ANGLE now defined in schema.
    // motion_1d_2ch profile maps CHANNEL.ANGLE to ch+0 and CHANNEL.SPEED to ch+1.
    return [{ channelId: CHANNEL.ANGLE, startValue: clampSigned((clip.angle || 0) / 180), endValue: 0, easing: EASING.EASE_BOTH }];
  }

  if (type === "motion_intensity") {
    return [{ channelId: CHANNEL.INTENSITY, startValue: intensity, endValue: 0, easing: EASING.LINEAR }];
  }

  return [{ channelId: CHANNEL.INTENSITY, startValue: intensity, endValue: 0, easing: EASING.LINEAR }];
}

// ─── Internal: Latency Compensation ──────────────────────────────────────────

function _applyLatencyCompensation(events, registry, warnings) {
  return events.map(event => {
    const device = registry[event.deviceId];
    const latencyMs = device?.latencyMs ?? 0;

    if (latencyMs <= 0) return event;

    const offset = latencyMs / 1000;
    const compensatedTime = Math.max(0, event.time - offset);

    if (compensatedTime === 0 && event.time > 0) {
      warnings.push(
        `Device ${event.deviceId} latency (${latencyMs}ms) would pre-fire before show start — clamped to 0`
      );
    }

    return {
      ...event,
      time:  compensatedTime,
      flags: event.flags | SIGNAL_FLAGS.LATENCY_COMPENSATED,
    };
  });
}

// ─── Internal: Deduplication ─────────────────────────────────────────────────

function _deduplicateEvents(events) {
  // Remove events where the value hasn't changed from the previous event
  // for the same device+channel. Keep the first and last events always.
  const result = [];
  const lastValue = {};

  for (const event of events) {
    const key = `${event.deviceId}::${event.channelId}`;
    const prev = lastValue[key];

    const isRedundant = (
      prev !== undefined &&
      Math.abs(prev - event.value) < 0.001 &&
      event.easing === EASING.STEP
    );

    if (!isRedundant) {
      result.push(event);
      lastValue[key] = event.value;
    }
  }

  return result;
}

// ─── Internal: Safety Validation ─────────────────────────────────────────────

function _validateSafety(events, registry, clips = []) {
  const errors = [], warnings = [];

  // AF-NEXT-009: when the resolved clips are available, safety is judged on the canonical
  // show frame (the same state the timeline, 3D preview and PLC evaluate). The backend
  // preflight (services/preflight.py, POST /api/preflight) is the authoritative gate; this
  // is the small client-side subset that runs during compile.
  if (Array.isArray(clips) && clips.length) {
    const frame = _validateFrameSafety(clips, registry);
    return { errors: [...errors, ...frame.errors], warnings: [...warnings, ...frame.warnings] };
  }

  // Event-only fallback (no resolved clips): flame on/off event pairs.
  // Parens are explicit: flame channel OR (enable channel that belongs to a flame device).
  const fireEvents = events.filter(e =>
    e.channelId === CHANNEL.FLAME ||
    (e.channelId === CHANNEL.ENABLE && registry[e.deviceId]?.deviceType === "flame")
  );
  const fireDevices = new Set(fireEvents.map(e => e.deviceId));
  for (const deviceId of fireDevices) {
    const deviceFireEvents = fireEvents.filter(e => e.deviceId === deviceId);
    for (let i = 0; i < deviceFireEvents.length - 1; i++) {
      const onEvent  = deviceFireEvents[i];
      const offEvent = deviceFireEvents[i + 1];
      if (offEvent.value === 0 && onEvent.value > 0) {
        const duration = (offEvent.time - onEvent.time) * 1000;
        const limit    = DEFAULT_SAFETY_LIMITS.flame.maxOnDurationMs;
        if (duration > limit) {
          errors.push(
            `SAFETY: Device ${deviceId} fire duration ${duration}ms exceeds limit ${limit}ms`
          );
        }
      }
    }
  }

  return { errors, warnings };
}

const _isFlameType = (text) => /flame|fire/i.test(String(text || ""));
const _registryKind = (address = {}) => {
  const t = String(address.deviceType || address.type || "").toLowerCase();
  if (_isFlameType(t)) return "effect";
  if (t.includes("pump")) return "pump";
  if (t.includes("valve") || t.includes("solenoid")) return "valve";
  return undefined;
};

/** Per-device on-time tracking and pump/valve dependency checks on the canonical frame. */
function _validateFrameSafety(clips, registry) {
  const errors = [], warnings = [];
  const fixtures = Object.entries(registry || {}).map(([id, address]) => {
    const kind = _registryKind(address);
    return kind ? { id, kind } : { id, type: address?.deviceType || address?.type };
  });
  const flames = new Set(Object.entries(registry || {})
    .filter(([, a]) => _isFlameType(a?.deviceType || a?.type)).map(([id]) => id));
  clips.forEach(c => { if (c?.fixtureId && (_isFlameType(c.type) || c.trackType === "flame")) flames.add(c.fixtureId); });
  const pumpOf = new Map(Object.entries(registry || {})
    .map(([id, a]) => [id, a?.pumpId ?? a?.supplyingPumpId ?? a?.engineering?.pumpId])
    .filter(([, pump]) => pump));
  // Only the fixtures these rules look at are evaluated (the frame is per fixture), which
  // keeps this cheap for large shows.
  const relevant = new Set([...flames, ...pumpOf.keys(), ...pumpOf.values()]);
  if (!relevant.size) return { errors, warnings };
  const relevantClips = clips.filter(c => relevant.has(c?.fixtureId));
  const project = { fixtures: fixtures.filter(f => relevant.has(f.id)), clips: relevantClips };
  const times = [...new Set(relevantClips.flatMap(c => {
    const start = Number(c?.startTime ?? c?.start ?? 0), duration = Number(c?.duration ?? 0);
    return Number.isFinite(start) && Number.isFinite(duration) ? [start, start + duration] : [];
  }))].sort((a, b) => a - b);
  const onSince = new Map(), reported = new Set();
  for (let i = 0; i < times.length - 1; i++) {
    const t0 = times[i], t1 = times[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const frame = evaluateShowFrameAt(project, (t0 + t1) / 2);
    for (const id of flames) {
      const on = (frame.fixtures[id]?.level || 0) > 0;
      if (!on) { onSince.delete(id); continue; }
      if (!onSince.has(id)) onSince.set(id, t0);
      const limit = registry?.[id]?.maxOnDurationMs ?? DEFAULT_SAFETY_LIMITS.flame.maxOnDurationMs;
      const onMs = (t1 - onSince.get(id)) * 1000;
      if (onMs > limit && !reported.has(`flame:${id}`)) {
        reported.add(`flame:${id}`);
        errors.push(`SAFETY: Device ${id} fire continuously on ${Math.round(onMs)}ms from ${onSince.get(id).toFixed(2)}s exceeds limit ${limit}ms`);
      }
    }
    const openByPump = new Map();
    for (const [valve, pump] of pumpOf) {
      const open = Boolean(frame.valves[valve]?.open);
      if (open) openByPump.set(pump, true);
      if (open && frame.pumps[pump] && !frame.pumps[pump].run && !reported.has(`dry:${valve}`)) {
        reported.add(`dry:${valve}`);
        warnings.push(`SAFETY: Valve ${valve} is open at ${t0.toFixed(2)}s while pump ${pump} is stopped (no flow).`);
      }
    }
    for (const pump of new Set(pumpOf.values())) {
      if (frame.pumps[pump]?.run && !openByPump.get(pump) && !reported.has(`dead:${pump}`)) {
        reported.add(`dead:${pump}`);
        warnings.push(`SAFETY: Pump ${pump} runs at ${t0.toFixed(2)}s with every linked valve closed (dead-head).`);
      }
    }
  }
  return { errors, warnings };
}

// ─── Internal: Build Support Maps ────────────────────────────────────────────

function _buildDeviceMap(events, registry) {
  const deviceMap = {};
  const deviceIds = new Set(events.map(e => e.deviceId));
  for (const id of deviceIds) {
    deviceMap[id] = registry[id] ?? {
      deviceId: id,
      protocol: PROTOCOL.RELAY,    // safe fallback
      latencyMs: 0,
    };
  }
  return deviceMap;
}

function _buildSafetyLimits(deviceMap) {
  const limits = {};
  for (const [deviceId, address] of Object.entries(deviceMap)) {
    const template = DEFAULT_SAFETY_LIMITS[address.deviceType]
                  ?? DEFAULT_SAFETY_LIMITS._default;
    limits[deviceId] = { ...template, deviceId };
  }
  return limits;
}

function _buildSyncPoints(cues, beatMarkers, bpm) {
  const points = [];
  const beatDuration = 60 / (bpm || 128);

  for (const cue of cues) {
    points.push({
      type:    "cue",
      time:    cue.time,
      label:   cue.label,
      color:   cue.color,
      flags:   "HARD_SYNC",  // cues are hard sync points for distributed nodes
    });
  }

  for (const beat of beatMarkers) {
    points.push({
      type:  "beat",
      time:  beat.time,
      bpm:   beat.bpm,
      flags: "SOFT_SYNC",
    });
  }

  return points.sort((a, b) => a.time - b.time);
}

function _buildLatencyOffsets(deviceMap, registry) {
  const offsets = {};
  for (const deviceId of Object.keys(deviceMap)) {
    const latencyMs = registry[deviceId]?.latencyMs ?? 0;
    if (latencyMs > 0) {
      offsets[deviceId] = latencyMs / 1000;  // convert to seconds
    }
  }
  return offsets;
}

// ─── Internal: Easing Math ────────────────────────────────────────────────────

// B6 FIX: afshow_schema_v1.py uses hyphenated curveType strings ("ease-in", "ease-in-out").
// runtimeSignalSchema.js EASING constants use underscores ("ease_in", "ease_both").
// This map normalizes both conventions so clips loaded from .afshow files get the
// correct easing applied at runtime instead of falling through to LINEAR.

const CURVE_TYPE_NORMALIZE = Object.freeze({
  "linear":       EASING.LINEAR,
  "step":         EASING.STEP,
  "ease_in":      EASING.EASE_IN,
  "ease-in":      EASING.EASE_IN,
  "ease_out":     EASING.EASE_OUT,
  "ease-out":     EASING.EASE_OUT,
  "ease_both":    EASING.EASE_BOTH,
  "ease_in_out":  EASING.EASE_BOTH,
  "ease-in-out":  EASING.EASE_BOTH,   // afshow schema name
  "ease-both":    EASING.EASE_BOTH,
  "sine":         EASING.SINE,
  "pulse":        EASING.SINE,        // pulse ≈ sine wave
  "wave":         EASING.SINE,
  "bezier":       EASING.BEZIER,
});

export function normalizeCurveType(raw) {
  const key = String(raw || "").toLowerCase().trim();
  return CURVE_TYPE_NORMALIZE[key] ?? EASING.LINEAR;
}

function _applyEasing(type, t, from, to, params) {
  const range = to - from;

  switch (type) {
    case EASING.STEP:      return t < 1 ? from : to;
    case EASING.LINEAR:    return from + range * t;
    case EASING.EASE_IN:   return from + range * (t * t);
    case EASING.EASE_OUT:  return from + range * (1 - (1 - t) * (1 - t));
    case EASING.EASE_BOTH: {
      const c = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      return from + range * c;
    }
    case EASING.SINE: {
      const c = 0.5 - Math.cos(t * Math.PI) / 2;
      return from + range * c;
    }
    case EASING.BEZIER: {
      // params = [p1x, p1y, p2x, p2y] (CSS cubic-bezier style)
      // TODO Phase 2: implement proper cubic bezier evaluation
      const c = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      return from + range * c;
    }
    default: return from + range * t;
  }
}

// ─── Internal: Utilities ─────────────────────────────────────────────────────

function _hexToRgb01(hex) {
  const raw = String(hex || "").trim().replace("#", "");
  if (raw.length !== 6) return null;
  return {
    r: parseInt(raw.slice(0, 2), 16) / 255,
    g: parseInt(raw.slice(2, 4), 16) / 255,
    b: parseInt(raw.slice(4, 6), 16) / 255,
  };
}
