import { describe, it, expect } from "vitest";
import { snapPlanPoint, fixtureDragPosition } from "../designerSnap";

describe("AF-CAD-002 fixture drag respects SNAP", () => {
  it("SNAP off keeps full (mm and better) precision", () => {
    expect(fixtureDragPosition({ x: 3.14159, y: -2.71828 }, { snapToGrid: false, gridStep: 0.5 }))
      .toEqual({ x: 3.14159, y: -2.71828 });
    expect(fixtureDragPosition({ x: 1.0004, y: 0.0016 }, { snapToGrid: false })).toEqual({ x: 1.0004, y: 0.0016 });
  });

  it("SNAP on snaps once to gridStep with no second 0.1 m rounding", () => {
    expect(fixtureDragPosition({ x: 3.14, y: 2.6 }, { snapToGrid: true, gridStep: 0.5 })).toEqual({ x: 3, y: 2.5 });
    // 0.25 m grid: a 0.1 m re-round would turn 0.75 into 0.8.
    expect(fixtureDragPosition({ x: 0.74, y: 1.3 }, { snapToGrid: true, gridStep: 0.25 })).toEqual({ x: 0.75, y: 1.25 });
    expect(fixtureDragPosition({ x: 0.31, y: -0.04 }, { snapToGrid: true, gridStep: 0.1 })).toEqual({ x: 0.3, y: 0 });
  });

  it("a CAD underlay vertex inside the aperture wins over the grid", () => {
    const underlaySnap = (p) => (Math.hypot(p.x - 1.237, p.y - 4.004) < 0.2 ? { x: 1.237, y: 4.004 } : null);
    expect(snapPlanPoint({ x: 1.3, y: 4 }, { enabled: true, step: 0.5, underlaySnap })).toEqual({ x: 1.237, y: 4.004 });
    expect(snapPlanPoint({ x: 3.3, y: 4 }, { enabled: true, step: 0.5, underlaySnap })).toEqual({ x: 3.5, y: 4 });
    expect(snapPlanPoint({ x: 1.3, y: 4 }, { enabled: false, underlaySnap })).toEqual({ x: 1.3, y: 4 });
  });
});
