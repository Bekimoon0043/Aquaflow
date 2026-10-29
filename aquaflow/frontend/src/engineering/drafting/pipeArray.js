/**
 * drafting/pipeArray.js — place fixtures evenly along any line on the drawing: a pipe
 * (straight, polyline, 3-point curve or 3-point arc), a drawn guide line, or a closed outline
 * (basin, land surface, depth zone). Finds the pump that feeds a pipe and pairs lights with
 * the nozzles already on the same line. Pure — no React.
 */
import { createFixtureEntity } from "./entities";
import { basinOuterPoints, tessellateGeometry } from "../basins";

const r3 = (v) => Number(Number(v).toFixed(3));

function circleThrough(p0, p1, p2) {
  const a = p0.x * (p1.y - p2.y) - p0.y * (p1.x - p2.x) + p1.x * p2.y - p2.x * p1.y;
  if (Math.abs(a) < 1e-9) return null;
  const s0 = p0.x ** 2 + p0.y ** 2, s1 = p1.x ** 2 + p1.y ** 2, s2 = p2.x ** 2 + p2.y ** 2;
  const cx = (s0 * (p1.y - p2.y) + s1 * (p2.y - p0.y) + s2 * (p0.y - p1.y)) / (2 * a);
  const cy = (s0 * (p2.x - p1.x) + s1 * (p0.x - p2.x) + s2 * (p1.x - p0.x)) / (2 * a);
  return { cx, cy, r: Math.hypot(p0.x - cx, p0.y - cy) };
}

/** The pipe's centreline as a dense polyline, matching how the designer draws it. */
export function pipePath(pipe, steps = 64) {
  const pts = (pipe?.points || []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (pts.length < 2) return pts;
  const [p0, p1, p2] = pts;
  if (pipe.drawMode === "curve" && pts.length >= 3) {
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps, u = 1 - t;
      return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
    });
  }
  if (pipe.drawMode === "arc" && pts.length >= 3) {
    const c = circleThrough(p0, p1, p2);
    if (!c) return [p0, p2];
    const ang = (p) => Math.atan2(p.y - c.cy, p.x - c.cx);
    const a0 = ang(p0), am = ang(p1), a2 = ang(p2);
    const ccwSweep = (from, to) => ((to - from) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    // Go the way round that passes through the middle point.
    const sweep = ccwSweep(a0, am) <= ccwSweep(a0, a2) ? ccwSweep(a0, a2) : ccwSweep(a0, a2) - 2 * Math.PI;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const a = a0 + sweep * (i / steps);
      return { x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) };
    });
  }
  if (pipe.closed && pts.length >= 3) {
    const a = pts[0], b = pts.at(-1);
    return Math.hypot(a.x - b.x, a.y - b.y) > 1e-9 ? [...pts, a] : pts;
  }
  return pts;
}

export function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i += 1) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return len;
}

/**
 * Stations along a path. Open paths: `count` fixtures from `endGap` metres after the start to
 * `endGap` before the end (or every `spacing` metres when spacing > 0). Closed paths: spread
 * evenly round the whole perimeter from the first vertex (end gaps ignored). Each station is
 * pushed `sideOffset` metres to the left (+) or right (−) of the direction of travel.
 * @returns {{x,y,rotation,along}[]} rotation = path direction in degrees (plan frame)
 */
export function stationsAlongPipe(pipe, { count = 8, spacing = 0, endGap = 0, sideOffset = 0 } = {}) {
  const path = pipePath(pipe);
  const total = pathLength(path);
  if (total <= 1e-6) return [];
  const closed = Boolean(pipe.closed && path.length >= 4);
  const gap = closed ? 0 : Math.min(Math.max(0, Number(endGap) || 0), total / 2);
  const usable = total - 2 * gap;
  let along;
  if (closed) {
    const n = Number(spacing) > 0 ? Math.max(1, Math.floor(total / spacing + 1e-9)) : Math.max(1, Math.round(Number(count) || 1));
    const step = Number(spacing) > 0 ? spacing : total / n;
    along = Array.from({ length: n }, (_, i) => i * step);
  } else if (Number(spacing) > 0) {
    const n = Math.floor(usable / spacing + 1e-9) + 1;
    const start = gap + (usable - (n - 1) * spacing) / 2;
    along = Array.from({ length: n }, (_, i) => start + i * spacing);
  } else {
    const n = Math.max(1, Math.round(Number(count) || 1));
    along = n === 1 ? [total / 2] : Array.from({ length: n }, (_, i) => gap + (usable * i) / (n - 1));
  }
  const out = [];
  let seg = 1, segStart = 0;
  for (const s of along) {
    while (seg < path.length - 1 && segStart + Math.hypot(path[seg].x - path[seg - 1].x, path[seg].y - path[seg - 1].y) < s) {
      segStart += Math.hypot(path[seg].x - path[seg - 1].x, path[seg].y - path[seg - 1].y);
      seg += 1;
    }
    const a = path[seg - 1], b = path[seg];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(1, Math.max(0, (s - segStart) / L));
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    // Left of travel on screen (plan y runs down): (uy, -ux).
    out.push({
      x: r3(a.x + (b.x - a.x) * t + uy * sideOffset), y: r3(a.y + (b.y - a.y) * t - ux * sideOffset),
      rotation: Number((Math.atan2(uy, ux) * 180 / Math.PI).toFixed(1)), along: r3(s),
    });
  }
  return out;
}

const near = (p, q, tol) => p && q && Math.hypot(p.x - q.x, p.y - q.y) <= tol;

/**
 * The pump feeding this pipe: a pump at either end, or at the end of any pipe joined to it
 * end-to-end (searched through the network), or a pump whose position is on a pipe end.
 */
export function pumpForPipe(pipe, pipes = [], fixtures = [], tol = 0.05) {
  const pumps = fixtures.filter((f) => /pump/i.test(String(f.type || "")) && !/vfd|panel/i.test(String(f.type || "")));
  if (!pipe || !pumps.length) return null;
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const seen = new Set([pipe.id]);
  const queue = [pipe];
  while (queue.length) {
    const p = queue.shift();
    for (const end of ["start", "end"]) {
      const f = byId.get(p.connections?.[end]?.fixtureId);
      if (f && pumps.includes(f)) return f;
    }
    const ends = [p.points?.[0], p.points?.at?.(-1)].filter(Boolean);
    const hit = pumps.find((pump) => ends.some((e) => Math.hypot(e.x - pump.x, e.y - pump.y) <= Math.max(tol, 0.6)));
    if (hit) return hit;
    for (const q of pipes) {
      if (seen.has(q.id)) continue;
      const qe = [q.points?.[0], q.points?.at?.(-1)];
      // Joined end-to-end, or a branch that starts/ends anywhere on this pipe's vertices.
      if (ends.some((e) => qe.some((x) => near(e, x, tol))) || (q.points || []).some((v) => qe.some((x) => near(v, x, tol))) || (p.points || []).some((v) => qe.some((x) => near(v, x, tol)))) {
        seen.add(q.id);
        queue.push(q);
      }
    }
  }
  return null;
}

/** The guide line within `tol` metres of `pt` (nearest), or null. */
export function hitGuide(guides = [], pt, tol = 0.2) {
  let best = null;
  for (const g of guides) {
    const path = pipePath({ ...g, drawMode: "polyline" });
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1], b = path[i];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / L2));
      const d = Math.hypot(a.x + dx * t - pt.x, a.y + dy * t - pt.y);
      if (d <= tol && (!best || d < best.d)) best = { d, g };
    }
  }
  return best?.g || null;
}

const isNozzleType =(t) => /^nozzle|jet|geyser|foam/i.test(String(t || ""));
const sourceIdOf = (f) => f.arraySourceId || f.pipeId || null;

/** A pipe as an array source. */
export const pipeSource = (pipe) => pipe && ({ ...pipe, kind: "pipe", closed: false });

/**
 * Every line on the drawing that an array can follow:
 *   pipes, drawn guide lines, basin outlines, land surfaces and depth zones.
 * `activeGeometry` (the live outline of basin `activeBasinIndex`) wins over its stored copy.
 * @returns {{id, kind, label, points, closed, drawMode?, connections?}[]}
 */
export function arraySources({ pipes = [], guides = [], basins = [], activeBasinIndex = 0, activeGeometry = null, siteSurfaces = [], depthZones = [] } = {}) {
  const len = (src) => r3(pathLength(pipePath(src)));
  const out = [];
  pipes.forEach((p, i) => out.push({ ...pipeSource(p), label: `Pipe: ${p.label || `Pipe ${i + 1}`} (${len(p).toFixed(1)} m)` }));
  guides.forEach((g, i) => {
    const src = { ...g, kind: "guide", drawMode: "polyline" };
    out.push({ ...src, label: `${g.label || `Guide line ${i + 1}`} (${len(src).toFixed(1)} m)` });
  });
  basins.forEach((b, i) => {
    const pts = i === activeBasinIndex && activeGeometry ? tessellateGeometry(activeGeometry) : basinOuterPoints(b);
    if (pts.length >= 3) out.push({ id: `basin:${b.id || i}`, kind: "basin", label: `${b.name || `Basin ${i + 1}`} outline`, points: pts, closed: true });
  });
  siteSurfaces.forEach((s, i) => {
    if ((s.points || []).length >= 3) out.push({ id: `surface:${s.id || i}`, kind: "surface", label: `Land: ${s.label || `Area ${i + 1}`}`, points: s.points, closed: true });
  });
  depthZones.forEach((z, i) => {
    if ((z.points || []).length >= 3) out.push({ id: `depth:${z.key || z.zone || i}:${z.basinId || ""}`, kind: "depth", label: `Depth zone: ${z.label || z.key || i + 1}`, points: z.points, closed: true });
  });
  return out;
}

/**
 * Build the fixtures for an array along a source line (pipe, guide, outline), tagged with
 * `arraySourceId` (and `pipeId` for pipes). The caller links nozzles to `pumpId` (pipes only)
 * and applies `pairs` (light → nearest nozzle already on the same source).
 * @returns {{ made: object[], pumpId: string|null, pairs: [lightId, nozzleId][] }}
 */
export function buildPipeArray({ pipe, source, pipes = [], fixtures = [], fixtureType, typeLabel, count, spacing, endGap, sideOffset, zone = "medium", owner }) {
  const src = source || pipeSource(pipe);
  const stations = stationsAlongPipe(src, { count, spacing, endGap, sideOffset });
  const already = fixtures.filter((f) => f.type === fixtureType).length;
  const isNozzle = isNozzleType(fixtureType);
  const isLight = /^light|laser/i.test(String(fixtureType || ""));
  const pump = isNozzle && src.kind === "pipe" ? pumpForPipe(src, pipes, fixtures) : null;
  const made = stations.map((s, i) => createFixtureEntity({
    type: fixtureType, x: s.x, y: s.y, rotation: s.rotation, label: `${typeLabel} ${already + i + 1}`, zone, owner,
    extra: { arraySourceId: src.id, ...(src.kind === "pipe" ? { pipeId: src.id } : {}) },
  }));
  const pairs = [];
  if (isLight) {
    const onPipe = fixtures.filter((f) => sourceIdOf(f) === src.id && isNozzleType(f.type));
    const taken = new Set();
    for (const light of made) {
      let best = null;
      for (const n of onPipe) {
        if (taken.has(n.id)) continue;
        const d = Math.hypot(n.x - light.x, n.y - light.y);
        if (!best || d < best.d) best = { d, n };
      }
      if (best) { taken.add(best.n.id); pairs.push([light.id, best.n.id]); }
    }
  }
  return { made, pumpId: pump?.id || null, pumpLabel: pump?.label || pump?.id || null, pairs, length: r3(pathLength(pipePath(src))), closed: Boolean(src.closed) };
}
