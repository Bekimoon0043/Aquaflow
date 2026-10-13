// @vitest-environment jsdom
/**
 * AF-CAD-030 — characterisation tests for the 2D Engineering Designer, written BEFORE the
 * drafting-kernel split (mirrors Phase 0 of SHOW-PROGRAMMER-REDESIGN-PLAN.md). They pin the
 * behaviour a user sees today — tools, fixture placement, pipe drawing, arrays, layers and
 * undo — so the refactor can be proven behaviour-preserving.
 *
 * Default view: pan (60,60), zoom 30 px/m; default pool: 12 m × 8 m rectangle at (0,0)-(12,8).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mountDesigner, cleanup, wait, act } from "./designerHarness";

afterEach(() => cleanup());

const byType = (fixtures, prefix) => fixtures.filter((f) => String(f.type || "").startsWith(prefix));

describe("PoolGeometryDesigner characterisation (AF-CAD-030)", () => {
  it("offers the drafting tool set and the nine standard layers", async () => {
    const d = await mountDesigner();
    const text = d.container.textContent;
    for (const label of ["Select", "Rectangle", "Circle", "Polyline", "Land", "Pipe", "Nozzle", "Light", "Equipment", "Depth", "Measure", "Delete"]) {
      expect(text).toContain(label);
    }
    for (const layer of ["POOL OUTLINE", "WATER SURFACE", "LANDSCAPE / LAND", "NOZZLES", "LIGHTS", "EQUIPMENT", "MEASUREMENTS", "ANNOTATIONS", "PIPEWORK"]) {
      expect(text.toUpperCase()).toContain(layer);
    }
    expect(text).toContain("TOOL: SELECT");
  });

  it("places a nozzle inside the pool (0.1 m quantised) and ignores clicks outside every basin", async () => {
    const d = await mountDesigner();
    await d.tool("Nozzle");
    await d.tap(3.04, 2.96);
    await d.tap(30, 30); // outside the pool
    await wait(120);
    const nozzles = byType(d.fixtures(), "nozzle");
    expect(nozzles).toHaveLength(1);
    expect(nozzles[0].x).toBeCloseTo(3, 6);
    expect(nozzles[0].y).toBeCloseTo(3, 6);
    expect(nozzles[0].id).toBeDefined();
    expect(nozzles[0].engineering).toBeTruthy();
    expect(d.container.textContent).toContain("1 fixtures placed");
  });

  it("a locked NOZZLES layer blocks placement", async () => {
    const d = await mountDesigner();
    const nozzleRow = [...d.container.querySelectorAll("span")].find((s) => s.textContent.toUpperCase() === "NOZZLES").parentElement;
    const lockButton = nozzleRow.querySelectorAll("button")[1];
    await act(async () => { lockButton.click(); });
    await d.tool("Nozzle");
    await d.tap(4, 4);
    await wait(120);
    expect(d.fixtures()).toHaveLength(0);
  });

  it("select tool picks a fixture, Delete removes it, Ctrl+D duplicates it 0.5 m away", async () => {
    const d = await mountDesigner();
    await d.tool("Nozzle");
    await d.tap(5, 5);
    await d.tool("Select");
    await d.tap(5, 5);
    expect(d.container.textContent).toContain("Delete fixture");
    await d.key("d", { ctrlKey: true });
    await wait(120);
    expect(d.fixtures()).toHaveLength(2);
    const copy = d.fixtures()[1];
    expect(copy.x).toBeCloseTo(5.5, 6);
    expect(copy.y).toBeCloseTo(5.5, 6);
    expect(copy.label).toMatch(/Copy$/);
    await d.key("Delete");
    await wait(120);
    expect(d.fixtures()).toHaveLength(1);
  });

  it("dragging a selected fixture snaps once to the 0.5 m grid with SNAP on", async () => {
    const d = await mountDesigner();
    await d.tool("Nozzle");
    await d.tap(2, 2);
    await d.tool("Select");
    await d.down(2, 2);
    await d.move(4.13, 3.2, { buttons: 1 });
    await d.up(4.13, 3.2);
    await wait(120);
    expect(d.fixtures()[0].x).toBeCloseTo(4, 6);
    expect(d.fixtures()[0].y).toBeCloseTo(3, 6);
  });

  it("draws an orthogonal polyline pipe: clicks, then double-click to finish", async () => {
    const d = await mountDesigner();
    await d.tool("Pipe");
    await d.tap(1, 1);
    await d.move(4, 2.1);
    await d.tap(4, 2.1);   // ORTHO on by default → horizontal from (1,1)
    await d.dbl(4, 2.1);
    await wait(120);
    const pipes = d.pipes();
    expect(pipes).toHaveLength(1);
    expect(pipes[0].points).toMatchObject([{ x: 1, y: 1 }, { x: 4, y: 1 }]);
    expect(pipes[0].diameterMm).toBe(50);
    expect(pipes[0].type).toBe("manual_pipe");
  });

  it("pipe points snap to a nearby fixture centre", async () => {
    const d = await mountDesigner();
    await d.tool("Nozzle");
    await d.tap(6, 2);
    await d.tool("Pipe");
    await d.tap(6.1, 2.1);  // within the 10 px fixture aperture → (6,2)
    await d.move(6.1, 6);
    await d.tap(6.1, 6);
    await d.dbl(6.1, 6);
    await wait(120);
    const pipe = d.pipes()[0];
    expect(pipe.points[0]).toMatchObject({ x: 6, y: 2 });
    expect(pipe.points[1].x).toBeCloseTo(6, 6);
    expect(pipe.points[1].y).toBeCloseTo(6, 6);
  });

  it("APPLY ARRAY (centerline, 8, 1 m inset) adds 8 nozzles across the pool centreline", async () => {
    const d = await mountDesigner();
    await d.tool("Nozzle");
    await d.click("APPLY ARRAY");
    await wait(120);
    const made = d.fixtures();
    expect(made).toHaveLength(8);
    expect(made.every((f) => f.y === 4)).toBe(true);
    expect(made[0].x).toBe(1);
    expect(made[7].x).toBe(11);
    expect(new Set(made.map((f) => f.id)).size).toBe(8);
  });

  it("undo reverts the last gesture and redo restores it (Ctrl+Z / Ctrl+Y)", async () => {
    const d = await mountDesigner();
    await d.tool("Nozzle");
    await d.tap(3, 3);
    await d.settle();
    await d.tap(6, 3);
    await d.settle();
    expect(d.fixtures()).toHaveLength(2);
    await d.key("z", { ctrlKey: true });
    await wait(150);
    expect(d.fixtures()).toHaveLength(1);
    await d.key("z", { ctrlKey: true });
    await wait(150);
    expect(d.fixtures()).toHaveLength(0);
    await d.key("y", { ctrlKey: true });
    await wait(150);
    expect(d.fixtures()).toHaveLength(1);
  });

  it("an array is undone as a single step", async () => {
    const d = await mountDesigner();
    await d.tool("Nozzle");
    await d.click("APPLY ARRAY");
    await d.settle();
    expect(d.fixtures()).toHaveLength(8);
    await d.key("z", { ctrlKey: true });
    await wait(150);
    expect(d.fixtures()).toHaveLength(0);
  });

  it("Escape cancels an in-progress pipe and returns to the select tool", async () => {
    const d = await mountDesigner();
    await d.tool("Pipe");
    await d.tap(1, 1);
    expect(d.container.textContent).toContain("DRAW: ACTIVE");
    await d.key("Escape");
    expect(d.container.textContent).toContain("TOOL: SELECT");
    expect(d.container.textContent).toContain("DRAW: IDLE");
  });
  it("rectangle tool: two clicks redraw the pool outline (grid-snapped) and set width/length", async () => {
    const d = await mountDesigner();
    await d.tool("Rectangle");
    await d.tap(1.1, 0.9);
    await d.move(7.2, 5.1);
    await d.tap(7.2, 5.1);
    await wait(120);
    const geometry = d.store.getState().geometry;
    expect(geometry.points).toEqual([{ x: 1, y: 1 }, { x: 7, y: 1 }, { x: 7, y: 5 }, { x: 1, y: 5 }]);
    expect(d.store.getState().params.width).toBe(6);
    expect(d.store.getState().params.length).toBe(4);
  });

  it("measure tool records a two-point measurement", async () => {
    const d = await mountDesigner();
    await d.tool("Measure");
    await d.tap(0, 0);
    await d.tap(3, 4);
    await wait(120);
    expect(d.store.getState().measurements).toEqual([{ x1: 0, y1: 0, x2: 3, y2: 4 }]);
  });
});
