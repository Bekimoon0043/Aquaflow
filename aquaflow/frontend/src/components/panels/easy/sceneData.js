// What the Easy renderer (EasyScene) draws, built from the Engineering project. Shared by the
// Easy Fountain Design panel and the Studio renderer of the 3D preview.

import { poolBounds, engineeringToWorld } from "../../../engineering/geometryContract";
import { roleOf, modelKindOf, effectOf, lightColorOf, motionOf, isMovingNozzle } from "../../../fx/easyDesigner";
import { nozzleKind } from "../../programmer/studio/fountainDesign";

/** Basin outline in world space (centred on the origin). */
export function poolShape(geometry, params, poolType, center) {
  if (geometry?.type === "circle") return { shape: "circle", radius: Number(geometry.radius) || Number(params?.radius) || 6 };
  if (geometry?.type === "ellipse") return { shape: "ellipse", rx: Number(geometry.rx) || 6, ry: Number(geometry.ry) || 4 };
  if (Array.isArray(geometry?.points) && geometry.points.length >= 3) {
    return { shape: "poly", points: geometry.points.map((p) => ({ x: Number(p.x) - center.cx, z: Number(p.y) - center.cy })) };
  }
  const b = poolBounds(geometry, params, poolType);
  if (b.radius) return { shape: "circle", radius: b.radius };
  const w = (b.maxX - b.minX) / 2, l = (b.maxY - b.minY) / 2;
  return { shape: "poly", points: [{ x: -w, z: -l }, { x: w, z: -l }, { x: w, z: l }, { x: -w, z: l }] };
}

/** World-space basin outline [[x, z], ...] for the laser safety rule. */
export function basinPolygon(pool) {
  if (!pool) return null;
  if (pool.shape === "poly") return pool.points.map((p) => [p.x, p.z]);
  const rx = pool.shape === "circle" ? pool.radius : pool.rx, rz = pool.shape === "circle" ? pool.radius : pool.ry;
  return Array.from({ length: 48 }, (_, i) => [rx * Math.cos((i / 48) * 2 * Math.PI), rz * Math.sin((i / 48) * 2 * Math.PI)]);
}

/** Items (models, base discs, labels) of the visible fixtures. */
export function sceneItems(fixtures, center, live = {}) {
  return fixtures.filter((f) => f.visible !== false).map((f) => {
    const w = engineeringToWorld(f, center);
    const role = roleOf(f);
    const e = f.engineering || {};
    const laser = effectOf(f) === "laser";
    return { id: f.id, label: f.label || f.type, role, modelKind: modelKindOf(f), x: w.x, z: w.z,
      elevation: laser ? Math.max(Number(f.z) || 0, Number(e.mountHeightM ?? 0.5)) : Number(f.z) || 0,
      rotation: Number(f.rotation) || 0, on: live[f.id]?.on !== false,
      color: role === "light" ? lightColorOf(f) : null, intensity: Number(e.intensityPct ?? 100), beamDeg: Number(e.beamAngleDeg) || 40 };
  });
}

/**
 * The jets of a show for EasyScene's show mode: nominal (100 %) height, nozzle kind, whether it
 * swings (its swing comes from the show), and the light that colours it (paired, else the
 * nearest light within 1.5 m).
 */
export function showJets(fixtures) {
  const lights = fixtures.filter((f) => roleOf(f) === "light");
  const pairedTo = new Map();
  for (const l of lights) {
    const n = l.engineering?.pairedNozzleId || l.pairedNozzleId;
    if (n) pairedTo.set(n, l.id);
  }
  const nearestLight = (f) => {
    let best = null, d = 1.5;
    for (const l of lights) {
      const dd = Math.hypot((Number(l.x) || 0) - (Number(f.x) || 0), (Number(l.y) || 0) - (Number(f.y) || 0));
      if (dd < d) { d = dd; best = l.id; }
    }
    return best;
  };
  // A solenoid nozzle (Vario) is classed as a valve but throws its own jet.
  const throwsWater = (f) => roleOf(f) === "nozzle" || (roleOf(f) === "valve" && Number(f.engineering?.jetHeightM) > 0);
  return fixtures.filter((f) => f.visible !== false && throwsWater(f)).map((f) => {
    const e = f.engineering || {};
    const moving = isMovingNozzle({ type: f.type, key: f.type });
    const H = Number(e.jetHeightM) > 0 ? Number(e.jetHeightM) : moving ? 6 : 2;
    const motion = motionOf(f);
    return { id: f.id, kind: nozzleKind(f).id, nominalHeightM: H, swing: !!motion || moving,
      axes: motion?.axes || 0, splayDeg: motion?.splayDeg || 0, aimTiltDeg: Number(e.aimTiltDeg) || Number(e.aimDeg) || 0,
      vario: /vario_jet/i.test(String(f.type || "")), varioSpanDeg: Number(e.varioSpanDeg) > 0 ? Number(e.varioSpanDeg) : 40,
      bell: /mushroom|bell|umbrella/i.test(String(e.nozzleStyle || "")),
      outlets: Math.max(1, Math.round(Number(e.outletCount) || 1)), lightId: pairedTo.get(f.id) || nearestLight(f) };
  });
}
