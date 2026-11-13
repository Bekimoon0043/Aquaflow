// Engineering design → what the laser renderer and the safety rule need, in one frame.
// `center` = poolCenter { cx, cy }: world x = plan x − cx, world z = plan y − cy (geometryContract).
import { basinOuterPoints, tessellateGeometry } from "../../../engineering/basins";
import { isLaserFixture } from "./laserRig";

const shift = (p, c) => [Number(p.x) - (c?.cx || 0), Number(p.y ?? p.z) - (c?.cy || 0)];

/** Audience zones (land surfaces of type "audience") and the primary basin outline as [[x, z], ...]. */
export function laserSafetyArea({ siteSurfaces = [], basins = [], geometry = null } = {}, center = null) {
  const zones = (siteSurfaces || []).filter((s) => s?.type === "audience" && s.visible !== false && (s.points || []).length >= 3)
    .map((s) => s.points.map((p) => shift(p, center)));
  const outline = basins?.length ? basinOuterPoints(basins[0]) : tessellateGeometry(geometry);
  return { zones, basin: outline.length >= 3 ? outline.map((p) => shift(p, center)) : null };
}

const isScreenNozzle = (type) => /screen/i.test(String(type || "")) && !isLaserFixture(type);

/**
 * The water screen a graphics laser draws on: the nearest screen nozzle within 60 m. The sheet
 * stands across the line from the projector, its picture area about 1.6 × 0.8 of the jet height.
 */
export function screenFor(laser, screens) {
  let best = null;
  for (const s of screens) {
    const d = Math.hypot(s.x - laser.x, s.z - laser.z);
    if (d > 1e-6 && d <= 60 && (!best || d < best.d)) best = { d, s };
  }
  if (!best) return null;
  const { s, d } = best, h = Number(s.engineering?.jetHeightM) || 10;
  return { center: { x: s.x, y: h * 0.5, z: s.z }, right: { x: -(s.z - laser.z) / d, y: 0, z: (s.x - laser.x) / d },
    width: Math.min(30, h * 1.6), height: h * 0.8, screenId: s.id };
}

/**
 * Laser fixtures as renderer configs: world position, mount height, facing, engineering.
 * `others` (all visible fixtures) lets graphics lasers find the water screen they draw on.
 */
export function laserConfigs(fixtures = [], center = null, others = []) {
  const screens = (others || []).filter((f) => isScreenNozzle(f?.type) && f.visible !== false)
    .map((f) => { const [x, z] = shift(f, center); return { id: f.id, x, z, engineering: f.engineering || {} }; });
  return (fixtures || []).filter((f) => isLaserFixture(f?.type) && f.visible !== false).map((f) => {
    const [x, z] = shift(f, center);
    const e = f.engineering || {};
    const cfg = { id: f.id, type: f.type, label: f.label, x, z, y: Number.isFinite(Number(e.mountHeightM)) ? Number(e.mountHeightM) : 0.5,
      rotation: Number(f.rotation) || 0, color: f.color, engineering: e };
    if (e.laserKind === "graphics" && e.projection?.target !== "plane") {
      const screen = screenFor(cfg, screens);
      if (screen) cfg.screen = screen;
    }
    return cfg;
  });
}
