/**
 * editorSnapping.js — the interaction rules of a 3D editor.
 *
 * AquaFlow's 3D view was a render you could only orbit. Depence R4's is a workspace you
 * build in, and the difference is not the picture — it is that every object can be
 * picked up, constrained, snapped and given exact numbers. This module is the rule
 * layer for that: what a drag becomes once modifier keys are applied.
 *
 * The constants match Depence's documented behaviour deliberately. A designer moving
 * between the two tools should not have to relearn their hands:
 *
 *   SHIFT + move    → snap to a 10 cm grid
 *   SHIFT + rotate  → snap to a 5° raster
 *   SHIFT (CAD view)→ lock the translation to the dominant axis
 *   CTRL  + drag    → duplicate while moving
 *   ALT             → suspend snapping for free placement
 *
 * Kept pure — no three.js, no DOM — so the rules are unit-testable and have exactly one
 * definition, the same discipline as jetPhysics.js and splashMap.js.
 *
 * AF-CAD-032: the grid rounding and object snapping now come from the ONE drafting snap
 * engine (engineering/drafting/snap.js) shared with the 2D designer and pipe drawing.
 * Ground-plane moves acquire Endpoint/Port/Intersection/Midpoint/Center/Insertion/
 * Perpendicular/Nearest candidates inside a ~10 px aperture (when the editor supplies an
 * `osnap` context); SHIFT still means "grid", ALT still suspends all snapping.
 */
import { snapGridValue, findSnap } from "../../../engineering/drafting/snap";

/** Translation grid, metres. Depence snaps to 10 cm. */
export const GRID_SNAP_M = 0.10;
/** Rotation raster, degrees. Depence snaps to 5°. */
export const ANGLE_SNAP_DEG = 5;

export const TOOLS = {
  SELECT: "select",
  MOVE: "move",
  ROTATE: "rotate",
  SCALE: "scale",
};

/** ESC always drops the current tool and returns to Move, as in Depence. */
export const DEFAULT_TOOL = TOOLS.MOVE;

/**
 * Normalise a raw pointer/keyboard event into the modifier state the rules use.
 * Accepts anything with shiftKey/ctrlKey/altKey/metaKey (a real event or a plain object).
 */
export function readModifiers(e) {
  return {
    // Meta stands in for Ctrl on macOS so the duplicate gesture works on both.
    snap: !!(e && e.shiftKey),
    duplicate: !!(e && (e.ctrlKey || e.metaKey)),
    freeform: !!(e && e.altKey),
  };
}

/**
 * Should snapping apply? SHIFT asks for it, ALT overrides and suspends it.
 * ALT winning is what lets a designer place one fixture off-grid without changing a mode.
 */
export function snapActive(mods) {
  if (!mods) return false;
  return !!mods.snap && !mods.freeform;
}

/** Round a scalar to the nearest multiple of `step`. */
export function snapScalar(value, step = GRID_SNAP_M) {
  return snapGridValue(value, step);
}

/**
 * AF-CAD-032 object snap for a ground-plane position. `osnap` = { scene, worldPerPx,
 * aperturePx?, toPlan(pos)->{x,y}, toWorld({x,y})->{x,z} } built by the scene editor from
 * the engineering design. Returns the snapped position (y kept) and the snap, or null.
 */
export function objectSnapPosition(pos, osnap) {
  if (!pos || !osnap?.scene || typeof osnap.toPlan !== "function" || typeof osnap.toWorld !== "function") return null;
  const hit = findSnap(osnap.toPlan(pos), osnap.scene, { worldPerPx: osnap.worldPerPx || 0.01, aperturePx: osnap.aperturePx || 10 });
  if (!hit?.mode) return null;
  const w = osnap.toWorld({ x: hit.x, y: hit.y });
  return { position: { x: w.x, y: pos.y, z: w.z }, snap: hit };
}

/**
 * Snap a translation to the grid. Operates on absolute position, not on the delta,
 * so a dragged object lands ON grid lines rather than merely moving in grid-sized steps
 * from wherever it happened to start.
 */
export function snapTranslation(pos, mods, step = GRID_SNAP_M) {
  if (!pos) return pos;
  if (!snapActive(mods)) return { ...pos };
  return {
    x: snapScalar(pos.x, step),
    y: snapScalar(pos.y, step),
    z: snapScalar(pos.z, step),
  };
}

/** Snap an angle in degrees to the rotation raster. */
export function snapAngleDeg(deg, mods, step = ANGLE_SNAP_DEG) {
  if (!Number.isFinite(deg)) return deg;
  if (!snapActive(mods)) return deg;
  return snapScalar(deg, step);
}

/**
 * Axis lock: in an orthographic/CAD view, SHIFT constrains a drag to whichever axis
 * the pointer has travelled furthest along, so a designer can slide a fixture along one
 * axis without drifting on the other.
 *
 * @param {{x:number,y:number,z:number}} delta the unconstrained movement
 * @returns {{x:number,y:number,z:number}} the movement with off-axis components zeroed
 */
export function lockDominantAxis(delta) {
  if (!delta) return delta;
  const ax = Math.abs(delta.x || 0);
  const ay = Math.abs(delta.y || 0);
  const az = Math.abs(delta.z || 0);
  const max = Math.max(ax, ay, az);
  if (max === 0) return { x: 0, y: 0, z: 0 };
  return {
    x: ax === max ? delta.x : 0,
    y: ay === max && ax !== max ? delta.y : 0,
    z: az === max && ax !== max && ay !== max ? delta.z : 0,
  };
}

/**
 * Constrain a movement delta to a single named axis (what a gizmo arrow handle does).
 * @param {string} axis "x" | "y" | "z" | "xz" | "xy" | "zy" | null for free movement
 */
export function constrainToAxis(delta, axis) {
  if (!delta) return delta;
  if (!axis) return { ...delta };
  const keep = String(axis).toLowerCase();
  return {
    x: keep.includes("x") ? (delta.x || 0) : 0,
    y: keep.includes("y") ? (delta.y || 0) : 0,
    z: keep.includes("z") ? (delta.z || 0) : 0,
  };
}

/**
 * Resolve a complete drag into a final position — the single entry point the editor
 * calls, so the order of operations (constrain → lock → snap) is defined in one place
 * and cannot drift between the gizmo and the keyboard nudge paths.
 *
 * @param {object} start     position when the drag began
 * @param {object} delta     raw world-space movement
 * @param {object} opts      { axis, mods, orthographic, step }
 */
export function resolveDrag(start, delta, { axis = null, mods = null, orthographic = false, step = GRID_SNAP_M, osnap = null } = {}) {
  const s = start || { x: 0, y: 0, z: 0 };
  let d = constrainToAxis(delta || { x: 0, y: 0, z: 0 }, axis);
  // The CAD-view axis lock only applies when the gizmo has not already picked an axis.
  if (!axis && orthographic && snapActive(mods)) d = lockDominantAxis(d);
  const moved = { x: (s.x || 0) + (d.x || 0), y: (s.y || 0) + (d.y || 0), z: (s.z || 0) + (d.z || 0) };
  // Object snap on ground-plane moves (free/plane drags only, never while ALT suspends snapping).
  const planar = !axis || axis === "xz";
  if (osnap && planar && !(mods && mods.freeform)) {
    const hit = objectSnapPosition(moved, osnap);
    if (hit) return hit.position;
  }
  return snapTranslation(moved, mods, step);
}

/**
 * Should this drag produce a copy rather than move the original?
 * Evaluated once at drag start — deciding mid-drag would spawn a duplicate every frame.
 */
export function shouldDuplicate(mods) {
  return !!(mods && mods.duplicate);
}

/**
 * Keyboard shortcuts, matching Depence where it has one.
 * Returns a command name or null. Kept as data so the UI can render a shortcut list
 * from the same source that dispatches them.
 */
export const SHORTCUTS = [
  { key: "z", ctrl: true, shift: true, command: "edit:redo", label: "Ctrl+Shift+Z", desc: "Redo last edit" },
  { key: "y", ctrl: true, command: "edit:redo", label: "Ctrl+Y", desc: "Redo last edit" },
  { key: "z", ctrl: true, shift: false, command: "edit:undo", label: "Ctrl+Z", desc: "Undo last edit" },
  { key: "Escape", command: "tool:move", label: "Esc", desc: "Exit tool, back to Move" },
  { key: "w", command: "tool:move", label: "W", desc: "Move tool" },
  { key: "e", command: "tool:rotate", label: "E", desc: "Rotate tool" },
  { key: "q", command: "tool:select", label: "Q", desc: "Select tool" },
  { key: "d", ctrl: true, command: "edit:duplicate", label: "Ctrl+D", desc: "Duplicate selection" },
  { key: "g", ctrl: true, shift: true, command: "edit:ungroup", label: "Ctrl+Shift+G", desc: "Ungroup selection" },
  { key: "g", ctrl: true, shift: false, command: "edit:group", label: "Ctrl+G", desc: "Group selection" },
  { key: "Delete", command: "edit:delete", label: "Del", desc: "Delete selection" },
  { key: "a", ctrl: true, command: "select:all", label: "Ctrl+A", desc: "Select all" },
  { key: "f", command: "view:focus", label: "F", desc: "Focus selection" },
  { key: "g", command: "view:grid", label: "G", desc: "Toggle grid" },
];

/** Match an event against SHORTCUTS. Returns the command string, or null. */
export function matchShortcut(e) {
  if (!e || !e.key) return null;
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const shift = !!e.shiftKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const s of SHORTCUTS) {
    if (s.key !== key) continue;
    if (!!s.ctrl !== ctrl) continue;
    if (s.shift !== undefined && !!s.shift !== shift) continue;
    return s.command;
  }
  return null;
}
