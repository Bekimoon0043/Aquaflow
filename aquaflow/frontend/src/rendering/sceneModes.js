// sceneModes.js — AquaFlow Stage 3, Priority 4 (AQ-S3-004)
//
// Scene environment presets for the photorealistic renderer — day, dusk, night,
// and arena (a dark indoor stage). Each preset is a renderer-agnostic lighting +
// atmosphere config; the FountainScene applies these to the Three.js scene. Night
// scenes are first-class: dark sky, low ambient, a starfield, and stronger fixture
// glow so the water and lights read dramatically after dark.
//
// Values mirror the tuned constants used by FountainScene so this module is the
// single, testable source of truth for environment rendering.

export const ENVIRONMENTS = { NIGHT: "night", DAY: "day", DUSK: "dusk", ARENA: "arena" };

export const SCENE_MODES = {
  night: {
    id: "night", label: "Night", isNight: true,
    background: 0x020610,
    fog: { type: "exp2", color: 0x020610, density: 0.015 },
    ambient: { color: 0x223046, intensity: 0.25 },
    key: { color: 0x8899bb, intensity: 0.35, dir: [-0.3, 1, 0.4] },
    bloom: { strength: 0.9, threshold: 0.55, radius: 0.6 },
    exposure: 1.15,
    starfield: true,
    fixtureGlow: 1.6,
  },
  arena: {
    id: "arena", label: "Arena", isNight: true,
    background: 0x010305,
    fog: { type: "exp2", color: 0x010305, density: 0.013 },
    ambient: { color: 0x1a2230, intensity: 0.2 },
    key: { color: 0x6677aa, intensity: 0.3, dir: [0, 1, 0.2] },
    bloom: { strength: 1.0, threshold: 0.5, radius: 0.65 },
    exposure: 1.2,
    starfield: false,
    fixtureGlow: 1.8,
  },
  dusk: {
    id: "dusk", label: "Dusk", isNight: false,
    background: 0x180820,
    fog: { type: "linear", color: 0x250f35, near: 25, far: 90 },
    ambient: { color: 0x3a2a4a, intensity: 0.45 },
    key: { color: 0xff9e6b, intensity: 0.7, dir: [-0.6, 0.7, 0.3] },
    bloom: { strength: 0.6, threshold: 0.7, radius: 0.5 },
    exposure: 1.05,
    starfield: false,
    fixtureGlow: 1.2,
  },
  day: {
    id: "day", label: "Day", isNight: false,
    background: 0x6ab4d8,
    fog: { type: "linear", color: 0x9cc5de, near: 40, far: 130 },
    ambient: { color: 0xbfd8e6, intensity: 0.9 },
    key: { color: 0xfff4e0, intensity: 1.3, dir: [-0.4, 1, 0.5] },
    bloom: { strength: 0.35, threshold: 0.85, radius: 0.4 },
    exposure: 1.0,
    starfield: false,
    fixtureGlow: 0.7,
  },
};

export const NIGHT_SCENE_NAMES = Object.freeze(
  Object.values(SCENE_MODES).filter(m => m.isNight).map(m => m.id)
);

/** Resolve a scene mode by name, falling back to night. */
export function getSceneMode(name) {
  return SCENE_MODES[String(name || "").toLowerCase()] || SCENE_MODES.night;
}

/** True if the named scene is a dark / night-style scene. */
export function isNightScene(name) {
  return !!getSceneMode(name).isNight;
}
