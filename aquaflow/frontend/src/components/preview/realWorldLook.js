/**
 * realWorldLook.js — real-world simulation of jet appearance and of how lights light water.
 *
 * The project render setting `realWorld` (default TRUE when absent) makes the 3D preview a
 * simulation of the specified equipment: how a jet looks comes from its nozzle family,
 * outlet diameter, launch velocity and height; how bright it is comes from the light
 * fixtures that actually reach it. The free "artistic" fields of jetLook.js
 * (`crownTuft`, `topLitFraction`, `columnGlow`) are then ignored — or, for a crown on a
 * nozzle that physically forms a head (foam / aerated / bell), sized from the product.
 * `realWorld: false` (artistic preview) keeps the jetLook.js behaviour unchanged.
 *
 * The scene marks an artistic preview by setting `cfg.realWorld = false` on each nozzle
 * config; a config without the key is real-world.
 *
 * ── Jet break-up (clear / laminar jets) ─────────────────────────────────────────────
 * Water at 20 °C: ρ = 998 kg/m³, σ = 0.0728 N/m, μ = 1.0 mPa·s; air ρg = 1.2 kg/m³.
 *   We  = ρ v² d / σ          liquid Weber number at the outlet
 *   Weg = ρg v² d / σ         gas Weber number (selects the regime)
 *   Oh  = μ / √(ρ σ d)        Ohnesorge number
 * Regime (Reitz 1978; Lin & Reitz 1998): Weg < 0.4 Rayleigh, < 13 first wind-induced,
 * < 40.3 second wind-induced, else atomisation.
 * Intact (break-up) length L:
 *   clear (turbulent nozzle flow):  L/d = 8.51 · We^0.32           (Grant & Middleman 1966)
 *   laminar (low-disturbance):      L/d = 12 · √We · (1 + 3 Oh)    (Weber 1931 / Rayleigh)
 * A vertical jet decelerates, so the break-up TIME τ = L / v0 is applied to the rising
 * column: y_b = v0 τ − ½ g τ² (intact to the apex when τ ≥ v0 / g). The fraction
 * f_b = y_b / (v0² / 2g) of the drag-free rise is applied to the DRAWN jet height.
 * Launch velocity: v0 = Cv · √(2 p / ρ), Cv = 0.97, from the nozzle pressure; without a
 * pressure, the drag-free v0 = √(2 g H) from the jet height (flagged as an estimate).
 *
 * Head (break-up zone at the apex of a near-vertical clear jet):
 *   width  = APEX_SWELL · d + 2 (1 − f_b) H tan(θ/2)    θ = product sprayAngleDeg, else 4°
 *   height = max((1 − f_b) H, ROLLOVER_D · d)
 * APEX_SWELL (4) and ROLLOVER_D (8) are empirical estimates (the column swells as it
 * stalls at the apex and the falling water rolls over it), not catalogue data.
 *
 * ── Aerated / foam heads ────────────────────────────────────────────────────────────
 * The visible frothy column diameter D = max(outletDiaMm, AERATED_SWELL · bore) with
 * AERATED_SWELL = 2.5 (air entrainment swells the column, estimate). Head (only when a
 * crown is requested on such a nozzle): width = 2 D + 0.3 H tan(θ/2), θ = sprayAngleDeg
 * or 20°; height = 0.15 H + D. Bells / mushrooms / tulips: width from bellDiaM /
 * diameterM / sphereDiaM, else ≈ H (estimate); height ½ width.
 *
 * ── Light on water ──────────────────────────────────────────────────────────────────
 * The scene's light field (fixtureLightField.js) already lights every droplet with each
 * fixture's colour, wattage, aim, beam cone and inverse-square falloff. What this module
 * adds, per nozzle with aimed paired lights (precomputed and cached, no per-particle work):
 *   band   heights inside the BEAM angle (50 % intensity points), as before (jetLook);
 *   soft   edge width from the FIELD angle (10 % points ≈ FIELD_FACTOR × beam angle);
 *   glow   brightness of the column outside the band = AMBIENT_NIGHT + E_col / E_band,
 *          E = Σ I0 · rel(θ) / r², I0 = Φ / (2π (1 − cos θh)) cd (flux in the beam cone),
 *          rel(θ) = (1 − HALO) · exp(−ln2 · (θ/θh)²) + HALO · max(0, cos θ),
 *          Φ = lumens, else wattage × LM_PER_W.
 * A narrow spot therefore still lights a little round its band, and the rest of the
 * column is dark at night but not black.
 *
 * Pure: no three.js. World axes: x = plan x, y = height, z = plan y.
 */

import { fieldOf } from "./elevatedNozzles";
import { designHeightOf } from "./designTrajectory";
import {
  crownTuftOf, topLitFractionOf, hasJetLook, jetBandOf, autoLitBand, beamHitBand, isAerated,
  columnGlowOf, BAND_OPEN, BAND_SOFT_FRACTION,
} from "./jetLook";

// ─── Constants ───────────────────────────────────────────────────────────────
export const WATER = Object.freeze({ rho: 998, sigma: 0.0728, mu: 1.0e-3 });
export const AIR_RHO = 1.2;
export const G = 9.81;
/** Velocity coefficient of a fountain nozzle (v = Cv √(2p/ρ)). */
export const NOZZLE_CV = 0.97;
/** Grant & Middleman (1966), turbulent jets: L/d = 8.51 We^0.32. */
export const GM_TURBULENT = Object.freeze({ c: 8.51, n: 0.32 });
/** Weber (1931) / Rayleigh, low-disturbance (laminar) jets: L/d = 12 √We (1 + 3 Oh). */
export const RAYLEIGH_C = 12;
export const APEX_SWELL = 4;
export const ROLLOVER_D = 8;
export const CLEAR_SPREAD_DEG = 4;
export const AERATED_SWELL = 2.5;
export const AERATED_SPREAD_DEG = 20;
/** Only jets within this angle of vertical stall into a head at their apex. */
export const HEAD_MAX_TILT_DEG = 15;
/** Field angle (10 % points) over beam angle (50 % points) of a typical LED spot. */
export const FIELD_FACTOR = 2;
/** Stray light beyond the field angle (lens halo, housing), fraction of on-axis. */
export const HALO = 0.02;
/** Ambient at night on unlit water (sky, inter-reflection from lit neighbours). Estimate. */
export const AMBIENT_NIGHT = 0.06;
/** Luminous efficacy of coloured underwater RGB LEDs when no lumens are published (733 lm / 18 W catalogue). */
export const LM_PER_W = 40;
const DEFAULT_BEAM_DEG = 56;
const DEG = Math.PI / 180;
const LN2 = Math.LN2;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pos = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** Real-world mode unless the scene marked the config artistic (cfg.realWorld === false). */
export function isRealWorld(cfg) { return cfg?.realWorld !== false; }

// ─── Nozzle family ───────────────────────────────────────────────────────────
export const JET_FAMILY = Object.freeze({
  CLEAR: "clear", LAMINAR: "laminar", AERATED: "aerated", BELL: "bell", SPRAY: "spray", MIST: "mist", OTHER: "other",
});

/** Text rules over the product's type key / family / group, first match wins. */
const FAMILY_RULES = [
  [/laminar|glass[ _-]?rod|jumping/, JET_FAMILY.LAMINAR],
  [/foam|froth|snowy|schaum|sprudler|aerat|white[ _-]?water|ice[ _-]?tower|cedar|volcano|vulcan|air[ _-]?burst|bubbler/, JET_FAMILY.AERATED],
  [/mushroom|tulip|bell|morning[ _-]?glory|arum|lily|dandelion|sphere|umbrella|lava/, JET_FAMILY.BELL],
  [/mist|fog/, JET_FAMILY.MIST],
  [/fan|spray|crowns?\b|crown[ _-]of[ _-]jets|willow|screen|curtain|peacock/, JET_FAMILY.SPRAY],
  [/straight|comet|lance|clear|hollow|directional|\bjets?\b|_jet|jet_/, JET_FAMILY.CLEAR],
];
/** Fallback from the 3D preview type when the product says nothing. */
const TYPE_FAMILY = {
  jet_1d: JET_FAMILY.CLEAR, jet_2d: JET_FAMILY.CLEAR, jet_3d: JET_FAMILY.CLEAR, arch: JET_FAMILY.CLEAR,
  pirouette: JET_FAMILY.CLEAR, motion_1d: JET_FAMILY.CLEAR, motion_2d: JET_FAMILY.CLEAR, motion_3d: JET_FAMILY.CLEAR,
  ring: JET_FAMILY.CLEAR, laminar: JET_FAMILY.LAMINAR, mist: JET_FAMILY.MIST, fan_jet: JET_FAMILY.SPRAY,
  screen: JET_FAMILY.SPRAY, cascade: JET_FAMILY.SPRAY, sphere: JET_FAMILY.BELL,
};

/** The product text the family is read from (type key, family, group, label). */
export function productTextOf(cfg) {
  const e = cfg?.engineering || {};
  return [cfg?.fixtureType, e.family, e.nozzleFamily, e.group, e.model].filter((s) => typeof s === "string").join(" ").toLowerCase();
}

/** Nozzle family: aerated flag, then the product text, then the 3D type. */
export function jetFamilyOf(cfg) {
  if (isAerated(cfg)) return JET_FAMILY.AERATED;
  const text = productTextOf(cfg);
  if (text) for (const [re, fam] of FAMILY_RULES) if (re.test(text)) return fam;
  return TYPE_FAMILY[cfg?.type] || JET_FAMILY.OTHER;
}

/** Short human name of the family for the report ("clear lance jets"). */
export function familyLabel(cfg, fam = jetFamilyOf(cfg)) {
  const t = productTextOf(cfg);
  if (fam === JET_FAMILY.CLEAR) return /lance/.test(t) ? "clear lance jets" : /comet/.test(t) ? "comet jets" : /straight/.test(t) ? "clear straight jets" : "clear jets";
  return { laminar: "laminar jets", aerated: "foam / aerated jets", bell: "bell / flower nozzles", spray: "spray / fan nozzles", mist: "mist / fog nozzles" }[fam] || "nozzles of this type";
}

// ─── Product data ────────────────────────────────────────────────────────────
/**
 * Outlet diameter: outletDiaMm (published outlet), else nozzleDiaMm (bore / equivalent
 * orifice), else the DN of the connection (an estimate — the orifice is smaller).
 * @returns {{mm:number, source:string, estimated:boolean}|null}
 */
export function outletOf(cfg) {
  const o = pos(fieldOf(cfg, "outletDiaMm"));
  if (o) return { mm: o, source: "outletDiaMm", estimated: false };
  const n = pos(fieldOf(cfg, "nozzleDiaMm"));
  if (n) return { mm: n, source: "nozzleDiaMm", estimated: false };
  const cs = cfg?.engineering?.connectionSize ?? cfg?.connectionSize;
  const m = typeof cs === "string" ? /DN\s*(\d+(?:\.\d+)?)/i.exec(cs) : null;
  if (m && Number(m[1]) > 0) return { mm: Number(m[1]), source: "DN", estimated: true };
  return null;
}

/** Bore for the hydraulics (nozzleDiaMm before outletDiaMm), same fallbacks. */
function boreMmOf(cfg) {
  return pos(fieldOf(cfg, "nozzleDiaMm")) ?? outletOf(cfg)?.mm ?? null;
}

/** Drawn / design jet height, m. */
export function jetHeightOf(cfg) {
  return designHeightOf(cfg) ?? pos(fieldOf(cfg, "jetHeightM"));
}

/**
 * Launch velocity at the outlet: from the nozzle pressure, else drag-free from the height.
 * @returns {{v:number, source:"pressure"|"height"}|null}
 */
export function launchVelocityOf(cfg) {
  const p = pos(fieldOf(cfg, "pressureBar"));
  if (p) return { v: NOZZLE_CV * Math.sqrt((2 * p * 1e5) / WATER.rho), source: "pressure" };
  const h = jetHeightOf(cfg);
  if (h) return { v: Math.sqrt(2 * G * h), source: "height" };
  return null;
}

// ─── Break-up model ──────────────────────────────────────────────────────────
/** Dimensionless groups and regime for an outlet of d m at v m/s. */
export function jetNumbers(dM, v) {
  const We = (WATER.rho * v * v * dM) / WATER.sigma;
  const WeGas = (AIR_RHO * v * v * dM) / WATER.sigma;
  const Oh = WATER.mu / Math.sqrt(WATER.rho * WATER.sigma * dM);
  const regime = WeGas < 0.4 ? "rayleigh" : WeGas < 13 ? "first-wind" : WeGas < 40.3 ? "second-wind" : "atomisation";
  return { We, WeGas, Oh, regime };
}

/** Intact length, m: Grant & Middleman (clear) or Weber/Rayleigh (laminar). */
export function breakupLengthM(dM, v, laminar = false) {
  const { We, Oh } = jetNumbers(dM, v);
  const ld = laminar ? RAYLEIGH_C * Math.sqrt(We) * (1 + 3 * Oh) : GM_TURBULENT.c * Math.pow(We, GM_TURBULENT.n);
  return ld * dM;
}

/**
 * Where a vertical jet launched at v breaks: fraction of its drag-free rise, 0..1.
 * @returns {{tau:number, yB:number, rise:number, fraction:number, intact:boolean}}
 */
export function riseBreakup(L, v) {
  const rise = (v * v) / (2 * G);
  const tau = L / v, tApex = v / G;
  if (tau >= tApex) return { tau, yB: rise, rise, fraction: 1, intact: true };
  const yB = v * tau - 0.5 * G * tau * tau;
  return { tau, yB, rise, fraction: clamp(yB / rise, 0, 1), intact: false };
}

const breakupCache = new WeakMap();

/**
 * Break-up of a clear or laminar nozzle from its product data, or null (other families,
 * or no outlet / velocity). Cached per config object.
 */
export function jetBreakupOf(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const fam = jetFamilyOf(cfg);
  if (fam !== JET_FAMILY.CLEAR && fam !== JET_FAMILY.LAMINAR) return null;
  const out = outletOf(cfg), vel = launchVelocityOf(cfg);
  const key = `${fam}|${out?.mm}|${vel?.v}|${fieldOf(cfg, "sprayAngleDeg")}`;
  const hit = breakupCache.get(cfg);
  if (hit && hit.key === key) return hit.value;
  let value = null;
  if (out && vel) {
    const dM = boreMmOf(cfg) / 1000;
    const nums = jetNumbers(dM, vel.v);
    const L = breakupLengthM(dM, vel.v, fam === JET_FAMILY.LAMINAR);
    const r = riseBreakup(L, vel.v);
    const spray = pos(fieldOf(cfg, "sprayAngleDeg"));
    value = {
      family: fam, dM, v0: vel.v, ...nums, breakupLengthM: L, breakupTimeS: r.tau,
      riseM: r.rise, breakupFraction: r.fraction, intact: r.intact,
      spreadDeg: spray ?? CLEAR_SPREAD_DEG,
      estimated: [
        ...(out.estimated ? ["outlet from DN"] : []),
        ...(vel.source === "height" ? ["velocity from height"] : []),
        ...(spray == null ? ["spread angle default"] : []),
      ],
    };
  }
  breakupCache.set(cfg, { key, value });
  return value;
}

/**
 * The droplet head a clear jet forms at its apex, for a drawn height H (m), or null.
 * Laminar jets that reach the apex intact stay glassy (no head).
 * @returns {{widthM, heightM, density, kind:"droplets", breakupFraction}|null}
 */
export function dropletHeadOf(cfg, H) {
  const b = jetBreakupOf(cfg);
  if (!b || !(H > 0)) return null;
  if (b.family === JET_FAMILY.LAMINAR && b.intact) return null;
  const span = (1 - b.breakupFraction) * H;
  const widthM = clamp(APEX_SWELL * b.dM + 2 * span * Math.tan((b.spreadDeg / 2) * DEG), 2 * b.dM, 1.5);
  const heightM = clamp(Math.max(span, ROLLOVER_D * b.dM), 0.04, Math.max(0.04, H));
  return { widthM, heightM, density: b.intact ? 0.3 : 0.6, kind: "droplets", breakupFraction: b.breakupFraction };
}

/** Physical crown of a foam / aerated / bell nozzle (product-sized), or null for other families. */
export function physicalCrownOf(cfg, H = jetHeightOf(cfg)) {
  const fam = jetFamilyOf(cfg);
  const h = H > 0 ? H : 1;
  if (fam === JET_FAMILY.AERATED) {
    const bore = boreMmOf(cfg);
    const outlet = pos(fieldOf(cfg, "outletDiaMm"));
    const D = Math.max(outlet ?? 0, bore ? AERATED_SWELL * bore : 0, 20) / 1000;
    const th = (pos(fieldOf(cfg, "sprayAngleDeg")) ?? AERATED_SPREAD_DEG) / 2 * DEG;
    return { widthM: clamp(2 * D + 0.3 * h * Math.tan(th), 0.08, 3), heightM: clamp(0.15 * h + D, 0.08, 3), density: 1, kind: "froth" };
  }
  if (fam === JET_FAMILY.BELL) {
    const dia = pos(fieldOf(cfg, "bellDiaM")) ?? pos(fieldOf(cfg, "diameterM")) ?? pos(fieldOf(cfg, "sphereDiaM"));
    const w = clamp(dia ?? h, 0.1, 5);
    return { widthM: w, heightM: clamp(0.5 * w, 0.1, 3), density: 1, kind: "bell" };
  }
  return null;
}

/** Reason a requested crown is ignored for this family (real-world mode). */
export function crownIgnoredReason(cfg, fam = jetFamilyOf(cfg)) {
  const name = familyLabel(cfg, fam);
  switch (fam) {
    case JET_FAMILY.CLEAR: return `${name} don't form bushy heads (they break into a narrow droplet head near the apex); use an aerated or foam nozzle for that look`;
    case JET_FAMILY.LAMINAR: return `${name} stay glassy to the apex; use an aerated or foam nozzle for a bushy head`;
    case JET_FAMILY.SPRAY: return `${name} form sheets and droplet fans, not heads`;
    case JET_FAMILY.MIST: return `${name} form clouds, not heads`;
    default: return `${name} have no physical crown`;
  }
}

/**
 * The crown actually drawn: artistic → the free crownTuft; real-world → a product-sized
 * crown when one is requested AND the family forms one, else null.
 */
export function effectiveCrownOf(cfg, H) {
  const requested = crownTuftOf(cfg);
  if (!isRealWorld(cfg)) return requested;
  if (!requested) return null;
  const c = physicalCrownOf(cfg, H ?? jetHeightOf(cfg));
  return c ? { widthM: c.widthM, heightM: c.heightM, density: c.density, kind: c.kind } : null;
}

/** Foam look (white aerated column): the flag, or — real-world — an aerated family. */
export function aeratedLookOf(cfg) {
  return isAerated(cfg) || (isRealWorld(cfg) && jetFamilyOf(cfg) === JET_FAMILY.AERATED);
}

// ─── Light on water ──────────────────────────────────────────────────────────
/** Luminous flux of a light / beam, lm, and whether it is an estimate. */
export function lumensOf(light) {
  const lm = pos(light?.lumens ?? light?.engineering?.lumens);
  if (lm) return { lm, estimated: false };
  const w = pos(light?.wattage ?? light?.engineering?.wattage);
  return { lm: (w ?? 18) * LM_PER_W, estimated: true };
}

/** Relative intensity at θ (rad) off the axis of a beam of half-angle θh. */
export function beamProfile(theta, halfRad) {
  const t = theta / Math.max(1e-4, halfRad);
  return (1 - HALO) * Math.exp(-LN2 * t * t) + HALO * Math.max(0, Math.cos(theta));
}

/** Illuminance (lux) a beam {x,y,z,dir,beamAngleDeg,lumens|wattage} puts at a point. */
export function beamIlluminance(beam, px, py, pz) {
  const d = beam?.dir;
  if (!Array.isArray(d)) return 0;
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  const dx = px - (Number(beam.x) || 0), dy = py - (Number(beam.y) || 0), dz = pz - (Number(beam.z) || 0);
  const r = Math.hypot(dx, dy, dz);
  if (r < 1e-6) return 0;
  const cosA = clamp((dx * d[0] + dy * d[1] + dz * d[2]) / (n * r), -1, 1);
  const half = clamp((Number(beam.beamAngleDeg) || DEFAULT_BEAM_DEG) / 2, 0.5, 89) * DEG;
  const I0 = lumensOf(beam).lm / (2 * Math.PI * (1 - Math.cos(half)));
  return (I0 * beamProfile(Math.acos(cosA), half)) / Math.max(r * r, 0.04);
}

const realBandCache = new WeakMap();

/**
 * Real-world lit band of a nozzle with aimed paired lights (cfg.litBeams), or null.
 * {lo, hi} from the beam angle; `soft` from the field angle; `glow` from the spill.
 */
export function realBandOf(cfg, baseY, apexY) {
  const beams = cfg?.litBeams;
  if (!Array.isArray(beams) || !beams.length) return null;
  // Evaluated over the DESIGN range (stable while intensity moves), cached per light list.
  const designH = jetHeightOf(cfg) ?? Math.max(0.05, apexY - baseY);
  const top = baseY + designH;
  const x = Number(cfg.x) || 0, z = Number(cfg.z) || 0;
  const key = `${x}|${z}|${baseY}|${designH}`;
  const hit = realBandCache.get(beams);
  if (hit && hit.key === key) return hit.band;
  const beam50 = autoLitBand(cfg, baseY);
  let lo10 = null, hi10 = null;
  for (const b of beams) {
    const wide = { ...b, beamAngleDeg: Math.min(170, (Number(b.beamAngleDeg) || DEFAULT_BEAM_DEG) * FIELD_FACTOR) };
    const r = beamHitBand(wide, { x, z, y0: baseY, y1: baseY + designH * 1.3 + 0.5 });
    if (!r) continue;
    lo10 = lo10 == null ? r.lo : Math.min(lo10, r.lo);
    hi10 = hi10 == null ? r.hi : Math.max(hi10, r.hi);
  }
  const E = (y) => beams.reduce((s, b) => s + beamIlluminance(b, x, y, z), 0);
  const edge = clamp(BAND_SOFT_FRACTION * designH, 0.02, 0.5 * designH);
  let band;
  if (beam50) {
    const soft = clamp(lo10 != null ? (beam50.lo - lo10) / 2 : edge, 0.02, 0.5 * designH);
    const eBand = E((beam50.lo + Math.max(beam50.lo, Math.min(beam50.hi, top))) / 2);
    const yCol = beam50.lo > baseY + 0.05 ? (baseY + beam50.lo) / 2 : null;
    const ratio = yCol != null && eBand > 0 ? E(yCol) / eBand : 1;
    band = { lo: beam50.lo, hi: beam50.hi, soft, glow: clamp(AMBIENT_NIGHT + ratio, AMBIENT_NIGHT, 1) };
  } else if (lo10 != null) {
    // Only the beam's fringe (between its 50 % and 10 % points) reaches the jet.
    band = { lo: lo10, hi: hi10, soft: edge, glow: AMBIENT_NIGHT };
  } else {
    // Its paired lights miss the jet entirely: the whole column is unlit water.
    band = { lo: BAND_OPEN / 2, hi: BAND_OPEN, soft: 0.05, glow: AMBIENT_NIGHT };
  }
  realBandCache.set(beams, { key, band });
  return band;
}

/** The lit band drawn this frame: artistic → jetLook.jetBandOf; real-world → realBandOf. */
export function effectiveBandOf(cfg, baseY, apexY) {
  return isRealWorld(cfg) ? realBandOf(cfg, baseY, apexY) : jetBandOf(cfg, baseY, apexY);
}

/** Brightness of the base glow billboard (the column's light near the water). */
export function columnDimOf(cfg, band) {
  if (isRealWorld(cfg)) return band ? band.glow : 1;
  return (topLitFractionOf(cfg) != null || cfg?.litBeams) ? columnGlowOf(cfg) : 1;
}

/** Does the nozzle get any band / head / crown descriptors? (False → descriptors untouched.) */
export function hasLookFeatures(cfg) {
  if (!isRealWorld(cfg)) return hasJetLook(cfg);
  if (Array.isArray(cfg?.litBeams) && cfg.litBeams.length) return true;
  if (effectiveCrownOf(cfg)) return true;
  const H = jetHeightOf(cfg);
  return H > 0 && dropletHeadOf(cfg, H) != null;
}

// ─── Realism report ──────────────────────────────────────────────────────────
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isGeneric = (f) => /generic template/i.test(String(f?.engineering?.dataSource || f?.dataSource || ""));
const hasField = (cfg, k) => cfg?.engineering?.[k] != null || cfg?.[k] != null;

/**
 * What in the preview rests on estimates, or carries non-physical overrides being
 * ignored. `nozzles` / `lights` are renderer configs (fixturesToNozzleConfigs output;
 * lights may carry engineering or wattage/lumens).
 * @returns {Array<{id:string, level:"ignored"|"estimate"|"info", text:string, ids:string[]}>}
 */
export function realismReport(nozzles = [], lights = [], { realWorld = true } = {}) {
  const items = [];
  const add = (id, level, ids, text) => { if (ids.length) items.push({ id, level, ids, text: text(ids.length) }); };
  const water = (nozzles || []).filter((n) => n && n.type !== "flame" && n.type !== "laser");
  if (!realWorld) {
    const art = water.filter((n) => hasJetLook(n) || crownTuftOf(n) || hasField(n, "columnGlow"));
    items.push({ id: "artistic", level: "info", ids: art.map((n) => n.id),
      text: `Artistic preview — not real-world: manual crownTuft / topLitFraction / columnGlow are drawn as set${art.length ? ` (${plural(art.length, "nozzle")})` : ""}. Turn on Real-world simulation to see what the equipment will actually do.` });
    return items;
  }
  // Ignored crowns, grouped by the reason (family).
  const byReason = new Map();
  const resized = [];
  for (const n of water) {
    if (!crownTuftOf(n)) continue;
    const c = physicalCrownOf(n);
    if (c) { resized.push(n); continue; }
    const why = crownIgnoredReason(n);
    if (!byReason.has(why)) byReason.set(why, []);
    byReason.get(why).push(n.id);
  }
  for (const [why, ids] of byReason) add(`crown-ignored:${why}`, "ignored", ids, (k) => `${plural(k, "nozzle")}: crownTuft ignored — ${why}.`);
  add("crown-sized", "info", resized.map((n) => n.id), (k) => `${plural(k, "nozzle")}: crownTuft sized from the product (${familyLabel(resized[0])}), not from the free field.`);
  add("band-ignored", "ignored", water.filter((n) => topLitFractionOf(n) != null || hasField(n, "columnGlow")).map((n) => n.id),
    (k) => `${plural(k, "nozzle")}: topLitFraction / columnGlow ignored — water is lit only where a real light's beam reaches it (aim a paired light at the part you want lit).`);
  // Estimates behind the jet look.
  const noOutlet = [], dnOutlet = [], velH = [];
  for (const n of water) {
    const fam = jetFamilyOf(n);
    if (fam !== JET_FAMILY.CLEAR && fam !== JET_FAMILY.LAMINAR) continue;
    const o = outletOf(n);
    if (!o) noOutlet.push(n.id); else if (o.estimated) dnOutlet.push(n.id);
    if (launchVelocityOf(n)?.source === "height") velH.push(n.id);
  }
  add("no-outlet", "estimate", noOutlet, (k) => `${plural(k, "jet")}: no outlet diameter — break-up head not modelled; enter nozzleDiaMm / outletDiaMm from the datasheet.`);
  add("dn-outlet", "estimate", dnOutlet, (k) => `${plural(k, "jet")}: outlet diameter taken from the DN connection size (estimate) — the real orifice is smaller.`);
  add("vel-height", "estimate", velH, (k) => `${plural(k, "jet")}: launch velocity estimated from the jet height (no nozzle pressure).`);
  add("generic-nozzle", "estimate", water.filter(isGeneric).map((n) => n.id),
    (k) => `${plural(k, "nozzle")} use AquaFlow generic template data — verify outlet, flow and pressure with the supplier datasheet.`);
  const lamps = (lights || []).filter(Boolean);
  add("lumens", "estimate", lamps.filter((l) => lumensOf(l).estimated).map((l) => l.id),
    (k) => `${plural(k, "light")}: luminous flux estimated from wattage (${LM_PER_W} lm/W) — no lumens in the product data.`);
  add("beam-default", "estimate", lamps.filter((l) => (l.aimDir || Number(l.aimDeg) > 0) && !(Number(l.beamAngleDeg ?? l.engineering?.beamAngleDeg) > 0)).map((l) => l.id),
    (k) => `${plural(k, "aimed light")}: no beam angle — default ${DEFAULT_BEAM_DEG}° used.`);
  add("generic-light", "estimate", lamps.filter(isGeneric).map((l) => l.id),
    (k) => `${plural(k, "light")} use AquaFlow generic template data — verify beam angle and lumens with the supplier datasheet.`);
  return items;
}
