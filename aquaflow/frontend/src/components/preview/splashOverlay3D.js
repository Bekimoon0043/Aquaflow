/**
 * splashOverlay3D.js — AF-NEXT-008 landing-region overlay for the 3D preview.
 *
 * Draws one ground ring per active jet landing region (cyan when contained, red when it
 * leaves the basin) and a red marker ring at the source of every offending jet. Kept out
 * of FountainScene_v6.js; it only needs the scene's three.js Scene (`scene.scene`).
 * Coordinates are 3D world metres (x, z); callers convert from the plan frame.
 */
import * as THREE from "three";

const OK_COLOR = 0x38bdf8;
const BAD_COLOR = 0xef4444;
const Y = 0.04;

export class SplashOverlay {
  constructor(threeScene) {
    this.root = new THREE.Group();
    this.root.name = "af-splash-envelope";
    this.root.renderOrder = 10;
    this.pool = [];
    this.ringGeo = new THREE.RingGeometry(0.92, 1.0, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.discGeo = new THREE.CircleGeometry(1.0, 48);
    this.discGeo.rotateX(-Math.PI / 2);
    this.mats = {
      ok: new THREE.MeshBasicMaterial({ color: OK_COLOR, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
      bad: new THREE.MeshBasicMaterial({ color: BAD_COLOR, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
      badFill: new THREE.MeshBasicMaterial({ color: BAD_COLOR, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
      source: new THREE.MeshBasicMaterial({ color: BAD_COLOR, transparent: true, opacity: 1.0, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.visible = false;
    this.root.visible = false;
    threeScene?.add(this.root);
    this.threeScene = threeScene;
  }

  _mesh(i, geo, mat) {
    let m = this.pool[i];
    if (!m) {
      m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      this.pool.push(m);
      this.root.add(m);
    }
    m.geometry = geo; m.material = mat; m.visible = true;
    return m;
  }

  /**
   * @param {Array} regions [{ id, center:{x,z}, radiusM, origin:{x,z}, outside }] in world metres
   */
  update(regions = [], visible = true) {
    this.visible = !!visible;
    this.root.visible = this.visible;
    let k = 0;
    if (this.visible) {
      for (const r of regions) {
        const ring = this._mesh(k++, this.ringGeo, r.outside ? this.mats.bad : this.mats.ok);
        ring.position.set(r.center.x, Y, r.center.z);
        ring.scale.setScalar(Math.max(0.05, r.radiusM));
        if (r.outside) {
          const fill = this._mesh(k++, this.discGeo, this.mats.badFill);
          fill.position.set(r.center.x, Y - 0.005, r.center.z);
          fill.scale.setScalar(Math.max(0.05, r.radiusM));
          const src = this._mesh(k++, this.ringGeo, this.mats.source);
          src.position.set(r.origin.x, Y + 0.01, r.origin.z);
          src.scale.setScalar(0.45);
        }
      }
    }
    for (let i = k; i < this.pool.length; i++) this.pool[i].visible = false;
    return k;
  }

  dispose() {
    this.threeScene?.remove(this.root);
    this.ringGeo.dispose(); this.discGeo.dispose();
    Object.values(this.mats).forEach(m => m.dispose());
    this.pool = [];
  }
}

/** Plan-frame splash regions (splashEnvelope.splashAt) → world regions for the overlay. */
export function regionsToWorld(regions = [], center = { cx: 0, cy: 0 }) {
  const cx = Number(center?.cx) || 0, cy = Number(center?.cy) || 0;
  return regions.map(r => ({
    id: r.id, outside: !!r.outside, radiusM: r.radiusM,
    center: { x: r.center.x - cx, z: r.center.y - cy },
    origin: { x: r.origin.x - cx, z: r.origin.y - cy },
  }));
}
