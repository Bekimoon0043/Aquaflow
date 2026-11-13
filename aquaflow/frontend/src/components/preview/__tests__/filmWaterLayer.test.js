import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FilmWaterLayer } from "../filmWaterLayer.js";

describe("FilmWaterLayer scene integration", () => {
  it("creates visible, finite bell geometry", () => {
    const scene = new THREE.Scene();
    const layer = new FilmWaterLayer(THREE, scene);
    const config = { id: "bell", fixtureType: "nozzle_mushroom_g2_saferain", type: "ring", advancedNozzleModel: true, x: 0, z: 0, engineering: {} };
    layer.update([{ config, intensity: 1 }], 0.5, new THREE.PerspectiveCamera());
    expect(layer.entries.size).toBe(1);
    const entry = layer.entries.get("bell");
    expect(entry.mesh.visible).toBe(true);
    const positions = entry.geometry.attributes.position;
    expect(positions.count).toBeGreaterThan(100);
    expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    expect(Math.max(...positions.array.filter((_, index) => index % 3 === 1))).toBeGreaterThan(0);
    expect(Math.max(...positions.array.filter((_, index) => index % 3 === 0))).toBeGreaterThan(1);
    layer.dispose();
  });

  it("keeps the film alive after several seconds", () => {
    const scene = new THREE.Scene();
    const layer = new FilmWaterLayer(THREE, scene);
    const config = { id: "bell", fixtureType: "nozzle_mushroom_g2_saferain", advancedNozzleModel: true, x: 0, z: 0, engineering: {} };
    layer.update([{ config, intensity: 1 }], 12);
    const entry = layer.entries.get("bell");
    expect(entry.mesh.visible).toBe(true);
    const positions = entry.geometry.attributes.position.array;
    expect(Array.from(positions).every(Number.isFinite)).toBe(true);
    expect(Math.max(...positions.filter((_, index) => index % 3 === 1))).toBeGreaterThan(0);
    layer.dispose();
  });

  it("starts a cascade at its actual fall height", () => {
    const scene = new THREE.Scene();
    const layer = new FilmWaterLayer(THREE, scene);
    const config = { id: "fall", fixtureType: "nozzle_cascade_curtain", advancedNozzleModel: true, x: 0, z: 0,
      engineering: { fallHeightM: 3 } };
    layer.update([{ config, intensity: 1 }], 0);
    const positions = layer.entries.get("fall").geometry.attributes.position.array;
    expect(Math.max(...positions.filter((_, index) => index % 3 === 1))).toBeGreaterThan(2.5);
    layer.dispose();
  });

  it("removes film entries when a fixture disappears", () => {
    const scene = new THREE.Scene();
    const layer = new FilmWaterLayer(THREE, scene);
    const config = { id: "bell", fixtureType: "nozzle_mushroom_g2_saferain", advancedNozzleModel: true, x: 0, z: 0, engineering: {} };
    layer.update([{ config, intensity: 1 }], 0.5);
    layer.update([], 0.6);
    expect(layer.entries.size).toBe(0);
    layer.dispose();
  });
});
