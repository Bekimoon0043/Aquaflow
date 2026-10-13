// AF-NEXT-013: the JS colour-pipeline mirrors agree with the app's own definitions.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { srgbToLinear, linearToSrgb, hexToLinear, acesFilmic, agx, neutral, chroma } from "../colorPipeline";
import { toneCurveGrey } from "../sceneModes";
import { srgbToLinear as showFrameSrgbToLinear } from "../../show/evaluateShowFrame";

describe("colour pipeline mirrors (docs/COLOR-PIPELINE.md)", () => {
  it("sRGB transfer matches evaluateShowFrame and three.js ColorManagement", () => {
    for (const v of [0, 0.02, 0.04045, 0.2, 0.5, 0.8, 1]) {
      expect(srgbToLinear(v)).toBeCloseTo(showFrameSrgbToLinear(v), 12);
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
    }
    const c = new THREE.Color("#55bfff");   // hex is sRGB; three stores linear
    const lin = hexToLinear("#55bfff");
    expect(c.r).toBeCloseTo(lin[0], 6);
    expect(c.g).toBeCloseTo(lin[1], 6);
    expect(c.b).toBeCloseTo(lin[2], 6);
  });

  it("tone mappers agree with the calibrated grey curves of sceneModes", () => {
    for (const x of [0.05, 0.18, 0.5, 1.2]) {
      expect(acesFilmic([x, x, x])[0]).toBeCloseTo(toneCurveGrey("aces", x), 3);
      expect(agx([x, x, x])[1]).toBeCloseTo(toneCurveGrey("agx", x), 2);
      expect(neutral([x, x, x])[2]).toBeCloseTo(toneCurveGrey("neutral", x), 6);
    }
  });

  it("saturated colour loses chroma under ACES as HDR level rises (the washout mechanism)", () => {
    const blue = hexToLinear("#0066ff");
    expect(chroma(acesFilmic(blue.map(v => v * 0.5), 1.55))).toBeGreaterThan(0.95);
    expect(chroma(acesFilmic(blue.map(v => v * 4), 1.55))).toBeLessThan(0.5);
  });
});
