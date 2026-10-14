/**
 * Design jet heights are rendered faithfully: at 100 % a jet's ballistic apex equals the
 * fixture's engineering.jetHeightM (no 0.2 × 3 m = 0.6 m floor, no pump-head blow-up),
 * with the hydraulic solve still capping a design it cannot deliver.
 * Uses the real chain the preview uses: fixturesToNozzleConfigs → launchSpeed → emitters.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixturesToNozzleConfigs } from "../../../hooks/fixtureTypeMap";
import { launchSpeed, jetHeightFor, designLaunchSpeed, DESIGN_HEIGHT_RANGE_M } from "../jetPhysics";
import { describeNozzleEmitters, emitterFlight } from "../nozzleEmitters";

const jet = (id, jetHeightM, extra = {}) => ({
  id, type: "nozzle_straight_dn25", x: 0, y: 0,
  engineering: { jetHeightM, flowLpm: 70, pressureBar: 0.35, nozzleDiaMm: 11, connectionSize: "DN25", ...extra },
});
const configFor = (f) => fixturesToNozzleConfigs([f]).nozzleConfigs[0];
/** Apex the preview draws for a config at a demand, optionally with a solved record. */
const apexAt = (cfg, demand = 1, physics = null) => jetHeightFor(launchSpeed(physics, demand, 12.5, null, cfg));

describe("design jet height → rendered apex", () => {
  it("a 0.58 m design jet renders ≈0.58 m and a 2.5 m jet ≈2.5 m at 100 % (no solve)", () => {
    expect(apexAt(configFor(jet("small", 0.58)))).toBeCloseTo(0.58, 3);
    expect(apexAt(configFor(jet("lebu", 2.5)))).toBeCloseTo(2.5, 3);
  });

  it("small jets are not floored: 0.05 m and 0.2 m stay distinct", () => {
    expect(apexAt(configFor(jet("tiny", 0.05)))).toBeCloseTo(0.05, 4);
    expect(apexAt(configFor(jet("low", 0.2)))).toBeCloseTo(0.2, 4);
    expect(configFor(jet("small", 0.58)).heightScale).toBeCloseTo(0.58 / 3, 6);
  });

  it("only nonsense heights are bounded", () => {
    expect(configFor(jet("zero-ish", 0.001)).designHeightM).toBe(DESIGN_HEIGHT_RANGE_M.min);
    expect(configFor(jet("absurd", 5000)).designHeightM).toBe(DESIGN_HEIGHT_RANGE_M.max);
    expect(configFor(jet("none", undefined)).designHeightM).toBeNull();
    expect(designLaunchSpeed(0)).toBeNull();
  });

  it("height stays linear in show demand beneath the design apex", () => {
    const cfg = configFor(jet("lebu", 2.5));
    expect(apexAt(cfg, 0.5)).toBeCloseTo(1.25, 3);
    expect(apexAt(cfg, 2.0)).toBeCloseTo(2.5, 3);  // over-demand never exceeds the design
  });

  it("a solve with head to spare does not lift the jet above its design height", () => {
    // Lebu at design_head_m 4: the solver returns ~8.2 m/s (≈3.4 m ideal apex).
    const solved = { exitVelocityMs: 8.2085, jetHeightM: 2.9878 };
    expect(apexAt(configFor(jet("lebu", 2.5)), 1, solved)).toBeCloseTo(2.5, 3);
    expect(apexAt(configFor(jet("small", 0.58)), 1, { exitVelocityMs: 8.4368, jetHeightM: 3.1563 })).toBeCloseTo(0.58, 3);
  });

  it("a solve that cannot deliver the design height still caps it (physics is the ceiling)", () => {
    const weak = { exitVelocityMs: Math.sqrt(2 * 9.81 * 1.0), jetHeightM: 0.9 };
    expect(apexAt(configFor(jet("lebu", 2.5)), 1, weak)).toBeCloseTo(1.0, 3);
    const sink = {};
    launchSpeed(weak, 1.5, 0, sink, configFor(jet("lebu", 2.5)));
    expect(sink.lebu.demand).toBe(1.5);
  });

  it("fixtures without a design height keep the legacy estimate / solved speed exactly", () => {
    const cfg = configFor(jet("legacy", undefined, { jetHeightM: undefined }));
    expect(launchSpeed(null, 0.8, 5.5 + 0.8 * 7.0, null, cfg)).toBe(5.5 + 0.8 * 7.0);
    expect(launchSpeed({ exitVelocityMs: 20 }, 1, 0, null, cfg)).toBeCloseTo(20, 10);
  });

  it("the GPU emitters draw the straight jet's apex at the design height (renderer drag included)", () => {
    for (const h of [0.58, 2.5, 12]) {
      const cfg = configFor(jet(`j${h}`, h));
      const descs = describeNozzleEmitters(cfg, 1, 0, { x: 0, z: 0 }, null,
        (demand, fallback) => launchSpeed(null, demand, fallback, null, cfg));
      const core = descs[0];
      expect(Math.abs(emitterFlight(core).apex - h) / h).toBeLessThan(0.01);
    }
  });

  it("FountainScene keeps designHeightM on its nozzles and no longer re-scales intensity by heightScale", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, "..", "FountainScene_v6.js"), "utf8");
    expect(src).toMatch(/designHeightM: c\.designHeightM \?\? null/);
    expect(src).toMatch(/JP_launchSpeed\(this\.physics, demand, fallbackSpeed,\s*this\._overDemandSink, this\.config\)/);
    expect(src).not.toMatch(/engineering\?\.heightScale/);
    // The CPU path's apex mist sits at the jet's real apex, not the legacy 11 m estimate.
    expect(src).toMatch(/const speed2 = this\._launchSpeed\(ix, 6\.5 \+ ix\*8\.5\)/);
    expect(src).toMatch(/_spawnApexMist\(ox, this\._launchSpeed\(ix, 4\.5\+ix\*5\.5\)\*\*2/);
  });
});
