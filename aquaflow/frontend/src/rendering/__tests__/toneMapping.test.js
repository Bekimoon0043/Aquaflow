import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  TONE_MAPPING, DEFAULT_TONE_MAPPING, getToneMapping, threeToneMapping,
  calibratedExposure, toneCurveGrey, TONE_CALIBRATION_GREY,
} from "../sceneModes";
import { DEFAULT_RENDER_SETTINGS } from "../../store/projectStore";

// The exposures the scene's environment presets author for ACES.
const PRESET_EXPOSURES = [1.0, 1.55, 1.9, 2.1, 2.6];

describe("tone-mapping selection (AF-3D-024)", () => {
  it("defaults to ACES everywhere, so saved shows look unchanged", () => {
    expect(DEFAULT_TONE_MAPPING).toBe("aces");
    expect(DEFAULT_RENDER_SETTINGS.toneMapping).toBe("aces");
    expect(getToneMapping(undefined).id).toBe("aces");
    expect(getToneMapping("bogus").id).toBe("aces");
    expect(threeToneMapping(THREE, undefined)).toBe(THREE.ACESFilmicToneMapping);
  });

  it("maps each operator to its three.js constant, case-insensitively", () => {
    expect(threeToneMapping(THREE, "AgX")).toBe(THREE.AgXToneMapping);
    expect(threeToneMapping(THREE, "neutral")).toBe(THREE.NeutralToneMapping);
    expect(threeToneMapping(THREE, "aces")).toBe(THREE.ACESFilmicToneMapping);
    expect(Object.keys(TONE_MAPPING)).toEqual(["aces", "agx", "neutral"]);
  });

  it("falls back to ACES when the three build lacks an operator", () => {
    const oldThree = { ACESFilmicToneMapping: 4 };
    expect(threeToneMapping(oldThree, "agx")).toBe(4);
  });
});

describe("per-operator exposure calibration", () => {
  it("ACES exposure passes through bit-identically", () => {
    for (const e of PRESET_EXPOSURES) expect(calibratedExposure("aces", e)).toBe(e);
  });

  it("AgX and Neutral reproduce ACES's display mid-grey at every preset", () => {
    for (const op of ["agx", "neutral"]) {
      for (const e of PRESET_EXPOSURES) {
        const ex = calibratedExposure(op, e);
        const want = toneCurveGrey("aces", TONE_CALIBRATION_GREY * e);
        const got = toneCurveGrey(op, TONE_CALIBRATION_GREY * ex);
        expect(Math.abs(got - want)).toBeLessThan(1e-4);
      }
    }
  });

  it("calibration really changes exposure (a naive swap would shift the look)", () => {
    const naive = toneCurveGrey("neutral", TONE_CALIBRATION_GREY * 1.55);
    const aces = toneCurveGrey("aces", TONE_CALIBRATION_GREY * 1.55);
    expect(Math.abs(naive - aces)).toBeGreaterThan(0.01);
    expect(calibratedExposure("neutral", 1.55)).not.toBeCloseTo(1.55, 2);
  });

  it("grey curves are monotonic and bounded", () => {
    for (const op of ["aces", "agx", "neutral"]) {
      let prev = -1;
      for (let x = 0.001; x < 40; x *= 1.3) {
        const y = toneCurveGrey(op, x);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(y).toBeLessThanOrEqual(1);
        prev = y;
      }
    }
  });

  it("ignores nonsense exposure rather than producing NaN", () => {
    expect(calibratedExposure("agx", 0)).toBe(0);
    expect(calibratedExposure("agx", undefined)).toBeUndefined();
  });
});
