/**
 * sharedSceneHistory.js — AF-CAD-031: the 3D scene editor's undo, backed by the SAME
 * command history as the 2D Engineering Designer (engineering/drafting/commands.js).
 *
 * It implements the SceneHistory surface the editor already calls (checkpoint / undo /
 * redo / clear / state), but never snapshots the graph:
 *   - checkpoint(label) opens a gesture (a gizmo drag, a duplicate, a typed transform —
 *     typed edits to the same node within `coalesceMs` stay one gesture);
 *   - the host reports each publish of graph → engineering store with
 *     recordPublish(before, after); every publish inside one gesture coalesces into ONE
 *     JSON-delta transaction;
 *   - undo()/redo() apply the inverse/forward deltas to the engineering store (via
 *     `applyPatch`); the store → graph reconcile then updates the viewport, and the 2D
 *     designer adopts the same change, so either editor can undo the other's edits.
 * clear() is a no-op: the shared history is only cleared when a project is loaded.
 */
import { sharedDraftingHistory } from "../../../engineering/drafting/commands";

export class SharedSceneHistory {
  constructor({ history = sharedDraftingHistory, getPresent, applyPatch, flush = null, coalesceMs = 750, onChange = null } = {}) {
    this.history = history;
    this.getPresent = getPresent || (() => ({}));
    this.applyPatch = applyPatch || (() => {});
    this.flush = flush;
    this.coalesceMs = coalesceMs;
    this.onChange = onChange;
    this.gestureSeq = 0;
    this.label = null;
    this._lastKey = null;
    this._lastAt = 0;
    this._off = history.subscribe(() => this.onChange?.(this.state()));
  }

  setOnChange(fn) { this.onChange = fn; }

  get gestureKey() { return `3d:${this.gestureSeq}`; }

  state() { return this.history.state(); }

  checkpoint(label = "Edit", { coalesceKey = null, now = Date.now() } = {}) {
    const canCoalesce = coalesceKey && this._lastKey === coalesceKey && now - this._lastAt <= this.coalesceMs;
    if (!canCoalesce) this.gestureSeq += 1;
    this.label = label;
    this._lastKey = coalesceKey;
    this._lastAt = now;
    return !canCoalesce;
  }

  /** Record one graph → store publish as (part of) the current gesture. */
  recordPublish(before, after, { label = null } = {}) {
    return this.history.record({ label: label || this.label || "3D edit", source: "3d", before, after, coalesceKey: this.gestureKey });
  }

  _run(direction) {
    this.flush?.();
    const result = direction === "undo" ? this.history.undo(this.getPresent()) : this.history.redo(this.getPresent());
    if (!result) return false;
    this.gestureSeq += 1; // the next edit never coalesces into an undone/redone step
    this.applyPatch(result.patch, result.tx);
    return true;
  }

  undo() { return this._run("undo"); }
  redo() { return this._run("redo"); }

  clear() { this._lastKey = null; this._lastAt = 0; }

  dispose() { this._off?.(); }
}
