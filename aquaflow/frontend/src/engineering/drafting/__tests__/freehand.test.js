import { describe, it, expect } from "vitest";
import {
  sanitizeStroke, pathLength, resampleStroke, simplifyRDP, simplifyClosedRDP, pointSegmentDistance, findCorners,
  taubinSmooth, closeStroke, findSelfIntersection, removeSelfIntersections, polygonArea, fitCircle, fitEllipse,
  fitRectangle, fitLine, convexHull, recogniseShape, cleanStroke, snapAngle, fitPolygonEdges, rectCorners,
} from "../freehand";

// Deterministic jitter (no Math.random in tests).
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
}
const jitter = (points, amount, seed = 7) => { const r = rng(seed); return points.map((p) => ({ x: p.x + r() * 2 * amount, y: p.y + r() * 2 * amount })); };
const circleStroke = (cx, cy, r, n = 120, turns = 1, start = 0) => Array.from({ length: Math.round(n * turns) + 1 }, (_, k) => {
  const t = start + (k / n) * Math.PI * 2;
  return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
});
const ellipseStroke = (cx, cy, rx, ry, n = 140) => Array.from({ length: n + 1 }, (_, k) => {
  const t = (k / n) * Math.PI * 2;
  return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
});
const lineStroke = (a, b, n = 40) => Array.from({ length: n + 1 }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }));
const polyStroke = (corners, perEdge = 30, close = true) => {
  const out = [];
  const ring = close ? [...corners, corners[0]] : corners;
  for (let i = 0; i < ring.length - 1; i += 1) out.push(...lineStroke(ring[i], ring[i + 1], perEdge).slice(i ? 1 : 0));
  return out;
};
const rectStroke = (x0, y0, x1, y1, perEdge = 30) => polyStroke([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], perEdge);
const maxDistToPolyline = (points, poly) => Math.max(...points.map((p) => Math.min(...poly.slice(1).map((q, i) => pointSegmentDistance(p, poly[i], q)))));

describe("freehand basics", () => {
  it("sanitizeStroke drops non-finite and consecutive duplicate points", () => {
    expect(sanitizeStroke([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: NaN, y: 1 }, null, { x: "2", y: 1 }, { x: Infinity, y: 0 }, { x: 2, y: 1 }]))
      .toEqual([{ x: 0, y: 0 }, { x: 2, y: 1 }]);
    expect(sanitizeStroke(undefined)).toEqual([]);
  });

  it("resampleStroke spaces points evenly and keeps both ends", () => {
    const res = resampleStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }], 1);
    expect(res).toHaveLength(11);
    expect(res.at(-1)).toEqual({ x: 10, y: 0 });
    res.slice(1).forEach((p, i) => expect(p.x - res[i].x).toBeCloseTo(1, 9));
  });

  it("resampleStroke caps a huge stroke", () => {
    const huge = Array.from({ length: 100000 }, (_, i) => ({ x: i * 0.001, y: Math.sin(i * 0.001) }));
    expect(resampleStroke(huge, 1e-6, { maxPoints: 500 }).length).toBeLessThanOrEqual(502);
  });

  it("RDP keeps every dropped point within epsilon and keeps the endpoints", () => {
    const noisy = jitter(circleStroke(0, 0, 5, 400, 0.5), 0.05);
    for (const eps of [0.02, 0.1, 0.3]) {
      const simple = simplifyRDP(noisy, eps);
      expect(simple[0]).toEqual(noisy[0]);
      expect(simple.at(-1)).toEqual(noisy.at(-1));
      expect(simple.length).toBeLessThan(noisy.length);
      expect(maxDistToPolyline(noisy, simple)).toBeLessThanOrEqual(eps + 1e-9);
    }
  });

  it("RDP reduces a straight noisy line to its two ends", () => {
    expect(simplifyRDP(jitter(lineStroke({ x: 0, y: 0 }, { x: 10, y: 0 }, 200), 0.01), 0.05)).toHaveLength(2);
  });

  it("RDP handles tiny inputs and a 100k-point stroke without recursion", () => {
    expect(simplifyRDP([], 1)).toEqual([]);
    expect(simplifyRDP([{ x: 1, y: 1 }], 1)).toEqual([{ x: 1, y: 1 }]);
    const huge = Array.from({ length: 100000 }, (_, i) => ({ x: i, y: (i % 2) * 1e-3 }));
    expect(simplifyRDP(huge, 0.01)).toHaveLength(2);
  });

  it("simplifyClosedRDP keeps a square's four corners", () => {
    const ring = rectStroke(0, 0, 4, 4, 20).slice(0, -1);
    expect(simplifyClosedRDP(ring, 0.01)).toHaveLength(4);
  });

  it("snapAngle snaps only within the tolerance", () => {
    expect(snapAngle((2 * Math.PI) / 180, 15, 3)).toBe(0);
    expect(snapAngle((5 * Math.PI) / 180, 15, 3)).toBeCloseTo((5 * Math.PI) / 180, 12);
  });
});

describe("corners and smoothing", () => {
  it("finds the four corners of a rectangle stroke and none on a circle", () => {
    const rect = resampleStroke(rectStroke(0, 0, 10, 6), 0.25, { closed: true });
    expect(findCorners(rect, { closed: true })).toHaveLength(4);
    const circle = resampleStroke(circleStroke(0, 0, 5).slice(0, -1), 0.25, { closed: true });
    expect(findCorners(circle, { closed: true })).toHaveLength(0);
  });

  it("finds the corner of an open L stroke", () => {
    const l = resampleStroke(polyStroke([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], 20, false), 0.2);
    const corners = findCorners(l, { closed: false });
    expect(corners).toHaveLength(1);
    expect(l[corners[0]].x).toBeCloseTo(5, 0);
    expect(l[corners[0]].y).toBeCloseTo(0, 0);
  });

  it("Taubin smoothing keeps pinned points and barely shrinks a circle", () => {
    const ring = jitter(circleStroke(0, 0, 5, 100).slice(0, -1), 0.15);
    const smooth = taubinSmooth(ring, { closed: true, iterations: 10, pinned: [0] });
    expect(smooth[0]).toEqual(ring[0]);
    const meanR = (pts) => pts.reduce((s, p) => s + Math.hypot(p.x, p.y), 0) / pts.length;
    expect(Math.abs(meanR(smooth) - meanR(ring))).toBeLessThan(0.05);
    const roughness = (pts) => pts.reduce((s, p) => s + Math.abs(Math.hypot(p.x, p.y) - 5), 0);
    expect(roughness(smooth)).toBeLessThan(roughness(ring));
  });
});

describe("closing and self-intersections", () => {
  it("joins ends that finish within the tolerance and leaves far ends open", () => {
    const arc = circleStroke(0, 0, 5, 100, 0.97);
    expect(closeStroke(arc, { tolerance: 1.5 }).closed).toBe(true);
    const half = circleStroke(0, 0, 5, 100, 0.5);
    expect(closeStroke(half, { tolerance: 1 }).closed).toBe(false);
    expect(closeStroke(half, { tolerance: 1, force: true }).closed).toBe(true);
  });

  it("trims an overshoot past the start at the crossing", () => {
    // A square drawn from (1,0) whose last stroke swings back across the first side.
    const over = polyStroke([{ x: 1, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 2 }, { x: 4, y: -2 }], 20, false);
    const res = closeStroke(over, { tolerance: 0.5, force: true });
    expect(res.trimmed).toBe(true);
    expect(res.points.length).toBeLessThan(over.length);
    expect(findSelfIntersection(res.points)).toBeNull();
  });

  it("removeSelfIntersections keeps the larger lobe of a figure eight", () => {
    const eight = [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }]; // bow-tie
    expect(findSelfIntersection(eight)).not.toBeNull();
    const { points, removed } = removeSelfIntersections(eight);
    expect(removed).toBe(1);
    expect(findSelfIntersection(points)).toBeNull();
    expect(Math.abs(polygonArea(points))).toBeCloseTo(4, 6);

    const lopsided = [{ x: 0, y: 0 }, { x: 10, y: 6 }, { x: 10, y: 0 }, { x: 0, y: 2 }];
    const fixed = removeSelfIntersections(lopsided);
    expect(findSelfIntersection(fixed.points)).toBeNull();
    expect(fixed.points.some((p) => p.x === 10)).toBe(true);
  });

  it("a simple polygon is left alone", () => {
    const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(removeSelfIntersections(sq)).toEqual({ points: sq, removed: 0 });
  });
});

describe("least-squares fits", () => {
  it("fits a noisy circle", () => {
    const fit = fitCircle(jitter(circleStroke(3, -2, 4), 0.05));
    expect(fit.center.x).toBeCloseTo(3, 1);
    expect(fit.center.y).toBeCloseTo(-2, 1);
    expect(fit.radius).toBeCloseTo(4, 1);
    expect(fit.error).toBeLessThan(0.02);
  });

  it("fits a rotated ellipse", () => {
    const rot = Math.PI / 6;
    const pts = ellipseStroke(0, 0, 6, 3).map((p) => ({ x: p.x * Math.cos(rot) - p.y * Math.sin(rot), y: p.x * Math.sin(rot) + p.y * Math.cos(rot) }));
    const fit = fitEllipse(pts);
    expect(Math.max(fit.rx, fit.ry)).toBeCloseTo(6, 1);
    expect(Math.min(fit.rx, fit.ry)).toBeCloseTo(3, 1);
    expect(fit.error).toBeLessThan(0.01);
  });

  it("fits the minimum-area rectangle of a rotated box", () => {
    const corners = rectCorners({ center: { x: 2, y: 2 }, width: 8, height: 4, angle: 0.4 });
    const fit = fitRectangle(polyStroke(corners, 20));
    expect(Math.max(fit.width, fit.height)).toBeCloseTo(8, 6);
    expect(Math.min(fit.width, fit.height)).toBeCloseTo(4, 6);
    expect(fit.error).toBeLessThan(1e-6);
  });

  it("fits a line and reports its straightness", () => {
    const fit = fitLine(jitter(lineStroke({ x: 0, y: 0 }, { x: 10, y: 5 }), 0.03));
    expect(fit.length).toBeCloseTo(Math.hypot(10, 5), 0);
    expect(fit.error).toBeLessThan(0.01);
    expect(fitLine([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toBeNull();
  });

  it("convexHull returns the extreme points only", () => {
    expect(convexHull([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 2 }])).toHaveLength(4);
  });

  it("fitPolygonEdges puts triangle vertices on the true corners", () => {
    const tri = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 4, y: 6 }];
    const ring = resampleStroke(jitter(polyStroke(tri, 40), 0.03).slice(0, -1), 0.2, { closed: true });
    const poly = fitPolygonEdges(ring, findCorners(ring, { closed: true }), { closed: true });
    expect(poly.points).toHaveLength(3);
    for (const c of tri) expect(Math.min(...poly.points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeLessThan(0.2);
  });
});

const prep = (stroke, closed) => {
  const pts = resampleStroke(stroke, 0.2, { closed });
  return { pts, corners: findCorners(pts, { closed }) };
};

describe("recogniseShape", () => {
  it("recognises a hand-drawn circle, ellipse and rectangle", () => {
    let { pts, corners } = prep(jitter(circleStroke(0, 0, 5).slice(0, -1), 0.08), true);
    expect(recogniseShape(pts, { closed: true, corners })?.kind).toBe("circle");
    ({ pts, corners } = prep(jitter(ellipseStroke(0, 0, 8, 4).slice(0, -1), 0.08), true));
    expect(recogniseShape(pts, { closed: true, corners })?.kind).toBe("ellipse");
    ({ pts, corners } = prep(jitter(rectStroke(0, 0, 10, 6).slice(0, -1), 0.06), true));
    expect(recogniseShape(pts, { closed: true, corners })?.kind).toBe("rect");
  });

  it("recognises a straight line but not a wiggle or an arc", () => {
    const line = resampleStroke(jitter(lineStroke({ x: 0, y: 0 }, { x: 10, y: 1 }), 0.05), 0.2);
    expect(recogniseShape(line, { closed: false })?.kind).toBe("line");
    const wave = resampleStroke(Array.from({ length: 200 }, (_, i) => ({ x: i * 0.05, y: Math.sin(i * 0.1) })), 0.2);
    expect(recogniseShape(wave, { closed: false })).toBeNull();
    const arc = resampleStroke(circleStroke(0, 0, 5, 100, 0.3), 0.2);
    expect(recogniseShape(arc, { closed: false })).toBeNull();
  });

  it("does not call a freeform blob or a star a primitive", () => {
    const blob = Array.from({ length: 200 }, (_, k) => {
      const t = (k / 200) * Math.PI * 2;
      const r = 5 + 1.6 * Math.sin(3 * t) + 0.8 * Math.cos(5 * t);
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    });
    const { pts, corners } = prep(blob, true);
    const res = recogniseShape(pts, { closed: true, corners });
    expect(["circle", "ellipse", "rect"]).not.toContain(res?.kind);
  });

  it("recognises a straight-edged triangle as a polygon", () => {
    const { pts, corners } = prep(jitter(polyStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], 40).slice(0, -1), 0.04), true);
    expect(recogniseShape(pts, { closed: true, corners })?.kind).toBe("polygon");
  });

  it("force picks the best primitive even for a rough shape", () => {
    const rough = jitter(circleStroke(0, 0, 5).slice(0, -1), 0.6, 3);
    const { pts, corners } = prep(rough, true);
    expect(recogniseShape(pts, { closed: true, corners, force: true })).not.toBeNull();
  });
});

describe("cleanStroke pipeline", () => {
  it("rejects degenerate input (0, 1, 2 coincident points, all duplicates, NaN)", () => {
    expect(cleanStroke([]).ok).toBe(false);
    expect(cleanStroke([{ x: 1, y: 1 }]).ok).toBe(false);
    expect(cleanStroke([{ x: 1, y: 1 }, { x: 1, y: 1 }]).ok).toBe(false);
    expect(cleanStroke(Array(50).fill({ x: 2, y: 2 })).ok).toBe(false);
    expect(cleanStroke([{ x: NaN, y: 0 }, { x: 0, y: Infinity }]).ok).toBe(false);
    expect(cleanStroke(null).ok).toBe(false);
  });

  it("two points: a line in line mode, too small an outline in area mode", () => {
    const two = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
    const line = cleanStroke(two, { mode: "line" });
    expect(line.ok).toBe(true);
    expect(line.kind).toBe("line");
    expect(line.points).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
    expect(cleanStroke(two, { mode: "area" }).ok).toBe(false);
  });

  it("turns a hand-drawn circle into a perfect circle", () => {
    const res = cleanStroke(jitter(circleStroke(6, 4, 3, 150, 0.98), 0.05), { mode: "area", closeTolerance: 0.6 });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("circle");
    expect(res.circle.radius).toBeCloseTo(3, 1);
    expect(res.circle.center.x).toBeCloseTo(6, 1);
    expect(res.points.length).toBeGreaterThanOrEqual(24);
  });

  it("squares a hand-drawn, nearly axis-aligned rectangle", () => {
    const tilted = rectCorners({ center: { x: 6, y: 4 }, width: 12, height: 8, angle: (2 * Math.PI) / 180 });
    const res = cleanStroke(jitter(polyStroke(tilted, 40), 0.05), { mode: "area" });
    expect(res.kind).toBe("rect");
    expect(res.rect.axisAligned).toBe(true);
    expect(res.points).toHaveLength(4);
    const xs = res.points.map((p) => p.x), ys = res.points.map((p) => p.y);
    expect(new Set(xs.map((x) => x.toFixed(3))).size).toBe(2);
    expect(new Set(ys.map((y) => y.toFixed(3))).size).toBe(2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(12, 0);
  });

  it("keeps a freeform blob freeform with Recognise on, and gives few editable vertices", () => {
    const blob = Array.from({ length: 300 }, (_, k) => {
      const t = (k / 300) * Math.PI * 2;
      const r = 5 + 1.6 * Math.sin(3 * t);
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    });
    const res = cleanStroke(jitter(blob, 0.05), { mode: "area", smoothing: 50 });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("freeform");
    expect(res.points.length).toBeGreaterThan(8);
    expect(res.points.length).toBeLessThan(80);
    expect(findSelfIntersection(res.points)).toBeNull();
  });

  it("more smoothing gives fewer vertices", () => {
    const blob = jitter(Array.from({ length: 300 }, (_, k) => {
      const t = (k / 300) * Math.PI * 2;
      const r = 5 + 1.6 * Math.sin(3 * t);
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    }), 0.1);
    const low = cleanStroke(blob, { mode: "area", smoothing: 0, recognise: false });
    const high = cleanStroke(blob, { mode: "area", smoothing: 100, recognise: false });
    expect(high.points.length).toBeLessThan(low.points.length);
  });

  it("keeps sharp corners when asked and rounds them otherwise", () => {
    // An L-shaped outline with a wobble so it is not a clean polygon.
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    const stroke = jitter(polyStroke(L, 40), 0.04);
    const sharp = cleanStroke(stroke, { mode: "area", recognise: false, keepCorners: true, smoothing: 80 });
    const nearest = (pts, c) => Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    for (const c of L) expect(nearest(sharp.points, c)).toBeLessThan(0.25);
    const round = cleanStroke(stroke, { mode: "area", recognise: false, keepCorners: false, smoothing: 100 });
    expect(nearest(round.points, { x: 10, y: 0 })).toBeGreaterThan(nearest(sharp.points, { x: 10, y: 0 }));
  });

  it("straighten turns the L outline into a six-vertex polygon", () => {
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    const res = cleanStroke(jitter(polyStroke(L, 40), 0.05), { mode: "area", recognise: false, straighten: true });
    expect(res.kind).toBe("polygon");
    expect(res.points).toHaveLength(6);
    for (const c of L) expect(Math.min(...res.points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeLessThan(0.15);
  });

  it("auto-close: area mode closes a gap; turning it off rejects an open outline", () => {
    const open = circleStroke(0, 0, 5, 100, 0.85);
    expect(cleanStroke(open, { mode: "area", autoClose: true, recognise: false }).closed).toBe(true);
    const off = cleanStroke(open, { mode: "area", autoClose: false, closeTolerance: 0.5 });
    expect(off.ok).toBe(false);
    expect(off.error).toMatch(/not closed/);
  });

  it("auto-close in line mode only closes when the ends meet", () => {
    expect(cleanStroke(circleStroke(0, 0, 5, 100, 0.99), { mode: "line", closeTolerance: 0.5, recognise: false }).closed).toBe(true);
    expect(cleanStroke(circleStroke(0, 0, 5, 100, 0.6), { mode: "line", closeTolerance: 0.5, recognise: false }).closed).toBe(false);
    expect(cleanStroke(circleStroke(0, 0, 5, 100, 0.99), { mode: "line", closeTolerance: 0.5, autoClose: false, recognise: false }).closed).toBe(false);
  });

  it("removes a crossing loop from a freeform outline", () => {
    // A square whose last side makes a small loop.
    const loopy = [
      ...lineStroke({ x: 0, y: 0 }, { x: 10, y: 0 }, 40), ...lineStroke({ x: 10, y: 0 }, { x: 10, y: 10 }, 40).slice(1),
      ...lineStroke({ x: 10, y: 10 }, { x: 4, y: 10 }, 30).slice(1),
      ...circleStroke(4, 9, 1, 40, 1, Math.PI / 2).slice(1),
      ...lineStroke({ x: 4, y: 10 }, { x: 0, y: 10 }, 20).slice(1), ...lineStroke({ x: 0, y: 10 }, { x: 0, y: 0 }, 40).slice(1),
    ];
    const res = cleanStroke(loopy, { mode: "area", recognise: false, smoothing: 0, keepCorners: true });
    expect(res.ok).toBe(true);
    expect(findSelfIntersection(res.points)).toBeNull();
    expect(Math.abs(polygonArea(res.points))).toBeGreaterThan(90);
  });

  it("rejects an outline smaller than the minimum area", () => {
    const res = cleanStroke(circleStroke(0, 0, 0.2), { mode: "area", minArea: 1 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too small/);
  });

  it("snaps a recognised line to 15° steps and to the snap function", () => {
    const res = cleanStroke(lineStroke({ x: 0.1, y: 0.05 }, { x: 10, y: 0.3 }), { mode: "line", snap: (p) => ({ x: Math.round(p.x), y: Math.round(p.y) }) });
    expect(res.kind).toBe("line");
    expect(res.points[0]).toEqual({ x: 0, y: 0 });
    expect(res.points[1].y).toBe(0);
  });

  it("snaps the corners of an axis-aligned rectangle to the grid", () => {
    const res = cleanStroke(jitter(rectStroke(0.1, 0.1, 9.9, 6.1, 40), 0.03), { mode: "area", snap: (p) => ({ x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 }) });
    expect(res.kind).toBe("rect");
    const xs = res.points.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(0);
    expect(xs[3]).toBe(10);
  });

  it("force (make perfect shape) turns a rough loop into a primitive", () => {
    const rough = jitter(circleStroke(0, 0, 5, 150), 0.7, 11);
    expect(["freeform"]).toContain(cleanStroke(rough, { mode: "area", smoothing: 0 }).kind);
    expect(["circle", "ellipse", "rect", "polygon"]).toContain(cleanStroke(rough, { mode: "area", force: true }).kind);
  });

  it("handles a huge stroke quickly", () => {
    const huge = jitter(circleStroke(0, 0, 20, 100000), 0.02);
    const t0 = Date.now();
    const res = cleanStroke(huge, { mode: "area" });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("circle");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("output is always rounded, finite and free of duplicate vertices", () => {
    const res = cleanStroke(jitter(circleStroke(0, 0, 5, 200), 0.3), { mode: "area", recognise: false });
    expect(res.ok).toBe(true);
    res.points.forEach((p, i) => {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBe(Math.round(p.x * 1e4) / 1e4);
      const q = res.points[(i + 1) % res.points.length];
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(0);
    });
    expect(pathLength(res.points, true)).toBeGreaterThan(25);
  });
});

describe("recognition false positives and robustness", () => {
  it("a square is not a circle and a circle is not a rectangle", () => {
    const sq = cleanStroke(jitter(rectStroke(0, 0, 8, 8, 40), 0.04), { mode: "area" });
    expect(sq.kind).toBe("rect");
    const circ = cleanStroke(jitter(circleStroke(0, 0, 4, 160), 0.04), { mode: "area" });
    expect(circ.kind).toBe("circle");
  });

  it("an oval with aspect 0.95 is a circle, 0.6 is an ellipse", () => {
    expect(cleanStroke(ellipseStroke(0, 0, 5, 4.75, 160), { mode: "area" }).kind).toBe("circle");
    const el = cleanStroke(ellipseStroke(0, 0, 5, 3, 160), { mode: "area" });
    expect(el.kind).toBe("ellipse");
    expect(el.ellipse.axisAligned).toBe(true);
    expect(el.ellipse.rx).toBeCloseTo(5, 1);
    expect(el.ellipse.ry).toBeCloseTo(3, 1);
  });

  it("random scribbles never throw and any accepted outline is simple and finite", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const r = rng(seed);
      const n = 5 + Math.floor((r() + 0.5) * 300);
      const stroke = []; let x = 0, y = 0;
      for (let i = 0; i < n; i += 1) { x += r() * 2; y += r() * 2; stroke.push({ x, y }); }
      for (const mode of ["area", "line"]) {
        const res = cleanStroke(stroke, { mode, smoothing: (seed * 7) % 101, keepCorners: seed % 2 === 0, straighten: seed % 5 === 0, force: seed % 3 === 0 });
        if (!res.ok) { expect(typeof res.error).toBe("string"); continue; }
        expect(res.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
        if (res.closed) expect(findSelfIntersection(res.points)).toBeNull();
      }
    }
  });
});
