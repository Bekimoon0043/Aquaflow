/**
 * fixtureTypeMap.js — Engineering fixture type → 3D nozzle behavior
 *
 * Maps every engineering fixture type string to:
 *  - NOZZLE_TYPE for the 3D particle system
 *  - tilt angles (for arch, fan jets)
 *  - visual scale modifier
 *  - water color
 *  - whether it's a light (not a water nozzle)
 */

export const NOZZLE_3D = {
  JET_1D:     "jet_1d",
  JET_2D:     "jet_2d",
  JET_3D:     "jet_3d",
  GEYSER:     "geyser",
  ARCH:       "arch",
  LAMINAR:    "laminar",
  MIST:       "mist",
  CASCADE:    "cascade",
  RING:       "ring",
    PIROUETTE:  "pirouette",
  FAN:        "fan_jet",
  MOTION_1D:  "motion_1d",
  MOTION_2D:  "motion_2d",
  MOTION_3D:  "motion_3d",
  FLAME:      "flame",
  LASER:      "laser",
  SCREEN:     "screen",
};

/**
 * Master mapping table.
 * Key = fixture type string from Engineering Designer
 * Value = 3D rendering config
 */
const FIXTURE_MAP = {
  // ─── Straight / vertical jets ─────────────────────────────────────────────
  "straight_jet_dn25":    { nozzleType: NOZZLE_3D.JET_3D,    tiltX:0,  tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },
  "straight_jet_dn32":    { nozzleType: NOZZLE_3D.JET_3D,    tiltX:0,  tiltZ:0,  scale:1.2, color:"#88ccff", heightMult:1.2 },
  "straight_jet_dn50":    { nozzleType: NOZZLE_3D.JET_3D,    tiltX:0,  tiltZ:0,  scale:1.5, color:"#88ccff", heightMult:1.4 },
  "nozzle_jet":           { nozzleType: NOZZLE_3D.JET_3D,    tiltX:0,  tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },
  "nozzle_jet_3d":        { nozzleType: NOZZLE_3D.JET_3D,    tiltX:10, tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },
  "jet_3d":               { nozzleType: NOZZLE_3D.JET_3D,    tiltX:10, tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },
  "jet_1d":               { nozzleType: NOZZLE_3D.JET_1D,    tiltX:0,  tiltZ:0,  scale:0.8, color:"#88ccff", heightMult:0.9 },
  "jet_2d":               { nozzleType: NOZZLE_3D.JET_2D,    tiltX:5,  tiltZ:0,  scale:0.9, color:"#88ccff", heightMult:0.95 },

  // ─── Geyser / turbulent vertical ─────────────────────────────────────────
  "geyser":               { nozzleType: NOZZLE_3D.GEYSER,    tiltX:0,  tiltZ:0,  scale:1.4, color:"#66aaff", heightMult:1.5 },
  "nozzle_geyser":        { nozzleType: NOZZLE_3D.GEYSER,    tiltX:0,  tiltZ:0,  scale:1.4, color:"#66aaff", heightMult:1.5 },
  "compressed_air_burst": { nozzleType: NOZZLE_3D.GEYSER,    tiltX:0,  tiltZ:0,  scale:1.8, color:"#aaddff", heightMult:2.0 },
  "air_burst":            { nozzleType: NOZZLE_3D.GEYSER,    tiltX:0,  tiltZ:0,  scale:1.8, color:"#aaddff", heightMult:2.0 },

  // ─── Laminar / smooth arc ─────────────────────────────────────────────────
  "laminar_jet":          { nozzleType: NOZZLE_3D.LAMINAR,   tiltX:0,  tiltZ:0,  scale:0.6, color:"#00ffcc", heightMult:1.3 },
  "laminar":              { nozzleType: NOZZLE_3D.LAMINAR,   tiltX:0,  tiltZ:0,  scale:0.6, color:"#00ffcc", heightMult:1.3 },
  "nozzle_laminar":       { nozzleType: NOZZLE_3D.LAMINAR,   tiltX:0,  tiltZ:0,  scale:0.6, color:"#00ffcc", heightMult:1.3 },

  // ─── Arch jets ────────────────────────────────────────────────────────────
  "arch_jet":             { nozzleType: NOZZLE_3D.ARCH,      tiltX:35, tiltZ:0,  scale:0.9, color:"#88ccff", heightMult:1.0 },
  "nozzle_arch":          { nozzleType: NOZZLE_3D.ARCH,      tiltX:35, tiltZ:0,  scale:0.9, color:"#88ccff", heightMult:1.0 },
  "arch":                 { nozzleType: NOZZLE_3D.ARCH,      tiltX:35, tiltZ:0,  scale:0.9, color:"#88ccff", heightMult:1.0 },

  // ─── Fan jets ─────────────────────────────────────────────────────────────
  "fan_jet":              { nozzleType: NOZZLE_3D.FAN,       tiltX:15, tiltZ:0,  scale:1.1, color:"#99ccff", heightMult:0.9 },
  "nozzle_fan":           { nozzleType: NOZZLE_3D.FAN,       tiltX:15, tiltZ:0,  scale:1.1, color:"#99ccff", heightMult:0.9 },
  "fan":                  { nozzleType: NOZZLE_3D.FAN,       tiltX:15, tiltZ:0,  scale:1.1, color:"#99ccff", heightMult:0.9 },

  // ─── Mist / fog nozzles ───────────────────────────────────────────────────
  "mist":                 { nozzleType: NOZZLE_3D.MIST,      tiltX:0,  tiltZ:0,  scale:1.2, color:"#cceeFF", heightMult:0.5 },
  "nozzle_mist":          { nozzleType: NOZZLE_3D.MIST,      tiltX:0,  tiltZ:0,  scale:1.2, color:"#cceeFF", heightMult:0.5 },
  "fog_nozzle":           { nozzleType: NOZZLE_3D.MIST,      tiltX:0,  tiltZ:0,  scale:1.5, color:"#ddeeff", heightMult:0.4 },

  // ─── Cascade / waterfall ─────────────────────────────────────────────────
  "cascade":              { nozzleType: NOZZLE_3D.CASCADE,   tiltX:85, tiltZ:0,  scale:1.0, color:"#aaccff", heightMult:0.6 },
  "nozzle_cascade":       { nozzleType: NOZZLE_3D.CASCADE,   tiltX:85, tiltZ:0,  scale:1.0, color:"#aaccff", heightMult:0.6 },
  "waterfall":            { nozzleType: NOZZLE_3D.CASCADE,   tiltX:85, tiltZ:0,  scale:1.3, color:"#aaccff", heightMult:0.5 },

  // ─── Ring jets ────────────────────────────────────────────────────────────
  "ring":                 { nozzleType: NOZZLE_3D.RING,      tiltX:45, tiltZ:0,  scale:0.8, color:"#88ccff", heightMult:0.8 },
  "nozzle_ring":          { nozzleType: NOZZLE_3D.RING,      tiltX:45, tiltZ:0,  scale:0.8, color:"#88ccff", heightMult:0.8 },

  // ─── Pirouette / rotating ─────────────────────────────────────────────────
  "pirouette":            { nozzleType: NOZZLE_3D.PIROUETTE, tiltX:20, tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },
  "nozzle_pirouette":     { nozzleType: NOZZLE_3D.PIROUETTE, tiltX:20, tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },
    "rotating_jet":         { nozzleType: NOZZLE_3D.PIROUETTE, tiltX:20, tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },

    // ─── Motion nozzles (1D tilt / 2D pan-tilt / 3D robotic) ──────────────────
  "motion_1d":                           { nozzleType: NOZZLE_3D.MOTION_1D, tiltX:0,  tiltZ:0,  scale:0.9, color:"#88ccff", heightMult:0.95 },
  "motion_2d":                           { nozzleType: NOZZLE_3D.MOTION_2D, tiltX:5,  tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },
  "motion_3d":                           { nozzleType: NOZZLE_3D.MOTION_3D, tiltX:8,  tiltZ:0,  scale:1.1, color:"#88ccff", heightMult:1.05 },
  "motion_nozzle_1d":                    { nozzleType: NOZZLE_3D.MOTION_1D, tiltX:0,  tiltZ:0,  scale:0.9, color:"#88ccff", heightMult:0.95 },
  "motion_nozzle_2d":                    { nozzleType: NOZZLE_3D.MOTION_2D, tiltX:5,  tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },
  "motion_nozzle_3d":                    { nozzleType: NOZZLE_3D.MOTION_3D, tiltX:8,  tiltZ:0,  scale:1.1, color:"#88ccff", heightMult:1.05 },
  "motion_nozzle_1d_tilt_motor":         { nozzleType: NOZZLE_3D.MOTION_1D, tiltX:0,  tiltZ:0,  scale:0.9, color:"#88ccff", heightMult:0.95 },
  "motion_nozzle_2d_pan_tilt":           { nozzleType: NOZZLE_3D.MOTION_2D, tiltX:5,  tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },
  "motion_nozzle_2d_pan_tilt_motor":     { nozzleType: NOZZLE_3D.MOTION_2D, tiltX:5,  tiltZ:0,  scale:1.0, color:"#88ccff", heightMult:1.0 },
  "motion_nozzle_3d_robotic":            { nozzleType: NOZZLE_3D.MOTION_3D, tiltX:8,  tiltZ:0,  scale:1.1, color:"#88ccff", heightMult:1.05 },
  "robotic_nozzle":                      { nozzleType: NOZZLE_3D.MOTION_3D, tiltX:8,  tiltZ:0,  scale:1.1, color:"#88ccff", heightMult:1.05 },

  // ─── Lights (rendered as light sources, not water) ────────────────────────
  "light_uw":             { isLight:true, lightType:"point",    color:"#0066ff", intensity:4.0 },
  "light_spot":           { isLight:true, lightType:"spot",     color:"#ffcc00", intensity:5.0 },
  "light_moving":         { isLight:true, lightType:"moving",   color:"#ff00ff", intensity:6.0 },
  "underwater_light":     { isLight:true, lightType:"point",    color:"#0066ff", intensity:4.0 },
  "spotlight":            { isLight:true, lightType:"spot",     color:"#ffcc00", intensity:5.0 },
  "rgb_light":            { isLight:true, lightType:"point",    color:"#ffffff", intensity:3.5 },
    "nozzle_light":         { isLight:true, lightType:"point",    color:"#0088ff", intensity:4.0 },

  // ─── Explicit fixtureLibrary key mappings ─────────────────────────────────
  "nozzle_straight_dn15":        { nozzleType: NOZZLE_3D.JET_1D,    tiltX:0,  tiltZ:0,  scale:0.7, color:"#88ccff", heightMult:0.7 },
  "nozzle_straight_dn40":        { nozzleType: NOZZLE_3D.JET_3D,    tiltX:0,  tiltZ:0,  scale:1.3, color:"#88ccff", heightMult:1.3 },
  "nozzle_foam_dn40":            { nozzleType: NOZZLE_3D.GEYSER,    tiltX:0,  tiltZ:0,  scale:1.6, color:"#aaddff", heightMult:1.3 },
  "nozzle_jumping_jet":          { nozzleType: NOZZLE_3D.LAMINAR,   tiltX:0,  tiltZ:0,  scale:0.7, color:"#00ffee", heightMult:1.5 },
  "nozzle_volcano":              { nozzleType: NOZZLE_3D.GEYSER,    tiltX:0,  tiltZ:0,  scale:2.0, color:"#ffaa55", heightMult:2.5 },
  "nozzle_fan_small":            { nozzleType: NOZZLE_3D.FAN,       tiltX:10, tiltZ:0,  scale:0.8, color:"#99ccff", heightMult:0.7 },
  "nozzle_fan_medium":           { nozzleType: NOZZLE_3D.FAN,       tiltX:15, tiltZ:0,  scale:1.0, color:"#99ccff", heightMult:0.9 },
  "nozzle_fan_large":            { nozzleType: NOZZLE_3D.FAN,       tiltX:20, tiltZ:0,  scale:1.3, color:"#99ccff", heightMult:1.1 },
  "nozzle_arch_small":           { nozzleType: NOZZLE_3D.ARCH,      tiltX:25, tiltZ:0,  scale:0.7, color:"#88ccff", heightMult:0.8 },
  "nozzle_arch_medium":          { nozzleType: NOZZLE_3D.ARCH,      tiltX:35, tiltZ:0,  scale:0.9, color:"#88ccff", heightMult:1.0 },
  "nozzle_arch_large":           { nozzleType: NOZZLE_3D.ARCH,      tiltX:45, tiltZ:0,  scale:1.1, color:"#88ccff", heightMult:1.2 },
  "nozzle_mist_ring":            { nozzleType: NOZZLE_3D.MIST,      tiltX:0,  tiltZ:0,  scale:1.0, color:"#cceeFF", heightMult:0.4 },
  "nozzle_fog_highpressure":     { nozzleType: NOZZLE_3D.MIST,      tiltX:0,  tiltZ:0,  scale:1.8, color:"#e8f4ff", heightMult:0.3 },
  "nozzle_water_screen":         { nozzleType: NOZZLE_3D.SCREEN,    tiltX:0,  tiltZ:0,  scale:1.8, color:"#bbddff", heightMult:1.2 },
  "light_uw_white_18w":          { isLight:true, lightType:"point",  color:"#ffffee", intensity:2.5 },
  "light_uw_rgb_18w":            { isLight:true, lightType:"point",  color:"#ffffff", intensity:2.5 },
  "light_uw_rgb_36w":            { isLight:true, lightType:"point",  color:"#ffffff", intensity:3.5 },
  "light_uw_rgb_54w":            { isLight:true, lightType:"point",  color:"#ffffff", intensity:4.5 },
  "light_spot_50w":              { isLight:true, lightType:"spot",   color:"#ffeeaa", intensity:4.0 },
  "light_spot_100w":             { isLight:true, lightType:"spot",   color:"#ffee88", intensity:6.0 },
  "light_moving_head_150w":      { isLight:true, lightType:"moving", color:"#ff99ff", intensity:5.0 },
  "light_moving_head_350w":      { isLight:true, lightType:"moving", color:"#ff66ff", intensity:7.0 },
  "laser_rgb_5w":                { isLight:true, lightType:"laser",  color:"#ff00ff", intensity:3.0 },
  "laser_rgb_20w":               { isLight:true, lightType:"laser",  color:"#ff00cc", intensity:5.0 },
  "motion_nozzle_2d_pan_tilt_motor": { nozzleType: NOZZLE_3D.MOTION_2D, tiltX:5, tiltZ:0, scale:1.0, color:"#88ccff", heightMult:1.0 },
  "motion_nozzle_3d_robotic_module": { nozzleType: NOZZLE_3D.MOTION_3D, tiltX:8, tiltZ:0, scale:1.1, color:"#88ccff", heightMult:1.05 },

  // ─── Flame effects ─────────────────────────────────────────────────
  "flame":                { nozzleType: NOZZLE_3D.FLAME, tiltX:0, tiltZ:0, scale:1.2, color:"#ff6622", heightMult:0.7 },
  "effect_flame":         { nozzleType: NOZZLE_3D.FLAME, tiltX:0, tiltZ:0, scale:1.0, color:"#ff6622", heightMult:0.6 },
// ─── Cascade / waterfall nozzles ─────────────────────────────────────────
  "nozzle_cascade_weir":     { nozzleType: NOZZLE_3D.CASCADE, tiltX:85, tiltZ:0, scale:1.2, color:"#aaccff", heightMult:0.7 },
  "nozzle_cascade_curtain":  { nozzleType: NOZZLE_3D.CASCADE, tiltX:88, tiltZ:0, scale:1.6, color:"#aaccff", heightMult:0.6 },
};

/**
 * Resolve a fixture type string to its 3D config.
 * Falls back to a sensible default if type is unknown.
 */
export function resolveFixtureType(typeString) {
  if (!typeString) return getDefault();
  const key = typeString.toLowerCase().trim();
  if (FIXTURE_MAP[key]) return FIXTURE_MAP[key];
  // Fuzzy match
  if (key.includes("geyser"))   return FIXTURE_MAP["geyser"];
  if (key.includes("laminar"))  return FIXTURE_MAP["laminar_jet"];
  if (key.includes("arch"))     return FIXTURE_MAP["arch_jet"];
  if (key.includes("fan"))      return FIXTURE_MAP["fan_jet"];
  if (key.includes("mist") && !key.startsWith("pump_"))     return FIXTURE_MAP["mist"];
  if (key.includes("cascade"))  return FIXTURE_MAP["cascade"];
  if (key.includes("light"))    return FIXTURE_MAP["light_uw"];
  if (key.includes("ring"))     return FIXTURE_MAP["ring"];
  if (key.includes("fog"))      return FIXTURE_MAP["fog_nozzle"];
  if (key.includes("water_screen")) return FIXTURE_MAP["nozzle_water_screen"];  // upward SCREEN sheet
  if (key.includes("cascade_weir") || key.includes("cascade_curtain")) return FIXTURE_MAP["nozzle_cascade_weir"];
  if (key.includes("volcano"))  return FIXTURE_MAP["nozzle_volcano"];
  if (key.includes("foam"))     return FIXTURE_MAP["nozzle_foam_dn40"];
  if (key.includes("jumping"))  return FIXTURE_MAP["nozzle_jumping_jet"];
  if (key.includes("motion_1d") || key.includes("tilt_motor"))  return FIXTURE_MAP["motion_1d"];
  if (key.includes("motion_2d") || key.includes("pan_tilt"))    return FIXTURE_MAP["motion_2d"];
  if (key.includes("motion_3d") || key.includes("robotic"))     return FIXTURE_MAP["motion_3d"];
  if (key.includes("laser"))    return FIXTURE_MAP["laser_rgb_5w"];
  // Flame / fire effects
  if (key.includes("flame") || key.includes("fire")) return FIXTURE_MAP["flame"];
  // Air burst / compressed air → explosive geyser
  if (key.includes("air_burst") || key.includes("compressed")) return FIXTURE_MAP["compressed_air_burst"];
  // Straight jets by bore size
  if (key.includes("straight")) {
    if (key.includes("dn15") || key.includes("dn10")) return FIXTURE_MAP["jet_1d"];
    if (key.includes("dn40") || key.includes("dn50")) return FIXTURE_MAP["straight_jet_dn50"];
    return FIXTURE_MAP["straight_jet_dn25"];
  }
  return getDefault();
}

function getDefault() {
  return { nozzleType: NOZZLE_3D.JET_3D, tiltX:0, tiltZ:0, scale:1.0, color:"#88ccff", heightMult:1.0 };
}

/**
 * fixturePlanCoords(fixture) → { x, z }
 *
 * CANONICAL AXIS CONVENTION — single source of truth for the whole app:
 *   Engineering / plan space : (x, y)            — y is the depth axis
 *   3D / world space         : (x, height, z)    — z is the depth axis (z === engineering y)
 *   Nozzle Map (top view)    : (x, y)            — its y is the depth axis (=== engineering y)
 *
 * Every consumer (3D scene, Pattern Designer groups, Nozzle Map) MUST derive the
 * depth coordinate through this helper so the 2D top view and the 3D view can never
 * disagree. Do NOT re-introduce ad-hoc `?? fixture.z ??` fallbacks: `z` is a *derived*
 * world coordinate, so reading it back as a source re-introduces drift between views.
 * Uses `??` (not `||`) so an explicit 0 coordinate is respected.
 */
export function fixturePlanCoords(fixture) {
  const f = fixture || {};
  const x = f.x ?? f.position?.x ?? 0;
  const z = f.y ?? f.position?.y ?? 0; // engineering Y → plan / 3D depth axis
  return { x, z };
}

/**
 * Convert engineering fixture array to FountainScene_v6 nozzle config array.
 * This is the main translation function called by useEngineeringSync.
 */
export function fixturesToNozzleConfigs(fixtures) {
  const nozzleConfigs = [];
  const lightConfigs  = [];

  fixtures.forEach(f => {
    const map = resolveFixtureType(f.type);

    // Plant equipment has no particle emitter. Keep it in the engineering
    // model and show tracks without drawing a fictitious water nozzle.
    if (classifyFixtureType(f.type) === "equipment") return;

    const { x: planX, z: planZ } = fixturePlanCoords(f);

    if (map.isLight) {
      lightConfigs.push({
        id:        f.id,
        x:         planX,
        y:         0,
        z:         planZ, // Engineering uses Y for depth-axis, 3D uses Z (see fixturePlanCoords)
        // Use fixture-configured color if set, else fall back to library default
        color:     f.color || f.params?.color || f.engineering?.color || map.color,
        intensity: (f.engineering?.wattage ? f.engineering.wattage / 18.0 : map.intensity),
        radius:    f.engineering?.beamRadiusM || 4.5,
        lightType: map.lightType,
      });
    } else {
      // Apply engineering data to scale the 3D effect
      const eng = f.engineering || {};
      const pressureScale = eng.pressureBar   ? Math.min(2.0, Math.max(0.3, eng.pressureBar / 3.0))  : 1.0;
      const heightScale   = eng.jetHeightM    ? Math.min(3.0, Math.max(0.2, eng.jetHeightM  / 3.0))  : map.heightMult;
      const flowScale     = eng.flowLpm       ? Math.min(2.0, Math.max(0.2, eng.flowLpm     / 80.0)) : 1.0;

      nozzleConfigs.push({
        id:       f.id,
        type:     map.nozzleType,
        // Engineering Y axis = 3D Z axis (plan view) — via canonical fixturePlanCoords
        x:        planX,
        z:        planZ,
        rotation: f.rotation || 0,
        tiltX:    map.tiltX  || 0,
        tiltZ:    map.tiltZ  || 0,
        // Scale effects from engineering data
        intensityScale: pressureScale * flowScale,
        heightScale,
        color:    map.color,
        label:    f.label,
        zone:     f.zone,
groupId: f.groupId || resolveFixtureGroup(f.type),
        // Pass engineering data through for reference
        engineering: eng,
      });
    }
  });

  return { nozzleConfigs, lightConfigs };
}

/**
 * Convert engineering geometry to FountainScene_v6 poolGeometry config.
 */
export function geometryToPoolConfig(geometry, params, poolType) {
  if (!geometry && !params) return null;
  return {
    poolType: poolType || "rectangular",
    params:   params   || { width:12, length:8, radius:6, depth:0.8 },
    geometry: geometry || null,
  };
}
/**
 * resolveFixtureGroup(typeString) → professional show group id (or null)
 * Accepts library keys ("nozzle_arch_large", "effect_flame_single") AND
 * bare tokens ("arch", "lighting"). Returns null for plant/control equipment.
 * This is the SINGLE place fixture-type → show-group routing is decided.
 */
export function resolveFixtureGroup(typeString) {
  const k = String(typeString || "").trim().toLowerCase();
  if (!k) return null;

  if (k.includes("running")) return "running_fountain_jets";
  if (k.includes("foam")) return "foam_jets";
  if (k.includes("peacock")) return "peacock_jets";

  const EQUIP_PREFIXES = [
    "pump_", "valve_", "filter_", "fuel_", "air_compressor", "air_tank",
    "control_", "sensor_", "safety_", "dosing_", "uv_", "power_",
    "junction_", "manifold_",
  ];
  if (EQUIP_PREFIXES.some(p => k.startsWith(p))) return null;
  if (["pump", "valve", "filter", "sensor", "compressor", "tank"].includes(k)) return null;

  if (
  k.startsWith("light_") ||
  k.includes("underwater_light") ||
  k.includes("spotlight") ||
  k.includes("moving_head") ||
  k.includes("rgb") ||
  k.includes("rgbw") ||
  k.includes("led") ||
  k.includes("dmx") ||
  k === "light" ||
  k === "lighting"
) {
  return "rgb_lights";
}

  if (k.startsWith("laser_") || k === "laser") return "laser_units";

  if (k.includes("flame") || k.includes("fire")) return "flame_units";

    if ((k.includes("fog_machine") || k.includes("smoke_machine") || k === "fog" || k === "smoke") && !k.startsWith("nozzle_")) {
    return "fog_machines";
  }

  // Motion nozzles (1D tilt / 2D pan-tilt / 3D robotic) — check before generic jets
  if (k.includes("motion") || k.includes("robotic") || k.includes("pan_tilt") || k.includes("gimbal")) {
    if (k.includes("3d") || k.includes("robotic") || k.includes("gimbal")) return "motion_3d_jets";
    if (k.includes("2d") || k.includes("pan_tilt"))                        return "motion_2d_jets";
    if (k.includes("1d") || k.includes("tilt"))                            return "motion_1d_jets";
    return "motion_2d_jets";
  }
if (k.includes("arch"))                                   return "arch_jets";
  if (k.includes("mist"))                                   return "mist_jets";
  if (k.includes("fog"))                                    return "mist_jets";
  if (k.includes("water_screen"))                           return "screen_jets";
  if (k.includes("cascade") || k.includes("waterfall"))    return "cascade_jets";
  if (k.includes("ring"))                                   return "outer_ring_jets";

  return "center_jets";
}

/**
 * classifyFixtureType(typeString)
 *
 * Unified engineering/runtime/AI fixture classification.
 *
 * Returns:
 *   "nozzle"
 *   "light"
 *   "equipment"
 *   "effect"
 */
export function classifyFixtureType(typeString) {
  const k = String(typeString || "").trim().toLowerCase();

  if (!k) return "nozzle";

  // ─── Equipment ─────────────────────────────────────────────
  const equipmentKeywords = [
    "pump",
    "valve",
    "filter",
    "sensor",
    "control",
    "controller",
    "panel",
    "plc",
    "vfd",
    "manifold",
    "air_compressor",
    "compressor",
    "air_tank",
    "tank",
    "chemical",
    "dosing",
    "uv",
    "junction",
    "power",
    "cable",
    "pipe",
    "return",
    "drain",
    "supply",
  ];

  if (equipmentKeywords.some(w => k.includes(w))) {
    return "equipment";
  }

  // ─── Effects ───────────────────────────────────────────────
  const effectKeywords = [
  "flame",
  "fire",
  "fog",
  "smoke",
  "haze",
  "fog_machine",
  "smoke_machine",
  "laser",
  "laser_",
  "co2",
  "spark",
  "special_fx",
  "effect_",
];

  if (effectKeywords.some(w => k.includes(w))) {
    return "effect";
  }

  // ─── Lights ────────────────────────────────────────────────
  const lightKeywords = [
    "light",
    "rgb",
    "rgbw",
    "led",
    "moving_head",
    "spot",
    "spotlight",
    "underwater",
  ];

  if (lightKeywords.some(w => k.includes(w))) {
    return "light";
  }

  // ─── Default = nozzle/water device ─────────────────────────
  return "nozzle";
}
