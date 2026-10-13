/**
 * drafting/entities.js — AF-CAD-030 entity identity, factories, ports and layers.
 *
 * AutoCAD's database addresses every object by a never-reused handle plus an owner pointer
 * (BLOCK_RECORD/330). AquaFlow follows that model for engineering entities:
 *
 *   entity.uuid   — stable, never reused, generated once (RFC 4122 v4 string)
 *   entity.owner  — the container that owns it: "basin:<basinId>", "model" or "site"
 *   entity.id     — the existing application ID. It is PRESERVED for legacy records (Siemens
 *                   links, show patches and CAD XDATA reference it); new entities use the
 *                   uuid as their id.
 *
 * Migration is lazy: `ensureEntityIdentities` runs when a project is loaded into the
 * designer and returns the SAME array when nothing needed changing, so it never causes
 * render churn or spurious undo steps.
 *
 * Pure — no React, no DOM.
 */
import { getDefaultEngineering } from "../../data/fixtureLibrary";
import { resolveFixtureGroup } from "../../hooks/fixtureTypeMap";
import { basinForPoint } from "../basins";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RFC 4122 v4 UUID. crypto.randomUUID when available, otherwise crypto/Math entropy. */
export function newEntityUuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    try { return c.randomUUID(); } catch { /* insecure context: fall through */ }
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const isEntityUuid = (value) => typeof value === "string" && UUID_RE.test(value);

/** The key the drafting kernel addresses an entity by (uuid, falling back to legacy id). */
export const entityKey = (entity) => (entity?.uuid ?? entity?.id ?? null);

export const OWNER_MODEL = "model";
export const OWNER_SITE = "site";
export const basinOwner = (basinId) => (basinId ? `basin:${basinId}` : OWNER_MODEL);

/** Owner for a plan point: the basin containing it, else model space. */
export function ownerForPoint(basins, point) {
  const basin = Array.isArray(basins) && basins.length ? basinForPoint(basins, point) : null;
  return basinOwner(basin?.id);
}

/**
 * Give one entity a uuid/owner if it lacks them. Existing `id` is never changed; an entity
 * with no id at all gets id = uuid. Returns the same object when nothing changed.
 */
export function ensureEntityIdentity(entity, owner = OWNER_MODEL) {
  if (!entity || typeof entity !== "object") return entity;
  const needsUuid = !isEntityUuid(entity.uuid);
  const needsOwner = typeof entity.owner !== "string" || !entity.owner;
  const needsId = entity.id === undefined || entity.id === null || entity.id === "";
  if (!needsUuid && !needsOwner && !needsId) return entity;
  const uuid = needsUuid ? newEntityUuid() : entity.uuid;
  return {
    ...entity,
    ...(needsId ? { id: uuid } : {}),
    uuid,
    owner: needsOwner ? owner : entity.owner,
  };
}

/**
 * Lazy migration of a collection. `ownerFor(entity)` supplies the owner of an un-owned
 * entity. Duplicate uuids (copy-pasted JSON) are re-issued so keys stay unique.
 * Returns the input array unchanged when every entity already had identity.
 */
export function ensureEntityIdentities(list, ownerFor = () => OWNER_MODEL) {
  if (!Array.isArray(list)) return [];
  let changed = false;
  const seen = new Set();
  const out = list.map((entity) => {
    let next = ensureEntityIdentity(entity, typeof ownerFor === "function" ? ownerFor(entity) : ownerFor);
    if (next && seen.has(next.uuid)) next = { ...next, uuid: newEntityUuid() };
    if (next) seen.add(next.uuid);
    if (next !== entity) changed = true;
    return next;
  });
  return changed ? out : list;
}

// ── layers ──────────────────────────────────────────────────────────────────

/** Which standard layer a fixture type lives on (lights / nozzles / equipment). */
export function fixtureLayerKey(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("light") || t.includes("laser")) return "lights";
  if (t.includes("nozzle") || t.includes("jet") || t.includes("geyser") || t.includes("foam") || t.includes("mist")) return "nozzles";
  return "equipment";
}

/** The layer a placement tool writes to. */
export const toolLayerKey = (tool) => ({ nozzle: "nozzles", light: "lights", equipment: "equipment" }[tool] || null);

// ── fixtures ────────────────────────────────────────────────────────────────

const getDefaultGroupId = (type) => resolveFixtureGroup(type) || "engineering_equipment";

/**
 * Canonical fixture factory used by click placement, arrays, auto-place and duplication.
 * Keeps the record shape the designer has always written, plus uuid/owner.
 */
export function createFixtureEntity({ type, x, y, label, zone = "medium", rotation = 0, owner = OWNER_MODEL, extra = {} }) {
  const uuid = newEntityUuid();
  return {
    id: uuid,
    uuid,
    owner,
    x,
    y,
    type,
    groupId: getDefaultGroupId(type),
    label,
    zone,
    rotation,
    engineering: getDefaultEngineering(type),
    ...extra,
  };
}

/** A copy of a fixture with a fresh identity (Ctrl+D, copy-move). */
export function duplicateFixtureEntity(source, { dx = 0.5, dy = 0.5, label } = {}) {
  const uuid = newEntityUuid();
  return {
    ...source,
    id: uuid,
    uuid,
    owner: source.owner || OWNER_MODEL,
    label: label ?? `${source.label || "Fixture"} Copy`,
    x: Number((Number(source.x || 0) + dx).toFixed(3)),
    y: Number((Number(source.y || 0) + dy).toFixed(3)),
    engineering: { ...(source.engineering || {}) },
  };
}

// ── ports (nozzle / pipe connection points) ─────────────────────────────────

/**
 * Port definitions by fixture family, in the fixture's LOCAL plan frame (metres; +x is the
 * fixture's rotation direction). A nozzle's inlet is directly below its outlet, so in plan
 * the inlet port sits on the insertion point. Pumps, valves and treatment equipment have
 * an inlet/outlet pair on either side.
 */
const PORT_LAYOUTS = [
  { match: (t) => t.includes("pump"), defaultDn: 80, ports: [
    { key: "suction", kind: "inlet", dx: -0.3, dy: 0 },
    { key: "discharge", kind: "outlet", dx: 0.3, dy: 0 },
  ] },
  { match: (t) => t.includes("valve") || t.includes("solenoid"), defaultDn: 50, ports: [
    { key: "in", kind: "inlet", dx: -0.15, dy: 0 },
    { key: "out", kind: "outlet", dx: 0.15, dy: 0 },
  ] },
  { match: (t) => t.includes("filter") || t.includes("uv") || t.includes("dosing"), defaultDn: 50, ports: [
    { key: "in", kind: "inlet", dx: -0.25, dy: 0 },
    { key: "out", kind: "outlet", dx: 0.25, dy: 0 },
  ] },
  { match: (t) => t.includes("drain"), defaultDn: 50, ports: [{ key: "inlet", kind: "inlet", dx: 0, dy: 0 }] },
  { match: (t) => t.includes("light") || t.includes("laser") || t.includes("sensor") || t.includes("vfd") || t.includes("motion"), defaultDn: 0, ports: [] },
  // Every water effect (nozzles, jets, geysers, foam, mist, laminar, fan, arch, flame/fog
  // manifolds) is fed through one inlet under the outlet.
  { match: () => true, defaultDn: 25, ports: [{ key: "inlet", kind: "inlet", dx: 0, dy: 0 }] },
];

const firstFinite = (...values) => {
  for (const v of values) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; }
  return null;
};

/** Connection size (DN, mm) of a fixture's ports, from its engineering data when present. */
export function fixturePortDn(fixture, fallback) {
  const e = fixture?.engineering || {};
  return firstFinite(e.connectionDN, e.connectionDn, e.inletDN, e.inletDn, e.diameterMm, e.pipeDN) ?? fallback;
}

/**
 * The connection ports of a fixture in PLAN coordinates.
 * @returns {Array<{key, kind, x, y, dn, fixtureId, fixtureUuid}>}
 */
export function fixturePorts(fixture) {
  if (!fixture) return [];
  const t = String(fixture.type || "").toLowerCase();
  const layout = PORT_LAYOUTS.find((entry) => entry.match(t));
  if (!layout?.ports.length) return [];
  const dn = fixturePortDn(fixture, layout.defaultDn);
  const a = (Number(fixture.rotation) || 0) * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const x0 = Number(fixture.x) || 0, y0 = Number(fixture.y) || 0;
  return layout.ports.map((p) => ({
    key: p.key,
    kind: p.kind,
    x: x0 + p.dx * cos - p.dy * sin,
    y: y0 + p.dx * sin + p.dy * cos,
    dn,
    fixtureId: fixture.id,
    fixtureUuid: fixture.uuid ?? null,
  }));
}

// ── pipes ───────────────────────────────────────────────────────────────────

const roundCoord = (v) => {
  const r = Number(Number(v).toFixed(6));
  return r === 0 ? 0 : r;
};
export const cleanPoint = (p) => ({ x: roundCoord(p.x), y: roundCoord(p.y) });

/**
 * Canonical manual-pipe factory. Both the 2D designer and the 3D editor create pipes
 * through this, so "the same operation yields identical geometry" holds by construction.
 * `connections` records which fixture ports the pipe ends attach to.
 */
export function createPipeEntity({ points, diameterMm = 50, pipeType = "supply", drawMode = "polyline", label, owner = OWNER_MODEL, connections = null }) {
  const uuid = newEntityUuid();
  const pts = (points || []).map(cleanPoint);
  return {
    id: uuid,
    uuid,
    owner,
    type: "manual_pipe",
    points: pts,
    diameterMm,
    dn: diameterMm,
    pipeType,
    drawMode,
    material: "SS304",
    pressureClass: "PN10",
    label: label || (drawMode === "arc" ? `Arc Pipe DN${diameterMm}` : drawMode === "curve" ? `Curve Pipe DN${diameterMm}` : `Pipe DN${diameterMm}`),
    layer: "pipework",
    flowDirection: "forward",
    ...(connections ? { connections } : {}),
  };
}

/** Length of a polyline in metres. */
export function polylineLength(points = []) {
  let len = 0;
  for (let i = 1; i < points.length; i += 1) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

/**
 * Attach pipe ends to coincident fixture ports (within `tolerance` metres) and return the
 * connection record { start, end } (null entries when unconnected).
 */
export function connectPipeEnds(points, fixtures = [], tolerance = 0.001) {
  if (!points?.length) return { start: null, end: null };
  const ports = (fixtures || []).flatMap(fixturePorts);
  const find = (p) => {
    let best = null;
    for (const port of ports) {
      const d = Math.hypot(port.x - p.x, port.y - p.y);
      if (d <= tolerance && (!best || d < best.d)) best = { d, port };
    }
    return best ? { fixtureId: best.port.fixtureId, fixtureUuid: best.port.fixtureUuid, port: best.port.key, dn: best.port.dn } : null;
  };
  return { start: find(points[0]), end: find(points[points.length - 1]) };
}
