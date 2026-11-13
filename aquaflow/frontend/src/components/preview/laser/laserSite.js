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

/** Laser fixtures as renderer configs: world position, mount height, facing, engineering. */
export function laserConfigs(fixtures = [], center = null) {
  return (fixtures || []).filter((f) => isLaserFixture(f?.type) && f.visible !== false).map((f) => {
    const [x, z] = shift(f, center);
    const e = f.engineering || {};
    return { id: f.id, type: f.type, label: f.label, x, z, y: Number.isFinite(Number(e.mountHeightM)) ? Number(e.mountHeightM) : 0.5,
      rotation: Number(f.rotation) || 0, color: f.color, engineering: e };
  });
}
