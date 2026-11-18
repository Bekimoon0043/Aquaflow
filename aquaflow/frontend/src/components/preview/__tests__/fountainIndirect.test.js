import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildFountainIndirect } from "../fountainIndirect.js";
import { FountainIndirectLights } from "../fountainIndirect3D.js";

const lights = [
  { id: "light-a", x: 0, y: 0, z: 0, radius: 5, intensity: 4, color: "#0066ff", pairedNozzleId: "jet-a" },
  { id: "light-b", x: 5, y: 0, z: 0, radius: 2, intensity: 2, color: { r: 1, g: 0, b: 0 } },
];
const jets = [
  { id: "jet-a", groupId: "ring", x: 0, z: 0, designHeightM: 4, runtimeIntensity: 1 },
  { id: "jet-b", groupId: "ring", x: 0.5, z: 0, designHeightM: 4, runtimeIntensity: 0.5 },
  { id: "jet-off", groupId: "ring", x: 1, z: 0, designHeightM: 4, runtimeIntensity: 0 },
];

describe("fountain indirect approximation", () => {
  it("clusters illuminated jets into a weighted virtual emitter", () => {
    const result = buildFountainIndirect(jets, lights);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ approximation: "virtual-point-cluster", x: 1 / 6, y: 1.8, z: 0, intensity: 0.24 });
    expect(result[0].sourceNozzleIds).toEqual(["jet-a", "jet-b"]);
    expect(result[0].color.b).toBeCloseTo(1, 6);
  });

  it("uses a nearby unpaired light and caps emitter count", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `jet-${i}`, groupId: `g${i}`, x: i * 20, z: 0, runtimeIntensity: 1 }));
    const broad = [{ id: "broad", x: 100, y: 0, z: 0, radius: 500, intensity: 1, color: { r: 1, g: 1, b: 1 } }];
    const result = buildFountainIndirect(many, broad, { maxEmitters: 3 });
    expect(result).toHaveLength(3);
    expect(result[0].sourceNozzleIds.length).toBeGreaterThan(0);
  });

  it("returns no indirect emitters for unlit or inactive water", () => {
    expect(buildFountainIndirect(jets, [])).toEqual([]);
    expect(buildFountainIndirect([jets[2]], lights)).toEqual([]);
  });

  it("can disable the approximation without affecting the fixture lights", () => {
    const layer = new FountainIndirectLights(THREE, new THREE.Scene());
    layer.update(jets, lights, "high", false);
    expect(layer.lights.every(light => !light.visible && light.intensity === 0)).toBe(true);
    layer.update(jets, lights, "high", true);
    expect(layer.lights.some(light => light.visible && light.intensity > 0)).toBe(true);
    layer.dispose();
  });

  it("is deterministic", () => {
    expect(buildFountainIndirect(jets, lights)).toEqual(buildFountainIndirect(jets, lights));
  });
});
