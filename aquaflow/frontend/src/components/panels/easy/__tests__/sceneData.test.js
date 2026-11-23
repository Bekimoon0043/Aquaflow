import { describe, it, expect } from "vitest";
import { showJets } from "../sceneData";

describe("show jets for the Studio renderer", () => {
  const fixtures = [
    { id: "vario", type: "nozzle_solenoid_variodrop_oase", x: 0, y: 0, engineering: { jetHeightM: 7 } },
    { id: "jet", type: "nozzle_straight_dn15", x: 2, y: 0, engineering: { jetHeightM: 3 } },
    { id: "lamp", type: "light_uw_rgb_36w", x: 2, y: 0, engineering: { pairedNozzleId: "jet" } },
  ];
  it("draws a solenoid nozzle's jet although it is classed as a valve", () => {
    const vario = showJets(fixtures).find((j) => j.id === "vario");
    expect(vario).toBeTruthy();
    expect(vario.nominalHeightM).toBe(7);
  });
  it("pairs a jet with its own light", () => {
    expect(showJets(fixtures).find((j) => j.id === "jet").lightId).toBe("lamp");
  });
});
