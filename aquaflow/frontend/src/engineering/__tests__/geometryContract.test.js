/**
 * geometryContract.test.js — AF-HUB-003 geometry / axis contract.
 *
 * Proves the GATE: a fixture placed in the designer lands at the same world position
 * in the 3D preview, and a RECTANGULAR and a CIRCULAR pool use the SAME contract —
 * pool centered on the world origin, worldX = engX - cx, worldZ = engY - cy.
 */
import { describe, it, expect } from "vitest";
import {
  poolCenter, poolBounds, engineeringToWorld, worldToEngineering,
  centerToWorld, fixturePlanCoords, AXIS_CONTRACT,
} from "../geometryContract.js";

describe("axis contract (engineering y → world z)", () => {
  it("fixturePlanCoords maps engineering (x,y) to plan/world (x, z=y)", () => {
    expect(fixturePlanCoords({ x: 3, y: -2 })).toEqual({ x: 3, z: -2 });
  });
  it("engineeringToWorld with no center is the raw axis flip", () => {
    expect(engineeringToWorld({ x: 3, y: 5 })).toEqual({ x: 3, z: 5 });
  });
  it("worldToEngineering exactly reverses centering and preserves height", () => {
    const center = { cx: 6, cy: 4 };
    const world = { x: 2, y: 0.35, z: -1 };
    expect(worldToEngineering(world, center)).toEqual({ x: 8, y: 3, z: 0.35 });
    expect(engineeringToWorld(worldToEngineering(world, center), center))
      .toEqual({ x: 2, z: -1 });
  });
  it("AXIS_CONTRACT documents z === engineering y", () => {
    expect(AXIS_CONTRACT.world).toMatch(/z === engineering y/);
  });
});

describe("poolCenter is one rule for every shape", () => {
  it("circle / ellipse use the stored center", () => {
    expect(poolCenter({ type: "circle", center: { x: 5, y: 3 }, radius: 4 })).toEqual({ cx: 5, cy: 3 });
    expect(poolCenter({ type: "ellipse", center: { x: 2, y: 1 }, rx: 6, ry: 4 })).toEqual({ cx: 2, cy: 1 });
  });
  it("polygon (rectangle) uses the bounding-box center", () => {
    const rect = { type: "rectangle", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }] };
    expect(poolCenter(rect)).toEqual({ cx: 5, cy: 4 });
  });
  it("no geometry derives from params by pool type", () => {
    expect(poolCenter(null, { width: 12, length: 8 }, "rectangular")).toEqual({ cx: 6, cy: 4 });
    expect(poolCenter(null, { radius: 6 }, "circular")).toEqual({ cx: 0, cy: 0 });
  });
});

describe("GATE — rectangle and circle place a fixture at the same world position", () => {
  // A rectangular pool (0,0)-(10,8): center (5,4).
  const rect = { type: "rectangle", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }] };
  // A circular pool centered at (5,4), radius 4 — same center as the rectangle.
  const circle = { type: "circle", center: { x: 5, y: 4 }, radius: 4 };

  it("a fixture AT the pool center maps to the world origin for both shapes", () => {
    const atCenter = { x: 5, y: 4 };
    expect(engineeringToWorld(atCenter, poolCenter(rect))).toEqual({ x: 0, z: 0 });
    expect(engineeringToWorld(atCenter, poolCenter(circle))).toEqual({ x: 0, z: 0 });
  });

  it("a fixture offset from center maps to the SAME world point in rect and circle", () => {
    const fixture = { x: 7, y: 5 }; // +2 in x, +1 in y (depth) from the shared center (5,4)
    const inRect = engineeringToWorld(fixture, poolCenter(rect));
    const inCircle = engineeringToWorld(fixture, poolCenter(circle));
    expect(inRect).toEqual({ x: 2, z: 1 });
    expect(inCircle).toEqual({ x: 2, z: 1 });
    expect(inRect).toEqual(inCircle); // identical contract
  });

  it("centerToWorld shifts an already-projected {x,z} config identically", () => {
    // fixturesToNozzleConfigs produces {x, z}; the sync shifts it by the pool center.
    const projected = { id: "n1", x: 7, z: 5, groupId: "center_jets" };
    expect(centerToWorld(projected, poolCenter(rect))).toMatchObject({ x: 2, z: 1, groupId: "center_jets" });
  });
});

describe("poolBounds delegates to the same center rule", () => {
  it("circle bounds are center ± radius", () => {
    expect(poolBounds({ type: "circle", center: { x: 0, y: 0 }, radius: 6 }))
      .toMatchObject({ minX: -6, maxX: 6, minY: -6, maxY: 6, cx: 0, cy: 0, radius: 6 });
  });
  it("rectangle bounds bbox + center agree with poolCenter", () => {
    const rect = { type: "rectangle", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }] };
    const b = poolBounds(rect);
    expect(b).toMatchObject({ minX: 0, maxX: 10, minY: 0, maxY: 8, cx: 5, cy: 4 });
    expect({ cx: b.cx, cy: b.cy }).toEqual(poolCenter(rect));
  });
});
