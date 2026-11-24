// Pure geometry for the floating Pattern Preview window (no DOM, no React).
// Conventions follow desktop tool windows: drag by the title bar, resize from any
// edge or corner, snap to the viewport edges, maximize into the host workspace
// (restore returns to the previous rect) and minimize to a title-bar chip.

export const MIN_WIDTH = 280;
export const MIN_HEIGHT = 200;
export const TITLE_HEIGHT = 30;
export const CHIP_WIDTH = 260;
export const MARGIN = 8;
export const TOP_RESERVE = 70; // the app top bar stays reachable
export const BOTTOM_RESERVE = 32; // the status bar stays reachable
export const SNAP_DISTANCE = 16;
export const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const viewportWidth = () => globalThis.innerWidth || 1440;
const viewportHeight = () => globalThis.innerHeight || 900;
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/** Keep a normal (floating) window rect fully inside the app viewport. */
export function clampRect(rect = {}, width = viewportWidth(), height = viewportHeight()) {
  const safe = rect || {};
  const w = Math.max(MIN_WIDTH, Math.min(width - 2 * MARGIN, Number(safe.width) || 360));
  const h = Math.max(MIN_HEIGHT, Math.min(height - TOP_RESERVE - BOTTOM_RESERVE, Number(safe.height) || 240));
  const maxX = Math.max(MARGIN, width - w - MARGIN);
  const maxY = Math.max(TOP_RESERVE, height - h - BOTTOM_RESERVE);
  return {
    width: w,
    height: h,
    x: Math.max(MARGIN, Math.min(maxX, finite(safe.x, width - w - 24))),
    y: Math.max(TOP_RESERVE, Math.min(maxY, finite(safe.y, height - h - 48))),
  };
}

/** Move a rect by a pointer delta (the caller clamps). */
export function moveRect(rect, dx, dy) {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

/** Resize from an edge/corner ('n','se',…); west/north edges keep the opposite edge fixed. */
export function resizeRect(rect, edge, dx, dy) {
  let { x, y, width, height } = rect;
  if (edge.includes('e')) width = Math.max(MIN_WIDTH, width + dx);
  if (edge.includes('s')) height = Math.max(MIN_HEIGHT, height + dy);
  if (edge.includes('w')) { const next = Math.max(MIN_WIDTH, width - dx); x += width - next; width = next; }
  if (edge.includes('n')) { const next = Math.max(MIN_HEIGHT, height - dy); y += height - next; height = next; }
  return { x, y, width, height };
}

/** Snap a rect to the viewport edges when it is released within SNAP_DISTANCE of them. */
export function snapRect(rect, width = viewportWidth(), height = viewportHeight(), distance = SNAP_DISTANCE) {
  let { x, y } = rect;
  if (x - MARGIN < distance) x = MARGIN;
  else if (width - MARGIN - (x + rect.width) < distance) x = width - MARGIN - rect.width;
  if (y - TOP_RESERVE < distance) y = TOP_RESERVE;
  else if (height - BOTTOM_RESERVE - (y + rect.height) < distance) y = height - BOTTOM_RESERVE - rect.height;
  return clampRect({ ...rect, x, y }, width, height);
}

/** The rect a maximized window fills: the host workspace (Show Programming), inside the viewport. */
export function maximizedRect(area, width = viewportWidth(), height = viewportHeight()) {
  const usable = area && area.width > 0 && area.height > 0
    ? area
    : { x: 0, y: TOP_RESERVE - MARGIN, width, height: height - TOP_RESERVE - BOTTOM_RESERVE + MARGIN };
  const x = Math.max(0, usable.x + 4), y = Math.max(0, usable.y + 4);
  return {
    x,
    y,
    width: Math.max(MIN_WIDTH, Math.min(width - x, usable.width - 8)),
    height: Math.max(MIN_HEIGHT, Math.min(height - y, usable.height - 8)),
  };
}

/** A minimized window is a title-bar chip at the window's own position. */
export function minimizedRect(rect, width = viewportWidth(), height = viewportHeight()) {
  const w = Math.min(CHIP_WIDTH, rect.width);
  return {
    width: w,
    height: TITLE_HEIGHT,
    x: Math.max(MARGIN, Math.min(width - w - MARGIN, rect.x)),
    y: Math.max(TOP_RESERVE, Math.min(height - TITLE_HEIGHT - MARGIN, rect.y)),
  };
}

/** The rect to draw for a window mode: 'normal' | 'minimized' | 'maximized'. */
export function displayRect({ mode, rect }, area, width = viewportWidth(), height = viewportHeight()) {
  if (mode === 'maximized') return maximizedRect(area, width, height);
  const floating = clampRect(rect, width, height);
  return mode === 'minimized' ? minimizedRect(floating, width, height) : floating;
}

/**
 * Dragging a maximized window's title bar restores it under the pointer (Windows
 * convention): keep the pointer at the same relative spot of the title bar.
 */
export function restoreUnderPointer(restore, maximized, pointerX, pointerY) {
  const ratio = maximized.width ? (pointerX - maximized.x) / maximized.width : .5;
  return { ...restore, x: pointerX - restore.width * Math.max(0, Math.min(1, ratio)), y: pointerY - TITLE_HEIGHT / 2 };
}

/** Keyboard alternative to dragging (WCAG 2.2 "dragging movements"): arrows move, Shift+arrows resize. */
export function nudgeRect(rect, key, { resize = false, step = 16 } = {}) {
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
  if (!delta) return null;
  return resize ? resizeRect(rect, 'se', delta[0], delta[1]) : moveRect(rect, delta[0], delta[1]);
}
