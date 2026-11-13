import { describe, expect, it } from "vitest";
import {
  ACESCG_TO_LINEAR_SRGB,
  DEFAULT_GLARE_PARAMETERS,
  LINEAR_SRGB_TO_ACESCG,
  MAX_SUBFRAME_SAMPLES,
  acesCgToLinearSrgb,
  createSubframeSchedule,
  exposureTimeSeconds,
  linearSrgbToACEScg,
  validateGlareParameters,
} from "../cinematic";

const expectValuesClose = (actual, expected, precision = 10) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], precision));
};

describe("shutter angle and exposure", () => {
  it("converts shutter angle and frame rate to seconds", () => {
    expect(exposureTimeSeconds(24)).toBeCloseTo(1 / 48, 12);
    expect(exposureTimeSeconds(30, 360)).toBeCloseTo(1 / 30, 12);
    expect(exposureTimeSeconds(60, 90)).toBeCloseTo(1 / 240, 12);
    expect(exposureTimeSeconds(23.976, 180)).toBeCloseTo(180 / (360 * 23.976), 12);
    expect(exposureTimeSeconds(24, 0)).toBe(0);
  });

  it("rejects non-finite rates and non-physical shutter angles", () => {
    for (const fps of [0, -24, NaN, Infinity, "24", undefined]) {
      expect(() => exposureTimeSeconds(fps)).toThrow();
    }
    for (const angle of [-1, 360.01, NaN, Infinity, "180"]) {
      expect(() => exposureTimeSeconds(24, angle)).toThrow();
    }
  });
});

describe("deterministic subframe schedules", () => {
  it("uses stratified midpoints when jitter is disabled", () => {
    const exposureSeconds = exposureTimeSeconds(24, 180);
    const start = 10 - exposureSeconds / 2;
    const times = createSubframeSchedule({
      frameTime: 10,
      exposureSeconds,
      sampleCount: 4,
      jitter: false,
    });
    const expected = Array.from({ length: 4 }, (_, i) => start + ((i + 0.5) / 4) * exposureSeconds);
    expectValuesClose(times, expected, 12);
  });

  it("is repeatable by seed, ordered, and strictly inside the shutter", () => {
    const options = { frameTime: 3.25, exposureSeconds: 1 / 48, sampleCount: 16, seed: "shot-A" };
    const a = createSubframeSchedule(options);
    const b = createSubframeSchedule(options);
    const other = createSubframeSchedule({ ...options, seed: "shot-B" });
    expect(a).toEqual(b);
    expect(a).not.toEqual(other);

    const start = options.frameTime - options.exposureSeconds / 2;
    const end = options.frameTime + options.exposureSeconds / 2;
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeGreaterThan(start);
      expect(a[i]).toBeLessThan(end);
      if (i) expect(a[i]).toBeGreaterThan(a[i - 1]);
    }
  });

  it("supports full-frame and multi-frame long exposures with bounded work", () => {
    const frameDuration = 1 / 30;
    const fullFrame = createSubframeSchedule({
      frameTime: 2,
      exposureSeconds: exposureTimeSeconds(30, 360),
      sampleCount: MAX_SUBFRAME_SAMPLES,
      seed: 7,
    });
    expect(fullFrame).toHaveLength(MAX_SUBFRAME_SAMPLES);
    expect(fullFrame[0]).toBeGreaterThan(2 - frameDuration / 2);
    expect(fullFrame.at(-1)).toBeLessThan(2 + frameDuration / 2);

    const long = createSubframeSchedule({
      frameTime: 20,
      exposureSeconds: 4,
      sampleCount: 12,
      seed: 7,
    });
    expect(long[0]).toBeGreaterThan(18);
    expect(long.at(-1)).toBeLessThan(22);
    expect(long[0]).toBeLessThan(20);
    expect(long.at(-1)).toBeGreaterThan(20);
  });

  it("handles a single sample and a zero-length shutter without invalid times", () => {
    expect(createSubframeSchedule({ frameTime: 5, exposureSeconds: 2, sampleCount: 1 })).toEqual([5]);
    expect(createSubframeSchedule({ frameTime: 5, exposureSeconds: 0, sampleCount: 3 })).toEqual([5, 5, 5]);
  });

  it("rejects excessive counts and invalid timing or sampling inputs", () => {
    for (const sampleCount of [0, -1, 1.5, MAX_SUBFRAME_SAMPLES + 1, Infinity]) {
      expect(() => createSubframeSchedule({ exposureSeconds: 1, sampleCount })).toThrow(RangeError);
    }
    for (const exposureSeconds of [-0.01, NaN, Infinity, "0.1", undefined]) {
      expect(() => createSubframeSchedule({ exposureSeconds })).toThrow();
    }
    expect(() => createSubframeSchedule({ exposureSeconds: 1, jitter: 1 })).toThrow(TypeError);
    expect(() => createSubframeSchedule({ exposureSeconds: 1, seed: NaN })).toThrow(TypeError);
  });
});

describe("linear sRGB and ACEScg transforms", () => {
  it("maps sRGB primaries to the expected ACEScg components", () => {
    const primaries = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    primaries.forEach((rgb, column) => {
      const expected = LINEAR_SRGB_TO_ACESCG.map(row => row[column]);
      expectValuesClose(linearSrgbToACEScg(rgb), expected, 10);
      expectValuesClose(acesCgToLinearSrgb(expected), rgb, 10);
    });
  });

  it("keeps neutral grey neutral at scene-referred and HDR levels", () => {
    for (const level of [0, 0.18, 1, 12]) {
      const aces = linearSrgbToACEScg([level, level, level]);
      expect(aces[0]).toBeCloseTo(level, 5);
      expect(aces[1]).toBeCloseTo(level, 5);
      expect(aces[2]).toBeCloseTo(level, 5);
      expectValuesClose(acesCgToLinearSrgb(aces), [level, level, level], 10);
    }
  });

  it("round-trips colour ratios while allowing cross-gamut hue to differ", () => {
    const source = [0.08, 0.32, 0.9];
    const normalized = source.map(v => v / Math.max(...source));
    const aces = linearSrgbToACEScg(source);
    const acesNormalized = aces.map(v => v / Math.max(...aces));
    const restored = acesCgToLinearSrgb(aces);
    const restoredNormalized = restored.map(v => v / Math.max(...restored));

    // A gamut/white-point matrix is not a hue-preserving tone mapper.
    expect(acesNormalized).not.toEqual(normalized);
    expectValuesClose(restoredNormalized, normalized, 10);
  });

  it("is linear under exposure scaling and does not clamp HDR or negative values", () => {
    const source = [0.08, 0.32, 0.9];
    expectValuesClose(linearSrgbToACEScg(source.map(v => v * 7)), linearSrgbToACEScg(source).map(v => v * 7), 10);

    const hdr = [20, 0.01, 3];
    expect(linearSrgbToACEScg(hdr)[0]).toBeGreaterThan(1);
    expectValuesClose(acesCgToLinearSrgb(linearSrgbToACEScg(hdr)), hdr, 9);

    const outOfGamut = acesCgToLinearSrgb([2, -0.05, 0.2]);
    expect(Math.min(...outOfGamut)).toBeLessThan(0);
    expectValuesClose(linearSrgbToACEScg(outOfGamut), [2, -0.05, 0.2], 9);
  });

  it("exports inverse matrices and rejects malformed colours", () => {
    const rgb = [0.13, 0.47, 1.8];
    const viaMatrix = ACESCG_TO_LINEAR_SRGB.map(row => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
    expectValuesClose(acesCgToLinearSrgb(rgb), viaMatrix, 12);
    for (const invalid of [[1, 2], [1, 2, NaN], [1, 2, Infinity], "white", null]) {
      expect(() => linearSrgbToACEScg(invalid)).toThrow();
    }
  });
});

describe("highlight-safe glare validation", () => {
  it("provides display-referred highlight defaults and accepts safe boundaries", () => {
    expect(validateGlareParameters()).toEqual(DEFAULT_GLARE_PARAMETERS);
    expect(validateGlareParameters({ threshold: 0.8, strength: 0, radius: 0 })).toEqual({
      threshold: 0.8,
      strength: 0,
      radius: 0,
    });
    expect(validateGlareParameters({ threshold: 1, strength: 1, radius: 1 })).toEqual({
      threshold: 1,
      strength: 1,
      radius: 1,
    });
  });

  it("rejects midtone thresholds, excessive glare and non-finite values", () => {
    for (const options of [
      { threshold: 0.79 },
      { threshold: 1.01 },
      { strength: -0.01 },
      { strength: 1.01 },
      { radius: -0.01 },
      { radius: 1.01 },
      { threshold: NaN },
      { strength: Infinity },
      { radius: "0.4" },
    ]) {
      expect(() => validateGlareParameters(options)).toThrow();
    }
  });

  it("returns a new validated object without modifying its input", () => {
    const input = { threshold: 0.9, strength: 0.25, radius: 0.35 };
    const output = validateGlareParameters(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(validateGlareParameters({ strength: 0 })).toMatchObject({ threshold: 0.86, strength: 0 });
    expect(() => validateGlareParameters(null)).toThrow(TypeError);
  });
});
