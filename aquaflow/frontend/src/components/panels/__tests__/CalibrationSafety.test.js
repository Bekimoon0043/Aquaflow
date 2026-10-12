import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { nozzlesFromDesign, restoreBody } from "../CalibrationPanel";

const source = fs.readFileSync(path.resolve(__dirname, "../CalibrationPanel.jsx"), "utf8");

describe("Calibration panel safety", () => {
  it("never feeds simulated OK values into the safety kernel", () => {
    const simEffect = source.slice(source.indexOf("Simulated sensor readings"), source.indexOf("const updateNozzle"));
    expect(simEffect).not.toMatch(/safety\/inputs/);
  });

  it("never forces the emergency-stop chain or every input to OK", () => {
    expect(source).not.toMatch(/estop_chain_closed:\s*true/);
    expect(source).not.toMatch(/water_level_ok:\s*true,\s*pressure_ok:\s*true/);
  });

  it("restores only the inputs this screen injected", () => {
    expect(restoreBody(new Set(["water_level_ok"]))).toEqual({ water_level_ok: true });
    expect(restoreBody(new Set())).toEqual({});
  });

  it("calibrates the nozzles of the open design", () => {
    const rows = nozzlesFromDesign([
      { id: "n1", type: "nozzle_geyser", label: "Centre geyser", engineering: { pressureBar: 1.5 } },
      { id: "p1", type: "pump_submersible_3kw", label: "Pump" },
    ]);
    expect(rows).toEqual([expect.objectContaining({ id: "n1", label: "Centre geyser", pressure_kpa: 150 })]);
  });
});
