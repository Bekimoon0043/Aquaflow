/**
 * nozzleEmitters.js — AF-3D-006 (realism plan, Phase R2)
 *
 * Describes each nozzle as a GENERIC EMITTER, so the per-particle work can move to
 * the GPU without re-encoding seventeen bespoke nozzle behaviours in GLSL.
 *
 * The CPU emission switch in FountainScene's NozzleV2 is rich and carefully tuned —
 * seventeen types, each with its own velocity distribution, colour, scale and life.
 * Porting all of that into a shader would have meant rewriting (and almost certainly
 * regressing) every one of those tunings. The observation that avoids it: those
 * seventeen behaviours are only FIVE emission primitives with different parameters.
 *
 *   CONE     a directed stream with lateral spread — jets, laminar, geyser, arch,
 *            pirouette, motion_*, and the default
 *   RING     a circle of outward-and-up jets — ring
 *   FAN      an elevation sweep in one vertical plane — fan_jet, screen
 *   CASCADE  a falling curtain spawned above the water — cascade
 *   MIST     low-speed omnidirectional atomisation — mist
 *
 * So this module keeps the per-type knowledge in plain JavaScript, where it stays
 * readable and unit-testable, and hands the GPU a uniform description. Everything
 * that must stay on the CPU stays on the CPU: solved hydraulic launch speed
 * (jetPhysics), wind drift, and the animated aiming of the motion/pirouette types.
 *
 * Pure by design — no three.js, no WebGL — so the mapping can be tested headlessly
 * the way jetPhysics.js and splashMap.js are.
 */

import {
  RENDER_PHYSICS, speedForApex, solveArc, simulateFlight, fallTime, designLevel,
  designHeightOf, designThrowM, elevationOf, MIN_DESIGN_ELEVATION, SOLVER_DT,
} from "./designTrajectory";
import {
  SPHERE_TYPE, hasSpatialFeatures, mountHeightOf, catchHeightOf, aimOf, fanAxis, fanPlaneOf,
  fanAngleOf, reachOf, solveReachSpeed, reachTime, aimDegOfVector, sphereRadiusOf,
  sphereCoverageCos, sphereStreamSpeed, sphereDirection,
} from "./elevatedNozzles";

/** Emission primitives, shared with the simulation shader. */
export const EMIT_MODE = {
  CONE: 0,
  RING: 1,
  FAN: 2,
  CASCADE: 3,
  MIST: 4,
  // Elevated / aimed nozzles (elevatedNozzles.js). Descriptors of these modes carry
  // ux/uy/uz (a second axis), aux, and their life is solved on the CPU.
  AIM_FAN: 5,   // a sheet swept cos θ·dir + sin θ·u, θ ∈ [p1, p2] — any aim
  SPHERE: 6,    // crystal ball: streams over a cap round axis u (p1 = cos half-opening,
                //   p2 = radius); aux 1 = droplets released at the rim
  CURTAIN: 7,   // an aimed cascade: a line source along u (width p1) launched along dir
};

/** Particle classes — they differ in gravity, drag and blending. */
export const EMIT_CLASS = { WATER: "water", SPRAY: "spray" };

const DEG = Math.PI / 180;

/**
 * Static allocation weight per type: roughly the CPU spawn rate, used to divide the
 * fixed GPU particle pool between nozzles. A mist head needs far more particles than
 * a laminar jet, and the split has to be stable frame to frame — so it is derived
 * from the type's nominal rate, never from live intensity.
 */
export const TYPE_WEIGHT = {
  jet_1d: 280, jet_2d: 320, jet_3d: 260, geyser: 380, arch: 380, ring: 300,
  laminar: 200, mist: 500, cascade: 450, pirouette: 360, fan_jet: 400,
  motion_1d: 380, motion_2d: 400, motion_3d: 420, screen: 1800,
  sphere: 600,
  flame: 0, laser: 0,
};

/** Types the GPU field does not own — they stay on the CPU systems. */
export const CPU_ONLY_TYPES = new Set(["flame", "laser"]);

/**
 * Water tint, matching the CPU path exactly: droplets take the fixture colour but
 * keep a residual blue, so lit water never becomes pure fixture colour.
 */
function waterTint(tint) {
  const r = tint?.r ?? 0.55, g = tint?.g ?? 0.80, b = tint?.b ?? 1.0;
  return [
    Math.min(1, r * 0.85 + 0.15),
    Math.min(1, g * 0.85 + 0.15),
    Math.min(1, b * 0.90 + 0.25),
  ];
}

/** Ballistic flight time for a launch speed, the same rule the CPU path uses. */
function flightLife(vy, factor = 1.0) {
  return Math.max(0.12, (vy / 9.81) * 2.0 * factor);
}

function emitter(base) {
  return {
    cls: EMIT_CLASS.WATER,
    mode: EMIT_MODE.CONE,
    ox: 0, oy: 0.08, oz: 0,
    dx: 0, dy: 1, dz: 0,
    speed: 6, speedJitter: 0.05,
    spread: 0.05,          // lateral velocity spread, m/s (matches the CPU jitter)
    spawnRadius: 0.03,
    density: 1,            // 0..1 — respawn probability, so density tracks intensity
    life: 1.2,
    color: [0.85, 0.95, 1.0],
    scale: 0.1, scaleJitter: 0.0,
    stretch: 0.55,
    p1: 0, p2: 0,          // mode-specific
    weight: 300,
    ...base,
  };
}

/**
 * Describe one nozzle's emitters for this frame.
 *
 * @param {object} cfg        nozzle config {type,x,z,tiltX,tiltZ,rotation}
 * @param {number} ix         live intensity 0..1
 * @param {number} elapsed    scene time, seconds (drives animated aiming)
 * @param {object} wind       {x,z} metres/second
 * @param {object} tintColor  {r,g,b} current fixture tint
 * @param {function} launchSpeed (demand, fallback) => m/s — solved hydraulics when available
 * @returns {Array} zero or more emitter descriptors
 */
export function describeNozzleEmitters(cfg, ix, elapsed, wind, tintColor, launchSpeed) {
  const descs = describeLegacyEmitters(cfg, ix, elapsed, wind, tintColor, launchSpeed);
  // A fixture with a design height is drawn to it (see applyDesign); one without keeps
  // exactly the per-type behaviour above. A crystal ball sizes itself (sphere case).
  const designed = designHeightOf(cfg) == null || cfg?.type === SPHERE_TYPE
    ? descs : applyDesign(descs, cfg, ix, launchSpeed);
  // Mount height / aim / catch tray (elevatedNozzles.js) — only when the fixture has them.
  return hasSpatialFeatures(cfg) ? applySpatial(designed, cfg, ix, launchSpeed) : designed;
}

function describeLegacyEmitters(cfg, ix, elapsed, wind, tintColor, launchSpeed) {
  const type = cfg?.type || "jet_3d";
  if (CPU_ONLY_TYPES.has(type)) return [];

  const ox = cfg.x || 0, oz = cfg.z || 0;
  const wx = wind?.x || 0, wz = wind?.z || 0;
  const [cr, cg, cb] = waterTint(tintColor);
  const color = [cr, cg, cb];
  const spd = (fallback) => (launchSpeed ? launchSpeed(ix, fallback) : fallback);
  const weight = TYPE_WEIGHT[type] ?? 300;

  // A tilted jet: tiltX/tiltZ are degrees off vertical, as in the CPU path.
  const tilted = (tiltXDeg, tiltZDeg) => {
    const tx = tiltXDeg * DEG, tz = tiltZDeg * DEG;
    return [Math.sin(tx), Math.cos(tx) * Math.cos(tz), Math.sin(tz)];
  };

  switch (type) {
    case "jet_1d": {
      const speed = spd(4.5 + ix * 5.5);
      return [emitter({
        mode: EMIT_MODE.CONE, ox, oz, dx: wx * 0.08, dy: 1, dz: wz * 0.08,
        speed, speedJitter: 0.06, spread: 0.015, spawnRadius: 0.02,
        life: flightLife(speed), color, scale: 0.09 + ix * 0.05, stretch: 0.7,
        density: ix, weight,
      })];
    }

    case "jet_2d": {
      const speed = spd(5.5 + ix * 7.0);
      const [dx, dy, dz] = tilted(cfg.tiltX || 0, cfg.tiltZ || 0);
      return [emitter({
        mode: EMIT_MODE.CONE, ox, oz, dx: dx + wx * 0.02, dy, dz: dz + wz * 0.02,
        speed, spread: 0.06, spawnRadius: 0.04,
        life: flightLife(dy * speed, 1.05), color,
        scale: 0.10 + ix * 0.06, stretch: 0.6, density: ix, weight,
      })];
    }

    case "jet_3d": {
      const speed = spd(6.5 + ix * 8.5);
      const [dx, dy, dz] = tilted(cfg.tiltX || 0, cfg.tiltZ || 0);
      const life = flightLife(dy * speed, 1.1);
      const base = { ox, oz, dx: dx + wx * 0.02, dy, dz: dz + wz * 0.02, speed, color };
      return [
        emitter({ ...base, mode: EMIT_MODE.CONE, spread: 0.055 + ix * 0.04, spawnRadius: 0.06,
                  life, scale: 0.11 + ix * 0.06, stretch: 0.55, density: ix, weight }),
        // The atomised shell the CPU path spawned for 25% of droplets.
        emitter({ ...base, cls: EMIT_CLASS.SPRAY, mode: EMIT_MODE.CONE,
                  speed: speed * 0.8, spread: 0.8, spawnRadius: 0.1,
                  life: life * 0.6, scale: (0.11 + ix * 0.06) * 0.5, stretch: 0.35,
                  density: ix > 0.6 ? ix * 0.25 : 0, weight: Math.round(weight * 0.25) }),
      ];
    }

    case "geyser": {
      const speed = spd(8.0 + ix * 7.0);
      return [
        emitter({ mode: EMIT_MODE.CONE, ox, oz, dx: wx * 0.015, dy: 1, dz: wz * 0.015,
                  speed, speedJitter: 0.24, spread: 0.35 * ix, spawnRadius: 0.12,
                  life: flightLife(speed), color, scale: 0.14 + ix * 0.10, scaleJitter: 0.06,
                  stretch: 0.65, density: ix, weight }),
        emitter({ cls: EMIT_CLASS.SPRAY, mode: EMIT_MODE.MIST, ox, oz, oy: 0.1,
                  speed: 1.5 + ix * 2.0, spread: 0.6 * ix, spawnRadius: 0.5,
                  life: 0.8 + ix * 0.8, color, scale: 0.25 + ix * 0.20, stretch: 0.30,
                  density: ix > 0.3 ? ix : 0, weight: 140 }),
      ];
    }

    case "arch": {
      // Aimed at the basin centre, thrown on a ballistic arc.
      const toCenter = Math.atan2(-oz, -ox);
      const archRad = (28 + ix * 18) * DEG;
      const speed = 5.0 + ix * 6.5;
      const horiz = Math.cos(archRad);
      return [emitter({
        mode: EMIT_MODE.CONE, ox, oz, oy: 0.1,
        dx: Math.cos(toCenter) * horiz, dy: Math.sin(archRad), dz: Math.sin(toCenter) * horiz,
        speed, spread: 0.04 + (1 - ix) * 0.03, spawnRadius: 0.04,
        life: flightLife(Math.sin(archRad) * speed, 1.15), color,
        scale: 0.10 + ix * 0.06, stretch: 0.55, density: ix, weight,
      })];
    }

    case "ring": {
      const speed = 3.5 + ix * 4.5;
      return [emitter({
        mode: EMIT_MODE.RING, ox, oz, speed, spread: 0.08, spawnRadius: 0.1,
        p1: (0.35 + ix * 0.45) * (3 + ix * 3),   // outward horizontal speed
        life: flightLife(speed, 1.05), color,
        scale: 0.09 + ix * 0.05, stretch: 0.5, density: ix, weight,
      })];
    }

    case "laminar": {
      const speed = 6.5 + ix * 7.5;
      return [emitter({
        mode: EMIT_MODE.CONE, ox, oz, dx: wx * 0.008, dy: 1, dz: wz * 0.008,
        speed, speedJitter: 0.02, spread: 0.008, spawnRadius: 0.006,
        life: flightLife(speed, 1.08), color,
        scale: 0.09 + ix * 0.04, stretch: 0.8, density: ix, weight,
      })];
    }

    case "mist": {
      return [emitter({
        cls: EMIT_CLASS.SPRAY, mode: EMIT_MODE.MIST, ox, oz, oy: 0.08,
        speed: 0.8 + ix * 1.8, spread: 0.35 + ix * 0.6, spawnRadius: 0.15,
        p1: 0.3,   // upward bias
        life: 1.2 + ix * 1.6, color,
        scale: 0.16 + ix * 0.12, scaleJitter: 0.06, stretch: 0.2,
        density: ix, weight,
      })];
    }

    case "cascade": {
      return [emitter({
        mode: EMIT_MODE.CASCADE, ox, oz, oy: 2.5 + ix * 3.0,
        speed: 0.5 + ix * 1.5, spread: 0.3, spawnRadius: 0.08,
        p1: 1.5 + ix * 2.0,   // horizontal width of the curtain
        life: 0.6 + ix * 0.9, color,
        scale: 0.10 + ix * 0.06, stretch: 0.6, density: ix, weight,
      })];
    }

    case "pirouette": {
      // Rotating (basket) nozzle: `outletCount` streams leaning out by half the spray angle,
      // turning at `rotationRpm`. Without engineering data: one stream, 23°, 2.5 rad/s.
      const e = cfg.engineering || {};
      const outlets = Math.max(1, Math.min(16, Math.round(Number(e.outletCount) || 1)));
      const rpm = Number(e.rotationRpm);
      const rate = Number.isFinite(rpm) && rpm > 0 ? rpm * 2 * Math.PI / 60 : 2.5;
      const angle = Number(e.sprayAngleDeg);
      // The spray angle is the full cone: each outlet leans out by half of it.
      const tilt = Number.isFinite(angle) && angle > 0 ? Math.min(45, Math.max(3, angle / 2)) * DEG : 0.4;
      const speed = spd(5.5 + ix * 7.0);
      return Array.from({ length: outlets }, (_, k) => {
        const a = elapsed * rate + k * 2 * Math.PI / outlets;
        return emitter({
          mode: EMIT_MODE.CONE, ox, oz,
          dx: Math.sin(tilt) * Math.cos(a), dy: Math.cos(tilt), dz: Math.sin(tilt) * Math.sin(a),
          speed, spread: 0.05, spawnRadius: 0.03,
          life: flightLife(Math.cos(tilt) * speed, 1.05), color,
          scale: 0.10 + ix * 0.06, stretch: 0.55, density: ix, weight: weight / Math.sqrt(outlets),
        });
      });
    }

    case "fan_jet": {
      const half = (25 + ix * 20) * DEG;
      const speed = 4.0 + ix * 5.0;
      const rot = (cfg.rotation || 0) * DEG;
      return [
        // dy is the fan's HORIZONTAL COMPRESSION, not a direction component: the
        // shader multiplies the horizontal throw by it. A plain fan is uncompressed,
        // so this must be 1 — zero would collapse the sweep into a vertical line.
        emitter({ mode: EMIT_MODE.FAN, ox, oz, speed, spread: 0.2, spawnRadius: 0.03,
                  p1: Math.PI / 2 - half, p2: Math.PI / 2 + half,   // elevation sweep
                  dx: Math.cos(rot), dy: 1, dz: Math.sin(rot),      // plane orientation
                  life: flightLife(speed, 1.05), color,
                  scale: 0.09 + ix * 0.05, stretch: 0.45, density: ix, weight }),
        emitter({ cls: EMIT_CLASS.SPRAY, mode: EMIT_MODE.FAN, ox, oz,
                  speed: speed * 0.7, spread: 0.5, spawnRadius: 0.2,
                  p1: Math.PI / 2 - half * 1.5, p2: Math.PI / 2 + half * 1.5,
                  dx: Math.cos(rot), dy: 1, dz: Math.sin(rot),
                  life: 0.6 + ix * 0.3, color, scale: 0.18 + ix * 0.08, stretch: 0.25,
                  density: ix > 0.3 ? ix : 0, weight: 120 }),
      ];
    }

    case "screen": {
      // The 180° water wall: one launch speed, elevation swept across the full fan,
      // horizontally compressed so the envelope reads 3:1 as the CPU path does.
      const v = spd(7.5 + ix * 3.5);
      const rot = (cfg.rotation || 0) * DEG;
      return [
        emitter({ mode: EMIT_MODE.FAN, ox, oz, speed: v, speedJitter: 0.04, spawnRadius: 0.05,
                  p1: 14 * DEG, p2: 166 * DEG,
                  dx: Math.cos(rot), dy: 0.75, dz: Math.sin(rot),   // dy carries H-compression
                  spread: 0.1, life: flightLife(v, 1.05),
                  color: [0.84, 0.94, 1.0], scale: 0.10 + ix * 0.07, stretch: 0.66,
                  density: ix, weight }),
        emitter({ cls: EMIT_CLASS.SPRAY, mode: EMIT_MODE.FAN, ox, oz, speed: v * 0.95,
                  spawnRadius: 0.06, p1: 14 * DEG, p2: 166 * DEG,
                  dx: Math.cos(rot), dy: 0.75, dz: Math.sin(rot),
                  spread: 0.08, life: flightLife(v), color: [0.88, 0.96, 1.0],
                  scale: 0.09 + ix * 0.06, stretch: 0.04, density: ix, weight: 1000 }),
      ];
    }

    case "sphere": {
      // Crystal ball / dandelion: fine glassy streams radiating over a cap round the axis
      // (up, or the aim), ending at the rim, plus droplets that fall from the rim. Seen
      // from the front it fills a bright disc. Radius scales with the delivered level.
      const level = designHeightOf(cfg) != null ? designLevel(cfg, ix, launchSpeed) : ix;
      const R = sphereRadiusOf(cfg) * Math.max(0.05, level);
      const v = sphereStreamSpeed(R);
      const cov = sphereCoverageCos(cfg);
      const axis = aimOf(cfg)?.dir || [0, 1, 0];
      const glass = [Math.min(1, cr * 0.9 + 0.12), Math.min(1, cg * 0.9 + 0.12), Math.min(1, cb * 0.9 + 0.12)];
      // Streams live only R/v (~0.15 s): weight them up so the ball reads as a filled bright
      // disc. From the FULL radius, so the pool split stays stable while the level moves.
      const R0 = sphereRadiusOf(cfg);
      const streamWeight = Math.round(weight * Math.min(6, Math.max(1, 0.6 / (R0 / Math.max(1e-3, sphereStreamSpeed(R0))))));
      const base = { mode: EMIT_MODE.SPHERE, ox, oz, p1: cov, p2: R, ux: axis[0], uy: axis[1], uz: axis[2] };
      return [
        emitter({ ...base, speed: v, speedJitter: 0.03, spread: 0.02, spawnRadius: 0.02, aux: 0,
                  life: Math.max(0.05, R / Math.max(v, 1e-3)), color: glass,
                  scale: 0.05 + ix * 0.03, stretch: 0.95, density: ix, weight: streamWeight }),
        emitter({ ...base, speed: v * 0.12, speedJitter: 0.2, spread: 0.12, spawnRadius: 0.02, aux: 1,
                  life: Math.max(0.12, fallTime(R + 0.08) * LIFE_MARGIN), color,
                  scale: 0.06 + ix * 0.03, stretch: 0.45, density: ix * 0.5, weight: 180 }),
      ];
    }

    case "motion_1d":
    case "motion_2d":
    case "motion_3d": {
      const animX = Math.sin(elapsed * 1.5 + ox * 0.5) * 0.5 + 0.5;
      const animZ = Math.cos(elapsed * 1.1 + oz * 0.6) * 0.5 + 0.5;
      const sweep = type === "motion_1d" ? 30 : type === "motion_2d" ? 25 : 35;
      const tiltX = cfg.motionOverride ? cfg.motionOverride.pan : (cfg.tiltX || 0) + animX * sweep;
      const tiltZ = type === "motion_1d" ? 0 : cfg.motionOverride ? cfg.motionOverride.tilt : (cfg.tiltZ || 0) + animZ * sweep;
      const speed = spd(type === "motion_3d" ? 6.0 + ix * 7.5 : 5.5 + ix * 7.0);
      const [dx, dy, dz] = tilted(tiltX, tiltZ);
      return [emitter({
        mode: EMIT_MODE.CONE, ox, oz, dx: dx + wx * 0.02, dy, dz: dz + wz * 0.02,
        speed, spread: 0.12, spawnRadius: 0.05,
        life: flightLife(dy * speed, 1.05), color,
        scale: 0.10 + ix * 0.07, stretch: 0.52, density: ix, weight,
      })];
    }

    default: {
      const speed = 5.0 + ix * 6.0;
      return [emitter({
        mode: EMIT_MODE.CONE, ox, oz, speed, spread: 0.1, spawnRadius: 0.05,
        life: flightLife(speed, 1.1), color, scale: 0.25 + ix * 0.12,
        stretch: 0.5, density: ix, weight,
      })];
    }
  }
}

// ─── Design-faithful kinematics ─────────────────────────────────────────────
//
// When a fixture states a design height, every water type is drawn to it, using the
// renderer's own gravity and drag (designTrajectory.js). The legacy descriptor still
// supplies the look — colour, scale, spread, density, weight — only the kinematics are
// replaced. Target apex = level × design height, where level is the delivered fraction
// (show demand under the hydraulic ceiling), so height stays linear in demand.
//
//   vertical cones (jets, geyser, laminar, pirouette, motion, default)
//                       apex = target at the cone's own elevation (tilt included)
//   arch                apex = target, landing = level × throw; without a catalogue
//                       throw it lands at the point it is aimed at (the basin centre),
//                       held between 30° and 75° of elevation
//   ring                as arch, outward; without a throw it lands 1.5 × its height out
//   fan / screen        the vertical stream peaks at the target; fan half-angle from
//                       the catalogue spray angle when stated
//   cascade             the curtain is released at the target height (the drop)
//   mist                the top of the plume reaches the target

/** A ring without a catalogue throw opens into a crown landing 1.5 × its height out
 *  (≈69° — the legacy 59° threw a 3 m ring 7 m, out of most basins). */
const RING_THROW_PER_M = 1.5;
/** An aimed arch is held inside this elevation band. */
const ARCH_ELEVATION = { min: 30 * DEG, max: 75 * DEG };
/** Lifetime margin over the flight time: the shader trims lives by up to 15 %. */
const LIFE_MARGIN = 1.15;

/**
 * Drawn rise and landing distance of one emitter's nominal particle. Pure.
 * `dropM` > 0: it lands that far below its launch point (an elevated nozzle).
 */
export function emitterFlight(e, dropM = 0) {
  const W = RENDER_PHYSICS.water, S = RENDER_PHYSICS.spray;
  const phys = e.cls === EMIT_CLASS.SPRAY ? S : W;
  const fly = (vh, vy) => (dropM > 0 ? simulateFlight(vh, vy, phys, SOLVER_DT, dropM) : simulateFlight(vh, vy, phys));
  switch (e.mode) {
    case EMIT_MODE.RING: return fly(e.p1, e.speed);
    case EMIT_MODE.FAN: return fly(0, e.speed);
    case EMIT_MODE.CASCADE: return { apex: e.oy, range: 0, tApex: 0, tLand: fallTime(e.oy, e.speed, phys), xApex: 0 };
    case EMIT_MODE.MIST: return fly(0, e.speed * 1.2);
    case EMIT_MODE.SPHERE: return { apex: e.p2, range: 0, tApex: 0, tLand: fallTime(Math.max(0, dropM) + e.p2, 0, phys), xApex: 0 };
    case EMIT_MODE.AIM_FAN:
    case EMIT_MODE.CURTAIN:
    default: {
      const el = elevationOf(e.dx, e.dy, e.dz);
      return fly(e.speed * Math.cos(el), e.speed * Math.sin(el));
    }
  }
}

function applyDesign(descs, cfg, ix, launchSpeed) {
  if (!descs.length) return descs;
  const type = cfg?.type || "jet_3d";
  const W = RENDER_PHYSICS.water, S = RENDER_PHYSICS.spray;
  const H = designHeightOf(cfg);
  const level = designLevel(cfg, ix, launchSpeed);
  const h = level * H;
  const [main, ...rest] = descs;
  const ox = cfg.x || 0, oz = cfg.z || 0;

  // Retarget a cone at its own elevation; returns the speed ratio for its spray shells.
  const cone = (e, phys, apexH) => {
    const old = e.speed;
    const el = Math.max(MIN_DESIGN_ELEVATION, elevationOf(e.dx, e.dy, e.dz));
    e.speed = speedForApex(apexH, el, phys);
    e.life = Math.max(0.12, simulateFlight(e.speed * Math.cos(el), e.speed * Math.sin(el), phys).tLand * LIFE_MARGIN);
    return old > 0 ? e.speed / old : 1;
  };
  const scaleShells = (ratio) => rest.forEach((e) => { e.speed *= ratio; e.life *= ratio; });
  const arc = (e, R) => {
    const sol = solveArc(h, R, W);
    e.life = Math.max(0.12, simulateFlight(sol.vh, sol.vy, W).tLand * LIFE_MARGIN);
    return sol;
  };

  switch (type) {
    case "arch": {
      const thr = designThrowM(cfg);
      const aimed = Math.hypot(ox, oz);
      const full = thr ?? Math.min(4 * H / Math.tan(ARCH_ELEVATION.min),
                                   Math.max(4 * H / Math.tan(ARCH_ELEVATION.max), aimed));
      const sol = arc(main, level * full);
      const az = Math.atan2(-oz, -ox);
      const c = Math.cos(sol.elevation);
      main.dx = Math.cos(az) * c; main.dy = Math.sin(sol.elevation); main.dz = Math.sin(az) * c;
      main.speed = sol.speed;
      break;
    }
    case "ring": {
      const sol = arc(main, level * (designThrowM(cfg) ?? RING_THROW_PER_M * H));
      main.speed = sol.vy; main.p1 = sol.vh;
      break;
    }
    case "fan_jet": {
      const old = main.speed;
      main.speed = speedForApex(h, Math.PI / 2, W);
      const angle = Number(cfg.engineering?.sprayAngleDeg);
      const half = Number.isFinite(angle) && angle > 0 ? Math.min(85, Math.max(5, angle / 2)) * DEG : 45 * DEG;
      main.p1 = Math.PI / 2 - half; main.p2 = Math.PI / 2 + half;
      main.life = Math.max(0.12, simulateFlight(0, main.speed, W).tLand * LIFE_MARGIN);
      for (const e of rest) {
        e.speed = main.speed * 0.7;
        const h2 = Math.min(89 * DEG, half * 1.5);
        e.p1 = Math.PI / 2 - h2; e.p2 = Math.PI / 2 + h2;
        e.life *= old > 0 ? main.speed / old : 1;
      }
      break;
    }
    case "screen": {
      main.speed = speedForApex(h, Math.PI / 2, W);
      main.life = Math.max(0.12, simulateFlight(0, main.speed, W).tLand * LIFE_MARGIN);
      // The haze fill stays inside the wall rather than floating above it.
      for (const e of rest) {
        e.speed = speedForApex(0.95 * h, Math.PI / 2, S);
        e.life = Math.max(0.12, simulateFlight(0, e.speed, S).tLand);
      }
      break;
    }
    case "cascade": {
      main.oy = h;
      // Released at the top of the drop; the slowest particle must still reach the water.
      main.life = Math.max(0.12, fallTime(h, main.speed * 0.6, W) * LIFE_MARGIN / 0.85);
      break;
    }
    case "mist": {
      main.speed = speedForApex(h, Math.PI / 2, S) / 1.2;
      main.life = Math.max(main.life, simulateFlight(0, main.speed * 1.2, S).tApex * LIFE_MARGIN / 0.85);
      break;
    }
    case "pirouette": {
      // Every outlet of a rotating basket reaches the design height.
      for (const e of descs) cone(e, W, h);
      break;
    }
    case "geyser": {
      cone(main, W, h);
      // The base boil: never taller than half the column (a 0.6 m foam jet keeps a low boil).
      for (const e of rest) e.speed = Math.min(e.speed, speedForApex(0.5 * h, Math.PI / 2, S) / 1.2);
      break;
    }
    default: {
      // jet_1d/2d/3d, laminar, pirouette, motion_*, and any unknown water type.
      scaleShells(cone(main, W, h));
    }
  }
  return descs;
}

// ─── Elevated, aimed, caught (elevatedNozzles.js) ───────────────────────────
//
//   aim      jets (cones), fans and cascades take engineering.aimDeg / aimAzimuthDeg;
//            launch speed solved so the stream reaches `reachM` along the aim
//            (solveReachSpeed). A fan becomes an AIM_FAN sheet of fanAngleDeg around the
//            aim, cut where it breaks up at the reach, with a droplet layer flying on to
//            the water. A cascade becomes a CURTAIN launched along the aim.
//   mount    every emitter starts mountHeightM higher; lives grow by the extra fall.
//   catch    a tray at catchAtM collects the water: lives end there (the GPU field also
//            stops particles at catchY explicitly).

/** Types that keep their own aiming (animated, radial or a fixed wall). */
const NOT_AIMED = new Set(["mist", "ring", "pirouette", "motion_1d", "motion_2d", "motion_3d",
  "screen", SPHERE_TYPE, "flame", "laser"]);

function aimEmitters(descs, cfg, ix, launchSpeed, aim, type) {
  const W = RENDER_PHYSICS.water;
  const R0 = reachOf(cfg);
  let R = null;
  if (R0 != null) {
    const level = designHeightOf(cfg) != null ? designLevel(cfg, ix, launchSpeed)
      : Math.round(Math.max(0, Math.min(1, Number(ix) || 0)) * 400) / 400;
    R = Math.max(0.02, level * R0);
  }
  const [dx, dy, dz] = aim.dir;
  const cut = new Set();

  if (type === "fan_jet") {
    const [main, ...rest] = descs;
    const legacyHalf = (main.p2 - main.p1) / 2;
    const angle = fanAngleOf(cfg);
    const half = angle != null ? (angle / 2) * DEG : legacyHalf;
    const plane = fanPlaneOf(cfg);
    const u = fanAxis(aim.aimDeg, aim.azimuthDeg, plane);
    let speed = main.speed;
    if (R != null) {
      // Every edge of the sheet must reach too: solve for the hardest of aim and both edges.
      speed = 0;
      for (let s = -1; s <= 1; s++) {
        const c = Math.cos(half * s), sn = Math.sin(half * s);
        const edgeAim = aimDegOfVector(c * dx + sn * u[0], c * dy + sn * u[1], c * dz + sn * u[2]);
        speed = Math.max(speed, solveReachSpeed(R, edgeAim, W));
      }
    }
    const sheet = (e, h, sp) => {
      e.mode = EMIT_MODE.AIM_FAN;
      e.dx = dx; e.dy = dy; e.dz = dz; e.ux = u[0]; e.uy = u[1]; e.uz = u[2];
      e.p1 = -h; e.p2 = h; e.speed = sp;
    };
    sheet(main, half, speed);
    if (R != null) {
      // The sheet breaks up where it reaches: its particles end there...
      const t = reachTime(speed, aim.aimDeg, R, W);
      if (t != null) { main.life = Math.max(0.05, t); cut.add(main); }
    }
    for (const e of rest) {
      // ...and the droplet layer carries on to the water (or the tray).
      sheet(e, Math.min(Math.PI * 0.49, half * 1.1), speed * 0.85);
      if (R != null) { e.density = ix * 0.6; e.spread = 0.25; }
    }
    return cut;
  }

  if (type === "cascade") {
    const u = fanAxis(aim.aimDeg, aim.azimuthDeg, "cross");
    for (const e of descs) {
      if (e.mode !== EMIT_MODE.CASCADE) continue;
      e.mode = EMIT_MODE.CURTAIN;
      e.dx = dx; e.dy = dy; e.dz = dz; e.ux = u[0]; e.uy = u[1]; e.uz = u[2];
      if (R != null) e.speed = Math.max(e.speed, solveReachSpeed(R, aim.aimDeg, W) * 0.5);
    }
    return cut;
  }

  // Jets: every directed cone of the nozzle follows the aim; shells keep their ratio.
  const main = descs.find((e) => e.mode === EMIT_MODE.CONE);
  if (!main) return cut;
  const ratio = R != null && main.speed > 0 ? solveReachSpeed(R, aim.aimDeg, W) / main.speed : 1;
  for (const e of descs) {
    if (e.mode !== EMIT_MODE.CONE) continue;
    e.dx = dx; e.dy = dy; e.dz = dz;
    e.speed *= ratio;
  }
  return cut;
}

function applySpatial(descs, cfg, ix, launchSpeed) {
  if (!descs.length) return descs;
  const type = cfg?.type || "jet_3d";
  const mount = mountHeightOf(cfg);
  const catchY = catchHeightOf(cfg);
  const floorY = catchY ?? 0;
  const aim = aimOf(cfg);
  const aimed = aim != null && !NOT_AIMED.has(type);
  const cut = aimed ? aimEmitters(descs, cfg, ix, launchSpeed, aim, type) : null;
  const W = RENDER_PHYSICS.water, S = RENDER_PHYSICS.spray;
  const caught = catchY != null;

  for (const e of descs) {
    const phys = e.cls === EMIT_CLASS.SPRAY ? S : W;
    // An elevated cascade is released at its lip (the mount), not at a design drop.
    if (mount > 0 && (e.mode === EMIT_MODE.CASCADE || e.mode === EMIT_MODE.CURTAIN)) e.oy = 0.08;
    e.oy += mount;
    if (caught) e.catchY = catchY;
    if (cut?.has(e)) continue;
    const drop = Math.max(0, e.oy - floorY);
    switch (e.mode) {
      case EMIT_MODE.MIST: break;   // mist hangs and drifts; it never "lands"
      case EMIT_MODE.SPHERE:
        if (e.aux === 1) e.life = Math.max(0.12, fallTime(drop + e.p2, 0, phys) * (caught ? 1 : LIFE_MARGIN));
        break;
      case EMIT_MODE.CASCADE:
        e.life = Math.max(0.12, fallTime(drop, e.speed * 0.6, phys) * (caught ? 1 : LIFE_MARGIN / 0.85));
        break;
      case EMIT_MODE.FAN: {
        // Legacy elevation sweep: the shader derives the rise time per particle; add the
        // extra fall below the launch height.
        const base = simulateFlight(0, e.speed, phys).tLand;
        const full = simulateFlight(0, e.speed, phys, SOLVER_DT, drop).tLand;
        e.extraLife = Math.max(0, full - base) * (caught ? 1 : LIFE_MARGIN);
        break;
      }
      default: {
        // CONE, RING, AIM_FAN, CURTAIN: the slowest-landing direction of the emitter.
        let vh, vy;
        if (e.mode === EMIT_MODE.RING) { vh = e.p1; vy = e.speed; }
        else {
          let ny = e.dy / (Math.hypot(e.dx, e.dy, e.dz) || 1);
          if (e.mode === EMIT_MODE.AIM_FAN) {
            const h = Math.max(Math.abs(e.p1), Math.abs(e.p2));
            const nu = e.uy / (Math.hypot(e.ux, e.uy, e.uz) || 1);
            ny = Math.max(ny, ny * Math.cos(h) + Math.abs(nu) * Math.sin(h));
          }
          ny = Math.max(-1, Math.min(1, ny));
          vy = e.speed * ny; vh = e.speed * Math.sqrt(1 - ny * ny);
        }
        const tl = simulateFlight(vh, vy, phys, SOLVER_DT, drop).tLand;
        if (caught) e.life = Math.max(0.12, tl);
        else if (aimed) e.life = Math.max(0.12, tl * LIFE_MARGIN);
        else e.life = Math.max(0.12, e.life + Math.max(0, tl - simulateFlight(vh, vy, phys).tLand) * LIFE_MARGIN);
      }
    }
  }
  return descs;
}

/**
 * One particle from an emitter descriptor — the JS twin of the simulation shader's
 * spawnState(), so the CPU field (low tier, and the splash-map sample) launches exactly
 * what the GPU field launches. `rand` is injectable for tests.
 */
export function sampleEmitterParticle(e, rand = Math.random, wind = null, out = {}) {
  const rx = rand(), ry = rand(), rz = rand(), sx = rand(), sy = rand(), sz = rand();
  let x = e.ox, y = e.oy, z = e.oz, vx, vy, vz, life = e.life;
  const sJit = e.speedJitter, spread = e.spread, sRad = e.spawnRadius;
  switch (e.mode) {
    case EMIT_MODE.RING: {
      const a = rx * Math.PI * 2;
      vx = Math.cos(a) * e.p1 + (sx - 0.5) * spread;
      vy = e.speed * (1 + (ry - 0.5) * sJit);
      vz = Math.sin(a) * e.p1 + (sy - 0.5) * spread;
      x += Math.cos(a) * sRad; z += Math.sin(a) * sRad;
      break;
    }
    case EMIT_MODE.FAN: {
      const th = e.p1 + (e.p2 - e.p1) * rx;
      vy = e.speed * Math.sin(th) * (1 + (ry - 0.5) * sJit);
      const vh = e.speed * Math.cos(th) * e.dy;
      const n = Math.hypot(e.dx + 1e-5, e.dz) || 1;
      vx = vh * (e.dx + 1e-5) / n + (sx - 0.5) * spread;
      vz = vh * e.dz / n + (sy - 0.5) * spread;
      x += (sx - 0.5) * sRad * 2; z += (sy - 0.5) * sRad * 2;
      life = Math.max(0.12, vy / 9.81 * 2.0 * 1.05) + (e.extraLife || 0);
      break;
    }
    case EMIT_MODE.AIM_FAN: {
      const th = e.p1 + (e.p2 - e.p1) * rx;
      const c = Math.cos(th), s = Math.sin(th);
      const ddx = c * e.dx + s * e.ux, ddy = c * e.dy + s * e.uy, ddz = c * e.dz + s * e.uz;
      const sp = e.speed * (1 + (ry - 0.5) * sJit) / (Math.hypot(ddx, ddy, ddz) || 1);
      vx = ddx * sp + (sx - 0.5) * spread; vy = ddy * sp; vz = ddz * sp + (sy - 0.5) * spread;
      x += (sx - 0.5) * sRad * 2; z += (sy - 0.5) * sRad * 2;
      break;
    }
    case EMIT_MODE.SPHERE: {
      SPHERE_AXIS[0] = e.ux; SPHERE_AXIS[1] = e.uy; SPHERE_AXIS[2] = e.uz;
      const d = sphereDirection(rx, ry, e.p1, SPHERE_AXIS, SPHERE_TMP);
      const sp = e.speed * (1 + (rz - 0.5) * sJit);
      vx = d[0] * sp + (sx - 0.5) * spread; vy = d[1] * sp; vz = d[2] * sp + (sy - 0.5) * spread;
      // Streams leave the head; droplets are released at the rim.
      const r0 = e.aux === 1 ? e.p2 : sRad;
      x += d[0] * r0; y += d[1] * r0; z += d[2] * r0;
      break;
    }
    case EMIT_MODE.CURTAIN: {
      // A line source along u (the lip), launched along dir.
      const w = (rx - 0.5) * e.p1;
      x += e.ux * w; y += e.uy * w; z += e.uz * w;
      const sp = e.speed * (0.6 + rz * 0.8) / (Math.hypot(e.dx, e.dy, e.dz) || 1);
      vx = e.dx * sp + (sx - 0.5) * spread; vy = e.dy * sp; vz = e.dz * sp + (sy - 0.5) * spread;
      break;
    }
    case EMIT_MODE.CASCADE: {
      x += (rx - 0.5) * e.p1; z += (ry - 0.5) * sRad * 2;
      vx = (sx - 0.5) * spread; vy = -e.speed * (0.6 + rz * 0.8); vz = (sy - 0.5) * spread;
      break;
    }
    case EMIT_MODE.MIST: {
      const a = rx * Math.PI * 2, rr = ry;
      vx = Math.cos(a) * rr * e.speed + (sx - 0.5) * spread;
      vy = e.speed * (0.4 + rz * 0.8);
      vz = Math.sin(a) * rr * e.speed + (sy - 0.5) * spread;
      x += Math.cos(a) * rr * sRad; y += sz * 0.3 * sRad; z += Math.sin(a) * rr * sRad;
      break;
    }
    default: {
      const n = Math.hypot(e.dx, e.dy + 1e-5, e.dz) || 1;
      const s = e.speed * (1 + (rx - 0.5) * sJit);
      vx = e.dx / n * s + (ry - 0.5) * spread;
      vy = (e.dy + 1e-5) / n * s;
      vz = e.dz / n * s + (rz - 0.5) * spread;
      x += (sx - 0.5) * sRad * 2; z += (sy - 0.5) * sRad * 2;
    }
  }
  vx += (wind?.x || 0) * 0.08; vz += (wind?.z || 0) * 0.08;
  out.x = x; out.y = y; out.z = z; out.vx = vx; out.vy = vy; out.vz = vz;
  out.life = life * (0.85 + sz * 0.3);
  return out;
}

const SPHERE_TMP = [0, 0, 0], SPHERE_AXIS = [0, 1, 0];

/** Apex mist the CPU path hangs at a jet's top: [min intensity, spread, strength]. */
const APEX_MIST = { jet_1d: [0.4, 0.14, 1], jet_2d: [0.35, 0.20, 1], jet_3d: [0, 0.36, 1], laminar: [0.5, 0.08, 0.4] };

/**
 * CPU emission for a nozzle with a design height (NozzleV2.update). Spawns from the
 * same descriptors the GPU field uses, plus the CPU-only apex mist, base boil and impact
 * foam — placed at the drawn apex / landing point. Returns false (legacy path runs) for
 * nozzles without a design height and for flame/laser.
 */
export function spawnDesignNozzle(nz, delta, elapsed, wind, tint) {
  const cfg = nz.config, type = cfg?.type || "jet_3d";
  if (CPU_ONLY_TYPES.has(type)) return false;
  const spatial = hasSpatialFeatures(cfg);
  if (designHeightOf(cfg) == null && !spatial) return false;
  const ix = nz.intensity;
  const descs = describeNozzleEmitters(cfg, ix, elapsed, wind, tint, (d, f) => nz._launchSpeed(d, f));
  if (!descs.length) return false;
  const p = {};
  for (const e of descs) {
    const spray = e.cls === EMIT_CLASS.SPRAY;
    const sys = spray ? nz.spraySys : nz.waterSys;
    const n = Math.floor(delta * e.weight * e.density + Math.random());
    for (let i = 0; sys && i < n; i++) {
      sampleEmitterParticle(e, Math.random, wind, p);
      const sc = e.scale * (1 + e.scaleJitter * (Math.random() - 0.5) * 2);
      sys.spawn(p.x, p.y, p.z, p.vx, p.vy, p.vz, e.color[0], e.color[1], e.color[2],
                spray ? 0.55 : 0.88, p.life, sc, e.stretch);
    }
  }
  const main = descs[0];
  if (spatial) return spatialAccents(nz, main, type, ix, delta);
  const f = emitterFlight(main);
  let lx = main.ox, lz = main.oz, ax = main.ox, az = main.oz;
  if (main.mode === EMIT_MODE.CONE) {
    const hn = Math.hypot(main.dx, main.dz);
    if (hn > 1e-6) {
      lx += main.dx / hn * f.range; lz += main.dz / hn * f.range;
      ax += main.dx / hn * f.xApex; az += main.dz / hn * f.xApex;
    }
    const m = APEX_MIST[type];
    if (m && ix > m[0]) nz._spawnApexMist?.(ax, main.oy + f.apex, az, ix * m[2], m[1]);
  }
  if (type === "geyser" && ix > 0.5) nz._spawnBaseSplash?.(main.ox, main.oz, ix, 1.8);
  if (ix > 0.25 && Math.random() < ix * delta * 18) nz._spawnImpactFoam?.(lx, lz, ix);
  return true;
}

/**
 * Apex mist, base boil and impact foam of an elevated / aimed / caught nozzle: the mist
 * at the drawn apex (only when the stream rises), the boil only when the nozzle sits at
 * the water, the foam where the water actually lands: the basin, or the catch tray.
 */
function spatialAccents(nz, main, type, ix, delta) {
  const tray = Number.isFinite(main.catchY) ? main.catchY : null;
  const drop = Math.max(0, main.oy - (tray ?? 0));
  const f = emitterFlight(main, drop);
  let lx = main.ox, lz = main.oz, ax = main.ox, az = main.oz;
  if (main.mode === EMIT_MODE.CONE || main.mode === EMIT_MODE.AIM_FAN || main.mode === EMIT_MODE.CURTAIN) {
    const hn = Math.hypot(main.dx, main.dz);
    if (hn > 1e-6) {
      lx += main.dx / hn * f.range; lz += main.dz / hn * f.range;
      ax += main.dx / hn * f.xApex; az += main.dz / hn * f.xApex;
    }
    const m = APEX_MIST[type];
    if (main.mode === EMIT_MODE.CONE && m && ix > m[0] && f.apex > 0.2) {
      nz._spawnApexMist?.(ax, f.apex, az, ix * m[2], m[1], main.oy);
    }
  }
  if (type === "geyser" && ix > 0.5 && main.oy < 0.5) nz._spawnBaseSplash?.(main.ox, main.oz, ix, 1.8);
  if (ix > 0.25 && Math.random() < ix * delta * 18) {
    nz._spawnImpactFoam?.(lx, lz, ix, tray != null ? tray + 0.03 : undefined);
  }
  return true;
}

/**
 * Split a fixed particle pool between emitters by static weight.
 *
 * Allocation must not follow live intensity: a nozzle that fades out and back in
 * would otherwise have its particles handed to a neighbour and stolen back, and the
 * whole field would visibly reshuffle. Weight comes from the nozzle TYPE, so the
 * layout only changes when the design does.
 *
 * @returns {Array<{start:number,count:number}>} one range per emitter
 */
export function allocatePool(emitters, poolSize) {
  const n = emitters.length;
  if (!n || poolSize <= 0) return [];
  const total = emitters.reduce((s, e) => s + Math.max(1, e.weight || 1), 0);
  const ranges = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.max(1, emitters[i].weight || 1);
    // The last emitter absorbs the rounding remainder, so the pool is exactly filled.
    const count = i === n - 1
      ? Math.max(0, poolSize - cursor)
      : Math.min(poolSize - cursor, Math.max(1, Math.floor((w / total) * poolSize)));
    ranges.push({ start: cursor, count });
    cursor += count;
  }
  return ranges;
}
