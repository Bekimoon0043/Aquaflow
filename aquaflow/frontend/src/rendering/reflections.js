// reflections.js — AquaFlow Stage 3, Priority 4 (AQ-S3-004)
//
// Water-surface reflection maths for the photorealistic renderer: the mirror
// transform across the (horizontal) water plane and the Fresnel reflectance that
// controls how mirror-like the surface looks at a given viewing angle. Pure and
// framework-agnostic so it can be unit-tested and reused by any renderer.

/** Reflect a point across the horizontal water plane y = surfaceY. */
export function reflectPoint(p, surfaceY = 0) {
  return { x: p.x, y: 2 * surfaceY - p.y, z: p.z };
}

/**
 * 4x4 mirror matrix across the plane y = surfaceY, in column-major order
 * (matching THREE.Matrix4.elements). Reflecting a point (x,y,z) gives
 * (x, 2*surfaceY - y, z).
 */
export function reflectionMatrix(surfaceY = 0) {
  return [
    1, 0, 0, 0,
    0, -1, 0, 0,
    0, 0, 1, 0,
    0, 2 * surfaceY, 0, 1,
  ];
}

/**
 * Schlick's Fresnel approximation: how reflective the water is at a given angle.
 * cosTheta is the cosine of the angle between the view ray and the surface
 * normal (1 = looking straight down → mostly transparent; 0 = grazing → mirror).
 * ior defaults to water (1.33).
 */
export function fresnelSchlick(cosTheta, ior = 1.33) {
  const r0 = ((1 - ior) / (1 + ior)) ** 2;
  const c = Math.max(0, Math.min(1, cosTheta));
  return r0 + (1 - r0) * (1 - c) ** 5;
}

/** Reflectance at normal incidence (looking straight down). */
export function normalReflectance(ior = 1.33) {
  return ((1 - ior) / (1 + ior)) ** 2;
}

/** Build a renderer-agnostic reflection config for the water surface. */
export function reflectionConfig({ surfaceY = 0, ior = 1.33, reflectivity = 1.0 } = {}) {
  return {
    surfaceY,
    ior,
    reflectivity: Math.max(0, Math.min(1, reflectivity)),
    matrix: reflectionMatrix(surfaceY),
    normalReflectance: normalReflectance(ior),
    enabled: reflectivity > 0,
  };
}
