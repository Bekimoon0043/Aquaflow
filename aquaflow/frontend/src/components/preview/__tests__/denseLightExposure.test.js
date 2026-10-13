// AF-NEXT-013 — dense all-on exposure washout: render-free numeric check.
//
// Mirrors the pool-surface fixture path of WATER_FRAG_V2 in JS (fixtureLightField.js
// mirrors + the shader's gain chain) and the three r165 tone mappers
// (rendering/colorPipeline.js), then evaluates 1, 2, 50 and 300 fixtures.
import { describe, it, expect } from "vitest";
import {
  encodeLight, buildClusters, clusteredLightN, densityNormalize, surfaceKnee, denseSurface,
  DENSITY_FREE, DENSE_MAX, FIELD_LIGHT_GLSL,
} from "../fixtureLightField";
import { WATER_FRAG_V2 } from "../sceneShaders";
import { TONE_MAPPERS, hexToLinear, chroma, luminance } from "../../../rendering/colorPipeline";
import { calibratedExposure } from "../../../rendering/sceneModes";

const NIGHT_EXPOSURE = 1.55;          // sceneLighting.js night preset (ACES-authored)
const CAUSTICS = 0.2, GGX = 0.3;      // representative mid-surface values
const BASE = [0.004, 0.012, 0.02];    // dark night water before fixture light
const P = { x: 0, y: 0.02, z: 0 };    // a pool-surface sample
const UP = { x: 0, y: 1, z: 0 };

/** n fixtures of one colour on a 0.6 m grid centred under P (the dense case). */
function layout(n, hex, { intensity = 0.8, radius = 6 } = {}) {
  const color = (() => { const [r, g, b] = hexToLinear(hex); return { r, g, b }; })();
  const side = Math.ceil(Math.sqrt(n));
  return Array.from({ length: n }, (_, i) => ({
    x: ((i % side) - (side - 1) / 2) * 0.6, z: (Math.floor(i / side) - (side - 1) / 2) * 0.6, y: -0.3,
    color, intensity, radius,
  }));
}

/** Shader mirror: pool-surface HDR colour for a set of fixtures (fix on/off). */
function surface(lights, { fix = true } = {}) {
  const enc = lights.map(encodeLight);
  const cl = buildClusters(enc);
  const { rgb, n } = clusteredLightN(enc, cl, P, UP, 0, 0);
  const field = surfaceKnee(fix ? densityNormalize(rgb, n) : rgb);
  const fs = Math.min(1, Math.hypot(...field));
  const gain = 0.95 + CAUSTICS * 1.35 + 1.4 * fs + GGX * 1.8;
  const fixture = field.map(v => v * gain);
  const capped = fix ? denseSurface(fixture, n) : fixture;
  return { hdr: capped.map((v, i) => v + BASE[i] + GGX * 0.35), n, fixture: capped };
}

const display = (hdr, op) => TONE_MAPPERS[op](hdr, calibratedExposure(op, NIGHT_EXPOSURE));

describe("AF-NEXT-013 dense fixture exposure (shader mirror)", () => {
  it("the shaders use the mirrored functions", () => {
    expect(FIELD_LIGHT_GLSL).toContain("vec4 fieldLightN(");
    expect(FIELD_LIGHT_GLSL).toContain("vec3 flDensityNormalize(");
    expect(FIELD_LIGHT_GLSL).toContain("vec3 flDenseSurface(");
    expect(WATER_FRAG_V2).toContain("flSurfaceKnee(flDensityNormalize(fieldN))");
    expect(WATER_FRAG_V2).toContain("flDenseSurface(fixtureLight, fieldN.a)");
  });

  it("the overlap count is ~1 for one fixture, ~2 for two, large when dense", () => {
    expect(surface(layout(1, "#0066ff")).n).toBeCloseTo(1, 5);
    expect(surface(layout(2, "#0066ff")).n).toBeLessThanOrEqual(DENSITY_FREE + 1e-9);
    expect(surface(layout(50, "#0066ff")).n).toBeGreaterThan(6);
    expect(surface(layout(300, "#0066ff")).n).toBeGreaterThan(6);
  });

  it("1 and 2 fixtures are bit-identical to the pre-fix response", () => {
    for (const hex of ["#0066ff", "#ff3366", "#33ff99"]) {
      for (const n of [1, 2]) {
        expect(surface(layout(n, hex)).hdr).toEqual(surface(layout(n, hex), { fix: false }).hdr);
      }
    }
  });

  for (const op of ["aces", "agx", "neutral"]) {
    for (const hex of ["#0066ff", "#ff3366", "#55bfff"]) {
      it(`${op} ${hex}: dense (50, 300) stays bounded and keeps chroma`, () => {
        const one = display(surface(layout(1, hex)).hdr, op);
        for (const n of [50, 300]) {
          const s = surface(layout(n, hex));
          const before = display(surface(layout(n, hex), { fix: false }).hdr, op);
          const after = display(s.hdr, op);
          // Bounded energy: the dense fixture term never exceeds the cap.
          expect(Math.max(...s.fixture)).toBeLessThanOrEqual(DENSE_MAX + 1e-9);
          // Bounded luminance: no brighter than a single fixture at its hottest point.
          expect(luminance(after)).toBeLessThanOrEqual(luminance(one) + 1e-6);
          // Chroma preserved: at least the single-fixture chroma, and better than before.
          expect(chroma(after)).toBeGreaterThanOrEqual(chroma(one) - 1e-6);
          expect(chroma(after)).toBeGreaterThan(chroma(before));
        }
      });
    }
  }

  it("ACES: a dense blue sheet is clearly blue (chroma >= 0.6), not near-white as before", () => {
    const after = display(surface(layout(300, "#0066ff")).hdr, "aces");
    const before = display(surface(layout(300, "#0066ff"), { fix: false }).hdr, "aces");
    expect(chroma(after)).toBeGreaterThanOrEqual(0.6);
    expect(chroma(before)).toBeLessThan(chroma(after));
  });
});

describe("AF-NEXT-013 signal colour decoding", () => {
  it("an {r,g,b} signal colour (sRGB 0..1) equals the same colour given as hex", async () => {
    const THREE = await import("three");
    const { colorFromSignalColor } = await import("../sceneLighting");
    const scene = { THREE };
    const fromObj = colorFromSignalColor(scene, { r: 0x55 / 255, g: 0xbf / 255, b: 1 });
    const fromHex = colorFromSignalColor(scene, "#55bfff");
    expect(fromObj.r).toBeCloseTo(fromHex.r, 6);
    expect(fromObj.g).toBeCloseTo(fromHex.g, 6);
    expect(fromObj.b).toBeCloseTo(fromHex.b, 6);
  });
});
