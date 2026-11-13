// Laser projectors in the 3D preview: thin additive cores (always at least a pixel), soft haze
// glow around them, translucent sheets for sheet looks and hit spots where beams meet the water.
// Geometry and the audience safety rule come from laserRig.js; this file only draws.
import { hazeVisibility, laserFrame, laserState } from "./laserRig";

const MAX_BEAMS = 600;
const MAX_SHEET_TRIS = 1200;
const GLOW_RADIUS = 0.035;
const SPOT_SIZE = 0.35;
const MAX_ART_SEGS = 400;

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

    // Projected artwork (graphics / mapping lasers): bright lines on the water screen or façade.
    this._artPos = new Float32Array(MAX_ART_SEGS * 6);
    this._artCol = new Float32Array(MAX_ART_SEGS * 6);
    const artGeo = new T.BufferGeometry();
    artGeo.setAttribute("position", new T.BufferAttribute(this._artPos, 3).setUsage(T.DynamicDrawUsage));
    artGeo.setAttribute("color", new T.BufferAttribute(this._artCol, 3).setUsage(T.DynamicDrawUsage));
    this.art = new T.LineSegments(artGeo, new T.LineBasicMaterial({ vertexColors: true, ...additive }));
    this.art.frustumCulled = false;

    // Firefly / star-field dots: each weak beam is seen only where it lands (on water, ground,
    // trees or, out of range, as a star in the sky) — screen-size points, twinkling per beam.
    this._dotPos = new Float32Array(MAX_BEAMS * 3);
    this._dotCol = new Float32Array(MAX_BEAMS * 3);
    const dotGeo = new T.BufferGeometry();
    dotGeo.setAttribute("position", new T.BufferAttribute(this._dotPos, 3).setUsage(T.DynamicDrawUsage));
    dotGeo.setAttribute("color", new T.BufferAttribute(this._dotCol, 3).setUsage(T.DynamicDrawUsage));
    this.dots = new T.Points(dotGeo, new T.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, ...additive }));
    this.dots.frustumCulled = false;

    this.group.add(this.glows, this.sheets, this.cores, this.spots, this.art, this.dots);
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
    let n = 0, spots = 0, tris = 0, blanked = 0, clamped = 0, art = 0, dots = 0;
    for (const fx of this.fixtures) {
      const state = laserState(records[fx.id], fx);
      if (state.intensity <= 0.01) continue;
      const frame = laserFrame(fx, state, time, this.safety);
      blanked += frame.blanked; clamped += frame.clamped;
      const k = state.intensity, { r, g, b } = frame.color;
      const o = frame.origin;
      for (const seg of frame.outline || []) {
        if (art >= MAX_ART_SEGS) break;
        this._artPos.set([seg.a.x, seg.a.y, seg.a.z, seg.b.x, seg.b.y, seg.b.z], 6 * art);
        this._artCol.set([r * k, g * k, b * k, r * k, g * k, b * k], 6 * art);
        art++;
      }
      // Firefly dots and scanned graphics are weak per beam; a searchlight is one heavy beam.
      const coreScale = frame.faint ? 0.08 : 1, glowScale = frame.heavy ? 3 : frame.faint ? 0.25 : 1;
      frame.beams.forEach((beam, i) => {
        if (n >= MAX_BEAMS) return;
        const c = 6 * n, kb = k * (beam.glint ?? 1);
        this._corePos.set([o.x, o.y, o.z, beam.end.x, beam.end.y, beam.end.z], c);
        const core = kb * coreScale * (0.35 + 0.65 * vis);
        this._coreCol.set([r * core, g * core, b * core, r * core * 0.6, g * core * 0.6, b * core * 0.6], c);
        this._v.set(beam.dir.x, beam.dir.y, beam.dir.z);
        this._q.setFromUnitVectors(this._up, this._v);
        this._m.compose(this._p.set(o.x, o.y, o.z), this._q, this._s.set(GLOW_RADIUS * glowScale, beam.length, GLOW_RADIUS * glowScale));
        this.glows.setMatrixAt(n, this._m);
        const glow = kb * vis * 0.12 * (frame.heavy ? 1.6 : frame.faint ? 0.5 : 1);
        this.glows.instanceColor.setXYZ(n, r * glow, g * glow, b * glow);
        if (beam.glint !== undefined && dots < MAX_BEAMS) {
          this._dotPos.set([beam.end.x, beam.end.y, beam.end.z], 3 * dots);
          this._dotCol.set([r * kb, g * kb, b * kb], 3 * dots);
          dots++;
        } else if (beam.hit && spots < MAX_BEAMS) {
          const spot = frame.faint ? SPOT_SIZE * 0.35 : SPOT_SIZE;
          this._m.compose(this._p.set(beam.end.x, 0.03, beam.end.z), this._q.identity(), this._s.set(spot, 1, spot));
          this.spots.setMatrixAt(spots, this._m);
          this.spots.instanceColor.setXYZ(spots, r * kb, g * kb, b * kb);
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
    this.dots.geometry.setDrawRange(0, dots);
    this.dots.geometry.attributes.position.needsUpdate = true;
    this.dots.geometry.attributes.color.needsUpdate = true;
    this.art.geometry.setDrawRange(0, art * 2);
    this.art.geometry.attributes.position.needsUpdate = true;
    this.art.geometry.attributes.color.needsUpdate = true;
    this.group.visible = n > 0 || art > 0;
    this.stats = { beams: n, blanked, clamped, artSegments: art, dots };
    return this.stats;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const o of [this.cores, this.glows, this.spots, this.sheets, this.art, this.dots]) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
  }
}
