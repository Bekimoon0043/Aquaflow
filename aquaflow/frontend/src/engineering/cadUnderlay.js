/**
 * cadUnderlay.js — AF-CAD-011 whole-drawing locked CAD underlay.
 *
 * The CAD importer (backend POST /api/cad/import, or the client dxf-parser fallback)
 * returns EVERY model-space entity, including layers that are not mapped to fountain
 * objects. This module turns those entities into a compact, persisted, locked reference
 * drawing that sits behind the design in the 2D designer and on the 3D ground plane.
 *
 *  - Data:    createCadUnderlay(importResponse, { frame, filename }) → underlay object
 *             (plain JSON; stored as `cad_underlay` in the engineering project / .aqua).
 *             Coordinates are already in the ENGINEERING PLAN frame (geometryContract
 *             cadToPlan with the user's origin / rotation / flip), so the 2D renderer and
 *             the 3D module never re-derive the CAD transform.
 *  - Layers:  per-layer visibility (setUnderlayLayerVisible) — the underlay is always locked:
 *             it is never selectable/editable design geometry.
 *  - Index:   buildUnderlayIndex(underlay) — a uniform-grid bucket index (no dependency) for
 *             viewport culling, vertex/centre snapping and picking.
 *  - Render:  drawCadUnderlay(ctx, underlay, view) — batched: one path + one stroke per
 *             layer/colour, viewport-culled through the index.
 *
 * Item shape (persisted): { layer, color, kind: "line"|"text"|"point", handle?,
 *   points?: [x0,y0,x1,y1,…] (flat, plan metres, 0.1 mm), closed?, center?: [x,y],
 *   x?, y?, text?, height?, rotation? }
 */
import { cadFrame, cadToPlan, cadRotationToPlan } from "./geometryContract";

export const CAD_UNDERLAY_FORMAT = "AquaFlowCadUnderlay";
export const CAD_UNDERLAY_VERSION = 1;
export const CAD_UNDERLAY_MAX_ITEMS = 200000;

const round = (v) => { const r = Math.round(v * 1e4) / 1e4; return r === 0 ? 0 : r; };
const finiteNum = (v) => Number.isFinite(Number(v));

// ── AutoCAD Colour Index → hex ───────────────────────────────────────────────
const ACI_BASE = {
  1: "#ff0000", 2: "#ffff00", 3: "#00ff00", 4: "#00ffff", 5: "#0000ff", 6: "#ff00ff",
  7: "#e6edf3", 8: "#808080", 9: "#c0c0c0",
};
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
function hsvHex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `#${hex2(f(5) * 255)}${hex2(f(3) * 255)}${hex2(f(1) * 255)}`;
}

/** Approximate AutoCAD Colour Index → CSS hex (white/black 7 renders light on the dark canvas). */
export function aciToHex(index, fallback = "#8fa7b8") {
  const n = Math.round(Number(index));
  if (!Number.isFinite(n) || n <= 0 || n > 255) return fallback;
  if (ACI_BASE[n]) return ACI_BASE[n];
  if (n >= 250) return hsvHex(0, 0, 0.2 + (n - 250) * 0.14);
  const hue = Math.floor((n - 10) / 10) * 15;
  const step = (n - 10) % 10;
  const value = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][step];
  return hsvHex(hue, step % 2 ? 0.5 : 1, value);
}

// ── Construction ─────────────────────────────────────────────────────────────

function circleRing(center, radius, toPlan) {
  const segments = Math.max(12, Math.min(96, Math.ceil(radius * 24)));
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const p = toPlan([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
    pts.push(round(p.x), round(p.y));
  }
  return pts;
}

/**
 * Build the underlay from contract entities (CAD WCS metres).
 * `entities` uses the CAD-IMPORT-CONTRACT shape: kind polyline|circle|text|hatch|point.
 */
export function createCadUnderlayFromEntities(entities = [], {
  frame, filename = "", layers = [], units = null, maxItems = CAD_UNDERLAY_MAX_ITEMS, opacity = 0.55,
} = {}) {
  const f = cadFrame(frame || {});
  const toPlan = (p) => cadToPlan(p, f);
  const layerMap = new Map();
  const touchLayer = (name, aci) => {
    const key = String(name ?? "0");
    if (!layerMap.has(key)) layerMap.set(key, { name: key, color: aciToHex(aci, "#8fa7b8"), visible: true, count: 0 });
    return layerMap.get(key);
  };
  (layers || []).forEach((l) => {
    const entry = touchLayer(l.name, l.color);
    if (l.off || l.frozen) entry.visible = false;
  });
  const items = [];
  let truncated = false;
  const push = (item) => {
    if (items.length >= maxItems) { truncated = true; return; }
    items.push(item);
    layerMap.get(item.layer).count += 1;
  };
  for (const e of entities || []) {
    if (!e || typeof e !== "object") continue;
    const layer = touchLayer(e.layer, undefined);
    const color = e.color != null && e.color !== 256 && e.color !== 0 ? aciToHex(e.color, layer.color) : layer.color;
    const base = { layer: layer.name, color, ...(e.handle ? { handle: String(e.handle) } : {}) };
    if (e.kind === "polyline" && Array.isArray(e.points) && e.points.length >= 2) {
      const pts = [];
      for (const p of e.points) { if (!finiteNum(p?.[0] ?? p?.x) || !finiteNum(p?.[1] ?? p?.y)) continue; const q = toPlan(p); pts.push(round(q.x), round(q.y)); }
      if (pts.length >= 4) push({ ...base, kind: "line", points: pts, closed: !!e.closed });
    } else if (e.kind === "circle" && Array.isArray(e.center) && Number(e.radius) > 0) {
      const c = toPlan(e.center);
      push({ ...base, kind: "line", points: circleRing(e.center, Number(e.radius), toPlan), closed: true, center: [round(c.x), round(c.y)] });
    } else if (e.kind === "hatch" && Array.isArray(e.loops)) {
      for (const loop of e.loops) {
        if (!Array.isArray(loop) || loop.length < 3) continue;
        const pts = [];
        for (const p of loop) { const q = toPlan(p); pts.push(round(q.x), round(q.y)); }
        push({ ...base, kind: "line", points: pts, closed: true, hatch: String(e.pattern || "") });
      }
    } else if (e.kind === "text" && Array.isArray(e.position) && String(e.text ?? "").trim()) {
      const q = toPlan(e.position);
      push({ ...base, kind: "text", x: round(q.x), y: round(q.y), text: String(e.text).slice(0, 256),
        height: Math.max(0.01, Number(e.height) || 0.2), rotation: cadRotationToPlan(Number(e.rotation_deg) || 0, f) });
    } else if (e.kind === "point" && Array.isArray(e.position)) {
      const q = toPlan(e.position);
      push({ ...base, kind: "point", x: round(q.x), y: round(q.y) });
    }
  }
  const underlay = {
    format: CAD_UNDERLAY_FORMAT,
    version: CAD_UNDERLAY_VERSION,
    filename: String(filename || ""),
    importedAt: new Date().toISOString(),
    units,
    frame: { origin: { ...f.origin }, rotationDeg: f.rotationDeg, flipY: f.flipY },
    locked: true,
    visible: true,
    opacity,
    layers: [...layerMap.values()].filter((l) => l.count > 0).sort((a, b) => a.name.localeCompare(b.name)),
    items,
    truncated,
  };
  underlay.bounds = underlayBounds(underlay);
  return underlay;
}

/** Build the underlay from a POST /api/cad/import response. */
export function createCadUnderlay(importResponse, options = {}) {
  return createCadUnderlayFromEntities(importResponse?.entities || [], {
    filename: importResponse?.filename,
    layers: importResponse?.layers || [],
    units: importResponse?.units?.name ?? null,
    ...options,
  });
}

function itemBBox(item) {
  if (item.kind === "line") {
    const p = item.points;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < minX) minX = p[i]; if (p[i] > maxX) maxX = p[i];
      if (p[i + 1] < minY) minY = p[i + 1]; if (p[i + 1] > maxY) maxY = p[i + 1];
    }
    return [minX, minY, maxX, maxY];
  }
  if (item.kind === "text") {
    const w = item.height * Math.max(1, item.text.length) * 0.7;
    return [item.x - w, item.y - w, item.x + w, item.y + w];
  }
  return [item.x, item.y, item.x, item.y];
}

export function underlayBounds(underlay) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of underlay?.items || []) {
    const b = itemBBox(item);
    if (b[0] < minX) minX = b[0]; if (b[1] < minY) minY = b[1];
    if (b[2] > maxX) maxX = b[2]; if (b[3] > maxY) maxY = b[3];
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Validate a persisted underlay (from .aqua / project JSON). Returns null when unusable. */
export function normalizeCadUnderlay(value) {
  if (!value || typeof value !== "object" || value.format !== CAD_UNDERLAY_FORMAT || !Array.isArray(value.items)) return null;
  const items = [];
  for (const raw of value.items.slice(0, CAD_UNDERLAY_MAX_ITEMS)) {
    if (!raw || typeof raw !== "object") continue;
    const layer = String(raw.layer ?? "0"), color = typeof raw.color === "string" ? raw.color : "#8fa7b8";
    if (raw.kind === "line" && Array.isArray(raw.points) && raw.points.length >= 4 && raw.points.length % 2 === 0
      && raw.points.every(Number.isFinite)) {
      items.push({ ...raw, layer, color, closed: !!raw.closed });
    } else if ((raw.kind === "text" || raw.kind === "point") && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      items.push(raw.kind === "text"
        ? { ...raw, layer, color, text: String(raw.text ?? ""), height: Math.max(0.01, Number(raw.height) || 0.2), rotation: Number(raw.rotation) || 0 }
        : { ...raw, layer, color });
    }
  }
  const counts = new Map();
  items.forEach((i) => counts.set(i.layer, (counts.get(i.layer) || 0) + 1));
  const declared = new Map((Array.isArray(value.layers) ? value.layers : []).map((l) => [String(l?.name ?? ""), l]));
  const layers = [...counts.keys()].sort().map((name) => ({
    name,
    color: typeof declared.get(name)?.color === "string" ? declared.get(name).color : "#8fa7b8",
    visible: declared.get(name)?.visible !== false,
    count: counts.get(name),
  }));
  const f = cadFrame(value.frame || {});
  const underlay = {
    format: CAD_UNDERLAY_FORMAT, version: CAD_UNDERLAY_VERSION,
    filename: String(value.filename || ""), importedAt: String(value.importedAt || ""),
    units: value.units ?? null,
    frame: { origin: { ...f.origin }, rotationDeg: f.rotationDeg, flipY: f.flipY },
    locked: true, visible: value.visible !== false,
    opacity: Math.max(0.05, Math.min(1, Number(value.opacity) || 0.55)),
    layers, items, truncated: !!value.truncated,
  };
  underlay.bounds = underlayBounds(underlay);
  return underlay;
}

export function setUnderlayLayerVisible(underlay, name, visible) {
  if (!underlay) return underlay;
  return { ...underlay, layers: underlay.layers.map((l) => (l.name === name ? { ...l, visible: !!visible } : l)) };
}

export function setUnderlayVisible(underlay, visible) {
  return underlay ? { ...underlay, visible: !!visible } : underlay;
}

/** Map of layer name → visible, for renderers. */
export function underlayLayerVisibility(underlay) {
  return new Map((underlay?.layers || []).map((l) => [l.name, l.visible !== false]));
}

/** Group items into draw batches (one per layer + colour). Text items are kept separately. */
export function underlayBatches(underlay) {
  const batches = new Map();
  (underlay?.items || []).forEach((item, idx) => {
    if (item.kind === "text") return;
    const key = `${item.layer}\u0000${item.color}`;
    if (!batches.has(key)) batches.set(key, { layer: item.layer, color: item.color, items: [] });
    batches.get(key).items.push(idx);
  });
  return [...batches.values()];
}

// ── Spatial index (uniform grid buckets) ─────────────────────────────────────

/**
 * buildUnderlayIndex(underlay, { cellSize? }) → index
 *   query(minX, minY, maxX, maxY) → item indices whose bbox overlaps the rectangle
 *   nearestVertex(pt, radius, { visibleLayers? }) → { x, y, item, kind: "endpoint"|"center"|"insertion" } | null
 *   pickItem(pt, radius, { visibleLayers? }) → item index or -1
 */
export function buildUnderlayIndex(underlay, { cellSize } = {}) {
  const items = underlay?.items || [];
  const n = items.length;
  const boxes = new Float64Array(n * 4);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  items.forEach((item, i) => {
    const b = itemBBox(item);
    boxes.set(b, i * 4);
    if (b[0] < minX) minX = b[0]; if (b[1] < minY) minY = b[1];
    if (b[2] > maxX) maxX = b[2]; if (b[3] > maxY) maxY = b[3];
  });
  if (!n) {
    return { size: 0, query: () => [], nearestVertex: () => null, pickItem: () => -1, bounds: null };
  }
  const W = Math.max(1e-6, maxX - minX), H = Math.max(1e-6, maxY - minY);
  let cell = Number(cellSize) > 0 ? Number(cellSize) : Math.sqrt((W * H) / Math.max(1, n / 4));
  cell = Math.max(cell, Math.max(W, H) / 2048, 1e-3);
  const gw = Math.max(1, Math.ceil(W / cell) + 1), gh = Math.max(1, Math.ceil(H / cell) + 1);
  const cells = new Array(gw * gh);
  const big = [];
  const cx = (x) => Math.max(0, Math.min(gw - 1, Math.floor((x - minX) / cell)));
  const cy = (y) => Math.max(0, Math.min(gh - 1, Math.floor((y - minY) / cell)));
  for (let i = 0; i < n; i++) {
    const x0 = cx(boxes[i * 4]), y0 = cy(boxes[i * 4 + 1]), x1 = cx(boxes[i * 4 + 2]), y1 = cy(boxes[i * 4 + 3]);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) { big.push(i); continue; }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = y * gw + x;
      (cells[k] || (cells[k] = [])).push(i);
    }
  }
  const stamp = new Uint32Array(n);
  let epoch = 0;
  const overlaps = (i, a, b, c, d) => boxes[i * 4] <= c && boxes[i * 4 + 2] >= a && boxes[i * 4 + 1] <= d && boxes[i * 4 + 3] >= b;

  function query(a, b, c, d) {
    const out = [];
    if (c < minX || a > maxX || d < minY || b > maxY) {
      for (const i of big) if (overlaps(i, a, b, c, d)) out.push(i);
      return out;
    }
    epoch = (epoch + 1) >>> 0;
    if (epoch === 0) { stamp.fill(0); epoch = 1; }
    const x0 = cx(a), y0 = cy(b), x1 = cx(c), y1 = cy(d);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const list = cells[y * gw + x];
      if (!list) continue;
      for (const i of list) {
        if (stamp[i] === epoch) continue;
        stamp[i] = epoch;
        if (overlaps(i, a, b, c, d)) out.push(i);
      }
    }
    for (const i of big) if (overlaps(i, a, b, c, d)) out.push(i);
    return out;
  }

  const layerOk = (item, visibleLayers) => !visibleLayers || visibleLayers.get(item.layer) !== false;

  function nearestVertex(pt, radius, { visibleLayers } = {}) {
    const r = Math.max(0, Number(radius) || 0);
    let best = null, bestD = r;
    const consider = (x, y, item, kind) => {
      const d = Math.hypot(x - pt.x, y - pt.y);
      if (d <= bestD) { bestD = d; best = { x, y, item, kind }; }
    };
    for (const i of query(pt.x - r, pt.y - r, pt.x + r, pt.y + r)) {
      const item = items[i];
      if (!layerOk(item, visibleLayers)) continue;
      if (item.kind === "line") {
        if (item.center) { consider(item.center[0], item.center[1], i, "center"); continue; }
        const p = item.points;
        for (let k = 0; k < p.length; k += 2) consider(p[k], p[k + 1], i, "endpoint");
      } else consider(item.x, item.y, i, "insertion");
    }
    return best;
  }

  function pickItem(pt, radius, { visibleLayers } = {}) {
    const r = Math.max(0, Number(radius) || 0);
    let best = -1, bestD = r;
    for (const i of query(pt.x - r, pt.y - r, pt.x + r, pt.y + r)) {
      const item = items[i];
      if (!layerOk(item, visibleLayers)) continue;
      let d = Infinity;
      if (item.kind === "line") {
        const p = item.points, count = p.length / 2, segs = item.closed ? count : count - 1;
        for (let s = 0; s < segs; s++) {
          const a = s * 2, b = ((s + 1) % count) * 2;
          d = Math.min(d, segmentDistance(pt.x, pt.y, p[a], p[a + 1], p[b], p[b + 1]));
        }
      } else d = Math.hypot(item.x - pt.x, item.y - pt.y);
      if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
  }

  return { size: n, query, nearestVertex, pickItem, bounds: { minX, minY, maxX, maxY }, cellSize: cell };
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ── Prepared state (memoised per underlay object) ────────────────────────────

const prepared = new WeakMap();

/** Index + draw batches for an underlay, built once per underlay object. */
export function prepareCadUnderlay(underlay) {
  if (!underlay) return null;
  let entry = prepared.get(underlay.items);
  if (!entry) {
    const batches = underlayBatches(underlay);
    const batchOf = new Int32Array(underlay.items.length).fill(-1);
    batches.forEach((b, bi) => b.items.forEach((i) => { batchOf[i] = bi; }));
    entry = { index: buildUnderlayIndex(underlay), batches, batchOf };
    prepared.set(underlay.items, entry);
  }
  return entry;
}

// ── 2D canvas renderer ───────────────────────────────────────────────────────

/**
 * drawCadUnderlay(ctx, underlay, { zoom, pan, width, height, maxTexts? }) → { items, batches, texts }
 * Plan → canvas is the designer's own mapping: sx = pan.x + x·zoom, sy = pan.y + y·zoom.
 * Draws only items intersecting the viewport, one stroke per visible layer/colour batch.
 */
export function drawCadUnderlay(ctx, underlay, { zoom, pan, width, height, maxTexts = 1500, lineWidth = 1 } = {}) {
  const stats = { items: 0, batches: 0, texts: 0 };
  if (!ctx || !underlay || underlay.visible === false || !underlay.items?.length) return stats;
  const prep = prepareCadUnderlay(underlay);
  const z = Number(zoom) || 1, px = Number(pan?.x) || 0, py = Number(pan?.y) || 0;
  const visible = underlayLayerVisibility(underlay);
  const minX = -px / z, minY = -py / z, maxX = (width - px) / z, maxY = (height - py) / z;
  const hits = prep.index.query(minX, minY, maxX, maxY);
  const buckets = prep.batches.map(() => []);
  const texts = [];
  const minPx = 0.6 / z;
  for (const i of hits) {
    const item = underlay.items[i];
    if (visible.get(item.layer) === false) continue;
    if (item.kind === "text") { if (item.height * z >= 4) texts.push(item); continue; }
    const bi = prep.batchOf[i];
    if (bi < 0) continue;
    if (item.kind === "line") {
      // Level of detail: sub-pixel items cannot be seen; skip them.
      const p = item.points;
      if (p.length <= 4 && Math.abs(p[0] - p[2]) < minPx && Math.abs(p[1] - p[3]) < minPx) continue;
    }
    buckets[bi].push(item);
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, Number(underlay.opacity) || 0.55));
  ctx.lineWidth = lineWidth;
  ctx.setLineDash?.([]);
  prep.batches.forEach((batch, bi) => {
    const list = buckets[bi];
    if (!list.length) return;
    ctx.strokeStyle = batch.color;
    ctx.beginPath();
    for (const item of list) {
      if (item.kind === "point") {
        const sx = px + item.x * z, sy = py + item.y * z;
        ctx.moveTo(sx - 3, sy); ctx.lineTo(sx + 3, sy); ctx.moveTo(sx, sy - 3); ctx.lineTo(sx, sy + 3);
        continue;
      }
      const p = item.points;
      ctx.moveTo(px + p[0] * z, py + p[1] * z);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(px + p[k] * z, py + p[k + 1] * z);
      if (item.closed) ctx.closePath();
    }
    ctx.stroke();
    stats.items += list.length;
    stats.batches += 1;
  });
  if (texts.length) {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    for (const item of texts.slice(0, maxTexts)) {
      const sx = px + item.x * z, sy = py + item.y * z;
      ctx.fillStyle = item.color;
      ctx.font = `${Math.max(6, Math.min(64, item.height * z))}px monospace`;
      if (item.rotation) {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(item.rotation * Math.PI / 180);
        ctx.fillText(item.text, 0, 0); ctx.restore();
      } else ctx.fillText(item.text, sx, sy);
      stats.texts += 1;
    }
  }
  ctx.restore();
  return stats;
}

// ── View / pick helpers (dialog pick-point origin and edge-align) ────────────

/** Zoom/pan that fits plan `bounds` into a width×height canvas (designer mapping). */
export function fitPlanView(bounds, width, height, margin = 16) {
  if (!bounds) return { zoom: 20, pan: { x: width / 2, y: height / 2 } };
  const w = Math.max(1e-6, bounds.maxX - bounds.minX), h = Math.max(1e-6, bounds.maxY - bounds.minY);
  const zoom = Math.max(1e-6, Math.min((width - margin * 2) / w, (height - margin * 2) / h));
  return { zoom, pan: { x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom, y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom } };
}

/** Closest straight segment of a visible underlay line item to plan point `pt` (edge-align). */
export function nearestUnderlaySegment(underlay, index, pt, radius) {
  if (!underlay || !index) return null;
  const visibleLayers = underlayLayerVisibility(underlay);
  const i = index.pickItem(pt, radius, { visibleLayers });
  if (i < 0 || underlay.items[i].kind !== "line") return null;
  const p = underlay.items[i].points, count = p.length / 2, segs = underlay.items[i].closed ? count : count - 1;
  let best = null, bestD = Infinity;
  for (let s = 0; s < segs; s++) {
    const a = s * 2, b = ((s + 1) % count) * 2;
    const d = segmentDistance(pt.x, pt.y, p[a], p[a + 1], p[b], p[b + 1]);
    if (d < bestD) { bestD = d; best = { a: { x: p[a], y: p[a + 1] }, b: { x: p[b], y: p[b + 1] }, item: i }; }
  }
  return best;
}
