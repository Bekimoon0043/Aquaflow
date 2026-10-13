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

// ─── AF-3D-024: tone-mapping operators ──────────────────────────────────────
// ACES stays the default so every saved show looks exactly as it did. AgX keeps
// saturated night LED colours from the ACES hue skew (blue LEDs drifting purple);
// Neutral (Khronos PBR Neutral) is hue-preserving for daytime product colour.
//
// Exposure is CALIBRATED per operator rather than shared: the three curves place
// mid-grey very differently (three's ACES even carries a built-in 1/0.6 gain), so a
// raw operator swap at the same exposure would brighten or crush the whole scene.
// calibratedExposure() solves for the exposure at which the new operator maps the
// scene's mid-grey to the same display value ACES gives at the preset's exposure.

export const TONE_MAPPING = Object.freeze({
  aces:    Object.freeze({ id: "aces",    label: "ACES (default)", three: "ACESFilmicToneMapping" }),
  agx:     Object.freeze({ id: "agx",     label: "AgX (night)",    three: "AgXToneMapping" }),
  neutral: Object.freeze({ id: "neutral", label: "Neutral (day)",  three: "NeutralToneMapping" }),
});
export const DEFAULT_TONE_MAPPING = "aces";

/** Resolve an operator by id; unknown / missing ids fall back to ACES. */
export function getToneMapping(name) {
  return TONE_MAPPING[String(name || "").toLowerCase()] || TONE_MAPPING[DEFAULT_TONE_MAPPING];
}

/**
 * The THREE constant for an operator. If the installed three.js lacks the operator
 * (AgX/Neutral arrived in r160/r162), fall back to ACES rather than to no tone mapping.
 */
export function threeToneMapping(THREE, name) {
  const op = getToneMapping(name);
  return THREE?.[op.three] ?? THREE?.ACESFilmicToneMapping;
}

const clamp01 = v => Math.min(1, Math.max(0, v));

/**
 * Achromatic (grey-axis) response of three r165's operators, AFTER exposure.
 * Grey is preserved by every operator's colour matrices to within rounding, so the
 * scalar curve is enough to calibrate exposure.
 */
export function toneCurveGrey(name, x) {
  const id = getToneMapping(name).id;
  if (id === "agx") {
    const mn = -12.47393, mx = 4.026069;
    const c = clamp01((Math.log2(Math.max(x, 1e-10)) - mn) / (mx - mn));
    const c2 = c * c, c4 = c2 * c2;
    const v = 15.5 * c4 * c2 - 40.14 * c4 * c + 31.96 * c4 - 6.868 * c2 * c + 0.4298 * c2 + 0.1191 * c - 0.00232;
    return clamp01(Math.pow(Math.max(0, v), 2.2));
  }
  if (id === "neutral") {
    const start = 0.8 - 0.04;
    const c = x - (x < 0.08 ? x - 6.25 * x * x : 0.04);
    if (c < start) return c;
    const d = 1 - start;
    return 1 - (d * d) / (c + d - start);
  }
  const v = x / 0.6;   // three's ACES carries a subjective 1/0.6 gain
  return clamp01((v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081));
}

/** Scene-referred mid-grey: the calibration anchor. */
export const TONE_CALIBRATION_GREY = 0.18;

/**
 * Exposure for `name` that reproduces ACES's display mid-grey at `acesExposure`.
 * ACES itself returns the input unchanged, so the default path is bit-identical.
 */
export function calibratedExposure(name, acesExposure) {
  const base = Number(acesExposure);
  if (!(base > 0)) return acesExposure;
  const id = getToneMapping(name).id;
  if (id === "aces") return base;
  const g = TONE_CALIBRATION_GREY;
  const target = toneCurveGrey("aces", g * base);
  // Every curve is monotonic in exposure, so bisect in log space.
  let lo = base / 64, hi = base * 64;
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(lo * hi);
    if (toneCurveGrey(id, g * mid) < target) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}
