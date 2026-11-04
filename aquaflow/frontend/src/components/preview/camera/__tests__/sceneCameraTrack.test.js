import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { FountainScene, CAMERA_MODES } from "../../FountainScene_v6";
import { normalizeCameraTrack, sampleCameraTrack } from "../cameraTrack";

const track = normalizeCameraTrack({ keys: [
  { t: 0, position: { x: 20, y: 6, z: 0 }, target: { x: 0, y: 2, z: 0 }, fov: 50 },
  { t: 5, position: { x: 0, y: 10, z: 20 }, target: { x: 1, y: 3, z: 0 }, fov: 30, roll: 12 },
  { t: 10, position: { x: -20, y: 6, z: 0 }, target: { x: 0, y: 2, z: 0 }, fov: 40, roll: 12 },
] });

function trackScene() {
  const s = Object.create(FountainScene.prototype);
  Object.assign(s, {
    THREE, camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000),
    cameraMode: CAMERA_MODES.ANIMATED, _cameraTrack: track, _cameraTime: 0,
    orbitAngle: 0, orbitRadius: 12, orbitHeight: 8, orbitTarget: { x: 0, y: 3, z: 0 }, orbitAuto: false, userNozzles: [], _navAnim: null,
  });
  return s;
}

describe("animated camera in the scene", () => {
  it("at any show time equals sampleCameraTrack, on the same clock the bake sets", () => {
    const s = trackScene();
    for (const t of [0, 1.25, 3.5, 5, 7.75, 10, 12]) {
      s._cameraTime = t;
      s._updateCamera(1 / 24);
      const f = sampleCameraTrack(track, t);
      expect(s.camera.position.x).toBeCloseTo(f.position.x, 6);
      expect(s.camera.position.y).toBeCloseTo(f.position.y, 6);
      expect(s.camera.position.z).toBeCloseTo(f.position.z, 6);
      expect(s.camera.fov).toBeCloseTo(f.fov, 2);
      const dir = new THREE.Vector3(); s.camera.getWorldDirection(dir);
      const want = new THREE.Vector3(f.target.x - f.position.x, f.target.y - f.position.y, f.target.z - f.position.z).normalize();
      expect(dir.dot(want)).toBeCloseTo(1, 5);
    }
  });

  it("Keep horizon level ignores key roll; turning it off applies it", () => {
    const s = trackScene();
    s._cameraTime = 5;
    s._updateCamera(1 / 24);
    const level = s.camera.quaternion.clone();
    s.setHorizonLock(false);
    s._updateCamera(1 / 24);
    expect(s.camera.quaternion.angleTo(level)).toBeCloseTo((12 * Math.PI) / 180, 4);
    s.setHorizonLock(true);
    s._updateCamera(1 / 24);
    expect(s.camera.quaternion.angleTo(level)).toBeCloseTo(0, 5);
  });

  it("taking over reports leaving the track and continues from the same view", () => {
    const s = trackScene();
    s._cameraTime = 2.5;
    s._updateCamera(1 / 24);
    const at = s.camera.position.clone();
    s.onLeaveCameraTrack = vi.fn();
    s._takeOverCamera();
    expect(s.onLeaveCameraTrack).toHaveBeenCalledTimes(1);
    expect(s.cameraMode).toBe(CAMERA_MODES.ORBIT);
    s._updateCamera(1 / 60);
    expect(s.camera.position.distanceTo(at)).toBeLessThan(1e-6);
  });

  it("flyToView targets a saved view and sets its lens", () => {
    const s = trackScene();
    s.cameraMode = CAMERA_MODES.ORBIT;
    s.flyToView({ position: { x: 3, y: 9, z: 4 }, target: { x: 0, y: 1, z: 0 }, fov: 28 });
    expect(s.camera.fov).toBe(28);
    for (let i = 0; i < 400; i++) s._stepNav(1 / 60);
    s._updateCamera(0);
    expect(s.camera.position.distanceTo(new THREE.Vector3(3, 9, 4))).toBeLessThan(1e-2);
  });
});
