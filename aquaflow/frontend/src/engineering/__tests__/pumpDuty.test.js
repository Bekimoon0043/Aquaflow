// Pumps placed in the Engineering design feed the preview's hydraulic solve, and their
// power × efficiency shows up as what they can deliver.
import { describe, it, expect } from "vitest";
import { pumpRating, deliveredDuty, efficiencyFraction } from "../pumpDuty";
import { buildHydraulicPreviewPayload, isFeedPumpFixture } from "../hydraulicAdapter";
import { pumpReadoutText } from "../../components/panels/designer/FixturePropertiesPanel";

const nozzle = { id: "n1", type: "nozzle_straight_dn15", x: 0, y: 0, engineering: { flowLpm: 30, pressureBar: 1 } };
const pump = { id: "p1", type: "pump_submersible_1_5kw", x: 2, y: 0, engineering: { efficiency: 30 } };

describe("pump duty (mirror of services/pump_duty.py)", () => {
  it("reads efficiency as percent or fraction", () => {
    expect(efficiencyFraction(70)).toBeCloseTo(0.7);
    expect(efficiencyFraction(0.7)).toBeCloseTo(0.7);
    expect(efficiencyFraction(0)).toBeNull();
  });

  it("slows a pump whose power × efficiency cannot drive its duty", () => {
    const water = 1000 * 9.81 * (22 / 3600) * 12;
    const r = pumpRating({ flowM3Hr: 22, headM: 12, powerKw: 1.5, efficiency: 30 });
    expect(r.powerLimited).toBe(true);
    expect(r.speedRatio).toBeCloseTo(Math.cbrt((0.3 * 1500) / water), 6);
    const d = deliveredDuty({ flowM3Hr: 22, headM: 12, powerKw: 1.5, efficiency: 30 });
    expect(d.deliveredHeadM).toBeCloseTo(12 * r.speedRatio ** 2, 6);
    expect(pumpRating({ flowM3Hr: 22, headM: 12, powerKw: 1.5, efficiency: 70 }).powerLimited).toBe(false);
  });

  it("uses the designer's m³/h flow over the library L/min", () => {
    expect(pumpRating({ flowM3Hr: 40, flowLpm: 366.67, headM: 12 }).flowM3s).toBeCloseTo(40 / 3600, 9);
  });
});

describe("preview solve payload", () => {
  it("sends the design's feed pumps with library data overlaid by the designer's edits", () => {
    const payload = buildHydraulicPreviewPayload({ fixtures: [nozzle], pumps: [nozzle, pump] });
    expect(payload.nozzles.map((n) => n.id)).toEqual(["n1"]);
    expect(payload.pumps).toHaveLength(1);
    expect(payload.pumps[0].engineering).toMatchObject({ flowM3Hr: 22, headM: 12, powerKw: 1.5, efficiency: 30 });
  });

  it("leaves out mist pumps and keeps the fixed-head source when there are no pumps", () => {
    expect(isFeedPumpFixture({ type: "pump_high_pressure_mist_2_2kw" })).toBe(false);
    expect(isFeedPumpFixture(pump)).toBe(true);
    expect(buildHydraulicPreviewPayload({ fixtures: [nozzle] }).pumps).toBeUndefined();
  });
});

describe("Properties panel read-out", () => {
  it("warns when the pump is power-limited", () => {
    const r = pumpReadoutText({ flowM3Hr: 22, headM: 12, powerKw: 1.5, efficiency: 30 });
    expect(r.warn).toBe(true);
    expect(r.text).toMatch(/runs at \d+% speed/);
  });

  it("confirms a sufficient motor", () => {
    const r = pumpReadoutText({ flowM3Hr: 22, headM: 12, powerKw: 1.5, efficiency: 70 });
    expect(r.warn).toBe(false);
    expect(r.text).toMatch(/Delivers 12\.0 m @ 22\.0 m³\/h.*sufficient/);
  });
});
