import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FixtureInstances, fixtureKindFor } from "../fixtureModels.js";

describe("GLB fixture pivots and placement", () => {
  it("uses the basket model for pirouette nozzles", () => {
    expect(fixtureKindFor("pirouette")).toBe("pirouette");
    expect(fixtureKindFor("motion_2d")).toBe("motion");
  });

  it("animates the robotic pivots and reads the resulting water socket", () => {
    const fixtures = new FixtureInstances(THREE);
    const root = new THREE.Group();
    const base = new THREE.Object3D();
    const pan = new THREE.Object3D(); pan.name = "Pan_Z"; pan.position.y = 0.212;
    const tilt = new THREE.Object3D(); tilt.name = "Tilt_X"; tilt.position.y = 0.153;
    const socket = new THREE.Object3D(); socket.name = "NozzleSocket"; socket.position.y = 0.185;
    root.add(base); base.add(pan); pan.add(tilt); tilt.add(socket);
    root.position.set(2, 1, 0);
    fixtures._assetGroups.set("robot", { root, kind: "motion" });
    const config = { id: "robot", type: "motion_2d", motionOverride: { pan: 45, tilt: 30 } };
    fixtures.animate([config], 1);
    expect(pan.rotation.y).toBeCloseTo(Math.PI / 6);
    expect(tilt.rotation.x).toBeCloseTo(Math.PI / 4);
    expect(config.modelOutlet.position).toHaveLength(3);
    expect(Math.hypot(...config.modelOutlet.direction)).toBeCloseTo(1);
    expect(fixtures.getAssetStatus().loaded).toBe(1);
    fixtures.dispose();
  });

  it("spins a three-outlet basket from the engineering RPM", () => {
    const fixtures = new FixtureInstances(THREE);
    const root = new THREE.Group();
    const rotor = new THREE.Object3D(); rotor.name = "Rotor_Z";
    root.add(rotor);
    for (let i = 1; i <= 3; i++) {
      const outlet = new THREE.Object3D(); outlet.name = `Outlet_${i}`; outlet.position.y = 0.3;
      rotor.add(outlet);
    }
    fixtures._assetGroups.set("basket", { root, kind: "pirouette" });
    const config = { id: "basket", engineering: { rotationRpm: 60 } };
    fixtures.animate([config], 0.5);
    expect(rotor.rotation.y).toBeCloseTo(Math.PI);
    expect(config.modelOutlets).toHaveLength(3);
    fixtures.dispose();
  });
});
