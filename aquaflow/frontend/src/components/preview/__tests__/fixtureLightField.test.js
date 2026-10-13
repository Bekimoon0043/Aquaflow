import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  FixtureLightField, encodeLight, lightContribution, buildClusters, clusteredLight,
  bindFieldLightUniforms, FIELD_LIGHT_GLSL, MAX_FIXTURE_LIGHTS, CLUSTER_K, HG_G,
} from "../fixtureLightField";
import { billboardFrag, buildBillboardMaterial } from "../particlesBillboard";
import { CORE_FRAG, WATER_FRAG_V2 } from "../sceneShaders";

const white = { r: 1, g: 1, b: 1 };
const up = { x: 0, y: 1, z: 0 };
const lum = c => c[0] + c[1] + c[2];

describe("fixture light model (AF-3D-022)", () => {
  const L = encodeLight({ x: 0, z: 0, color: white, intensity: 4, radius: 6 });

  it("cone falloff: lit on the beam axis, dark well outside the cone", () => {
    expect(lum(lightContribution(L, { x: 0, y: 3, z: 0 }, up))).toBeGreaterThan(0);
    expect(lum(lightContribution(L, { x: 3, y: 0.3, z: 0 }, up))).toBe(0);
  });

  it("distance attenuation: further along the beam is dimmer, past range is zero", () => {
    const near = lum(lightContribution(L, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }));
    const far = lum(lightContribution(L, { x: 0, y: 8, z: 0 }, { x: 1, y: 0, z: 0 }));
    expect(near).toBeGreaterThan(far);
    expect(lum(lightContribution(L, { x: 0, y: L.range + 0.01, z: 0 }, up))).toBe(0);
  });

  it("Henyey-Greenstein: forward scattering toward the camera is brighter than back", () => {
    const p = { x: 0, y: 2, z: 0 };
    const fwd = lum(lightContribution(L, p, { x: 0, y: 1, z: 0 }));     // camera above, looking down the beam
    const side = lum(lightContribution(L, p, { x: 1, y: 0, z: 0 }));
    const back = lum(lightContribution(L, p, { x: 0, y: -1, z: 0 }));
    expect(fwd).toBeGreaterThan(side);
    expect(side).toBeGreaterThan(back);
    expect(HG_G).toBeCloseTo(0.6, 5);
  });

  it("outputs HDR (> 1) in a bright beam, so bloom picks it up", () => {
    const c = lightContribution(L, { x: 0, y: 0.8, z: 0 }, up);
    expect(Math.max(...c)).toBeGreaterThan(1);
  });

  it("tilt leans the beam axis", () => {
    const tilted = encodeLight({ x: 0, z: 0, color: white, intensity: 4, radius: 6, tiltX: 30 });
    expect(tilted.az).toBeCloseTo(0.5, 3);
    expect(tilted.ay).toBeCloseTo(Math.sqrt(3) / 2, 3);
  });
});

describe("clustered light texture", () => {
  const grid = (n, spacing = 1.2) => Array.from({ length: n }, (_, i) => ({
    id: `L${i}`, x: (i % 20) * spacing - 12, z: Math.floor(i / 20) * spacing - 9,
    color: { r: (i % 3) / 2, g: 0.5, b: 1 }, intensity: 2, radius: 2,
  }));

  it("carries >= 256 fixtures (300 here), far past the old 16", () => {
    const field = new FixtureLightField(THREE);
    field.setLights(grid(300));
    expect(field.count).toBe(300);
    expect(field.uniforms.uFieldCount.value).toBe(300);
    expect(MAX_FIXTURE_LIGHTS).toBeGreaterThanOrEqual(256);
    // Fixture #299 is really in the texture (row 0 = position).
    const W = field.maxLights;
    expect(field.lightData[299 * 4]).toBeCloseTo(grid(300)[299].x, 5);
    expect(field.lightData[(2 * W + 299) * 4 + 2]).toBeGreaterThan(0);   // colour row
    field.dispose();
  });

  const brute = (enc, p, cam, coneW = 1) => enc.reduce((a, e) => {
    const c = lightContribution(e, p, cam, HG_G, coneW);
    return [a[0] + c[0], a[1] + c[1], a[2] + c[2]];
  }, [0, 0, 0]);
  const probe = i => ({ x: -14 + ((i * 0.618) % 1) * 40, y: 0.5 + (i % 7), z: -12 + ((i * 0.7548) % 1) * 30 });

  it("cluster lookup equals brute force when no cell overflows K", () => {
    const enc = grid(300, 3).map(l => encodeLight({ ...l, radius: 0.9 }));
    const cl = buildClusters(enc);
    expect(cl.maxPerCell).toBeLessThanOrEqual(CLUSTER_K);
    expect(cl.dropped).toBe(0);
    for (let i = 0; i < 400; i++) {
      const p = probe(i), cam = { x: 0, y: 0, z: 1 };
      const want = brute(enc, p, cam), got = clusteredLight(enc, cl, p, cam);
      for (let c = 0; c < 3; c++) expect(got[c]).toBeCloseTo(want[c], 9);
    }
  });

  it("a dense 300-fixture field keeps the K nearest and nearly all the beam energy", () => {
    const enc = grid(300, 1.2).map(encodeLight);     // default 6 m radius: heavy overlap
    const cl = buildClusters(enc);
    expect(cl.maxPerCell).toBeGreaterThan(CLUSTER_K);   // the case clustering exists for
    let want = 0, got = 0;
    for (let i = 0; i < 400; i++) {
      const p = probe(i), cam = { x: 0, y: 0, z: 1 };
      want += lum(brute(enc, p, cam));
      got += lum(clusteredLight(enc, cl, p, cam));
    }
    expect(got).toBeLessThanOrEqual(want + 1e-9);
    expect(got / want).toBeGreaterThan(0.85);
  });

  it("only rebuilds clusters when a fixture moves, not when its colour changes", () => {
    const field = new FixtureLightField(THREE);
    const lights = grid(40);
    field.setLights(lights);
    const first = field.clusters;
    lights[3].intensity = 0.1;
    lights[3].color = { r: 1, g: 0, b: 0 };
    field.setLights(lights);
    expect(field.clusters).toBe(first);
    lights[3].x += 2;
    field.setLights(lights);
    expect(field.clusters).not.toBe(first);
    field.dispose();
  });

  it("shares uniform objects (not copies) with every bound material", () => {
    const field = new FixtureLightField(THREE);
    const mat = buildBillboardMaterial(THREE, {});
    bindFieldLightUniforms(mat.uniforms, field);
    expect(mat.uniforms.uLightTex).toBe(field.uniforms.uLightTex);
    expect(mat.uniforms.uFieldCount).toBe(field.uniforms.uFieldCount);
    field.dispose();
    mat.dispose();
  });
});

describe("shaders no longer bake a fixture cap", () => {
  it("particle, core and water shaders use the light texture", () => {
    for (const src of [billboardFrag(), CORE_FRAG, WATER_FRAG_V2]) {
      expect(src).not.toMatch(/uFieldPos|uFieldRad/);
      expect(src).not.toMatch(/\$\{/);
    }
    expect(CORE_FRAG).toContain("fieldLight(");
    expect(WATER_FRAG_V2).toContain("fieldLight(");
    expect(FIELD_LIGHT_GLSL).toContain("uniform sampler2D uLightTex");
    expect(buildBillboardMaterial(THREE, {}).vertexShader).toContain("particleFieldLight(");
  });
});
