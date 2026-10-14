/**
 * designTrajectory.js — design-faithful ballistics for every water nozzle type.
 *
 * jetPhysics.launchSpeed turns a fixture's design height (engineering.jetHeightM →
 * config.designHeightM) into an IDEAL launch speed, √(2gH), with the hydraulic solve as
 * its ceiling. That is the engineering number. The renderer, however, flies its droplets
 * under its own gravity (9.5 m/s² for water, 7.0 for spray) and a quadratic drag, and
 * most nozzle types do not fire straight up — so the ideal speed alone undershoots tall
 * jets (a 15 m screen drew ≈12 m) and says nothing about an arch's angle or throw.
 *
 * This module answers the inverse question with the renderer's OWN integrator: what
 * launch speed (and, for arcs, angle) makes the drawn trajectory peak at the target
 * height and land at the target distance. Pure functions, no three.js / WebGL, so the
 * whole chain is headlessly testable.
 *
 *   level ℓ      = delivered fraction of the design height (show demand, capped by the
 *                  hydraulic solve) — jetHeightFor(launchSpeed(...)) / designHeightM.
 *                  Height stays linear in ℓ, which the Pattern builder relies on.
 *   target apex  = ℓ · designHeightM
 *   target throw = ℓ · design throw (arcs), so the arc keeps its shape as it scales.
 */
import { designLaunchSpeed, jetHeightFor } from "./jetPhysics";

/** The renderer's particle physics. Must match FountainScene_v6 (GPU fields + CPU update). */
export const RENDER_PHYSICS = Object.freeze({
  water: Object.freeze({ gravity: 9.5, drag: 0.018 }),
  spray: Object.freeze({ gravity: 7.0, drag: 0.024 }),
});

/** The renderer integrates once per frame; solving at the nominal 60 Hz step mirrors it. */
export const SOLVER_DT = 1 / 60;

/** Below this elevation a "design apex" would need an absurd speed — the solve holds here. */
export const MIN_DESIGN_ELEVATION = 25 * Math.PI / 180;

const MAX_STEPS = 20000;

// Solutions repeat frame to frame (the level is quantised), so they are memoised.
const cache = new Map();
const CACHE_LIMIT = 20000;
function memo(key, fn) {
  let v = cache.get(key);
  if (v === undefined) {
    if (cache.size >= CACHE_LIMIT) cache.clear();
    v = fn();
    cache.set(key, v);
  }
  return v;
}
const physKey = (p) => `${p.gravity}/${p.drag}`;

/**
 * Fly one droplet with the renderer's semi-implicit Euler step (v then p), launched from
 * height 0. Lands when it falls back through the launch height.
 * @returns {{apex:number, range:number, tApex:number, tLand:number, xApex:number}}
 */
export function simulateFlight(vh, vy, phys = RENDER_PHYSICS.water, dt = SOLVER_DT) {
  // Emitters re-ask for the same (memoised) launches every frame.
  if (dt === SOLVER_DT) return memo(`F|${vh}|${vy}|${physKey(phys)}`, () => fly(vh, vy, phys, dt));
  return fly(vh, vy, phys, dt);
}

function fly(vh, vy, phys, dt) {
  const g = phys.gravity, k = phys.drag;
  let x = 0, y = 0, u = vh, w = vy, t = 0;
  let apex = 0, xApex = 0, tApex = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    const sp = Math.sqrt(u * u + w * w);
    u += (-u * k * sp) * dt;
    w += (-g - w * k * sp) * dt;
    const nx = x + u * dt, ny = y + w * dt;
    t += dt;
    if (ny > apex) { apex = ny; xApex = nx; tApex = t; }
    if (ny < 0 && w < 0) {
      // Interpolate the crossing inside the last step.
      const f = y / (y - ny);
      return { apex, range: x + (nx - x) * f, tApex, tLand: t - dt + dt * f, xApex };
    }
    x = nx; y = ny;
  }
  return { apex, range: x, tApex, tLand: t, xApex };
}

/** Free-fall time from a height with an initial downward speed (cascades). */
export function fallTime(heightM, downSpeed = 0, phys = RENDER_PHYSICS.water, dt = SOLVER_DT) {
  const g = phys.gravity, k = phys.drag;
  let y = Math.max(0, heightM), w = -Math.abs(downSpeed), t = 0;
  for (let i = 0; i < MAX_STEPS && y > 0; i++) {
    w += (-g + w * w * k) * dt;   // drag opposes the (downward) motion
    y += w * dt; t += dt;
  }
  return t;
}


/** Launch speed at an elevation (radians) whose drawn apex is `h`. */
export function speedForApex(h, elevation = Math.PI / 2, phys = RENDER_PHYSICS.water) {
  if (!(h > 0)) return 0;
  const el = Math.max(MIN_DESIGN_ELEVATION, Math.min(Math.PI / 2, elevation));
  const key = `A|${h.toFixed(4)}|${el.toFixed(4)}|${physKey(phys)}`;
  return memo(key, () => {
    const s = Math.sin(el), c = Math.cos(el);
    const g = phys.gravity, k = phys.drag;
    // Exact continuous solution for a vertical launch, as the first guess.
    let v = Math.sqrt((g / k) * Math.expm1(2 * k * h)) / s;
    // Apex grows ≈ with v², so correct multiplicatively until the Euler flight agrees.
    for (let i = 0; i < 12; i++) {
      const a = fly(v * c, v * s, phys, SOLVER_DT).apex;
      if (a <= 0) { v *= 2; continue; }
      const r = h / a;
      v *= Math.sqrt(r);
      if (Math.abs(r - 1) < 2e-4) break;
    }
    return v;
  });
}

/**
 * Launch velocity whose drawn arc peaks at `h` and lands `range` metres away.
 * @returns {{speed:number, elevation:number, vh:number, vy:number}}
 */
export function solveArc(h, range, phys = RENDER_PHYSICS.water) {
  if (!(h > 0)) return { speed: 0, elevation: Math.PI / 2, vh: 0, vy: 0 };
  const R = Math.max(0, range || 0);
  const key = `R|${h.toFixed(4)}|${R.toFixed(4)}|${physKey(phys)}`;
  return memo(key, () => {
    const g = phys.gravity;
    let vy = speedForApex(h, Math.PI / 2, phys);
    let vh = R > 0 ? (g * R) / (2 * Math.sqrt(2 * g * h)) : 0;
    for (let i = 0; i < 40 && R > 0; i++) {
      const f = fly(vh, vy, phys, SOLVER_DT);
      const ra = h / Math.max(1e-6, f.apex), rr = R / Math.max(1e-6, f.range);
      vy *= Math.sqrt(ra);
      vh *= rr;
      if (Math.abs(ra - 1) < 2e-4 && Math.abs(rr - 1) < 2e-4) break;
    }
    return { speed: Math.hypot(vh, vy), elevation: Math.atan2(vy, vh), vh, vy };
  });
}

/**
 * Horizontal span of a symmetric parabola of apex `h` whose ARC length is `L`.
 * (Accepts a catalogue arc length as a throw; L ≤ 2h has no span → 0.)
 */
export function spanForArcLength(h, L) {
  if (!(h > 0) || !(L > 2 * h)) return 0;
  const arc = (R) => {
    const u = (4 * h) / R;
    return (R * R / (8 * h)) * (u * Math.sqrt(1 + u * u) + Math.asinh(u));
  };
  let lo = 1e-6, hi = L;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (arc(mid) < L) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The design horizontal throw of a nozzle, metres, or null. Catalogues have no throw
 * field today; these are the names a fixture may carry (engineering.* or the config).
 */
export function designThrowM(cfg) {
  const e = cfg?.engineering || {};
  const pick = (...vals) => vals.map(Number).find((v) => Number.isFinite(v) && v > 0);
  const direct = pick(cfg?.designThrowM, e.throwM, e.reachM, e.throwDistanceM, e.landingDistanceM);
  if (direct) return direct;
  const L = pick(e.arcLengthM);
  const H = Number(cfg?.designHeightM);
  if (L && H > 0) { const R = spanForArcLength(H, L); return R > 0 ? R : null; }
  return null;
}

/** The fixture's design height (the 100 % apex), or null — the switch for all of this. */
export function designHeightOf(cfg) {
  const h = Number(cfg?.designHeightM);
  return Number.isFinite(h) && h > 0 ? h : null;
}

/** Quantisation of the level — fine enough to be invisible, coarse enough to memoise. */
const LEVEL_STEPS = 400;

/**
 * Delivered fraction of the design height this frame, 0..1. Goes through launchSpeed so
 * the hydraulic solve (and the engineering-preview cap) stay the ceiling.
 */
export function designLevel(cfg, ix, launchSpeedFn) {
  const H = designHeightOf(cfg);
  if (H == null) return 0;
  const d = Math.max(0, Math.min(1, Number(ix) || 0));
  let level = d;
  if (launchSpeedFn) {
    const v = launchSpeedFn(ix, designLaunchSpeed(H) * Math.sqrt(d));
    level = Math.max(0, Math.min(1, jetHeightFor(v) / H));
  }
  return Math.round(level * LEVEL_STEPS) / LEVEL_STEPS;
}

/** Elevation (radians above horizontal) of a direction vector. */
export function elevationOf(dx, dy, dz) {
  return Math.atan2(dy, Math.hypot(dx, dz));
}
