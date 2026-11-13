import { describe, expect, it } from "vitest";
import { advanceBallistic, collideWaterPlane, collideArchitecturalPlane, collideAxisAlignedBox, findFirstCollision, recommendSecondaryEvents } from "../collisionModels.js";

describe("collision models", () => {
  it("advances constant-acceleration trajectories", () => {
    const result = advanceBallistic([0, 0, 0], [1, 2, 3], 2);
    expect(result.position[1]).toBeCloseTo(-15.62, 8);
    expect(result.velocity[1]).toBeCloseTo(2 - 9.81 * 2, 8);
  });

  it("finds a downward water-plane impact and rejects out-of-bounds hits", () => {
    const hit = collideWaterPlane([0, 2, 0], [1, -2, 0], { y: 0 });
    expect(hit.type).toBe("water");
    expect(hit.position[1]).toBe(0);
    expect(hit.normal).toEqual([0, 1, 0]);
    expect(hit.secondaryEvents.some((event) => event.type === "splash")).toBe(true);
    expect(collideWaterPlane([0, 2, 0], [10, -2, 0], { y: 0, minX: -1, maxX: 1 })).toBeNull();
  });

  it("collides with architectural planes only when approaching", () => {
    const plane = { axis: "z", offset: 0, normal: [0, 0, -1], doubleSided: false };
    expect(collideArchitecturalPlane([0, 0, -2], [0, 0, 2], plane)).toBeTruthy();
    expect(collideArchitecturalPlane([0, 0, 2], [0, 0, -2], plane)).toBeNull();
  });

  it("returns the entered box face and speed", () => {
    const hit = collideAxisAlignedBox([0, 2, 0], [0, -2, 0], { center: [0, 0, 0], size: [2, 2, 2] });
    expect(hit.position[1]).toBeCloseTo(1, 8);
    expect(hit.normal).toEqual([0, 1, 0]);
    expect(hit.incomingSpeedMs).toBeGreaterThan(0);
  });

  it("chooses the earliest collision across surfaces", () => {
    const hit = findFirstCollision([0, 2, 0], [0, -2, 0], [
      { type: "water", y: -2 },
      { type: "water", y: 0 },
    ]);
    expect(hit.position[1]).toBe(0);
  });

  it("recommends water impacts and architectural runoff separately", () => {
    const water = recommendSecondaryEvents({ type: "water", position: [0, 0, 0], normal: [0, 1, 0], velocity: [0, -6, 0] });
    expect(water.map((event) => event.type)).toContain("foam");
    expect(water.map((event) => event.type)).toContain("mist");
    const wall = recommendSecondaryEvents({ type: "plane", position: [0, 0, 0], normal: [0, 0, 1], velocity: [2, -4, 0] });
    expect(wall.map((event) => event.type)).toContain("surface-film");
    expect(wall.map((event) => event.type)).toContain("runoff");
  });
});
