import { describe, it, expect } from "vitest";
import { showJets } from "../sceneData";

describe("show jets for the Studio renderer", () => {
  const fixtures = [
    { id: "vario", type: "nozzle_solenoid_variodrop_oase", x: 0, y: 0, engineering: { jetHeightM: 7, nozzleStyle: "mushroom bell (Vario)" } },
    { id: "rainbow", type: "nozzle_straight_dn15", x: 9, y: 0, rotation: 180, engineering: { jetHeightM: 12, aimTiltDeg: 45 } },
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
  it("marks mushroom heads as bells and keeps a fixed jet's aim", () => {
    const jets = showJets(fixtures);
    expect(jets.find((j) => j.id === "vario").bell).toBe(true);
    expect(jets.find((j) => j.id === "jet").bell).toBe(false);
    expect(jets.find((j) => j.id === "rainbow").aimTiltDeg).toBe(45);
  });
  it("flags Vario jets and reads the classic renderer's aim field", () => {
    const jets = showJets([
      { id: "v", type: "nozzle_vario_jet", x: 0, y: 0, engineering: { jetHeightM: 8 } },
      { id: "d", type: "nozzle_straight_dn15", x: 4, y: 0, engineering: { jetHeightM: 12, aimDeg: 52 } },
    ]);
    expect(jets.find((j) => j.id === "v").vario).toBe(true);
    expect(jets.find((j) => j.id === "d").aimTiltDeg).toBe(52);
  });
  it("reads a Vario's cone span (default 40°)", () => {
    const jets = showJets([
      { id: "v", type: "nozzle_vario_jet", x: 0, y: 0, engineering: { jetHeightM: 8 } },
      { id: "w", type: "nozzle_vario_jet", x: 4, y: 0, engineering: { jetHeightM: 12, varioSpanDeg: 80 } },
    ]);
    expect(jets.find((j) => j.id === "v").varioSpanDeg).toBe(40);
    expect(jets.find((j) => j.id === "w").varioSpanDeg).toBe(80);
  });
});
