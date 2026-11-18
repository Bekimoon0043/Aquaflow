import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../equipmentAssets", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadEquipmentAsset: vi.fn(async () => {
      const template = new THREE.Group();
      const head = new THREE.Object3D();
      const socket = new THREE.Object3D();
      socket.name = "LaserSocket";
      socket.position.y = 0.2;
      head.add(socket);
      template.add(head);
      return { id: "equipment:laser-projector", template };
    }),
  };
});

import { LaserScene } from "../laserScene.js";

describe("laser projector GLB", () => {
  it("loads the projector, aligns its aperture and reports the asset", async () => {
    const parent = new THREE.Scene();
    const scene = new LaserScene(THREE, parent);
    scene.setFixtures([{ id: "laser-1", x: 2, y: 0.5, z: -1, rotation: 0, engineering: {} }]);
    await vi.waitFor(() => expect(scene.getAssetStatus().loaded).toBe(1));
    const root = scene._projectors.get("laser-1");
    expect(root.position.x).toBe(2);
    expect(root.position.y).toBeCloseTo(0.3);
    expect(root.position.z).toBe(-1);
    expect(root.userData.nodeId).toBe("laser-1");
    expect(parent.children).toContain(scene.bodies);
    scene.update({ "laser-1": { channels: { laser_intensity: 1 } } }, 0, { haze: 0.5 });
    expect(scene.stats.beams).toBeGreaterThan(0);
    scene.dispose();
    expect(parent.children).not.toContain(scene.bodies);
  });
});
