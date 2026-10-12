/**
 * Bounded, snapshot-based history for the editable 3D scene graph.
 *
 * A fountain scene is small (usually tens or hundreds of nodes), so immutable graph
 * snapshots are safer here than a collection of partially reversible mutation commands.
 * Gizmo movement is checkpointed once at drag start; typed properties can coalesce.
 */

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export class SceneHistory {
  constructor(graph, { limit = 100, coalesceMs = 750, onChange = null } = {}) {
    this.graph = graph;
    this.limit = Math.max(1, Number(limit) || 100);
    this.coalesceMs = Math.max(0, Number(coalesceMs) || 0);
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
    this._lastCoalesceKey = null;
    this._lastCheckpointAt = 0;
  }

  _snapshot(label = "Edit") {
    return {
      label,
      graph: clone(this.graph.toJSON()),
      selection: [...this.graph.selected()],
    };
  }

  _changed() { this.onChange?.(this.state()); }

  state() {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label || null,
      redoLabel: this.redoStack.at(-1)?.label || null,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    };
  }

  checkpoint(label = "Edit", { coalesceKey = null, now = Date.now() } = {}) {
    const canCoalesce = coalesceKey
      && this._lastCoalesceKey === coalesceKey
      && now - this._lastCheckpointAt <= this.coalesceMs
      && this.undoStack.length > 0;
    if (!canCoalesce) {
      this.undoStack.push(this._snapshot(label));
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
    this._lastCoalesceKey = coalesceKey;
    this._lastCheckpointAt = now;
    this._changed();
    return !canCoalesce;
  }

  _restore(entry, reason) {
    if (!entry) return false;
    this.graph.replaceFromJSON(entry.graph, { selection: entry.selection, reason });
    return true;
  }

  undo() {
    const target = this.undoStack.pop();
    if (!target) return false;
    this.redoStack.push(this._snapshot(target.label));
    this._lastCoalesceKey = null;
    this._restore(target, "history");
    this._changed();
    return true;
  }

  redo() {
    const target = this.redoStack.pop();
    if (!target) return false;
    this.undoStack.push(this._snapshot(target.label));
    this._lastCoalesceKey = null;
    this._restore(target, "history");
    this._changed();
    return true;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this._lastCoalesceKey = null;
    this._lastCheckpointAt = 0;
    this._changed();
  }
}
