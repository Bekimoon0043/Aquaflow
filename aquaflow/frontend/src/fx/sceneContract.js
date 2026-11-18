export const AQUAFX_SCENE_SCHEMA = "aquafx-scene";
export const AQUAFX_SCENE_VERSION = 1;

export function createSceneContract({ seed = 1234, tier = "L1", capabilities = [], notes = [] } = {}) {
  return {
    schema: AQUAFX_SCENE_SCHEMA,
    version: AQUAFX_SCENE_VERSION,
    units: { length: "m", time: "s", flow: "m3/s", pressure: "Pa", power: "W", luminousFlux: "lm" },
    coordinates: "engineering_xy_to_blender_x_negative_y_z",
    seed,
    tier,
    capabilities,
    provenance: "generic_visualization_presets_not_manufacturer_verified",
    hardwareOutput: false,
    notes,
  };
}

export function validateSceneContract(scene) {
  const issues = [];
  if (scene?.schema !== AQUAFX_SCENE_SCHEMA) issues.push("schema");
  if (scene?.version !== AQUAFX_SCENE_VERSION) issues.push("version");
  if (!Number.isInteger(scene?.seed)) issues.push("seed");
  if (!scene?.units || scene.units.length !== "m" || scene.units.time !== "s") issues.push("units");
  if (scene.hardwareOutput !== false) issues.push("hardwareOutput must remain false for generated previews");
  return issues;
}
