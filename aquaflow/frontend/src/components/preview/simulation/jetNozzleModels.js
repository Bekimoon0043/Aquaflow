/**
 * Data-driven nozzle-family descriptors for headless simulation and preview adapters.
 *
 * The registry contains generic family templates, not verified product models. Product
 * values are read from engineering.* where present; every emitted descriptor retains an
 * unverified provenance record and a list of estimates. Emitter fields mirror
 * nozzleEmitters.js (CONE/RING/FAN, speed, spread, life, density and pool weight).
 * Hydraulic inputs use the fixture library's units; helper inputs and outputs use SI.
 */

import { EMIT_CLASS, EMIT_MODE } from "./emitModes.js";
import {
  AERATED_SPREAD_DEG, AERATED_SWELL, G, NOZZLE_CV, WATER,
  jetBreakupOf, launchVelocityOf, outletOf, physicalCrownOf, productTextOf,
} from "../realWorldLook";
import {
  RENDER_PHYSICS, designHeightOf, designThrowM, simulateFlight, solveArc,
} from "../designTrajectory";
import { fieldOf } from "../elevatedNozzles";

const DEG = Math.PI / 180;
const LIFE_MARGIN = 1.15;
const MAX_DRAWN_OUTLETS = 16;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const nonNegative = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const normaliseKey = (key) => String(key ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");

const BASE_DEFAULTS = {
  speed: 10,
  speedJitter: 0.06,
  spread: 0.055,
  spawnRadius: 0.03,
  scale: 0.1,
  scaleJitter: 0,
  stretch: 0.55,
  weight: 300,
  dischargeCoeff: 0.93,
  sprayAngleDeg: null,
  elevationDeg: 90,
  rotationRpm: 20,
};

function defineModel(key, label, family, mode, previewType, options = {}) {
  const { defaults = {}, ...rest } = options;
  return Object.freeze({
    key, label, family, mode, previewType,
    aerated: false,
    breakup: null,
    arc: false,
    ...rest,
    defaults: Object.freeze({ ...BASE_DEFAULTS, ...defaults }),
  });
}

const MODEL_LIST = [
  defineModel("clear", "Clear jet", "clear", EMIT_MODE.CONE, "jet_3d", { breakup: "clear" }),
  defineModel("smooth-bore", "Smooth-bore jet", "clear", EMIT_MODE.CONE, "jet_3d", {
    breakup: "clear",
    defaults: { spread: 0.08, speedJitter: 0.08 },
  }),
  defineModel("comet", "Comet jet", "clear", EMIT_MODE.CONE, "jet_3d", {
    breakup: "clear", defaults: { speed: 8, spread: 0.05 },
  }),
  defineModel("lance", "Lance jet", "clear", EMIT_MODE.CONE, "jet_1d", {
    breakup: "clear", defaults: { spread: 0.04, speedJitter: 0.04 },
  }),
  defineModel("hollow", "Hollow jet", "clear", EMIT_MODE.CONE, "jet_3d", {
    breakup: "clear", geometry: "hollow", defaults: { speed: 12, spawnRadius: 0.05 },
  }),
  defineModel("cluster", "Cluster jet", "clear", EMIT_MODE.CONE, "jet_3d", {
    breakup: "clear", geometry: "cluster", defaults: { speed: 9, spread: 0.09, weight: 420 },
  }),
  defineModel("aerated", "Aerated jet", "aerated", EMIT_MODE.CONE, "geyser", {
    aerated: true,
    defaults: { speedJitter: 0.24, spread: 0.35, spawnRadius: 0.12, scale: 0.14, stretch: 0.65, weight: 380, dischargeCoeff: 0.8 },
  }),
  defineModel("foam", "Foam jet", "aerated", EMIT_MODE.CONE, "geyser", {
    aerated: true,
    defaults: { speed: 8, speedJitter: 0.24, spread: 0.3, spawnRadius: 0.12, scale: 0.16, stretch: 0.65, weight: 380, dischargeCoeff: 0.8 },
  }),
  defineModel("geyser", "Geyser", "aerated", EMIT_MODE.CONE, "geyser", {
    aerated: true,
    defaults: { speed: 11, speedJitter: 0.24, spread: 0.4, spawnRadius: 0.14, scale: 0.16, stretch: 0.65, weight: 400, dischargeCoeff: 0.8 },
  }),
  defineModel("volcano", "Volcano / Vulcan multi-jet", "aerated", EMIT_MODE.CONE, "geyser", {
    aerated: true, geometry: "cluster",
    defaults: { speed: 9, speedJitter: 0.28, spread: 0.45, spawnRadius: 0.18, scale: 0.18, stretch: 0.6, weight: 450, dischargeCoeff: 0.8 },
  }),
  defineModel("laminar", "Laminar jet", "laminar", EMIT_MODE.CONE, "laminar", {
    breakup: "laminar", arc: true,
    defaults: { speedJitter: 0.02, spread: 0.008, spawnRadius: 0.006, stretch: 0.8, weight: 200 },
  }),
  defineModel("jumping", "Jumping laminar jet", "laminar", EMIT_MODE.CONE, "laminar", {
    breakup: "laminar", arc: true, geometry: "cut-stream",
    defaults: { speed: 9, speedJitter: 0.02, spread: 0.008, spawnRadius: 0.006, stretch: 0.8, weight: 220, elevationDeg: 60 },
  }),
  defineModel("arch", "Aimed arch", "arch", EMIT_MODE.CONE, "arch", {
    breakup: "clear", arc: true,
    defaults: { speed: 8, spread: 0.04, weight: 380, elevationDeg: 45 },
  }),
  defineModel("fan", "Fan jet", "fan", EMIT_MODE.FAN, "fan_jet", {
    defaults: { speed: 7, spread: 0.2, stretch: 0.45, weight: 400, sprayAngleDeg: 90 },
  }),
  defineModel("peacock", "Peacock tail", "fan", EMIT_MODE.FAN, "fan_jet", {
    geometry: "multi-lance-fan",
    defaults: { speed: 8, spread: 0.25, stretch: 0.45, weight: 440, sprayAngleDeg: 90 },
  }),
  defineModel("willow", "Willow jet", "ring", EMIT_MODE.RING, "ring", {
    arc: true, geometry: "outward-drooping-streams",
    defaults: { speed: 7, spread: 0.08, stretch: 0.5, elevationDeg: 55 },
  }),
  defineModel("crown", "Crown of jets", "ring", EMIT_MODE.RING, "ring", {
    arc: true, geometry: "outward-streams",
    defaults: { speed: 7, spread: 0.08, stretch: 0.5, elevationDeg: 60 },
  }),
  defineModel("rotating", "Rotating hydraulic nozzle", "rotating", EMIT_MODE.CONE, "pirouette", {
    breakup: "clear", geometry: "rotating-outlets",
    defaults: { speed: 9, spread: 0.05, weight: 360, sprayAngleDeg: 46 },
  }),
  defineModel("pirouette", "Pirouette nozzle", "rotating", EMIT_MODE.CONE, "pirouette", {
    breakup: "clear", geometry: "rotating-outlets",
    defaults: { speed: 9, spread: 0.05, weight: 360, sprayAngleDeg: 46 },
  }),
];

/** Canonical model key -> immutable generic family template. */
export const NOZZLE_MODELS = Object.freeze(Object.fromEntries(MODEL_LIST.map((m) => [m.key, m])));

const ALIAS_GROUPS = {
  clear: ["straight", "straight-jet", "clear-jet", "directional-jet"],
  "smooth-bore": ["smoothbore", "smooth-bore-jet", "plain-jet"],
  comet: ["comet-jet"],
  lance: ["lance-jet"],
  hollow: ["hollow-jet"],
  cluster: ["cluster-jet", "multi-jet-column"],
  aerated: ["aerated-jet", "air-entrained"],
  foam: ["foam-jet", "froth", "frothy", "schaumsprudler", "snowy-jet"],
  geyser: ["geyser-jet"],
  volcano: ["vulcan", "volcano-jet"],
  laminar: ["laminar-jet", "glass-rod"],
  jumping: ["jumping-jet", "bullet-jet"],
  arch: ["aimed-arch", "arch-jet"],
  fan: ["fan-jet", "flat-fan"],
  peacock: ["peacock-tail", "phoenix-tail"],
  willow: ["willow-jet"],
  crown: ["crown-jet", "crown-of-jets"],
  rotating: ["rotary", "rotating-jet", "spinner"],
  pirouette: ["pirouette-jet", "basket"],
};

/** Normalised alias -> canonical model key. */
export const NOZZLE_MODEL_ALIASES = Object.freeze(Object.fromEntries([
  ...MODEL_LIST.map((m) => [m.key, m.key]),
  ...Object.entries(ALIAS_GROUPS).flatMap(([key, aliases]) => aliases.map((a) => [normaliseKey(a), key])),
]));

const CONFIG_RULES = [
  [/jumping|bullet[ _-]?jet/, "jumping"],
  [/smooth[ _-]?bore|plain[ _-]?jet/, "smooth-bore"],
  [/comet/, "comet"],
  [/lance/, "lance"],
  [/hollow/, "hollow"],
  [/cluster|multi[ _-]?jet[ _-]?column/, "cluster"],
  [/volcano|vulcan/, "volcano"],
  [/geyser/, "geyser"],
  [/foam|froth|snowy|schaum|sprudler|aerat|ice[ _-]?tower/, "foam"],
  [/peacock|phoenix/, "peacock"],
  [/willow/, "willow"],
  [/crown/, "crown"],
  [/fan/, "fan"],
  [/pirouette/, "pirouette"],
  [/rotating|rotatory|rotary|spinner|twister|cyclone|hibiscus/, "rotating"],
  [/arch/, "arch"],
  [/laminar|glass[ _-]?rod/, "laminar"],
];

const TYPE_MODEL = {
  jet_1d: "clear", jet_2d: "clear", jet_3d: "clear",
  geyser: "geyser", laminar: "laminar", arch: "arch",
  fan_jet: "fan", ring: "crown", pirouette: "pirouette",
};

/**
 * Resolve a canonical key, alias, or fixture/config object. Unknown strings return null;
 * an otherwise unidentified config falls back to the generic clear-jet model.
 */
export function getNozzleModel(keyOrConfig) {
  if (typeof keyOrConfig === "string") {
    const key = NOZZLE_MODEL_ALIASES[normaliseKey(keyOrConfig)];
    return key ? NOZZLE_MODELS[key] : null;
  }
  const cfg = keyOrConfig || {};
  const text = [productTextOf(cfg), cfg.type, cfg.preview3d, cfg.resolverKey]
    .filter((s) => typeof s === "string").join(" ").toLowerCase();
  for (const [rule, key] of CONFIG_RULES) if (rule.test(text)) return NOZZLE_MODELS[key];
  return NOZZLE_MODELS[TYPE_MODEL[cfg.type] || TYPE_MODEL[cfg.preview3d] || "clear"];
}

function readRange(raw) {
  if (raw == null) return { range: null, invalid: false };
  if (!Array.isArray(raw) || raw.length < 2) return { range: null, invalid: true };
  const lo = Number(raw[0]), hi = Number(raw[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo) {
    return { range: null, invalid: true };
  }
  return { range: [lo, hi], invalid: false };
}

/**
 * Validate a height against an optional published range and, when velocity or pressure is
 * supplied, its drag-free ceiling. The ballistic comparison is idealised, not verification.
 * options: {heightRangeM, launchVelocityMps, pressureBar, gravity, tolerance} (or a range array).
 */
export function validateHeight(heightM, options = {}) {
  const opts = Array.isArray(options) ? { heightRangeM: options } : (options || {});
  const value = Number(heightM);
  const issues = [];
  if (!Number.isFinite(value) || value <= 0) issues.push("heightM must be a finite positive number");
  const { range, invalid } = readRange(opts.heightRangeM);
  if (invalid) issues.push("heightRangeM must be an ordered [min, max] array");
  if (range && Number.isFinite(value) && (value < range[0] || value > range[1])) {
    issues.push(`heightM is outside ${range[0]}–${range[1]} m`);
  }
  const gravity = positive(opts.gravity) ?? G;
  const pressure = positive(opts.pressureBar);
  const velocity = positive(opts.launchVelocityMps)
    ?? (pressure ? NOZZLE_CV * Math.sqrt(2 * pressure * 1e5 / WATER.rho) : null);
  const idealHeightM = velocity ? velocity * velocity / (2 * gravity) : null;
  const tolerance = nonNegative(opts.tolerance) ?? 0.05;
  if (idealHeightM && Number.isFinite(value) && value > idealHeightM * (1 + tolerance)) {
    issues.push("heightM exceeds the ideal drag-free velocity/pressure head");
  }
  return {
    valid: issues.length === 0,
    valueM: Number.isFinite(value) ? value : null,
    heightRangeM: range,
    idealHeightM,
    heightEfficiency: idealHeightM && Number.isFinite(value) ? value / idealHeightM : null,
    issues,
    estimated: idealHeightM ? ["ideal drag-free height comparison"] : [],
  };
}

/**
 * Validate a throw against an optional range and the symmetric drag-free parabola relation
 * R = 4H / tan(elevation). options: {throwRangeM, heightM, elevationDeg, tolerance} (or range).
 */
export function validateThrow(throwM, options = {}) {
  const opts = Array.isArray(options) ? { throwRangeM: options } : (options || {});
  const value = Number(throwM);
  const issues = [];
  if (!Number.isFinite(value) || value < 0) issues.push("throwM must be a finite non-negative number");
  const { range, invalid } = readRange(opts.throwRangeM);
  if (invalid) issues.push("throwRangeM must be an ordered [min, max] array");
  if (range && Number.isFinite(value) && (value < range[0] || value > range[1])) {
    issues.push(`throwM is outside ${range[0]}–${range[1]} m`);
  }
  const height = positive(opts.heightM);
  const elevation = positive(opts.elevationDeg);
  const idealThrowM = height && elevation && elevation <= 90
    ? 4 * height / Math.tan(elevation * DEG) : null;
  const tolerance = nonNegative(opts.tolerance) ?? 0.1;
  const relativeError = idealThrowM != null && Number.isFinite(value)
    ? Math.abs(value - idealThrowM) / Math.max(0.001, idealThrowM) : null;
  if (relativeError != null && relativeError > tolerance) {
    issues.push("throwM is inconsistent with ideal drag-free height/elevation ballistics");
  }
  return {
    valid: issues.length === 0,
    valueM: Number.isFinite(value) ? value : null,
    throwRangeM: range,
    idealThrowM,
    relativeError,
    issues,
    estimated: idealThrowM != null ? ["ideal drag-free throw comparison"] : [],
  };
}

/**
 * Q = Cd · n · A · sqrt(2 Δp / ρ), in m³/s.
 * A is the area of ONE outlet. Supply outletAreaM2/areaM2, diameterM, or outletDiaMm;
 * innerDiaMm may be supplied for a true annulus. deltaPPa/deltaP are Pa; pressureBar is a
 * convenience input. Defaults Cd=0.93, n=1, rho=998 are generic, not product verification.
 */
export function pressureFlowM3s(params = {}) {
  const cd = Number(params.dischargeCoeff ?? params.cd ?? 0.93);
  const n = Number(params.outletCount ?? params.n ?? 1);
  const rho = Number(params.rho ?? WATER.rho);
  const deltaP = Number(params.deltaPPa ?? params.deltaP
    ?? (params.pressureBar != null ? Number(params.pressureBar) * 1e5 : NaN));
  const diameterM = positive(params.diameterM)
    ?? (positive(params.outletDiaMm) ? Number(params.outletDiaMm) / 1000 : null);
  const innerM = positive(params.innerDiaMm) ? Number(params.innerDiaMm) / 1000 : 0;
  let area = positive(params.outletAreaM2 ?? params.areaM2);
  if (!area && diameterM) {
    if (innerM >= diameterM) throw new RangeError("innerDiaMm must be smaller than outletDiaMm");
    area = Math.PI * (diameterM * diameterM - innerM * innerM) / 4;
  }
  if (!(cd > 0) || !Number.isFinite(cd)) throw new RangeError("dischargeCoeff must be positive");
  if (!(n > 0) || !Number.isFinite(n)) throw new RangeError("outletCount must be positive");
  if (!(area > 0) || !Number.isFinite(area)) throw new RangeError("a positive outlet area is required");
  if (!(rho > 0) || !Number.isFinite(rho)) throw new RangeError("rho must be positive");
  if (!(deltaP >= 0) || !Number.isFinite(deltaP)) throw new RangeError("deltaP must be non-negative");
  return cd * n * area * Math.sqrt(2 * deltaP / rho);
}

function modelConfig(model, cfg) {
  const engineering = { ...(cfg.engineering || {}) };
  if (model.aerated && engineering.aerated == null) engineering.aerated = true;
  if (engineering.nozzleFamily == null) engineering.nozzleFamily = model.key;
  return {
    ...cfg,
    type: cfg.type || model.previewType,
    fixtureType: cfg.fixtureType || model.key,
    designHeightM: cfg.designHeightM ?? engineering.jetHeightM,
    engineering,
  };
}

function engineeringOf(model, cfg, estimates) {
  const e = cfg.engineering || {};
  const nozzleDia = positive(e.nozzleDiaMm);
  const outletDia = positive(e.outletDiaMm);
  const fallback = nozzleDia || outletDia ? null : outletOf(cfg);
  const diameterMm = nozzleDia ?? outletDia ?? fallback?.mm ?? null;
  const diameterSource = nozzleDia ? "nozzleDiaMm" : outletDia ? "outletDiaMm" : fallback?.source ?? null;
  if (fallback?.estimated) estimates.push("outlet diameter inferred from connection DN");
  const explicitArea = positive(e.outletAreaM2 ?? e.areaM2);
  const areaM2 = explicitArea ?? (diameterMm ? Math.PI * Math.pow(diameterMm / 1000, 2) / 4 : null);
  const cd = positive(e.dischargeCoeff ?? e.cd) ?? model.defaults.dischargeCoeff;
  const outletCount = positive(e.orificeCount) ?? positive(e.outletCount) ?? 1;
  const deltaPPa = nonNegative(e.deltaPPa ?? e.deltaP)
    ?? (nonNegative(e.pressureBar) != null ? Number(e.pressureBar) * 1e5 : null);
  let flowM3s = null;
  if (areaM2 && deltaPPa != null) {
    if (positive(e.dischargeCoeff ?? e.cd) == null) estimates.push("generic family discharge coefficient");
    if (positive(e.orificeCount ?? e.outletCount) == null) estimates.push("single-outlet flow assumption");
    flowM3s = pressureFlowM3s({
      dischargeCoeff: cd, outletCount, outletAreaM2: areaM2, deltaPPa, rho: positive(e.rho) ?? WATER.rho,
    });
  }
  const velocity = launchVelocityOf(cfg);
  if (!velocity) estimates.push("generic family launch speed");
  if (velocity?.source === "height") estimates.push("outlet velocity inferred from height");
  const catalogueFlowLpm = positive(e.flowLpm);
  return {
    diameterMm,
    diameterM: diameterMm ? diameterMm / 1000 : null,
    diameterSource,
    outletAreaM2: areaM2,
    dischargeCoeff: cd,
    orificeCount: outletCount,
    drawnOutletCount: positive(e.outletCount),
    deltaPPa,
    flowM3s,
    flowLpm: flowM3s == null ? null : flowM3s * 60000,
    catalogueFlowLpm,
    catalogueFlowDeltaPct: flowM3s != null && catalogueFlowLpm
      ? 100 * (flowM3s * 60000 - catalogueFlowLpm) / catalogueFlowLpm : null,
    outletVelocityMps: velocity?.v ?? model.defaults.speed,
    velocitySource: velocity?.source ?? "generic-default",
    heightM: designHeightOf(cfg),
    estimates,
  };
}

function provenanceOf(cfg, estimates) {
  const e = cfg.engineering || {};
  const source = e.referenceSource ?? cfg.referenceSource ?? null;
  return {
    verified: false,
    status: source ? "unverified-reference-data" : "generic-estimate",
    referenceSource: source,
    note: e.referenceNote ?? cfg.referenceNote
      ?? "Generic nozzle-family template; verify geometry and operating data with the supplier.",
    estimates,
  };
}

function throwOf(model, cfg) {
  const direct = designThrowM(cfg);
  if (direct) return { throwM: direct, source: "engineering throw" };
  if (model.family === "ring") {
    const diameter = positive(cfg.engineering?.sprayDiameterM);
    if (diameter) return { throwM: diameter / 2, source: "sprayDiameterM / 2" };
  }
  return { throwM: null, source: null };
}

function trajectorySelection(model, cfg, estimates) {
  const e = cfg.engineering || {};
  const trajectory = e.trajectoryDeg;
  if (Array.isArray(trajectory)) {
    const values = trajectory.map(Number).filter((v) => Number.isFinite(v) && v > 0 && v <= 90);
    if (values.length) {
      estimates.push("highest trajectory selected from published range");
      return { elevationDeg: values[values.length - 1], explicit: true };
    }
  }
  const direct = positive(trajectory);
  if (direct && direct <= 90) return { elevationDeg: direct, explicit: true };
  const aim = fieldOf(cfg, "aimDeg");
  if (aim != null && aim >= 0 && aim <= 90) return { elevationDeg: 90 - aim, explicit: true };
  if (model.family === "ring") {
    const spray = positive(e.sprayAngleDeg);
    if (spray) return { elevationDeg: clamp(90 - spray / 2, 5, 90), explicit: true };
  }
  return { elevationDeg: model.defaults.elevationDeg, explicit: false };
}

function flightLife(vh, vy, cls = EMIT_CLASS.WATER) {
  if (!(Math.hypot(vh, vy) > 0)) return 0.12;
  const phys = cls === EMIT_CLASS.SPRAY ? RENDER_PHYSICS.spray : RENDER_PHYSICS.water;
  return Math.max(0.12, simulateFlight(vh, vy, phys).tLand * LIFE_MARGIN);
}

function arcAtLevel(heightM, throwM, level) {
  if (level > 0) return solveArc(heightM * level, throwM * level);
  const full = solveArc(heightM, throwM);
  return { speed: 0, elevation: full.elevation, vh: 0, vy: 0 };
}

function azimuthOf(cfg) {
  const stated = fieldOf(cfg, "aimAzimuthDeg") ?? fieldOf(cfg, "rotation");
  if (stated != null) return stated * DEG;
  const x = Number(cfg.x) || 0, z = Number(cfg.z) || 0;
  return x || z ? Math.atan2(-z, -x) : 0;
}

function describe(model, cfg, engineering, provenance, breakup, level, elapsedS) {
  const d = model.defaults;
  const e = cfg.engineering || {};
  const heightM = engineering.heightM;
  const { throwM, source: throwSource } = throwOf(model, cfg);
  const trajectory = trajectorySelection(model, cfg, engineering.estimates);
  const baseSpeed = engineering.outletVelocityMps * Math.sqrt(level);
  const useArc = model.arc && heightM > 0 && throwM > 0;
  const arc = useArc ? arcAtLevel(heightM, throwM, level) : null;
  const source = useArc ? "design-height-throw" : engineering.velocitySource;
  const common = {
    ox: Number(cfg.x) || 0,
    oy: Number.isFinite(Number(cfg.oy)) ? Number(cfg.oy) : 0.08,
    oz: Number(cfg.z) || 0,
    speedJitter: d.speedJitter,
    spread: d.spread,
    spawnRadius: (model.family === "clear" || model.family === "laminar") && engineering.diameterM
      ? engineering.diameterM / 2 : d.spawnRadius,
    density: level,
    color: model.aerated ? [0.95, 0.98, 1] : [0.85, 0.95, 1],
    scale: d.scale,
    scaleJitter: d.scaleJitter,
    stretch: d.stretch,
    p1: 0,
    p2: 0,
    weight: d.weight,
    model: model.key,
    aerated: model.aerated,
    breakup,
    engineering,
    provenance,
  };
  const emitter = (speed, direction, extra = {}) => {
    const [dx, dy, dz] = direction;
    return {
      cls: EMIT_CLASS.WATER,
      mode: model.mode,
      ...common,
      dx, dy, dz,
      speed,
      life: flightLife(speed * Math.hypot(dx, dz), speed * dy),
      ...extra,
    };
  };

  if (model.family === "fan") {
    const statedAngle = positive(e.fanAngleDeg ?? e.sprayAngleDeg);
    if (!statedAngle) engineering.estimates.push("generic fan opening angle");
    const half = clamp(statedAngle ?? d.sprayAngleDeg, 5, 178) / 2 * DEG;
    const az = azimuthOf(cfg);
    const dir = [Math.cos(az), 1, Math.sin(az)];
    const main = emitter(baseSpeed, dir, {
      p1: Math.PI / 2 - half,
      p2: Math.PI / 2 + half,
      life: flightLife(0, baseSpeed),
      fanAngleDeg: half * 2 / DEG,
      speedSource: source,
    });
    const sprayHalf = Math.min(89 * DEG, half * 1.5);
    const spraySpeed = baseSpeed * 0.7;
    const spray = emitter(spraySpeed, dir, {
      cls: EMIT_CLASS.SPRAY,
      role: "fanSpray",
      spread: Math.max(0.5, d.spread),
      p1: Math.PI / 2 - sprayHalf,
      p2: Math.PI / 2 + sprayHalf,
      life: flightLife(0, spraySpeed, EMIT_CLASS.SPRAY),
      density: level > 0.3 ? level : 0,
      weight: 120,
    });
    return { emitters: [main, spray], elevationDeg: 90, source, throwM, throwSource, motion: null };
  }

  if (model.family === "ring") {
    const speed = arc ? arc.speed : baseSpeed;
    const elevation = arc ? arc.elevation : trajectory.elevationDeg * DEG;
    const vy = speed * Math.sin(elevation), vh = speed * Math.cos(elevation);
    const main = emitter(vy, [0, 1, 0], {
      speed: vy,
      p1: vh,
      life: flightLife(vh, vy),
      outletCount: engineering.orificeCount,
      speedSource: source,
    });
    return {
      emitters: [main], elevationDeg: elevation / DEG, source, throwM, throwSource,
      motion: { outletCount: engineering.orificeCount },
    };
  }

  if (model.family === "rotating") {
    const sprayAngle = positive(e.sprayAngleDeg) ?? d.sprayAngleDeg;
    if (positive(e.sprayAngleDeg) == null) engineering.estimates.push("generic rotating-nozzle spray angle");
    const rpm = positive(e.rotationRpm) ?? d.rotationRpm;
    if (positive(e.rotationRpm) == null) engineering.estimates.push("generic rotation speed");
    const rawCount = Math.round(positive(e.outletCount) ?? positive(e.orificeCount) ?? 1);
    const count = clamp(rawCount, 1, MAX_DRAWN_OUTLETS);
    if (rawCount > count) engineering.estimates.push(`drawn outlets capped at ${MAX_DRAWN_OUTLETS}`);
    if (positive(e.outletCount ?? e.orificeCount) == null) engineering.estimates.push("single drawn outlet assumption");
    const tilt = clamp(sprayAngle / 2, 3, 45) * DEG;
    const rate = rpm * 2 * Math.PI / 60;
    const emitters = Array.from({ length: count }, (_, index) => {
      const phase = elapsedS * rate + index * 2 * Math.PI / count;
      const direction = [Math.sin(tilt) * Math.cos(phase), Math.cos(tilt), Math.sin(tilt) * Math.sin(phase)];
      return emitter(baseSpeed, direction, {
        role: "rotatingOutlet",
        outletIndex: index,
        outletCount: count,
        phaseRad: phase,
        rotationRpm: rpm,
        weight: d.weight / Math.sqrt(count),
        speedSource: source,
      });
    });
    return {
      emitters, elevationDeg: 90 - tilt / DEG, source, throwM, throwSource,
      motion: { kind: "rotation", outletCount: count, hydraulicOutletCount: engineering.orificeCount, rotationRpm: rpm },
    };
  }

  const directedArc = arc || model.key === "arch" || model.key === "jumping"
    || (model.key === "laminar" && trajectory.explicit);
  let direction, speed = baseSpeed, elevationDeg = trajectory.elevationDeg;
  if (directedArc) {
    const elevation = arc ? arc.elevation : trajectory.elevationDeg * DEG;
    const az = azimuthOf(cfg);
    direction = [Math.cos(az) * Math.cos(elevation), Math.sin(elevation), Math.sin(az) * Math.cos(elevation)];
    if (arc) speed = arc.speed;
    elevationDeg = elevation / DEG;
  } else {
    const tx = (Number(cfg.tiltX) || 0) * DEG, tz = (Number(cfg.tiltZ) || 0) * DEG;
    direction = [Math.sin(tx), Math.cos(tx) * Math.cos(tz), Math.sin(tz)];
    elevationDeg = Math.atan2(direction[1], Math.hypot(direction[0], direction[2])) / DEG;
  }
  const main = emitter(speed, direction, {
    role: model.geometry || "core",
    outletCount: engineering.orificeCount,
    elevationDeg,
    speedSource: source,
    ...(model.key === "jumping" ? {
      cutterMs: positive(e.cutterMs),
      maxCutsPerS: positive(e.maxCutsPerS),
    } : {}),
  });
  const emitters = [main];
  if (model.aerated) {
    const frothSpeed = speed * 0.9;
    emitters.push(emitter(frothSpeed, direction, {
      cls: EMIT_CLASS.SPRAY,
      role: "froth",
      spread: d.spread * 1.4,
      speedJitter: Math.max(0.3, d.speedJitter),
      scale: d.scale * 1.6,
      scaleJitter: 0.1,
      stretch: 0.3,
      life: flightLife(frothSpeed * Math.hypot(direction[0], direction[2]), frothSpeed * direction[1], EMIT_CLASS.SPRAY),
      weight: 320,
      alphaGain: 1.8,
      speedSource: source,
    }));
  }
  return {
    emitters, elevationDeg, source, throwM, throwSource,
    motion: model.key === "jumping" ? {
      kind: "cutter", cutterMs: positive(e.cutterMs), maxCutsPerS: positive(e.maxCutsPerS),
    } : null,
  };
}

/**
 * Build a descriptor from a model key/alias or a fixture config. With a config, model
 * selection uses its product text and preview type. Options may include intensity (0..1),
 * elapsedS, position/aim and engineering fields when the first argument is a model key.
 *
 * Returns {key, family, mode, speed, spread, life, emitters, engineering, breakup,
 * aeration, crown, kinematics, motion, validation, provenance}. The emitters can be
 * adapted directly to nozzleEmitters' pool allocation and particle sampler.
 */
export function describeJetNozzle(modelOrConfig = "clear", options = {}) {
  const model = getNozzleModel(modelOrConfig);
  if (!model) throw new RangeError(`Unknown nozzle model: ${String(modelOrConfig)}`);
  const isConfig = typeof modelOrConfig === "object" && modelOrConfig !== null;
  const { intensity = 1, elapsedS = 0, ...modelOptions } = options || {};
  const cfg = modelConfig(model, isConfig ? modelOrConfig : modelOptions);
  const level = clamp(Number(intensity) || 0, 0, 1);
  const elapsed = Number.isFinite(Number(elapsedS)) ? Number(elapsedS) : 0;
  const estimates = ["family emitter spread, scale and lifetime margin are visual estimates"];
  const engineering = engineeringOf(model, cfg, estimates);
  const provenance = provenanceOf(cfg, estimates);
  const breakup = model.breakup ? jetBreakupOf(cfg) : null;
  const built = describe(model, cfg, engineering, provenance, breakup, level, elapsed);
  const trajectory = trajectorySelection(model, cfg, estimates);
  const validation = {
    height: engineering.heightM ? validateHeight(engineering.heightM, {
      heightRangeM: cfg.engineering?.heightRangeM,
      launchVelocityMps: engineering.outletVelocityMps,
    }) : null,
    throw: built.throwM != null ? validateThrow(built.throwM, {
      throwRangeM: cfg.engineering?.throwRangeM,
      heightM: engineering.heightM,
      elevationDeg: trajectory.explicit ? trajectory.elevationDeg : null,
    }) : null,
  };
  const main = built.emitters[0];
  const heightM = engineering.heightM;
  const aeration = model.aerated ? {
    enabled: true,
    columnSwell: AERATED_SWELL,
    spreadDeg: positive(cfg.engineering?.sprayAngleDeg) ?? AERATED_SPREAD_DEG,
    estimated: ["air-entrainment swell and froth sheath are generic family estimates"],
  } : { enabled: false };
  return {
    key: model.key,
    label: model.label,
    family: model.family,
    mode: model.mode,
    previewType: model.previewType,
    speed: main.speed,
    velocity: [main.dx * main.speed, main.dy * main.speed, main.dz * main.speed],
    spread: main.spread,
    life: main.life,
    aerated: model.aerated,
    emitters: built.emitters,
    engineering,
    breakup,
    aeration,
    crown: model.aerated && heightM ? physicalCrownOf(cfg, heightM) : null,
    kinematics: {
      source: built.source,
      heightM,
      throwM: built.throwM,
      throwSource: built.throwSource,
      elevationDeg: built.elevationDeg,
    },
    motion: built.motion,
    validation,
    provenance,
  };
}
