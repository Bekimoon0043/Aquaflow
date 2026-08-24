/**
 * useResizableLayout.js — panel sizes that a drag can change, and that survive a restart.
 *
 * Wraps the pure arithmetic in layoutSizing.js with the React state, the live window
 * clamp and the persistence. Panels read their size from here instead of from the
 * frozen literal the shell used to carry.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PANEL_LIMITS, loadLayout, saveLayout, defaultLayout, nextSize, maxForContainer,
} from "./layoutSizing";

export function useResizableLayout() {
  const [layout, setLayout] = useState(() => loadLayout());
  // Size when the current drag began — deltas are measured from here, not accumulated
  // frame to frame, so a clamped drag cannot drift out of sync with the pointer.
  const dragStart = useRef(null);

  // Persist after the drag settles rather than on every pointer move: a drag fires
  // dozens of updates a second and each write is synchronous.
  const saveTimer = useRef(null);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveLayout(layout), 250);
    return () => clearTimeout(saveTimer.current);
  }, [layout]);

  const beginDrag = useCallback((key) => {
    setLayout(cur => { dragStart.current = { key, size: cur[key] }; return cur; });
  }, []);

  const endDrag = useCallback(() => { dragStart.current = null; }, []);

  /**
   * Apply a pointer delta to one panel.
   *
   * @param {string} key       one of PANEL_LIMITS
   * @param {number} delta     pointer movement in px since the drag began
   * @param {object} opts      { invert, containerPx, otherPanelsPx }
   */
  const resize = useCallback((key, delta, { invert = false, containerPx = 0, otherPanelsPx = 0 } = {}) => {
    const limit = PANEL_LIMITS[key];
    if (!limit) return;
    setLayout(cur => {
      const startSize = dragStart.current?.key === key ? dragStart.current.size : cur[key];
      const max = maxForContainer(key, containerPx, otherPanelsPx);
      const size = nextSize({ startSize, delta, invert, min: limit.min, max });
      if (size === cur[key]) return cur;
      return { ...cur, [key]: size };
    });
  }, []);

  /** Restore one panel to its shipped default (double-click on a handle). */
  const resetPanel = useCallback((key) => {
    const limit = PANEL_LIMITS[key];
    if (!limit) return;
    setLayout(cur => ({ ...cur, [key]: limit.default }));
  }, []);

  /** Restore every panel. */
  const resetAll = useCallback(() => setLayout(defaultLayout()), []);

  return { layout, resize, beginDrag, endDrag, resetPanel, resetAll };
}
