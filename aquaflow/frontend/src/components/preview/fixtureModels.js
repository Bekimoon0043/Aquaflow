/**
 * fixtureModels.js — AF-3D-014 (realism plan, Phase R4)
 *
 * Real hardware bodies for the nozzles and submersible lights.
 *
 * Until now every nozzle in the preview was the same object: an eight-segment
 * cylinder 12 cm tall, and every light was a flat disc. That is fine as a position
 * marker and useless as a picture — a designer showing a client a close pass over
 * the basin sees plumbing that looks nothing like the plumbing being quoted, and a
 * laminar jet is indistinguishable from a geyser head.
 *
 * The bodies here are built from primitives rather than loaded from glTF. That keeps
 * the module consistent with the rest of the realism work (no binary assets to ship,
 * nothing to fetch, deterministic in tests) and the shapes are genuinely simple:
 * fountain nozzles ARE turned parts — flanges, bores, tapers and rings.
 *
 * All fixtures of one kind are drawn with a single InstancedMesh. A default layout
 * has 33 nozzles; as individual meshes that is 33 draw calls before a drop of water
 * is rendered, and a large civic design would be hundreds.
 */

/** Merge a list of {geometry, position, rotation, scale} parts into one geometry. */
function mergeParts(THREE, parts) {
  const T = THREE;
  const positions = [];
  const normals = [];
  const groups = [];
  const m = new T.Matrix4();
  const nm = new T.Matrix3();
  const v = new T.Vector3();
  let vertexCount = 0;

  for (const part of parts) {
    const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    m.compose(
      part.position || new T.Vector3(),
      part.quaternion || new T.Quaternion(),
      part.scale || new T.Vector3(1, 1, 1),
    );
    nm.getNormalMatrix(m);
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      positions.push(v.x, v.y, v.z);
      if (nor) {
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        normals.push(v.x, v.y, v.z);
      } else {
        normals.push(0, 1, 0);
      }
    }
    groups.push({ start: vertexCount, count: pos.count, material: part.material || 0 });
    vertexCount += pos.count;
    if (g !== part.geometry) g.dispose();
    part.geometry.dispose();
  }

  const out = new T.BufferGeometry();
  out.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  out.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  for (const grp of groups) out.addGroup(grp.start, grp.count, grp.material);
  return out;
}

/** Rotate a part so a cylinder's axis points along +X instead of +Y. */
function tipped(THREE, angleZ) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, angleZ));
}

/**
 * Body geometry for one fixture kind. Material slot 0 is the metal housing, slot 1
 * is the emissive bore or lens.
 *
 * Dimensions are in metres and chosen to match real fountain hardware: a DN25 jet
 * head is a fist-sized fitting, not a bollard.
 */
export function buildFixtureGeometry(THREE, kind) {
  const T = THREE;
  const parts = [];
  const add = (geometry, y = 0, material = 0, extra = {}) =>
    parts.push({ geometry, position: new T.Vector3(extra.x || 0, y, extra.z || 0), material, ...extra });

  // Every wet fixture sits on a threaded base flange bolted to the basin floor.
  const flange = () => add(new T.CylinderGeometry(0.085, 0.10, 0.035, 16), 0.017);

  switch (kind) {
    case "laminar": {
      // A laminar head is long: the flow straighteners inside are what make the
      // stream glassy, and the body has to be long enough to hold them.
      flange();
      add(new T.CylinderGeometry(0.055, 0.062, 0.26, 18), 0.165);
      add(new T.TorusGeometry(0.057, 0.007, 6, 20), 0.29);
      add(new T.CylinderGeometry(0.022, 0.022, 0.012, 14), 0.30, 1);   // the bore
      break;
    }
    case "geyser": {
      // Large-bore head with a broad throat and a heavy collar.
      flange();
      add(new T.CylinderGeometry(0.085, 0.11, 0.10, 20), 0.085);
      add(new T.CylinderGeometry(0.062, 0.085, 0.075, 20), 0.172);
      add(new T.TorusGeometry(0.064, 0.010, 6, 22), 0.208);
      add(new T.CylinderGeometry(0.045, 0.045, 0.012, 16), 0.216, 1);
      break;
    }
    case "ring": {
      // A ring header: a manifold torus with small risers around it.
      flange();
      add(new T.CylinderGeometry(0.05, 0.055, 0.06, 14), 0.06);
      const ring = new T.TorusGeometry(0.17, 0.018, 8, 28);
      parts.push({
        geometry: ring, position: new T.Vector3(0, 0.10, 0),
        quaternion: new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)),
        material: 0,
      });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        add(new T.CylinderGeometry(0.012, 0.014, 0.05, 8), 0.13,
            0, { x: Math.cos(a) * 0.17, z: Math.sin(a) * 0.17 });
      }
      break;
    }
    case "fan_jet":
    case "screen": {
      // A fan bar: a wide slot head on a short riser.
      flange();
      add(new T.CylinderGeometry(0.05, 0.058, 0.09, 16), 0.075);
      add(new T.BoxGeometry(0.26, 0.05, 0.05), 0.145);
      add(new T.BoxGeometry(0.22, 0.012, 0.014), 0.168, 1);            // the slot
      break;
    }
    case "mist": {
      // Atomiser: a slim stem with a small fogging tip.
      flange();
      add(new T.CylinderGeometry(0.018, 0.022, 0.16, 12), 0.115);
      add(new T.SphereGeometry(0.028, 12, 10), 0.205);
      add(new T.SphereGeometry(0.012, 8, 6), 0.222, 1);
      break;
    }
    case "flame": {
      // Burner: a heavier can with an ignition ring.
      flange();
      add(new T.CylinderGeometry(0.075, 0.09, 0.14, 18), 0.105);
      add(new T.TorusGeometry(0.072, 0.010, 6, 20), 0.178);
      add(new T.CylinderGeometry(0.05, 0.05, 0.014, 16), 0.185, 1);
      break;
    }
    case "laser": {
      // Projector head on a yoke.
      add(new T.BoxGeometry(0.14, 0.03, 0.14), 0.015);
      add(new T.BoxGeometry(0.10, 0.11, 0.10), 0.085);
      parts.push({
        geometry: new T.CylinderGeometry(0.026, 0.026, 0.09, 14),
        position: new T.Vector3(0, 0.115, 0.05),
        quaternion: tipped(T, Math.PI / 2), material: 0,
      });
      add(new T.CircleGeometry(0.022, 14), 0.115, 1, { z: 0.098 });
      break;
    }
    case "light": {
      // Submersible RGB luminaire: a stainless can with a thick glass lens and a
      // clamping bezel — the fixture a designer actually schedules.
      add(new T.CylinderGeometry(0.11, 0.12, 0.05, 22), 0.025);
      add(new T.CylinderGeometry(0.095, 0.10, 0.07, 22), 0.075);
      add(new T.TorusGeometry(0.093, 0.012, 6, 24), 0.108);
      add(new T.CylinderGeometry(0.082, 0.082, 0.014, 22), 0.112, 1);   // lens
      break;
    }
    case "motion": {
      // Moving-head nozzle: a yoke carrying a barrel, so it reads as articulated.
      flange();
      add(new T.CylinderGeometry(0.06, 0.07, 0.05, 16), 0.06);
      add(new T.BoxGeometry(0.022, 0.11, 0.022), 0.135, 0, { x: -0.055 });
      add(new T.BoxGeometry(0.022, 0.11, 0.022), 0.135, 0, { x: 0.055 });
      add(new T.CylinderGeometry(0.038, 0.042, 0.13, 16), 0.175);
      add(new T.CylinderGeometry(0.020, 0.020, 0.012, 14), 0.244, 1);
      break;
    }
    default: {
      // Standard jet head — the DN25 fitting the core column's bore is modelled on.
      flange();
      add(new T.CylinderGeometry(0.045, 0.055, 0.085, 16), 0.077);
      add(new T.CylinderGeometry(0.032, 0.045, 0.045, 16), 0.142);
      add(new T.TorusGeometry(0.034, 0.008, 6, 18), 0.163);
      add(new T.CylinderGeometry(0.016, 0.016, 0.012, 14), 0.170, 1);
      break;
    }
  }
  return mergeParts(T, parts);
}

/** Which body a nozzle type wears. Keeps the switch above small and honest. */
export function fixtureKindFor(type) {
  switch (type) {
    case "laminar": return "laminar";
    case "geyser":  return "geyser";
    case "ring":    return "ring";
    case "mist":    return "mist";
    case "flame":   return "flame";
    case "laser":   return "laser";
    case "fan_jet":
    case "screen":  return "fan_jet";
    case "motion_1d":
    case "motion_2d":
    case "motion_3d":
    case "pirouette": return "motion";
    default: return "jet";
  }
}

/**
 * One InstancedMesh per fixture kind.
 *
 * A default layout is 33 nozzles; drawn individually that is 33 draw calls before
 * any water exists, and a civic design would be hundreds. Instancing collapses each
 * kind to one call regardless of count.
 */
export class FixtureInstances {
  constructor(THREE, { emissive = 0x2288cc } = {}) {
    this.T = THREE;
    this.group = new THREE.Group();
    this.group.name = "fixtures";
    this._byKind = new Map();
    this._geoCache = new Map();

    // Wet-service stainless: fairly rough, genuinely metallic. High metalness with a
    // low roughness would mirror the sky and read as chrome jewellery.
    this.metal = new THREE.MeshStandardMaterial({
      color: 0x9aa4ad, roughness: 0.38, metalness: 0.92,
    });
    // The bore/lens. Emissive so it still reads at night, when a fixture is otherwise
    // a silhouette against dark water.
    this.lens = new THREE.MeshStandardMaterial({
      color: 0x101820, roughness: 0.15, metalness: 0.1,
      emissive: new THREE.Color(emissive), emissiveIntensity: 0.55,
    });
  }

  _geometryFor(kind) {
    if (!this._geoCache.has(kind)) {
      this._geoCache.set(kind, buildFixtureGeometry(this.T, kind));
    }
    return this._geoCache.get(kind);
  }

  /**
   * Rebuild the instance set.
   * @param {Array} items [{id, kind, x, y, z, rotationX, rotationY, rotationZ, scale}]
   */
  setFixtures(items) {
    const T = this.T;
    // Drop the previous meshes; geometry is cached and deliberately survives.
    for (const mesh of this._byKind.values()) {
      this.group.remove(mesh);
      mesh.dispose?.();
    }
    this._byKind.clear();

    const byKind = new Map();
    for (const it of items || []) {
      const kind = it.kind || "jet";
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push(it);
    }

    const m = new T.Matrix4();
    const q = new T.Quaternion();
    const pos = new T.Vector3();
    const scl = new T.Vector3();
    for (const [kind, list] of byKind) {
      const mesh = new T.InstancedMesh(this._geometryFor(kind), [this.metal, this.lens], list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        pos.set(it.x || 0, it.y || 0, it.z || 0);
        q.setFromEuler(new T.Euler(
          (it.rotationX || 0) * Math.PI / 180,
          (it.rotationY || 0) * Math.PI / 180,
          (it.rotationZ || 0) * Math.PI / 180,
        ));
        const s = it.scale || 1;
        scl.set(s, s, s);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      // SceneEditor resolves a raycast's instanceId through this table. This keeps
      // batching efficient while making the actual stainless fixture body clickable.
      mesh.userData.nodeIds = list.map(item => item.id || null);
      this.group.add(mesh);
      this._byKind.set(kind, mesh);
    }
  }

  /** Tint the emissive bores/lenses to the current fixture colour. */
  setEmissive(color, intensity = 0.55) {
    if (color) this.lens.emissive.copy(color);
    this.lens.emissiveIntensity = intensity;
  }

  dispose() {
    for (const mesh of this._byKind.values()) mesh.dispose?.();
    this._byKind.clear();
    for (const g of this._geoCache.values()) g.dispose();
    this._geoCache.clear();
    this.metal.dispose();
    this.lens.dispose();
    this.group.parent?.remove(this.group);
  }
}
