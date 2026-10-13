/**
 * drafting/session.js — AF-CAD-032/033 point acquisition and the pipe-drawing session that
 * the 2D designer (usePipeDrawing) and the 3D scene editor share.
 *
 * resolveDraftPoint() is the ONE rule for where a picked point lands:
 *   ORTHO off:  object snap (aperture) > polar tracking (15°, Shift locks) > grid > raw
 *   ORTHO on:   object snap or grid, then constrained horizontal/vertical from the last
 *               point (the designer's long-standing ORTHO toggle)
 * Typed points (dynamic input) are exact; they only "magnet" onto a fixture Port when
 * they land within 1 mm of it, so a typed 12.5 m that ends on a nozzle connects to it.
 *
 * DraftingSession is framework-free so the 3D editor can drive it with ground-plane
 * points converted to the plan frame; usePipeDrawing uses the same helpers.
 */
import { buildSnapScene, findSnap } from "./snap";
import { polarTrack, angleOf, dynamicInputKey, emptyDynamicInput, resolveDynamicInput } from "./dynamicInput";
import { createPipeEntity, connectPipeEnds, fixturePorts, cleanPoint, OWNER_MODEL } from "./entities";

export const PORT_MAGNET_M = 0.001;

/** Snap a typed point onto a coincident fixture port (≤ 1 mm). */
export function magnetToPort(pt, fixtures = [], tolerance = PORT_MAGNET_M) {
  let best = null;
  for (const f of fixtures || []) {
    for (const port of fixturePorts(f)) {
      const d = Math.hypot(port.x - pt.x, port.y - pt.y);
      if (d <= tolerance && (!best || d < best.d)) best = { d, port };
    }
  }
  return best ? { x: best.port.x, y: best.port.y, port: best.port } : { ...pt, port: null };
}

const orthogonalize = (pt, from) => (Math.abs(pt.x - from.x) >= Math.abs(pt.y - from.y) ? { ...pt, y: from.y } : { ...pt, x: from.x });

/**
 * Where a picked point lands.
 * @param {object} cursor   raw plan point
 * @param {object} ctx      { scene | design, from, worldPerPx, aperturePx, grid:{enabled,step},
 *                            shift, lockedAngleDeg, orthogonal, polar (default true), osnap, underlay, exclude }
 * @returns {{point:{x,y}, snap, polar}}
 */
export function resolveDraftPoint(cursor, ctx = {}) {
  const {
    from = null, worldPerPx = 1 / 30, aperturePx = 10, grid = { enabled: false, step: 0.5 },
    shift = false, lockedAngleDeg = null, orthogonal = false, polar = true, osnap = true, underlay = null,
  } = ctx;
  const scene = ctx.scene || (ctx.design ? buildSnapScene(ctx.design, { exclude: ctx.exclude }) : null);
  const object = findSnap(cursor, scene, { worldPerPx, aperturePx, osnap, grid: { enabled: false }, from, underlay });
  if (orthogonal && from) {
    const base = object.mode ? object : findSnap(cursor, null, { grid });
    const point = orthogonalize({ x: base.x, y: base.y }, from);
    return { point, snap: object.mode ? object : (base.mode ? base : null), polar: null };
  }
  if (object.mode) return { point: { x: object.x, y: object.y }, snap: object, polar: null };
  if (polar && from) {
    const tracked = polarTrack(from, cursor, { worldPerPx, aperturePx, lockedAngleDeg: shift ? (lockedAngleDeg ?? Math.round(angleOf(from, cursor) / 15) * 15) : null });
    if (tracked) {
      let point = { x: tracked.x, y: tracked.y };
      // Grid still quantises the LENGTH along a tracked ray (AutoCAD PolarSnap).
      if (grid?.enabled && Number(grid.step) > 0) {
        const step = Number(grid.step);
        const len = Math.round(tracked.length / step) * step;
        const a = tracked.angleDeg * Math.PI / 180;
        point = cleanPoint({ x: from.x + len * Math.cos(a), y: from.y - len * Math.sin(a) });
      }
      return { point, snap: null, polar: tracked };
    }
  }
  const g = findSnap(cursor, null, { grid });
  return { point: { x: g.x, y: g.y }, snap: g.mode ? g : null, polar: null };
}

/**
 * A pipe-drawing command, independent of any UI. Feed it plan points and keys; it calls
 * `onCreate(pipe)` with a finished pipe entity (built by entities.createPipeEntity).
 */
export class DraftingSession {
  constructor({ getDesign = () => ({}), onCreate = () => {}, settings = {} } = {}) {
    this.getDesign = getDesign;
    this.onCreate = onCreate;
    this.settings = { diameterMm: 50, pipeType: "supply", drawMode: "polyline", orthogonal: false, grid: { enabled: false, step: 0.5 }, ...settings };
    this.points = [];
    this.connections = { start: null, end: null };
    this.input = emptyDynamicInput();
    this.preview = null;
    this.lockedAngleDeg = null;
  }

  get active() { return this.points.length > 0; }
  get last() { return this.points[this.points.length - 1] || null; }

  _ctx(extra = {}) {
    const design = this.getDesign() || {};
    return { design, from: this.last, orthogonal: this.settings.orthogonal, grid: this.settings.grid, ...extra };
  }

  /** Pointer moved to plan point `cursor`. Returns the preview resolution. */
  pointer(cursor, { worldPerPx = 1 / 30, shift = false } = {}) {
    if (shift && this.lockedAngleDeg === null && this.last) this.lockedAngleDeg = Math.round(angleOf(this.last, cursor) / 15) * 15;
    if (!shift) this.lockedAngleDeg = null;
    this.preview = resolveDraftPoint(cursor, this._ctx({ worldPerPx, shift, lockedAngleDeg: this.lockedAngleDeg }));
    this.preview.cursor = cursor;
    return this.preview;
  }

  /** Click at plan point `cursor`: adds the resolved point. */
  click(cursor, opts = {}) {
    const res = this.pointer(cursor, opts);
    return this._addPoint(res.point);
  }

  _addPoint(point) {
    const p = cleanPoint(point);
    this.points.push(p);
    this.input = emptyDynamicInput();
    if (this.settings.drawMode === "straight" && this.points.length >= 2) return this.finish();
    if ((this.settings.drawMode === "curve" || this.settings.drawMode === "arc") && this.points.length >= 3) return this.finish();
    return { type: "point", point: p };
  }

  /** Current tracking angle used when only a length is typed. */
  currentAngleDeg() {
    if (this.preview?.polar) return this.preview.polar.angleDeg;
    if (this.last && this.preview?.cursor) return angleOf(this.last, this.preview.cursor);
    return 0;
  }

  /** A key press while the command waits for a point. */
  key(key) {
    if (!this.active && !/^[0-9.\-@]$/.test(key) && key !== "Escape") return { handled: false };
    const { state, action, handled } = dynamicInputKey(this.input, key);
    this.input = state;
    if (!action) return { handled };
    if (action.type === "cancel") { this.cancel(); return { handled, type: "cancel" }; }
    if (action.type === "finish") return { handled, ...(this.finish() || { type: "none" }) };
    const typed = resolveDynamicInput(this.last, this.input, { cursorAngleDeg: this.currentAngleDeg() });
    if (!typed) return { handled, type: "invalid" };
    const magnet = magnetToPort(typed, (this.getDesign() || {}).fixtures);
    return { handled, ...this._addPoint({ x: magnet.x, y: magnet.y }) };
  }

  finish() {
    if (this.points.length < 2) { this.cancel(); return null; }
    const design = this.getDesign() || {};
    const pipe = createPipeEntity({
      points: this.points, diameterMm: this.settings.diameterMm, pipeType: this.settings.pipeType,
      drawMode: this.settings.drawMode, owner: OWNER_MODEL,
      connections: connectPipeEnds(this.points, design.fixtures),
    });
    this.points = [];
    this.input = emptyDynamicInput();
    this.preview = null;
    this.onCreate(pipe);
    return { type: "pipe", pipe };
  }

  cancel() {
    this.points = [];
    this.input = emptyDynamicInput();
    this.preview = null;
    this.lockedAngleDeg = null;
  }
}
