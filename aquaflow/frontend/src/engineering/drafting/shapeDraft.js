/**
 * drafting/shapeDraft.js — AutoCAD-style shape commands for the Site & Basin Designer.
 *
 * Conventions (same as dynamicInput.js): plan metres, plan y runs DOWN the screen, angles are
 * degrees counter-clockwise ON SCREEN from +x (90° points up the screen). Typed points:
 *   "5"      direct distance along the cursor angle     "5<30"  length at an angle
 *   "@dx,dy" relative to the last point (plan x/y)      "x,y"   absolute plan point
 * Rectangle second corner: "12,8" and "@12,8" are both width,length FROM the first corner in
 * plan axes (+x right, +y down the screen); negative values flip the side.
 *
 * Every command is a plain, serialisable state machine: createDraft → draftClick / draftTyped /
 * draftFinish → { state, done?, error? }. On error the state is returned unchanged. Undo steps
 * back through `state.history`. A standalone arc with closedOnly is closed by its chord.
 *
 * Pure — no React, no DOM.
 */
import { polarPoint, angleOf, parseCoordinateInput } from "./dynamicInput";

export const DRAFT_COMMANDS = [
  { key: "pline", label: "Line / Polyline", aliases: ["L", "PL", "LINE", "PLINE", "POLYLINE"], icon: "╱" },
  { key: "rect", label: "Rectangle", aliases: ["REC", "RECT", "RECTANG", "RECTANGLE"], icon: "▭" },
  { key: "circle", label: "Circle", aliases: ["C", "CIRCLE"], icon: "○" },
  { key: "polygon", label: "Polygon", aliases: ["POL", "POLYGON"], icon: "⬡" },
  { key: "ellipse", label: "Ellipse", aliases: ["EL", "ELLIPSE"], icon: "⬭" },
  { key: "arc", label: "Arc", aliases: ["A", "ARC"], icon: "◠" },
];

const FIRST_STEP = { pline: "start", rect: "first", circle: "center", polygon: "sides", ellipse: "center", arc: "start" };
const ARC_STEP_DEG = 5;
const ELLIPSE_SEGMENTS = 72;

// ── small helpers ───────────────────────────────────────────────────────────
const r9 = (v) => { const r = Number(Number(v).toFixed(9)); return r === 0 ? 0 : r; };
const pt = (x, y) => ({ x: r9(x), y: r9(y) });
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const same = (a, b, tol = 1e-6) => dist(a, b) <= tol;
const mid = (a, b) => pt((a.x + b.x) / 2, (a.y + b.y) / 2);
const norm360 = (d) => ((d % 360) + 360) % 360;
const m3 = (v) => Number(v).toFixed(3);
const sgn = (v) => (v < 0 ? -1 : 1);
const NUM = /^-?(?:\d+\.?\d*|\.\d+)$/;
const parseNum = (t) => (NUM.test(String(t).trim()) ? Number(t) : null);
const BAD = (t) => `Typed value not understood: "${t}" · use 5, 5<30, @dx,dy or x,y`;
const NEED_POSITIVE = "Enter a number greater than 0";
const P = (text, options = []) => ({ text, options });

function next(s, patch) {
  const { history = [], ...snap } = s;
  return { ...snap, ...patch, history: [...history, snap] };
}

/** Resolve a typed point; `from` is the last point (null when there is none yet). */
function resolveTyped(text, from, cursorAngleDeg) {
  const t = String(text).trim();
  const polar = /^@?(-?(?:\d+\.?\d*|\.\d+))\s*<\s*(-?(?:\d+\.?\d*|\.\d+))$/.exec(t);
  if (polar) return from ? { point: polarPoint(from, Number(polar[1]), Number(polar[2])) } : { error: "Click or type x,y for the first point" };
  if (t.includes(",")) {
    const c = parseCoordinateInput(t);
    if (!c) return { error: BAD(t) };
    if (!c.relative) return { point: pt(c.x, c.y) };
    return from ? { point: pt(from.x + c.x, from.y + c.y) } : { error: "Click or type x,y for the first point" };
  }
  const n = parseNum(t);
  if (n !== null) return from ? { point: polarPoint(from, n, cursorAngleDeg ?? 0) } : { error: "Click or type x,y for the first point" };
  return { error: BAD(t) };
}

// ── segments ────────────────────────────────────────────────────────────────
const lineSeg = (from, to) => ({ type: "line", from, to });

function arcSegAt(center, radius, startDeg, sweepDeg) {
  return {
    type: "arc", from: polarPoint(center, radius, startDeg), to: polarPoint(center, radius, startDeg + sweepDeg),
    center: pt(center.x, center.y), radius: r9(radius), startDeg: r9(norm360(startDeg)), sweepDeg: r9(sweepDeg),
  };
}

function arcBetween(center, from, to, sweepDeg) {
  return { ...arcSegAt(center, dist(center, from), angleOf(center, from), sweepDeg), from, to };
}

function endTangent(seg) {
  if (seg.type === "line") return angleOf(seg.from, seg.to);
  return norm360(angleOf(seg.center, seg.to) + (seg.sweepDeg > 0 ? 90 : -90));
}

function tessellate(seg) {
  const steps = Math.max(1, Math.ceil(Math.abs(seg.sweepDeg) / ARC_STEP_DEG - 1e-9));
  const out = [];
  for (let i = 1; i < steps; i++) out.push(polarPoint(seg.center, seg.radius, seg.startDeg + (seg.sweepDeg * i) / steps));
  out.push(seg.to);
  return out;
}

const segLength = (s) => (s.type === "line" ? dist(s.from, s.to) : (s.radius * Math.abs(s.sweepDeg) * Math.PI) / 180);

/** Arc leaving `from` along `tanDeg` and ending at `to`; collinear ahead → a straight line. */
function tangentArc(from, tanDeg, to) {
  const t = (tanDeg * Math.PI) / 180, ux = Math.cos(t), uy = Math.sin(t);
  const dx = to.x - from.x, dY = -(to.y - from.y); // math frame (y up)
  const cross = ux * dY - uy * dx, dot = ux * dx + uy * dY;
  const len = Math.hypot(dx, dY);
  if (Math.abs(cross) < 1e-9 * Math.max(1, len)) {
    return dot > 0 ? { seg: lineSeg(from, to) } : { error: "The arc end point is straight behind the arc direction" };
  }
  const rs = (dx * dx + dY * dY) / (2 * cross);
  const center = pt(from.x - rs * uy, from.y - rs * ux);
  const sweep = (2 * Math.atan2(cross, dot) * 180) / Math.PI;
  return { seg: arcBetween(center, from, to, sweep) };
}

function circumcenter(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const A = a.x * a.x + a.y * a.y, B = b.x * b.x + b.y * b.y, C = c.x * c.x + c.y * c.y;
  return pt((A * (b.y - c.y) + B * (c.y - a.y) + C * (a.y - b.y)) / d, (A * (c.x - b.x) + B * (a.x - c.x) + C * (b.x - a.x)) / d);
}

function threePointArc(a, b, c) {
  const center = circumcenter(a, b, c);
  if (!center) return { error: "The three points are in a line" };
  const a0 = angleOf(center, a), ccw = norm360(angleOf(center, c) - a0), m = norm360(angleOf(center, b) - a0);
  return { seg: arcBetween(center, a, c, m < ccw ? ccw : ccw - 360) };
}

/** Minor arc of radius r from `from` to `to`, turning the way the tangent points (left if none). */
function radiusArc(from, to, r, tanDeg) {
  const L = dist(from, to);
  if (r < L / 2 - 1e-9) return { error: `Radius ${m3(r)} m is too small for that end point (needs ≥ ${m3(L / 2)} m)` };
  const dx = to.x - from.x, dY = -(to.y - from.y);
  let s = 1;
  if (tanDeg !== null && tanDeg !== undefined) {
    const t = (tanDeg * Math.PI) / 180;
    s = sgn(Math.cos(t) * dY - Math.sin(t) * dx);
  }
  const h = Math.sqrt(Math.max(0, r * r - (L / 2) ** 2));
  const mp = mid(from, to);
  const center = pt(mp.x + (s * h * -dY) / L, mp.y - (s * h * dx) / L);
  return { seg: arcBetween(center, from, to, (s * 2 * Math.asin(Math.min(1, L / (2 * r))) * 180) / Math.PI) };
}

function pathPoints(segments, closed) {
  if (!segments.length) return [];
  const out = [segments[0].from];
  for (const s of segments) {
    for (const p of s.type === "arc" ? tessellate(s) : [s.to]) if (!same(p, out[out.length - 1])) out.push(p);
  }
  if (closed && out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
  return out;
}

const result = (kind, segments, closed, summary) => ({ kind, points: pathPoints(segments, closed), closed, segments, summary });

function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}

// ── polyline ────────────────────────────────────────────────────────────────
const plineLast = (s) => (s.segments.length ? s.segments[s.segments.length - 1].to : s.points[0]);
const closable = (segs) => segs.length >= 3 || (segs.length >= 2 && segs.some((g) => g.type === "arc"));
const canClose = (s) => s.segments.length >= 2 || (s.segments.length >= 1 && (s.mode === "arc" || s.segments.some((g) => g.type === "arc")));
const plineTangent = (s, fallback) => (s.segments.length ? endTangent(s.segments[s.segments.length - 1]) : fallback ?? 90);

function plineSeg(s, from, to, tangentDeg) {
  if (s.mode !== "arc") return { seg: lineSeg(from, to) };
  if (s.arcSub === "secondEnd") return threePointArc(from, s.arcSecond, to);
  if (s.arcSub === "radiusEnd") return radiusArc(from, to, s.arcRadius, s.segments.length ? plineTangent(s) : null);
  return tangentArc(from, plineTangent(s, tangentDeg), to);
}

function plineResult(s, closed) {
  const per = s.segments.reduce((sum, g) => sum + segLength(g), 0);
  const res = result("pline", s.segments, closed, "");
  res.summary = closed
    ? `Closed shape · ${s.segments.length} sides · perimeter ${m3(per)} m · area ${m3(polygonArea(res.points))} m²`
    : `Polyline · ${s.segments.length} segment${s.segments.length === 1 ? "" : "s"} · length ${m3(per)} m`;
  return res;
}

function plineCloseWith(s, tangentDeg) {
  const start = s.points[0], last = plineLast(s);
  if (same(last, start)) return closable(s.segments) ? { state: s, done: plineResult(s, true) } : { state: s, error: "Need at least 3 points to close" };
  const r = plineSeg(s, last, start, tangentDeg);
  if (r.error) return { state: s, error: r.error };
  const segs = [...s.segments, r.seg];
  if (!closable(segs)) return { state: s, error: "Need at least 3 points to close" };
  const ns = next(s, { segments: segs, arcSub: null, arcSecond: null });
  return { state: ns, done: plineResult(ns, true) };
}

const pline = {
  point(s, p, { closeTolerance = 0.15, tangentDeg } = {}) {
    if (s.step === "start") return { state: next(s, { step: "next", points: [p] }) };
    if (s.arcSub === "radius") return { state: s, error: "Type the arc radius first" };
    const last = plineLast(s);
    if (same(p, last)) return { state: s };
    if (s.mode === "arc" && s.arcSub === "second") return { state: next(s, { arcSub: "secondEnd", arcSecond: p }) };
    const start = s.points[0];
    if (closeTolerance > 0 && dist(p, start) <= closeTolerance) {
      const r = plineSeg(s, last, start, tangentDeg);
      if (r.seg && closable([...s.segments, r.seg])) {
        const ns = next(s, { segments: [...s.segments, r.seg], arcSub: null, arcSecond: null });
        return { state: ns, done: plineResult(ns, true) };
      }
    }
    const r = plineSeg(s, last, p, tangentDeg);
    if (r.error) return { state: s, error: r.error };
    return { state: next(s, { segments: [...s.segments, r.seg], arcSub: null, arcSecond: null }) };
  },
  typed(s, t, opts) {
    if (s.arcSub === "radius") {
      const n = parseNum(t);
      return n > 0 ? { state: next(s, { arcSub: "radiusEnd", arcRadius: n }) } : { state: s, error: NEED_POSITIVE };
    }
    if (t.toUpperCase() === "C") return { state: s, error: "Need at least 3 points to close" };
    const last = s.step === "start" ? null : plineLast(s);
    const angle = opts.cursorAngleDeg ?? (opts.cursor && last && !same(opts.cursor, last) ? angleOf(last, opts.cursor) : last && s.segments.length ? plineTangent(s) : 0);
    const r = resolveTyped(t, last, angle);
    if (r.error) return { state: s, error: r.error };
    return pline.point(s, r.point, { closeTolerance: 1e-6, tangentDeg: opts.cursorAngleDeg });
  },
  option(s, key, opts) {
    if (key === "A") return { state: next(s, { mode: "arc", arcSub: null }) };
    if (key === "L") return { state: next(s, { mode: "line", arcSub: null }) };
    if (key === "S") return { state: next(s, { arcSub: "second" }) };
    if (key === "R") return { state: next(s, { arcSub: "radius" }) };
    if (key === "U") return { state: draftUndo(s) };
    return plineCloseWith(s, opts.cursorAngleDeg);
  },
  prompt(s) {
    if (s.step === "start") return P("Specify start point");
    const undo = { key: "U", label: "Undo" };
    if (s.arcSub === "second") return P("Specify second point of arc", [undo]);
    if (s.arcSub === "secondEnd" || s.arcSub === "radiusEnd") return P("Specify end point of arc", [undo]);
    if (s.arcSub === "radius") return P("Specify radius of arc", [undo]);
    const close = canClose(s) ? [{ key: "C", label: "Close" }] : [];
    if (s.mode === "arc") return P("Specify end point of arc or", [{ key: "L", label: "Line" }, { key: "S", label: "Second pt" }, { key: "R", label: "Radius" }, ...close, undo]);
    return P("Specify next point or", [{ key: "A", label: "Arc" }, ...close, undo]);
  },
  finish(s) {
    if (s.step === "start") return { state: s, error: s.closedOnly ? "Need at least 3 points for a closed shape" : "Need at least 2 points" };
    const start = s.points[0], last = plineLast(s);
    if (s.closedOnly) {
      const segs = same(last, start) ? s.segments : [...s.segments, lineSeg(last, start)];
      if (!closable(segs)) return { state: s, error: "Need at least 3 points for a closed shape" };
      const ns = segs === s.segments ? s : next(s, { segments: segs, arcSub: null });
      return { state: ns, done: plineResult(ns, true) };
    }
    if (!s.segments.length) return { state: s, error: "Need at least 2 points" };
    return { state: s, done: plineResult(s, same(last, start) && closable(s.segments)) };
  },
};

// ── rectangle ───────────────────────────────────────────────────────────────
function rectResult(a, b, fillet) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const w = x1 - x0, h = y1 - y0, r = Math.min(Math.max(0, Number(fillet) || 0), w / 2, h / 2);
  const segs = [];
  const add = (g) => { if (g.type === "arc" || !same(g.from, g.to)) segs.push(g); };
  add(lineSeg(pt(x0 + r, y0), pt(x1 - r, y0)));
  if (r > 0) add(arcSegAt(pt(x1 - r, y0 + r), r, 90, -90));
  add(lineSeg(pt(x1, y0 + r), pt(x1, y1 - r)));
  if (r > 0) add(arcSegAt(pt(x1 - r, y1 - r), r, 0, -90));
  add(lineSeg(pt(x1 - r, y1), pt(x0 + r, y1)));
  if (r > 0) add(arcSegAt(pt(x0 + r, y1 - r), r, 270, -90));
  add(lineSeg(pt(x0, y1 - r), pt(x0, y0 + r)));
  if (r > 0) add(arcSegAt(pt(x0 + r, y0 + r), r, 180, -90));
  return result("rect", segs, true, `Rectangle ${m3(w)} × ${m3(h)} m${r > 0 ? `, fillet ${m3(r)} m` : ""}`);
}

function rectDone(s, corner) {
  const f = s.points[0];
  if (Math.abs(corner.x - f.x) < 1e-9 || Math.abs(corner.y - f.y) < 1e-9) return { state: s, error: "Rectangle needs a width and a length" };
  return { state: next(s, { step: "done", points: [f, corner] }), done: rectResult(f, corner, s.fillet) };
}

const rectSidePoint = (s, p) => {
  const f = s.points[0];
  return pt(f.x + Math.abs(s.width) * sgn(p.x - f.x), f.y + Math.abs(s.length) * sgn(p.y - f.y));
};

const rect = {
  point(s, p) {
    if (s.step === "first") return { state: next(s, { step: "second", points: [p] }) };
    if (s.step === "second") return rectDone(s, p);
    if (s.step === "side") return rectDone(s, rectSidePoint(s, p));
    return { state: s, error: "Type a value" };
  },
  typed(s, t, opts) {
    const f = s.points[0], n = parseNum(t);
    if (s.step === "first" || s.step === "side") {
      const r = resolveTyped(t, s.step === "side" ? f : null, opts.cursorAngleDeg);
      return r.error ? { state: s, error: r.error } : rect.point(s, r.point);
    }
    if (s.step === "fillet") return n !== null && n >= 0 ? { state: next(s, { fillet: n, step: s.returnStep }) } : { state: s, error: "Enter a radius of 0 or more" };
    if (s.step === "width") return n ? { state: next(s, { width: n, step: "length", dimFlow: true }) } : { state: s, error: "Enter a non-zero width" };
    if (s.step === "length") {
      if (!n) return { state: s, error: "Enter a non-zero length" };
      if (s.dimFlow) return { state: next(s, { length: n, step: "side" }) };
      const dx = opts.cursor ? sgn(opts.cursor.x - f.x) : 1, dy = opts.cursor ? sgn(opts.cursor.y - f.y) : 1;
      return rectDone({ ...s, length: n }, pt(f.x + s.width * dx, f.y + n * dy));
    }
    // second corner
    if (n !== null) return n ? { state: next(s, { width: n, step: "length", dimFlow: false }) } : { state: s, error: "Enter a non-zero width" };
    if (t.includes(",")) {
      const c = parseCoordinateInput(t.startsWith("@") ? t : `@${t}`);
      return c ? rectDone(s, pt(f.x + c.x, f.y + c.y)) : { state: s, error: BAD(t) };
    }
    const r = resolveTyped(t, f, opts.cursorAngleDeg);
    return r.error ? { state: s, error: r.error } : rectDone(s, r.point);
  },
  option(s, key) {
    if (key === "D") return { state: next(s, { step: "width" }) };
    return { state: next(s, { step: "fillet", returnStep: s.step }) };
  },
  prompt(s) {
    const fillet = { key: "F", label: s.fillet ? `Fillet (${m3(s.fillet)})` : "Fillet" };
    if (s.step === "first") return P("Specify first corner point or", [fillet]);
    if (s.step === "second") return P("Specify other corner point or", [{ key: "D", label: "Dimensions" }, fillet]);
    if (s.step === "fillet") return P("Specify fillet radius for the corners");
    if (s.step === "width") return P("Specify width");
    if (s.step === "length") return P("Specify length");
    if (s.step === "side") return P("Click the side for the rectangle");
    return P("Rectangle done");
  },
  finish(s) {
    if (s.step === "side") return rectDone(s, rectSidePoint(s, { x: Infinity, y: Infinity }));
    return null;
  },
};

// ── circle ──────────────────────────────────────────────────────────────────
function circleDone(s, c, r) {
  if (!(r > 1e-9)) return { state: s, error: "Radius must be greater than 0" };
  return { state: next(s, { step: "done", points: [c] }), done: result("circle", [arcSegAt(c, r, 0, 360)], true, `Circle R ${m3(r)} m (Ø ${m3(2 * r)} m)`) };
}

const circle = {
  point(s, p) {
    const [a, b] = s.points;
    switch (s.step) {
      case "center": return { state: next(s, { step: "radius", points: [p] }) };
      case "radius": return circleDone(s, a, dist(a, p));
      case "diameter": return circleDone(s, a, dist(a, p) / 2);
      case "2p1": return { state: next(s, { step: "2p2", points: [p] }) };
      case "2p2": return circleDone(s, mid(a, p), dist(a, p) / 2);
      case "3p1": return { state: next(s, { step: "3p2", points: [p] }) };
      case "3p2": return same(a, p) ? { state: s } : { state: next(s, { step: "3p3", points: [a, p] }) };
      case "3p3": {
        const c = circumcenter(a, b, p);
        return c ? circleDone(s, c, dist(c, a)) : { state: s, error: "The three points are in a line" };
      }
      default: return { state: s };
    }
  },
  typed(s, t, opts) {
    if (s.step === "radius" || s.step === "diameter") {
      const n = parseNum(t);
      if (n !== null) return n > 0 ? circleDone(s, s.points[0], s.step === "diameter" ? n / 2 : n) : { state: s, error: NEED_POSITIVE };
    }
    const r = resolveTyped(t, s.points[s.points.length - 1] || null, opts.cursorAngleDeg);
    return r.error ? { state: s, error: r.error } : circle.point(s, r.point);
  },
  option(s, key) {
    return { state: next(s, { step: { D: "diameter", "2P": "2p1", "3P": "3p1" }[key] }) };
  },
  prompt(s) {
    const texts = { "2p1": "Specify first end point of diameter", "2p2": "Specify second end point of diameter",
      "3p1": "Specify first point on circle", "3p2": "Specify second point on circle", "3p3": "Specify third point on circle", diameter: "Specify diameter" };
    if (s.step === "center") return P("Specify center point or", [{ key: "2P", label: "2 points" }, { key: "3P", label: "3 points" }]);
    if (s.step === "radius") return P("Specify radius or", [{ key: "D", label: "Diameter" }]);
    return P(texts[s.step] || "Circle done");
  },
};

// ── polygon ─────────────────────────────────────────────────────────────────
function polygonDone(s, r, rotDeg) {
  if (!(r > 1e-9)) return { state: s, error: "Radius must be greater than 0" };
  const n = s.sides, c = s.points[0];
  const R = s.inscribed ? r : r / Math.cos(Math.PI / n), a0 = s.inscribed ? rotDeg : rotDeg + 180 / n;
  const v = Array.from({ length: n }, (_, i) => polarPoint(c, R, a0 + (360 * i) / n));
  const segs = v.map((p, i) => lineSeg(p, v[(i + 1) % n]));
  return { state: next(s, { step: "done" }), done: result("polygon", segs, true, `Polygon ${n} sides, ${s.inscribed ? "R" : "apothem"} ${m3(r)} m`) };
}

const polygon = {
  point(s, p) {
    if (s.step === "sides" || s.step === "center") return { state: next(s, { step: "radius", points: [p] }) };
    if (s.step === "radius") return polygonDone(s, dist(s.points[0], p), angleOf(s.points[0], p));
    return { state: s };
  },
  typed(s, t, opts) {
    const n = parseNum(t);
    if (s.step === "sides") {
      return Number.isInteger(n) && n >= 3 && n <= 1024 ? { state: next(s, { sides: n, step: "center" }) } : { state: s, error: "Number of sides must be a whole number from 3 to 1024" };
    }
    if (s.step === "radius" && n !== null) {
      const c = s.points[0];
      const rot = opts.cursorAngleDeg ?? (opts.cursor && !same(opts.cursor, c) ? angleOf(c, opts.cursor) : 90);
      return n > 0 ? polygonDone(s, n, rot) : { state: s, error: NEED_POSITIVE };
    }
    const r = resolveTyped(t, s.step === "radius" ? s.points[0] : null, opts.cursorAngleDeg);
    return r.error ? { state: s, error: r.error } : polygon.point(s, r.point);
  },
  option(s, key) {
    return { state: next(s, { inscribed: key === "I" }) };
  },
  prompt(s) {
    if (s.step === "sides") return P(`Enter number of sides <${s.sides}>`);
    if (s.step === "center") return P("Specify center of polygon");
    if (s.step === "radius") return P(`Specify radius (${s.inscribed ? "inscribed in circle" : "circumscribed about circle"}) or`, [{ key: "I", label: "Inscribed" }, { key: "C", label: "Circumscribed" }]);
    return P("Polygon done");
  },
  finish(s) {
    return s.step === "sides" ? { state: next(s, { step: "center" }) } : null;
  },
};

// ── ellipse ─────────────────────────────────────────────────────────────────
function ellipseDone(s, b) {
  if (!(b > 1e-9)) return { state: s, error: "The other axis must be greater than 0" };
  const [c, e] = s.points, a = dist(c, e), th = (angleOf(c, e) * Math.PI) / 180;
  const v = Array.from({ length: ELLIPSE_SEGMENTS }, (_, i) => {
    const t = (2 * Math.PI * i) / ELLIPSE_SEGMENTS;
    const X = a * Math.cos(t) * Math.cos(th) - b * Math.sin(t) * Math.sin(th);
    const Y = a * Math.cos(t) * Math.sin(th) + b * Math.sin(t) * Math.cos(th);
    return pt(c.x + X, c.y - Y);
  });
  const segs = v.map((p, i) => lineSeg(p, v[(i + 1) % v.length]));
  return { state: next(s, { step: "done" }), done: result("ellipse", segs, true, `Ellipse ${m3(2 * a)} × ${m3(2 * b)} m`) };
}

const ellipse = {
  point(s, p) {
    const c = s.points[0];
    if (s.step === "center") return { state: next(s, { step: "axis", points: [p] }) };
    if (s.step === "axis") return same(p, c) ? { state: s, error: "The axis needs a length" } : { state: next(s, { step: "other", points: [c, p] }) };
    if (s.step === "other") {
      const e = s.points[1], a = dist(c, e), ux = (e.x - c.x) / a, uy = (e.y - c.y) / a;
      return ellipseDone(s, Math.abs(ux * (p.y - c.y) - uy * (p.x - c.x)));
    }
    return { state: s };
  },
  typed(s, t, opts) {
    const n = parseNum(t);
    if (s.step === "other" && n !== null) return n > 0 ? ellipseDone(s, n) : { state: s, error: NEED_POSITIVE };
    const r = resolveTyped(t, s.step === "center" ? null : s.points[0], opts.cursorAngleDeg ?? (opts.cursor && s.points[0] ? angleOf(s.points[0], opts.cursor) : 0));
    return r.error ? { state: s, error: r.error } : ellipse.point(s, r.point);
  },
  prompt(s) {
    return P({ center: "Specify center of ellipse", axis: "Specify endpoint of first axis", other: "Specify distance to other axis" }[s.step] || "Ellipse done");
  },
};

// ── arc ─────────────────────────────────────────────────────────────────────
const arc = {
  point(s, p) {
    if (s.step === "start") return { state: next(s, { step: "second", points: [p] }) };
    const [a, b] = s.points;
    if (same(p, s.points[s.points.length - 1])) return { state: s };
    if (s.step === "second") return { state: next(s, { step: "end", points: [a, p] }) };
    if (s.step !== "end") return { state: s };
    const r = threePointArc(a, b, p);
    if (r.error) return { state: s, error: r.error };
    const segs = s.closedOnly ? [r.seg, lineSeg(r.seg.to, r.seg.from)] : [r.seg];
    const summary = `Arc R ${m3(r.seg.radius)} m, ${m3(Math.abs(r.seg.sweepDeg))}°${s.closedOnly ? " (closed by its chord)" : ""}`;
    return { state: next(s, { step: "done", points: [a, b, p] }), done: result("arc", segs, s.closedOnly, summary) };
  },
  typed(s, t, opts) {
    const r = resolveTyped(t, s.points[s.points.length - 1] || null, opts.cursorAngleDeg);
    return r.error ? { state: s, error: r.error } : arc.point(s, r.point);
  },
  prompt(s) {
    return P({ start: "Specify start point of arc", second: "Specify second point of arc", end: "Specify end point of arc" }[s.step] || "Arc done");
  },
};

const HANDLERS = { pline, rect, circle, polygon, ellipse, arc };

// ── public API ──────────────────────────────────────────────────────────────
export function commandForAlias(text) {
  const t = String(text || "").trim().toUpperCase();
  if (!t) return null;
  const c = DRAFT_COMMANDS.find((cmd) => cmd.key.toUpperCase() === t || cmd.aliases.includes(t));
  return c ? c.key : null;
}

export function createDraft(command, { closedOnly = true } = {}) {
  const key = commandForAlias(command);
  if (!key) throw new Error(`Unknown drawing command: ${command}`);
  return { command: key, closedOnly, step: FIRST_STEP[key], points: [], segments: [], mode: "line", arcSub: null, arcSecond: null, arcRadius: null,
    sides: 6, inscribed: true, fillet: 0, width: null, length: null, dimFlow: false, returnStep: null, history: [] };
}

export function draftPrompt(state) {
  return HANDLERS[state.command].prompt(state);
}

/** opts: { closeTolerance = 0.15 m (polyline click-to-close), tangentDeg (first polyline arc, default 90°) } */
export function draftClick(state, point, opts = {}) {
  return HANDLERS[state.command].point(state, pt(point.x, point.y), opts);
}

export function draftTyped(state, text, opts = {}) {
  const t = String(text ?? "").trim();
  if (!t) return draftFinish(state);
  const key = t.toUpperCase();
  const option = draftPrompt(state).options.find((o) => o.key === key);
  const h = HANDLERS[state.command];
  if (option && h.option) return h.option(state, option.key, opts);
  return h.typed(state, t, opts);
}

export function draftFinish(state) {
  const r = HANDLERS[state.command].finish?.(state);
  if (r) return r;
  const text = draftPrompt(state).text.replace(/ or$/, "");
  return { state, error: `Not finished · ${text.charAt(0).toLowerCase()}${text.slice(1)}` };
}

export function draftUndo(state) {
  const h = state.history || [];
  if (!h.length) return state;
  return { ...h[h.length - 1], history: h.slice(0, -1) };
}

function currentPath(s) {
  if (s.command === "pline") return s.segments.length ? pathPoints(s.segments, false) : s.points.slice(0, 1);
  return s.points.slice();
}

/** The point the rubber band and polar tracking run from (null before the first point). */
export function draftAnchor(s) {
  if (s.command === "pline") return s.step === "start" ? null : plineLast(s);
  if (s.command === "ellipse" || s.command === "polygon" || (s.command === "circle" && (s.step === "radius" || s.step === "diameter"))) return s.points[0] || null;
  return s.points[s.points.length - 1] || null;
}

/** Rubber-band preview of what a click at `cursor` would draw, with live length/angle labels. */
export function draftPreview(state, cursor, { cursorAngleDeg, tangentDeg } = {}) {
  if (!cursor) return { points: currentPath(state), closed: false, guides: [], labels: [] };
  const c = pt(cursor.x, cursor.y);
  const sim = draftClick(state, c, { closeTolerance: 0, tangentDeg: tangentDeg ?? cursorAngleDeg });
  const shape = sim.done ? { points: sim.done.points, closed: sim.done.closed } : { points: currentPath(sim.state), closed: false };
  const anchor = draftAnchor(state);
  const guides = [], labels = [];
  if (anchor && !same(anchor, c)) {
    guides.push({ from: anchor, to: c });
    if (state.command === "rect" && state.step === "second") {
      labels.push({ x: (anchor.x + c.x) / 2, y: anchor.y, text: `${m3(Math.abs(c.x - anchor.x))} m` });
      labels.push({ x: c.x, y: (anchor.y + c.y) / 2, text: `${m3(Math.abs(c.y - anchor.y))} m` });
    } else {
      const m = mid(anchor, c);
      const radial = state.command === "circle" && state.step === "radius";
      labels.push({ x: m.x, y: m.y, text: `${radial ? "R " : ""}${m3(dist(anchor, c))} m` });
      labels.push({ x: c.x, y: c.y, text: `${Math.round(angleOf(anchor, c))}°` });
    }
  }
  return { ...shape, guides, labels };
}
