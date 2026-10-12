import { describe, expect, it, vi } from "vitest";
import { createICANSiteEngineeringProject } from "../../data/icanSiteEngineeringProject";
import { useICANPreviewStore } from "../../store/icanPreviewStore";
import { fixturesToNozzleConfigs } from "../../hooks/fixtureTypeMap";
import { createFourKiloDemoShow } from "../fourKiloDemoShow";
import { createDesignShowPreview } from "../siteShowCompiler";
import { evaluateICANPreview } from "../icanPatternPreview";

const fixtures = createICANSiteEngineeringProject().fixtures;
const demo = createFourKiloDemoShow(fixtures);
const pattern = createDesignShowPreview(demo.clips, fixtures, "4KILO visual example");
const activeFunctionsAt = time => {
  const state = evaluateICANPreview(useICANPreviewStore.getState().plan, time, fixtures);
  return new Set(fixtures.filter(f => state.fixtureIntensities[f.id] > 0).map(f => f.engineering?.siteFunction));
};

describe("4KILO show-to-3D example", () => {
  it("uses the actual engineering fixture IDs and previews every water zone", () => {
    expect(demo.counts).toEqual({ running: 76, foam_all: 16, peacock: 8 });
    expect(new Set(demo.clips.map(c => c.fixtureId)).size).toBe(100);
    expect(demo.clips.every(c => c.source === "array-pattern")).toBe(true);
    const renderedIds = new Set(fixturesToNozzleConfigs(fixtures).nozzleConfigs.map(nozzle => nozzle.id));
    expect(demo.clips.every(c => renderedIds.has(c.fixtureId))).toBe(true);
    useICANPreviewStore.getState().load(pattern, 1);
    expect(activeFunctionsAt(0.1)).toContain("running-fountain");
    expect(activeFunctionsAt(9.4)).toContain("foam");
    expect(activeFunctionsAt(11.5)).toContain("peacock");
    expect(activeFunctionsAt(13)).toEqual(new Set(["running-fountain", "foam", "peacock"]));
    expect(activeFunctionsAt(14)).toEqual(new Set());
    useICANPreviewStore.getState().close();
  });

  it("advances playback and stops at the end of the visual show", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    try {
      useICANPreviewStore.getState().load(pattern, 1);
      useICANPreviewStore.getState().play();
      clock.mockReturnValue(10400);
      useICANPreviewStore.getState().tick();
      expect(useICANPreviewStore.getState().position).toBeCloseTo(9.4, 1);
      expect(activeFunctionsAt(useICANPreviewStore.getState().position)).toContain("foam");
      clock.mockReturnValue(15400);
      useICANPreviewStore.getState().tick();
      expect(useICANPreviewStore.getState().playback).toBe("complete");
    } finally {
      useICANPreviewStore.getState().close();
      clock.mockRestore();
    }
  });

  it("rejects unrelated engineering layouts", () => {
    expect(() => createFourKiloDemoShow([])).toThrow(/4KILO engineering layout/);
  });
});
