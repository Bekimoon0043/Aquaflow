import { describe, expect, it } from "vitest";
import { architecturalCollision, basinRimCollision, colliderFromBounds, nearestColliders } from "../particleCollisions.js";

describe("live particle collisions", () => {
  it("blocks low droplets crossing a circular basin rim but lets higher arcs pass", () => {
    const pool = { type: "circular", radius: 5, kerbY: 0.45 };
    const hit = basinRimCollision([4.9, 0.3, 0], [5.2, 0.25, 0], [2, -1, 0], pool);
    expect(hit.type).toBe("basin-rim");
    expect(hit.position).toEqual([4.9, 0.3, 0]);
    expect(hit.velocity[0]).toBeLessThan(0);
    expect(hit.insideBasin).toBe(true);
    expect(basinRimCollision([4.9, 0.6, 0], [5.2, 0.55, 0], [2, -1, 0], pool)).toBeNull();
    expect(basinRimCollision([0, 0.3, 0], [1, 0.25, 0], [2, -1, 0], pool)).toBeNull();
  });

  it("uses the polygon basin mask rather than its bounding rectangle", () => {
    const pool = { type: "polygon", kerbY: 0.45, mask: { contains: (x) => x < 0 } };
    expect(basinRimCollision([-0.2, 0.3, 0], [0.2, 0.3, 0], [1, 0, 0], pool)).toBeTruthy();
  });

  it("stops a fast particle at the first architectural box face", () => {
    const box = colliderFromBounds("wall", [1, 0, -1], [2, 3, 1]);
    const hit = architecturalCollision([0, 1, 0], [3, 1, 0], [30, 0, 0], [box], 0.1);
    expect(hit.collider.id).toBe("wall");
    expect(hit.position[0]).toBeCloseTo(0.992, 8);
    expect(hit.velocity[0]).toBeLessThan(0);
    expect(hit.secondaryEvents.length).toBeGreaterThan(0);
  });

  it("ignores boxes the particle cannot reach this frame", () => {
    const box = colliderFromBounds("distant", [100, 0, -1], [102, 3, 1]);
    expect(architecturalCollision([0, 1, 0], [1, 1, 0], [10, 0, 0], [box], 0.1)).toBeNull();
    expect(architecturalCollision([0, 1, 0], [1, 1, 0], [10, 0, 0], [], 0.1)).toBeNull();
  });

  it("rejects malformed bounds and bounds the GPU collider count", () => {
    expect(colliderFromBounds("bad", [0, 0], [1, 1])).toBeNull();
    expect(colliderFromBounds("flat", [0, 0, 0], [1, 0, 1])).toBeNull();
    const boxes = [8, 3, 5, 1, 9].map((x) => colliderFromBounds(String(x), [x, 0, -1], [x + 1, 1, 1]));
    expect(nearestColliders(boxes).map((box) => box.id)).toEqual(["1", "3", "5", "8"]);
  });
});
