/**
 * drafting/dynamicInput.js — AF-CAD-033 polar tracking and typed (dynamic) input.
 *
 * Conventions (plan frame, metres; plan y runs DOWN the screen):
 *   - angles are degrees counter-clockwise ON SCREEN from +x (so 90° points up the
 *     screen, like AutoCAD with its y-up world);
 *   - "@dx,dy" is relative to the last point in the designer's displayed X/Y frame (the
 *     same axes as the coordinate read-out and the properties panel);
 *   - "x,y" without @ is an absolute plan point;
 *   - "L<A" is a length at an explicit angle.
 *
 * Polar tracking is ALWAYS ON (SketchUp-style): when the cursor is within the snap aperture
 * of a ray at a multiple of the increment (15° by default) from the last point, the point
 * is pulled onto that ray. Holding Shift locks the current tracking direction.
 *
 * Typing while a command waits for a point opens dynamic input:
 *   digits / . / - → length field     Tab → toggles length ↔ angle field
 *   @ or ,         → coordinate entry  Backspace edits, Enter commits, Esc cancels
 * Enter with an EMPTY field finishes the current command (AutoCAD behaviour).
 *
 * Pure — no React, no DOM.
 */
export const POLAR_INCREMENT_DEG = 15;

const norm360 = (deg) => ((deg % 360) + 360) % 360;
const round = (v, d = 9) => { const r = Number(Number(v).toFixed(d)); return r === 0 ? 0 : r; };

/** Screen-CCW angle (deg) of the vector from `from` to `to`. */
export const angleOf = (from, to) => norm360(Math.atan2(-(to.y - from.y), to.x - from.x) * 180 / Math.PI);

/** Point at `length` metres and `angleDeg` (screen-CCW) from `from`. */
export function polarPoint(from, length, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  return { x: round(from.x + length * Math.cos(a)), y: round(from.y - length * Math.sin(a)) };
}

/**
 * Polar tracking.
 * @returns {{x,y,angleDeg,length,locked}|null} the tracked point, or null when the cursor
 *          is not near any polar ray (and Shift is not locking one).
 */
export function polarTrack(from, cursor, { incrementDeg = POLAR_INCREMENT_DEG, worldPerPx = 1 / 30, aperturePx = 10, lockedAngleDeg = null } = {}) {
  if (!from || !cursor) return null;
  const dx = cursor.x - from.x, dy = cursor.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-9) return null;
  const raw = angleOf(from, cursor);
  const inc = Math.max(1, Number(incrementDeg) || POLAR_INCREMENT_DEG);
  const angleDeg = lockedAngleDeg !== null && lockedAngleDeg !== undefined ? norm360(lockedAngleDeg) : norm360(Math.round(raw / inc) * inc);
  const a = angleDeg * Math.PI / 180;
  const ux = Math.cos(a), uy = -Math.sin(a);
  const along = dx * ux + dy * uy;
  const off = Math.abs(dx * uy - dy * ux);
  const locked = lockedAngleDeg !== null && lockedAngleDeg !== undefined;
  if (!locked && (along <= 0 || off > aperturePx * worldPerPx)) return null;
  const length = Math.max(0, along);
  return { ...polarPoint(from, length, angleDeg), angleDeg, length, locked };
}

// ── typed input ─────────────────────────────────────────────────────────────

export const emptyDynamicInput = () => ({ active: false, field: "length", length: "", angle: "", coords: "" });

const isNumberChar = (k) => /^[0-9.\-]$/.test(k);

/**
 * Reduce one key press. Returns { state, action } where action is
 *   null | { type: "commit" } | { type: "finish" } | { type: "cancel" }.
 * `handled` tells the host to preventDefault.
 */
export function dynamicInputKey(state, key) {
  const s = state || emptyDynamicInput();
  if (key === "Escape") return { state: emptyDynamicInput(), action: { type: "cancel" }, handled: true };
  if (key === "Enter") {
    if (!s.active || (!s.length && !s.angle && !s.coords)) return { state: emptyDynamicInput(), action: { type: "finish" }, handled: true };
    return { state: s, action: { type: "commit" }, handled: true };
  }
  if (key === "Tab") {
    if (!s.active) return { state: s, action: null, handled: false };
    if (s.field === "coords") return { state: s, action: null, handled: true };
    return { state: { ...s, field: s.field === "length" ? "angle" : "length" }, action: null, handled: true };
  }
  if (key === "Backspace") {
    if (!s.active) return { state: s, action: null, handled: false };
    const next = { ...s, [s.field]: s[s.field].slice(0, -1) };
    const empty = !next.length && !next.angle && !next.coords;
    return { state: empty ? emptyDynamicInput() : next, action: null, handled: true };
  }
  if (key === "@" || (key === "," && s.field !== "coords")) {
    const seed = s.field === "length" && s.length ? s.length : "";
    return { state: { ...s, active: true, field: "coords", coords: key === "@" ? "@" : `${seed},` }, action: null, handled: true };
  }
  if (key === "<" && s.field === "length" && s.length) return { state: { ...s, field: "angle" }, action: null, handled: true };
  if (s.field === "coords" && (isNumberChar(key) || key === ",")) return { state: { ...s, coords: s.coords + key }, action: null, handled: true };
  if (isNumberChar(key)) {
    const field = s.active ? s.field : "length";
    return { state: { ...s, active: true, field, [field]: (s.active ? s[field] : "") + key }, action: null, handled: true };
  }
  return { state: s, action: null, handled: false };
}

/** Parse "@dx,dy" / "x,y". */
export function parseCoordinateInput(text) {
  const raw = String(text || "").trim();
  const relative = raw.startsWith("@");
  const parts = (relative ? raw.slice(1) : raw).split(",").map((v) => v.trim());
  if (parts.length !== 2) return null;
  const a = Number(parts[0]), b = Number(parts[1]);
  if (!parts[0] || !parts[1] || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { relative, x: a, y: b };
}

/**
 * The point a dynamic-input state describes.
 * @param {{x,y}} from          last point of the command
 * @param {object} state        dynamic-input state
 * @param {number} cursorAngle  current tracking/cursor angle (deg) used when no angle typed
 * @returns {{x,y}|null}
 */
export function resolveDynamicInput(from, state, { cursorAngleDeg = 0 } = {}) {
  if (!state?.active) return null;
  if (state.field === "coords" || state.coords) {
    const c = parseCoordinateInput(state.coords);
    if (!c) return null;
    if (c.relative) return from ? { x: round(from.x + c.x), y: round(from.y + c.y) } : null;
    return { x: round(c.x), y: round(c.y) };
  }
  if (!from) return null;
  const length = Number(state.length);
  if (!state.length || !Number.isFinite(length)) return null;
  const angle = state.angle !== "" && Number.isFinite(Number(state.angle)) ? Number(state.angle) : cursorAngleDeg;
  return polarPoint(from, length, angle);
}

/** Short text for the on-canvas input box. */
export function describeDynamicInput(state) {
  if (!state?.active) return "";
  if (state.field === "coords") return state.coords || "@";
  const len = state.length || "…";
  return state.angle !== "" ? `${len} m < ${state.angle}°` : `${len} m`;
}
