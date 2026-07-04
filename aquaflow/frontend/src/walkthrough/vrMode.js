// vrMode.js — AquaFlow Stage 3, Priority 6 (AQ-S3-006)
//
// WebXR VR capability detection and session configuration for the walkthrough.
// Pure helpers (a navigator is injectable) so they can be unit-tested without a
// real headset; the FountainScene uses these to request an immersive-vr session.

export const VR_STATE = Object.freeze({
  UNSUPPORTED: "unsupported",
  READY: "ready",
  ACTIVE: "active",
});

/** True if the runtime exposes the WebXR Device API. */
export function isWebXRAvailable(nav = (typeof navigator !== "undefined" ? navigator : undefined)) {
  return !!(nav && nav.xr);
}

/** Resolve whether an immersive-vr session is supported (async). */
export async function isVRSupported(nav = (typeof navigator !== "undefined" ? navigator : undefined)) {
  if (!isWebXRAvailable(nav)) return false;
  try {
    return !!(await nav.xr.isSessionSupported("immersive-vr"));
  } catch (e) {
    return false;
  }
}

/** Reference space used for room-scale walkthrough. */
export function vrReferenceSpaceType() {
  return "local-floor";
}

/** Session request options for an immersive-vr walkthrough. */
export function vrSessionOptions() {
  return {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["bounded-floor", "hand-tracking", "layers"],
  };
}

/** Compute the current VR state from a navigator + active-session flag. */
export async function vrState(nav, active = false) {
  if (active) return VR_STATE.ACTIVE;
  return (await isVRSupported(nav)) ? VR_STATE.READY : VR_STATE.UNSUPPORTED;
}
