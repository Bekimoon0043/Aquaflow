const deepFreeze = value => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const REALISM_CORPUS_VERSION = 1;
export const REALISM_FIXTURE_COUNTS = Object.freeze([20, 100, 300]);

export const REALISM_CAPTURE_DEFAULTS = deepFreeze({
  width: 960,
  height: 540,
  fps: 60,
  seed: 1234,
  quality: "high",
  environment: "night",
  toneMapping: "aces",
  densityNorm: true,
});

const camera = (id, name, environment, position, target, fov = 45) => ({
  id, name, environment, position, target, fov,
});

export const REALISM_CAMERAS = deepFreeze([
  camera("day", "Day front", "day", { x: 0, y: 7, z: 22 }, { x: 0, y: 2, z: 0 }),
  camera("night", "Night front", "night", { x: 0, y: 7, z: 22 }, { x: 0, y: 2, z: 0 }),
  camera("audience", "Audience eye level", "night", { x: 0, y: 1.7, z: 18 }, { x: 0, y: 2.2, z: 0 }, 50),
  camera("side", "Side profile", "night", { x: 20, y: 5, z: 0 }, { x: 0, y: 2, z: 0 }),
  camera("close", "Close detail", "night", { x: 4, y: 2.8, z: 6 }, { x: 0, y: 1.8, z: 0 }, 40),
  camera("top", "Top plan", "day", { x: 0, y: 28, z: 0.01 }, { x: 0, y: 0, z: 0 }, 45),
]);

export const REALISM_CAMERA_BY_ID = deepFreeze(Object.fromEntries(
  REALISM_CAMERAS.map(view => [view.id, view]),
));

const waterSignals = () => ({ pump: 1, valve: 1, lighting: 0.8, fog: 0 });
const captureTimesS = [4];
const exactFrameAcceptance = () => ({
  channelTolerance: 0,
  maxDifferentPixelRatio: 0,
  maxMeanAbsoluteError: 0,
});

const realismCase = definition => ({
  poolGeometry: { poolType: "rectangular", params: { width: 16, length: 10 } },
  signals: waterSignals(),
  captureTimesS,
  timeline: [],
  ...definition,
  acceptance: {
    deterministic: exactFrameAcceptance(),
    observations: definition.observations,
  },
});

export const REALISM_CASES = deepFreeze([
  realismCase({
    id: "clear",
    name: "Clear straight jet and break-up",
    kind: "water",
    viewIds: ["day", "night", "audience", "side", "close", "top"],
    fixtures: [{
      id: "clear-jet", type: "nozzle_straight_jet_dn15", x: 0, y: 0,
      engineering: { jetHeightM: 4, nozzleDiaMm: 12, pressureBar: 0.82, flowLpm: 46, group: "Clear Jets" },
    }],
    observations: ["coherent transparent core", "narrow droplet head after break-up", "no aerated crown"],
  }),
  realismCase({
    id: "aerated",
    name: "Aerated foam jet",
    kind: "water",
    viewIds: ["night", "audience", "side", "close"],
    fixtures: [{
      id: "aerated-jet", type: "nozzle_foam_jet_dn25", x: 0, y: 0,
      engineering: { jetHeightM: 1.16, nozzleDiaMm: 12.5, pressureBar: 0.184, flowLpm: 31.27, group: "Foam Jet" },
    }],
    observations: ["white aerated column", "product-sized froth crown", "soft broken-water silhouette"],
  }),
  realismCase({
    id: "laminar",
    name: "Glassy laminar arc",
    kind: "water",
    viewIds: ["day", "night", "audience", "side", "close"],
    fixtures: [{
      id: "laminar-jet", type: "nozzle_laminar_jet_dn15", x: -2, y: 0,
      engineering: { jetHeightM: 2, nozzleDiaMm: 10, pressureBar: 0.25, flowStraightener: true, group: "Laminar", aimDeg: 35, aimAzimuthDeg: 90 },
    }],
    observations: ["continuous glass-like stream", "smooth arc", "no turbulent break-up crown"],
  }),
  realismCase({
    id: "fan",
    name: "Fan sheet and spray edge",
    kind: "water",
    viewIds: ["day", "night", "audience", "side", "close", "top"],
    fixtures: [{
      id: "fan-jet", type: "nozzle_fan_small", x: 0, y: 0,
      engineering: { jetHeightM: 2.04, nozzleDiaMm: 13, pressureBar: 0.4, sprayAngleDeg: 45, group: "Fan Jet" },
    }],
    observations: ["single planar fan", "thin continuous sheet near the outlet", "droplet break-up at the outer edge"],
  }),
  realismCase({
    id: "bell",
    name: "Mushroom water bell",
    kind: "water",
    viewIds: ["day", "night", "audience", "side", "close", "top"],
    fixtures: [{
      id: "bell-jet", type: "nozzle_mushroom_g2_saferain", x: 0, y: 0,
      engineering: { jetHeightM: 0.35, pressureBar: 0.1, flowLpm: 66, bellDiameterM: 1, group: "Bells, Flowers & Spheres" },
    }],
    observations: ["continuous radial bell", "stable circular rim", "falling rim droplets"],
  }),
  realismCase({
    id: "cascade-waterwall",
    name: "Cascade curtain and projection waterwall",
    kind: "water",
    viewIds: ["day", "night", "audience", "side", "close", "top"],
    fixtures: [
      {
        id: "cascade", type: "nozzle_cascade_curtain", x: -2, y: 0,
        engineering: { jetHeightM: 3, fallHeightM: 3, pressureBar: 0.15, flowLpm: 256.09, sprayAngleDeg: 180, group: "Cascade" },
      },
      {
        id: "waterwall", type: "nozzle_water_screen", x: 2, y: 0,
        engineering: { jetHeightM: 6, pressureBar: 3, flowLpm: 1196.97, sprayAngleDeg: 90, group: "Water Screen" },
      },
    ],
    observations: ["downward cascade remains distinct from upward waterwall", "continuous sheets near outlets", "gravity-driven droplet edges"],
  }),
  realismCase({
    id: "rgbw-underwater-spot",
    name: "RGBW underwater spot on water",
    kind: "lighting",
    viewIds: ["night", "audience", "side", "close", "top"],
    fixtures: [
      {
        id: "rgbw-target", type: "nozzle_straight_jet_dn15", x: 0, y: 0,
        engineering: { jetHeightM: 3, nozzleDiaMm: 12, pressureBar: 0.55, group: "Clear Jets" },
      },
      {
        id: "rgbw-spot", type: "light_uw_rgbw_72w", x: 0, y: 1.5,
        engineering: { wattage: 72, beamAngleDeg: 25, colorMode: "RGBW", ipRating: "IP68", pairedNozzleId: "rgbw-target", aimDeg: 25, aimAzimuthDeg: 270 },
      },
    ],
    signals: { ...waterSignals(), lighting: 1, lightingColor: { r: 0.15, g: 0.45, b: 1, w: 0.65 } },
    observations: ["independent RGB and white energy", "underwater source remains submerged", "lit band follows beam intersection"],
  }),
  realismCase({
    id: "moving-gobo-vertical-slice",
    name: "Moving gobo vertical slice",
    kind: "vertical-slice",
    viewIds: ["night", "audience", "side", "close"],
    captureTimesS: [0, 1.5, 3],
    fixtures: [{
      id: "moving-gobo", type: "light_moving_head_350w", x: 0, y: -5,
      engineering: { wattage: 350, beamAngleDeg: 12, colorMode: "RGBW", mountHeightM: 4, gobo: true, goboId: "breakup-01", panRangeDeg: 540, tiltRangeDeg: 270 },
    }],
    signals: { ...waterSignals(), lighting: 1, lightingColor: { r: 1, g: 0.9, b: 0.75, w: 0.2 } },
    timeline: [
      { timeS: 0, fixtureMotion: { "moving-gobo": { pan: -30, tilt: 45, zoom: 12, gobo: "breakup-01", goboRotationDeg: 0 } } },
      { timeS: 1.5, fixtureMotion: { "moving-gobo": { pan: 0, tilt: 55, zoom: 18, gobo: "breakup-01", goboRotationDeg: 90 } } },
      { timeS: 3, fixtureMotion: { "moving-gobo": { pan: 30, tilt: 65, zoom: 24, gobo: "breakup-01", goboRotationDeg: 180 } } },
    ],
    observations: ["identical seed reproduces each keyed pose", "pan tilt zoom and gobo rotation change only at their keyed values", "projected pattern remains attached to the moving beam"],
  }),
]);

export const REALISM_CASE_BY_ID = deepFreeze(Object.fromEntries(
  REALISM_CASES.map(testCase => [testCase.id, testCase]),
));

export const REALISM_PERF_SCENES = deepFreeze(REALISM_FIXTURE_COUNTS.map(fixtures => ({
  id: `synthetic-${fixtures}`,
  content: "synthetic",
  fixtures,
  quality: "medium",
  environment: "night",
  cameraId: "audience",
  toneMapping: "aces",
  resolution: { width: 1920, height: 1080, renderScale: 1 },
  warmupMs: 3000,
  sampleMs: 10000,
  cameraPath: { radius: 30, height: 13, period: 60, start: 0.4 },
})));

export function buildRealismShotMatrix({ caseIds, viewIds } = {}) {
  const cases = caseIds == null ? REALISM_CASES : caseIds.map(id => {
    const testCase = REALISM_CASE_BY_ID[id];
    if (!testCase) throw new RangeError(`Unknown realism case: ${id}`);
    return testCase;
  });
  return cases.flatMap(testCase => {
    const selectedViews = viewIds == null ? testCase.viewIds : viewIds;
    return selectedViews.flatMap(viewId => {
      const view = REALISM_CAMERA_BY_ID[viewId];
      if (!view) throw new RangeError(`Unknown realism camera: ${viewId}`);
      return testCase.captureTimesS.map(timeS => ({
        id: `${testCase.id}/${viewId}/${timeS}`,
        caseId: testCase.id,
        viewId,
        camera: view,
        environment: view.environment,
        poolGeometry: testCase.poolGeometry,
        fixtures: testCase.fixtures,
        signals: testCase.signals,
        timeline: testCase.timeline,
        acceptance: testCase.acceptance,
        capture: { ...REALISM_CAPTURE_DEFAULTS, environment: view.environment, timeS },
      }));
    });
  });
}

export const DEFAULT_NUMERIC_TOLERANCE = deepFreeze({ absolute: 1e-9, relative: 1e-6 });

export function checkNumericTolerance(actual, expected, {
  absolute = DEFAULT_NUMERIC_TOLERANCE.absolute,
  relative = DEFAULT_NUMERIC_TOLERANCE.relative,
} = {}) {
  if (!Number.isFinite(absolute) || absolute < 0 || !Number.isFinite(relative) || relative < 0) {
    throw new RangeError("Numeric tolerances must be finite and non-negative");
  }
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return { pass: false, actual, expected, absoluteDelta: null, tolerance: null, reason: "actual and expected must be finite numbers" };
  }
  const absoluteDelta = Math.abs(actual - expected);
  const tolerance = Math.max(absolute, relative * Math.abs(expected));
  return { pass: absoluteDelta <= tolerance, actual, expected, absoluteDelta, tolerance, reason: null };
}

export function withinNumericTolerance(actual, expected, options) {
  return checkNumericTolerance(actual, expected, options).pass;
}

const frameFailure = errors => ({
  pass: false,
  errors,
  pixels: 0,
  differentPixels: 0,
  differentPixelRatio: null,
  maxChannelDelta: null,
  meanAbsoluteError: null,
});

export function compareDeterministicFrames(reference, candidate, {
  channels = 4,
  channelTolerance = 0,
  maxDifferentPixelRatio = 0,
  maxMeanAbsoluteError = 0,
} = {}) {
  if (!Number.isInteger(channels) || channels < 1) throw new RangeError("channels must be a positive integer");
  for (const [name, value, maximum] of [
    ["channelTolerance", channelTolerance, 255],
    ["maxDifferentPixelRatio", maxDifferentPixelRatio, 1],
    ["maxMeanAbsoluteError", maxMeanAbsoluteError, 255],
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > maximum) throw new RangeError(`${name} must be between 0 and ${maximum}`);
  }

  const a = reference?.data ?? reference;
  const b = candidate?.data ?? candidate;
  const errors = [];
  if (!a || !b || typeof a.length !== "number" || typeof b.length !== "number") {
    return frameFailure(["both frames must be byte arrays or objects with a data array"]);
  }
  if (a.length !== b.length) errors.push(`frame byte length differs: ${a.length} vs ${b.length}`);
  if (a.length % channels !== 0) errors.push(`frame byte length ${a.length} is not divisible by ${channels} channels`);
  if (reference?.width != null && candidate?.width != null && reference.width !== candidate.width) errors.push("frame width differs");
  if (reference?.height != null && candidate?.height != null && reference.height !== candidate.height) errors.push("frame height differs");
  if (reference?.capture || candidate?.capture) {
    for (const key of ["seed", "timeS", "fps"]) {
      if (reference?.capture?.[key] !== candidate?.capture?.[key]) errors.push(`capture ${key} differs`);
    }
  }
  if (errors.length) return frameFailure(errors);

  let differentPixels = 0;
  let maxChannelDelta = 0;
  let totalDelta = 0;
  const pixels = a.length / channels;
  for (let pixel = 0; pixel < pixels; pixel++) {
    let different = false;
    for (let channel = 0; channel < channels; channel++) {
      const av = a[pixel * channels + channel];
      const bv = b[pixel * channels + channel];
      if (!Number.isFinite(av) || !Number.isFinite(bv) || av < 0 || av > 255 || bv < 0 || bv > 255) {
        return frameFailure([`invalid channel value at byte ${pixel * channels + channel}`]);
      }
      const delta = Math.abs(av - bv);
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      totalDelta += delta;
      if (delta > channelTolerance) different = true;
    }
    if (different) differentPixels++;
  }
  const differentPixelRatio = pixels ? differentPixels / pixels : 0;
  const meanAbsoluteError = a.length ? totalDelta / a.length : 0;
  return {
    pass: differentPixelRatio <= maxDifferentPixelRatio && meanAbsoluteError <= maxMeanAbsoluteError,
    errors: [],
    pixels,
    differentPixels,
    differentPixelRatio,
    maxChannelDelta,
    meanAbsoluteError,
  };
}

export function validatePerfStatsShape(stats, { minFrames = 1 } = {}) {
  const errors = [];
  if (!Number.isInteger(minFrames) || minFrames < 0) throw new RangeError("minFrames must be a non-negative integer");
  const objectAt = (value, path) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) errors.push(`${path} must be an object`);
  };
  const numberAt = (value, path, { integer = false, min = 0, exclusiveMin = false } = {}) => {
    if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || (exclusiveMin ? value <= min : value < min)) {
      errors.push(`${path} must be ${integer ? "an integer" : "a finite number"} ${exclusiveMin ? ">" : ">="} ${min}`);
    }
  };

  objectAt(stats, "stats");
  if (errors.length) return { valid: false, errors };
  if (typeof stats.quality !== "string" || !stats.quality) errors.push("quality must be a non-empty string");
  for (const key of ["fixtures", "nozzles", "lights"]) numberAt(stats[key], key, { integer: true, min: key === "fixtures" ? 1 : 0 });

  objectAt(stats.resolution, "resolution");
  numberAt(stats.resolution?.width, "resolution.width", { integer: true, min: 0, exclusiveMin: true });
  numberAt(stats.resolution?.height, "resolution.height", { integer: true, min: 0, exclusiveMin: true });
  numberAt(stats.resolution?.pixelRatio, "resolution.pixelRatio", { min: 0, exclusiveMin: true });
  objectAt(stats.resolution?.drawingBuffer, "resolution.drawingBuffer");
  numberAt(stats.resolution?.drawingBuffer?.width, "resolution.drawingBuffer.width", { integer: true, min: 0, exclusiveMin: true });
  numberAt(stats.resolution?.drawingBuffer?.height, "resolution.drawingBuffer.height", { integer: true, min: 0, exclusiveMin: true });

  objectAt(stats.frameTime, "frameTime");
  numberAt(stats.frameTime?.frames, "frameTime.frames", { integer: true, min: minFrames });
  for (const key of ["medianMs", "p95Ms", "p99Ms", "maxMs", "meanMs", "meanFps", "medianFps"]) {
    numberAt(stats.frameTime?.[key], `frameTime.${key}`, { min: 0, exclusiveMin: true });
  }
  for (const key of ["drawCalls", "triangles", "particles"]) {
    objectAt(stats[key], key);
    numberAt(stats[key]?.median, `${key}.median`);
    numberAt(stats[key]?.max, `${key}.max`);
    if (Number.isFinite(stats[key]?.median) && Number.isFinite(stats[key]?.max) && stats[key].max < stats[key].median) {
      errors.push(`${key}.max must be >= ${key}.median`);
    }
  }
  numberAt(stats.programs, "programs", { integer: true });
  objectAt(stats.features, "features");
  return { valid: errors.length === 0, errors };
}

export function isPerfStatsShape(stats, options) {
  return validatePerfStatsShape(stats, options).valid;
}
