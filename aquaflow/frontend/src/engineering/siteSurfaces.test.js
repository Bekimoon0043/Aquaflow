import { describe, expect, it } from "vitest";
import {
  dedupeSurfacePoints,
  moveSurface,
  pointInSurface,
  surfaceMetrics,
  toPreviewSiteSurfaces,
  updateSurfaceVertex,
} from "./siteSurfaces";

const square = { id: "lawn", type: "grass", points: [
  { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 },
] };

describe("site surface geometry", () => {
  it("measures and hit-tests a closed polygon", () => {
    expect(surfaceMetrics(square.points)).toEqual({ area: 12, perimeter: 14 });
    expect(pointInSurface({ x: 2, y: 1 }, square)).toBe(true);
    expect(pointInSurface({ x: 6, y: 1 }, square)).toBe(false);
  });

  it("moves a polygon and edits one vertex without mutating the source", () => {
    const moved = moveSurface(square, 2, -1);
    const edited = updateSurfaceVertex(square, 1, { x: 5, y: 0 });
    expect(moved.points[0]).toEqual({ x: 2, y: -1 });
    expect(edited.points[1]).toEqual({ x: 5, y: 0 });
    expect(square.points[1]).toEqual({ x: 4, y: 0 });
  });

  it("centers engineering XY coordinates for the 3D XZ plane", () => {
    const [surface] = toPreviewSiteSurfaces([square], { cx: 2, cy: 1.5 });
    expect(surface.points[0]).toEqual({ x: -2, z: -1.5 });
    expect(surface.points[2]).toEqual({ x: 2, z: 1.5 });
  });

  it("removes a duplicated double-click endpoint", () => {
    expect(dedupeSurfacePoints([...square.points, square.points[0]])).toHaveLength(4);
  });
});
