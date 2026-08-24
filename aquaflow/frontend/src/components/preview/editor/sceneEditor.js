/**
 * sceneEditor.js — turns the 3D view into a workspace.
 *
 * The old preview could do exactly one thing: orbit. Every fixture position came from a
 * separate 2D panel, and nothing in the 3D view was clickable. This module supplies what
 * Depence's Project View has and ours did not — pick an object, see it highlighted, grab
 * a handle, move or rotate it with snapping, type exact numbers, duplicate it, delete it,
 * drop a new one in from the library, and navigate the way a 3D tool is expected to.
 *
 * The SceneGraph is the source of truth for layout. This class edits the graph; the
 * renderer follows it. Keeping that one-directional means the tree, the inspector, the
 * gizmo and the render can never disagree about where a fixture is.
 *
 * Navigation matches Depence's documented scheme so a designer's hands transfer:
 *   scroll            → zoom toward/away from the focus point
 *   ALT + left/middle → orbit about the picked point of interest
 *   right-drag        → pan
 *   click             → set the point of interest AND select
 */

import { TransformGizmo } from "./transformGizmo";
import { SceneGraph, NODE_TYPES } from "./sceneGraph";
import {
  TOOLS, DEFAULT_TOOL, readModifiers, matchShortcut, shouldDuplicate, GRID_SNAP_M,
} from "./editorSnapping";

const SELECT_COLOR = 0xffb020;
const HOVER_COLOR = 0x66ccff;

export class SceneEditor {
  /**
   * @param {object} deps { THREE, scene, camera, renderer, canvas, graph? }
   */
  constructor({ THREE, scene, camera, renderer, canvas, graph = null }) {
    this.T = THREE;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.canvas = canvas;
    this.graph = graph || new SceneGraph();

    this.enabled = false;
    this.tool = DEFAULT_TOOL;
    this.orthographic = false;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    // Everything the editor draws lives here, so the renderer can exclude it from the
    // water reflection and from screenshots meant for a client.
    this.root = new THREE.Group();
    this.root.name = "__editor";
    this.proxyGroup = new THREE.Group();
    this.root.add(this.proxyGroup);

    this.gizmo = new TransformGizmo(THREE);
    this.root.add(this.gizmo.root);
    this.scene.add(this.root);

    this.proxies = new Map();   // nodeId -> Mesh
    this.hoveredId = null;
    this._listeners = new Set();

    // Camera navigation state.
    this.focus = new THREE.Vector3(0, 1.2, 0);
    this._nav = null;

    this._dragMoved = false;
    this._pendingDuplicate = false;

    this._bind();
    this.gizmo.setMode(this.tool);
  }

  // ── events out ────────────────────────────────────────────────────────────
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit(reason) { for (const fn of this._listeners) { try { fn(reason, this); } catch { /* never let a listener break editing */ } } }

  setEnabled(on) {
    this.enabled = !!on;
    this.root.visible = this.enabled;
    if (!this.enabled) this.gizmo.root.visible = false;
    this._emit("enabled");
  }

  setTool(tool) {
    this.tool = tool || DEFAULT_TOOL;
    this.gizmo.setMode(this.tool);
    this._emit("tool");
  }

  setOrthographic(on) { this.orthographic = !!on; }

  // ── proxies: one pickable marker per editable node ────────────────────────
  /**
   * Rebuild the pickable proxies from the graph. Called whenever the graph's structure
   * changes; cheap because proxies are shared-geometry billboarded markers, not models.
   */
  syncProxies() {
    const T = this.T;
    const seen = new Set();

    for (const { node } of this.graph.flatten()) {
      if (node.type === NODE_TYPES.GROUP) continue;   // groups are picked via the tree
      seen.add(node.id);
      let mesh = this.proxies.get(node.id);
      if (!mesh) {
        // A small octahedron reads as a handle at any angle and costs nothing.
        const geo = new T.OctahedronGeometry(0.13, 0);
        const mat = new T.MeshBasicMaterial({
          color: this._baseColorFor(node.type),
          transparent: true, opacity: 0.85, depthTest: true, toneMapped: false,
          wireframe: false,
        });
        mesh = new T.Mesh(geo, mat);
        mesh.userData.nodeId = node.id;
        mesh.renderOrder = 9000;
        this.proxyGroup.add(mesh);
        this.proxies.set(node.id, mesh);
      }
      const p = this.graph.worldPosition(node.id);
      mesh.position.set(p.x, p.y, p.z);
      mesh.visible = this.graph.isVisible(node.id);
      this._paint(node.id);
    }

    // Drop proxies for nodes that no longer exist.
    for (const [id, mesh] of [...this.proxies]) {
      if (seen.has(id)) continue;
      this.proxyGroup.remove(mesh);
      mesh.geometry.dispose(); mesh.material.dispose();
      this.proxies.delete(id);
    }
    this._updateGizmo();
  }

  _baseColorFor(type) {
    switch (type) {
      case NODE_TYPES.NOZZLE: return 0x3fa9ff;
      case NODE_TYPES.LIGHT: return 0xffd54a;
      case NODE_TYPES.PUMP: return 0x9b7bff;
      case NODE_TYPES.VALVE: return 0x59d98a;
      case NODE_TYPES.DISTRIBUTOR: return 0xff8a5c;
      default: return 0xaab4c4;
    }
  }

  _paint(id) {
    const mesh = this.proxies.get(id);
    const node = this.graph.get(id);
    if (!mesh || !node) return;
    const selected = this.graph.selection.has(id);
    const hovered = this.hoveredId === id;
    const color = selected ? SELECT_COLOR : (hovered ? HOVER_COLOR : this._baseColorFor(node.type));
    mesh.material.color.setHex(color);
    mesh.material.opacity = selected ? 1.0 : 0.85;
    mesh.scale.setScalar(selected ? 1.45 : 1.0);
  }

  _repaintAll() { for (const id of this.proxies.keys()) this._paint(id); }

  _updateGizmo() {
    const center = this.graph.selectionCenter();
    const editable = this.graph.selected().some(id => !this.graph.isLocked(id));
    this.gizmo.update(editable ? center : null, this.camera);
  }

  /** Call once per frame so the gizmo keeps a constant on-screen size. */
  update() {
    if (!this.enabled) return;
    this._updateGizmo();
  }

  /**
   * The scene supplies the quad layout when four-pane mode is on. Wiring it lets a click
   * be resolved against the camera of the pane it actually landed in; without this,
   * picking in the Top view would silently raycast from the perspective camera and
   * select whatever happened to line up there instead.
   */
  attachViewportSource(scene) { this._viewportSource = scene || null; }

  /** Which pane is this client point in, and what camera and rect does it use? */
  _paneAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const src = this._viewportSource;
    if (!src?.isQuadView?.()) {
      return { camera: this.camera, rect, orthographic: false };
    }
    const fx = (clientX - rect.left) / rect.width;
    // Canvas Y grows downward; viewport fractions grow upward.
    const fy = 1 - (clientY - rect.top) / rect.height;
    for (const p of src.quadLayout()) {
      if (fx >= p.x && fx < p.x + p.w && fy >= p.y && fy < p.y + p.h) {
        return {
          camera: src.quadCamera(p.key),
          orthographic: p.key !== "persp",
          paneKey: p.key,
          rect: {
            left: rect.left + p.x * rect.width,
            // The pane's top edge in client coordinates.
            top: rect.top + (1 - (p.y + p.h)) * rect.height,
            width: p.w * rect.width,
            height: p.h * rect.height,
          },
        };
      }
    }
    return { camera: this.camera, rect, orthographic: false };
  }

  // ── pointer plumbing ──────────────────────────────────────────────────────
  _setPointer(e) {
    const pane = this._paneAt(e.clientX, e.clientY);
    const r = pane.rect;
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.activePane = pane;
    // The CAD axis-lock rule applies only in an orthographic pane, exactly as in Depence.
    this.orthographic = !!pane.orthographic;
    this.raycaster.setFromCamera(this.pointer, pane.camera);
  }

  /** Topmost editable node under the pointer, or null. */
  _pickNode() {
    const meshes = [...this.proxies.values()].filter(m => m.visible);
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const h of hits) {
      const id = h.object.userData.nodeId;
      if (id && !this.graph.isLocked(id)) return id;
    }
    return null;
  }

  /** Where the pointer meets the ground plane — used for library drops and panning. */
  groundPoint(y = 0) {
    const T = this.T;
    const plane = new T.Plane(new T.Vector3(0, 1, 0), -y);
    const out = new T.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  _bind() {
    const c = this.canvas;
    this._onPointerDown = (e) => {
      if (!this.enabled) return;
      this._setPointer(e);
      const mods = readModifiers(e);
      this._dragMoved = false;

      // Right button, or ALT+left: navigation, never editing.
      if (e.button === 2 || (mods.freeform && e.button === 0) || e.button === 1) {
        this._nav = {
          mode: (e.button === 2) ? "pan" : "orbit",
          x: e.clientX, y: e.clientY,
        };
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return;

      // A gizmo handle wins over everything behind it.
      const handle = this.gizmo.pick(this.raycaster);
      if (handle) {
        const center = this.graph.selectionCenter();
        if (center && this.gizmo.beginDrag(handle, this.raycaster, center)) {
          this._pendingDuplicate = shouldDuplicate(mods);
          this._dragStart = this.graph.selected().map(id => ({
            id, pos: { ...this.graph.get(id).transform.position },
            rot: { ...this.graph.get(id).transform.rotation },
          }));
          e.preventDefault();
          return;
        }
      }

      const id = this._pickNode();
      if (id) {
        this.graph.select([id], { additive: mods.snap || mods.duplicate });
        // Clicking an object also makes it the navigation pivot, as Depence does.
        const p = this.graph.worldPosition(id);
        this.focus.set(p.x, p.y, p.z);
      } else {
        this.graph.clearSelection();
        const gp = this.groundPoint(0);
        if (gp) this.focus.copy(gp);
      }
      this._repaintAll();
      this._updateGizmo();
      this._emit("selection");
    };

    this._onPointerMove = (e) => {
      if (!this.enabled) return;

      if (this._nav) {
        const dx = e.clientX - this._nav.x;
        const dy = e.clientY - this._nav.y;
        this._nav.x = e.clientX; this._nav.y = e.clientY;
        if (this._nav.mode === "orbit") this.orbit(dx, dy);
        else this.pan(dx, dy);
        return;
      }

      this._setPointer(e);

      if (this.gizmo.isDragging()) {
        this._dragMoved = true;
        const mods = readModifiers(e);
        const res = this.gizmo.updateDrag(this.raycaster, mods, { orthographic: this.orthographic });
        if (res) this._applyDrag(res);
        return;
      }

      // Hover feedback: gizmo handle first, then objects.
      const handle = this.gizmo.pick(this.raycaster);
      this.gizmo.setHovered(handle);
      const id = handle ? null : this._pickNode();
      if (id !== this.hoveredId) {
        this.hoveredId = id;
        this._repaintAll();
        this.canvas.style.cursor = handle ? "grab" : (id ? "pointer" : "default");
      }
    };

    this._onPointerUp = () => {
      this._nav = null;
      if (this.gizmo.isDragging()) {
        this.gizmo.endDrag();
        this._pendingDuplicate = false;
        this._dragStart = null;
        if (this._dragMoved) this._emit("transform");
      }
    };

    this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.dolly(e.deltaY);
    };

    this._onContextMenu = (e) => { if (this.enabled) e.preventDefault(); };

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      const target = e.target;
      // Never steal keys from a field the designer is typing in.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const cmd = matchShortcut(e);
      if (!cmd) return;
      e.preventDefault();
      this.command(cmd);
    };

    c.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    c.addEventListener("wheel", this._onWheel, { passive: false });
    c.addEventListener("contextmenu", this._onContextMenu);
    window.addEventListener("keydown", this._onKeyDown);
  }

  /** Apply a gizmo drag result to every selected node. */
  _applyDrag(res) {
    const ids = this.graph.selected();
    if (ids.length === 0) return;

    // CTRL+drag duplicates: swap the selection for fresh copies once, at the first
    // movement, then carry on dragging those.
    if (this._pendingDuplicate) {
      this._pendingDuplicate = false;
      const copies = ids.map(id => this.graph.duplicate(id)).filter(Boolean);
      this.graph.select(copies.map(c => c.id));
      this.syncProxies();
      this._dragStart = this.graph.selected().map(id => ({
        id, pos: { ...this.graph.get(id).transform.position },
        rot: { ...this.graph.get(id).transform.rotation },
      }));
      this._emit("structure");
    }

    const starts = this._dragStart || [];
    if (res.type === "translate") {
      const center = this.graph.selectionCenter();
      if (!center) return;
      // Move by the delta of the gizmo centre, so a multi-selection keeps its shape.
      const dx = res.position.x - center.x;
      const dy = res.position.y - center.y;
      const dz = res.position.z - center.z;
      for (const id of this.graph.selected()) {
        const t = this.graph.get(id)?.transform?.position;
        if (!t) continue;
        this.graph.setTransform(id, { position: { x: t.x + dx, y: t.y + dy, z: t.z + dz } });
      }
    } else if (res.type === "rotate") {
      for (const s of starts) {
        const base = s.rot || { x: 0, y: 0, z: 0 };
        this.graph.setTransform(s.id, {
          rotation: { ...base, [res.axis]: (base[res.axis] || 0) + res.deltaDeg },
        });
      }
    }
    this.syncProxies();
    this._emit("transform-live");
  }

  // ── camera navigation ─────────────────────────────────────────────────────
  orbit(dx, dy) {
    const cam = this.camera;
    const off = cam.position.clone().sub(this.focus);
    const radius = off.length();
    let theta = Math.atan2(off.x, off.z);
    let phi = Math.acos(Math.max(-1, Math.min(1, off.y / radius)));
    theta -= dx * 0.005;
    phi -= dy * 0.005;
    // Stop just short of the poles, where the up vector flips and the view rolls.
    phi = Math.max(0.05, Math.min(Math.PI - 0.05, phi));
    cam.position.set(
      this.focus.x + radius * Math.sin(phi) * Math.sin(theta),
      this.focus.y + radius * Math.cos(phi),
      this.focus.z + radius * Math.sin(phi) * Math.cos(theta),
    );
    cam.lookAt(this.focus);
    this._emit("camera");
  }

  pan(dx, dy) {
    const cam = this.camera;
    const dist = cam.position.distanceTo(this.focus);
    // Scale panning by distance so it feels the same close up and far away.
    const k = dist * 0.0016;
    const right = new this.T.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new this.T.Vector3().setFromMatrixColumn(cam.matrix, 1);
    const move = right.multiplyScalar(-dx * k).add(up.multiplyScalar(dy * k));
    cam.position.add(move);
    this.focus.add(move);
    cam.lookAt(this.focus);
    this._emit("camera");
  }

  dolly(deltaY) {
    const cam = this.camera;
    const off = cam.position.clone().sub(this.focus);
    const scale = Math.pow(0.95, -deltaY / 100);
    const len = Math.max(0.6, Math.min(200, off.length() * scale));
    cam.position.copy(this.focus).add(off.setLength(len));
    cam.lookAt(this.focus);
    this._emit("camera");
  }

  /** Frame the current selection, or the whole scene when nothing is selected. */
  focusSelection() {
    const ids = this.graph.selected();
    const pts = (ids.length ? ids : [...this.graph.nodes.keys()])
      .map(id => this.graph.worldPosition(id));
    if (pts.length === 0) return;
    let min = { x: Infinity, y: Infinity, z: Infinity };
    let max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const p of pts) {
      min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y), z: Math.min(min.z, p.z) };
      max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y), z: Math.max(max.z, p.z) };
    }
    const c = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
    const span = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1.5);
    this.focus.set(c.x, c.y, c.z);
    const dir = this.camera.position.clone().sub(this.focus).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.5, 0.6).normalize();
    this.camera.position.copy(this.focus).addScaledVector(dir, span * 2.2);
    this.camera.lookAt(this.focus);
    this._emit("camera");
  }

  // ── commands ──────────────────────────────────────────────────────────────
  command(cmd) {
    switch (cmd) {
      case "tool:move":   this.setTool(TOOLS.MOVE); break;
      case "tool:rotate": this.setTool(TOOLS.ROTATE); break;
      case "tool:select": this.setTool(TOOLS.SELECT); break;
      case "edit:duplicate": this.duplicateSelection(); break;
      case "edit:delete": this.deleteSelection(); break;
      case "select:all": this.selectAll(); break;
      case "view:focus": this.focusSelection(); break;
      default: return false;
    }
    return true;
  }

  duplicateSelection() {
    const ids = this.graph.selected();
    if (!ids.length) return [];
    // Offset by one grid step so the copy is visibly separate rather than hidden
    // exactly behind the original.
    const copies = ids.map(id => this.graph.duplicate(id, { x: GRID_SNAP_M * 3, z: GRID_SNAP_M * 3 }))
      .filter(Boolean);
    this.graph.select(copies.map(c => c.id));
    this.syncProxies();
    this._emit("structure");
    return copies;
  }

  deleteSelection() {
    const ids = this.graph.selected().filter(id => !this.graph.isLocked(id));
    for (const id of ids) this.graph.remove(id);
    this.graph.clearSelection();
    this.syncProxies();
    this._emit("structure");
    return ids.length;
  }

  selectAll() {
    this.graph.select([...this.graph.nodes.keys()].filter(id => !this.graph.isLocked(id)));
    this._repaintAll();
    this._updateGizmo();
    this._emit("selection");
  }

  groupSelection(name = "Group") {
    const g = this.graph.group(this.graph.selected(), name);
    if (g) { this.graph.select([g.id]); this.syncProxies(); this._emit("structure"); }
    return g;
  }

  /**
   * Drop a new fixture at a screen position — the library drag-and-drop landing.
   * @returns the created node, or null if the pointer was not over the ground
   */
  dropAt(clientX, clientY, spec) {
    this._setPointer({ clientX, clientY });
    const p = this.groundPoint(0);
    if (!p) return null;
    const node = this.graph.add({
      ...spec,
      position: { x: p.x, y: spec?.position?.y ?? 0, z: p.z },
    });
    this.graph.select([node.id]);
    this.syncProxies();
    this._emit("structure");
    return node;
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    c.removeEventListener("wheel", this._onWheel);
    c.removeEventListener("contextmenu", this._onContextMenu);
    window.removeEventListener("keydown", this._onKeyDown);
    for (const m of this.proxies.values()) { m.geometry.dispose(); m.material.dispose(); }
    this.proxies.clear();
    this.gizmo.dispose();
    this.scene.remove(this.root);
  }
}
