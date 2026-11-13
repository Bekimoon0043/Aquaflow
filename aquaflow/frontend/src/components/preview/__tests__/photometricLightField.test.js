import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FixtureLightField, encodeLight, lightContribution } from "../fixtureLightField.js";

const light = () => ({
  x: 0, y: 0, z: 0, aimDir: [0, 1, 0], color: { r: 1, g: 1, b: 1 }, intensity: 2, radius: 8,
  photometry: {
    enabled: true, fluxLm: 4000,
    profile: { candelaAt: (angle) => angle < 45 ? 2 : 1 },
  },
});

describe("photometric light field", () => {
  it("uses physical flux only when explicitly enabled", () => {
    const encoded = encodeLight(light());
    expect(encoded.photometric.enabled).toBe(true);
    expect(encoded.r).toBeCloseTo(1 / Math.PI, 8);
    expect(encoded.photometric.curve[0]).toBe(1);
    expect(encoded.photometric.curve[31]).toBe(0.5);
    const legacy = encodeLight({ ...light(), photometry: { enabled: false, fluxLm: 4000 } });
    expect(legacy.r).toBeCloseTo(3.42, 8);
  });

  it("samples angular intensity in the CPU mirror", () => {
    const encoded = encodeLight(light());
    const center = lightContribution(encoded, { x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 });
    const side = lightContribution(encoded, { x: 2, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(center[0]).toBeGreaterThan(side[0]);
    expect(encoded.photometric.curve[31]).toBe(0.5);
  });

  it("uploads profile samples and enable flags to the IES texture", () => {
    const field = new FixtureLightField(THREE);
    field.setLights([light()]);
    expect(field.iesData[0]).toBe(1);
    expect(field.iesData[1]).toBe(1);
    expect(field.iesData[31 * 4]).toBe(0.5);
    expect(field.iesData[31 * 4 + 1]).toBe(1);
    expect(field.iesTex.image.width).toBe(1024);
    expect(field.iesTex.image.height).toBe(32);
    expect(field.uniforms.uIesSize.value.toArray()).toEqual([1024, 32]);
    field.dispose();
  });
});
