/**
 * layoutSizing.js — the arithmetic behind drag-to-resize panels.
 *
 * AquaFlow's shell had its panel sizes frozen in a `useState` with no setter:
 * left 260px, right 300px, timeline 280px, forever. On a small screen the centre is
 * squeezed; on a large one the panels waste space. This module is the rule layer that
 * lets a drag change them.
 *
 * Pure — no React, no DOM — so the clamping, direction handling and persistence
 * validation are unit-testable, the same discipline as jetPhysics.js and splashMap.js.
 * Nothing here touches presentation: sizes only.
 */

/** Storage key for the persisted layout. */
export const LAYOUT_STORAGE_KEY = "aquaflow.layout.v1";

/**
 * Panel size limits, in pixels.
 *
 * `min` keeps a panel usable rather than letting it be dragged to a sliver that is then
 * impossible to grab again. `max` is a ceiling; the live clamp against the window is
 * applied separately by `maxForContainer`, because what actually matters is leaving the
 * centre workspace usable, and that depends on the window size at drag time.
 */
export const PANEL_LIMITS = {
  leftWidth:       { min: 150, max: 700, default: 260, minCenter: 260 },
  rightWidth:      { min: 180, max: 760, default: 300, minCenter: 260 },
  timelineHeight:  { min: 90,  max: 900, default: 280, minCenter: 180 },
  // The preview sidebar divides a NESTED container, not the whole shell. Reserving the
  // full 260px there meant that in a narrow window the 3D canvas already occupied
  // everything the reserve allowed, so the sidebar was pinned at its minimum and simply
  // refused to grow — which reads as a broken handle rather than a deliberate limit.
  previewSidebar:  { min: 150, max: 560, default: 200, minCenter: 180 },
};

/** Default reserve for the centre workspace, in px, when a panel does not set its own. */
export const MIN_CENTER_PX = 260;

export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * The largest this panel may be given the current container size, so a drag can never
 * collapse the centre. `otherPanels` is the total px already taken by sibling panels on
 * the same axis.
 */
export function maxForContainer(key, containerPx, otherPanelsPx = 0) {
  const limit = PANEL_LIMITS[key];
  if (!limit) return Infinity;
  if (!Number.isFinite(containerPx) || containerPx <= 0) return limit.max;
  const room = containerPx - otherPanelsPx - (limit.minCenter ?? MIN_CENTER_PX);
  // Never return below `min`: a window too small to satisfy everyone should still let
  // the panel exist at its minimum rather than produce an inverted range.
  return Math.max(limit.min, Math.min(limit.max, room));
}

/**
 * Resolve a drag into a new panel size.
 *
 * `invert` is what makes a handle on a panel's LEADING edge behave correctly: dragging
 * right must shrink a right-docked panel and grow a left-docked one. Getting this wrong
 * is the classic splitter bug where one side moves backwards.
 *
 * @param {object} opts
 * @param {number} opts.startSize size when the drag began
 * @param {number} opts.delta     pointer movement along the axis, px
 * @param {boolean} opts.invert   true when the handle sits on the panel's leading edge
 * @param {number} opts.min
 * @param {number} opts.max
 */
export function nextSize({ startSize, delta, invert = false, min = 0, max = Infinity }) {
  const raw = (Number.isFinite(startSize) ? startSize : min) + (invert ? -(delta || 0) : (delta || 0));
  return clamp(raw, min, max);
}

/** The default layout, used on first run and by "reset". */
export function defaultLayout() {
  return {
    leftWidth: PANEL_LIMITS.leftWidth.default,
    rightWidth: PANEL_LIMITS.rightWidth.default,
    timelineHeight: PANEL_LIMITS.timelineHeight.default,
    previewSidebar: PANEL_LIMITS.previewSidebar.default,
  };
}

/**
 * Validate and repair a stored layout.
 *
 * A layout read from storage is untrusted input: it may be from an older version, a
 * different screen, or hand-edited. Every field is clamped into range and anything
 * unrecognised is dropped, so a bad value can never wedge the UI into an unusable shape
 * that the user then cannot drag their way out of.
 */
export function sanitizeLayout(raw) {
  const out = defaultLayout();
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(out)) {
    const limit = PANEL_LIMITS[key];
    const v = raw[key];
    if (Number.isFinite(v)) out[key] = clamp(v, limit.min, limit.max);
  }
  return out;
}

/**
 * Load the persisted layout. Returns defaults when storage is unavailable (private
 * window, disabled site data) or the payload is unusable — never throws, because a
 * layout preference is not worth breaking the app over.
 */
export function loadLayout(storage) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return defaultLayout();
    const text = store.getItem(LAYOUT_STORAGE_KEY);
    if (!text) return defaultLayout();
    return sanitizeLayout(JSON.parse(text));
  } catch {
    return defaultLayout();
  }
}

/** Persist the layout. Silently does nothing if storage is unavailable. */
export function saveLayout(layout, storage) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return false;
    store.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(sanitizeLayout(layout)));
    return true;
  } catch {
    return false;
  }
}
