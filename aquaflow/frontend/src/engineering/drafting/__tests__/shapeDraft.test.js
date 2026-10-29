import { describe, it, expect } from "vitest";
import {
  DRAFT_COMMANDS, commandForAlias, createDraft, draftPrompt, draftClick, draftTyped, draftFinish, draftUndo, draftPreview,
} from "../shapeDraft";

const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
};
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const norm360 = (v) => ((v % 360) + 360) % 360;

/** Feed a sequence of clicks ({x,y}) and typed strings; returns the last result. */
function run(command, steps, opts) {
  let s = createDraft(command, opts);
  let last = { state: s };
  for (const step of steps) {
    last = typeof step === "string" ? draftTyped(s, step, step.opts) : step.typed !== undefined
      ? draftTyped(s, step.typed, step) : draftClick(s, step, step);
    if (last.error) throw new Error(`step ${JSON.stringify(step)}: ${last.error}`);
    s = last.state;
  }
  return last;
}

describe("aliases", () => {
  it("maps AutoCAD aliases case-insensitively", () => {
    expect(commandForAlias("pl")).toBe("pline");
    expect(commandForAlias("L")).toBe("pline");
    expect(commandForAlias("rec")).toBe("rect");
    expect(commandForAlias("c")).toBe("circle");
    expect(commandForAlias("pol")).toBe("polygon");
    expect(commandForAlias("el")).toBe("ellipse");
    expect(commandForAlias("a")).toBe("arc");
    expect(commandForAlias("circle")).toBe("circle");
    expect(commandForAlias("xyz")).toBeNull();
    expect(commandForAlias("")).toBeNull();
    expect(DRAFT_COMMANDS.map((c) => c.key)).toEqual(["pline", "rect", "circle", "polygon", "ellipse", "arc"]);
  });
  it("rejects unknown commands", () => {
    expect(() => createDraft("nope")).toThrow();
  });
});

describe("rectangle", () => {
  it("12 × 8 from typed corner and width,length", () => {
    const { done } = run("rect", ["0,0", "12,8"]);
    expect(done.kind).toBe("rect");
    expect(done.closed).toBe(true);
    expect(done.points).toHaveLength(4);
    expect(area(done.points)).toBeCloseTo(96, 9);
    expect(done.summary).toBe("Rectangle 12.000 × 8.000 m");
  });
  it("@12,8 is the same as 12,8 (relative to the first corner)", () => {
    const { done } = run("rect", ["2,3", "@12,8"]);
    expect(done.points).toContainEqual({ x: 14, y: 11 });
    expect(area(done.points)).toBeCloseTo(96, 9);
  });
  it("width then length typed separately", () => {
    const { done } = run("rect", ["0,0", "12", "8"]);
    expect(area(done.points)).toBeCloseTo(96, 9);
    expect(done.points).toContainEqual({ x: 12, y: 8 });
  });
  it("width,length follow the cursor side", () => {
    const { done } = run("rect", ["0,0", "12", { typed: "8", cursor: { x: -1, y: -1 } }]);
    expect(done.points).toContainEqual({ x: -12, y: -8 });
  });
  it("two clicks", () => {
    const { done } = run("rect", [{ x: 1, y: 1 }, { x: 4, y: 3 }]);
    expect(area(done.points)).toBeCloseTo(6, 9);
  });
  it("Dimensions option asks width, length, then a side click", () => {
    const { done } = run("rect", ["0,0", "D", "5", "2", { x: -1, y: -1 }]);
    expect(done.points).toContainEqual({ x: -5, y: -2 });
    expect(area(done.points)).toBeCloseTo(10, 9);
  });
  it("fillet rounds the corners", () => {
    const { done } = run("rect", ["F", "1", "0,0", "12,8"]);
    expect(done.segments.filter((g) => g.type === "arc")).toHaveLength(4);
    expect(area(done.points)).toBeCloseTo(96 - (4 - Math.PI), 1);
    expect(done.summary).toContain("fillet 1.000 m");
    // no duplicate closing point
    expect(d(done.points[0], done.points.at(-1))).toBeGreaterThan(1e-6);
  });
  it("zero size and bad input are errors with the state unchanged", () => {
    const s = run("rect", ["0,0"]).state;
    const zero = draftTyped(s, "0");
    expect(zero.error).toBeTruthy();
    expect(zero.state).toBe(s);
    const flat = draftClick(s, { x: 5, y: 0 });
    expect(flat.error).toBeTruthy();
    expect(draftTyped(s, "abc").error).toMatch(/not understood/);
  });
});

describe("circle", () => {
  it("radius 3 tessellates at 5° steps", () => {
    const { done } = run("circle", ["1,2", "3"]);
    expect(done.kind).toBe("circle");
    expect(done.points).toHaveLength(72);
    for (const p of done.points) expect(d(p, { x: 1, y: 2 })).toBeCloseTo(3, 6);
    expect(done.segments[0]).toMatchObject({ type: "arc", radius: 3, sweepDeg: 360 });
    expect(done.summary).toBe("Circle R 3.000 m (Ø 6.000 m)");
  });
  it("radius by click and diameter option", () => {
    expect(run("circle", [{ x: 0, y: 0 }, { x: 0, y: 4 }]).done.segments[0].radius).toBe(4);
    expect(run("circle", ["0,0", "D", "6"]).done.segments[0].radius).toBe(3);
  });
  it("2P and 3P", () => {
    const two = run("circle", ["2P", "0,0", "4,0"]).done.segments[0];
    expect(two.center).toEqual({ x: 2, y: 0 });
    expect(two.radius).toBe(2);
    const three = run("circle", ["3P", "0,0", "2,0", "1,1"]).done.segments[0];
    expect(three.center.x).toBeCloseTo(1, 9);
    expect(three.center.y).toBeCloseTo(0, 9);
    expect(three.radius).toBeCloseTo(1, 9);
  });
  it("collinear 3P and negative radius are errors", () => {
    const s = run("circle", ["3P", "0,0", "1,0"]).state;
    expect(draftTyped(s, "2,0").error).toMatch(/line/);
    const c = run("circle", ["0,0"]).state;
    expect(draftTyped(c, "-1").error).toBeTruthy();
  });
});

describe("polyline", () => {
  it("5, then 5<90, then Close makes a right triangle", () => {
    let r = run("pline", ["0,0", { typed: "5", cursorAngleDeg: 0 }, "5<90"]);
    expect(r.state.segments.at(-1).to).toEqual({ x: 5, y: -5 }); // 90° = up the screen
    expect(draftPrompt(r.state).options.map((o) => o.key)).toContain("C");
    r = draftTyped(r.state, "C");
    expect(r.done.closed).toBe(true);
    expect(r.done.points).toHaveLength(3);
    expect(area(r.done.points)).toBeCloseTo(12.5, 9);
    expect(r.done.summary).toContain("area 12.500 m²");
  });
  it("relative and absolute coordinates", () => {
    const r = run("pline", ["1,1", "@3,4", "10,10"]);
    expect(r.state.segments[0].to).toEqual({ x: 4, y: 5 });
    expect(r.state.segments[1].to).toEqual({ x: 10, y: 10 });
  });
  it("typed distance follows the cursor direction", () => {
    const r = run("pline", ["0,0", { typed: "2", cursor: { x: 0, y: 10 } }]);
    expect(r.state.segments[0].to.x).toBeCloseTo(0, 9);
    expect(r.state.segments[0].to.y).toBeCloseTo(2, 9);
  });
  it("tangent arc continues the previous segment", () => {
    const r = run("pline", ["0,0", { x: 4, y: 0 }, "A", { x: 4, y: -4 }]);
    const a = r.state.segments[1];
    expect(a.type).toBe("arc");
    expect(a.radius).toBeCloseTo(2, 9);
    expect(a.sweepDeg).toBeCloseTo(180, 9);
    expect(a.center).toEqual({ x: 4, y: -2 });
    // start tangent of the arc equals the direction of the line (0°)
    expect(norm360(a.startDeg + 90 * Math.sign(a.sweepDeg))).toBeCloseTo(0, 6);
    // bulges to the right
    const p = run("pline", ["0,0", { x: 4, y: 0 }, "A", { x: 4, y: -4 }, "L", { x: 0, y: -4 }, "C"]);
    expect(p.done.closed).toBe(true);
    expect(p.done.points.some((q) => Math.abs(q.x - 6) < 1e-6 && Math.abs(q.y + 2) < 1e-6)).toBe(true);
    for (const q of p.done.points) expect(q.x).toBeLessThanOrEqual(6 + 1e-9);
  });
  it("radius arc and second-point arc", () => {
    const rad = run("pline", ["0,0", { x: 4, y: 0 }, "A", "R", "2", { x: 4, y: -4 }]).state.segments[1];
    expect(rad.radius).toBeCloseTo(2, 9);
    expect(Math.abs(rad.sweepDeg)).toBeCloseTo(180, 6);
    const three = run("pline", ["0,0", "A", "S", "1,-1", "2,0"]).state.segments[0];
    expect(three.center.x).toBeCloseTo(1, 9);
    expect(three.radius).toBeCloseTo(1, 9);
    const small = run("pline", ["0,0", { x: 4, y: 0 }, "A", "R", "1"]).state;
    expect(draftClick(small, { x: 4, y: -4 }).error).toMatch(/too small/);
  });
  it("undo removes the last segment (button and U)", () => {
    let r = run("pline", [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }]);
    expect(r.state.segments).toHaveLength(2);
    const undone = draftUndo(r.state);
    expect(undone.segments).toHaveLength(1);
    r = draftTyped(r.state, "U");
    expect(r.state.segments).toHaveLength(1);
    expect(draftUndo(createDraft("pline"))).toEqual(createDraft("pline"));
  });
  it("clicking near the start closes the shape exactly", () => {
    const r = run("pline", [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0.05, y: 0.05 }]);
    expect(r.done.closed).toBe(true);
    expect(r.done.points).toHaveLength(3);
    expect(r.state.segments.at(-1).to).toEqual({ x: 0, y: 0 });
  });
  it("close tolerance is configurable and needs 3 points", () => {
    const near = run("pline", [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0.05, y: 0 }]);
    expect(near.done).toBeUndefined();
    const s = run("pline", [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }]).state;
    expect(draftClick(s, { x: 0.3, y: 0 }, { closeTolerance: 0.5 }).done).toBeTruthy();
    expect(draftClick(s, { x: 0.3, y: 0 }).done).toBeUndefined();
  });
  it("Enter closes with ≥3 points, errors with fewer, and returns open shapes when allowed", () => {
    const two = run("pline", ["0,0", "4,0"]).state;
    expect(draftFinish(two).error).toBe("Need at least 3 points for a closed shape");
    expect(draftTyped(two, "").error).toBe("Need at least 3 points for a closed shape");
    expect(draftTyped(two, "C").error).toBeTruthy();
    const three = run("pline", ["0,0", "4,0", "4,3"]).state;
    const fin = draftFinish(three);
    expect(fin.done.closed).toBe(true);
    expect(area(fin.done.points)).toBeCloseTo(6, 9);
    const open = run("pline", ["0,0", "4,0"], { closedOnly: false }).state;
    const res = draftFinish(open);
    expect(res.done.closed).toBe(false);
    expect(res.done.points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
  });
  it("prompt options", () => {
    const s0 = createDraft("pline");
    expect(draftPrompt(s0)).toEqual({ text: "Specify start point", options: [] });
    const s1 = run("pline", ["0,0"]).state;
    expect(draftPrompt(s1).options.map((o) => o.key)).toEqual(["A", "U"]);
    const s2 = run("pline", ["0,0", "1,0", "A"]).state;
    expect(draftPrompt(s2).options.map((o) => o.key)).toEqual(["L", "S", "R", "C", "U"]);
  });
  it("bad typed input leaves the state unchanged", () => {
    const s = run("pline", ["0,0"]).state;
    const r = draftTyped(s, "abc");
    expect(r.error).toMatch(/not understood/);
    expect(r.state).toBe(s);
    expect(draftTyped(createDraft("pline"), "5").error).toBeTruthy();
  });
  it("state is serialisable", () => {
    const s = run("pline", ["0,0", "4,0", "A", "4,-4"]).state;
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe("polygon", () => {
  it("6 sides inscribed, first vertex toward the cursor angle", () => {
    const { done } = run("polygon", ["6", "0,0", { typed: "2", cursorAngleDeg: 90 }]);
    expect(done.points).toHaveLength(6);
    for (const p of done.points) expect(d(p, { x: 0, y: 0 })).toBeCloseTo(2, 9);
    expect(done.points[0].x).toBeCloseTo(0, 9);
    expect(done.points[0].y).toBeCloseTo(-2, 9);
  });
  it("Enter keeps the default 6 sides; circumscribed uses the apothem", () => {
    const { done } = run("polygon", ["", "0,0", "C", "2"]);
    expect(done.points).toHaveLength(6);
    for (const p of done.points) expect(d(p, { x: 0, y: 0 })).toBeCloseTo(2 / Math.cos(Math.PI / 6), 9);
    const m = { x: (done.points[0].x + done.points[1].x) / 2, y: (done.points[0].y + done.points[1].y) / 2 };
    expect(d(m, { x: 0, y: 0 })).toBeCloseTo(2, 9);
  });
  it("radius by click sets size and rotation", () => {
    const { done } = run("polygon", ["4", { x: 0, y: 0 }, { x: 3, y: 0 }]);
    expect(done.points[0]).toEqual({ x: 3, y: 0 });
    expect(area(done.points)).toBeCloseTo(18, 9);
  });
  it("invalid sides are an error", () => {
    const s = createDraft("polygon");
    expect(draftTyped(s, "2").state).toBe(s);
    expect(draftTyped(s, "2").error).toBeTruthy();
    expect(draftTyped(s, "abc").error).toBeTruthy();
    expect(draftTyped(s, "4.5").error).toBeTruthy();
  });
});

describe("ellipse", () => {
  it("center, axis length along the cursor, other half-axis", () => {
    const { done } = run("ellipse", ["0,0", { typed: "3", cursorAngleDeg: 0 }, "2"]);
    expect(done.points).toHaveLength(72);
    expect(Math.max(...done.points.map((p) => Math.abs(p.x)))).toBeCloseTo(3, 6);
    expect(Math.max(...done.points.map((p) => Math.abs(p.y)))).toBeCloseTo(2, 6);
    expect(area(done.points)).toBeCloseTo(Math.PI * 6, 1);
    expect(done.summary).toBe("Ellipse 6.000 × 4.000 m");
  });
  it("other axis by click uses the perpendicular distance", () => {
    const { done } = run("ellipse", [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 1 }]);
    expect(Math.max(...done.points.map((p) => Math.abs(p.y)))).toBeCloseTo(1, 6);
  });
  it("zero axis is an error", () => {
    const s = run("ellipse", ["0,0"]).state;
    expect(draftClick(s, { x: 0, y: 0 }).error).toBeTruthy();
  });
});

describe("arc", () => {
  it("3-point arc closed by its chord", () => {
    const { done } = run("arc", ["0,0", "1,-1", "2,0"]);
    expect(done.closed).toBe(true);
    expect(done.segments.map((g) => g.type)).toEqual(["arc", "line"]);
    expect(done.segments[0].radius).toBeCloseTo(1, 9);
    expect(done.points.some((p) => Math.abs(p.x - 1) < 1e-6 && Math.abs(p.y + 1) < 1e-6)).toBe(true);
    expect(area(done.points)).toBeCloseTo(Math.PI / 2, 2);
  });
  it("open arc when closedOnly is false", () => {
    const { done } = run("arc", ["0,0", "1,-1", "2,0"], { closedOnly: false });
    expect(done.closed).toBe(false);
    expect(done.points[0]).toEqual({ x: 0, y: 0 });
    expect(done.points.at(-1)).toEqual({ x: 2, y: 0 });
  });
  it("collinear points are an error", () => {
    const s = run("arc", ["0,0", "1,0"]).state;
    expect(draftTyped(s, "2,0").error).toMatch(/line/);
  });
});

describe("preview", () => {
  it("polyline rubber band with length and angle labels", () => {
    const s = run("pline", ["0,0"]).state;
    const p = draftPreview(s, { x: 3, y: -4 });
    expect(p.points).toEqual([{ x: 0, y: 0 }, { x: 3, y: -4 }]);
    expect(p.guides).toEqual([{ from: { x: 0, y: 0 }, to: { x: 3, y: -4 } }]);
    expect(p.labels.map((l) => l.text)).toEqual(["5.000 m", "53°"]);
  });
  it("rectangle preview is the closed outline with both dimensions", () => {
    const s = run("rect", ["0,0"]).state;
    const p = draftPreview(s, { x: 12, y: 8 });
    expect(p.closed).toBe(true);
    expect(p.points).toHaveLength(4);
    expect(p.labels.map((l) => l.text)).toEqual(["12.000 m", "8.000 m"]);
  });
  it("circle preview shows the radius", () => {
    const s = run("circle", ["0,0"]).state;
    const p = draftPreview(s, { x: 0, y: 3 });
    expect(p.points).toHaveLength(72);
    expect(p.labels[0].text).toBe("R 3.000 m");
  });
  it("no cursor / nothing started", () => {
    expect(draftPreview(createDraft("pline"), null)).toEqual({ points: [], closed: false, guides: [], labels: [] });
    expect(draftPreview(createDraft("pline"), { x: 1, y: 1 }).guides).toEqual([]);
  });
});
