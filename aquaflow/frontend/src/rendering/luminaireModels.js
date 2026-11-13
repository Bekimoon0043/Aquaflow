const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function merge(base, override) {
  if (!isObject(base) || !isObject(override)) {
    if (Array.isArray(override)) return override.map((value) => merge(null, value));
    if (isObject(override)) return merge({}, override);
    return override;
  }
  const result = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(override)])) {
    const value = key in override ? override[key] : base[key];
    result[key] = isObject(value) && isObject(base?.[key])
      ? merge(base[key], value)
      : merge(null, value);
  }
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const keyOf = (value) => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

function photometrics(required = [], optional = [], units = {}, extra = {}) {
  return {
    requiredFor: "physical",
    required,
    optional,
    units,
    fallback: "legacy_intensity",
    ...extra,
  };
}

function capabilities(extra = {}) {
  return {
    beam: false,
    area: false,
    gobo: false,
    projection: false,
    framing: false,
    panTilt: false,
    pixelMapping: false,
    scanning: false,
    ...extra,
  };
}

function shadows(mode = "none", cast = false, update = "never", budget = 0) {
  return { mode, cast, update, budget };
}

function volumetrics(mode = "none", enabled = false, medium = null, anisotropy = 0) {
  return { mode, enabled, medium, anisotropy, requiresMedium: enabled && medium !== null };
}

const FIXTURE_PROVENANCE = {
  acceptedSources: ["manufacturer_datasheet", "user_measured"],
  sourceFields: {
    manufacturer_datasheet: ["manufacturer", "model", "document", "revision", "licence", "units"],
    user_measured: ["model", "date", "units"],
  },
  measurementFields: [],
  genericPolicy: "label_as_generic_estimate",
  genericUse: "preview_only",
  genericConfidence: "low",
  requiresExplicitLabel: true,
  safetyCritical: false,
};

const ENVIRONMENT_PROVENANCE = {
  acceptedSources: ["manufacturer_datasheet", "user_measured", "asset_license", "astronomical_model", "art_directed"],
  sourceFields: {
    manufacturer_datasheet: ["manufacturer", "model", "document", "revision", "licence", "units"],
    user_measured: ["model", "date", "units"],
    asset_license: ["document", "revision", "licence"],
    astronomical_model: ["model", "revision", "units"],
    art_directed: ["model", "revision"],
  },
  measurementFields: [],
  genericPolicy: "label_as_scene_preset",
  genericUse: "preview_only",
  genericConfidence: "low",
  requiresExplicitLabel: true,
  safetyCritical: false,
};

const BASE_DEFAULTS = {
  rendererKind: "point",
  photometricRequirements: photometrics(),
  capabilities: capabilities(),
  beam: null,
  area: null,
  gobo: null,
  projection: null,
  shadowPolicy: shadows(),
  volumetricPolicy: volumetrics(),
  controlChannels: ["dimmer"],
  controlProtocols: ["DMX", "Art-Net"],
  provenanceRequirements: FIXTURE_PROVENANCE,
};

const FAMILY_DEFINITIONS = {
  underwater: {
    label: "Underwater luminaires",
    defaultType: "underwater_point",
    photometricRequirements: photometrics(
      ["lumens"],
      ["wattage", "beamAngleDeg", "cctK", "spectralPowerDistribution", "ies"],
      { lumens: "lm", wattage: "W", beamAngleDeg: "deg", cctK: "K", ies: "IES LM-63" },
    ),
    volumetricPolicy: volumetrics("underwater_scattering", true, "water", 0.6),
    controlChannels: ["dimmer", "red", "green", "blue", "white"],
    provenanceRequirements: { measurementFields: ["lumens", "wattage"] },
  },
  moving_head: {
    label: "Moving-head luminaires",
    defaultType: "moving_head_spot",
    rendererKind: "moving",
    photometricRequirements: photometrics(
      ["lumens", "beamAngleDeg"],
      ["wattage", "candela", "cctK", "spectralPowerDistribution", "ies"],
      { lumens: "lm", wattage: "W", beamAngleDeg: "deg", candela: "cd", cctK: "K", ies: "IES LM-63" },
    ),
    capabilities: capabilities({ beam: true, panTilt: true }),
    beam: { distribution: "cone", defaultAngleDeg: 12, zoomRangeDeg: null, softnessDeg: 10 },
    shadowPolicy: shadows("single", true, "per_frame", 2),
    volumetricPolicy: volumetrics("air_haze", true, "air", 0.6),
    controlChannels: ["dimmer", "red", "green", "blue", "white", "pan", "tilt", "pan_fine", "tilt_fine"],
    provenanceRequirements: { measurementFields: ["lumens", "beamAngleDeg", "wattage"] },
  },
  projection: {
    label: "Optical and video projection",
    defaultType: "framing_gobo",
    rendererKind: "projector",
    photometricRequirements: photometrics(
      ["lumens", "beamAngleDeg"],
      ["wattage", "candela", "goboTransmission", "ies"],
      { lumens: "lm", wattage: "W", beamAngleDeg: "deg", candela: "cd", goboTransmission: "fraction", ies: "IES LM-63" },
    ),
    capabilities: capabilities({ beam: true, gobo: true, projection: true, framing: true }),
    beam: { distribution: "cone", defaultAngleDeg: 30, zoomRangeDeg: [15, 45], softnessDeg: 2 },
    gobo: { supported: true, rotating: false, slots: 1 },
    projection: { kind: "gobo", framingBlades: 4, textureRequired: false },
    shadowPolicy: shadows("single", true, "on_demand", 1),
    volumetricPolicy: volumetrics("air_haze", true, "air", 0.6),
    controlChannels: ["dimmer", "zoom", "focus", "framing", "gobo"],
    provenanceRequirements: { measurementFields: ["lumens", "beamAngleDeg", "goboTransmission"] },
  },
  laser: {
    label: "Laser projectors",
    defaultType: "full_colour_laser",
    rendererKind: "laser",
    photometricRequirements: photometrics(
      ["opticalPowerW", "wavelengthNm", "divergenceMrad"],
      ["inputPowerW", "scanAngleDeg", "spectralPowerDistribution"],
      { opticalPowerW: "W", inputPowerW: "W", wavelengthNm: "nm", divergenceMrad: "mrad", scanAngleDeg: "deg" },
      { fallback: "legacy_laser_intensity" },
    ),
    capabilities: capabilities({ beam: true, projection: true, scanning: true }),
    beam: { distribution: "coherent_scan", defaultAngleDeg: 1, divergenceMrad: null },
    projection: { kind: "scanned_vector", textureRequired: false },
    volumetricPolicy: volumetrics("laser_beam", true, "air", 0.8),
    controlChannels: ["safety_shutter", "dimmer", "scan_x", "scan_y", "pattern"],
    controlProtocols: ["ILDA", "DMX"],
    provenanceRequirements: {
      measurementFields: ["opticalPowerW", "wavelengthNm", "divergenceMrad", "scanAngleDeg"],
      safetyCritical: true,
      genericUse: "visualisation_only_not_safety_design",
    },
  },
  area: {
    label: "Area and pixel luminaires",
    defaultType: "rectangular_area",
    rendererKind: "area",
    photometricRequirements: photometrics(
      ["lumens", "lengthM", "widthM"],
      ["wattage", "luminanceCdM2", "cctK", "spectralPowerDistribution"],
      { lumens: "lm", wattage: "W", lengthM: "m", widthM: "m", luminanceCdM2: "cd/m^2", cctK: "K" },
    ),
    capabilities: capabilities({ area: true }),
    area: { shape: "rectangle", lengthM: null, widthM: null, twoSided: false },
    shadowPolicy: shadows("baked", false, "on_demand", 0),
    controlChannels: ["dimmer", "red", "green", "blue", "white", "cct"],
    provenanceRequirements: { measurementFields: ["lumens", "lengthM", "widthM", "luminanceCdM2"] },
  },
  environment: {
    label: "Environmental lighting",
    defaultType: "ambient",
    rendererKind: "ambient",
    photometricRequirements: photometrics([], [], {}, { fallback: "scene_preset" }),
    controlChannels: [],
    controlProtocols: ["scene"],
    provenanceRequirements: ENVIRONMENT_PROVENANCE,
  },
};

export const LUMINAIRE_FAMILIES = deepFreeze(Object.fromEntries(
  Object.entries(FAMILY_DEFINITIONS).map(([id, definition]) => [
    id,
    merge(BASE_DEFAULTS, { ...definition, id }),
  ]),
));

const MOVING_SPOT_CHANNELS = [
  "dimmer", "red", "green", "blue", "white", "pan", "tilt", "pan_fine", "tilt_fine",
  "zoom", "focus", "gobo", "gobo_rotation",
];
const MOVING_WASH_CHANNELS = [
  "dimmer", "red", "green", "blue", "white", "pan", "tilt", "pan_fine", "tilt_fine", "zoom",
];
const MOVING_BEAM_CHANNELS = [
  "dimmer", "red", "green", "blue", "white", "pan", "tilt", "pan_fine", "tilt_fine", "focus", "prism", "frost",
];

const TYPE_DEFINITIONS = {
  underwater_point: {
    label: "Underwater point",
    beam: null,
    photometricRequirements: { optional: ["wattage", "cctK", "spectralPowerDistribution", "ies"] },
  },
  underwater_spot: {
    label: "Underwater spot",
    rendererKind: "spot",
    capabilities: { beam: true },
    beam: { distribution: "cone", defaultAngleDeg: 30, zoomRangeDeg: null, softnessDeg: 10 },
    photometricRequirements: {
      required: ["lumens", "beamAngleDeg"],
      optional: ["wattage", "cctK", "spectralPowerDistribution", "ies"],
    },
    provenanceRequirements: { measurementFields: ["lumens", "beamAngleDeg", "wattage"] },
  },
  underwater_ring: {
    label: "Underwater ring",
    rendererKind: "ring",
    capabilities: { area: true },
    area: { shape: "ring", diameterM: null, emitterCount: null, twoSided: false },
    photometricRequirements: {
      required: ["lumens", "diameterM"],
      optional: ["wattage", "emitterCount", "cctK", "spectralPowerDistribution"],
      units: { diameterM: "m", emitterCount: "count" },
    },
    provenanceRequirements: { measurementFields: ["lumens", "diameterM", "emitterCount"] },
  },
  underwater_linear: {
    label: "Underwater linear",
    rendererKind: "linear",
    capabilities: { area: true },
    area: { shape: "linear", lengthM: null, widthM: null, twoSided: false },
    photometricRequirements: {
      required: ["lumens", "lengthM"],
      optional: ["wattage", "widthM", "cctK", "spectralPowerDistribution"],
      units: { lengthM: "m", widthM: "m" },
    },
    provenanceRequirements: { measurementFields: ["lumens", "lengthM", "widthM"] },
  },
  underwater_wash: {
    label: "Underwater wash",
    rendererKind: "spot",
    capabilities: { beam: true, area: true },
    beam: { distribution: "asymmetric_wash", defaultAngleDeg: 60, zoomRangeDeg: null, softnessDeg: 20 },
    area: { shape: "linear", lengthM: null, widthM: null, twoSided: false },
    photometricRequirements: {
      required: ["lumens", "beamAngleDeg"],
      optional: ["wattage", "lengthM", "widthM", "ies"],
      units: { lengthM: "m", widthM: "m" },
    },
    provenanceRequirements: { measurementFields: ["lumens", "beamAngleDeg", "lengthM", "widthM"] },
  },
  underwater_flood: {
    label: "Underwater flood",
    rendererKind: "spot",
    capabilities: { beam: true },
    beam: { distribution: "wide_cone", defaultAngleDeg: 90, zoomRangeDeg: null, softnessDeg: 25 },
    photometricRequirements: {
      required: ["lumens", "beamAngleDeg"],
      optional: ["wattage", "cctK", "spectralPowerDistribution", "ies"],
    },
    provenanceRequirements: { measurementFields: ["lumens", "beamAngleDeg", "wattage"] },
  },
  moving_head_spot: {
    label: "Moving-head spot",
    capabilities: { gobo: true, projection: true },
    beam: { defaultAngleDeg: 12, zoomRangeDeg: [4, 35], softnessDeg: 3 },
    gobo: { supported: true, rotating: true, slots: null },
    projection: { kind: "gobo", framingBlades: 0, textureRequired: false },
    controlChannels: MOVING_SPOT_CHANNELS,
  },
  moving_head_wash: {
    label: "Moving-head wash",
    capabilities: { area: true },
    beam: { distribution: "wide_cone", defaultAngleDeg: 45, zoomRangeDeg: [8, 60], softnessDeg: 20 },
    area: { shape: "lens_array", lengthM: null, widthM: null, twoSided: false },
    shadowPolicy: shadows(),
    controlChannels: MOVING_WASH_CHANNELS,
  },
  moving_head_beam: {
    label: "Moving-head beam",
    beam: { defaultAngleDeg: 2, zoomRangeDeg: [1, 6], softnessDeg: 0.5 },
    controlChannels: MOVING_BEAM_CHANNELS,
  },
  framing_gobo: {
    label: "Framing / gobo projector",
  },
  video_projector: {
    label: "Video projector",
    photometricRequirements: photometrics(
      ["lumens", "throwRatio", "aspectRatio"],
      ["wattage", "contrastRatio", "colourGamut", "whiteBalance"],
      { lumens: "lm", wattage: "W", throwRatio: "ratio", contrastRatio: "ratio" },
    ),
    capabilities: { gobo: false, framing: false },
    beam: { distribution: "image_cone", defaultAngleDeg: null, zoomRangeDeg: null, softnessDeg: 0 },
    gobo: null,
    projection: { kind: "video", framingBlades: 0, textureRequired: true },
    controlChannels: ["power", "shutter", "source", "test_pattern", "geometry", "blend"],
    controlProtocols: ["HDMI", "SDI", "network"],
    provenanceRequirements: { measurementFields: ["lumens", "throwRatio", "aspectRatio", "colourGamut"] },
  },
  single_colour_laser: {
    label: "Single-colour laser",
    controlChannels: ["safety_shutter", "dimmer", "scan_x", "scan_y", "pattern"],
  },
  full_colour_laser: {
    label: "Full-colour laser",
    controlChannels: ["safety_shutter", "red", "green", "blue", "scan_x", "scan_y", "pattern"],
  },
  rectangular_area: {
    label: "Rectangular area / panel",
  },
  pixel_matrix: {
    label: "Pixel matrix",
    rendererKind: "pixel_matrix",
    photometricRequirements: {
      required: ["lumens", "lengthM", "widthM", "pixelColumns", "pixelRows"],
      optional: ["wattage", "pixelPitchM", "luminanceCdM2", "colourGamut"],
      units: { pixelColumns: "count", pixelRows: "count", pixelPitchM: "m" },
    },
    capabilities: { pixelMapping: true },
    area: { shape: "pixel_matrix", lengthM: null, widthM: null, twoSided: false },
    controlChannels: ["dimmer", "red", "green", "blue", "pixel_data"],
    controlProtocols: ["DMX", "Art-Net", "sACN"],
    provenanceRequirements: { measurementFields: ["lumens", "pixelColumns", "pixelRows", "pixelPitchM"] },
  },
  sun: {
    label: "Sun",
    rendererKind: "directional",
    photometricRequirements: photometrics(
      ["illuminanceLux", "angularDiameterDeg"],
      ["cctK", "spectralPowerDistribution", "elevationDeg", "azimuthDeg"],
      { illuminanceLux: "lx", angularDiameterDeg: "deg", cctK: "K", elevationDeg: "deg", azimuthDeg: "deg" },
      { fallback: "scene_preset" },
    ),
    shadowPolicy: shadows("directional", true, "on_demand", 1),
    controlChannels: ["intensity", "elevation", "azimuth", "colour_temperature"],
    provenanceRequirements: { measurementFields: ["illuminanceLux", "angularDiameterDeg", "cctK"] },
  },
  moon: {
    label: "Moon",
    rendererKind: "directional",
    photometricRequirements: photometrics(
      ["illuminanceLux", "angularDiameterDeg"],
      ["cctK", "elevationDeg", "azimuthDeg", "phase"],
      { illuminanceLux: "lx", angularDiameterDeg: "deg", cctK: "K", elevationDeg: "deg", azimuthDeg: "deg" },
      { fallback: "scene_preset" },
    ),
    shadowPolicy: shadows("directional", true, "on_demand", 1),
    controlChannels: ["intensity", "elevation", "azimuth", "phase"],
    provenanceRequirements: { measurementFields: ["illuminanceLux", "angularDiameterDeg"] },
  },
  hdri: {
    label: "HDRI environment",
    rendererKind: "environment",
    photometricRequirements: photometrics(
      ["hdriMap", "radianceScale"],
      ["rotationDeg", "backgroundVisibility", "licence"],
      { radianceScale: "multiplier", rotationDeg: "deg", backgroundVisibility: "fraction" },
      { fallback: "scene_preset" },
    ),
    shadowPolicy: shadows("baked", false, "on_demand", 0),
    controlChannels: ["intensity", "rotation", "background_visibility"],
    provenanceRequirements: { measurementFields: ["radianceScale", "hdriMap"] },
  },
  ambient: {
    label: "Ambient light",
    rendererKind: "ambient",
    photometricRequirements: photometrics(
      ["illuminanceLux"],
      ["cctK", "skyColour", "groundColour"],
      { illuminanceLux: "lx", cctK: "K" },
      { fallback: "scene_preset" },
    ),
    controlChannels: ["intensity", "colour", "sky_colour", "ground_colour"],
    provenanceRequirements: { measurementFields: ["illuminanceLux", "cctK"] },
  },
};

const FAMILY_FOR_TYPE = {
  underwater_point: "underwater",
  underwater_spot: "underwater",
  underwater_ring: "underwater",
  underwater_linear: "underwater",
  underwater_wash: "underwater",
  underwater_flood: "underwater",
  moving_head_spot: "moving_head",
  moving_head_wash: "moving_head",
  moving_head_beam: "moving_head",
  framing_gobo: "projection",
  video_projector: "projection",
  single_colour_laser: "laser",
  full_colour_laser: "laser",
  rectangular_area: "area",
  pixel_matrix: "area",
  sun: "environment",
  moon: "environment",
  hdri: "environment",
  ambient: "environment",
};

export const LUMINAIRE_TYPES = deepFreeze(Object.fromEntries(
  Object.entries(TYPE_DEFINITIONS).map(([type, definition]) => {
    const family = FAMILY_FOR_TYPE[type];
    return [type, merge(LUMINAIRE_FAMILIES[family], { ...definition, id: type, type, family })];
  }),
));

export const LUMINAIRE_REGISTRY = LUMINAIRE_TYPES;
export const LUMINAIRE_MODELS = LUMINAIRE_TYPES;
export const DEFAULT_LUMINAIRE_TYPE = "underwater_point";

export const LUMINAIRE_ALIASES = deepFreeze({
  light: "underwater_point",
  point: "underwater_point",
  point_light: "underwater_point",
  underwater: "underwater_point",
  underwater_light: "underwater_point",
  light_uw: "underwater_point",
  light_uw_white_18w: "underwater_point",
  light_uw_rgb_18w: "underwater_point",
  light_uw_rgb_36w: "underwater_point",
  light_uw_rgb_54w: "underwater_point",
  light_uw_rgbw_72w: "underwater_point",
  nozzle_light: "underwater_point",
  rgb_light: "underwater_point",
  spot: "underwater_spot",
  spotlight: "underwater_spot",
  light_spot: "underwater_spot",
  light_spot_50w: "underwater_spot",
  light_spot_100w: "underwater_spot",
  ring: "underwater_ring",
  ring_light: "underwater_ring",
  light_ring: "underwater_ring",
  light_ring_rgb_24w: "underwater_ring",
  linear: "underwater_linear",
  linear_light: "underwater_linear",
  light_linear: "underwater_linear",
  light_linear_rgbw_1m: "underwater_linear",
  wash: "underwater_wash",
  wall_wash: "underwater_wash",
  wall_washer: "underwater_wash",
  light_wash: "underwater_wash",
  light_wall_washer: "underwater_wash",
  flood: "underwater_flood",
  floodlight: "underwater_flood",
  flood_light: "underwater_flood",
  light_flood: "underwater_flood",
  moving: "moving_head_spot",
  moving_head: "moving_head_spot",
  moving_spot: "moving_head_spot",
  light_moving: "moving_head_spot",
  light_moving_head_150w: "moving_head_spot",
  light_moving_head_350w: "moving_head_spot",
  moving_wash: "moving_head_wash",
  wash_moving_head: "moving_head_wash",
  moving_beam: "moving_head_beam",
  beam_moving_head: "moving_head_beam",
  framing: "framing_gobo",
  gobo: "framing_gobo",
  gobo_projector: "framing_gobo",
  framing_projector: "framing_gobo",
  light_projector: "framing_gobo",
  light_projector_framing_5200lm: "framing_gobo",
  projector: "video_projector",
  video: "video_projector",
  video_projection: "video_projector",
  water_screen_projector: "video_projector",
  projector_water_screen_20k_christie: "video_projector",
  laser: "full_colour_laser",
  rgb_laser: "full_colour_laser",
  laser_rgb: "full_colour_laser",
  laser_rgb_5w: "full_colour_laser",
  laser_rgb_20w: "full_colour_laser",
  full_color_laser: "full_colour_laser",
  single_laser: "single_colour_laser",
  single_color_laser: "single_colour_laser",
  green_laser: "single_colour_laser",
  laser_green: "single_colour_laser",
  area: "rectangular_area",
  area_light: "rectangular_area",
  panel: "rectangular_area",
  panel_light: "rectangular_area",
  rectangular_panel: "rectangular_area",
  led_panel: "rectangular_area",
  matrix: "pixel_matrix",
  led_matrix: "pixel_matrix",
  pixel: "pixel_matrix",
  pixel_panel: "pixel_matrix",
  light_pixel: "pixel_matrix",
  sunlight: "sun",
  directional_sun: "sun",
  day: "sun",
  dusk: "sun",
  moonlight: "moon",
  directional_moon: "moon",
  night: "moon",
  environment: "hdri",
  environment_map: "hdri",
  ibl: "hdri",
  sky: "hdri",
  ambient_light: "ambient",
  hemisphere: "ambient",
  arena: "ambient",
});

const FAMILY_ALIASES = deepFreeze({
  underwater_lights: "underwater",
  underwater_luminaires: "underwater",
  moving_heads: "moving_head",
  moving_head_luminaires: "moving_head",
  projectors: "projection",
  optical_projection: "projection",
  lasers: "laser",
  laser_effects: "laser",
  laser_projectors: "laser",
  area_lights: "area",
  area_and_pixel_luminaires: "area",
  environmental: "environment",
  environmental_lighting: "environment",
});

export function listLuminaireModels() {
  return Object.values(LUMINAIRE_TYPES);
}

export function getLuminaireFamily(family) {
  const key = keyOf(family);
  const id = LUMINAIRE_FAMILIES[key] ? key : FAMILY_ALIASES[key];
  return id ? LUMINAIRE_FAMILIES[id] || null : null;
}

export function getLuminaireModel(type) {
  const key = keyOf(type);
  const id = LUMINAIRE_TYPES[key] ? key : LUMINAIRE_ALIASES[key];
  return id ? LUMINAIRE_TYPES[id] || null : null;
}

function inferLuminaireType(value) {
  const direct = getLuminaireModel(value);
  if (direct) return direct;
  const key = keyOf(value);
  if (!key) return null;

  if (key.includes("ambient") || key.includes("hemisphere")) return LUMINAIRE_TYPES.ambient;
  if (key.includes("hdri") || key.includes("environment_map") || key === "ibl") return LUMINAIRE_TYPES.hdri;
  if (key.includes("moon")) return LUMINAIRE_TYPES.moon;
  if (key.includes("sun")) return LUMINAIRE_TYPES.sun;
  if (key.includes("laser")) {
    return /green|single|mono|beam_laser/.test(key)
      ? LUMINAIRE_TYPES.single_colour_laser
      : LUMINAIRE_TYPES.full_colour_laser;
  }
  if (key.includes("projector") && /video|water_screen|christie/.test(key)) return LUMINAIRE_TYPES.video_projector;
  if (key.includes("framing") || key.includes("gobo")) return LUMINAIRE_TYPES.framing_gobo;
  if (key.includes("moving") || key.includes("moving_head")) {
    if (key.includes("wash")) return LUMINAIRE_TYPES.moving_head_wash;
    if (key.includes("beam")) return LUMINAIRE_TYPES.moving_head_beam;
    return LUMINAIRE_TYPES.moving_head_spot;
  }
  if (key.includes("pixel") || key.includes("matrix")) return LUMINAIRE_TYPES.pixel_matrix;
  if (/area|rectangular|led_panel|panel_light/.test(key)) return LUMINAIRE_TYPES.rectangular_area;
  if (key.includes("ring")) return LUMINAIRE_TYPES.underwater_ring;
  if (key.includes("linear") || key.includes("linear_bar")) return LUMINAIRE_TYPES.underwater_linear;
  if (key.includes("wash")) return LUMINAIRE_TYPES.underwater_wash;
  if (key.includes("flood")) return LUMINAIRE_TYPES.underwater_flood;
  if (key.includes("spot")) return LUMINAIRE_TYPES.underwater_spot;
  if (/underwater|light_uw|nozzle_light|point_light|rgb_light/.test(key)) return LUMINAIRE_TYPES.underwater_point;
  return null;
}

export function resolveLuminaireModel(recordOrType = {}) {
  if (typeof recordOrType === "string") {
    return inferLuminaireType(recordOrType) || LUMINAIRE_TYPES[DEFAULT_LUMINAIRE_TYPE];
  }
  const record = isObject(recordOrType) ? recordOrType : {};
  const candidates = [
    record.luminaireType,
    record.luminaire?.type,
    record.fixtureType,
    record.key,
    record.type,
    record.label,
    record.visual3d?.type,
    record.lightType,
    record.rendererKind,
    record.family,
    record.category,
  ];
  for (const candidate of candidates) {
    const model = inferLuminaireType(candidate);
    if (model) return model;
  }
  const family = getLuminaireFamily(record.family);
  return LUMINAIRE_TYPES[family?.defaultType] || LUMINAIRE_TYPES[DEFAULT_LUMINAIRE_TYPE];
}

const PHOTOMETRY_ALIASES = deepFreeze({
  lumens: ["lumens", "luminousFluxLm", "luminousFlux"],
  wattage: ["wattage", "powerW"],
  beamAngleDeg: ["beamAngleDeg", "beamAngle"],
  ies: ["ies", "iesFile", "iesUrl"],
  candela: ["candela", "peakCandela"],
  opticalPowerW: ["opticalPowerW", "laserPowerW"],
  inputPowerW: ["inputPowerW", "wattage", "powerW"],
  hdriMap: ["hdriMap", "environmentMap", "map"],
});

function suppliedValue(sources, names) {
  for (const source of sources) {
    if (!isObject(source)) continue;
    for (const name of names) {
      const value = source[name];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

/**
 * Attach registry metadata without applying its defaults to legacy runtime fields.
 * Explicit photometric values are mirrored into canonical names; absent data stays absent.
 */
export function normalizeLuminaireRecord(lightRecord = {}) {
  const record = isObject(lightRecord) ? lightRecord : {};
  const luminaire = resolveLuminaireModel(record);
  const engineering = isObject(record.engineering) ? record.engineering : {};
  const electrical = isObject(record.electrical) ? record.electrical : {};
  const originalPhotometry = isObject(record.photometry) ? record.photometry : {};
  const sources = [originalPhotometry, record, engineering, electrical];
  const requirements = luminaire.photometricRequirements;
  const fields = new Set([
    ...requirements.required,
    ...requirements.optional,
    ...Object.keys(PHOTOMETRY_ALIASES),
  ]);
  const photometry = {};
  for (const field of fields) {
    const names = PHOTOMETRY_ALIASES[field] || [field];
    const value = suppliedValue(sources, names);
    if (value === undefined) continue;
    if (requirements.units[field]) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) photometry[field] = numeric;
    } else {
      photometry[field] = value;
    }
  }
  return {
    ...record,
    luminaire,
    ...(Object.keys(photometry).length
      ? { photometry: { ...originalPhotometry, ...photometry } }
      : {}),
  };
}

export const normalizeLightRecord = normalizeLuminaireRecord;
