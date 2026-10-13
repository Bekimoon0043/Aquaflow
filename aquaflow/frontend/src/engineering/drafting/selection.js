/**
 * drafting/selection.js — AF-CAD-034 multi-selection, window/crossing, select-similar
 * and groups for the drafting kernel.
 *
 * Selections are lists of entity keys (uuid, falling back to the legacy id — see
 * entities.entityKey). Groups are stored on the project as plain ID lists:
 *
 *   groups: [{ id, uuid, owner: "model", name, members: [entityKey, …] }]
 *
 * which keeps them JSON-serialisable, diffable by the command history and independent of
 * the show-programming `groupId` label a fixture already carries.
 *
 * Pure — no React, no DOM.
 */
import { entityKey, newEntityUuid, OWNER_MODEL } from "./entities";

export const keyOf = (entity) => String(entityKey(entity));

/** Click selection: replace, or toggle when additive (Shift). */
export function clickSelection(current = [], key, { additive = false } = {}) {
  if (key === null || key === undefined) return additive ? [...current] : [];
  const k = String(key);
  if (!additive) return [k];
  return current.includes(k) ? current.filter((id) => id !== k) : [...current, k];
}

/** Union of two key lists, preserving order. */
export const mergeSelection = (a = [], b = []) => [...new Set([...a.map(String), ...b.map(String)])];

/**
 * AutoCAD convention: dragging left→right is a WINDOW (entities fully inside), right→left
 * is a CROSSING (entities inside or touching).
 */
export const selectionBoxMode = (start, end) => (end.x >= start.x ? "window" : "crossing");

const rectOf = (a, b) => ({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
const inside = (p, r) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

function segmentHitsRect(a, b, r) {
  if (inside(a, r) || inside(b, r)) return true;
  const edges = [
    [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }], [{ x: r.maxX, y: r.minY }, { x: r.maxX, y: r.maxY }],
    [{ x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }], [{ x: r.minX, y: r.maxY }, { x: r.minX, y: r.minY }],
  ];
  const cross = (p, q, s, t) => {
    const d = (q.x - p.x) * (t.y - s.y) - (q.y - p.y) * (t.x - s.x);
    if (Math.abs(d) < 1e-12) return false;
    const u = ((s.x - p.x) * (t.y - s.y) - (s.y - p.y) * (t.x - s.x)) / d;
    const v = ((s.x - p.x) * (q.y - p.y) - (s.y - p.y) * (q.x - p.x)) / d;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  };
  return edges.some(([s, t]) => cross(a, b, s, t));
}

/** Plan points an entity occupies (fixtures: insertion point; pipes/surfaces: vertices). */
export function entityPoints(entity) {
  if (Array.isArray(entity?.points)) return entity.points;
  if (Number.isFinite(Number(entity?.x)) && Number.isFinite(Number(entity?.y))) return [{ x: Number(entity.x), y: Number(entity.y) }];
  return [];
}

/**
 * Entities selected by a window/crossing box.
 * @param {Array} entities  fixtures, pipes, surfaces … (anything with x/y or points)
 * @param {{x,y}} start, end  box corners in plan metres (drag order matters)
 * @returns {string[]} entity keys
 */
export function boxSelect(entities = [], start, end, { closed = (e) => Array.isArray(e?.points) && e.type !== "manual_pipe" } = {}) {
  if (!start || !end) return [];
  const r = rectOf(start, end);
  const mode = selectionBoxMode(start, end);
  const out = [];
  for (const e of entities) {
    const pts = entityPoints(e);
    if (!pts.length) continue;
    let hit;
    if (mode === "window") hit = pts.every((p) => inside(p, r));
    else {
      hit = pts.some((p) => inside(p, r));
      if (!hit && pts.length > 1) {
        const n = closed(e) ? pts.length : pts.length - 1;
        for (let i = 0; i < n && !hit; i += 1) hit = segmentHitsRect(pts[i], pts[(i + 1) % pts.length], r);
      }
    }
    if (hit) out.push(keyOf(e));
  }
  return out;
}

/** The "block" of a fixture: its CAD block / symbol name when imported, else its type. */
export const fixtureBlock = (f) => f?.cadBlock || f?.block || f?.symbol?.block || f?.symbolName || null;

/**
 * Select-similar: every entity with the same type — or the same block when the seed has
 * one — as any seed entity.
 */
export function selectSimilar(entities = [], seedKeys = [], { by = "type" } = {}) {
  const seeds = new Set(seedKeys.map(String));
  const seedEntities = entities.filter((e) => seeds.has(keyOf(e)));
  if (!seedEntities.length) return [];
  const types = new Set(seedEntities.map((e) => e.type));
  const blocks = new Set(seedEntities.map(fixtureBlock).filter(Boolean));
  return entities
    .filter((e) => (by === "block" && blocks.size ? blocks.has(fixtureBlock(e)) : types.has(e.type) || (blocks.size && blocks.has(fixtureBlock(e)))))
    .map(keyOf);
}

// ── groups (ID lists) ───────────────────────────────────────────────────────

export function createGroup(groups = [], memberKeys = [], name = null) {
  const members = [...new Set(memberKeys.map(String))];
  if (members.length < 1) return { groups, group: null };
  const uuid = newEntityUuid();
  const group = { id: uuid, uuid, owner: OWNER_MODEL, name: name || `Group ${groups.length + 1}`, members };
  return { groups: [...groups, group], group };
}

/** Remove the groups containing any of `keys` (or the group ids given). */
export function ungroup(groups = [], keys = []) {
  const k = new Set(keys.map(String));
  const next = groups.filter((g) => !(k.has(String(g.id)) || g.members.some((m) => k.has(String(m)))));
  return next.length === groups.length ? groups : next;
}

export const groupsContaining = (groups = [], key) => groups.filter((g) => g.members.some((m) => String(m) === String(key)));

/** Expand a selection to whole groups (clicking one member selects its group). */
export function expandToGroups(groups = [], keys = []) {
  const out = new Set(keys.map(String));
  for (const key of keys) for (const g of groupsContaining(groups, key)) g.members.forEach((m) => out.add(String(m)));
  return [...out];
}

/** Drop members that no longer exist; drop groups that become empty. */
export function pruneGroups(groups = [], liveKeys = []) {
  const live = new Set(liveKeys.map(String));
  let changed = false;
  const next = [];
  for (const g of groups) {
    const members = g.members.filter((m) => live.has(String(m)));
    if (members.length !== g.members.length) changed = true;
    if (members.length) next.push(members.length === g.members.length ? g : { ...g, members });
    else changed = true;
  }
  return changed ? next : groups;
}

// ── shared properties across a multi-selection ──────────────────────────────

export const MIXED = Object.freeze({ mixed: true });

/** Read a dotted path ("engineering.flowLpm"). */
export const readPath = (obj, path) => String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Write a dotted path immutably. */
export function writePath(obj, path, value) {
  const [head, ...rest] = String(path).split(".");
  if (!rest.length) return { ...obj, [head]: value };
  return { ...obj, [head]: writePath(obj?.[head] || {}, rest.join("."), value) };
}

/** Value of each field across entities: the common value, or MIXED. */
export function sharedFieldValues(entities = [], fields = []) {
  const out = {};
  for (const field of fields) {
    const values = entities.map((e) => readPath(e, field));
    const first = values[0];
    out[field] = values.every((v) => JSON.stringify(v) === JSON.stringify(first)) ? first : MIXED;
  }
  return out;
}

/** Set one field on every selected entity (keys), leaving the rest untouched. */
export function applySharedField(entities = [], keys = [], field, value) {
  const k = new Set(keys.map(String));
  return entities.map((e) => (k.has(keyOf(e)) ? writePath(e, field, value) : e));
}
