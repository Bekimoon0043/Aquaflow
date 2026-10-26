/**
 * steelFrames3D.js — brushed-stainless frames and support pipes, instanced.
 *
 * Elevated nozzles hang on steel: sculpture frames (steel_frame fixtures, parsed by
 * elevatedNozzles.parseFrameTubes) and the automatic vertical pipe under any elevated
 * nozzle no frame carries (autoSupportSegments). Every straight segment is one instance
 * of a unit cylinder, every joint one instance of a unit sphere: two draw calls for the
 * whole frame, however many tubes. No water, no per-frame work — rebuilt only when the
 * design changes.
 */

const UP = [0, 1, 0];

export class SteelFrameMesh {
  constructor(THREE) {
    this.T = THREE;
    this.group = new THREE.Group();
    this.group.name = "steel-frames";
    this.material = new THREE.MeshStandardMaterial({
      color: 0xc8cdd2, metalness: 0.92, roughness: 0.3, envMapIntensity: 1.0,
    });
    this._tube = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
    this._tube.translate(0, 0.5, 0);
    this._joint = new THREE.SphereGeometry(1, 12, 8);
    this.tubes = null;
    this.joints = null;
    this._key = "";
  }

  /** @param segs Array<{a:[x,h,z], b:[x,h,z], radius}> world space */
  setSegments(segs = []) {
    const key = segs.map((s) => `${s.a.join(",")};${s.b.join(",")};${s.radius}`).join("|");
    if (key === this._key) return;
    this._key = key;
    this._clear();
    if (!segs.length) return;
    const T = this.T;
    const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
    const up = new T.Vector3(...UP), dir = new T.Vector3();

    this.tubes = new T.InstancedMesh(this._tube, this.material, segs.length);
    const joints = new Map();
    segs.forEach((g, i) => {
      dir.set(g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]);
      const len = dir.length();
      dir.multiplyScalar(1 / (len || 1));
      q.setFromUnitVectors(up, dir);
      p.set(g.a[0], g.a[1], g.a[2]);
      s.set(g.radius, len, g.radius);
      m.compose(p, q, s);
      this.tubes.setMatrixAt(i, m);
      for (const e of [g.a, g.b]) {
        const k = `${e[0].toFixed(3)},${e[1].toFixed(3)},${e[2].toFixed(3)}`;
        joints.set(k, { e, r: Math.max(joints.get(k)?.r || 0, g.radius) });
      }
    });
    this.tubes.instanceMatrix.needsUpdate = true;
    this.tubes.castShadow = true;
    this.tubes.receiveShadow = true;
    this.tubes.frustumCulled = false;
    this.tubes.name = "steel-frame-tubes";
    this.group.add(this.tubes);

    const list = [...joints.values()];
    this.joints = new T.InstancedMesh(this._joint, this.material, list.length);
    q.identity();
    list.forEach(({ e, r }, i) => {
      p.set(e[0], e[1], e[2]);
      s.set(r * 1.05, r * 1.05, r * 1.05);
      m.compose(p, q, s);
      this.joints.setMatrixAt(i, m);
    });
    this.joints.instanceMatrix.needsUpdate = true;
    this.joints.castShadow = true;
    this.joints.frustumCulled = false;
    this.joints.name = "steel-frame-joints";
    this.group.add(this.joints);
  }

  _clear() {
    for (const mesh of [this.tubes, this.joints]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.dispose?.();
    }
    this.tubes = null;
    this.joints = null;
  }

  dispose() {
    this._clear();
    this._tube.dispose();
    this._joint.dispose();
    this.material.dispose();
    this.group.parent?.remove(this.group);
  }
}
