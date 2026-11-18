import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyModelOutlets, equipmentAssetForEngineeringType, equipmentAssetForKind, socketWorld } from "../equipmentAssets.js";

describe("original equipment assets", () => {
  it("maps every generated visual fixture and the hydraulic equipment", () => {
    for (const kind of ["jet", "geyser", "laminar", "fan_jet", "pirouette", "motion", "light", "laser", "flame"]) {
      expect(equipmentAssetForKind(kind)?.file).toMatch(/^\/models\/equipment\/.+\.glb$/);
    }
    expect(equipmentAssetForEngineeringType("pump_inline_vfd_18kw")?.id).toBe("equipment:pump-centrifugal");
    expect(equipmentAssetForEngineeringType("valve_solenoid_dn25")?.id).toBe("equipment:valve-solenoid-dn25");
    expect(equipmentAssetForEngineeringType("manifold_4way")?.id).toBe("equipment:manifold-4way");
    expect(equipmentAssetForEngineeringType("sensor_water_level")).toBeNull();
  });

  it("reads a socket position and direction in world space", () => {
    const root = new THREE.Group();
    const socket = new THREE.Object3D();
    socket.name = "NozzleSocket";
    socket.position.set(0, 0.3, 0);
    root.add(socket);
    root.position.set(2, 1, -1);
    root.rotation.z = Math.PI / 2;
    const result = socketWorld(THREE, root, "NozzleSocket");
    expect(result.position[0]).toBeCloseTo(1.7);
    expect(result.position[1]).toBeCloseTo(1);
    expect(result.position[2]).toBeCloseTo(-1);
    expect(result.direction[0]).toBeCloseTo(-1);
    expect(result.direction[1]).toBeCloseTo(0, 6);
  });

  it("moves emitters to model sockets without changing their physical speed", () => {
    const emitters = [{ mode: 0, ox: 0, oy: 0.08, oz: 0, dx: 0, dy: 1, dz: 0, speed: 9 }, { mode: 2, speed: 4 }];
    const cfg = { modelOutlet: { position: [1, 0.3, -2], direction: [1, 0, 0] } };
    const result = applyModelOutlets(emitters, cfg);
    expect(result[0]).toMatchObject({ ox: 1, oy: 0.3, oz: -2, dx: 1, dy: 0, speed: 9 });
    expect(result[1].speed).toBe(4);
    expect(emitters[0].oy).toBe(0.08);
  });
});
