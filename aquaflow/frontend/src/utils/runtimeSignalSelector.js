
// src/utils/runtimeSignalSelector.js
// Converts show timeline clips at the current playhead into normalized runtime signals.
// This is the bridge between Timeline / AI / Manual Pattern Design and 3D Preview / PLC Compile.

import { DEFAULT_DEVICE_GROUPS } from "./deviceGroupSelector";

const DEFAULT_GROUP_SIGNALS = Object.fromEntries(
  DEFAULT_DEVICE_GROUPS.map(group => [group.id, 0])
);

const DEFAULT_SIGNALS = Object.freeze({
  pump: 0,
  valve: 0,
  lighting: 0,

  // RGB/RGBW lighting channels.
  // These allow real lighting fixtures to respond as RGB, not only as one dimmer.
  lightingColor: {
    r: 1,
    g: 1,
    b: 1,
    w: 0,
  },

  flame: 0,
  fog: 0,
  laser: 0,
  motion_1d: 0,
  motion_2d: 0,
  motion_3d: 0,
  screen: 0,
  groups: DEFAULT_GROUP_SIGNALS,
});

const TYPE_ALIASES = {
  pump: "pump",
  pumps: "pump",
  water: "pump",
  jet: "pump",
  jets: "pump",
  nozzle: "pump",
  nozzles: "pump",

  running_fountain_jets: "running_fountain_jets",
  running_fountain: "running_fountain_jets",
  foam_jets: "foam_jets",
  foam: "foam_jets",
  peacock_jets: "peacock_jets",
  peacock: "peacock_jets",

  valve: "valve",
  valves: "valve",
  solenoid: "valve",

  light: "lighting",
  lights: "lighting",
  lighting: "lighting",
  led: "lighting",
  leds: "lighting",
  dmx: "lighting",

  fire: "flame",
  flame: "flame",
  flames: "flame",

  fog: "fog",
  mist: "fog",
  smoke: "fog",

  laser: "laser",
  lasers: "laser",

  center_jets: "center_jets",
  center: "center_jets",
  crown: "center_jets",

  outer_ring_jets: "outer_ring_jets",
  outer_ring: "outer_ring_jets",
  ring_jets: "outer_ring_jets",
  ring: "outer_ring_jets",

  arch_jets: "arch_jets",
  arch: "arch_jets",

  cascade_jets: "cascade_jets",
  cascade: "cascade_jets",

  screen_jets: "screen_jets",
  screen: "screen_jets",
  water_screen: "screen_jets",
  projection: "screen_jets",

  mist_jets: "mist_jets",
  mist_jets_group: "mist_jets",

  rgb_lights: "rgb_lights",
  lights_group: "rgb_lights",

  fog_machines: "fog_machines",
  fog_group: "fog_machines",

  flame_units: "flame_units",
  flame_group: "flame_units",

    laser_units: "laser_units",
  laser_group: "laser_units",

  motion_1d_jets: "motion_1d_jets",
  motion_1d: "motion_1d_jets",
  motion_2d_jets: "motion_2d_jets",
  motion_2d: "motion_2d_jets",
  motion_3d_jets: "motion_3d_jets",
  motion_3d: "motion_3d_jets",
};

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeIntensity(value, fallback = 1) {
  if (value === undefined || value === null || value === "") return clamp01(fallback);
  const n = Number(value);
  if (!Number.isFinite(n)) return clamp01(fallback);
  // Accept both 0..1 and 0..100 formats.
  if (n > 1) return clamp01(n / 100);
  return clamp01(n);
}
function normalizeColorChannel(value, fallback = 1) {
  if (value === undefined || value === null || value === "") return clamp01(fallback);

  const n = Number(value);
  if (!Number.isFinite(n)) return clamp01(fallback);

  // Accept both 0..1 and 0..255 formats.
  if (n > 1) return clamp01(n / 255);

  return clamp01(n);
}

function hexToRgb01(hex) {
  const raw = String(hex || "").trim().replace("#", "");

  if (raw.length !== 6) {
    return null;
  }

  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);

  if (![r, g, b].every(Number.isFinite)) {
    return null;
  }

  return {
    r: clamp01(r / 255),
    g: clamp01(g / 255),
    b: clamp01(b / 255),
    w: 0,
  };
}

function clipColorAt(clip) {
  const directHex =
    clip?.color ??
    clip?.hex ??
    clip?.lightColor ??
    clip?.rgbHex;

  const parsedHex = hexToRgb01(directHex);
  if (parsedHex) return parsedHex;

  const rgb = clip?.rgb ?? clip?.colorRgb ?? clip?.channels;

  if (rgb && typeof rgb === "object") {
    return {
      r: normalizeColorChannel(rgb.r ?? rgb.red, 1),
      g: normalizeColorChannel(rgb.g ?? rgb.green, 1),
      b: normalizeColorChannel(rgb.b ?? rgb.blue, 1),
      w: normalizeColorChannel(rgb.w ?? rgb.white, 0),
    };
  }

  return {
    r: normalizeColorChannel(clip?.r ?? clip?.red, 1),
    g: normalizeColorChannel(clip?.g ?? clip?.green, 1),
    b: normalizeColorChannel(clip?.b ?? clip?.blue, 1),
    w: normalizeColorChannel(clip?.w ?? clip?.white, 0),
  };
}

function applyLightingColor(signals, color, intensity) {
  const i = clamp01(intensity);

  signals.lightingColor = {
    r: clamp01(color.r * i),
    g: clamp01(color.g * i),
    b: clamp01(color.b * i),
    w: clamp01((color.w || 0) * i),
  };
}

function normalizeTrackType(rawType) {
  const key = String(rawType || "").trim().toLowerCase();
  return TYPE_ALIASES[key] || key || "pump";
}
function isGroupSignalKey(key) {
  return DEFAULT_GROUP_SIGNALS[key] !== undefined;
}

function getClipStart(clip) {
  return Number(
    clip?.start ??
    clip?.startTime ??
    clip?.timeStart ??
    clip?.from ??
    clip?.offset ??
    0
  );
}

function getClipEnd(clip, start) {
  const explicitEnd = clip?.end ?? clip?.endTime ?? clip?.timeEnd ?? clip?.to;
  if (explicitEnd !== undefined && explicitEnd !== null) return Number(explicitEnd);

  const duration = clip?.duration ?? clip?.length ?? clip?.durationSec;
  if (duration !== undefined && duration !== null) return start + Number(duration);

  return start;
}

function getTrackList(timelineTracks) {
  if (!timelineTracks) return [];
  if (Array.isArray(timelineTracks)) return timelineTracks;
  if (typeof timelineTracks === "object") return Object.values(timelineTracks);
  return [];
}

function getTrackClips(track) {
  if (!track) return [];
  if (Array.isArray(track.clips)) return track.clips;
  if (Array.isArray(track.items)) return track.items;
  if (Array.isArray(track.events)) return track.events;
  return [];
}

function clipIsActiveAt(clip, playhead) {
  const start = getClipStart(clip);
  const end = getClipEnd(clip, start);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  // A zero-duration clip behaves like a pulse at its start point.
  if (end <= start) return Math.abs(playhead - start) < 0.05;

  return playhead >= start && playhead <= end;
}

function clipIntensityAt(clip, playhead) {
  const start = getClipStart(clip);
  const end = getClipEnd(clip, start);
  const duration = Math.max(0.0001, end - start);
  const progress = clamp01((playhead - start) / duration);

  const base = normalizeIntensity(
    clip?.intensity ??
    clip?.value ??
    clip?.level ??
    clip?.power ??
    clip?.height ??
    clip?.opacity ??
    1
  );

  const fadeIn = Number(clip?.fadeIn ?? clip?.rampIn ?? 0);
  const fadeOut = Number(clip?.fadeOut ?? clip?.rampOut ?? 0);

  let envelope = 1;
  if (Number.isFinite(fadeIn) && fadeIn > 0 && playhead < start + fadeIn) {
    envelope = Math.min(envelope, clamp01((playhead - start) / fadeIn));
  }
  if (Number.isFinite(fadeOut) && fadeOut > 0 && playhead > end - fadeOut) {
    envelope = Math.min(envelope, clamp01((end - playhead) / fadeOut));
  }

  // Optional simple pulse/chase wave support for generated clips.
  const pattern = String(clip?.pattern || clip?.mode || "").toLowerCase();
  if (pattern === "pulse") {
    const cycles = Number(clip?.cycles || 4);
    const pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2 * cycles);
    return clamp01(base * pulse * envelope);
  }

  return clamp01(base * envelope);
}

export function createDefaultRuntimeSignals() {
  return { ...DEFAULT_SIGNALS };
}

export function deriveRuntimeSignals({
  timelineTracks,
  playhead = 0,
  playbackState,
  manualSignals,
  manualPatterns,
  manualPatternMeta,
  manualPriority = false,
  mode = "timeline",
} = {}) {      if (mode === "manualPattern" || manualPriority) {
    const arr = Array.isArray(manualPatterns) ? manualPatterns : [];
    const fixtures = Array.isArray(manualPatternMeta?.fixtures)
      ? manualPatternMeta.fixtures
      : [];

    const signals = {
  ...DEFAULT_SIGNALS,
  groups: { ...DEFAULT_GROUP_SIGNALS },
  lightingColor: clipColorAt({
    color: manualPatternMeta?.lightColor || "#ffffff",
  }),
};

    if (fixtures.length) {
      fixtures.forEach((fixture, index) => {
        const groupId = fixture.groupId || "center_jets";
        if (signals.groups[groupId] === undefined) return;

        const value = normalizeIntensity(arr[index], 0);
        signals.groups[groupId] = Math.max(signals.groups[groupId] || 0, value);
      });
    } else {
      // Fallback for older manual pattern data without metadata
      const maxRange = (start, end) => {
        const values = arr.slice(start, end).map(v => normalizeIntensity(v, 0));
        return values.length ? Math.max(0, ...values) : 0;
      };

      signals.groups.center_jets = maxRange(0, 4);
      signals.groups.arch_jets = maxRange(4, 8);
      signals.groups.rgb_lights = maxRange(8, 12);
      signals.groups.mist_jets = maxRange(12, 14);
      signals.groups.flame_units = maxRange(14, 16);
    }

    signals.pump = Math.max(
      signals.groups.running_fountain_jets || 0,
      signals.groups.foam_jets || 0,
      signals.groups.peacock_jets || 0,
      signals.groups.center_jets || 0,
      signals.groups.arch_jets || 0,
      signals.groups.mist_jets || 0,
      signals.groups.outer_ring_jets || 0,
      signals.groups.cascade_jets || 0,
      signals.groups.motion_1d_jets || 0,
      signals.groups.motion_2d_jets || 0,
      signals.groups.motion_3d_jets || 0,
      signals.groups.screen_jets || 0
    );
    signals.valve = signals.groups.arch_jets;
    signals.lighting = signals.groups.rgb_lights;
    if (signals.lighting > 0) {
      applyLightingColor(
        signals,
        clipColorAt({ color: manualPatternMeta?.lightColor || "#ffffff" }),
        signals.lighting
      );
    }
    signals.fog = Math.max(signals.groups.mist_jets || 0, signals.groups.fog_machines || 0);
    signals.flame = signals.groups.flame_units || 0;
    signals.laser = signals.groups.laser_units || 0;
    signals.motion_1d = signals.groups.motion_1d_jets || 0;
    signals.motion_2d = signals.groups.motion_2d_jets || 0;
    signals.motion_3d = signals.groups.motion_3d_jets || 0;
    signals.screen = signals.groups.screen_jets || 0;

    return {
      ...signals,
      source: "manualPattern",
      playhead: Number(playhead) || 0,
      playbackState: playbackState || "manual",
      activeClips: [],
    };
  }
  // Manual override mode is explicit. It should not silently override timeline playback.
   if (mode === "manual") {
    const manualColor = clipColorAt(manualSignals || {});

    return {
      ...DEFAULT_SIGNALS,
      groups: { ...DEFAULT_GROUP_SIGNALS },
      lightingColor: manualColor,
      ...Object.fromEntries(
        Object.entries(manualSignals || {})
          .filter(([key]) => key !== "groups" && key !== "lightingColor")
          .map(([key, value]) => [key, normalizeIntensity(value, 0)])
      ),
      source: "manual",
      playhead: Number(playhead) || 0,
    };
  }

  const t = Number(playhead) || 0;
  const signals = {
  ...DEFAULT_SIGNALS,
  groups: { ...DEFAULT_GROUP_SIGNALS },
};
  const activeClips = [];

  for (const track of getTrackList(timelineTracks)) {
    if (!track || track.muted || track.isMuted) continue;

    const trackType = normalizeTrackType(track.type || track.deviceType || track.kind || track.name);
    const clips = getTrackClips(track);

    for (const clip of clips) {
      if (!clip || clip.muted || clip.disabled || clip.isMuted) continue;
      if (!clipIsActiveAt(clip, t)) continue;

      const clipType = normalizeTrackType(
  clip.groupId ||
  clip.targetGroup ||
  clip.target ||
  clip.deviceGroup ||
  clip.type ||
  clip.deviceType ||
  clip.kind ||
  trackType
);
      const signalKey = isGroupSignalKey(clipType)
  ? clipType
  : DEFAULT_SIGNALS[clipType] !== undefined
    ? clipType
    : trackType;
            if (!isGroupSignalKey(signalKey) && DEFAULT_SIGNALS[signalKey] === undefined) continue;

      const intensity = clipIntensityAt(clip, t);
      const color = clipColorAt(clip);

if (isGroupSignalKey(signalKey)) {
  signals.groups[signalKey] = Math.max(signals.groups[signalKey] || 0, intensity);

  if (signalKey === "rgb_lights") {
    signals.lighting = Math.max(signals.lighting || 0, intensity);
    applyLightingColor(signals, color, intensity);
  }

  if (signalKey === "flame_units") {
    signals.flame = Math.max(signals.flame || 0, intensity);
  }

  if (signalKey === "fog_machines" || signalKey === "mist_jets") {
    signals.fog = Math.max(signals.fog || 0, intensity);
  }

  if (signalKey === "laser_units") {
    signals.laser = Math.max(signals.laser || 0, intensity);
  }

  if (signalKey === "motion_1d_jets") {
    signals.motion_1d = Math.max(signals.motion_1d || 0, intensity);
  }

  if (signalKey === "motion_2d_jets") {
    signals.motion_2d = Math.max(signals.motion_2d || 0, intensity);
  }

  if (signalKey === "motion_3d_jets") {
    signals.motion_3d = Math.max(signals.motion_3d || 0, intensity);
  }

} else {
  signals[signalKey] = Math.max(signals[signalKey] || 0, intensity);

  if (signalKey === "lighting") {
    signals.groups.rgb_lights = Math.max(signals.groups.rgb_lights || 0, intensity);
    applyLightingColor(signals, color, intensity);
  }
}

      activeClips.push({
        id: clip.id,
        trackId: track.id,
        type: signalKey,
        intensity,
        color,
        start: getClipStart(clip),
        end: getClipEnd(clip, getClipStart(clip)),
      });
    }

  }
// Backward compatibility:
// Existing old timeline tracks may only drive global pump/lighting/fog/etc.
// Until clips have explicit groupId/targetGroup, mirror global signals into default groups.
const hasExplicitGroupSignals = Object.values(signals.groups).some(v => v > 0);

if (!hasExplicitGroupSignals && signals.pump > 0) {
  signals.groups.center_jets = Math.max(signals.groups.center_jets || 0, signals.pump);
  signals.groups.outer_ring_jets = Math.max(signals.groups.outer_ring_jets || 0, signals.pump * 0.75);
  signals.groups.arch_jets = Math.max(signals.groups.arch_jets || 0, Math.max(signals.pump * 0.65, signals.valve || 0));
  signals.groups.cascade_jets = Math.max(signals.groups.cascade_jets || 0, signals.pump * 0.45);
  signals.groups.motion_1d_jets = Math.max(signals.groups.motion_1d_jets || 0, signals.pump * 0.8);
  signals.groups.motion_2d_jets = Math.max(signals.groups.motion_2d_jets || 0, signals.pump * 0.85);
  signals.groups.motion_3d_jets = Math.max(signals.groups.motion_3d_jets || 0, signals.pump * 0.9);
}

if (!hasExplicitGroupSignals && signals.lighting > 0) {
  signals.groups.rgb_lights = Math.max(signals.groups.rgb_lights || 0, signals.lighting);
}

if (!hasExplicitGroupSignals && signals.fog > 0) {
  signals.groups.fog_machines = Math.max(signals.groups.fog_machines || 0, signals.fog);
  signals.groups.mist_jets = Math.max(signals.groups.mist_jets || 0, signals.fog * 0.7);
}

if (!hasExplicitGroupSignals && signals.flame > 0) {
  signals.groups.flame_units = Math.max(signals.groups.flame_units || 0, signals.flame);
}

if (!hasExplicitGroupSignals && signals.laser > 0) {
  signals.groups.laser_units = Math.max(signals.groups.laser_units || 0, signals.laser);
}

// Final synchronization pass:
// Ensure group signals and global effect signals agree before returning.
signals.lighting = Math.max(signals.lighting || 0, signals.groups.rgb_lights || 0);
signals.flame = Math.max(signals.flame || 0, signals.groups.flame_units || 0);
signals.fog = Math.max(
  signals.fog || 0,
  signals.groups.fog_machines || 0,
  signals.groups.mist_jets || 0
);
signals.laser = Math.max(signals.laser || 0, signals.groups.laser_units || 0);
signals.motion_1d = Math.max(signals.motion_1d || 0, signals.groups.motion_1d_jets || 0);
signals.motion_2d = Math.max(signals.motion_2d || 0, signals.groups.motion_2d_jets || 0);
signals.motion_3d = Math.max(signals.motion_3d || 0, signals.groups.motion_3d_jets || 0);

  return {
    ...signals,
    source: "timeline",
    playhead: t,
    playbackState: playbackState || "stopped",
    activeClips,
  };
}
