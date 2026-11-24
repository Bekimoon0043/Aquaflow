/**
 * drafting/freehand.js — Pen tool: turns a raw freehand stroke (plan metres) into clean,
 * editable geometry. Pure (no React, no DOM); every function returns new arrays.
 *
 * Pipeline of cleanStroke():
 *   sanitize → uniform resample (arc length) → close / trim overshoot → corner detection
 *   → shape recognition (line, circle, ellipse, rectangle, straight-edged polygon)
 *   → otherwise corner-preserving Taubin smoothing + Ramer–Douglas–Peucker simplification
 *   → self-intersection cleanup → optional snapping → validity checks.
 *
 * Techniques (see the Pen tool report for sources):
 *   - resampling at a size-relative spacing (as the $1 recognizer and ShortStraw do), so
 *     thresholds are scale-invariant and huge strokes stay cheap;
 *   - corners: turning angle over a ±W window on the resampled stroke (ShortStraw-style
 *     "straw" window), local maxima only;
 *   - smoothing: Taubin λ/μ smoothing (no shrinkage, unlike plain averaging or Chaikin
 *     cutting) with corners pinned;
 *   - simplification: iterative RDP, run piecewise between kept corners;
 *   - recognition: least-squares fits (Kåsa circle, axis-aligned-in-PCA-frame ellipse,
 *     minimum-area rectangle by rotating calipers, PCA line per polygon edge) compared by a
 *     size-normalised RMS error; "force" picks the best fit regardless of thresholds.
 */

export const DEFAULT_PEN_SETTINGS = Object.freeze({
  target: "pool",
  smoothing: 50, // 0 = follow the hand, 100 = very smooth (UI scale)
  recognise: true,
  autoClose: true,
  closePx: 30,
  keepCorners: true,
  snap: false,
});

/** Thresholds of the recogniser (size-normalised RMS errors). */
export const RECOGNITION = Object.freeze({
  line: 0.03, // rms / length
  lineMaxDev: 0.07, // max deviation / length
  circle: 0.06, // rms(|d - r|) / r
  ellipse: 0.07, // rms(normalised radius - 1)
  rect: 0.06, // rms distance to the rectangle / half the short side
  polygonEdge: 0.03, // rms edge deviation / edge length
  polygonMaxEdges: 12,
  circleAspect: 0.88, // ellipse b/a above this is called a circle
  axisSnapDeg: 4, // rect/ellipse/edge directions this close to 0/45/90° snap
  lineSnapDeg: 3, // lines snap to 15° steps within this
});

const EPS = 1e-9;
const TAU = Math.PI * 2;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round4 = (v) => Math.round(v * 1e4) / 1e4;
const pt = (x, y) => ({ x, y });
const finitePoint = (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y));

// ── basics ────────────────────────────────────────────────────────────────────

/** Finite points only, consecutive duplicates (closer than `minDistance`) removed. */
export function sanitizeStroke(points, { minDistance = 1e-6 } = {}) {
  const out = [];
  for (const p of Array.isArray(points) ? points : []) {
    if (!finitePoint(p)) continue;
    const q = pt(Number(p.x), Number(p.y));
    if (out.length && dist(out[out.length - 1], q) <= minDistance) continue;
    out.push(q);
  }
  return out;
}

export function pathLength(points, closed = false) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += dist(points[i - 1], points[i]);
  if (closed && points.length > 2) total += dist(points[points.length - 1], points[0]);
  return total;
}

export function boundsOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, diag: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, diag: Math.hypot(maxX - minX, maxY - minY) };
}

/** Signed shoelace area (positive = counter-clockwise in a y-up frame). */
export function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i], q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Points every `spacing` metres along the polyline (first and last point kept). */
export function resampleStroke(points, spacing, { closed = false, maxPoints = 2000 } = {}) {
  const src = closed && points.length > 2 ? [...points, points[0]] : points;
  if (src.length < 2) return src.map((p) => pt(p.x, p.y));
  const total = pathLength(src);
  if (total <= EPS) return [pt(src[0].x, src[0].y)];
  const step = Math.max(spacing, total / maxPoints, EPS);
  const out = [pt(src[0].x, src[0].y)];
  let carried = 0;
  for (let i = 1; i < src.length; i += 1) {
    const a = src[i - 1], b = src[i];
    const seg = dist(a, b);
    if (seg <= EPS) continue;
    let t = step - carried;
    while (t <= seg + EPS) {
      const f = Math.min(1, t / seg);
      out.push(pt(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f));
      t += step;
    }
    carried = seg - (t - step);
  }
  const last = src[src.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.25) out.push(pt(last.x, last.y));
  else out[out.length - 1] = pt(last.x, last.y);
  if (closed && out.length > 2 && dist(out[0], out[out.length - 1]) < step * 0.5) out.pop();
  return out;
}

export function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= EPS * EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer–Douglas–Peucker (iterative, so a 100k-point stroke cannot overflow the stack).
 * Every dropped point lies within `epsilon` of the result. Endpoints are always kept.
 */
export function simplifyRDP(points, epsilon) {
  if (points.length < 3) return points.map((p) => pt(p.x, p.y));
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = -1, index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = pointSegmentDistance(points[i], points[first], points[last]);
      if (d > maxD) { maxD = d; index = i; }
    }
    if (index >= 0 && maxD > epsilon) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(pt(points[i].x, points[i].y));
  return out;
}

/** RDP for a closed ring: split at index 0 and the point farthest from it. */
export function simplifyClosedRDP(points, epsilon) {
  if (points.length < 4) return points.map((p) => pt(p.x, p.y));
  let far = 1, farD = -1;
  for (let i = 1; i < points.length; i += 1) { const d = dist(points[0], points[i]); if (d > farD) { farD = d; far = i; } }
  const a = simplifyRDP(points.slice(0, far + 1), epsilon);
  const b = simplifyRDP([...points.slice(far), points[0]], epsilon);
  return [...a, ...b.slice(1, -1)];
}

// ── corners and smoothing ─────────────────────────────────────────────────────

const turnAngle = (a, b, c) => {
  const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
  const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
  if (lu <= EPS || lv <= EPS) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
};

/**
 * Corner indices of a resampled stroke: the turning angle between p[i-W]→p[i] and
 * p[i]→p[i+W] reaches `angleDeg`, and is the largest within ±W (one corner per bend).
 */
export function findCorners(points, { closed = false, window = 3, angleDeg = 42 } = {}) {
  const n = points.length;
  const W = Math.max(1, Math.min(window, Math.floor((n - 1) / 2)));
  if (n < 2 * W + 1 || n < 3) return [];
  const limit = (angleDeg * Math.PI) / 180;
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    if (!closed && (i < W || i > n - 1 - W)) continue;
    turn[i] = turnAngle(points[(i - W + n) % n], points[i], points[(i + W) % n]);
  }
  const corners = [];
  for (let i = 0; i < n; i += 1) {
    if (turn[i] < limit) continue;
    let isMax = true;
    for (let k = 1; k <= W && isMax; k += 1) {
      const l = closed ? (i - k + n) % n : i - k, r = closed ? (i + k) % n : i + k;
      // Plateaus: the leftmost sample of an equal run wins.
      if (l >= 0 && turn[l] >= turn[i]) isMax = false;
      if (r < n && turn[r] > turn[i]) isMax = false;
    }
    if (isMax) corners.push(i);
  }
  // Keep corners at least W apart (a flat-topped angle plateau can yield two).
  const spaced = [];
  for (const c of corners) {
    const prev = spaced[spaced.length - 1];
    if (prev !== undefined && c - prev < W) { if (turn[c] > turn[prev]) spaced[spaced.length - 1] = c; continue; }
    spaced.push(c);
  }
  if (closed && spaced.length > 1 && spaced[0] + n - spaced[spaced.length - 1] < W) {
    if (turn[spaced[0]] >= turn[spaced[spaced.length - 1]]) spaced.pop(); else spaced.shift();
  }
  return spaced;
}

/**
 * Taubin λ|μ smoothing (Laplacian smoothing that does not shrink the shape). Pinned indices
 * (corners, open-stroke endpoints) never move.
 */
export function taubinSmooth(points, { closed = false, iterations = 4, pinned = [], lambda = 0.5, mu = -0.53 } = {}) {
  const n = points.length;
  if (n < 3 || iterations <= 0) return points.map((p) => pt(p.x, p.y));
  const fixed = new Uint8Array(n);
  for (const i of pinned) if (i >= 0 && i < n) fixed[i] = 1;
  if (!closed) { fixed[0] = 1; fixed[n - 1] = 1; }
  let cur = points.map((p) => pt(p.x, p.y));
  const pass = (factor) => {
    const next = cur.map((p) => pt(p.x, p.y));
    for (let i = 0; i < n; i += 1) {
      if (fixed[i]) continue;
      const a = cur[(i - 1 + n) % n], b = cur[(i + 1) % n];
      next[i].x = cur[i].x + factor * ((a.x + b.x) / 2 - cur[i].x);
      next[i].y = cur[i].y + factor * ((a.y + b.y) / 2 - cur[i].y);
    }
    cur = next;
  };
  for (let k = 0; k < iterations; k += 1) { pass(lambda); pass(mu); }
  return cur;
}

// ── closing and self-intersections ───────────────────────────────────────────

export function segmentIntersection(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) <= EPS * EPS) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: a.x + t * rx, y: a.y + t * ry, t, u };
}

/**
 * Close a stroke. An overshoot (the end crossing the start) is trimmed at the crossing;
 * otherwise the ends are joined when the gap is within `tolerance`, or always with `force`.
 * Returns { points, closed, trimmed }.
 */
export function closeStroke(points, { tolerance = 0, force = false, searchFraction = 0.3 } = {}) {
  const n = points.length;
  if (n < 3) return { points: points.map((p) => pt(p.x, p.y)), closed: false, trimmed: false };
  const gap = dist(points[0], points[n - 1]);
  const total = pathLength(points);
  if (force || gap <= Math.max(tolerance, total * 0.2)) {
    // Overshoot: a segment near the start crosses a segment near the end.
    const head = Math.max(2, Math.floor(n * searchFraction));
    let best = null;
    for (let i = 0; i < Math.min(head, n - 1); i += 1) {
      for (let j = n - 2; j >= Math.max(i + 2, n - 1 - head); j -= 1) {
        const x = segmentIntersection(points[i], points[i + 1], points[j], points[j + 1]);
        if (x && (!best || j - i > best.j - best.i)) best = { i, j, x };
      }
    }
    if (best) {
      const loop = dedupeRing([pt(best.x.x, best.x.y), ...points.slice(best.i + 1, best.j + 1).map((p) => pt(p.x, p.y))]);
      if (loop.length >= 3) return { points: loop, closed: true, trimmed: true };
    }
  }
  if (gap <= tolerance || force) return { points: points.map((p) => pt(p.x, p.y)), closed: true, trimmed: false };
  return { points: points.map((p) => pt(p.x, p.y)), closed: false, trimmed: false };
}

/** First pair of non-adjacent crossing edges of a closed ring, or null. */
export function findSelfIntersection(points) {
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i], b = points[(i + 1) % n];
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const x = segmentIntersection(a, b, points[j], points[(j + 1) % n]);
      if (x) return { i, j, point: pt(x.x, x.y) };
    }
  }
  return null;
}

/** Make a closed ring simple: split at each crossing and keep the larger-area loop. */
export function removeSelfIntersections(points, { maxPasses = 64 } = {}) {
  let ring = points.map((p) => pt(p.x, p.y));
  let removed = 0;
  for (let pass = 0; pass < maxPasses && ring.length > 3; pass += 1) {
    const hit = findSelfIntersection(ring);
    if (!hit) break;
    const { i, j, point } = hit;
    const loopA = [point, ...ring.slice(i + 1, j + 1)];
    const loopB = [point, ...ring.slice(j + 1), ...ring.slice(0, i + 1)];
    ring = Math.abs(polygonArea(loopA)) >= Math.abs(polygonArea(loopB)) ? loopA : loopB;
    ring = dedupeRing(ring);
    removed += 1;
  }
  return { points: ring, removed };
}

function dedupeRing(points, tol = 1e-7) {
  const out = sanitizeStroke(points, { minDistance: tol });
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= tol) out.pop();
  return out;
}

// ── least-squares fits ────────────────────────────────────────────────────────

/** Points s..e of a ring, wrapping past the end (s === e walks the whole ring). */
function ringRun(points, s, e) {
  const n = points.length;
  const run = [points[s]];
  for (let i = (s + 1) % n; ; i = (i + 1) % n) { run.push(points[i]); if (i === e) break; }
  return run;
}

function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return pt(x / points.length, y / points.length);
}

/** Principal axis: { center, angle (rad), major, minor (std devs) }. */
export function principalAxes(points) {
  const c = centroid(points);
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) { const dx = p.x - c.x, dy = p.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const n = Math.max(1, points.length);
  sxx /= n; syy /= n; sxy /= n;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  return { center: c, angle, major: Math.sqrt(Math.max(0, tr / 2 + disc)), minor: Math.sqrt(Math.max(0, tr / 2 - disc)) };
}

function solve3(m, v) {
  // Cramer's rule on a 3×3 system.
  const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-18) return null;
  return [0, 1, 2].map((k) => det(m.map((row, r) => row.map((val, cIdx) => (cIdx === k ? v[r] : val)))) / d);
}

/** Kåsa algebraic circle fit. Returns { center, radius, error } (error = rms(|d-r|)/r). */
export function fitCircle(points) {
  if (points.length < 3) return null;
  const c0 = centroid(points);
  let suu = 0, svv = 0, suv = 0, su = 0, sv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of points) {
    const u = p.x - c0.x, v = p.y - c0.y;
    suu += u * u; svv += v * v; suv += u * v; su += u; sv += v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const n = points.length;
  const sol = solve3([[suu, suv, su], [suv, svv, sv], [su, sv, n]], [-(suuu + suvv), -(svvv + svuu), -(suu + svv)]);
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2, cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > EPS)) return null;
  const radius = Math.sqrt(r2);
  const center = pt(c0.x + cx, c0.y + cy);
  let acc = 0;
  for (const p of points) { const e = dist(p, center) - radius; acc += e * e; }
  return { center, radius, error: Math.sqrt(acc / n) / radius };
}

/** Ellipse in the PCA frame: least squares A·u² + B·v² = 1. { center, rx, ry, angle, error }. */
export function fitEllipse(points) {
  if (points.length < 5) return null;
  const { center, angle } = principalAxes(points);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let s40 = 0, s04 = 0, s22 = 0, s20 = 0, s02 = 0;
  const uv = points.map((p) => {
    const dx = p.x - center.x, dy = p.y - center.y;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    s40 += u ** 4; s04 += v ** 4; s22 += u * u * v * v; s20 += u * u; s02 += v * v;
    return [u, v];
  });
  const det = s40 * s04 - s22 * s22;
  if (Math.abs(det) < 1e-18) return null;
  const A = (s20 * s04 - s02 * s22) / det, B = (s40 * s02 - s22 * s20) / det;
  if (!(A > 0 && B > 0)) return null;
  const rx = 1 / Math.sqrt(A), ry = 1 / Math.sqrt(B);
  let acc = 0;
  for (const [u, v] of uv) { const e = Math.sqrt(u * u * A + v * v * B) - 1; acc += e * e; }
  return { center, rx, ry, angle, error: Math.sqrt(acc / points.length) };
}

/** Andrew's monotone-chain convex hull. */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i -= 1) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const rectDistance = (u, v, hw, hh) => {
  const ax = Math.abs(u), ay = Math.abs(v);
  if (ax <= hw && ay <= hh) return Math.min(hw - ax, hh - ay);
  return Math.hypot(Math.max(ax - hw, 0), Math.max(ay - hh, 0));
};

/** Rectangle fit: minimum-area bounding box (rotating calipers over the hull edges). */
export function fitRectangle(points) {
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * cos + p.y * sin, v = -p.x * sin + p.y * cos;
      if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, angle, minU, maxU, minV, maxV };
  }
  return rectFromFrame(points, best.angle, best);
}

function rectFromFrame(points, angle, box) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let { minU, maxU, minV, maxV } = box || {};
  if (!box) {
    minU = Infinity; maxU = -Infinity; minV = Infinity; maxV = -Infinity;
    for (const p of points) {
      const u = p.x * cos + p.y * sin, v = -p.x * sin + p.y * cos;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
  }
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  const hw = (maxU - minU) / 2, hh = (maxV - minV) / 2;
  if (!(hw > EPS && hh > EPS)) return null;
  const center = pt(cu * cos - cv * sin, cu * sin + cv * cos);
  let acc = 0;
  for (const p of points) {
    const u = p.x * cos + p.y * sin - cu, v = -p.x * sin + p.y * cos - cv;
    const d = rectDistance(u, v, hw, hh); acc += d * d;
  }
  return { center, width: hw * 2, height: hh * 2, angle, error: Math.sqrt(acc / points.length) / Math.min(hw, hh) };
}

export function rectCorners({ center, width, height, angle }) {
  const cos = Math.cos(angle), sin = Math.sin(angle), hw = width / 2, hh = height / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => pt(center.x + u * cos - v * sin, center.y + u * sin + v * cos));
}

export function ellipsePoints({ center, rx, ry, angle = 0 }, segments = 48) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return Array.from({ length: segments }, (_, k) => {
    const t = (k / segments) * TAU, u = rx * Math.cos(t), v = ry * Math.sin(t);
    return pt(center.x + u * cos - v * sin, center.y + u * sin + v * cos);
  });
}

/** Snap an angle (rad) to the nearest multiple of `stepDeg` when within `withinDeg`. */
export function snapAngle(angle, stepDeg, withinDeg) {
  const step = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(angle / step) * step;
  return Math.abs(snapped - angle) <= (withinDeg * Math.PI) / 180 ? snapped : angle;
}

/** Line fit (PCA). { a, b, length, error (rms/length), maxDev (max/length), angle }. */
export function fitLine(points) {
  if (points.length < 2) return null;
  const { center, angle } = principalAxes(points);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const proj = (p) => (p.x - center.x) * cos + (p.y - center.y) * sin;
  const t0 = proj(points[0]), t1 = proj(points[points.length - 1]);
  const a = pt(center.x + t0 * cos, center.y + t0 * sin), b = pt(center.x + t1 * cos, center.y + t1 * sin);
  const length = Math.abs(t1 - t0);
  if (length <= EPS) return null;
  let acc = 0, maxDev = 0;
  for (const p of points) { const d = Math.abs(-(p.x - center.x) * sin + (p.y - center.y) * cos); acc += d * d; maxDev = Math.max(maxDev, d); }
  return { a, b, length, angle, center, error: Math.sqrt(acc / points.length) / length, maxDev: maxDev / length };
}

function lineIntersection(p, angP, q, angQ) {
  const dx1 = Math.cos(angP), dy1 = Math.sin(angP), dx2 = Math.cos(angQ), dy2 = Math.sin(angQ);
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < Math.sin((10 * Math.PI) / 180)) return null; // nearly parallel
  const t = ((q.x - p.x) * dy2 - (q.y - p.y) * dx2) / den;
  return pt(p.x + t * dx1, p.y + t * dy1);
}

/**
 * Straight-edged polygon/polyline through the corners: each edge is a least-squares line of
 * its stroke points (direction snapped to 45° steps when close); vertices are where
 * consecutive edge lines meet. Returns { points, error } (error = worst rms/edge length).
 */
export function fitPolygonEdges(points, corners, { closed = true, axisSnapDeg = RECOGNITION.axisSnapDeg } = {}) {
  const n = points.length;
  const breaks = closed ? [...corners] : [0, ...corners.filter((c) => c > 0 && c < n - 1), n - 1];
  const edgeCount = closed ? breaks.length : breaks.length - 1;
  if ((closed && edgeCount < 3) || (!closed && edgeCount < 1)) return null;
  const edges = [];
  let worst = 0;
  for (let k = 0; k < edgeCount; k += 1) {
    const s = breaks[k], e = breaks[(k + 1) % breaks.length];
    const run = ringRun(points, s, e);
    const fit = fitLine(run.length >= 2 ? run : [points[s], points[e]]);
    if (!fit) return null;
    worst = Math.max(worst, fit.error);
    edges.push({ ...fit, angle: snapAngle(fit.angle, 45, axisSnapDeg), from: points[s], to: points[e] });
  }
  const vertexAt = (prev, next, fallback) => lineIntersection(prev.center, prev.angle, next.center, next.angle) || fallback;
  const out = [];
  if (closed) {
    for (let k = 0; k < edgeCount; k += 1) out.push(vertexAt(edges[(k - 1 + edgeCount) % edgeCount], edges[k], edges[k].from));
  } else {
    const project = (edge, p) => {
      const cos = Math.cos(edge.angle), sin = Math.sin(edge.angle);
      const t = (p.x - edge.center.x) * cos + (p.y - edge.center.y) * sin;
      return pt(edge.center.x + t * cos, edge.center.y + t * sin);
    };
    out.push(project(edges[0], points[0]));
    for (let k = 1; k < edgeCount; k += 1) out.push(vertexAt(edges[k - 1], edges[k], edges[k].from));
    out.push(project(edges[edgeCount - 1], points[n - 1]));
  }
  // A vertex flung far away by a near-parallel pair falls back to the stroke's own point.
  const size = boundsOf(points).diag || 1;
  const fixed = out.map((p, k) => {
    const ref = closed ? edges[k].from : k === 0 ? points[0] : k === out.length - 1 ? points[n - 1] : edges[k].from;
    return dist(p, ref) > size * 0.25 ? pt(ref.x, ref.y) : p;
  });
  return { points: fixed, error: worst };
}

// ── recognition ───────────────────────────────────────────────────────────────

/**
 * Recognise a perfect primitive in a resampled stroke. Returns null (nothing close enough)
 * or { kind: line | polyline | circle | ellipse | rect | polygon, error, … }.
 * `force` returns the best candidate even when it is outside the thresholds.
 */
export function recogniseShape(points, { closed = false, corners = null, force = false, thresholds = RECOGNITION } = {}) {
  if (points.length < 3) return null;
  const cornerIdx = corners || findCorners(points, { closed });
  const candidates = [];
  if (!closed) {
    const line = fitLine(points);
    if (line) {
      const ok = line.error <= thresholds.line && line.maxDev <= thresholds.lineMaxDev;
      candidates.push({ kind: "line", error: line.error / thresholds.line, pass: ok, line });
    }
    if (cornerIdx.length >= 1 && cornerIdx.length < thresholds.polygonMaxEdges) {
      const poly = fitPolygonEdges(points, cornerIdx, { closed: false });
      if (poly) candidates.push({ kind: "polyline", error: poly.error / thresholds.polygonEdge, pass: poly.error <= thresholds.polygonEdge, points: poly.points });
    }
  } else {
    const smoothish = cornerIdx.length <= 2;
    const circle = fitCircle(points);
    const ellipse = fitEllipse(points);
    if (circle && (smoothish || force)) candidates.push({ kind: "circle", error: circle.error / thresholds.circle, pass: smoothish && circle.error <= thresholds.circle, circle });
    if (ellipse && (smoothish || force)) {
      const aspect = Math.min(ellipse.rx, ellipse.ry) / Math.max(ellipse.rx, ellipse.ry);
      if (aspect < thresholds.circleAspect) {
        candidates.push({ kind: "ellipse", error: ellipse.error / thresholds.ellipse, pass: smoothish && ellipse.error <= thresholds.ellipse, ellipse });
      }
    }
    const rect = fitRectangle(points);
    const rectCornerOk = cornerIdx.length >= 3 && cornerIdx.length <= 6;
    if (rect && (rectCornerOk || force)) candidates.push({ kind: "rect", error: rect.error / thresholds.rect, pass: rectCornerOk && rect.error <= thresholds.rect, rect });
    // A rectangle is the stronger claim: a box that passes as a rectangle never becomes a polygon.
    const rectPasses = candidates.some((c) => c.kind === "rect" && c.pass);
    if (!rectPasses && cornerIdx.length >= 3 && cornerIdx.length <= thresholds.polygonMaxEdges) {
      const poly = fitPolygonEdges(points, cornerIdx, { closed: true });
      if (poly) candidates.push({ kind: "polygon", error: poly.error / thresholds.polygonEdge, pass: poly.error <= thresholds.polygonEdge, points: poly.points });
    }
  }
  const pool = force ? candidates : candidates.filter((c) => c.pass);
  if (!pool.length) return null;
  pool.sort((a, b) => a.error - b.error);
  return pool[0];
}

// ── the whole pipeline ────────────────────────────────────────────────────────

const smoothingFraction = (value) => Math.max(0, Math.min(1, Number(value ?? 50) / 100));

/**
 * Clean a raw stroke.
 * opts: { mode: "area" | "line" (area = must be a closed polygon), smoothing 0-100,
 *         recognise, force (make perfect), straighten, keepCorners, autoClose,
 *         closeTolerance (m), minArea (m²), minLength (m), snap(point)→point, circleSegments }
 * Returns { ok, error?, kind, closed, points, circle?, ellipse?, rect?, corners, notes, stats }.
 */
export function cleanStroke(raw, opts = {}) {
  const {
    mode = "area", recognise = true, force = false, straighten = false, keepCorners = true, autoClose = true,
    closeTolerance = 0.5, minArea = 0.05, minLength = 0.1, snap = null, circleSegments = 48,
  } = opts;
  const s = smoothingFraction(opts.smoothing);
  const notes = [];
  const fail = (error) => ({ ok: false, error, kind: null, closed: false, points: [], corners: [], notes });
  const clean = sanitizeStroke(raw);
  if (clean.length < 2) return fail("The stroke is too short to make a shape.");
  const box = boundsOf(clean);
  const length = pathLength(clean);
  if (length < Math.max(minLength, EPS) || box.diag < EPS) return fail("The stroke is too short to make a shape.");

  // 1. Uniform resample: ~48 samples across the shape, at most 2000 in all.
  const spacing = Math.max(box.diag / 48, length / 2000);
  let pts = resampleStroke(clean, spacing);

  // 2. Close (and trim an overshoot past the start).
  let closed = false;
  if (mode === "area") {
    const gap = dist(pts[0], pts[pts.length - 1]);
    if (!autoClose && gap > closeTolerance) return fail("The outline is not closed: finish near the start point, or turn Auto-close on.");
    const res = closeStroke(pts, { tolerance: closeTolerance, force: true });
    pts = res.points; closed = true;
    if (res.trimmed) notes.push("trimmed the overlap at the start");
  } else if (autoClose) {
    const res = closeStroke(pts, { tolerance: closeTolerance, force: false });
    if (res.closed && dist(clean[0], clean[clean.length - 1]) <= closeTolerance) { pts = res.points; closed = true; if (res.trimmed) notes.push("trimmed the overlap at the start"); }
  }
  if (closed) pts = resampleStroke(pts, spacing, { closed: true });
  if (closed && pts.length < 3) return fail("The stroke is too small to make an outline.");
  const corners = findCorners(pts, { closed });

  // 3. Perfect shapes.
  let out = null;
  if (recognise || force) {
    const shape = recogniseShape(pts, { closed, corners, force });
    if (shape) out = shapeOutput(shape, { closed, circleSegments, snap });
  }

  // 4. Straight edges between corners.
  if (!out && straighten) {
    const poly = fitPolygonEdges(pts, corners, { closed });
    if (poly) out = { kind: closed ? "polygon" : "polyline", closed, points: poly.points.map((p) => applySnap(p, snap)) };
    else if (!closed) { const line = fitLine(pts); if (line) out = { kind: "line", closed: false, points: [applySnap(line.a, snap), applySnap(line.b, snap)] }; }
    else notes.push("no corners found to straighten");
  }

  // 5. Freeform: corner-preserving Taubin smoothing, then RDP piecewise between corners.
  if (!out) {
    const pinned = keepCorners ? corners : [];
    const smooth = taubinSmooth(pts, { closed, pinned, iterations: Math.round(s * 24) });
    const epsilon = box.diag * (0.003 + 0.03 * s);
    let simple = simplifyPinned(smooth, pinned, epsilon, closed);
    if (snap && pinned.length) {
      const pinnedSet = new Set(pinned.map((i) => `${round4(smooth[i].x)},${round4(smooth[i].y)}`));
      simple = simple.map((p) => (pinnedSet.has(`${round4(p.x)},${round4(p.y)}`) ? applySnap(p, snap) : p));
    }
    if (snap && !closed && simple.length >= 2) { simple[0] = applySnap(simple[0], snap); simple[simple.length - 1] = applySnap(simple[simple.length - 1], snap); }
    out = { kind: closed ? "freeform" : "polyline", closed, points: simple };
  }

  // 6. Self-intersections and validity.
  let points = out.points;
  if (out.closed && !["circle", "ellipse", "rect"].includes(out.kind)) {
    const fixed = removeSelfIntersections(dedupeRing(points));
    points = fixed.points;
    if (fixed.removed) notes.push(`removed ${fixed.removed} crossing loop${fixed.removed > 1 ? "s" : ""}`);
  }
  points = out.closed ? dedupeRing(points) : sanitizeStroke(points, { minDistance: 1e-7 });
  points = points.map((p) => pt(round4(p.x), round4(p.y)));
  if (out.closed) {
    if (points.length < 3) return fail("The stroke is too small to make an outline.");
    const area = Math.abs(polygonArea(points));
    if (area < minArea) return fail(`The outline is too small (${area.toFixed(2)} m², needs ${minArea} m²).`);
    if (findSelfIntersection(points)) return fail("The outline crosses itself.");
  } else {
    if (points.length < 2 || pathLength(points) < minLength) return fail("The line is too short.");
  }
  return {
    ok: true, ...out, points, corners, notes,
    stats: { rawPoints: Array.isArray(raw) ? raw.length : 0, samples: pts.length, vertices: points.length, length },
  };
}

function applySnap(p, snap) {
  if (typeof snap !== "function") return p;
  const q = snap(p);
  return finitePoint(q) ? pt(Number(q.x), Number(q.y)) : p;
}

/** RDP run separately between consecutive pinned indices so every pinned point survives. */
function simplifyPinned(points, pinned, epsilon, closed) {
  const n = points.length;
  if (!pinned.length) return closed ? simplifyClosedRDP(points, epsilon) : simplifyRDP(points, epsilon);
  const sorted = [...new Set(pinned)].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
  if (!closed) {
    const breaks = [0, ...sorted.filter((i) => i > 0 && i < n - 1), n - 1];
    const out = [];
    for (let k = 0; k < breaks.length - 1; k += 1) {
      const part = simplifyRDP(points.slice(breaks[k], breaks[k + 1] + 1), epsilon);
      out.push(...(k === 0 ? part : part.slice(1)));
    }
    return out;
  }
  const out = [];
  for (let k = 0; k < sorted.length; k += 1) {
    const s = sorted[k], e = sorted[(k + 1) % sorted.length];
    const run = ringRun(points, s, e);
    const part = simplifyRDP(run, epsilon);
    out.push(...part.slice(0, -1));
  }
  return out;
}

function shapeOutput(shape, { closed, circleSegments, snap }) {
  if (shape.kind === "line") {
    const { line } = shape;
    const angle = snapAngle(Math.atan2(line.b.y - line.a.y, line.b.x - line.a.x), 15, RECOGNITION.lineSnapDeg);
    const a = applySnap(line.a, snap);
    const len = line.length;
    let b = pt(a.x + Math.cos(angle) * len, a.y + Math.sin(angle) * len);
    if (snap) b = applySnap(b, snap);
    return { kind: "line", closed: false, points: [a, b] };
  }
  if (shape.kind === "circle") {
    const center = applySnap(shape.circle.center, snap);
    const radius = shape.circle.radius;
    return { kind: "circle", closed: true, circle: { center, radius }, points: ellipsePoints({ center, rx: radius, ry: radius }, circleSegments) };
  }
  if (shape.kind === "ellipse") {
    let { center, rx, ry, angle } = shape.ellipse;
    angle = snapAngle(angle, 90, RECOGNITION.axisSnapDeg);
    // Normalise to rx along x when the axis snapped to 90°.
    const quarter = Math.round(angle / (Math.PI / 2));
    if (Math.abs(angle - quarter * (Math.PI / 2)) < 1e-9 && Math.abs(quarter) % 2 === 1) { [rx, ry] = [ry, rx]; angle = 0; }
    else if (Math.abs(angle - quarter * (Math.PI / 2)) < 1e-9) angle = 0;
    center = applySnap(center, snap);
    return { kind: "ellipse", closed: true, ellipse: { center, rx, ry, angle, axisAligned: angle === 0 }, points: ellipsePoints({ center, rx, ry, angle }, circleSegments) };
  }
  if (shape.kind === "rect") {
    let { center, width, height, angle } = shape.rect;
    const snapped = snapAngle(angle, 90, RECOGNITION.axisSnapDeg);
    const quarter = Math.round(snapped / (Math.PI / 2));
    let axisAligned = false;
    if (snapped !== angle || Math.abs(angle - quarter * (Math.PI / 2)) < 1e-9) {
      if (Math.abs(quarter) % 2 === 1) [width, height] = [height, width];
      angle = 0; axisAligned = true;
    }
    let corners;
    if (axisAligned && snap) {
      const a = applySnap(pt(center.x - width / 2, center.y - height / 2), snap);
      const b = applySnap(pt(center.x + width / 2, center.y + height / 2), snap);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      center = pt((x0 + x1) / 2, (y0 + y1) / 2); width = x1 - x0; height = y1 - y0;
    } else if (snap) center = applySnap(center, snap);
    corners = rectCorners({ center, width, height, angle });
    return { kind: "rect", closed: true, rect: { center, width, height, angle, axisAligned }, points: corners };
  }
  // polygon / polyline
  return { kind: shape.kind, closed, points: shape.points.map((p) => applySnap(p, snap)) };
}

/** Labels for the UI. */
export const PEN_KIND_LABEL = Object.freeze({
  circle: "circle", ellipse: "ellipse", rect: "rectangle", polygon: "straight-edged outline", line: "straight line",
  polyline: "line", freeform: "smooth outline",
});
