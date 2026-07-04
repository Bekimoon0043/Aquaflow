// formulas.js — AquaFlow Environment/Material physics (AQ-S3-008)
//
// Pure formulas from the research spec used by the render pipeline: water reflection
// (Fresnel), wind ripple amplitude, mist visibility, light attenuation — plus the
// hard limits (wind cutoff, reflection budget, HDR/texture resolution, FPS targets).

// ── Hard limits ────────────────────────────────────────────────────────────────
export const WIND_HARD_LIMIT_MPS = 25;
export const REALTIME_REFLECTION_BUDGET = 8;     // beyond → fall back to a cubemap
export const HDR_RESOLUTIONS = {
  default: [2048, 1024], max: [4096, 2048], offline: [8192, 4096],
};
export const TEXTURE_RESOLUTIONS = { realtime: [512, 1024, 2048], offline: [4096, 8192] };
export const FPS_TARGETS = { realtime: 60, offline: 15, export_4k: 1 };

// ── Fresnel / water reflection ──────────────────────────────────────────────────
// Schlick approximation: F = F0 + (1-F0)(1-cosθ)^5.
export function fresnel(f0, thetaDeg) {
  const cos = Math.cos((thetaDeg * Math.PI) / 180);
  return f0 + (1 - f0) * Math.pow(1 - cos, 5);
}

// Reflection = Reflectivity × Fresnel.
export function waterReflectionIntensity(reflectivity, f0, thetaDeg) {
  return reflectivity * fresnel(f0, thetaDeg);
}

// ── Wind ripple ─────────────────────────────────────────────────────────────────
// RippleAmplitude_mm = WindSpeed_mps × 1.5.
export function windRippleAmplitudeMm(windMps) {
  return Math.max(0, windMps) * 1.5;
}

// Effects disabled at/above the wind hard limit (mist, laminar, fine jets).
export function disabledEffectsForWind(windMps) {
  return windMps >= WIND_HARD_LIMIT_MPS ? ["mist", "laminar", "fine_jets"] : [];
}

// ── Mist visibility ───────────────────────────────────────────────────────────
// VisibilityFactor = exp(-fog_density × distance).
export function mistVisibilityFactor(fogDensity, distanceM) {
  return Math.exp(-Math.max(0, fogDensity) * Math.max(0, distanceM));
}

// ── Light attenuation ───────────────────────────────────────────────────────────
// Intensity = I0 / distance². (distance floored at 1 m to avoid a singularity.)
export function lightAttenuation(i0, distanceM) {
  const d = Math.max(1, distanceM);
  return i0 / (d * d);
}

// Choose the reflection technique given how many reflective surfaces are on screen.
export function reflectionMode(reflectiveSurfaceCount) {
  return reflectiveSurfaceCount > REALTIME_REFLECTION_BUDGET ? "cubemap" : "realtime";
}
