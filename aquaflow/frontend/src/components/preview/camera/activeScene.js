// The 3D preview scene currently on screen, so panels outside the preview (the show timeline's
// Camera lane) can read and set the view without owning the scene.
let current = null;
const listeners = new Set();

export function setActiveScene(scene) {
  current = scene || null;
  listeners.forEach((fn) => fn(current));
}

export function clearActiveScene(scene) {
  if (current === scene) setActiveScene(null);
}

export const getActiveScene = () => current;

export function subscribeActiveScene(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
