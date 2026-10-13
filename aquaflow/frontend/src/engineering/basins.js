/**
 * basins.js — AF-CAD-013 / AF-NEXT-010 multi-basin data model.
 *
 * An engineering project holds `basins: [Basin]` (plan frame, metres, y down the screen):
 *
 *   Basin = {
 *     id, name,
 *     outer: [{x, y}],            // closed outline (circles/ellipses: tessellated copy)
 *     holes: [[{x, y}]],          // islands cut out of this basin
 *     floorLevel?, wallHeight?,   // optional design levels (metres)
 *     depthZones: [zone],         // depth zones drawn inside THIS basin (zone.basinId === id)
 *     type?, closed?, center?, radius?, rx?, ry?,   // native primitive (lossless legacy shape)
 *     poolType?, params?,         // designer editing state for this basin
 *   }
 *
 * Legacy compatibility: the single `geometry` (+ holes, wallHeight, floorLevel) and the flat
 * `depth_zones` list stay in every project. `geometry` is ALWAYS basins[0] expressed in the
 * legacy shape (basinToGeometry), so consumers that are not multi-basin aware keep working
 * with the primary basin, and the 3D world origin (poolCenter(geometry)) does not move.
 * When a legacy writer changes `geometry` without touching `basins`, geometry wins for
 * basins[0] (reconcileBasins) — nothing a non-migrated consumer does can be silently lost.
 */
import { pointInGeometry, polygonArea } from "./poolGeometry.js";

const PRIMITIVES = new Set(["circle", "ellipse"]);
const OWN_KEYS = ["id", "name", "outer", "holes", "depthZones", "poolType", "params"];
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

const toPoint = (p) => {
  if (Array.isArray(p)) return { x: Number(p[0]), y: Number(p[1]) };
  return { x: Number(p?.x), y: Number(p?.y ?? p?.z) };
};
const validRing = (ring) => (Array.isArray(ring) ? ring : ring?.points || [])
  .map(toPoint).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

/** Circle / ellipse → polygon (plan frame). Polygons are returned unchanged. */
export function tessellateGeometry(geometry, segments = 64) {
  if (!geometry) return [];
  if (geometry.type === "circle" || geometry.type === "ellipse") {
    const c = toPoint(geometry.center || { x: 0, y: 0 });
    const rx = geometry.type === "circle" ? Number(geometry.radius) || 0 : Number(geometry.rx) || 0;
    const ry = geometry.type === "circle" ? Number(geometry.radius) || 0 : Number(geometry.ry) || 0;
    return Array.from({ length: segments }, (_, i) => {
      const a = (i / segments) * Math.PI * 2;
      return { x: c.x + Math.cos(a) * rx, y: c.y + Math.sin(a) * ry };
    });
  }
  return validRing(geometry.points || []);
}

/** The basin's outline as a polygon (tessellated for native circles / ellipses). */
export function basinOuterPoints(basin) {
  if (!basin) return [];
  const outer = validRing(basin.outer || []);
  return outer.length >= 3 ? outer : tessellateGeometry(basin);
}

/** Legacy single `geometry` → Basin. Lossless: basinToGeometry(geometryToBasin(g)) deep-equals g (empty holes aside). */
export function geometryToBasin(geometry, { id = "basin-1", name = "Basin 1", poolType, params, depthZones = [] } = {}) {
  if (!geometry || typeof geometry !== "object") return null;
  const { points, holes, ...rest } = clone(geometry);
  OWN_KEYS.forEach((k) => { delete rest[k]; });
  const outer = Array.isArray(points) && points.length ? points : tessellateGeometry(geometry);
  return {
    ...rest, id: String(id), name: String(name || id), outer, holes: Array.isArray(holes) ? holes : [],
    depthZones: clone(depthZones) || [],
    ...(poolType ? { poolType } : {}), ...(params ? { params: clone(params) } : {}),
  };
}

/** Basin → legacy single `geometry` shape ({type, points|center/radius, closed, holes?, floorLevel?, wallHeight?}). */
export function basinToGeometry(basin) {
  if (!basin) return null;
  const rest = clone(basin);
  OWN_KEYS.forEach((k) => { delete rest[k]; });
  if (!PRIMITIVES.has(rest.type)) rest.points = clone(basin.outer || []);
  if (Array.isArray(basin.holes) && basin.holes.length) rest.holes = clone(basin.holes);
  return rest;
}

function normalizeBasin(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  // Accept the backend/export shape `points` as well as `outer`.
  const outerSource = Array.isArray(raw.outer) && raw.outer.length ? raw.outer : raw.points;
  const basin = { ...clone(raw) };
  delete basin.points;
  basin.id = String(raw.id || `basin-${index + 1}`);
  basin.name = String(raw.name || `Basin ${index + 1}`);
  basin.outer = validRing(outerSource || []);
  if (basin.outer.length < 3 && PRIMITIVES.has(raw.type)) basin.outer = tessellateGeometry(raw);
  if (basin.outer.length < 3) return null;
  basin.holes = (Array.isArray(raw.holes) ? raw.holes : []).map(validRing).filter((h) => h.length >= 3);
  basin.depthZones = Array.isArray(raw.depthZones || raw.depth_zones) ? clone(raw.depthZones || raw.depth_zones) : [];
  delete basin.depth_zones;
  if (num(raw.floorLevel) != null) basin.floorLevel = num(raw.floorLevel); else delete basin.floorLevel;
  if (num(raw.wallHeight) != null) basin.wallHeight = num(raw.wallHeight); else delete basin.wallHeight;
  return basin;
}

/** Point inside the basin water (inside the outline, edges included, and not inside an island). */
export function pointInBasin(point, basin) {
  if (!basin) return false;
  const geometry = PRIMITIVES.has(basin.type) ? basinToGeometry(basin) : { points: basinOuterPoints(basin) };
  if (!pointInGeometry(point, geometry)) return false;
  return !(basin.holes || []).some((hole) => hole.length >= 3 && pointInGeometry(point, { points: hole })
    && !onRing(point, hole));
}

function onRing(point, ring) {
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / l2)) : 0;
    if (Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)) <= 1e-9) return true;
  }
  return false;
}

/** First basin whose water contains the point (or whose outline does, island included); else null. */
export function basinForPoint(basins = [], point) {
  const list = Array.isArray(basins) ? basins : [];
  const p = toPoint(point);
  return list.find((b) => pointInBasin(p, b))
    || list.find((b) => pointInGeometry(p, PRIMITIVES.has(b.type) ? basinToGeometry(b) : { points: basinOuterPoints(b) }))
    || null;
}

export const pointInAnyBasin = (basins, point) => !!basinForPoint(basins, point);

const centroid = (points) => {
  const n = points.length || 1;
  return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
};

/** basinId for a depth zone: its explicit basinId when valid, else the basin containing it, else the first. */
export function basinIdForZone(basins, zone) {
  if (!basins.length) return null;
  if (zone?.basinId && basins.some((b) => b.id === zone.basinId)) return zone.basinId;
  const pts = validRing(zone?.points || []);
  if (pts.length) {
    const hit = basinForPoint(basins, centroid(pts)) || basinForPoint(basins, pts[0]);
    if (hit) return hit.id;
  }
  return basins[0].id;
}

/**
 * Distribute the flat depth-zone list over basins. Zones with < 3 points are the zone
 * palette (presets) and stay unscoped. Returns { basins, depthZones } where every drawn
 * zone carries `basinId` and each basin.depthZones holds its own zones.
 */
export function scopeDepthZones(basins = [], depthZones = []) {
  // The flat list is returned UNCHANGED (lossless legacy round trip); only the per-basin
  // copies carry the resolved basinId. An explicit zone.basinId (designer) is honoured.
  const zones = (Array.isArray(depthZones) ? depthZones : []).map(clone);
  const scopedZones = zones.map((zone) => (zone?.points?.length >= 3 && basins.length
    ? { ...zone, basinId: basinIdForZone(basins, zone) } : null));
  const scoped = basins.map((b) => ({ ...b, depthZones: scopedZones.filter((z) => z && z.basinId === b.id) }));
  return { basins: scoped, depthZones: zones };
}

/** Flat zone list from basins (used when a file carries basins[].depthZones but no depth_zones). */
export function flattenBasinDepthZones(basins = [], presets = []) {
  const drawn = basins.flatMap((b) => (b.depthZones || []).map((z) => ({ ...clone(z), basinId: b.id })));
  const ids = new Set(drawn.map((z) => z.id));
  return [...(presets || []).filter((z) => !(z?.points?.length >= 3) && !ids.has(z?.id)).map(clone), ...drawn];
}

/**
 * reconcileBasins({ basins, geometry, poolType, params, depthZones }) → Basin[]
 *
 * The single migration rule (also used by normalizeEngineeringProject and the store):
 *  - no basins, legacy geometry → [geometryToBasin(geometry)] (lossless migration);
 *  - basins and geometry disagree on basins[0] → the legacy `geometry` wins for basins[0]
 *    (a non-migrated writer changed it), other basins are kept;
 *  - basins and no geometry → basins unchanged.
 * Depth zones (flat list, when given) are re-scoped onto the basins.
 */
export function reconcileBasins({ basins, geometry, poolType, params, depthZones } = {}) {
  let list = (Array.isArray(basins) ? basins : []).map(normalizeBasin).filter(Boolean);
  const seen = new Set();
  list = list.map((b, i) => {
    let id = b.id;
    while (seen.has(id)) id = `${b.id}-${i + 1}`;
    seen.add(id);
    return id === b.id ? b : { ...b, id };
  });
  if (geometry && typeof geometry === "object") {
    // The legacy `geometry` IS basins[0]: rebuilding the primary from it is a no-op when
    // they agree and makes geometry win when a non-migrated writer changed only it.
    const head = list[0];
    const primary = geometryToBasin(geometry, {
      id: head?.id || "basin-1", name: head?.name || "Basin 1",
      poolType: poolType || head?.poolType, params: params || head?.params, depthZones: head?.depthZones || [],
    });
    if (primary) list = [primary, ...list.slice(1).filter((b) => b.id !== primary.id)];
  }
  if (Array.isArray(depthZones)) return scopeDepthZones(list, depthZones).basins;
  return list;
}

/** Legacy fields derived from basins[0]: { geometry, poolType?, params? } (geometry null when no basins). */
export function legacyFromBasins(basins = []) {
  const primary = basins[0];
  if (!primary) return { geometry: null };
  return {
    geometry: basinToGeometry(primary),
    ...(primary.poolType ? { poolType: primary.poolType } : {}),
    ...(primary.params ? { params: clone(primary.params) } : {}),
  };
}

/** Next free basin id ("basin-N"). */
export function nextBasinId(basins = []) {
  const ids = new Set(basins.map((b) => b.id));
  let n = basins.length + 1;
  while (ids.has(`basin-${n}`)) n += 1;
  return `basin-${n}`;
}

/** Plan bounds of every basin outline. */
export function basinsBounds(basins = []) {
  const pts = basins.flatMap(basinOuterPoints);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** A new rectangular basin placed 2 m to the right of every existing basin. */
export function createBasinBeside(basins = [], { width = 6, length = 4, depth = 0.8 } = {}) {
  const b = basinsBounds(basins) || { minX: 0, maxX: -2, minY: 0, maxY: 0 };
  const x0 = b.maxX + 2, y0 = b.minY;
  const id = nextBasinId(basins);
  const n = Number(id.split("-").pop()) || basins.length + 1;
  return {
    id, name: `Basin ${n}`, type: "freeform", closed: true,
    outer: [{ x: x0, y: y0 }, { x: x0 + width, y: y0 }, { x: x0 + width, y: y0 + length }, { x: x0, y: y0 + length }],
    holes: [], depthZones: [], poolType: "freeform", params: { width, length, radius: Math.max(width, length) / 2, depth },
  };
}

/** Water area of a basin (outline minus islands), m². */
export function basinArea(basin) {
  const outer = basinOuterPoints(basin);
  const holes = (basin?.holes || []).reduce((s, h) => s + polygonArea(h), 0);
  return Math.max(0, polygonArea(outer) - holes);
}

/**
 * Designer helper: the full basin list with the ACTIVE basin replaced by the designer's
 * editing state (geometry / poolType / params). Index 0 stays the primary basin.
 */
export function composeActiveBasin(basins = [], activeIndex = 0, { geometry, poolType, params } = {}) {
  const list = basins.slice();
  if (!geometry) return list;
  const i = Math.max(0, Math.min(activeIndex, Math.max(0, list.length - 1)));
  const prev = list[i];
  const next = geometryToBasin(geometry, {
    id: prev?.id || "basin-1", name: prev?.name || `Basin ${i + 1}`, poolType, params, depthZones: prev?.depthZones || [],
  });
  if (!list.length) return [next];
  list[i] = next;
  return list;
}

/** Basins in the 3D world frame: plan points shifted by `center` ({cx, cy}, i.e. poolCenter(geometry)). */
export function basinsInWorld(basins = [], center = { cx: 0, cy: 0 }) {
  const cx = Number(center?.cx) || 0, cy = Number(center?.cy) || 0;
  const shift = (ring) => ring.map((p) => ({ x: p.x - cx, y: p.y - cy }));
  return basins.map((b) => ({
    id: b.id, name: b.name, outer: shift(basinOuterPoints(b)), holes: (b.holes || []).map(validRing).filter((h) => h.length >= 3).map(shift),
    ...(num(b.floorLevel) != null ? { floorLevel: num(b.floorLevel) } : {}),
    ...(num(b.wallHeight) != null ? { wallHeight: num(b.wallHeight) } : {}),
  })).filter((b) => b.outer.length >= 3);
}

const zoneKeyOf = (zone) => zone?.zone || zone?.key;

/** Drawn depth zones that belong to `basinId` (zones without basinId belong to the primary basin). */
export function zonesForBasin(zones = [], basinId, primaryId) {
  return (zones || []).filter((z) => z?.points?.length >= 3 && (z.basinId || primaryId) === basinId);
}

/**
 * Set the polygon of depth-zone type `zoneKey` inside basin `basinId`. One polygon per zone
 * type per basin: the primary basin reuses the preset entry (legacy ids stay stable), other
 * basins get their own `<preset id>-<basinId>` entry.
 */
export function upsertBasinDepthZone(zones = [], { zoneKey, basinId, primaryId, points }) {
  const pts = (points || []).map((p) => ({ x: p.x, y: p.y }));
  const list = (zones || []).slice();
  const own = list.findIndex((z) => zoneKeyOf(z) === zoneKey && z.points?.length >= 3 && (z.basinId || primaryId) === basinId);
  if (own >= 0) { list[own] = { ...list[own], basinId, points: pts }; return list; }
  const preset = list.findIndex((z) => zoneKeyOf(z) === zoneKey && !(z.points?.length >= 3));
  if (preset >= 0 && basinId === primaryId) { list[preset] = { ...list[preset], basinId, points: pts }; return list; }
  const template = list.find((z) => zoneKeyOf(z) === zoneKey) || { zone: zoneKey, label: zoneKey, depth: 0.8 };
  list.push({ ...template, id: `${template.id || zoneKey}-${basinId}`, basinId, points: pts });
  return list;
}
