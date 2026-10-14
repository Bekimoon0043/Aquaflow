/**
 * Every water nozzle type is drawn to its design: apex = level × engineering.jetHeightM
 * (and, for arcs, landing = level × throw), flown with the renderer's own gravity and
 * drag. Checked headlessly from the emitter descriptors — the same descriptors the GPU
 * field uploads and the CPU field samples.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixturesToNozzleConfigs } from "../../../hooks/fixtureTypeMap";
import { launchSpeed } from "../jetPhysics";
import {
  describeNozzleEmitters, emitterFlight, sampleEmitterParticle, spawnDesignNozzle,
  EMIT_MODE, EMIT_CLASS,
} from "../nozzleEmitters";
import {
  RENDER_PHYSICS, simulateFlight, solveArc, speedForApex, spanForArcLength, designThrowM, fallTime,
} from "../designTrajectory";
import { insidePool } from "../splashMap";

const WIND = { x: 0, z: 0 };
const TINT = { r: 0.55, g: 0.8, b: 1.0 };
const fixture = (type, jetHeightM, extra = {}, pos = { x: 4, y: 0 }) => ({
  id: `${type}-${jetHeightM}`, type, ...pos,
  engineering: { jetHeightM, flowLpm: 80, pressureBar: 0.6, ...extra },
});
const configFor = (f) => fixturesToNozzleConfigs([f]).nozzleConfigs[0];
const emit = (cfg, ix, physics = null, elapsed = 0) => describeNozzleEmitters(
  cfg, ix, elapsed, WIND, TINT, (d, fb) => launchSpeed(physics, d, fb, null, cfg));
const close = (actual, expected, tol = 0.03) =>
  expect(Math.abs(actual - expected) / expected).toBeLessThan(tol);

// One library fixture per 3D nozzle type, at its catalogue design height.
const CASES = [
  ["nozzle_straight_dn15", "jet_1d", 3.03],
  ["jet_2d", "jet_2d", 4.0],
  ["nozzle_straight_dn40", "jet_3d", 9.79],
  ["nozzle_jet_3d", "jet_3d", 15.0],       // tilted 10°
  ["nozzle_geyser", "geyser", 5.3],
  ["nozzle_foam_dn40", "geyser", 0.58],    // a low foam bubbler
  ["nozzle_laminar", "laminar", 2.6],
  ["nozzle_arch_small", "arch", 2.45],
  ["nozzle_arch_large", "arch", 6.12],
  ["nozzle_ring", "ring", 3.0],
  ["nozzle_fan_large", "fan_jet", 5.1],
  ["nozzle_water_screen", "screen", 15.3],
  ["nozzle_cascade_weir", "cascade", 3.0],
  ["nozzle_mist_ring", "mist", 0.5],
  ["nozzle_fog_highpressure", "mist", 1.0],
  ["pirouette", "pirouette", 4.08],
  ["motion_1d", "motion_1d", 5.0],
  ["motion_2d", "motion_2d", 5.0],
  ["motion_3d", "motion_3d", 7.95],
  ["mystery_water_effect", "jet_3d", 2.0],
];

describe("design height → drawn apex, every nozzle type", () => {
  for (const [fixtureType, nozzleType, H] of CASES) {
    it(`${fixtureType} (${nozzleType}) peaks at ${H} m at 100 % and ${H / 2} m at 50 %`, () => {
      const cfg = configFor(fixture(fixtureType, H));
      expect(cfg.type).toBe(nozzleType);
      for (const level of [1, 0.5]) {
        for (const t of [0, 1.3, 2.7]) {   // motion/pirouette aim is animated
          const [main] = emit(cfg, level, null, t);
          close(emitterFlight(main).apex, H * level);
        }
      }
    });
  }

  it("apex agrees with a 120 Hz frame step too (within 3 %)", () => {
    for (const H of [0.58, 2.5, 15.3]) {
      const v = speedForApex(H);
      close(simulateFlight(0, v, RENDER_PHYSICS.water, 1 / 120).apex, H);
    }
  });

  it("a tall jet is drag-compensated (the ideal √(2gH) would draw a 15 m jet ≈12 m)", () => {
    const ideal = Math.sqrt(2 * 9.81 * 15);
    expect(simulateFlight(0, ideal).apex).toBeLessThan(13);
    close(simulateFlight(0, speedForApex(15)).apex, 15, 0.01);
  });
});

describe("arcs: apex and landing distance", () => {
  it("an arch with a catalogue throw lands at that throw (and half of it at 50 %)", () => {
    for (const [H, R] of [[2.45, 6], [3.98, 10], [6.12, 14]]) {
      const cfg = configFor(fixture("nozzle_arch_medium", H, { throwM: R }));
      expect(designThrowM(cfg)).toBe(R);
      for (const level of [1, 0.5]) {
        const f = emitterFlight(emit(cfg, level)[0]);
        close(f.apex, H * level);
        close(f.range, R * level);
      }
    }
  });

  it("reachM / arcLengthM are accepted as the throw", () => {
    expect(designThrowM(configFor(fixture("nozzle_arch_small", 2, { reachM: 5 })))).toBe(5);
    const R = designThrowM(configFor(fixture("nozzle_arch_small", 2, { arcLengthM: 9 })));
    expect(R).toBeCloseTo(spanForArcLength(2, 9), 6);
    expect(R).toBeGreaterThan(4); expect(R).toBeLessThan(9);
  });

  it("without a throw, an arch lands at the point it is aimed at (the basin centre)", () => {
    const cfg = configFor(fixture("nozzle_arch_small", 2.45, {}, { x: 5, y: 0 }));
    const [main] = emit(cfg, 1);
    const f = emitterFlight(main);
    close(f.apex, 2.45);
    close(f.range, 5);
    expect(main.dx).toBeLessThan(0);   // thrown toward the centre
  });

  it("a ring with a throw lands at it; without one it opens to 1.5 × its height", () => {
    const withThrow = emit(configFor(fixture("nozzle_ring", 3, { throwM: 4 })), 1)[0];
    expect(withThrow.mode).toBe(EMIT_MODE.RING);
    const f = emitterFlight(withThrow);
    close(f.apex, 3); close(f.range, 4);
    for (const level of [1, 0.5]) {
      const g = emitterFlight(emit(configFor(fixture("nozzle_ring", 3)), level)[0]);
      close(g.apex, 3 * level); close(g.range, 4.5 * level);
    }
  });

  it("solveArc meets both targets across the useful range", () => {
    for (const [h, R] of [[0.5, 1.5], [2, 8], [8, 12], [12, 40]]) {
      const s = solveArc(h, R);
      const f = simulateFlight(s.vh, s.vy);
      close(f.apex, h, 0.005); close(f.range, R, 0.005);
    }
  });

  it("fan half-angle follows the catalogue spray angle", () => {
    const [main] = emit(configFor(fixture("nozzle_fan_medium", 3.57, { sprayAngleDeg: 60 })), 1);
    expect((main.p2 - main.p1) * 180 / Math.PI).toBeCloseTo(60, 6);
  });
});

describe("hydraulic ceiling and demand linearity", () => {
  it("a solve that cannot deliver the design caps every type, linearly", () => {
    const weak = { exitVelocityMs: Math.sqrt(2 * 9.81 * 2.0), jetHeightM: 2.0 };
    for (const t of ["nozzle_arch_large", "nozzle_ring", "nozzle_fan_large", "nozzle_water_screen", "nozzle_laminar", "nozzle_mist_ring"]) {
      const cfg = configFor(fixture(t, 6));
      const capped = emitterFlight(emit(cfg, 1, weak)[0]).apex;
      if (cfg.type === "mist") continue; // 0.5 m-class mist is never pump-capped here
      close(capped, 2.0);
    }
    const cfg = configFor(fixture("nozzle_arch_large", 6.12, { throwM: 12 }));
    const f = emitterFlight(emit(cfg, 1, weak)[0]);
    close(f.apex, 2.0); close(f.range, 12 * 2 / 6.12);
  });

  it("a solve with head to spare never lifts a type above its design", () => {
    const strong = { exitVelocityMs: 20, jetHeightM: 20 };
    for (const [t, , H] of CASES) {
      const cfg = configFor(fixture(t, H));
      close(emitterFlight(emit(cfg, 1, strong)[0]).apex, H);
    }
  });

  it("drawn height is linear in demand (Pattern builder: height ≈ design × level)", () => {
    for (const t of ["nozzle_arch_medium", "nozzle_water_screen", "nozzle_cascade_curtain", "nozzle_geyser"]) {
      const cfg = configFor(fixture(t, 5));
      for (const d of [0.2, 0.4, 0.8]) close(emitterFlight(emit(cfg, d)[0]).apex, 5 * d);
    }
  });
});

describe("GPU and CPU paths agree", () => {
  // A seeded generator so the CPU sampler can be flown deterministically.
  const lcg = (seed = 7) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  it("CPU-sampled particles of each design type peak at the design height", () => {
    const rand = lcg();
    for (const [t, , H] of CASES) {
      const cfg = configFor(fixture(t, H));
      const main = emit(cfg, 1)[0];
      let top = -Infinity;
      for (let i = 0; i < 300; i++) {
        const p = sampleEmitterParticle(main, rand, WIND);
        const phys = main.cls === EMIT_CLASS.SPRAY ? RENDER_PHYSICS.spray : RENDER_PHYSICS.water;
        const rise = p.vy > 0 ? simulateFlight(Math.hypot(p.vx, p.vz), p.vy, phys).apex : 0;
        // A cascade's height is where it is released; everything else rises from its nozzle.
        top = Math.max(top, main.mode === EMIT_MODE.CASCADE ? p.y : p.y + rise - main.oy);
      }
      // Cones jitter speed a few %, so the tallest droplet sits just above the nominal apex
      // (a geyser's ±12 % surge more); a cascade/mist top is the design itself.
      const jitter = main.mode <= EMIT_MODE.FAN ? (1 + main.speedJitter / 2) ** 2 : 1;
      expect(top, t).toBeGreaterThan(H * 0.97);
      expect(top, t).toBeLessThan(H * jitter * 1.03 + 0.06);
    }
  });

  it("NozzleV2 (CPU/low tier) spawns design nozzles from the GPU descriptors, with apex mist at the drawn apex", () => {
    const spawned = { water: [], spray: [] }; const mist = []; const foam = [];
    const sys = (k) => ({ spawn: (...a) => spawned[k].push(a) });
    const cfg = configFor(fixture("nozzle_straight_dn40", 9.79));
    const nz = {
      config: cfg, intensity: 1, waterSys: sys("water"), spraySys: sys("spray"),
      _launchSpeed: (d, fb) => launchSpeed(null, d, fb, null, cfg),
      _spawnApexMist: (x, y, z) => mist.push(y), _spawnImpactFoam: (x, z) => foam.push([x, z]),
      _spawnBaseSplash: () => {},
    };
    expect(spawnDesignNozzle(nz, 0.1, 0, WIND, TINT)).toBe(true);
    expect(spawned.water.length).toBeGreaterThan(10);
    const [main] = emit(cfg, 1);
    for (const a of spawned.water) close(Math.hypot(a[3], a[4], a[5]), main.speed, 0.08);
    for (const y of mist) close(y - main.oy, 9.79);
    // A fixture without a design height stays on the legacy CPU switch.
    const legacy = { ...nz, config: { ...cfg, designHeightM: null } };
    expect(spawnDesignNozzle(legacy, 0.1, 0, WIND, TINT)).toBe(false);
  });

  it("the renderer physics constants match FountainScene's water and spray fields", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, "..", "FountainScene_v6.js"), "utf8");
    expect(src).toMatch(/gravity: -9\.5, drag: 0\.018/);
    expect(src).toMatch(/gravity: -7\.0, drag: 0\.024/);
    expect(src).toMatch(/this\.waterSys\.update\(delta, -9\.5, elapsed\)/);
    expect(src).toMatch(/const drag = 0\.018;/);
    expect(src).toMatch(/spawnDesignNozzle\(this, delta, elapsed, wind, wc\)/);
    expect(RENDER_PHYSICS.water).toEqual({ gravity: 9.5, drag: 0.018 });
    expect(RENDER_PHYSICS.spray).toEqual({ gravity: 7.0, drag: 0.024 });
  });
});

describe("fixtures without a design height keep their old speeds", () => {
  // The pre-design descriptor formulas, at 0.8 intensity with no solve.
  const ix = 0.8;
  const LEGACY = {
    jet_1d: 4.5 + ix * 5.5, jet_2d: 5.5 + ix * 7.0, jet_3d: 6.5 + ix * 8.5, geyser: 8.0 + ix * 7.0,
    arch: 5.0 + ix * 6.5, ring: 3.5 + ix * 4.5, laminar: 6.5 + ix * 7.5, mist: 0.8 + ix * 1.8,
    cascade: 0.5 + ix * 1.5, pirouette: 5.5 + ix * 7.0, fan_jet: 4.0 + ix * 5.0,
    screen: 7.5 + ix * 3.5, motion_1d: 5.5 + ix * 7.0, motion_2d: 5.5 + ix * 7.0, motion_3d: 6.0 + ix * 7.5,
  };
  for (const [type, speed] of Object.entries(LEGACY)) {
    it(`${type}`, () => {
      for (const cfg of [{ type, x: 3, z: 1 }, { type, x: 3, z: 1, designHeightM: null, engineering: { throwM: 9 } }]) {
        const [main] = emit(cfg, ix);
        expect(main.speed).toBeCloseTo(speed, 10);
      }
      const [c] = emit({ type, x: 3, z: 1 }, ix);
      if (type === "cascade") expect(c.oy).toBeCloseTo(2.5 + ix * 3.0, 10);
      if (type === "arch") expect(Math.asin(c.dy) * 180 / Math.PI).toBeCloseTo(28 + ix * 18, 8);
    });
  }
});

describe("landing points against the basin", () => {
  it("rim arches with catalogue heights land inside typical circular and rectangular basins", () => {
    const pools = [
      { pool: { type: "circular", radius: 6 }, rim: 5 },
      { pool: { type: "circular", radius: 10 }, rim: 8.5 },
      { pool: { type: "rect", width: 12, length: 8 }, rim: 3.5 },
    ];
    for (const { pool, rim } of pools) {
      for (const [type, H] of [["nozzle_arch_small", 2.45], ["nozzle_arch_medium", 3.98], ["nozzle_arch_large", 6.12]]) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const x = Math.cos(a) * rim, z = Math.sin(a) * rim;
          if (!insidePool(x, z, pool)) continue;
          for (const level of [1, 0.6, 0.3]) {
            const [main] = emit(configFor(fixture(type, H, {}, { x, y: z })), level);
            const f = emitterFlight(main);
            const hn = Math.hypot(main.dx, main.dz);
            const lx = x + main.dx / hn * f.range, lz = z + main.dz / hn * f.range;
            expect(insidePool(lx, lz, pool), `${type} @${rim} level ${level}`).toBe(true);
          }
        }
      }
    }
  });

  it("ring and vertical jets land within a few metres of the nozzle", () => {
    const ring = emitterFlight(emit(configFor(fixture("nozzle_ring", 3)), 1)[0]);
    expect(ring.range).toBeLessThan(4.6);
    const jet = emit(configFor(fixture("nozzle_straight_dn40", 9.79)), 1)[0];
    expect(emitterFlight(jet).range).toBeLessThan(0.05);
  });

  it("a cascade's particles live long enough to reach the water", () => {
    const [c] = emit(configFor(fixture("nozzle_cascade_curtain", 5)), 1);
    expect(c.life * 0.85).toBeGreaterThan(fallTime(5, c.speed * 0.6));
  });
});
