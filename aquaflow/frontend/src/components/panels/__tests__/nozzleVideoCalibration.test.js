import { describe, expect, it } from "vitest";
import { withNozzleCalibration } from "../NozzleVideoCalibration";
import { readStudio } from "../../programmer/studio/showModel";

describe("nozzle video calibration in Commission", () => {
  it("stores calibration on the show's site without touching patterns or other site settings", () => {
    const programmer = { studio: { recipes: [{ id: "r1" }], site: { followStems: true, calibration: { geyser: { delayS: 0.4 } } } }, timelineClips: [{ id: "c" }] };
    const next = withNozzleCalibration(programmer, "jet_3d", { delayS: 0.2, apexM: 6 });
    expect(next.studio.site.calibration).toEqual({ geyser: { delayS: 0.4 }, jet_3d: { delayS: 0.2, apexM: 6 } });
    expect(next.studio.site.followStems).toBe(true);
    expect(next.studio.recipes).toEqual([{ id: "r1" }]);
    expect(next.timelineClips).toEqual([{ id: "c" }]);
    expect(programmer.studio.site.calibration.jet_3d).toBeUndefined(); // input not mutated
    expect(readStudio(next).site.calibration.jet_3d.apexM).toBe(6);    // Show Programming sees it
  });

  it("works on a project that has never opened Show Programming", () => {
    expect(withNozzleCalibration(null, "arch", { delayS: 1 }).studio.site.calibration).toEqual({ arch: { delayS: 1 } });
  });
});
