/**
 * drafting/useDraftingHistory.js — AF-CAD-031: binds the 2D designer's React state to the
 * shared command history (commands.js).
 *
 * The designer keeps its many useState fields; this hook turns their changes into JSON
 * delta transactions instead of the old 80-entry structuredClone snapshot stack:
 *   - changes settle for `debounceMs` (220 ms, as before) and are then recorded as ONE
 *     transaction diffed against the last committed state (the "base");
 *   - `beginGesture()` / `endGesture()` bracket a pointer gesture (a drag, a multi-move):
 *     nothing is committed until the gesture ends, however long it lasts;
 *   - `mark(label)` (the old pushUndo) closes the pending transaction so the next action
 *     becomes its own step, and names it;
 *   - `rebase(partial)` adopts a change that was recorded elsewhere (the 3D editor) without
 *     recording it again.
 * Undo/redo apply the inverse/forward deltas to the present state and hand the host only
 * the fields that changed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { sharedDraftingHistory } from "./commands";

export function useDraftingHistory({ snapshot, apply, history = sharedDraftingHistory, keys = null, debounceMs = 220, getExternal = () => ({}) }) {
  const baseRef = useRef(snapshot);
  const latestRef = useRef(snapshot);
  latestRef.current = snapshot;
  const timerRef = useRef(null);
  const gestureRef = useRef(0);
  const labelRef = useRef(null);
  const absorbRef = useRef(false);
  const [, setVersion] = useState(0);

  useEffect(() => history.subscribe(() => setVersion((v) => v + 1)), [history]);

  const commit = useCallback(() => {
    clearTimeout(timerRef.current);
    const next = latestRef.current;
    const before = baseRef.current;
    if (before !== next) {
      history.record({ label: labelRef.current, source: "2d", before, after: next, keys: keys || Object.keys(next) });
      baseRef.current = next;
    }
    labelRef.current = null;
  }, [history, keys]);

  // Auto-commit once edits settle (and never in the middle of a gesture).
  useEffect(() => {
    if (absorbRef.current) {
      // The first render after a project load (basins composed, layers merged …) is the
      // new baseline, not an undoable user edit.
      absorbRef.current = false;
      baseRef.current = snapshot;
      return undefined;
    }
    if (gestureRef.current > 0) return undefined;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(commit, debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [snapshot, commit, debounceMs]);

  const mark = useCallback((label = null) => {
    commit();
    labelRef.current = label;
  }, [commit]);

  const beginGesture = useCallback((label = null) => {
    if (gestureRef.current === 0) { commit(); labelRef.current = label; }
    gestureRef.current += 1;
  }, [commit]);

  const endGesture = useCallback(() => {
    if (gestureRef.current === 0) return;
    gestureRef.current -= 1;
    if (gestureRef.current === 0) {
      clearTimeout(timerRef.current);
      // Let the last pointer-move render land before diffing.
      timerRef.current = setTimeout(commit, 0);
    }
  }, [commit]);

  const run = useCallback((direction) => {
    gestureRef.current = 0;
    commit();
    const present = { ...getExternal(), ...latestRef.current };
    const result = direction === "undo" ? history.undo(present) : history.redo(present);
    if (!result) return null;
    baseRef.current = { ...latestRef.current, ...pick(result.patch, Object.keys(latestRef.current)) };
    apply(result.patch, result.tx, direction);
    return result;
  }, [apply, commit, getExternal, history]);

  const undo = useCallback(() => run("undo"), [run]);
  const redo = useCallback(() => run("redo"), [run]);

  const rebase = useCallback((partial) => {
    baseRef.current = { ...baseRef.current, ...partial };
  }, []);

  const reset = useCallback((doc, { clear = true } = {}) => {
    clearTimeout(timerRef.current);
    gestureRef.current = 0;
    baseRef.current = doc;
    latestRef.current = doc;
    absorbRef.current = true;
    if (clear) history.clear("load");
  }, [history]);

  return {
    history, undo, redo, mark, beginGesture, endGesture, rebase, reset, commit,
    canUndo: history.canUndo(), canRedo: history.canRedo(), state: history.state(),
  };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}
