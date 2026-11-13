import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEAR_FIELD_M,
  DIMMER_CURVES,
  applyDimmerCurve,
  candelaToLux,
  composeLinearRGB,
  composeLinearRGBW,
  composeRGBWChannels,
  coneSolidAngle,
  lumensToCandela,
} from "../photometry";

const close = (actual, expected) => expect(actual).toBeCloseTo(expected, 10);

describe("SI cone photometry", () => {
  it("uses the full beam angle for cone solid angle and mean cone intensity", () => {
    close(coneSolidAngle(60), 2 * Math.PI * (1 - Math.cos(Math.PI / 6)));
    close(coneSolidAngle(360), 4 * Math.PI);
    close(lumensToCandela(1000, 60), 1000 / (2 * Math.PI * (1 - Math.cos(Math.PI / 6))));
    expect(lumensToCandela(0, 30)).toBe(0);
  });

  it("applies inverse-square falloff, incidence cosine, and a finite near-field floor", () => {
    expect(candelaToLux(100, 2)).toBe(25);
    expect(candelaToLux(100, 2, { cosIncidence: 0.5 })).toBe(12.5);
    expect(candelaToLux(100, 0)).toBe(100 / (DEFAULT_NEAR_FIELD_M ** 2));
    expect(candelaToLux(100, 0.1, 0.5)).toBe(400);
    expect(candelaToLux(100, 2, { cosIncidence: -1 })).toBe(0);
  });

  it("rejects invalid physical inputs instead of returning NaN or Infinity", () => {
    expect(() => coneSolidAngle(0)).toThrow(RangeError);
    expect(() => coneSolidAngle(361)).toThrow(RangeError);
    expect(() => lumensToCandela(-1, 30)).toThrow(/lumens/);
    expect(() => candelaToLux(100, -1)).toThrow(/distanceM/);
    expect(() => candelaToLux(100, 0, { minDistanceM: 0 })).toThrow(/must be > 0/);
    expect(() => candelaToLux(Number.NaN, 2)).toThrow(/finite/);
  });
});

describe("linear RGB/RGBW controls", () => {
  it("keeps RGB channels independent and in linear light", () => {
    expect(composeLinearRGB({ r: 0.2, g: 0.4, b: 0.6 })).toEqual([0.2, 0.4, 0.6]);
    expect(composeLinearRGB([1, 0.5, 0], { master: 0.5 })).toEqual([0.5, 0.25, 0]);
  });

  it("adds independent W without deriving it from RGB or clamping linear HDR output", () => {
    expect(composeLinearRGBW({ r: 0, g: 0, b: 0, w: 0.4 })).toEqual([0.4, 0.4, 0.4]);
    expect(composeLinearRGBW({ r: 0.8, g: 0, b: 0, w: 0.4 })[0]).toBeCloseTo(1.2, 12);
    expect(composeLinearRGBW([0, 0, 0, 1], { whiteColor: [1, 0.8, 0.5] })).toEqual([1, 0.8, 0.5]);
    expect(composeRGBWChannels([0.1, 0.2, 0.3, 0.4], { master: 0.5 })).toEqual([0.05, 0.1, 0.15, 0.2]);
  });

  it("can curve each emitter independently before one master dimmer", () => {
    const result = composeLinearRGBW([0.5, 1, 0, 0.5], { curve: "square", master: 0.5 });
    expect(result).toEqual([0.25, 0.625, 0.125]);
  });
});

describe("dimmer curves", () => {
  it("provides bounded, monotonic curves with exact endpoints", () => {
    for (const [name, curve] of Object.entries(DIMMER_CURVES)) {
      expect(applyDimmerCurve(0, name)).toBe(0);
      expect(applyDimmerCurve(1, name)).toBe(1);
      let previous = 0;
      for (let step = 1; step <= 100; step += 1) {
        const value = applyDimmerCurve(step / 100, name);
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value).toBeLessThanOrEqual(1);
        previous = value;
      }
      expect(curve(0.25)).toBeGreaterThanOrEqual(0);
    }
  });

  it("supports common curve aliases and clamps DMX values", () => {
    expect(applyDimmerCurve(0.5, "square-law")).toBe(0.25);
    expect(applyDimmerCurve(0.5, "s-curve")).toBe(0.5);
    close(applyDimmerCurve(0.5, "gamma"), 0.5 ** 2.2);
    close(applyDimmerCurve(0.5, "log"), Math.log1p(4.5) / Math.LN10);
    expect(applyDimmerCurve(-2)).toBe(0);
    expect(applyDimmerCurve(2)).toBe(1);
    expect(() => applyDimmerCurve(0.5, "unknown")).toThrow(/Unknown dimmer curve/);
  });
});
