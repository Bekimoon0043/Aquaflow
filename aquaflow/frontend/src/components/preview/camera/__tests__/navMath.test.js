import { describe, expect, it } from "vitest";
import {
  ZOOM_IN, clampDistance, dampTo, distanceLimits, frameBounds, rayPlaneY, scaleAbout, siteBounds, wheelNotches, zoomStep,
} from "../navMath";

describe("wheel and zoom", () => {
  it("normalises pixel, line and page deltas to notches", () => {
    expect(wheelNotches(100, 0)).toBeCloseTo(1);
    expect(wheelNotches(3, 1)).toBeCloseTo(1);
    expect(wheelNotches(-1, 2)).toBeCloseTo(-3);
    expect(wheelNotches(4, 0)).toBeCloseTo(0.04);
    expect(wheelNotches(10000, 0)).toBe(5);
  });
  it("zoom is multiplicative: one notch in then out returns to the same distance", () => {
    expect(zoomStep(-1)).toBeCloseTo(ZOOM_IN);
    expect(zoomStep(-1) * zoomStep(1)).toBeCloseTo(1);
    expect(20 * zoomStep(-1)).toBeCloseTo(17.6);
    expect(zoomStep(0.5) * zoomStep(0.5)).toBeCloseTo(zoomStep(1));
  });
  it("limits scale with the site", () => {
    expect(distanceLimits(3)).toEqual({ min: 0.5, max: 40 });
    expect(distanceLimits(30).max).toBe(180);
    expect(clampDistance(0.1)).toBe(0.5);
    expect(clampDistance(500, { max: 180 })).toBe(180);
  });
});

describe("damping", () => {
  it("is frame-rate independent", () => {
    let a = 0, b = 0;
    for (let i = 0; i < 60; i++) a = dampTo(a, 10, 12, 1 / 60);
    for (let i = 0; i < 24; i++) b = dampTo(b, 10, 12, 1 / 24);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeGreaterThan(9.99);
  });
  it("never overshoots", () => expect(dampTo(0, 10, 1000, 1)).toBeCloseTo(10));
});

describe("geometry", () => {
  it("scaling about the cursor point keeps that point fixed and moves camera and target together", () => {
    const P = { x: 5, y: 0, z: 2 };
    expect(scaleAbout(P, P, 0.5)).toEqual(P);
    expect(scaleAbout({ x: 15, y: 10, z: 2 }, P, 0.5)).toEqual({ x: 10, y: 5, z: 2 });
  });
  it("site bounds cover the basin and the fixtures", () => {
    const b = siteBounds({ poolType: "rect", width: 12, length: 8 }, [{ x: 20, z: 0, h: 9 }]);
    expect(b.min.x).toBe(-6); expect(b.max.x).toBe(20); expect(b.max.y).toBe(9);
    expect(b.center.x).toBe(7);
    expect(siteBounds({ poolType: "circular", radius: 10 }).radius).toBeGreaterThan(14);
  });
  it("frame all puts the camera far enough for the whole site", () => {
    const b = siteBounds({ width: 12, length: 8 });
    const f = frameBounds(b, 50, 16 / 9);
    expect(f.target).toEqual(b.center);
    expect(f.distance).toBeGreaterThan(b.radius / Math.sin((25 * Math.PI) / 180));
    const d = Math.hypot(f.position.x - f.target.x, f.position.y - f.target.y, f.position.z - f.target.z);
    expect(d).toBeCloseTo(f.distance, 6);
    expect(frameBounds(b, 50, 0.5).distance).toBeGreaterThan(f.distance);
  });
  it("ray hits the ground plane in front of the camera only", () => {
    expect(rayPlaneY({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(rayPlaneY({ x: 0, y: 10, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
    expect(rayPlaneY({ x: 0, y: 10, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
  });
});
