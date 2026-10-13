/**
 * drafting/commands.js — AF-CAD-031 command-pattern undo with JSON deltas.
 *
 * One user gesture (a click-placement, a drag, an array, a multi-move, a 3D gizmo drag) is
 * ONE transaction. A transaction stores only what changed, as JSON-serialisable commands —
 * never a whole-design snapshot:
 *
 *   { op: "insert", key, id, index, value }        entity added to a collection
 *   { op: "delete", key, id, index, value }        entity removed (value kept for undo)
 *   { op: "patch",  key, id, set, unset, prev, prevUnset }   changed top-level fields only
 *   { op: "order",  key, before: [ids], after: [ids] }       collection re-ordered
 *   { op: "set",    key, before, after }           a non-collection document field
 *
 * Collections are keyed by entity uuid (falling back to the legacy id). A collection whose
 * entities cannot be keyed uniquely (e.g. legacy measurements with no ids) degrades to a
 * `set` of that one field — still a delta of the document, never a full snapshot.
 *
 * `DraftingHistory` is the shared, capped stack used by BOTH the 2D Engineering Designer
 * and the 3D scene editor (see sharedDraftingHistory). Commands round-trip through JSON
 * (toJSON/fromJSON) so they can be persisted, replayed on the backend or sent to
 * collaborators, as the three.js editor's History does.
 *
 * Snapshot fallback: none. The only full document a host keeps is its current state (its
 * "base"), which it needs anyway to diff the next gesture against.
 */
import { entityKey } from "./entities";

export const HISTORY_LIMIT = 100;

/** Document fields that hold keyed entity collections. */
export const COLLECTION_KEYS = new Set(["fixtures", "manualPipes", "pipes", "siteSurfaces", "siteModels", "groups", "basins"]);

const json = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

function keyedIds(list) {
  if (!Array.isArray(list)) return null;
  const ids = list.map((e) => entityKey(e));
  if (ids.some((id) => id === null || id === undefined)) return null;
  if (new Set(ids.map(String)).size !== ids.length) return null;
  return ids;
}

function patchEntity(before, after) {
  const set = {}, prev = {}, unset = [], prevUnset = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    const inB = before && Object.prototype.hasOwnProperty.call(before, k) && before[k] !== undefined;
    const inA = after && Object.prototype.hasOwnProperty.call(after, k) && after[k] !== undefined;
    if (inB && inA) {
      if (!same(before[k], after[k])) { set[k] = json(after[k]); prev[k] = json(before[k]); }
    } else if (inA) { set[k] = json(after[k]); prevUnset.push(k); }
    else if (inB) { unset.push(k); prev[k] = json(before[k]); }
  }
  if (!Object.keys(set).length && !unset.length) return null;
  return { set, unset, prev, prevUnset };
}

function applyPatch(entity, set, unset) {
  const next = { ...entity, ...json(set) };
  for (const k of unset || []) delete next[k];
  return next;
}

/** Apply collection commands (all for one key) in the forward direction. */
function applyCollection(list, cmds) {
  let out = Array.isArray(list) ? [...list] : [];
  const deletes = new Set(cmds.filter((c) => c.op === "delete").map((c) => String(c.id)));
  if (deletes.size) out = out.filter((e) => !deletes.has(String(entityKey(e))));
  for (const c of cmds) {
    if (c.op !== "patch") continue;
    out = out.map((e) => (String(entityKey(e)) === String(c.id) ? applyPatch(e, c.set, c.unset) : e));
  }
  const inserts = cmds.filter((c) => c.op === "insert").sort((a, b) => a.index - b.index);
  for (const c of inserts) out.splice(Math.min(c.index, out.length), 0, json(c.value));
  const order = cmds.find((c) => c.op === "order");
  if (order) {
    const byId = new Map(out.map((e) => [String(entityKey(e)), e]));
    const ordered = order.after.map((id) => byId.get(String(id))).filter(Boolean);
    const rest = out.filter((e) => !order.after.some((id) => String(id) === String(entityKey(e))));
    out = [...ordered, ...rest];
  }
  return out;
}

function diffCollection(key, before, after) {
  const beforeIds = keyedIds(before || []);
  const afterIds = keyedIds(after || []);
  if (!beforeIds || !afterIds) {
    return same(before, after) ? [] : [{ op: "set", key, before: json(before), after: json(after) }];
  }
  const cmds = [];
  const beforeMap = new Map(before.map((e) => [String(entityKey(e)), e]));
  const afterMap = new Map(after.map((e) => [String(entityKey(e)), e]));
  before.forEach((e, index) => {
    const id = entityKey(e);
    if (!afterMap.has(String(id))) cmds.push({ op: "delete", key, id, index, value: json(e) });
  });
  after.forEach((e, index) => {
    const id = entityKey(e);
    const prior = beforeMap.get(String(id));
    if (!prior) { cmds.push({ op: "insert", key, id, index, value: json(e) }); return; }
    if (prior === e) return;
    const p = patchEntity(prior, e);
    if (p) cmds.push({ op: "patch", key, id, ...p });
  });
  // Only record an order command if inserts/deletes alone do not reproduce the order in
  // either direction (a drag-reorder, or an insert that shifted surviving entities).
  const forward = applyCollection(before, cmds).map((e) => String(entityKey(e)));
  const backward = applyCollection(after, invertCommands(cmds)).map((e) => String(entityKey(e)));
  if (!same(forward, afterIds.map(String)) || !same(backward, beforeIds.map(String))) {
    cmds.push({ op: "order", key, before: beforeIds, after: afterIds });
  }
  return cmds;
}

/**
 * Delta between two documents, limited to `keys` (default: every key in either doc).
 * Unchanged references are skipped without serialising them.
 */
export function diffDocuments(before = {}, after = {}, keys = null) {
  const fields = keys || [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  const cmds = [];
  for (const key of fields) {
    const b = before?.[key];
    const a = after?.[key];
    if (b === a) continue;
    if (COLLECTION_KEYS.has(key) && (Array.isArray(b) || Array.isArray(a))) cmds.push(...diffCollection(key, b || [], a || []));
    else if (!same(b, a)) cmds.push({ op: "set", key, before: json(b), after: json(a) });
  }
  return cmds;
}

/** The inverse command list (undo of `commands`). */
export function invertCommands(commands = []) {
  return commands.map((c) => {
    switch (c.op) {
      case "insert": return { ...c, op: "delete" };
      case "delete": return { ...c, op: "insert" };
      case "patch": return { ...c, set: c.prev, unset: c.prevUnset, prev: c.set, prevUnset: c.unset };
      case "order": return { ...c, before: c.after, after: c.before };
      case "set": return { ...c, before: c.after, after: c.before };
      default: return c;
    }
  });
}

/**
 * Apply commands to a document. Returns `{ doc, patch }` where `patch` holds only the
 * fields that changed (what a host writes back to its state/store).
 */
export function applyCommands(doc = {}, commands = []) {
  const patch = {};
  const byKey = new Map();
  for (const c of commands) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push(c);
  }
  for (const [key, cmds] of byKey) {
    const setCmd = cmds.find((c) => c.op === "set");
    patch[key] = setCmd ? json(setCmd.after) : applyCollection(doc?.[key], cmds);
  }
  return { doc: { ...doc, ...patch }, patch };
}

/** Fields a command list touches. */
export const touchedKeys = (commands = []) => [...new Set(commands.map((c) => c.key))];

/** A short human label for a transaction ("Add 8 fixtures", "Move 2 fixtures", …). */
export function describeCommands(commands = []) {
  if (!commands.length) return "No change";
  const nouns = { fixtures: "fixture", manualPipes: "pipe", pipes: "pipe", siteSurfaces: "surface", siteModels: "model", groups: "group", basins: "basin" };
  const inserts = commands.filter((c) => c.op === "insert");
  const deletes = commands.filter((c) => c.op === "delete");
  const patches = commands.filter((c) => c.op === "patch");
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const noun = (list) => nouns[list[0].key] || "item";
  if (inserts.length && !deletes.length) return `Add ${plural(inserts.length, noun(inserts))}`;
  if (deletes.length && !inserts.length) return `Delete ${plural(deletes.length, noun(deletes))}`;
  if (patches.length && !inserts.length && !deletes.length) {
    const moved = patches.every((c) => Object.keys(c.set || {}).every((k) => ["x", "y", "z", "points"].includes(k)));
    return `${moved ? "Move" : "Edit"} ${plural(patches.length, noun(patches))}`;
  }
  const keys = touchedKeys(commands);
  return `Edit ${keys.join(", ")}`;
}

let txSeq = 0;

/**
 * Shared, capped command history. Hosts (the 2D designer, the 3D editor) `record` the
 * before/after of a gesture; `undo`/`redo` return the patch the host must write back.
 */
export class DraftingHistory {
  constructor({ limit = HISTORY_LIMIT } = {}) {
    this.limit = Math.max(1, Number(limit) || HISTORY_LIMIT);
    this.undoStack = [];
    this.redoStack = [];
    this.revision = 0;
    this._listeners = new Set();
  }

  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit(reason, tx) {
    this.revision += 1;
    for (const fn of this._listeners) { try { fn(reason, tx, this); } catch { /* listeners never break editing */ } }
  }

  state() {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label || null,
      redoLabel: this.redoStack.at(-1)?.label || null,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      revision: this.revision,
    };
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  /** Push a ready-made transaction ({label, source, commands}). */
  push(tx) {
    if (!tx?.commands?.length) return null;
    const entry = { id: tx.id || `tx-${Date.now().toString(36)}-${(txSeq += 1)}`, label: tx.label || describeCommands(tx.commands),
      source: tx.source || "2d", coalesceKey: tx.coalesceKey ?? null, at: tx.at || Date.now(), commands: tx.commands };
    this.undoStack.push(entry);
    while (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this._emit("push", entry);
    return entry;
  }

  /**
   * Record one gesture as a delta between `before` and `after` (partial documents).
   * With a `coalesceKey` equal to the top transaction's (same source, nothing undone in
   * between), the gesture is still in progress: the delta is recomputed from the
   * gesture's ORIGINAL state, so one drag = one transaction however many times it is
   * published.
   */
  record({ label = null, source = "2d", before = {}, after = {}, keys = null, coalesceKey = null } = {}) {
    const top = this.undoStack.at(-1);
    if (coalesceKey !== null && coalesceKey !== undefined && top && top.coalesceKey === coalesceKey
      && top.source === source && this.redoStack.length === 0) {
      const fields = keys || [...new Set([...touchedKeys(top.commands), ...Object.keys(after || {})])];
      const original = applyCommands(before, invertCommands(top.commands)).doc;
      const merged = diffDocuments(original, after, fields);
      if (!merged.length) { this.undoStack.pop(); this._emit("coalesce", null); return null; }
      top.commands = merged;
      top.label = label || describeCommands(merged);
      this._emit("coalesce", top);
      return top;
    }
    const commands = diffDocuments(before, after, keys);
    if (!commands.length) return null;
    return this.push({ label, source, commands, coalesceKey });
  }

  /** Undo the top transaction against `present`. Returns { patch, doc, tx } or null. */
  undo(present = {}) {
    const tx = this.undoStack.pop();
    if (!tx) return null;
    const { doc, patch } = applyCommands(present, invertCommands(tx.commands).reverse());
    this.redoStack.push(tx);
    this._emit("undo", tx);
    return { patch, doc, tx };
  }

  /** Redo the most recently undone transaction against `present`. */
  redo(present = {}) {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    const { doc, patch } = applyCommands(present, tx.commands);
    this.undoStack.push(tx);
    while (this.undoStack.length > this.limit) this.undoStack.shift();
    this._emit("redo", tx);
    return { patch, doc, tx };
  }

  clear(reason = "clear") {
    this.undoStack = [];
    this.redoStack = [];
    this._emit(reason, null);
  }

  toJSON() {
    return { version: 1, limit: this.limit, undo: json(this.undoStack), redo: json(this.redoStack) };
  }

  static fromJSON(data) {
    const h = new DraftingHistory({ limit: data?.limit });
    h.undoStack = Array.isArray(data?.undo) ? json(data.undo) : [];
    h.redoStack = Array.isArray(data?.redo) ? json(data.redo) : [];
    return h;
  }
}

/**
 * The one history shared by the 2D Engineering Designer and the 3D scene editor for
 * engineering entities (fixtures, pipes, surfaces, site models, groups, basins).
 */
export const sharedDraftingHistory = new DraftingHistory({ limit: HISTORY_LIMIT });

/** Map a document patch onto engineeringStore fields (manualPipes is mirrored to pipes). */
export function patchToStoreFields(patch = {}) {
  const out = { ...patch };
  if ("manualPipes" in patch) out.pipes = patch.manualPipes;
  if ("pipes" in patch && !("manualPipes" in patch)) out.manualPipes = patch.pipes;
  return out;
}
