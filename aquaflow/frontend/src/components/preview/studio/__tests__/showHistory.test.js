import { describe, it, expect } from "vitest";
import { createShowHistory } from "../showHistory";

const fixtures = [
  { id: "oar", type: "motion_nozzle_1d_tilt_motor", x: 0, y: 0, engineering: { angleRangeDeg: 120 } },
  { id: "jet", type: "nozzle_comet_jet_dn25", x: 2, y: 0, engineering: {} },
  { id: "lamp", type: "light_uw_rgb_54w", x: 0, y: 0.4, engineering: {} },
];
// A 10 s show: the jet ramps 0 → 100 % over 10 s; the oarsman swings −45° → +45°; the lamp is gold.
const clips = [
  { id: "c1", fixtureId: "jet", type: "pump_speed", start: 0, end: 10, value: 100, keys: [0, 0, 10, 100] },
  { id: "c2", fixtureId: "oar", type: "motion_intensity", start: 0, end: 10, value: 80 },
  { id: "c3", fixtureId: "oar", type: "motion_angle", start: 0, end: 10, value: 0, keys: [0, 0, 10, 100] },
  { id: "c4", fixtureId: "lamp", type: "lighting_master", start: 0, end: 10, value: 50, color: "#ffd9a6" },
];

describe("Studio show history", () => {
  const h = createShowHistory({ fixtures, clips }, { rate: 20 });
  it("samples levels and interpolates between samples", () => {
    expect(h.level("jet", 5)).toBeCloseTo(0.5, 1);
    expect(h.level("jet", 5.025)).toBeGreaterThan(h.level("jet", 5));
    expect(h.level("oar", 3)).toBeCloseTo(0.8, 2);
    expect(h.level("nobody", 3)).toBe(0);
  });
  it("gives the swing pose of a moving nozzle at any moment", () => {
    expect(h.pan("oar", 0.5)).toBeLessThan(-35);
    expect(Math.abs(h.pan("oar", 5))).toBeLessThan(2);
    expect(h.pan("oar", 9.5)).toBeGreaterThan(35);
  });
  it("knows a light's colour", () => {
    expect(h.color("lamp", 2)).toBe("#ffd9a6");
  });
  it("keeps a sliding window of samples", () => {
    for (let t = 0; t < 10; t += 0.5) h.level("jet", t);
    const before = h.stats().samples;
    h.prune(10);
    expect(h.stats().samples).toBeLessThanOrEqual(before);
  });
});
