// index.js — AquaFlow Photorealistic Rendering Engine (AQ-S3-004)
//
// Aggregates the water physics, reflection, and scene-mode modules into one
// renderer-agnostic engine. `buildRenderConfig` turns a designed scene (mode +
// jets + water surface) into a complete render description that the FountainScene
// (or any renderer) consumes:
//   * water physics — per-jet trajectory (apex height, time of flight),
//   * reflections — the water-surface mirror + Fresnel config,
//   * night scenes — the environment lighting/atmosphere preset.

import {
  GRAVITY, jetLaunchSpeed, apexHeight, timeOfFlight, launchVelocity,
  dropletPosition, simulateJet,
} from "./waterPhysics";
import {
  reflectPoint, reflectionMatrix, fresnelSchlick, normalReflectance, reflectionConfig,
} from "./reflections";
import {
  ENVIRONMENTS, SCENE_MODES, NIGHT_SCENE_NAMES, getSceneMode, isNightScene,
  TONE_MAPPING, DEFAULT_TONE_MAPPING, getToneMapping, threeToneMapping, calibratedExposure,
} from "./sceneModes";

export {
  // water physics
  GRAVITY, jetLaunchSpeed, apexHeight, timeOfFlight, launchVelocity,
  dropletPosition, simulateJet,
  // reflections
  reflectPoint, reflectionMatrix, fresnelSchlick, normalReflectance, reflectionConfig,
  // scene modes
  ENVIRONMENTS, SCENE_MODES, NIGHT_SCENE_NAMES, getSceneMode, isNightScene,
  TONE_MAPPING, DEFAULT_TONE_MAPPING, getToneMapping, threeToneMapping, calibratedExposure,
};

export const RENDER_ENGINE_VERSION = "1.0.0";

/**
 * Build a complete, renderer-agnostic render configuration.
 *
 * @param {object} opts
 * @param {string} opts.mode      scene mode name (night|day|dusk|arena)
 * @param {Array}  opts.jets      [{id, origin:{x,y,z}, speed?, heightM?, tiltXDeg?, tiltZDeg?}]
 * @param {number} opts.surfaceY  water surface height
 * @param {number} opts.ior       index of refraction (water 1.33)
 */
export function buildRenderConfig({ mode = "night", jets = [], surfaceY = 0, ior = 1.33 } = {}) {
  const sceneMode = getSceneMode(mode);
  const reflection = reflectionConfig({ surfaceY, ior });

  const jetConfigs = (jets || []).map((j, i) => {
    const origin = j.origin || { x: 0, y: surfaceY, z: 0 };
    const speed = j.speed != null ? j.speed : jetLaunchSpeed(j.heightM != null ? j.heightM : 3);
    const { vy } = launchVelocity(speed, j.tiltXDeg || 0, j.tiltZDeg || 0);
    return {
      id: j.id != null ? j.id : `jet-${i}`,
      origin,
      speed,
      apexHeight: apexHeight(speed),
      apexY: origin.y + apexHeight(vy),
      timeOfFlight: timeOfFlight(vy),
      tiltXDeg: j.tiltXDeg || 0,
      tiltZDeg: j.tiltZDeg || 0,
    };
  });

  return {
    version: RENDER_ENGINE_VERSION,
    mode: sceneMode,
    isNight: !!sceneMode.isNight,
    reflection,
    water: { gravity: GRAVITY, jets: jetConfigs },
  };
}

export default { buildRenderConfig, RENDER_ENGINE_VERSION };
