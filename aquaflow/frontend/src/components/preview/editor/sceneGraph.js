/**
 * sceneGraph.js — the project's object tree.
 *
 * Depence stores every 3D object in a hierarchic Scene Graph where "each object inherits
 * the position, rotation and scale values from its parent object". That single property
 * is what turns a flat list of fixtures into something a designer can actually structure:
 * group eight nozzles into a ring, rotate the ring, and every nozzle follows — without
 * touching eight sets of coordinates.
 *
 * AquaFlow had no such structure. Nozzles were a flat array with x/z and no parents, no
 * groups, no layers and no notion of selection. This module supplies that model.
 *
 * Pure: no three.js and no DOM, so the transform algebra is unit-testable. The renderer
 * consumes world transforms from here; it does not own them.
 */

let _seq = 0;
/** Deterministic-ish unique id. Sequence, not randomness, so tests are reproducible. */
function nextId(prefix = "node") { return `${prefix}-${++_seq}`; }
/** Test hook: reset the id sequence. */
export function __resetIds() { _seq = 0; }

export const NODE_TYPES = {
  GROUP: "group",
  NOZZLE: "nozzle",
  LIGHT: "light",
  PUMP: "pump",
  VALVE: "valve",
  DISTRIBUTOR: "distributor",
  MODEL: "model",
  CAMERA: "camera",
};

export function identity() {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
}

/** Column-vector convention: result = a * b, both row-major 4x4. */
export function multiply(a, b) {
  const o = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] =
        a[r * 4 + 0] * b[0 * 4 + c] +
        a[r * 4 + 1] * b[1 * 4 + c] +
        a[r * 4 + 2] * b[2 * 4 + c] +
        a[r * 4 + 3] * b[3 * 4 + c];
    }
  }
  return o;
}

const D2R = Math.PI / 180;

/**
 * Compose a TRS matrix. Rotation is Euler XYZ in DEGREES, applied X then Y then Z,
 * matching what the Transformation panel shows a designer.
 */
export function compose(t) {
  const p = t?.position || { x: 0, y: 0, z: 0 };
  const r = t?.rotation || { x: 0, y: 0, z: 0 };
  const s = t?.scale ?? 1;
  const sx = typeof s === "number" ? s : (s.x ?? 1);
  const sy = typeof s === "number" ? s : (s.y ?? 1);
  const sz = typeof s === "number" ? s : (s.z ?? 1);

  const cx = Math.cos((r.x || 0) * D2R), sxr = Math.sin((r.x || 0) * D2R);
  const cy = Math.cos((r.y || 0) * D2R), syr = Math.sin((r.y || 0) * D2R);
  const cz = Math.cos((r.z || 0) * D2R), szr = Math.sin((r.z || 0) * D2R);

  // R = Rz * Ry * Rx
  const m00 = cz * cy;
  const m01 = cz * syr * sxr - szr * cx;
  const m02 = cz * syr * cx + szr * sxr;
  const m10 = szr * cy;
  const m11 = szr * syr * sxr + cz * cx;
  const m12 = szr * syr * cx - cz * sxr;
  const m20 = -syr;
  const m21 = cy * sxr;
  const m22 = cy * cx;

  return [
    m00 * sx, m01 * sy, m02 * sz, p.x || 0,
    m10 * sx, m11 * sy, m12 * sz, p.y || 0,
    m20 * sx, m21 * sy, m22 * sz, p.z || 0,
    0, 0, 0, 1,
  ];
}

/** World-space translation carried by a matrix. */
export function translationOf(m) {
  return { x: m[3], y: m[7], z: m[11] };
}

/** Transform a point by a matrix. */
export function transformPoint(m, p) {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3],
    y: m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7],
    z: m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11],
  };
}

export class SceneGraph {
  constructor() {
    this.nodes = new Map();      // id -> node
    this.rootIds = [];
    this.layers = new Map();     // id -> {id, name, visible, locked}
    this.selection = new Set();
    this._listeners = new Set();
    this.addLayer("Default", "layer-default");
  }

  // ── change notification ───────────────────────────────────────────────────
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit(reason) { for (const fn of this._listeners) { try { fn(reason, this); } catch { /* a bad listener must not break the graph */ } } }

  // ── layers ────────────────────────────────────────────────────────────────
  addLayer(name, id = null) {
    const layer = { id: id || nextId("layer"), name: name || "Layer", visible: true, locked: false };
    this.layers.set(layer.id, layer);
    this._emit("layers");
    return layer;
  }
  setLayerVisible(id, visible) {
    const l = this.layers.get(id);
    if (l) { l.visible = !!visible; this._emit("layers"); }
  }

  // ── nodes ─────────────────────────────────────────────────────────────────
  /**
   * @param {object} spec { id?, name, type, parentId?, position?, rotation?, scale?, props? }
   */
  add(spec = {}) {
    const node = {
      id: spec.id || nextId(spec.type || "node"),
      name: spec.name || spec.type || "Object",
      type: spec.type || NODE_TYPES.MODEL,
      parentId: null,
      childIds: [],
      transform: {
        position: { x: 0, y: 0, z: 0, ...(spec.position || {}) },
        rotation: { x: 0, y: 0, z: 0, ...(spec.rotation || {}) },
        scale: spec.scale ?? 1,
      },
      visible: spec.visible !== false,
      locked: !!spec.locked,
      layerId: spec.layerId || "layer-default",
      props: { ...(spec.props || {}) },
    };
    this.nodes.set(node.id, node);
    if (spec.parentId && this.nodes.has(spec.parentId)) {
      this._link(node.id, spec.parentId);
    } else {
      this.rootIds.push(node.id);
    }
    this._emit("add");
    return node;
  }

  get(id) { return this.nodes.get(id) || null; }

  remove(id) {
    const node = this.nodes.get(id);
    if (!node) return false;
    // Depth-first so children are gone before the parent's bookkeeping is touched.
    for (const childId of [...node.childIds]) this.remove(childId);
    this._unlink(id);
    this.nodes.delete(id);
    this.selection.delete(id);
    this._emit("remove");
    return true;
  }

  _unlink(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    if (node.parentId) {
      const p = this.nodes.get(node.parentId);
      if (p) p.childIds = p.childIds.filter(c => c !== id);
    } else {
      this.rootIds = this.rootIds.filter(r => r !== id);
    }
    node.parentId = null;
  }

  _link(id, parentId) {
    const node = this.nodes.get(id);
    const parent = this.nodes.get(parentId);
    if (!node || !parent) return;
    node.parentId = parentId;
    if (!parent.childIds.includes(id)) parent.childIds.push(id);
  }

  /** Would reparenting `id` under `parentId` create a cycle? */
  wouldCycle(id, parentId) {
    let cur = parentId;
    while (cur) {
      if (cur === id) return true;
      cur = this.nodes.get(cur)?.parentId || null;
    }
    return false;
  }

  /**
   * Reparent, preserving the node's WORLD position. Without this a designer dragging a
   * fixture into a group in the tree would watch it teleport, which is the classic
   * scene-graph usability failure.
   */
  reparent(id, parentId) {
    const node = this.nodes.get(id);
    if (!node) return false;
    if (parentId && !this.nodes.has(parentId)) return false;
    if (parentId && this.wouldCycle(id, parentId)) return false;

    const worldBefore = this.worldMatrix(id);
    this._unlink(id);
    if (parentId) this._link(id, parentId); else this.rootIds.push(id);

    // Re-express the same world translation in the new parent's space.
    const parentWorld = parentId ? this.worldMatrix(parentId) : identity();
    const inv = invertAffine(parentWorld);
    const wp = translationOf(worldBefore);
    const local = transformPoint(inv, wp);
    node.transform.position = { x: local.x, y: local.y, z: local.z };

    this._emit("reparent");
    return true;
  }

  /** Local matrix of one node. */
  localMatrix(id) {
    const n = this.nodes.get(id);
    return n ? compose(n.transform) : identity();
  }

  /** World matrix, composing every ancestor — the inheritance rule. */
  worldMatrix(id) {
    const chain = [];
    let cur = id;
    while (cur) {
      const n = this.nodes.get(cur);
      if (!n) break;
      chain.push(cur);
      cur = n.parentId;
    }
    let m = identity();
    for (let i = chain.length - 1; i >= 0; i--) m = multiply(m, this.localMatrix(chain[i]));
    return m;
  }

  /** World position of a node. */
  worldPosition(id) { return translationOf(this.worldMatrix(id)); }

  /** Set a node's local transform (partial update). */
  setTransform(id, patch) {
    const n = this.nodes.get(id);
    if (!n || n.locked) return false;
    if (patch.position) n.transform.position = { ...n.transform.position, ...patch.position };
    if (patch.rotation) n.transform.rotation = { ...n.transform.rotation, ...patch.rotation };
    if (patch.scale !== undefined) n.transform.scale = patch.scale;
    this._emit("transform");
    return true;
  }

  /**
   * Effective visibility — a node is only visible if it, every ancestor, and its layer
   * are all visible. Hiding a group must hide its contents.
   */
  isVisible(id) {
    const n = this.nodes.get(id);
    if (!n) return false;
    if (!n.visible) return false;
    const layer = this.layers.get(n.layerId);
    if (layer && !layer.visible) return false;
    return n.parentId ? this.isVisible(n.parentId) : true;
  }

  setVisible(id, visible) {
    const n = this.nodes.get(id);
    if (!n) return false;
    n.visible = !!visible;
    this._emit("visibility");
    return true;
  }

  /** Is the node editable? Locked nodes, and children of locked nodes, are not. */
  isLocked(id) {
    const n = this.nodes.get(id);
    if (!n) return true;
    if (n.locked) return true;
    const layer = this.layers.get(n.layerId);
    if (layer && layer.locked) return true;
    return n.parentId ? this.isLocked(n.parentId) : false;
  }

  // ── grouping ──────────────────────────────────────────────────────────────
  /**
   * Group nodes under a new parent placed at their centroid, so rotating the group
   * turns the arrangement about its own centre rather than about the world origin.
   */
  group(ids, name = "Group") {
    const valid = (ids || []).filter(i => this.nodes.has(i));
    if (valid.length === 0) return null;

    let cx = 0, cy = 0, cz = 0;
    for (const id of valid) {
      const p = this.worldPosition(id);
      cx += p.x; cy += p.y; cz += p.z;
    }
    cx /= valid.length; cy /= valid.length; cz /= valid.length;

    // The group joins the common parent, so grouping does not change nesting depth.
    const firstParent = this.nodes.get(valid[0])?.parentId || null;
    const commonParent = valid.every(i => (this.nodes.get(i)?.parentId || null) === firstParent)
      ? firstParent : null;

    const g = this.add({
      type: NODE_TYPES.GROUP, name,
      position: { x: cx, y: cy, z: cz },
      parentId: commonParent || undefined,
    });
    for (const id of valid) this.reparent(id, g.id);
    this._emit("group");
    return g;
  }

  /** Dissolve a group, keeping its children where they are in the world. */
  ungroup(groupId) {
    const g = this.nodes.get(groupId);
    if (!g) return false;
    const parentId = g.parentId;
    for (const childId of [...g.childIds]) this.reparent(childId, parentId);
    this.remove(groupId);
    this._emit("ungroup");
    return true;
  }

  /** Deep copy of a node and its subtree, offset in world space. */
  duplicate(id, offset = { x: 0, y: 0, z: 0 }) {
    const src = this.nodes.get(id);
    if (!src) return null;
    const copy = this.add({
      name: `${src.name} copy`,
      type: src.type,
      parentId: src.parentId || undefined,
      position: {
        x: src.transform.position.x + (offset.x || 0),
        y: src.transform.position.y + (offset.y || 0),
        z: src.transform.position.z + (offset.z || 0),
      },
      rotation: { ...src.transform.rotation },
      scale: src.transform.scale,
      layerId: src.layerId,
      props: { ...src.props },
    });
    // Snapshot the child list. Each recursive duplicate() briefly attaches its copy to
    // THIS node before being reparented, so iterating the live array would re-copy the
    // copies and recurse away.
    for (const childId of [...src.childIds]) {
      const childCopy = this.duplicate(childId);
      if (childCopy) this.reparent(childCopy.id, copy.id);
    }
    return copy;
  }

  // ── selection ─────────────────────────────────────────────────────────────
  select(ids, { additive = false } = {}) {
    const list = Array.isArray(ids) ? ids : (ids == null ? [] : [ids]);
    if (!additive) this.selection.clear();
    for (const id of list) {
      if (!this.nodes.has(id)) continue;
      // Toggle on additive click, which is what CTRL/SHIFT-click does in an editor.
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this._emit("selection");
    return [...this.selection];
  }
  clearSelection() { this.selection.clear(); this._emit("selection"); }
  selected() { return [...this.selection]; }

  /** Centroid of the current selection — where the gizmo is drawn. */
  selectionCenter() {
    const ids = this.selected();
    if (ids.length === 0) return null;
    let x = 0, y = 0, z = 0;
    for (const id of ids) { const p = this.worldPosition(id); x += p.x; y += p.y; z += p.z; }
    return { x: x / ids.length, y: y / ids.length, z: z / ids.length };
  }

  // ── queries ───────────────────────────────────────────────────────────────
  /** Flat list in tree order, with depth, for rendering the hierarchy panel. */
  flatten(filter = null) {
    const out = [];
    const walk = (id, depth) => {
      const n = this.nodes.get(id);
      if (!n) return;
      const matches = !filter || matchesFilter(n, filter);
      if (matches) out.push({ node: n, depth });
      for (const c of n.childIds) walk(c, matches ? depth + 1 : depth);
    };
    for (const r of this.rootIds) walk(r, 0);
    return out;
  }

  /** All nodes of a type, anywhere in the tree. */
  byType(type) {
    return [...this.nodes.values()].filter(n => n.type === type);
  }

  count() { return this.nodes.size; }

  /** Serialise to a plain object for saving with the project. */
  toJSON() {
    return {
      nodes: [...this.nodes.values()].map(n => ({
        id: n.id, name: n.name, type: n.type, parentId: n.parentId,
        transform: n.transform, visible: n.visible, locked: n.locked,
        layerId: n.layerId, props: n.props,
      })),
      rootIds: [...this.rootIds],
      layers: [...this.layers.values()],
    };
  }

  static fromJSON(data) {
    const g = new SceneGraph();
    if (!data) return g;
    g.layers.clear();
    for (const l of data.layers || []) g.layers.set(l.id, { ...l });
    if (g.layers.size === 0) g.addLayer("Default", "layer-default");
    // Two passes: create every node, then link, so forward references are fine.
    for (const n of data.nodes || []) {
      g.nodes.set(n.id, {
        id: n.id, name: n.name, type: n.type, parentId: null, childIds: [],
        transform: n.transform, visible: n.visible !== false, locked: !!n.locked,
        layerId: n.layerId || "layer-default", props: { ...(n.props || {}) },
      });
    }
    for (const n of data.nodes || []) {
      if (n.parentId && g.nodes.has(n.parentId)) g._link(n.id, n.parentId);
    }
    g.rootIds = (data.rootIds || []).filter(id => g.nodes.has(id));
    // Anything orphaned by a malformed file still belongs somewhere.
    for (const n of g.nodes.values()) {
      if (!n.parentId && !g.rootIds.includes(n.id)) g.rootIds.push(n.id);
    }
    return g;
  }
}

function matchesFilter(node, filter) {
  if (!filter) return true;
  if (typeof filter === "function") return filter(node);
  const { text, types } = filter;
  if (types && types.length && !types.includes(node.type)) return false;
  if (text && !String(node.name).toLowerCase().includes(String(text).toLowerCase())) return false;
  return true;
}

/**
 * Invert an affine TRS matrix. General enough for scene-graph transforms (rotation,
 * uniform/non-uniform scale, translation) without pulling in a full matrix library.
 */
export function invertAffine(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[4], a11 = m[5], a12 = m[6];
  const a20 = m[8], a21 = m[9], a22 = m[10];
  const tx = m[3], ty = m[7], tz = m[11];

  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);
  if (!det || !Number.isFinite(det)) return identity();
  const id = 1 / det;

  const b00 = (a11 * a22 - a12 * a21) * id;
  const b01 = (a02 * a21 - a01 * a22) * id;
  const b02 = (a01 * a12 - a02 * a11) * id;
  const b10 = (a12 * a20 - a10 * a22) * id;
  const b11 = (a00 * a22 - a02 * a20) * id;
  const b12 = (a02 * a10 - a00 * a12) * id;
  const b20 = (a10 * a21 - a11 * a20) * id;
  const b21 = (a01 * a20 - a00 * a21) * id;
  const b22 = (a00 * a11 - a01 * a10) * id;

  return [
    b00, b01, b02, -(b00 * tx + b01 * ty + b02 * tz),
    b10, b11, b12, -(b10 * tx + b11 * ty + b12 * tz),
    b20, b21, b22, -(b20 * tx + b21 * ty + b22 * tz),
    0, 0, 0, 1,
  ];
}
