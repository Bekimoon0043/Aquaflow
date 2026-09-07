import { describe, it, expect } from "vitest";
import {
  describeNozzleEmitters, allocatePool, EMIT_MODE, EMIT_CLASS, TYPE_WEIGHT, CPU_ONLY_TYPES,
} from "../nozzleEmitters";

const WIND = { x: 0, z: 0 };
const TINT = { r: 0.55, g: 0.8, b: 1.0 };
const describe1 = (cfg, ix = 1, elapsed = 0) =>
  describeNozzleEmitters(cfg, ix, elapsed, WIND, TINT, null);

describe("describeNozzleEmitters", () => {
  it("maps every jet family to a directed cone", () => {
    for (const type of ["jet_1d", "jet_2d", "jet_3d", "laminar", "geyser", "arch", "pirouette"]) {
      const [e] = describe1({ type, x: 1, z: 2 });
      expect(e.mode, type).toBe(EMIT_MODE.CONE);
      expect(e.cls, type).toBe(EMIT_CLASS.WATER);
      expect(e.speed, type).toBeGreaterThan(0);
      expect(e.life, type).toBeGreaterThan(0);
    }
  });

  it("uses the dedicated primitive for ring, fan, cascade and mist", () => {
    expect(describe1({ type: "ring" })[0].mode).toBe(EMIT_MODE.RING);
    expect(describe1({ type: "fan_jet" })[0].mode).toBe(EMIT_MODE.FAN);
    expect(describe1({ type: "screen" })[0].mode).toBe(EMIT_MODE.FAN);
    expect(describe1({ type: "cascade" })[0].mode).toBe(EMIT_MODE.CASCADE);
    expect(describe1({ type: "mist" })[0].mode).toBe(EMIT_MODE.MIST);
  });

  it("emits mist as spray, not water — it must fall under spray gravity", () => {
    expect(describe1({ type: "mist" })[0].cls).toBe(EMIT_CLASS.SPRAY);
  });

  it("gives jet_3d, geyser, fan and screen a second atomised spray shell", () => {
    for (const type of ["jet_3d", "geyser", "fan_jet", "screen"]) {
      const list = describe1({ type });
      expect(list.length, type).toBe(2);
      expect(list[1].cls, type).toBe(EMIT_CLASS.SPRAY);
    }
  });

  it("returns nothing for the types the CPU systems still own", () => {
    for (const type of CPU_ONLY_TYPES) {
      expect(describe1({ type })).toEqual([]);
    }
  });

  it("carries intensity into density, so an idle nozzle stops respawning", () => {
    expect(describe1({ type: "jet_3d" }, 0)[0].density).toBe(0);
    expect(describe1({ type: "jet_3d" }, 1)[0].density).toBe(1);
  });

  it("keeps the emitter count per type constant across intensities", () => {
    // The pool allocation is keyed on this: a changing count would reshuffle the
    // whole field whenever a nozzle faded.
    for (const type of Object.keys(TYPE_WEIGHT)) {
      const a = describe1({ type }, 0).length;
      const b = describe1({ type }, 0.5).length;
      const c = describe1({ type }, 1).length;
      expect([a, b, c], type).toEqual([a, a, a]);
    }
  });

  it("aims arch nozzles back toward the basin centre", () => {
    const [e] = describe1({ type: "arch", x: 4, z: 0 });
    expect(e.dx).toBeLessThan(0);      // sitting at +x, thrown toward -x
    expect(e.dy).toBeGreaterThan(0);   // and upward
  });

  it("sweeps the water screen across a full 180 degree fan", () => {
    const [e] = describe1({ type: "screen" });
    expect(e.p1).toBeGreaterThan(0);
    expect(e.p2).toBeLessThan(Math.PI);
    expect(e.p2 - e.p1).toBeGreaterThan(2.6);   // ~152 degrees of sweep
    expect(e.dy).toBeCloseTo(0.75);             // horizontal compression -> 3:1
  });

  it("gives the fan plane a non-zero horizontal component", () => {
    // dir.y carries fan compression in the shader; zero would collapse the fan
    // into a vertical line.
    for (const type of ["fan_jet", "screen"]) {
      expect(describe1({ type })[0].dy, type).toBeGreaterThan(0);
    }
  });

  it("animates the motion and pirouette types over time", () => {
    for (const type of ["motion_1d", "motion_2d", "motion_3d", "pirouette"]) {
      const a = describe1({ type }, 1, 0)[0];
      const b = describe1({ type }, 1, 1.7)[0];
      const moved = Math.abs(a.dx - b.dx) + Math.abs(a.dz - b.dz);
      expect(moved, type).toBeGreaterThan(1e-3);
    }
  });

  it("keeps water tinted by the fixture colour but never fully recoloured", () => {
    const [e] = describeNozzleEmitters({ type: "jet_3d" }, 1, 0, WIND, { r: 1, g: 0, b: 0 }, null);
    expect(e.color[0]).toBeCloseTo(1);
    expect(e.color[2]).toBeGreaterThan(0.2);   // residual blue survives a red fixture
  });

  it("prefers solved hydraulics for launch speed when a solver is supplied", () => {
    const solved = describeNozzleEmitters({ type: "jet_3d" }, 1, 0, WIND, TINT, () => 42)[0];
    expect(solved.speed).toBe(42);
  });
});

describe("allocatePool", () => {
  const mk = (weight) => ({ weight });

  it("fills the pool exactly", () => {
    const ranges = allocatePool([mk(100), mk(300), mk(600)], 1000);
    const total = ranges.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(1000);
  });

  it("produces contiguous, non-overlapping ranges", () => {
    const ranges = allocatePool([mk(1), mk(5), mk(2), mk(9)], 4096);
    let cursor = 0;
    for (const r of ranges) {
      expect(r.start).toBe(cursor);
      cursor += r.count;
    }
    expect(cursor).toBe(4096);
  });

  it("gives heavier emitters more particles", () => {
    const [light, heavy] = allocatePool([mk(100), mk(900)], 10000);
    expect(heavy.count).toBeGreaterThan(light.count * 5);
  });

  it("never starves an emitter of every particle", () => {
    const ranges = allocatePool([mk(1), mk(100000)], 4096);
    expect(ranges[0].count).toBeGreaterThan(0);
  });

  it("handles the empty and zero-size cases", () => {
    expect(allocatePool([], 1000)).toEqual([]);
    expect(allocatePool([mk(1)], 0)).toEqual([]);
  });
});
