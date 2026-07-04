// index.js — AquaFlow VR Walkthrough Engine (AQ-S3-006)
//
// Aggregates navigation, VR (WebXR), and client-presentation modes into one
// walkthrough engine consumed by the 3D preview.

import {
  NAV_MODES, headingVectors, clampToBounds, firstPersonStep,
  pathLength, waypointPath, lookAtYaw,
} from "./navigation";
import {
  VR_STATE, isWebXRAvailable, isVRSupported, vrReferenceSpaceType,
  vrSessionOptions, vrState,
} from "./vrMode";
import {
  DEFAULT_TOUR, buildTour, tourTotalDuration, tourStepAt, presentationConfig,
} from "./presentationMode";

export {
  // navigation
  NAV_MODES, headingVectors, clampToBounds, firstPersonStep,
  pathLength, waypointPath, lookAtYaw,
  // vr
  VR_STATE, isWebXRAvailable, isVRSupported, vrReferenceSpaceType,
  vrSessionOptions, vrState,
  // presentation
  DEFAULT_TOUR, buildTour, tourTotalDuration, tourStepAt, presentationConfig,
};

export const WALKTHROUGH_VERSION = "1.0.0";

/**
 * Build a walkthrough controller descriptor. This is renderer-agnostic state; the
 * preview binds it to the actual camera / WebGL renderer.
 *
 * @param {object} opts
 * @param {string} opts.mode       nav mode (walk|orbit|fly|tour|top|front)
 * @param {Array}  opts.waypoints  tour/path waypoints [{x,y,z}]
 * @param {object} opts.bounds     movement bounds box
 * @param {Array}  opts.tour       presentation steps (defaults to DEFAULT_TOUR)
 */
export function createWalkthrough({ mode = NAV_MODES.ORBIT, waypoints = [], bounds = null, tour = null } = {}) {
  const presentationTour = buildTour(tour);
  return {
    version: WALKTHROUGH_VERSION,
    mode: Object.values(NAV_MODES).includes(mode) ? mode : NAV_MODES.ORBIT,
    bounds,
    waypoints,
    navModes: NAV_MODES,
    // Sample the tour/path position at t ∈ [0,1].
    positionAt: (t) => waypointPath(waypoints, t),
    pathLength: () => pathLength(waypoints),
    // Presentation
    tour: presentationTour,
    tourDuration: tourTotalDuration(presentationTour),
    stepAt: (elapsed, o) => tourStepAt(presentationTour, elapsed, o),
    presentation: presentationConfig(),
    // VR capability (async)
    vrSupported: () => isVRSupported(),
    webXRAvailable: () => isWebXRAvailable(),
  };
}

export default { createWalkthrough, WALKTHROUGH_VERSION };
