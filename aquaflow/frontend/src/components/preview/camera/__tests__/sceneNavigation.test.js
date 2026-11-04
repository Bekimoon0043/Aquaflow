import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FountainScene, CAMERA_MODES } from "../../FountainScene_v6";

// The navigation methods on a bare scene object: camera + orbit state, no WebGL.
function navScene({ angle = 0, radius = 12, height = 8, target = { x: 0, y: 3, z: 0 } } = {}) {
  const s = Object.create(FountainScene.prototype);
  Object.assign(s, {
    THREE, camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000),
    canvas: { clientWidth: 1600, clientHeight: 900, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }) },
    cameraMode: CAMERA_MODES.ORBIT, orbitAngle: angle, orbitRadius: radius, orbitHeight: height, orbitTarget: { ...target },
    orbitAuto: false, _poolType: "rect", _poolW: 12, _poolL: 8, userNozzles: [], _navAnim: null,
  });
  return s;
}
const camPos = (s) => ({
  x: s.orbitTarget.x + Math.cos(s.orbitAngle) * s.orbitRadius, y: s.orbitHeight, z: s.orbitTarget.z + Math.sin(s.orbitAngle) * s.orbitRadius,
});
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("3D preview navigation", () => {
  it("wheel zoom toward a pivot is multiplicative, eased, and keeps the pivot on the camera→target line", () => {
    const s = navScene();
    const pivot = { x: 4, y: 0, z: -2 };
    const before = camPos(s);
    s._zoomBy(0.5, pivot);
    s._stepNav(1 / 60);
    const mid = s._orbitDistance();
    expect(mid).toBeLessThan(Math.hypot(12, 5));
    expect(mid).toBeGreaterThan(Math.hypot(12, 5) * 0.5);
    for (let i = 0; i < 120; i++) s._stepNav(1 / 60);
    expect(s._navAnim).toBeNull();
    expect(s._orbitDistance()).toBeCloseTo(Math.hypot(12, 5) * 0.5, 6);
    // Camera and target both moved halfway toward the pivot (scaled about it).
    const after = camPos(s);
    expect(after.x).toBeCloseTo(pivot.x + (before.x - pivot.x) * 0.5, 6);
    expect(after.y).toBeCloseTo(pivot.y + (before.y - pivot.y) * 0.5, 6);
    expect(s.orbitTarget.x).toBeCloseTo(pivot.x + (0 - pivot.x) * 0.5, 6);
  });

  it("successive notches accumulate and respect the site-scaled limits", () => {
    const s = navScene();
    for (let i = 0; i < 80; i++) s._zoomBy(0.88, null);
    s._stepNav(Infinity);
    expect(s._orbitDistance()).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 200; i++) s._zoomBy(1 / 0.88, null);
    s._stepNav(Infinity);
    expect(s._orbitDistance()).toBeCloseTo(s._navBounds().limits.max, 6);
  });

  it("pan moves the pivot and the camera together", () => {
    const s = navScene();
    s.camera.position.set(12, 8, 0); s.camera.lookAt(0, 3, 0);
    const d0 = s._orbitDistance();
    s._panBy(100, 0);
    expect(dist(s.orbitTarget, { x: 0, y: 3, z: 0 })).toBeGreaterThan(0.1);
    expect(s._orbitDistance()).toBeCloseTo(d0, 6);
  });

  it("orbit tilt keeps the distance and never goes under the ground", () => {
    const s = navScene();
    const d0 = s._orbitDistance();
    s._orbitBy(50, -5000);
    expect(s._orbitDistance()).toBeCloseTo(d0, 6);
    expect(s.orbitHeight).toBeGreaterThanOrEqual(0.15 - 1e-9);
    s._orbitBy(0, 5000);
    expect(s.orbitRadius).toBeGreaterThan(0);
  });

  it("frame all flies to a view that fits the whole site, including far fixtures", () => {
    const s = navScene({ radius: 3, height: 4 });
    s.userNozzles = [{ x: 30, z: 0, designHeightM: 12 }];
    s.frameAll();
    s._stepNav(Infinity);
    expect(s.orbitTarget.x).toBeGreaterThan(5);
    expect(s._orbitDistance()).toBeGreaterThan(30);
  });

  it("taking over from a fixed view continues from the current camera, without a jump", () => {
    const s = navScene();
    s.cameraMode = CAMERA_MODES.FRONT;
    s.camera.position.set(0, 5, 17); s.camera.lookAt(0, 4, 0);
    s._takeOverCamera();
    expect(s.cameraMode).toBe(CAMERA_MODES.ORBIT);
    const p = camPos(s);
    expect(dist(p, { x: 0, y: 5, z: 17 })).toBeLessThan(1e-6);
  });
});
