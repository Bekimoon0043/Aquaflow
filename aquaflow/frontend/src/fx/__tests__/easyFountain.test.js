import { buildEasyFountain } from "../easyFountain";
import { createSceneContract, validateSceneContract } from "../sceneContract";
import { deserializeShow, serializeShow } from "../../utils/showFile";
import { createFullShowPreview } from "../../utils/fullShowPreview";
import { createICANPreviewPlan, evaluateICANPreview } from "../../utils/icanPatternPreview";

const baseState = result => ({
  currentShow: result.currentShow,
  nodes: [], connections: [], devices: [], timelineTracks: result.timelineTracks,
});

describe("easy fountain builder", () => {
  it("creates a complete linked water and light show", () => {
    const result = buildEasyFountain({ seconds: 10, ringCount: 12 });
    expect(result.engineering.fixtures).toHaveLength(39);
    expect(result.timelineTracks).toHaveLength(39);
    expect(result.currentShow.duration).toBe(10);
    expect(result.render.exportFps).toBe(30);
    expect(result.aquafx.schema).toBe("aquafx-scene");
    expect(result.aquafx.hardwareOutput).toBe(false);
    const nozzles = result.engineering.fixtures.filter(f => f.id.startsWith("wave-nozzle-"));
    expect(nozzles).toHaveLength(12);
    for (const nozzle of nozzles) {
      expect(Number.isFinite(nozzle.x)).toBe(true);
      expect(Number.isFinite(nozzle.y)).toBe(true);
      expect(nozzle.engineering.pumpId).toBe("main-pump");
      expect(nozzle.engineering.solenoidValveId).toMatch(/^wave-valve-/);
    }
    expect(result.engineering.fixtures.find(f => f.id === "center-hero").engineering.outletCount).toBe(3);
    expect(validateSceneContract(result.aquafx)).toEqual([]);
  });

  it("adds clearly labeled laser and flame proxies without hardware output", () => {
    const result = buildEasyFountain({ includeLaser: true, includeFlame: true, seconds: 12 });
    const laser = result.engineering.fixtures.find(f => f.id === "show-laser");
    const flame = result.engineering.fixtures.find(f => f.id === "show-flame");
    expect(laser.engineering.opticalPowerW).toBe(5);
    expect(flame.engineering.heatLightW).toBe(300);
    expect(result.timelineTracks.some(t => t.type === "laser_intensity")).toBe(true);
    expect(result.timelineTracks.some(t => t.type === "fire_intensity")).toBe(true);
    expect(result.aquafx.notes.join(" ")).toContain("proxies");
  });

  it("plays generated water, RGB, laser and flame through the canonical preview", () => {
    const result = buildEasyFountain({ seconds: 4, includeLaser: true, includeFlame: true });
    const clips = result.timelineTracks.flatMap(track => track.clips);
    const preview = createFullShowPreview(clips, result.engineering.fixtures, "Easy show");
    const plan = createICANPreviewPlan(preview, 1);
    const frame = evaluateICANPreview(plan, 0.5, result.engineering.fixtures);
    expect(frame.active).toBeGreaterThan(0);
    expect(frame.lightsActive).toBeGreaterThan(0);
    expect(frame.flame).toBeCloseTo(0.65);
    expect(frame.laser).toBeCloseTo(0.65);
    expect(frame.valve).toBe(1);
    expect(Object.values(frame.fixtureIntensities).some(level => level > 0.5)).toBe(true);
    expect(frame.showFrame.fixtures["center-hero"].level).toBeCloseTo(0.85);
  });

  it("preserves the scene contract through save/load", () => {
    const result = buildEasyFountain({ includeLaser: true, includeFlame: true });
    const data = serializeShow(baseState(result), result.engineering, null, result.aquafx);
    expect(data.aquafx).toEqual(result.aquafx);
    const restored = deserializeShow(data);
    expect(restored.aquafx).toEqual(result.aquafx);
    expect(restored.currentShow.duration).toBe(10);
    expect(restored.engineeringProject.fixtures).toHaveLength(41);
  });

  it("rejects any generated hardware permission", () => {
    const scene = createSceneContract();
    scene.hardwareOutput = true;
    expect(validateSceneContract(scene).join(" ")).toContain("hardwareOutput");
  });
});
