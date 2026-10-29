import { describe, expect, it } from "vitest";
import { arraySources, buildPipeArray, hitGuide, pathLength, pipePath, pumpForPipe, stationsAlongPipe } from "../pipeArray";
import { createFixtureEntity } from "../entities";
import { connectToPump, pairLights, readConnections } from "../../connections";

const straight = { id: "p1", drawMode: "straight", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
const arc = { id: "p2", drawMode: "arc", points: [{ x: -5, y: 0 }, { x: 0, y: -5 }, { x: 5, y: 0 }] };
const curve = { id: "p3", drawMode: "curve", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }] };

describe("pipe path", () => {
  it("measures a straight pipe", () => expect(pathLength(pipePath(straight))).toBeCloseTo(10, 6));
  it("follows a 3-point arc through its middle point (half circle r=5)", () => {
    const path = pipePath(arc);
    expect(pathLength(path)).toBeCloseTo(Math.PI * 5, 2);
    for (const p of path) expect(Math.hypot(p.x, p.y)).toBeCloseTo(5, 6);
    expect(Math.min(...path.map((p) => p.y))).toBeCloseTo(-5, 3);
  });
  it("follows a quadratic curve", () => {
    const path = pipePath(curve);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path.at(-1).x).toBeCloseTo(10, 9);
    expect(Math.max(...path.map((p) => p.y))).toBeCloseTo(2.5, 6);
  });
});

describe("stations", () => {
  it("spaces a count evenly with end gaps", () => {
    const s = stationsAlongPipe(straight, { count: 5, endGap: 1 });
    expect(s.map((p) => p.x)).toEqual([1, 3, 5, 7, 9]);
    expect(s.every((p) => p.y === 0 && p.rotation === 0)).toBe(true);
  });
  it("uses spacing when given, centred", () => {
    const s = stationsAlongPipe(straight, { spacing: 3 });
    expect(s.map((p) => p.x)).toEqual([0.5, 3.5, 6.5, 9.5]);
  });
  it("places evenly along an arc", () => {
    const s = stationsAlongPipe(arc, { count: 3 });
    expect(s[1].x).toBeCloseTo(0, 2);
    expect(s[1].y).toBeCloseTo(-5, 2);
    for (const p of s) expect(Math.hypot(p.x, p.y)).toBeCloseTo(5, 2);
  });
  it("side offset moves left of travel", () => {
    const s = stationsAlongPipe(straight, { count: 1, sideOffset: 0.3 });
    expect(s[0]).toMatchObject({ x: 5, y: -0.3 });
  });
});

describe("any line as an array source", () => {
  const square = { id: "g1", kind: "guide", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], closed: true };
  it("closed path: count 8 on a 4 × 4 square → every 2 m, on the outline, no duplicate at the start", () => {
    const s = stationsAlongPipe(square, { count: 8, endGap: 1 });
    expect(s.map((p) => [p.x, p.y])).toEqual([[0, 0], [2, 0], [4, 0], [4, 2], [4, 4], [2, 4], [0, 4], [0, 2]]);
  });
  it("closed path honours spacing", () => {
    expect(stationsAlongPipe(square, { spacing: 4 })).toHaveLength(4);
  });
  it("lists pipes, guides, basin outlines, land surfaces and depth zones", () => {
    const list = arraySources({
      pipes: [straight], guides: [{ id: "g1", label: "Guide line 1", points: square.points, closed: true }],
      basins: [{ id: "basin-1", name: "Basin 1", outer: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 }] }],
      siteSurfaces: [{ id: "s1", label: "Lawn Area 1", points: square.points }],
      depthZones: [{ key: "deep", label: "Deep", points: square.points }],
    });
    expect(list.map((s) => s.kind)).toEqual(["pipe", "guide", "basin", "surface", "depth"]);
    expect(list[0].label).toBe("Pipe: Pipe 1 (10.0 m)");
    expect(list[1].label).toBe("Guide line 1 (16.0 m)");
    expect(list[2].label).toBe("Basin 1 outline");
    expect(list[3].label).toBe("Land: Lawn Area 1");
    expect(list[4].label).toBe("Depth zone: Deep");
    const basin = list[2];
    expect(stationsAlongPipe(basin, { count: 20 })).toHaveLength(20);
  });
  it("a live circular pool outline is tessellated", () => {
    const [b] = arraySources({ basins: [{ id: "b" }], activeBasinIndex: 0, activeGeometry: { type: "circle", center: { x: 0, y: 0 }, radius: 5 } });
    for (const p of stationsAlongPipe(b, { count: 12 })) expect(Math.hypot(p.x, p.y)).toBeCloseTo(5, 1);
  });
  it("guide arrays tag arraySourceId, find no pump, and pair lights by source", () => {
    const pump = { id: "pump-1", type: "pump_vertical_inline_5_5kw", x: 0, y: 0 };
    const src = { ...square, kind: "guide" };
    const n = buildPipeArray({ source: src, fixtures: [pump], fixtureType: "nozzle_geyser", typeLabel: "G", count: 4 });
    expect(n.pumpId).toBeNull();
    expect(n.made.every((f) => f.arraySourceId === "g1" && f.pipeId === undefined)).toBe(true);
    const other = buildPipeArray({ pipe: straight, fixtures: [], fixtureType: "nozzle_geyser", typeLabel: "G", count: 4 });
    const l = buildPipeArray({ source: src, fixtures: [...n.made, ...other.made], fixtureType: "light_rgb", typeLabel: "L", count: 4, sideOffset: 0.2 });
    const onSquare = new Set(n.made.map((f) => f.id));
    expect(l.pairs).toHaveLength(4);
    expect(l.pairs.every(([, nid]) => onSquare.has(nid))).toBe(true);
  });
  it("hitGuide finds the nearest guide line", () => {
    expect(hitGuide([square], { x: 2, y: 0.1 }, 0.2)?.id).toBe("g1");
    expect(hitGuide([square], { x: 2, y: 2 }, 0.2)).toBeNull();
  });
});

describe("pump and pairing", () => {
  const pump = { id: "pump-1", type: "pump_vertical_inline_5_5kw", x: 0, y: 3 };
  const feed = { id: "f1", drawMode: "straight", points: [{ x: 0, y: 3 }, { x: 0, y: 0 }] };
  it("finds the pump through a joined pipe", () => {
    expect(pumpForPipe(straight, [straight, feed], [pump])?.id).toBe("pump-1");
    expect(pumpForPipe(straight, [straight], [pump])).toBeNull();
  });
  it("tags nozzles with the pipe, returns the pump, and pairs lights to nozzles on the pipe", () => {
    const n = buildPipeArray({ pipe: straight, pipes: [straight, feed], fixtures: [pump], fixtureType: "nozzle_geyser", typeLabel: "Geyser", count: 4, endGap: 1 });
    expect(n.made).toHaveLength(4);
    expect(n.pumpId).toBe("pump-1");
    expect(n.made.every((f) => f.pipeId === "p1")).toBe(true);
    const l = buildPipeArray({ pipe: straight, pipes: [straight], fixtures: [pump, ...n.made], fixtureType: "light_rgb", typeLabel: "RGB", count: 4, endGap: 1, sideOffset: 0.3 });
    expect(l.pumpId).toBeNull();
    expect(l.pairs).toHaveLength(4);
    expect(new Set(l.pairs.map(([, nid]) => nid)).size).toBe(4);
  });
  it("the designer's links land: nozzles read back with the pump, lights with their nozzle", () => {
    const realPump = { ...createFixtureEntity({ type: "pump_submersible_3kw", x: 0, y: 3, label: "Pump A" }) };
    const n = buildPipeArray({ pipe: straight, pipes: [straight, feed], fixtures: [realPump], fixtureType: "nozzle_geyser", typeLabel: "Geyser", count: 3 });
    let all = connectToPump([realPump, ...n.made], n.made.map((f) => f.id), n.pumpId);
    const l = buildPipeArray({ pipe: straight, pipes: [straight], fixtures: all, fixtureType: "light_rgb", typeLabel: "RGB", count: 3, sideOffset: 0.3 });
    all = [...all, ...l.made];
    for (const [lid, nid] of l.pairs) all = pairLights(all, [lid], nid);
    const design = readConnections(all);
    for (const f of n.made) expect(design.nozzleById.get(f.id)?.pumpId).toBe(realPump.id);
    expect(l.pairs).toHaveLength(3);
  });
});
