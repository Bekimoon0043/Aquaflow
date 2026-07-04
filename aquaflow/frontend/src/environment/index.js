// index.js — AquaFlow Environment & Material Library (AQ-S3-008)
//
// Aggregates the 20 built-in environments + 20 built-in PBR materials with the user's
// custom presets, and turns a material record into a Three.js MeshPhysicalMaterial
// config for the preview / 4K renderer.

import { BUILTIN_ENVIRONMENTS, ENV_PARAM_RANGES, ENV_EDITABLE_FIELDS } from "./environments";
import { BUILTIN_MATERIALS, MATERIAL_PARAM_RANGES, MATERIAL_EDITABLE_FIELDS } from "./materials";
import { listCustomEnvironments, listCustomMaterials } from "./customLibrary";

export * from "./environments";
export * from "./materials";
export * from "./formulas";
export * from "./customLibrary";

export function getBuiltinEnvironments() { return BUILTIN_ENVIRONMENTS; }
export function getBuiltinMaterials() { return BUILTIN_MATERIALS; }

export function getAllEnvironments() {
  return [...BUILTIN_ENVIRONMENTS, ...listCustomEnvironments()];
}
export function getAllMaterials() {
  return [...BUILTIN_MATERIALS, ...listCustomMaterials()];
}
export function getEnvironment(id) {
  return getAllEnvironments().find((e) => e.id === id) || null;
}
export function getMaterial(id) {
  return getAllMaterials().find((m) => m.id === id) || null;
}

// Turn a material record into a Three.js MeshPhysicalMaterial parameter object.
// (MeshPhysicalMaterial supports ior/transmission/clearcoat; reflectivity maps to
// specularIntensity for non-metals.)
export function buildThreeMaterial(mat) {
  if (!mat) return null;
  const transparent = (mat.transmission ?? 0) > 0;
  return {
    color: mat.color ?? "#c8ccd0",
    roughness: mat.roughness ?? 0.5,
    metalness: mat.metalness ?? 0,
    ior: mat.ior ?? 1.5,
    transmission: mat.transmission ?? 0,
    clearcoat: mat.clearcoat ?? 0,
    clearcoatRoughness: Math.min(1, (mat.roughness ?? 0.5) * 0.5),
    specularIntensity: mat.reflectivity ?? 0.5,
    normalScale: mat.normal_intensity ?? 1,
    textureScale: mat.texture_scale ?? 1,
    transparent,
    opacity: transparent ? Math.max(0.05, 1 - (mat.transmission ?? 0) * 0.6) : 1,
  };
}

export const LIBRARY_STATS = {
  builtin_environments: BUILTIN_ENVIRONMENTS.length,
  builtin_materials: BUILTIN_MATERIALS.length,
};

export const RANGES = { environment: ENV_PARAM_RANGES, material: MATERIAL_PARAM_RANGES };
export const EDITABLE_FIELDS = { environment: ENV_EDITABLE_FIELDS, material: MATERIAL_EDITABLE_FIELDS };
