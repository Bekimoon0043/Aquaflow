// Pure timing, colour-space and post-processing parameter helpers.
// Sample times are seconds; RGB values are linear-light [r, g, b] arrays.

export const DEFAULT_SHUTTER_ANGLE = 180;
export const MAX_SUBFRAME_SAMPLES = 64;

function finiteNumber(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return value;
}

/** Exposure in seconds for a rotary shutter angle (0…360 degrees) at fps. */
export function exposureTimeSeconds(fps, shutterAngle = DEFAULT_SHUTTER_ANGLE) {
  finiteNumber("fps", fps);
  finiteNumber("shutterAngle", shutterAngle);
  if (fps <= 0) throw new RangeError("fps must be greater than zero.");
  if (shutterAngle < 0 || shutterAngle > 360) {
    throw new RangeError("shutterAngle must be between 0 and 360 degrees.");
  }
  const seconds = shutterAngle / (360 * fps);
  if (!Number.isFinite(seconds)) throw new RangeError("The exposure time is too large.");
  return seconds;
}

function seedHash(seed) {
  if (typeof seed !== "string" && (typeof seed !== "number" || !Number.isFinite(seed))) {
    throw new TypeError("seed must be a finite number or a string.");
  }
  const text = String(seed);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seedHash(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Equally weighted, stratified sample times centred on frameTime. The shutter is
 * [frameTime - exposureSeconds / 2, frameTime + exposureSeconds / 2]. With jitter,
 * each stratum receives one deterministic seeded sample; otherwise its midpoint
 * is used. Consumers should average the rendered samples with equal weights.
 */
export function createSubframeSchedule({
  frameTime = 0,
  exposureSeconds,
  sampleCount = 8,
  seed = 0,
  jitter = true,
} = {}) {
  finiteNumber("frameTime", frameTime);
  finiteNumber("exposureSeconds", exposureSeconds);
  if (exposureSeconds < 0) throw new RangeError("exposureSeconds must not be negative.");
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > MAX_SUBFRAME_SAMPLES) {
    throw new RangeError(`sampleCount must be an integer from 1 to ${MAX_SUBFRAME_SAMPLES}.`);
  }
  if (typeof jitter !== "boolean") throw new TypeError("jitter must be a boolean.");

  const random = seededRandom(seed);
  const start = frameTime - exposureSeconds / 2;
  const end = frameTime + exposureSeconds / 2;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new RangeError("The shutter interval must have finite start and end times.");
  }
  if (sampleCount === 1 || exposureSeconds === 0) {
    return Array.from({ length: sampleCount }, () => frameTime);
  }

  return Array.from({ length: sampleCount }, (_, i) => {
    const offset = jitter ? random() : 0.5;
    const fraction = (i + offset) / sampleCount;
    return Math.min(end, Math.max(start, start + fraction * exposureSeconds));
  });
}

const freezeMatrix = rows => Object.freeze(rows.map(row => Object.freeze(row)));

// Row-major linear sRGB/Rec.709 (D65) ↔ ACEScg/AP1 (D60), including adaptation.
export const LINEAR_SRGB_TO_ACESCG = freezeMatrix([
  [0.6130978124, 0.3395231468, 0.0473794522],
  [0.0701945425, 0.9163538791, 0.0134516783],
  [0.0206156595, 0.1095697729, 0.8698146345],
]);

export const ACESCG_TO_LINEAR_SRGB = freezeMatrix([
  [1.7050506904667297, -0.6217919497249857, -0.08325937451253027],
  [-0.1302579400435329, 1.1408051786786664, -0.010547298307840102],
  [-0.02400328843387641, -0.12896898808799473, 1.1529722221469842],
]);

function transform(matrix, rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 3) {
    throw new TypeError("rgb must be an [r, g, b] array.");
  }
  for (const value of rgb) finiteNumber("rgb channels", value);
  return matrix.map(row => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
}

/** Linear-light conversion only: no transfer function, tone mapping or clipping. */
export const linearSrgbToACEScg = rgb => transform(LINEAR_SRGB_TO_ACESCG, rgb);
export const acesCgToLinearSrgb = rgb => transform(ACESCG_TO_LINEAR_SRGB, rgb);

export const DEFAULT_GLARE_PARAMETERS = Object.freeze({
  threshold: 0.86,
  strength: 0.2,
  radius: 0.42,
});

export const GLARE_LIMITS = Object.freeze({
  threshold: Object.freeze({ min: 0.8, max: 1 }),
  strength: Object.freeze({ min: 0, max: 1 }),
  radius: Object.freeze({ min: 0, max: 1 }),
});

function glareParameter(name, value) {
  finiteNumber(name, value);
  const { min, max } = GLARE_LIMITS[name];
  if (value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

/**
 * Validates display-referred, post-tone-map glare. The threshold floor prevents
 * midtones from entering the glare chain; zero strength explicitly disables it.
 */
export function validateGlareParameters(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Glare parameters must be an object.");
  }
  return {
    threshold: glareParameter("threshold", options.threshold ?? DEFAULT_GLARE_PARAMETERS.threshold),
    strength: glareParameter("strength", options.strength ?? DEFAULT_GLARE_PARAMETERS.strength),
    radius: glareParameter("radius", options.radius ?? DEFAULT_GLARE_PARAMETERS.radius),
  };
}
