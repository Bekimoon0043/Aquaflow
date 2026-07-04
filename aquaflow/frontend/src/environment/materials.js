// materials.js — AquaFlow Material Library (AQ-S3-008)
//
// 20 built-in physically-based (PBR) materials for the preview + 4K renderer, each
// with the Three.js MeshPhysicalMaterial constants from the AQ-S3-008 research spec
// (roughness, metalness, ior, transmission, clearcoat, reflectivity) plus the
// customisation fields (normal_intensity, texture_scale) and a base colour.

// Editable/validated parameter ranges (min, max, default).
export const MATERIAL_PARAM_RANGES = {
  roughness:        { min: 0,    max: 1,   default: 0.5 },
  metalness:        { min: 0,    max: 1,   default: 0 },
  ior:              { min: 1,    max: 3,   default: 1.5 },
  transmission:     { min: 0,    max: 1,   default: 0 },
  clearcoat:        { min: 0,    max: 1,   default: 0 },
  reflectivity:     { min: 0,    max: 1,   default: 0.5 },
  normal_intensity: { min: 0,    max: 4,   default: 1 },
  texture_scale:    { min: 0.1,  max: 20,  default: 1 },
};

function mat(id, name, p) {
  return {
    id, name, builtin: true,
    color: p.color ?? "#c8ccd0",
    roughness: p.roughness, metalness: p.metalness, ior: p.ior ?? 1.5,
    transmission: p.transmission ?? 0, clearcoat: p.clearcoat ?? 0,
    reflectivity: p.reflectivity ?? 0.5,
    normal_intensity: p.normal_intensity ?? 1, texture_scale: p.texture_scale ?? 1,
  };
}

// Built-in materials MAT001–MAT020 (matches the research required list).
export const BUILTIN_MATERIALS = [
  mat("MAT001", "Stainless Steel Polished", { color: "#d8dade", roughness: 0.05, metalness: 1.0, clearcoat: 0.90, reflectivity: 0.95, ior: 2.50 }),
  mat("MAT002", "Stainless Steel Brushed",  { color: "#c9ccd1", roughness: 0.25, metalness: 1.0, clearcoat: 0.35, reflectivity: 0.75, ior: 2.50 }),
  mat("MAT003", "Stainless Steel Satin",    { color: "#c2c5cb", roughness: 0.40, metalness: 1.0, clearcoat: 0.20, reflectivity: 0.65, ior: 2.50 }),
  mat("MAT004", "Powder Coated Black Steel",{ color: "#1b1d20", roughness: 0.55, metalness: 0.0, clearcoat: 0.30, reflectivity: 0.25, ior: 1.50 }),
  mat("MAT005", "Powder Coated White Steel",{ color: "#eef0f2", roughness: 0.55, metalness: 0.0, clearcoat: 0.30, reflectivity: 0.25, ior: 1.50 }),
  mat("MAT006", "Aluminum Brushed",         { color: "#c6c8cb", roughness: 0.30, metalness: 1.0, clearcoat: 0.15, reflectivity: 0.70, ior: 1.50 }),
  mat("MAT007", "Aluminum Polished",        { color: "#d2d4d7", roughness: 0.08, metalness: 1.0, clearcoat: 0.20, reflectivity: 0.90, ior: 1.50 }),
  mat("MAT008", "Brass Polished",           { color: "#c8a94e", roughness: 0.10, metalness: 1.0, clearcoat: 0.30, reflectivity: 0.85, ior: 1.50 }),
  mat("MAT009", "Bronze",                   { color: "#8c6b3f", roughness: 0.35, metalness: 1.0, clearcoat: 0.10, reflectivity: 0.70, ior: 1.50 }),
  mat("MAT010", "Granite Dark",             { color: "#2c2e33", roughness: 0.85, metalness: 0.0, reflectivity: 0.12, ior: 1.55 }),
  mat("MAT011", "Granite Light",            { color: "#b9b6ad", roughness: 0.80, metalness: 0.0, reflectivity: 0.14, ior: 1.55 }),
  mat("MAT012", "Marble White",             { color: "#efeee9", roughness: 0.30, metalness: 0.0, clearcoat: 0.20, reflectivity: 0.25, ior: 1.50 }),
  mat("MAT013", "Marble Black",             { color: "#17181a", roughness: 0.28, metalness: 0.0, clearcoat: 0.25, reflectivity: 0.28, ior: 1.50 }),
  mat("MAT014", "Concrete Smooth",          { color: "#8f9094", roughness: 0.70, metalness: 0.0, reflectivity: 0.15, ior: 1.50 }),
  mat("MAT015", "Concrete Exposed",         { color: "#83858a", roughness: 0.90, metalness: 0.0, reflectivity: 0.10, ior: 1.50 }),
  mat("MAT016", "Wet Concrete",             { color: "#6f7176", roughness: 0.35, metalness: 0.0, clearcoat: 0.30, reflectivity: 0.30, ior: 1.50 }),
  mat("MAT017", "Glass Clear",              { color: "#eaf6ff", roughness: 0.02, metalness: 0.0, transmission: 1.00, reflectivity: 0.90, ior: 1.52 }),
  mat("MAT018", "Glass Frosted",            { color: "#e6eef5", roughness: 0.35, metalness: 0.0, transmission: 0.85, reflectivity: 0.60, ior: 1.52 }),
  mat("MAT019", "Water Surface",            { color: "#2b6c8f", roughness: 0.01, metalness: 0.0, transmission: 1.00, reflectivity: 0.98, ior: 1.333 }),
  mat("MAT020", "Pool Tile Ceramic",        { color: "#3aa6c0", roughness: 0.20, metalness: 0.0, clearcoat: 0.50, reflectivity: 0.40, ior: 1.50 }),
];

export const MATERIAL_EDITABLE_FIELDS = [
  "name", "color", "roughness", "metalness", "reflectivity", "clearcoat",
  "ior", "transmission", "normal_intensity", "texture_scale",
];
