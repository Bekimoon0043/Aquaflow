import { describe, expect, it } from "vitest";
import { FIXTURE_MODEL_SCHEMA, fixtureModelOf, migrateFixtureModels, modelIssues, withFixtureModel } from "../fixtureModelContract.js";

const clear = {
  id: "n1", type: "nozzle_comet_10_12t_oase",
  engineering: { orificeCount: 1, outletDiaMm: 12, dischargeCoeff: 0.93, jetHeightM: 7, flowLpm: 98, pressureBar: 1, sprayAngleDeg: 4 },
};
const rgbw = { id: "l1", type: "light_uw_rgbw_72w", engineering: { lumens: 1800, beamAngleDeg: 25, colorMode: "RGBW" } };

describe("fixture model contract", () => {
  it("normalizes physical nozzle data to SI without changing the source", () => {
    const model = fixtureModelOf(clear);
    expect(model.schema).toBe(FIXTURE_MODEL_SCHEMA);
    expect(model.category).toBe("nozzle");
    expect(model.physics).toMatchObject({ outletCount: 1, outletDiameterM: 0.012, designHeightM: 7, designFlowM3S: 98 / 60000, designPressurePa: 100000 });
    expect(clear.model).toBeUndefined();
  });

  it("keeps RGBW channels and photometric data independent", () => {
    const model = fixtureModelOf(rgbw);
    expect(model.photometry).toMatchObject({ fluxLm: 1800, beamAngleDeg: 25, colorMode: "RGBW", dimmerCurve: "linear" });
  });

  it("classifies physical nozzle families rather than treating all products alike", () => {
    expect(fixtureModelOf({ type: "nozzle_foam_dn40" }).family).toBe("aerated");
    expect(fixtureModelOf({ type: "nozzle_laminar" }).family).toBe("laminar");
    expect(fixtureModelOf({ type: "light_moving_head_350w" }).family).toBe("moving_head");
  });

  it("migrates only records that lack the current model block", () => {
    const project = { fixtures: [clear, rgbw] };
    const migrated = migrateFixtureModels(project);
    expect(migrated).not.toBe(project);
    expect(migrated.fixtures.every((f) => f.model?.version === 1)).toBe(true);
    expect(migrateFixtureModels(migrated)).toBe(migrated);
    expect(project.fixtures[0].model).toBeUndefined();
    expect(withFixtureModel(migrated.fixtures[0])).toBe(migrated.fixtures[0]);
  });

  it("reports missing evidence as estimates, never as verified specifications", () => {
    expect(modelIssues({ type: "nozzle_geyser", engineering: {} }).map((i) => i.field)).toContain("physics.designPressurePa");
    expect(modelIssues({ type: "light_rgb", engineering: {} })[0]).toMatchObject({ level: "estimate", field: "photometry.fluxLm" });
  });
});
