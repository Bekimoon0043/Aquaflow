import { describe, expect, it } from "vitest";
import { NOZZLE_MODELS, describeJetNozzle, getNozzleModel, pressureFlowM3s, validateHeight, validateThrow } from "../jetNozzleModels.js";

const clearConfig = {
  type: "jet_3d", x: 1, z: 2,
  engineering: { jetHeightM: 4, pressureBar: 1, outletDiaMm: 10, flowLpm: 80, heightRangeM: [1, 7] },
};

describe("nozzle model registry", () => {
  it("covers the core physical families and resolves aliases", () => {
    for (const key of ["clear", "hollow", "cluster", "aerated", "laminar", "jumping", "arch", "fan", "crown", "rotating"]) {
      expect(NOZZLE_MODELS[key]).toBeDefined();
    }
    expect(getNozzleModel("foam-jet").key).toBe("foam");
    expect(getNozzleModel("not-a-nozzle")).toBeNull();
  });

  it("computes pressure-driven flow from outlet area", () => {
    const q = pressureFlowM3s({ dischargeCoeff: 1, outletCount: 1, outletDiaMm: 10, deltaPPa: 50000, rho: 1000 });
    expect(q).toBeCloseTo(Math.PI * 0.0001 / 4 * 10, 10);
    const annular = pressureFlowM3s({ dischargeCoeff: 1, outletDiaMm: 20, innerDiaMm: 10, deltaPPa: 50000, rho: 1000 });
    expect(annular).toBeGreaterThan(q);
    expect(() => pressureFlowM3s({ outletDiaMm: 10, innerDiaMm: 20, deltaPPa: 1 })).toThrow();
  });

  it("builds a clear jet with a coherent core and physical provenance", () => {
    const result = describeJetNozzle(clearConfig);
    expect(result.family).toBe("clear");
    expect(result.emitters).toHaveLength(1);
    expect(result.emitters[0].mode).toBe(0);
    expect(result.engineering.outletVelocityMps).toBeGreaterThan(10);
    expect(result.breakup).toBeTruthy();
    expect(result.provenance.verified).toBe(false);
    expect(result.validation.height.valid).toBe(true);
  });

  it("adds a separate froth sheath only to aerated models", () => {
    const result = describeJetNozzle({ type: "geyser", engineering: { jetHeightM: 3, pressureBar: 0.5 } });
    expect(result.aeration.enabled).toBe(true);
    expect(result.emitters.length).toBeGreaterThan(1);
    expect(result.emitters.some((emitter) => emitter.role === "froth")).toBe(true);
  });

  it("keeps laminar spread low and carries its breakup model", () => {
    const result = describeJetNozzle({ type: "laminar", engineering: { jetHeightM: 2, pressureBar: 0.3, throwM: 2, outletDiaMm: 10 } });
    expect(result.family).toBe("laminar");
    expect(result.emitters[0].spread).toBeLessThan(0.02);
    expect(result.breakup).toBeTruthy();
  });

  it("uses a fan and its secondary spray population", () => {
    const result = describeJetNozzle({ type: "fan_jet", engineering: { jetHeightM: 2, pressureBar: 0.4, sprayAngleDeg: 60 } });
    expect(result.emitters[0].mode).toBe(2);
    expect(result.emitters).toHaveLength(2);
    expect(result.emitters[1].cls).toBe("spray");
  });

  it("uses horizontal velocity for ring emitters", () => {
    const result = describeJetNozzle({ type: "ring", engineering: { jetHeightM: 2, pressureBar: 0.4, throwM: 2, sprayAngleDeg: 60 } });
    expect(result.emitters[0].mode).toBe(1);
    expect(result.emitters[0].p1).toBeGreaterThan(0);
  });

  it("advances rotating outlets deterministically", () => {
    const cfg = { type: "pirouette", engineering: { jetHeightM: 3, pressureBar: 0.5, outletCount: 4, rotationRpm: 30 } };
    const a = describeJetNozzle(cfg, { elapsedS: 0 });
    const b = describeJetNozzle(cfg, { elapsedS: 0.25 });
    expect(a.emitters).toHaveLength(4);
    expect(a.emitters[0].phaseRad).not.toBe(b.emitters[0].phaseRad);
    expect(describeJetNozzle(cfg, { elapsedS: 0.25 })).toEqual(b);
  });

  it("validates height and throw without presenting ideal ballistics as verification", () => {
    expect(validateHeight(4, { heightRangeM: [1, 7], launchVelocityMps: 12 }).valid).toBe(true);
    expect(validateHeight(20, { launchVelocityMps: 5 }).valid).toBe(false);
    expect(validateThrow(4, { heightM: 4, elevationDeg: 45 }).idealThrowM).toBeCloseTo(16, 8);
    expect(validateThrow(4, { heightM: 4, elevationDeg: 45 }).estimated.length).toBeGreaterThan(0);
  });
});
