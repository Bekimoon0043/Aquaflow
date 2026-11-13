// Laser projectors in the 3D preview: thin additive cores (always at least a pixel), soft haze
// glow around them, translucent sheets for sheet looks and hit spots where beams meet the water.
// Geometry and the audience safety rule come from laserRig.js; this file only draws.
import { hazeVisibility, laserFrame, laserState } from "./laserRig";

const MAX_BEAMS = 600;
const MAX_SHEET_TRIS = 1200;
const GLOW_RADIUS = 0.035;
const SPOT_SIZE = 0.35;

export class LaserScene {
  constructor(T, parent) {
    this.T = T;
    this.group = new T.Group();
    this.group.name = "laser-projectors";
    this.group.renderOrder = 900;
    const additive = { transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false };

    this._corePos = new Float32Array(MAX_BEAMS * 6);
    this._coreCol = new Float32Array(MAX_BEAMS * 6);
    const coreGeo = new T.BufferGeometry();
    coreGeo.setAttribute("position", new T.BufferAttribute(this._corePos, 3).setUsage(T.DynamicDrawUsage));
    coreGeo.setAttribute("color", new T.BufferAttribute(this._coreCol, 3).setUsage(T.DynamicDrawUsage));
    this.cores = new T.LineSegments(coreGeo, new T.LineBasicMaterial({ vertexColors: true, ...additive }));
    this.cores.frustumCulled = false;

    // Unit cylinder from y=0 to y=1, oriented per beam.
    const glowGeo = new T.CylinderGeometry(1, 1, 1, 8, 1, true);
    glowGeo.translate(0, 0.5, 0);
    this.glows = new T.InstancedMesh(glowGeo, new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide, ...additive, opacity: 1 }), MAX_BEAMS);
    this.glows.instanceColor = new T.InstancedBufferAttribute(new Float32Array(MAX_BEAMS * 3), 3);
    this.glows.frustumCulled = false;

    const spotGeo = new T.CircleGeometry(0.5, 16);
    spotGeo.rotateX(-Math.PI / 2);
    this.spots = new T.InstancedMesh(spotGeo, new T.MeshBasicMaterial({ color: 0xffffff, ...additive }), MAX_BEAMS);
    this.spots.instanceColor = new T.InstancedBufferAttribute(new Float32Array(MAX_BEAMS * 3), 3);
    this.spots.frustumCulled = false;

    this._sheetPos = new Float32Array(MAX_SHEET_TRIS * 9);
    this._sheetCol = new Float32Array(MAX_SHEET_TRIS * 9);
    const sheetGeo = new T.BufferGeometry();
    sheetGeo.setAttribute("position", new T.BufferAttribute(this._sheetPos, 3).setUsage(T.DynamicDrawUsage));
    sheetGeo.setAttribute("color", new T.BufferAttribute(this._sheetCol, 3).setUsage(T.DynamicDrawUsage));
    this.sheets = new T.Mesh(sheetGeo, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, ...additive }));
    this.sheets.frustumCulled = false;

    this.group.add(this.glows, this.sheets, this.cores, this.spots);
    parent.add(this.group);
    this.fixtures = [];
    this.safety = {};
    this.stats = { beams: 0, blanked: 0, clamped: 0 };
    this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._up = new T.Vector3(0, 1, 0);
    this._v = new T.Vector3(); this._s = new T.Vector3(); this._p = new T.Vector3();
    this.update({}, 0, {});
  }

  setFixtures(fixtures = [], safety = {}) {
    this.fixtures = fixtures || [];
    this.safety = safety || {};
  }

  /** records: show-frame fixture records by id; time: show seconds (bake-safe). */
  update(records = {}, time = 0, { haze = 0.35, realWorld = true } = {}) {
    const vis = hazeVisibility(haze, realWorld);
    let n = 0, spots = 0, tris = 0, blanked = 0, clamped = 0;
    for (const fx of this.fixtures) {
      const state = laserState(records[fx.id], fx);
      if (state.intensity <= 0.01) continue;
      const frame = laserFrame(fx, state, time, this.safety);
      blanked += frame.blanked; clamped += frame.clamped;
      const k = state.intensity, { r, g, b } = frame.color;
      const o = frame.origin;
      frame.beams.forEach((beam, i) => {
        if (n >= MAX_BEAMS) return;
        const c = 6 * n;
        this._corePos.set([o.x, o.y, o.z, beam.end.x, beam.end.y, beam.end.z], c);
        const core = k * (0.35 + 0.65 * vis);
        this._coreCol.set([r * core, g * core, b * core, r * core * 0.6, g * core * 0.6, b * core * 0.6], c);
        this._v.set(beam.dir.x, beam.dir.y, beam.dir.z);
        this._q.setFromUnitVectors(this._up, this._v);
        this._m.compose(this._p.set(o.x, o.y, o.z), this._q, this._s.set(GLOW_RADIUS, beam.length, GLOW_RADIUS));
        this.glows.setMatrixAt(n, this._m);
        const glow = k * vis * 0.12;
        this.glows.instanceColor.setXYZ(n, r * glow, g * glow, b * glow);
        if (beam.hit && spots < MAX_BEAMS) {
          this._m.compose(this._p.set(beam.end.x, 0.03, beam.end.z), this._q.identity(), this._s.set(SPOT_SIZE, 1, SPOT_SIZE));
          this.spots.setMatrixAt(spots, this._m);
          this.spots.instanceColor.setXYZ(spots, r * k, g * k, b * k);
          spots++;
        }
        if (frame.sheet && i > 0 && tris < MAX_SHEET_TRIS) {
          const prev = frame.beams[i - 1].end, s = 9 * tris, sheet = k * vis * 0.18;
          this._sheetPos.set([o.x, o.y, o.z, prev.x, prev.y, prev.z, beam.end.x, beam.end.y, beam.end.z], s);
          this._sheetCol.set([r * sheet, g * sheet, b * sheet, r * sheet * 0.4, g * sheet * 0.4, b * sheet * 0.4, r * sheet * 0.4, g * sheet * 0.4, b * sheet * 0.4], s);
          tris++;
        }
        n++;
      });
    }
    this.cores.geometry.setDrawRange(0, n * 2);
    this.cores.geometry.attributes.position.needsUpdate = true;
    this.cores.geometry.attributes.color.needsUpdate = true;
    this.glows.count = n; this.glows.instanceMatrix.needsUpdate = true; this.glows.instanceColor.needsUpdate = true;
    this.spots.count = spots; this.spots.instanceMatrix.needsUpdate = true; this.spots.instanceColor.needsUpdate = true;
    this.sheets.geometry.setDrawRange(0, tris * 3);
    this.sheets.geometry.attributes.position.needsUpdate = true;
    this.sheets.geometry.attributes.color.needsUpdate = true;
    this.group.visible = n > 0;
    this.stats = { beams: n, blanked, clamped };
    return this.stats;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const o of [this.cores, this.glows, this.spots, this.sheets]) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
  }
}
