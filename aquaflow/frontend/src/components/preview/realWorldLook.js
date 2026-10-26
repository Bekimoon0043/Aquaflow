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
 * ── Exit turbulence (turbulent-surface break-up) ────────────────────────────────────
 * Tu = engineering.exitTurbulence (0.005–0.2), else by family: smooth bore / no flow
 * straightener 0.06, straightener / laminar 0.015, unknown → the model above unchanged.
 * When We > 8 · Tu^-2 the intact length is x_b/d = 3.61 · Tu^-0.275 · We^0.334 (Kusui data
 * as fitted by Trettel 2020), applied as a break-up time like the other models, and the
 * head width comes from the radial turbulent velocity (K_TU, an ESTIMATE — see below).
 *
 * ── All lights that reach a jet; framing blades; forward scatter ────────────────────
 * Real world: a nozzle's band comes from its paired aimed lights AND every other aimed
 * light whose field cone reaches it (selectLitBeams; ≤ MAX_LIGHTS_PER_NOZZLE strongest by
 * E × phase), so masts of projectors can light a whole canopy. A light's framing blades
 * (lightFraming.js) cut both the band and the illuminance. Each beam's E is weighted by a
 * Henyey–Greenstein forward-scatter factor (g = 0.8) for the angle between light → water
 * and water → viewer (the project's "STAND HERE" view, else the camera), so back-/side-lit
 * water toward the viewer dominates a front-lit light.
 *
 * Pure: no three.js. World axes: x = plan x, y = height, z = plan y.
 */

import { fieldOf, mountHeightOf } from "./elevatedNozzles";
import { bladePlanesOf, bladeSoftnessOf, bladeFactor } from "./lightFraming";
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
/** Trettel (2020) fit of Kusui's turbulent-surface break-up data: x_b/d = 3.61 Tu^-0.275 We^0.334. */
export const TRETTEL_TURBULENT = Object.freeze({ c: 3.61, tu: -0.275, we: 0.334 });
/** Turbulent-surface regime when We > TURB_WE_C · Tu^-2 (Trettel 2020 regime boundary). */
export const TURB_WE_C = 8;
/** Accepted exit-turbulence range (engineering.exitTurbulence, fraction of the mean velocity). */
export const TU_RANGE = Object.freeze({ min: 0.005, max: 0.2 });
/** Family defaults: smooth bore, no flow straightener ≈ 5–10 % → 6 %; straightened / laminar ≈ 1–2 % → 1.5 %. */
export const TU_SMOOTH_BORE = 0.06;
export const TU_STRAIGHTENED = 0.015;
/**
 * Crown of a turbulent jet (ESTIMATE, not a published correlation): drops leave the broken
 * surface with a radial rms velocity v' = K_TU · Tu · v0, K_TU = 0.85 the radial /
 * streamwise rms ratio in the core of fully developed pipe flow (≈ 0.75–0.9, Laufer 1954;
 * Wu & Faeth-type primary break-up keeps the nozzle's radial fluctuation) — i.e. a spray
 * half-angle tan(θ/2) ≈ K_TU·Tu relative to the exit velocity — and fly ballistically for
 * the time t = √(2·span/g) the decelerating water needs from break-up to the apex:
 *   width = APEX_SWELL·d + 2·v'·t
 * Lands at ≈ 0.3–1.0 m for 10–16 mm jets at 2–6.5 m (Tu 6 %). Measure on site.
 */
export const K_TU = 0.85;
/** Henyey–Greenstein asymmetry for spray / large droplets (strong forward lobe). */
export const SCATTER_G = 0.8;
/** At most this many lights shape one nozzle's band (strongest by E × phase). */
export const MAX_LIGHTS_PER_NOZZLE = 4;
/** An unpaired light counts only if its E × phase is ≥ this share of the strongest. */
export const MIN_LIGHT_SHARE = 0.05;
/** Unpaired lights farther than this from the jet are not considered (m). */
export const LIGHT_REACH_M = 80;
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

// ─── Exit turbulence ─────────────────────────────────────────────────────────
/**
 * Exit turbulence intensity Tu (fraction): engineering.exitTurbulence (clamped to
 * 0.005–0.2), else the family default — smooth bore / no straightener 0.06, flow
 * straightener / laminar 0.015 — else null (unknown: the previous model is kept).
 * @returns {{tu:number, source:"field"|"family", clamped?:boolean}|null}
 */
export function exitTurbulenceOf(cfg) {
  const raw = cfg?.engineering?.exitTurbulence ?? cfg?.exitTurbulence;
  if (raw != null && raw !== "") {
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0) {
      const tu = clamp(v, TU_RANGE.min, TU_RANGE.max);
      return { tu, source: "field", ...(tu !== v ? { clamped: true } : {}) };
    }
  }
  const straight = cfg?.engineering?.flowStraightener ?? cfg?.flowStraightener;
  if (straight === false) return { tu: TU_SMOOTH_BORE, source: "family" };
  if (straight === true) return { tu: TU_STRAIGHTENED, source: "family" };
  const text = productTextOf(cfg);
  if (/smooth[ _-]?bore|plain[ _-]?jet|no[ _-]?straighten/.test(text)) return { tu: TU_SMOOTH_BORE, source: "family" };
  const fam = jetFamilyOf(cfg);
  if (fam === JET_FAMILY.LAMINAR || /straighten|crystal/.test(text)) return { tu: TU_STRAIGHTENED, source: "family" };
  return null;
}

/** Weber number above which a jet of exit turbulence tu breaks in the turbulent-surface regime. */
export function turbulentWeberThreshold(tu) {
  return TURB_WE_C / (tu * tu);
}

/** Turbulent-surface intact length, m (Trettel 2020): x_b = 3.61 Tu^-0.275 We^0.334 · d. */
export function turbulentBreakupLengthM(dM, v, tu) {
  const { We } = jetNumbers(dM, v);
  return TRETTEL_TURBULENT.c * Math.pow(tu, TRETTEL_TURBULENT.tu) * Math.pow(We, TRETTEL_TURBULENT.we) * dM;
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
  const turb = exitTurbulenceOf(cfg);
  const key = `${fam}|${out?.mm}|${vel?.v}|${fieldOf(cfg, "sprayAngleDeg")}|${turb?.tu}`;
  const hit = breakupCache.get(cfg);
  if (hit && hit.key === key) return hit.value;
  let value = null;
  if (out && vel) {
    const dM = boreMmOf(cfg) / 1000;
    const nums = jetNumbers(dM, vel.v);
    // Turbulent-surface regime (Trettel 2020) when the exit turbulence is known and
    // We > 8 Tu^-2; otherwise the laminar / Grant–Middleman path as before.
    const turbulent = turb != null && nums.We > turbulentWeberThreshold(turb.tu);
    const L = turbulent ? turbulentBreakupLengthM(dM, vel.v, turb.tu) : breakupLengthM(dM, vel.v, fam === JET_FAMILY.LAMINAR);
    const r = riseBreakup(L, vel.v);
    const spray = pos(fieldOf(cfg, "sprayAngleDeg"));
    value = {
      family: fam, dM, v0: vel.v, ...nums, breakupLengthM: L, breakupTimeS: r.tau,
      model: turbulent ? "turbulent-surface" : fam === JET_FAMILY.LAMINAR ? "laminar" : "grant-middleman",
      ...(turb ? { exitTurbulence: turb.tu, exitTurbulenceSource: turb.source } : {}),
      riseM: r.rise, breakupFraction: r.fraction, intact: r.intact,
      spreadDeg: spray ?? CLEAR_SPREAD_DEG,
      estimated: [
        ...(out.estimated ? ["outlet from DN"] : []),
        ...(vel.source === "height" ? ["velocity from height"] : []),
        ...(spray == null && !turbulent ? ["spread angle default"] : []),
        ...(turb?.source === "family" ? ["exit turbulence from nozzle family"] : []),
        ...(turbulent ? ["crown width estimate"] : []),
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
  // Turbulent-surface jets: crown from the radial turbulent velocity (K_TU, estimate).
  const lateral = b.model === "turbulent-surface"
    ? 2 * K_TU * b.exitTurbulence * b.v0 * Math.sqrt((2 * span) / G)
    : 2 * span * Math.tan((b.spreadDeg / 2) * DEG);
  const widthM = clamp(APEX_SWELL * b.dM + lateral, 2 * b.dM, 1.5);
  const heightM = clamp(Math.max(span, ROLLOVER_D * b.dM), 0.04, Math.max(0.04, H));
  return {
    widthM, heightM, density: b.intact ? 0.3 : 0.6, kind: "droplets", breakupFraction: b.breakupFraction,
    ...(b.model === "turbulent-surface" ? { widthEstimated: true } : {}),
  };
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

const planeCache = new WeakMap();
/** World blade planes of a beam / light record (cached per record). */
function planesOf(beam) {
  if (!beam?.framing) return [];
  const hit = planeCache.get(beam);
  if (hit && hit.x === beam.x && hit.z === beam.z) return hit.planes;
  const planes = bladePlanesOf(beam);
  planeCache.set(beam, { x: beam.x, z: beam.z, planes });
  return planes;
}

/** 0..1 share of a beam that passes its framing blades at a point (1 without blades). */
export function beamBladeFactor(beam, px, py, pz) {
  const planes = planesOf(beam);
  return planes.length ? bladeFactor(beam, px, py, pz, planes, bladeSoftnessOf(beam)) : 1;
}

/**
 * Henyey–Greenstein phase function normalised so an isotropic medium scores 1:
 *   p(cos θ) = (1 − g²) / (1 + g² − 2 g cos θ)^1.5
 * θ = angle between the light's travel (light → water) and the view ray (water → eye).
 * g = SCATTER_G = 0.8 for spray / mm droplets (Mie: strong forward lobe): back-lit water
 * seen toward the light (θ = 0) scores 45, side-lit (90°) 0.17, front-lit (180°) 0.06.
 */
export function scatterPhase(cosTheta, g = SCATTER_G) {
  const c = clamp(Number(cosTheta) || 0, -1, 1);
  const g2 = g * g;
  return (1 - g2) / Math.pow(Math.max(1e-6, 1 + g2 - 2 * g * c), 1.5);
}

/** Forward-scatter factor of a light at {x,y,z} on water at P, seen from viewer {x,y,z} (1 without a viewer). */
export function forwardScatterFactor(light, P, viewer, g = SCATTER_G) {
  if (!viewer || !P) return 1;
  const lx = P.x - (Number(light?.x) || 0), ly = P.y - (Number(light?.y) || 0), lz = P.z - (Number(light?.z) || 0);
  const vx = viewer.x - P.x, vy = viewer.y - P.y, vz = viewer.z - P.z;
  const a = Math.hypot(lx, ly, lz), b = Math.hypot(vx, vy, vz);
  if (a < 1e-6 || b < 1e-6) return 1;
  return scatterPhase((lx * vx + ly * vy + lz * vz) / (a * b), g);
}

/** Illuminance (lux) a beam {x,y,z,dir,beamAngleDeg,lumens|wattage,framing?} puts at a point. */
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
  const e = (I0 * beamProfile(Math.acos(cosA), half)) / Math.max(r * r, 0.04);
  return beam.framing ? e * beamBladeFactor(beam, px, py, pz) : e;
}

/**
 * Heights on a vertical jet axis inside a beam's cone (scaled by angleScale) AND on the
 * kept side of its blades (factor >= 1/2). Without blades: exactly jetLook.beamHitBand.
 */
export function beamBandOnJet(beam, jet, angleScale = 1, steps = 240) {
  const b = angleScale === 1 ? beam
    : { ...beam, beamAngleDeg: Math.min(170, (Number(beam?.beamAngleDeg) || DEFAULT_BEAM_DEG) * angleScale) };
  const planes = planesOf(beam);
  if (!planes.length) return beamHitBand(b, jet, steps);
  const d = b?.dir;
  if (!Array.isArray(d)) return null;
  const n = Math.hypot(d[0], d[1], d[2]);
  if (!(n > 1e-9)) return null;
  const ax = d[0] / n, ay = d[1] / n, az = d[2] / n;
  const cosH = Math.cos(clamp((Number(b.beamAngleDeg) || DEFAULT_BEAM_DEG) / 2, 0.5, 89) * DEG);
  const lx = Number(b.x) || 0, ly = Number(b.y) || 0, lz = Number(b.z) || 0;
  const jx = Number(jet.x) || 0, jz = Number(jet.z) || 0;
  const dx = jx - lx, dz = jz - lz;
  const soft = bladeSoftnessOf(beam);
  const inside = (y) => {
    const dy = y - ly;
    const L = Math.hypot(dx, dy, dz);
    if (L >= 1e-6 && (dx * ax + dy * ay + dz * az) / L < cosH) return false;
    return bladeFactor(beam, jx, y, jz, planes, soft) >= 0.5;
  };
  const y0 = Number(jet.y0) || 0, y1 = Math.max(y0 + 1e-3, Number(jet.y1) || 0);
  const edge = (a, c) => {
    const ia = inside(a);
    for (let i = 0; i < 30 && Math.abs(c - a) > 1e-3; i++) {
      const m = (a + c) / 2;
      if (inside(m) === ia) a = m; else c = m;
    }
    return (a + c) / 2;
  };
  let lo = null, hi = null, prevY = y0, prevIn = inside(y0);
  if (prevIn) lo = y0;
  for (let i = 1; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    const now = inside(y);
    if (now && !prevIn && lo == null) lo = edge(prevY, y);
    if (!now && prevIn) hi = edge(prevY, y);
    prevY = y; prevIn = now;
  }
  if (lo == null) return null;
  return { lo, hi: prevIn ? BAND_OPEN : hi };
}

/** Renderer beam record of an aimed light (the same fields the scene hands a nozzle). */
export function beamRecordOf(L) {
  return {
    ...(L.id != null ? { id: L.id } : {}),
    x: L.x, y: Number(L.y) > 0 ? Number(L.y) : 0, z: L.z, dir: L.aimDir, beamAngleDeg: L.beamAngleDeg,
    ...(L.lumens > 0 ? { lumens: L.lumens } : {}), ...(L.wattage > 0 ? { wattage: L.wattage } : {}),
    ...(L.framing ? { framing: L.framing } : {}),
  };
}

/** Smallest angle (rad) between a beam's axis and the jet axis segment (16 samples). */
function minAxisAngle(beam, jet) {
  const d = beam.dir, n = Math.hypot(d[0], d[1], d[2]) || 1;
  const lx = Number(beam.x) || 0, ly = Number(beam.y) || 0, lz = Number(beam.z) || 0;
  const dx = jet.x - lx, dz = jet.z - lz;
  let best = Math.PI;
  for (let i = 0; i <= 16; i++) {
    const dy = jet.y0 + ((jet.y1 - jet.y0) * i) / 16 - ly;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return 0;
    best = Math.min(best, Math.acos(clamp((dx * d[0] + dy * d[1] + dz * d[2]) / (n * L), -1, 1)));
  }
  return best;
}

/**
 * Geometry half of the real-world light selection (viewer independent): the nozzle's
 * paired aimed lights (always) plus every other AIMED light within LIGHT_REACH_M whose
 * field cone reaches the jet on the kept side of its blades.
 * @returns {Array<{beam, yMid:number, lux:number, paired:boolean}>}
 */
export function reachingLights(cfg, lights, baseY = mountHeightOf(cfg)) {
  const out = [];
  if (!cfg || !Array.isArray(lights)) return out;
  const x = Number(cfg.x) || 0, z = Number(cfg.z) || 0;
  const H = jetHeightOf(cfg) ?? 3;
  const jet = { x, z, y0: baseY, y1: baseY + H * 1.3 + 0.5 };
  for (const L of lights) {
    if (!L || !(Number(L.aimDeg) > 0) || !Array.isArray(L.aimDir)) continue;
    const paired = L.pairedNozzleId != null && L.pairedNozzleId === cfg.id;
    const beam = beamRecordOf(L);
    if (!paired) {
      const dist = Math.hypot((Number(L.x) || 0) - x, (Number(L.z) || 0) - z);
      if (dist > LIGHT_REACH_M) continue;
      // Cheap reject before the sampled band: the jet is nowhere near the field cone.
      const fieldHalf = clamp(((Number(beam.beamAngleDeg) || DEFAULT_BEAM_DEG) * FIELD_FACTOR) / 2, 0.5, 85) * DEG;
      if (dist > 2 && minAxisAngle(beam, jet) > fieldHalf + 2 * DEG) continue;
    }
    const band = beamBandOnJet(beam, jet, FIELD_FACTOR);
    if (!band && !paired) continue;
    const yMid = band ? (band.lo + Math.min(band.hi, baseY + H)) / 2 : baseY + H / 2;
    const lux = beamIlluminance(beam, x, yMid, z);
    if (!paired && !(lux > 0)) continue;
    out.push({ beam, yMid, lux, paired });
  }
  return out;
}

/**
 * Viewer half: rank reachingLights() by E x forward-scatter phase; keep the paired ones
 * and at most `maxLights` in all, unpaired ones only when >= MIN_LIGHT_SHARE of the
 * strongest. Each returned beam carries `scatter` (1 without a viewer), `lux`, `paired`.
 * @returns {Array|null}
 */
export function rankLitBeams(cfg, candidates, { viewer = null, maxLights = MAX_LIGHTS_PER_NOZZLE, g = SCATTER_G } = {}) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const x = Number(cfg?.x) || 0, z = Number(cfg?.z) || 0;
  const paired = [], other = [];
  for (const c of candidates) {
    const scatter = forwardScatterFactor(c.beam, { x, y: c.yMid, z }, viewer, g);
    const rec = { ...c.beam, scatter, lux: c.lux, paired: c.paired };
    (c.paired ? paired : other).push({ rec, w: c.lux * scatter });
  }
  other.sort((a, b) => b.w - a.w);
  const top = Math.max(0, ...paired.map((c) => c.w), ...other.map((c) => c.w));
  const out = paired.map((c) => c.rec);
  for (const c of other) {
    if (out.length >= Math.max(maxLights, paired.length)) break;
    if (c.w >= MIN_LIGHT_SHARE * top) out.push(c.rec);
  }
  return out.length ? out : null;
}

/**
 * Real world: the lights that light this nozzle — reachingLights() ranked by
 * rankLitBeams(). Pure; the scene caches the geometry per nozzle (recomputed only when
 * the lights or the nozzle change) and re-ranks when the quantised viewer moves.
 * @param lights renderer light records ({id, x, y, z, aimDir, aimDeg, beamAngleDeg, lumens|wattage, pairedNozzleId, framing})
 * @returns {Array|null}
 */
export function selectLitBeams(cfg, lights, { viewer = null, baseY = mountHeightOf(cfg), maxLights = MAX_LIGHTS_PER_NOZZLE, g = SCATTER_G } = {}) {
  return rankLitBeams(cfg, reachingLights(cfg, lights, baseY), { viewer, maxLights, g });
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
  // Framed beams: their bands stop at the blades (beamBandOnJet); unframed: as before.
  const framed = beams.some((b) => b?.framing);
  const beam50 = framed ? framedBand(cfg, beams, baseY) : autoLitBand(cfg, baseY);
  let lo10 = null, hi10 = null;
  for (const b of beams) {
    const r = beamBandOnJet(b, { x, z, y0: baseY, y1: baseY + designH * 1.3 + 0.5 }, FIELD_FACTOR);
    if (!r) continue;
    lo10 = lo10 == null ? r.lo : Math.min(lo10, r.lo);
    hi10 = hi10 == null ? r.hi : Math.max(hi10, r.hi);
  }
  // Seen brightness is E x forward-scatter phase (b.scatter, set by selectLitBeams; 1 if absent).
  const E = (y) => beams.reduce((s, b) => s + beamIlluminance(b, x, y, z) * (Number(b.scatter) > 0 ? Number(b.scatter) : 1), 0);
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

/** Union of the framed beams' 50 % bands over autoLitBand's design range. */
function framedBand(cfg, beams, baseY) {
  const H = designHeightOf(cfg) ?? fieldOf(cfg, "jetHeightM") ?? 10;
  const x = Number(cfg.x) || 0, z = Number(cfg.z) || 0;
  let band = null;
  for (const b of beams) {
    const r = beamBandOnJet(b, { x, z, y0: baseY, y1: baseY + H * 1.3 + 0.5 });
    if (!r) continue;
    band = band ? { lo: Math.min(band.lo, r.lo), hi: Math.max(band.hi, r.hi) } : r;
  }
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
  // Exit turbulence / turbulent-surface break-up (Trettel 2020) and its crown estimate.
  const turbCrown = [], tuFamily = [], tuClamped = [];
  for (const n of water) {
    const t = exitTurbulenceOf(n);
    if (t?.clamped) tuClamped.push(n.id);
    const b = jetBreakupOf(n);
    if (b?.model === "turbulent-surface") {
      turbCrown.push(n.id);
      if (t?.source === "family") tuFamily.push(n.id);
    }
  }
  add("tu-clamped", "ignored", tuClamped, (k) => `${plural(k, "nozzle")}: exitTurbulence outside ${TU_RANGE.min}–${TU_RANGE.max} — clamped.`);
  add("turbulent-crown", "estimate", turbCrown, (k) => `${plural(k, "jet")}: turbulent-surface break-up (x_b/d = 3.61·Tu^-0.275·We^0.334); crown width is an estimate — measure on site.`);
  add("tu-family", "estimate", tuFamily, (k) => `${plural(k, "jet")}: exit turbulence taken from the nozzle family (smooth bore ${TU_SMOOTH_BORE * 100} %, straightened ${TU_STRAIGHTENED * 100} %) — enter engineering.exitTurbulence if measured.`);
  add("generic-nozzle", "estimate", water.filter(isGeneric).map((n) => n.id),
    (k) => `${plural(k, "nozzle")} use AquaFlow generic template data — verify outlet, flow and pressure with the supplier datasheet.`);
  const lamps = (lights || []).filter(Boolean);
  add("lumens", "estimate", lamps.filter((l) => lumensOf(l).estimated).map((l) => l.id),
    (k) => `${plural(k, "light")}: luminous flux estimated from wattage (${LM_PER_W} lm/W) — no lumens in the product data.`);
  add("beam-default", "estimate", lamps.filter((l) => (l.aimDir || Number(l.aimDeg) > 0) && !(Number(l.beamAngleDeg ?? l.engineering?.beamAngleDeg) > 0)).map((l) => l.id),
    (k) => `${plural(k, "aimed light")}: no beam angle — default ${DEFAULT_BEAM_DEG}° used.`);
  add("generic-light", "estimate", lamps.filter(isGeneric).map((l) => l.id),
    (k) => `${plural(k, "light")} use AquaFlow generic template data — verify beam angle and lumens with the supplier datasheet.`);
  // Framing blades: list each framed light (projector), malformed blades, and blades that
  // leave nothing of the beam.
  for (const l of lamps) {
    const f = l.framing;
    if (f?.blades?.length) {
      const blades = f.blades.map((b, i) => `#${i + 1} point (${fmt(b.d[0] + (Number(l.x) || 0))}, ${fmt(b.d[2] + (Number(l.z) || 0))}, ${fmt(b.d[1])}) m normal (${fmt(b.n[0])}, ${fmt(b.n[2])}, ${fmt(b.n[1])})`).join("; ");
      items.push({ id: `framing:${l.id}`, level: "info", ids: [l.id],
        text: `${l.id}: framed light — ${plural(f.blades.length, "framing blade")}, soft edge ${fmt(bladeSoftnessOf(l))} m — ${blades}.` });
    }
    if (Array.isArray(l.framingIssues) && l.framingIssues.length) {
      items.push({ id: `framing-invalid:${l.id}`, level: "ignored", ids: [l.id],
        text: `${l.id}: framing ${l.framingIssues.map((q) => `${q.index >= 0 ? `blade #${q.index + 1}` : "field"} ignored — ${q.reason}`).join("; ")}.` });
    }
  }
  add("framing-blocked", "ignored", lamps.filter((l) => bladesExcludeBeam(l)).map((l) => l.id),
    (k) => `${plural(k, "light")}: framing blades exclude the whole beam — it lights nothing (check the blade normals point to the side to keep).`);
  return items;
}

const fmt = (v) => (Math.round(Number(v) * 100) / 100).toString();

/**
 * Do a light's blades leave none of its beam? Samples the beam (axis and 8 rim rays of
 * the field cone at 0.25–64 m) and returns true when every sample is fully cut.
 * Renderer / report light records ({x, z, y | mountHeightM, aimDir?, beamAngleDeg?, framing}).
 */
export function bladesExcludeBeam(light) {
  if (!light?.framing) return false;
  const planes = bladePlanesOf(light);
  if (!planes.length) return false;
  const soft = bladeSoftnessOf(light);
  const ox = Number(light.x) || 0, oz = Number(light.z) || 0;
  const oy = Number(light.y) > 0 ? Number(light.y) : Number(light.mountHeightM) > 0 ? Number(light.mountHeightM) : 0;
  const d0 = Array.isArray(light.aimDir) ? light.aimDir : [0, 1, 0];
  const n = Math.hypot(d0[0], d0[1], d0[2]) || 1;
  const a = [d0[0] / n, d0[1] / n, d0[2] / n];
  // Two axes perpendicular to the aim.
  const ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = [a[1] * ref[2] - a[2] * ref[1], a[2] * ref[0] - a[0] * ref[2], a[0] * ref[1] - a[1] * ref[0]];
  const un = Math.hypot(u[0], u[1], u[2]) || 1;
  u[0] /= un; u[1] /= un; u[2] /= un;
  const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  const half = clamp(((Number(light.beamAngleDeg ?? light.engineering?.beamAngleDeg) || DEFAULT_BEAM_DEG) * FIELD_FACTOR) / 2, 0.5, 85) * DEG;
  const dirs = [a];
  for (let k = 0; k < 8; k++) {
    const t = (k / 8) * 2 * Math.PI, c = Math.cos(half), sn = Math.sin(half);
    dirs.push([0, 1, 2].map((i) => c * a[i] + sn * (Math.cos(t) * u[i] + Math.sin(t) * v[i])));
  }
  for (const d of dirs) {
    for (let r = 0.25; r <= 64; r *= 2) {
      if (bladeFactor(light, ox + d[0] * r, oy + d[1] * r, oz + d[2] * r, planes, soft) > 0) return false;
    }
  }
  return true;
}
