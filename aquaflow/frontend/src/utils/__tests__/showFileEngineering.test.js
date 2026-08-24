import { describe, expect, it } from "vitest";
import { deserializeShow, serializeShow } from "../showFile.js";

const showState = {
  currentShow: { id: "show-1", name: "Engineering Round Trip", bpm: 120, duration: 60, sampleRate: 60, loop: false },
  nodes: [], connections: [], timelineTracks: [], devices: [], timelineZoom: 4, showGrid: true, snapToGrid: true,
};

describe(".aqua engineering persistence", () => {
  it("round-trips the full engineering project in the canonical show file", () => {
    const engineering = {
      name: "Pool A", pool_type: "lshape", params: { width: 12, length: 8, depth: 1.1 },
      geometry: { type: "lshape", points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 0, y: 8 }], closed: true },
      fixtures: [{ id: "n1", type: "nozzle_geyser", x: 2, y: 2, engineering: { flowLpm: 90 } }],
      manualPipes: [{ id: "p1", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }],
      layers: [{ key: "pool_outline", visible: true }], measurements: [{ x1: 0, y1: 0, x2: 1, y2: 1 }],
      depth_zones: [{ zone: "deep", depth: 1.5, points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }] }],
      solved_hydraulics: { converged: true, totalDesignFlowLpm: 90 },
    };
    const file = serializeShow(showState, engineering);
    expect(file.engineering).toMatchObject({ name: "Pool A", pool_type: "lshape" });
    const restored = deserializeShow(JSON.parse(JSON.stringify(file))).engineeringProject;
    expect(restored.fixtures).toEqual(engineering.fixtures);
    expect(restored.manualPipes).toEqual(engineering.manualPipes);
    expect(restored.depth_zones).toEqual(engineering.depth_zones);
    expect(restored.solved_hydraulics).toEqual(engineering.solved_hydraulics);
  });
});
