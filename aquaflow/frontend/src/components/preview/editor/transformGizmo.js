/**
 * transformGizmo.js — the handles you grab to move and rotate things.
 *
 * This is the part that makes a 3D view an editor rather than a picture. Depence gives a
 * designer axis arrows and plane movers for translation and a gimbal for rotation, with
 * SHIFT snapping to a 10 cm / 5° raster; this is the same instrument.
 *
 * Built directly on three.js primitives rather than pulling in TransformControls, for
 * three reasons: the drag has to route through editorSnapping so the snap rules have one
 * definition, the handles have to stay out of the water's planar-reflection pass, and the
 * gizmo has to drive a SceneGraph rather than mutate Object3D transforms behind our back.
 */

import {
  resolveDrag, snapAngleDeg, TOOLS,
} from "./editorSnapping";

const AXIS_COLORS = { x: 0xff3b52, y: 0x53d769, z: 0x3b8dff };
const HOVER_COLOR = 0xffcc33;

/** Closest point to `ray` on the infinite line through `origin` along `dir`. */
function closestPointOnAxis(rayOrigin, rayDir, origin, dir, T) {
  const w0 = new T.Vector3().subVectors(origin, rayOrigin);
  const a = dir.dot(dir);
  const b = dir.dot(rayDir);
  const c = rayDir.dot(rayDir);
  const d = dir.dot(w0);
  const e = rayDir.dot(w0);
  const denom = a * c - b * b;
  // Parallel ray and axis: no stable solution, so report failure rather than jump.
  if (Math.abs(denom) < 1e-8) return null;
  const s = (b * e - c * d) / denom;
  return new T.Vector3().copy(origin).addScaledVector(dir, s);
}

/** Intersect a ray with the plane through `origin` with normal `normal`. */
function rayPlane(rayOrigin, rayDir, origin, normal, T) {
  const denom = normal.dot(rayDir);
  if (Math.abs(denom) < 1e-8) return null;   // ray parallel to the plane
  const t = new T.Vector3().subVectors(origin, rayOrigin).dot(normal) / denom;
  if (t < 0) return null;                    // plane is behind the camera
  return new T.Vector3().copy(rayOrigin).addScaledVector(rayDir, t);
}

export class TransformGizmo {
  constructor(THREE) {
    this.T = THREE;
    const T = THREE;

    this.root = new T.Group();
    this.root.visible = false;
    // Drawn last and never depth-tested, so a handle buried inside a fixture is still
    // grabbable — a gizmo you cannot reach is worse than no gizmo.
    this.root.renderOrder = 9999;

    this.moveGroup = new T.Group();
    this.rotateGroup = new T.Group();
    this.root.add(this.moveGroup, this.rotateGroup);

    this.handles = [];     // pickable meshes, each tagged with userData.gizmo
    this._buildMove();
    this._buildRotate();

    this.mode = TOOLS.MOVE;
    this.drag = null;      // active drag state
    this.hovered = null;
    this._size = 1;
  }

  _mat(color, opacity = 1) {
    return new this.T.MeshBasicMaterial({
      color, transparent: true, opacity,
      depthTest: false, depthWrite: false,
      toneMapped: false,          // handles are UI, not lit scene content
      side: this.T.DoubleSide,
    });
  }

  _tag(mesh, kind, axis) {
    mesh.userData.gizmo = { kind, axis };
    mesh.renderOrder = 9999;
    this.handles.push(mesh);
    return mesh;
  }

  _buildMove() {
    const T = this.T;
    const L = 1.0, R = 0.016;
    const dirs = {
      x: new T.Vector3(1, 0, 0),
      y: new T.Vector3(0, 1, 0),
      z: new T.Vector3(0, 0, 1),
    };

    for (const axis of ["x", "y", "z"]) {
      const color = AXIS_COLORS[axis];
      const g = new T.Group();

      const shaft = new T.Mesh(new T.CylinderGeometry(R, R, L, 8), this._mat(color));
      shaft.position.y = L / 2;
      const head = new T.Mesh(new T.ConeGeometry(R * 3.2, L * 0.22, 12), this._mat(color));
      head.position.y = L + L * 0.11;
      // A fat invisible cylinder around the arrow: the visible handle is thin, but the
      // grab target must be forgiving or precise work becomes a hunt for pixels.
      const grab = new T.Mesh(new T.CylinderGeometry(R * 7, R * 7, L * 1.25, 6),
        new T.MeshBasicMaterial({ visible: false }));
      grab.position.y = L * 0.62;

      g.add(shaft, head, grab);
      for (const m of [shaft, head, grab]) this._tag(m, "translate", axis);

      if (axis === "x") g.rotation.z = -Math.PI / 2;
      if (axis === "z") g.rotation.x = Math.PI / 2;
      g.userData.axisDir = dirs[axis];
      this.moveGroup.add(g);
    }

    // Plane movers — drag across two axes at once.
    const planes = [
      { axis: "xz", normal: new T.Vector3(0, 1, 0), color: AXIS_COLORS.y, rot: { x: -Math.PI / 2 } },
      { axis: "xy", normal: new T.Vector3(0, 0, 1), color: AXIS_COLORS.z, rot: {} },
      { axis: "zy", normal: new T.Vector3(1, 0, 0), color: AXIS_COLORS.x, rot: { y: Math.PI / 2 } },
    ];
    for (const p of planes) {
      const quad = new T.Mesh(new T.PlaneGeometry(0.26, 0.26), this._mat(p.color, 0.34));
      quad.position.set(0.22, 0.22, 0);
      const holder = new T.Group();
      holder.add(quad);
      if (p.rot.x !== undefined) holder.rotation.x = p.rot.x;
      if (p.rot.y !== undefined) holder.rotation.y = p.rot.y;
      holder.userData.planeNormal = p.normal;
      this._tag(quad, "translate-plane", p.axis);
      quad.userData.planeNormal = p.normal;
      this.moveGroup.add(holder);
    }
  }

  _buildRotate() {
    const T = this.T;
    const rings = [
      { axis: "x", normal: new T.Vector3(1, 0, 0), rot: { y: Math.PI / 2 } },
      { axis: "y", normal: new T.Vector3(0, 1, 0), rot: { x: Math.PI / 2 } },
      { axis: "z", normal: new T.Vector3(0, 0, 1), rot: {} },
    ];
    for (const r of rings) {
      const ring = new T.Mesh(new T.TorusGeometry(0.9, 0.012, 6, 64), this._mat(AXIS_COLORS[r.axis]));
      const grab = new T.Mesh(new T.TorusGeometry(0.9, 0.06, 4, 32),
        new T.MeshBasicMaterial({ visible: false }));
      if (r.rot.x !== undefined) { ring.rotation.x = r.rot.x; grab.rotation.x = r.rot.x; }
      if (r.rot.y !== undefined) { ring.rotation.y = r.rot.y; grab.rotation.y = r.rot.y; }
      ring.userData.planeNormal = r.normal;
      grab.userData.planeNormal = r.normal;
      this._tag(ring, "rotate", r.axis);
      this._tag(grab, "rotate", r.axis);
      this.rotateGroup.add(ring, grab);
    }
    this.rotateGroup.visible = false;
  }

  setMode(mode) {
    this.mode = mode;
    this.moveGroup.visible = mode === TOOLS.MOVE;
    this.rotateGroup.visible = mode === TOOLS.ROTATE;
  }

  /** Place the gizmo, and keep it a constant size on screen regardless of distance. */
  update(center, camera) {
    if (!center) { this.root.visible = false; return; }
    this.root.visible = this.mode === TOOLS.MOVE || this.mode === TOOLS.ROTATE;
    this.root.position.set(center.x, center.y, center.z);
    const dist = camera.position.distanceTo(this.root.position);
    // Tie size to distance and field of view so it looks identical at any zoom. Sized
    // generously on purpose: the handles compete with bright, busy water for attention,
    // and a gizmo you have to hunt for is the difference between a tool and a demo.
    const s = Math.max(0.6, dist * 0.26 * Math.tan((camera.fov || 50) * Math.PI / 360));
    this._size = s;
    this.root.scale.setScalar(s);
  }

  /** Highlight whichever handle the pointer is over. */
  setHovered(mesh) {
    if (this.hovered === mesh) return;
    if (this.hovered?.material && this.hovered.userData._baseColor !== undefined) {
      this.hovered.material.color.setHex(this.hovered.userData._baseColor);
    }
    this.hovered = mesh || null;
    if (this.hovered?.material?.color) {
      if (this.hovered.userData._baseColor === undefined) {
        this.hovered.userData._baseColor = this.hovered.material.color.getHex();
      }
      this.hovered.material.color.setHex(HOVER_COLOR);
    }
  }

  /** Which gizmo handle, if any, does this raycaster hit? */
  pick(raycaster) {
    if (!this.root.visible) return null;
    const hits = raycaster.intersectObjects(this.handles, false);
    for (const h of hits) {
      if (h.object.userData.gizmo && h.object.visible !== false) {
        // Ignore handles belonging to the inactive tool.
        const kind = h.object.userData.gizmo.kind;
        const wantRotate = this.mode === TOOLS.ROTATE;
        if (wantRotate !== (kind === "rotate")) continue;
        return h.object;
      }
    }
    return null;
  }

  /**
   * Begin a drag on a handle.
   * @returns drag state, or null if the geometry is degenerate from this angle
   */
  beginDrag(handle, raycaster, center) {
    const T = this.T;
    const info = handle?.userData?.gizmo;
    if (!info) return null;
    const origin = new T.Vector3(center.x, center.y, center.z);
    const ray = raycaster.ray;

    let anchor = null;
    let planeNormal = null;
    let axisDir = null;

    if (info.kind === "translate") {
      axisDir = new T.Vector3(
        info.axis === "x" ? 1 : 0,
        info.axis === "y" ? 1 : 0,
        info.axis === "z" ? 1 : 0,
      );
      anchor = closestPointOnAxis(ray.origin, ray.direction, origin, axisDir, T);
    } else if (info.kind === "translate-plane") {
      planeNormal = handle.userData.planeNormal.clone();
      anchor = rayPlane(ray.origin, ray.direction, origin, planeNormal, T);
    } else if (info.kind === "rotate") {
      planeNormal = handle.userData.planeNormal.clone();
      anchor = rayPlane(ray.origin, ray.direction, origin, planeNormal, T);
    }
    if (!anchor) return null;

    this.drag = {
      kind: info.kind,
      axis: info.axis,
      origin,
      anchor,
      axisDir,
      planeNormal,
      startAngle: info.kind === "rotate"
        ? this._angleOn(anchor, origin, planeNormal) : 0,
      lastAngle: 0,
    };
    return this.drag;
  }

  _angleOn(point, origin, normal) {
    const T = this.T;
    const v = new T.Vector3().subVectors(point, origin);
    // Any two perpendicular vectors in the ring's plane give a stable angle basis.
    const ref = Math.abs(normal.y) > 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
    const u = new T.Vector3().crossVectors(ref, normal).normalize();
    const w = new T.Vector3().crossVectors(normal, u).normalize();
    return Math.atan2(v.dot(w), v.dot(u));
  }

  /**
   * Continue a drag.
   * @returns {{type:"translate", position}|{type:"rotate", axis, deltaDeg}|null}
   */
  updateDrag(raycaster, mods, { orthographic = false, osnap = null } = {}) {
    const d = this.drag;
    if (!d) return null;
    const T = this.T;
    const ray = raycaster.ray;

    if (d.kind === "translate" || d.kind === "translate-plane") {
      const now = d.kind === "translate"
        ? closestPointOnAxis(ray.origin, ray.direction, d.origin, d.axisDir, T)
        : rayPlane(ray.origin, ray.direction, d.origin, d.planeNormal, T);
      if (!now) return null;
      const delta = new T.Vector3().subVectors(now, d.anchor);
      const position = resolveDrag(
        { x: d.origin.x, y: d.origin.y, z: d.origin.z },
        { x: delta.x, y: delta.y, z: delta.z },
        { axis: d.axis, mods, orthographic, osnap },
      );
      return { type: "translate", position };
    }

    if (d.kind === "rotate") {
      const now = rayPlane(ray.origin, ray.direction, d.origin, d.planeNormal, T);
      if (!now) return null;
      let deg = (this._angleOn(now, d.origin, d.planeNormal) - d.startAngle) * 180 / Math.PI;
      // Unwrap so dragging past ±180° keeps turning the same way instead of flipping.
      while (deg - d.lastAngle > 180) deg -= 360;
      while (deg - d.lastAngle < -180) deg += 360;
      d.lastAngle = deg;
      return { type: "rotate", axis: d.axis, deltaDeg: snapAngleDeg(deg, mods) };
    }
    return null;
  }

  endDrag() { this.drag = null; }
  isDragging() { return !!this.drag; }

  dispose() {
    this.root.traverse(o => {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
      else o.material?.dispose?.();
    });
  }
}
