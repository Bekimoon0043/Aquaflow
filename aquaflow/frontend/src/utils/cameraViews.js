/**
 * cameraViews.js — AF-NEXT-002 minimal named camera views.
 *
 * A project may carry saved viewpoints in its render settings:
 *
 *   render.cameraViews      = [{ id, name, position: {x,y,z}, target: {x,y,z}, note? }]
 *   render.activeCameraView = "<id>"   (applied when render.cameraMode === "named")
 *
 * Coordinates are 3D WORLD metres per engineering/geometryContract.js: the pool is
 * centred on the origin, +Y is up and world z === engineering y − poolCenter.cy.
 * Views therefore survive moving the whole design and need no per-PC data.
 *
 * Pure helpers only; FountainScene.setNamedView() applies a resolved view.
 */

export const NAMED_CAMERA_MODE = "named";

const finite = (value) => Number.isFinite(Number(value));
const vec = (value) => (
  value && finite(value.x) && finite(value.y) && finite(value.z)
    ? { x: Number(value.x), y: Number(value.y), z: Number(value.z) }
    : null
);

/** Keep only well-formed views (unique id, finite position and target). */
export function normalizeCameraViews(views) {
  if (!Array.isArray(views)) return [];
  const seen = new Set();
  const out = [];
  for (const view of views) {
    const id = view && typeof view.id === "string" ? view.id.trim() : "";
    const position = vec(view?.position);
    const target = vec(view?.target);
    if (!id || seen.has(id) || !position || !target) continue;
    seen.add(id);
    out.push({ id, name: String(view.name || id), position, target, ...(view.note ? { note: String(view.note) } : {}) });
  }
  return out;
}

/** The view a render-settings object asks for, or null. */
export function resolveCameraView(render = {}, id = render?.activeCameraView) {
  const views = normalizeCameraViews(render?.cameraViews);
  return views.find((view) => view.id === id) || null;
}
