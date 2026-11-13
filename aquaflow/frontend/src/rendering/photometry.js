export const DEFAULT_NEAR_FIELD_M = 0.2;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${name} must be a finite number`);
  return number;
}

/** Solid angle of a right circular cone, given its full apex angle in degrees. */
export function coneSolidAngle(beamAngleDeg) {
  const angle = finiteNumber(beamAngleDeg, "beamAngleDeg");
  if (angle <= 0 || angle > 360) throw new RangeError("beamAngleDeg must be > 0 and <= 360 degrees");
  return 2 * Math.PI * (1 - Math.cos((angle * Math.PI) / 360));
}

/** Mean on-axis intensity when all luminous flux is uniformly distributed in a cone. */
export function lumensToCandela(lumens, beamAngleDeg) {
  const flux = finiteNumber(lumens, "lumens");
  if (flux < 0) throw new RangeError("lumens must be >= 0");
  return flux / coneSolidAngle(beamAngleDeg);
}

/**
 * Far-field point-source illuminance. distanceM and minDistanceM are metres;
 * minDistanceM prevents a singularity at the luminaire, not a near-field model.
 */
export function candelaToLux(candela, distanceM, options = {}) {
  if (typeof options === "number") options = { minDistanceM: options };
  const intensity = finiteNumber(candela, "candela");
  const distance = finiteNumber(distanceM, "distanceM");
  const minimum = finiteNumber(options.minDistanceM ?? DEFAULT_NEAR_FIELD_M, "minDistanceM");
  const incidence = finiteNumber(options.cosIncidence ?? 1, "cosIncidence");
  if (intensity < 0) throw new RangeError("candela must be >= 0");
  if (distance < 0 || minimum < 0) throw new RangeError("distanceM and minDistanceM must be >= 0");
  const effectiveDistance = Math.max(distance, minimum);
  if (!(effectiveDistance > 0)) throw new RangeError("distanceM or minDistanceM must be > 0");
  return (intensity * Math.max(0, incidence)) / (effectiveDistance * effectiveDistance);
}

const square = (value) => value * value;
const gamma2_2 = (value) => Math.pow(value, 2.2);
const sCurve = (value) => value * value * (3 - 2 * value);
const logarithmic = (value) => Math.log1p(9 * value) / Math.LN10;

export const DIMMER_CURVES = Object.freeze({
  linear: (value) => value,
  square,
  gamma2_2,
  sCurve,
  logarithmic,
});

const CURVE_ALIASES = Object.freeze({
  linear: "linear",
  square: "square",
  squarelaw: "square",
  gamma: "gamma2_2",
  gamma22: "gamma2_2",
  gamma2_2: "gamma2_2",
  scurve: "sCurve",
  smoothstep: "sCurve",
  logarithmic: "logarithmic",
  log: "logarithmic",
});

/** Apply a normalised DMX/theatrical dimmer curve; inputs and outputs stay in 0..1. */
export function applyDimmerCurve(value, curve = "linear") {
  const input = clamp01(finiteNumber(value, "dimmer value"));
  if (typeof curve === "function") return clamp01(finiteNumber(curve(input), "dimmer curve result"));
  const key = String(curve).toLowerCase().replace(/[\s-]/g, "");
  const canonical = CURVE_ALIASES[key];
  if (!canonical) throw new RangeError(`Unknown dimmer curve "${curve}"`);
  return clamp01(DIMMER_CURVES[canonical](input));
}

function channelValues(channels, rgbw = false) {
  const names = rgbw ? ["r", "g", "b", "w"] : ["r", "g", "b"];
  if (Array.isArray(channels) || ArrayBuffer.isView(channels)) {
    return names.map((_, index) => finiteNumber(channels[index] ?? 0, `channel ${index}`));
  }
  if (!channels || typeof channels !== "object") throw new TypeError("channels must be an array or an object");
  return names.map((name) => finiteNumber(channels[name] ?? 0, `channel ${name}`));
}

function dimmerOptions(options) {
  if (typeof options === "string" || typeof options === "function") return { curve: options };
  if (typeof options === "number") return { master: options };
  return options || {};
}

/** Independently dim R, G, B and optional W, then apply one master dimmer to all. */
export function composeRGBWChannels(channels, options = {}) {
  const opts = dimmerOptions(options);
  const values = channelValues(channels, true);
  const master = applyDimmerCurve(opts.master ?? 1, opts.masterCurve ?? "linear");
  return values.map((value) => master * applyDimmerCurve(value, opts.curve ?? "linear"));
}

/** Compose normalised RGB controls into linear-light RGB (no sRGB transfer is applied). */
export function composeLinearRGB(channels, options = {}) {
  return composeRGBWChannels(channels, options).slice(0, 3);
}

/**
 * Compose RGBW in linear light. W remains an independent fourth control and is added
 * through whiteColor (it is not inferred from, or limited by, the RGB minimum).
 */
export function composeLinearRGBW(channels, options = {}) {
  const opts = dimmerOptions(options);
  const [r, g, b, w] = composeRGBWChannels(channels, opts);
  const white = opts.whiteColor ?? [1, 1, 1];
  if (!Array.isArray(white) && !ArrayBuffer.isView(white)) throw new TypeError("whiteColor must contain three linear channels");
  const whiteRGB = [0, 1, 2].map((index) => finiteNumber(white[index] ?? 0, `whiteColor ${index}`));
  if (whiteRGB.some((value) => value < 0)) throw new RangeError("whiteColor channels must be >= 0");
  return [r + w * whiteRGB[0], g + w * whiteRGB[1], b + w * whiteRGB[2]];
}
