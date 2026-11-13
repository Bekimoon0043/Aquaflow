import { describe, it, expect } from "vitest";
import {
  REALISM_CORPUS_VERSION,
  REALISM_FIXTURE_COUNTS,
  REALISM_CAPTURE_DEFAULTS,
  REALISM_CAMERAS,
  REALISM_CAMERA_BY_ID,
  REALISM_CASES,
  REALISM_CASE_BY_ID,
  REALISM_PERF_SCENES,
  buildRealismShotMatrix,
  DEFAULT_NUMERIC_TOLERANCE,
  checkNumericTolerance,
  withinNumericTolerance,
  compareDeterministicFrames,
  validatePerfStatsShape,
  isPerfStatsShape,
} from "../__bench__/realismCorpus";
import { BENCH_SIZES } from "../__bench__/largeShowBench";
import { QUALITY_CONFIG } from "../sceneQuality";

const CASE_IDS = [
  "clear",
  "aerated",
  "laminar",
  "fan",
  "bell",
  "cascade-waterwall",
  "rgbw-underwater-spot",
  "moving-gobo-vertical-slice",
];

const validPerf = () => ({
  quality: "medium",
  fixtures: 100,
  nozzles: 64,
  lights: 36,
  resolution: {
    width: 1920,
    height: 1080,
    pixelRatio: 1.5,
    drawingBuffer: { width: 1920, height: 1080 },
  },
  frameTime: {
    frames: 120,
    medianMs: 16,
    p95Ms: 24,
    p99Ms: 30,
    maxMs: 40,
    meanMs: 17,
    meanFps: 58.82,
    medianFps: 62.5,
  },
  drawCalls: { median: 120, max: 140 },
  triangles: { median: 50000, max: 60000 },
  particles: { median: 10000, max: 12000 },
  programs: 20,
  features: { pixelRatio: 1.5 },
});

const rgbaFrame = (data, capture = { seed: 1234, timeS: 4, fps: 60 }) => ({
  data: Uint8Array.from(data),
  width: 2,
  height: 1,
  capture,
});

describe("realism corpus definitions", () => {
  it("covers every requested water, light and vertical-slice case exactly once", () => {
    expect(REALISM_CORPUS_VERSION).toBe(1);
    expect(REALISM_CASES.map(testCase => testCase.id)).toEqual(CASE_IDS);
    expect(new Set(CASE_IDS).size).toBe(REALISM_CASES.length);
    for (const testCase of REALISM_CASES) {
      expect(REALISM_CASE_BY_ID[testCase.id]).toBe(testCase);
      expect(testCase.fixtures.length).toBeGreaterThan(0);
      expect(new Set(testCase.fixtures.map(fixture => fixture.id)).size).toBe(testCase.fixtures.length);
      expect(testCase.viewIds.length).toBeGreaterThan(0);
      expect(testCase.captureTimesS.length).toBeGreaterThan(0);
      expect(testCase.acceptance.observations.length).toBeGreaterThan(0);
      expect(testCase.acceptance.deterministic).toEqual({
        channelTolerance: 0,
        maxDifferentPixelRatio: 0,
        maxMeanAbsoluteError: 0,
      });
      for (const viewId of testCase.viewIds) expect(REALISM_CAMERA_BY_ID[viewId]).toBeDefined();
      for (const timeS of testCase.captureTimesS) expect(Number.isFinite(timeS) && timeS >= 0).toBe(true);
    }
  });

  it("uses real fixture keys for the cascade/waterwall and RGBW cases", () => {
    expect(REALISM_CASE_BY_ID["cascade-waterwall"].fixtures.map(fixture => fixture.type)).toEqual([
      "nozzle_cascade_curtain",
      "nozzle_water_screen",
    ]);
    const rgbw = REALISM_CASE_BY_ID["rgbw-underwater-spot"];
    expect(rgbw.fixtures.some(fixture => fixture.type === "light_uw_rgbw_72w")).toBe(true);
    expect(rgbw.signals.lightingColor).toEqual({ r: 0.15, g: 0.45, b: 1, w: 0.65 });
  });

  it("keys the moving gobo case at fixed times with changing motion", () => {
    const testCase = REALISM_CASE_BY_ID["moving-gobo-vertical-slice"];
    expect(testCase.captureTimesS).toEqual([0, 1.5, 3]);
    expect(testCase.timeline.map(key => key.timeS)).toEqual(testCase.captureTimesS);
    const poses = testCase.timeline.map(key => key.fixtureMotion["moving-gobo"]);
    expect(new Set(poses.map(pose => pose.pan)).size).toBe(3);
    expect(new Set(poses.map(pose => pose.goboRotationDeg)).size).toBe(3);
    expect(poses.every(pose => pose.gobo === "breakup-01")).toBe(true);
  });

  it("provides day/night/audience/side/close/top named cameras", () => {
    expect(REALISM_CAMERAS.map(view => view.id)).toEqual(["day", "night", "audience", "side", "close", "top"]);
    expect(REALISM_CAMERA_BY_ID.day.environment).toBe("day");
    expect(REALISM_CAMERA_BY_ID.night.environment).toBe("night");
    for (const view of REALISM_CAMERAS) {
      expect(view.fov).toBeGreaterThan(0);
      expect(view.fov).toBeLessThan(180);
      for (const point of [view.position, view.target]) {
        expect(Object.values(point).every(Number.isFinite)).toBe(true);
      }
      expect(view.position).not.toEqual(view.target);
    }
  });

  it("keeps the corpus immutable", () => {
    expect(Object.isFrozen(REALISM_CASES)).toBe(true);
    expect(Object.isFrozen(REALISM_CASES[0].fixtures)).toBe(true);
    expect(Object.isFrozen(REALISM_CAMERAS[0].position)).toBe(true);
    expect(Object.isFrozen(REALISM_PERF_SCENES[0].resolution)).toBe(true);
  });
});

describe("benchmark matrix", () => {
  it("defines 20/100/300-fixture performance scenes without performance claims", () => {
    expect(REALISM_FIXTURE_COUNTS).toEqual(BENCH_SIZES);
    expect(REALISM_PERF_SCENES.map(scene => scene.fixtures)).toEqual([20, 100, 300]);
    for (const scene of REALISM_PERF_SCENES) {
      expect(scene.content).toBe("synthetic");
      expect(QUALITY_CONFIG[scene.quality]).toBeDefined();
      expect(scene.warmupMs).toBeGreaterThan(0);
      expect(scene.sampleMs).toBeGreaterThan(0);
      expect(scene).not.toHaveProperty("minFps");
      expect(scene).not.toHaveProperty("maxFrameMs");
    }
  });

  it("expands cases, cameras and fixed capture times to deterministic shot configs", () => {
    const shots = buildRealismShotMatrix();
    expect(shots).toHaveLength(50);
    expect(new Set(shots.map(shot => shot.id)).size).toBe(shots.length);
    for (const shot of shots) {
      expect(shot.camera).toBe(REALISM_CAMERA_BY_ID[shot.viewId]);
      expect(shot.environment).toBe(shot.camera.environment);
      expect(shot.capture).toMatchObject({
        seed: REALISM_CAPTURE_DEFAULTS.seed,
        fps: 60,
        width: 960,
        height: 540,
        environment: shot.environment,
      });
      expect(REALISM_CASE_BY_ID[shot.caseId].captureTimesS).toContain(shot.capture.timeS);
    }
  });

  it("filters the matrix and rejects unknown definitions", () => {
    const shots = buildRealismShotMatrix({ caseIds: ["moving-gobo-vertical-slice"], viewIds: ["close"] });
    expect(shots.map(shot => shot.id)).toEqual([
      "moving-gobo-vertical-slice/close/0",
      "moving-gobo-vertical-slice/close/1.5",
      "moving-gobo-vertical-slice/close/3",
    ]);
    expect(() => buildRealismShotMatrix({ caseIds: ["missing"] })).toThrow("Unknown realism case");
    expect(() => buildRealismShotMatrix({ viewIds: ["missing"] })).toThrow("Unknown realism camera");
  });
});

describe("numeric acceptance", () => {
  it("accepts exact values and values inside absolute or relative tolerance", () => {
    expect(withinNumericTolerance(4, 4)).toBe(true);
    expect(withinNumericTolerance(1.005, 1, { absolute: 0.01, relative: 0 })).toBe(true);
    expect(withinNumericTolerance(100.5, 100, { absolute: 0, relative: 0.01 })).toBe(true);
    expect(DEFAULT_NUMERIC_TOLERANCE.absolute).toBeGreaterThan(0);
  });

  it("rejects values outside tolerance and non-finite samples", () => {
    expect(withinNumericTolerance(1.02, 1, { absolute: 0.01, relative: 0 })).toBe(false);
    expect(withinNumericTolerance(0.02, 0, { absolute: 0.01, relative: 1 })).toBe(false);
    const result = checkNumericTolerance(Number.NaN, 1);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/finite/);
    expect(checkNumericTolerance(1.02, 1, { absolute: 0.01, relative: 0 })).toMatchObject({
      pass: false,
      absoluteDelta: expect.closeTo(0.02, 10),
      tolerance: 0.01,
    });
  });

  it("rejects invalid tolerance configuration", () => {
    expect(() => checkNumericTolerance(1, 1, { absolute: -1 })).toThrow(RangeError);
    expect(() => checkNumericTolerance(1, 1, { relative: Number.NaN })).toThrow(RangeError);
  });
});

describe("deterministic frame acceptance", () => {
  it("compares exact RGBA frames and reports zero error", () => {
    const a = rgbaFrame([0, 1, 2, 255, 10, 20, 30, 255]);
    const b = rgbaFrame([0, 1, 2, 255, 10, 20, 30, 255]);
    expect(compareDeterministicFrames(a, b)).toEqual({
      pass: true,
      errors: [],
      pixels: 2,
      differentPixels: 0,
      differentPixelRatio: 0,
      maxChannelDelta: 0,
      meanAbsoluteError: 0,
    });
    expect(compareDeterministicFrames(a.data, b.data).pass).toBe(true);
  });

  it("reports changed pixels, maximum channel delta and mean error", () => {
    const a = rgbaFrame([0, 0, 0, 255, 10, 10, 10, 255]);
    const b = rgbaFrame([0, 4, 0, 255, 10, 10, 10, 250]);
    const result = compareDeterministicFrames(a, b, { channelTolerance: 3, maxDifferentPixelRatio: 1, maxMeanAbsoluteError: 1.2 });
    expect(result).toMatchObject({
      pass: true,
      pixels: 2,
      differentPixels: 2,
      differentPixelRatio: 1,
      maxChannelDelta: 5,
      meanAbsoluteError: 9 / 8,
    });
    expect(compareDeterministicFrames(a, b).pass).toBe(false);
  });

  it("rejects different capture keys before comparing pixels", () => {
    const a = rgbaFrame([0, 0, 0, 255, 0, 0, 0, 255]);
    const b = rgbaFrame([0, 0, 0, 255, 0, 0, 0, 255], { seed: 1234, timeS: 5, fps: 60 });
    const result = compareDeterministicFrames(a, b);
    expect(result.pass).toBe(false);
    expect(result.errors).toContain("capture timeS differs");
  });

  it("rejects malformed frames and incompatible dimensions", () => {
    expect(compareDeterministicFrames([0, 0, 0], [0, 0, 0]).pass).toBe(false);
    expect(compareDeterministicFrames([0, 0, 0, 256], [0, 0, 0, 0]).pass).toBe(false);
    const a = rgbaFrame([0, 0, 0, 255, 0, 0, 0, 255]);
    const result = compareDeterministicFrames(a, { ...a, width: 3 });
    expect(result.errors).toContain("frame width differs");
  });

  it("validates comparison options", () => {
    expect(() => compareDeterministicFrames([], [], { channels: 0 })).toThrow(RangeError);
    expect(() => compareDeterministicFrames([], [], { channelTolerance: 256 })).toThrow(RangeError);
    expect(() => compareDeterministicFrames([], [], { maxDifferentPixelRatio: 2 })).toThrow(RangeError);
  });
});

describe("performance stats acceptance", () => {
  it("accepts the aggregate shape emitted by gpuBenchPage", () => {
    const result = validatePerfStatsShape(validPerf());
    expect(result).toEqual({ valid: true, errors: [] });
    expect(isPerfStatsShape(validPerf(), { minFrames: 120 })).toBe(true);
  });

  it("reports missing or malformed nested stats with their paths", () => {
    const stats = validPerf();
    stats.frameTime.p95Ms = null;
    stats.drawCalls.median = -1;
    stats.resolution.drawingBuffer.width = 0;
    const result = validatePerfStatsShape(stats);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("frameTime.p95Ms"),
      expect.stringContaining("drawCalls.median"),
      expect.stringContaining("resolution.drawingBuffer.width"),
    ]));
  });

  it("enforces sample count and median/max consistency", () => {
    const tooShort = validPerf();
    tooShort.frameTime.frames = 4;
    expect(validatePerfStatsShape(tooShort, { minFrames: 5 }).valid).toBe(false);
    const inconsistent = validPerf();
    inconsistent.triangles.max = 1;
    expect(validatePerfStatsShape(inconsistent).errors).toContain("triangles.max must be >= triangles.median");
    expect(validatePerfStatsShape(null).valid).toBe(false);
    expect(() => validatePerfStatsShape(validPerf(), { minFrames: -1 })).toThrow(RangeError);
  });
});
