// @vitest-environment jsdom
/**
 * Pen (freehand) tool in the 2D Engineering Designer: pointer strokes become clean,
 * editable geometry (engineering/drafting/freehand.js), the Pen bar re-fits the raw stroke,
 * and every step is one undo step. Default view: pan (60,60), zoom 30 px/m.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { mountDesigner as mountBase, cleanup, wait, act, fireEvent, client } from "./designerHarness";
import useProjectStore from "../../../store/projectStore";

// The designer only answers single-key shortcuts while it is the active panel.
async function mountDesigner() {
  useProjectStore.getState().setActivePanel("geometry");
  const d = await mountBase();
  await d.settle();
  return d;
}

beforeAll(() => {
  // jsdom has no PointerEvent: a MouseEvent with the pointer fields is enough for React.
  if (typeof window !== "undefined" && !window.PointerEvent) {
    class PointerEventPolyfill extends window.MouseEvent {
      constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "mouse";
        this.pressure = init.pressure ?? 0.5;
      }
    }
    window.PointerEvent = PointerEventPolyfill;
    globalThis.PointerEvent = PointerEventPolyfill;
  }
});

afterEach(() => cleanup());

const circle = (cx, cy, r, n = 72, turns = 1) => Array.from({ length: Math.round(n * turns) + 1 }, (_, k) => {
  const t = (k / n) * Math.PI * 2;
  return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
});
const blob = (cx, cy, n = 90) => Array.from({ length: n + 1 }, (_, k) => {
  const t = (k / n) * Math.PI * 2;
  const r = 3 + 1.1 * Math.sin(3 * t);
  return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
});
const edge = (a, b, n = 20) => Array.from({ length: n }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }));
const box = (x0, y0, x1, y1) => [
  ...edge({ x: x0, y: y0 }, { x: x1, y: y0 }), ...edge({ x: x1, y: y0 }, { x: x1, y: y1 }),
  ...edge({ x: x1, y: y1 }, { x: x0, y: y1 }), ...edge({ x: x0, y: y1 }, { x: x0, y: y0 }), { x: x0, y: y0 },
];

async function stroke(d, points, extra = {}) {
  const base = { pointerId: 7, pointerType: "pen", button: 0, buttons: 1, ...extra };
  await act(async () => { fireEvent.pointerDown(d.canvas, { ...base, ...client(points[0].x, points[0].y) }); });
  for (const p of points.slice(1)) {
    await act(async () => { fireEvent.pointerMove(d.canvas, { ...base, ...client(p.x, p.y) }); });
  }
  const last = points.at(-1);
  await act(async () => { fireEvent.pointerUp(d.canvas, { ...base, buttons: 0, ...client(last.x, last.y) }); });
  await wait(30);
}

const penBar = (d) => d.container.querySelector('[aria-label="Pen result"]');
const geometry = (d) => d.store.getState().geometry;

describe("Pen tool", () => {
  it("is in the tool list, opens its settings, and Shift+P selects it", async () => {
    const d = await mountDesigner();
    expect(d.container.textContent).toContain("✎ Pen");
    await d.key("P", { shiftKey: true });
    expect(d.container.textContent).toContain("TOOL: PEN");
    expect(d.container.textContent).toContain("PEN SETTINGS");
    expect(d.container.textContent).toContain("Pen (Shift+P)");
    await d.key("Escape");
    expect(d.container.textContent).toContain("TOOL: SELECT");
  });

  it("a hand-drawn circle becomes a perfect circular basin, undoable with Ctrl+Z", async () => {
    const d = await mountDesigner();
    const before = geometry(d);
    await d.tool("Pen");
    await stroke(d, circle(6, 4, 3));
    await d.settle();
    const g = geometry(d);
    expect(g.type).toBe("circle");
    expect(g.radius).toBeCloseTo(3, 1);
    expect(g.center.x).toBeCloseTo(6, 1);
    expect(d.store.getState().poolType).toBe("circular");
    expect(penBar(d).textContent).toContain("circle");
    await d.key("z", { ctrlKey: true });
    await wait(150);
    expect(geometry(d)).toEqual(before);
    expect(penBar(d)).toBeNull();
  });

  it("a hand-drawn box becomes a rectangular basin", async () => {
    const d = await mountDesigner();
    await d.tool("Pen");
    await stroke(d, box(1, 1, 9, 6));
    await d.settle();
    expect(d.store.getState().poolType).toBe("rectangular");
    expect(d.store.getState().params.width).toBeCloseTo(8, 1);
    expect(d.store.getState().params.length).toBeCloseTo(5, 1);
  });

  it("a freeform stroke is re-fitted from the raw stroke; Undo fix and Accept work", async () => {
    const d = await mountDesigner();
    await d.tool("Pen");
    await stroke(d, blob(6, 5));
    await d.settle();
    const first = geometry(d);
    expect(first.type).toBe("freeform");
    expect(first.points.length).toBeGreaterThan(5);
    expect(penBar(d).textContent).toContain("smooth outline");

    // The three-lobed blob has three concave corners: straightening gives a straight-edged outline.
    await d.click("Straighten edges");
    await d.settle();
    const straight = geometry(d);
    expect(straight.points.length).toBeLessThan(first.points.length);
    expect(penBar(d).textContent).toContain("straight-edged");
    await d.click("Make perfect shape");
    await d.settle();
    const perfect = geometry(d);
    expect(perfect).not.toEqual(straight);

    // Undo fix steps back through the fits, one at a time, back to the first result.
    await d.click("Undo fix");
    await d.settle();
    expect(geometry(d)).toEqual(straight);
    await d.click("Undo fix");
    await d.settle();
    expect(geometry(d).points).toEqual(first.points);
    expect(d.button("Undo fix").disabled).toBe(true);

    await d.click("Smooth more");
    await d.settle();
    expect(geometry(d).points.length).toBeLessThanOrEqual(first.points.length);

    await d.click("Accept");
    expect(penBar(d)).toBeNull();
    // Still an ordinary freeform outline: vertex grips edit it.
    expect(geometry(d).type).toBe("freeform");
  });

  it("can draw a land surface instead, and a re-fit replaces it rather than adding another", async () => {
    const d = await mountDesigner();
    await d.tool("Pen");
    const select = d.container.querySelector('select[aria-label="Pen stroke becomes"]');
    await act(async () => { fireEvent.change(select, { target: { value: "land" } }); });
    const poolBefore = geometry(d);
    await stroke(d, blob(20, 5));
    await d.settle();
    const surfaces = () => d.store.getState().siteSurfaces || [];
    expect(surfaces()).toHaveLength(1);
    expect(surfaces()[0].points.length).toBeGreaterThan(5);
    await d.click("Make perfect shape");
    await d.settle();
    expect(surfaces()).toHaveLength(1);
    expect(geometry(d)).toEqual(poolBefore);
  });

  it("a tap or a tiny scribble changes nothing", async () => {
    const d = await mountDesigner();
    const before = geometry(d);
    await d.tool("Pen");
    await stroke(d, [{ x: 3, y: 3 }]);
    await stroke(d, [{ x: 3, y: 3 }, { x: 3.02, y: 3.01 }, { x: 3.03, y: 3 }]);
    await d.settle();
    expect(geometry(d)).toEqual(before);
    expect(penBar(d)).toBeNull();
  });
});
