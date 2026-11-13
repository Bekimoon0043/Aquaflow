import { describe, expect, it } from "vitest";
import { rgbwLightLevel } from "../rgbwLight.js";

describe("RGBW light level", () => {
  it("preserves RGB when white is absent", () => {
    expect(rgbwLightLevel({ r: 0.2, g: 0.4, b: 0.8 }, 0.5, 0, 4)).toEqual({ r: 0.2, g: 0.4, b: 0.8, intensity: 2 });
  });

  it("adds independent white energy", () => {
    const result = rgbwLightLevel({ r: 0, g: 0.2, b: 1 }, 0.5, 0.6, 4);
    expect(result.intensity).toBeCloseTo(4.4, 8);
    expect(result.r).toBeCloseTo(0.6 / 1.1, 8);
    expect(result.g).toBeCloseTo(0.7 / 1.1, 8);
    expect(result.b).toBe(1);
  });

  it("produces white when only W is active", () => {
    expect(rgbwLightLevel({ r: 0, g: 0, b: 1 }, 0, 0.5, 4)).toEqual({ r: 1, g: 1, b: 1, intensity: 2 });
  });

  it("turns off safely", () => {
    expect(rgbwLightLevel({ r: 0, g: 0, b: 1 }, 0, 0, 4)).toEqual({ r: 0, g: 0, b: 1, intensity: 0 });
  });
});
