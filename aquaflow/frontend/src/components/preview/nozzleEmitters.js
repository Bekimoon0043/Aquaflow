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

/** Emission primitives, shared with the simulation shader. */
export const EMIT_MODE = {
  CONE: 0,
  RING: 1,
  FAN: 2,
  CASCADE: 3,
  MIST: 4,
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
      const speed = 9.0 + ix * 13.0;
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
      // The azimuth rotates; the CPU keeps ownership of the animation.
      const a = elapsed * 2.5;
      const speed = spd(5.5 + ix * 7.0);
      const tilt = 0.4;
      return [emitter({
        mode: EMIT_MODE.CONE, ox, oz,
        dx: Math.sin(tilt) * Math.cos(a), dy: Math.cos(tilt), dz: Math.sin(tilt) * Math.sin(a),
        speed, spread: 0.05, spawnRadius: 0.03,
        life: flightLife(Math.cos(tilt) * speed, 1.05), color,
        scale: 0.10 + ix * 0.06, stretch: 0.55, density: ix, weight,
      })];
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

    case "motion_1d":
    case "motion_2d":
    case "motion_3d": {
      const animX = Math.sin(elapsed * 1.5 + ox * 0.5) * 0.5 + 0.5;
      const animZ = Math.cos(elapsed * 1.1 + oz * 0.6) * 0.5 + 0.5;
      const sweep = type === "motion_1d" ? 30 : type === "motion_2d" ? 25 : 35;
      const tiltX = (cfg.tiltX || 0) + animX * sweep;
      const tiltZ = type === "motion_1d" ? 0 : (cfg.tiltZ || 0) + animZ * sweep;
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
