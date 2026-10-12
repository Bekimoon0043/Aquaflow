/** Standalone demonstration layout. Coordinates and equipment are illustrative. */
export const AURORA_DEMO_ID = "aquaflow-aurora-demo-v1";
export const AURORA_DEMO_NAME = "Aurora Theatre — 3D Show Demo";

const rounded = value => Number(value.toFixed(3));

function ring(count, radius, type, zone, label, offset = 0) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + offset;
    return {
      id: `aurora-${zone}-${String(index + 1).padStart(2, "0")}`,
      type,
      label: `${label} ${String(index + 1).padStart(2, "0")}`,
      x: rounded(10 + Math.cos(angle) * radius),
      y: rounded(10 + Math.sin(angle) * radius),
      z: 0,
      rotation: rounded(angle * 180 / Math.PI),
      zone,
      groupId: zone,
      engineering: { demoZone: zone, designOnly: true },
    };
  });
}

export function createAuroraDemoProject() {
  const fixtures = [
    ...ring(24, 7.6, "nozzle_jet_3d", "outer", "Outer jet"),
    ...ring(12, 4.9, "nozzle_geyser", "inner", "Inner geyser", Math.PI / 12),
    ...ring(8, 6.3, "nozzle_arch", "arch", "Arch", Math.PI / 8),
    ...ring(8, 2.4, "nozzle_fan_medium", "fan", "Center fan", Math.PI / 8),
    ...ring(4, 3.5, "motion_2d", "motion", "Moving jet", Math.PI / 4),
    ...ring(16, 8.25, "light_underwater", "outer-light", "Outer RGB", Math.PI / 16),
    ...ring(8, 3.1, "light_rgb", "inner-light", "Center RGB", Math.PI / 8),
    ...ring(4, 8.85, "pump", "pump", "Virtual pump", Math.PI / 4),
  ];
  return {
    format: "AquaFlowPoolGeometry",
    version: "1.0",
    id: AURORA_DEMO_ID,
    name: AURORA_DEMO_NAME,
    pool_type: "circular",
    params: { width: 20, length: 20, radius: 9.5, depth: 0.8 },
    geometry: { type: "circle", center: { x: 10, y: 10 }, radius: 9.5 },
    fixtures,
    layers: [],
    measurements: [],
    depth_zones: [],
    manualPipes: [],
    pipes: [],
    hydraulics: null,
    solved_hydraulics: null,
    bom: [],
  };
}
