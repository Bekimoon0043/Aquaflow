// Parametric moving-nozzle patterns. One block can carry coordinated water, motion and lights.
// Spatial paths and temporal curves remain editable; compilation resolves them into real channels.
import { memberGeometry, pathPhase, sampleKeys, shapeValue } from './wavePatterns';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const round = v => Math.round(v * 1000) / 1000;
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export const MOTION_MODES = [
  { id: 'water', label: 'Water', hint: 'Height, waves and lights' },
  { id: '1d', axes: 1, label: '1D Swing', hint: 'One axis, in one vertical plane' },
  { id: '2d', axes: 2, label: '2D Aim', hint: 'Pan and tilt along a spatial path' },
  { id: '3d', axes: 3, label: '3D Head', hint: 'Pan, tilt and a rotating nozzle head' },
];
export const MOTION_PATHS = [
  { id: 'circle', label: 'Rotating cone', hint: 'A continuous circular aim path', axes: 2 },
  { id: 'figure8', label: 'Figure 8', hint: 'Two crossing loops', axes: 2 },
  { id: 'cross', label: 'Cross', hint: 'Alternate horizontal and vertical strokes', axes: 2 },
  { id: 'spiral', label: 'Opening spiral', hint: 'A turning path that opens and closes', axes: 2 },
  { id: 'dance', label: 'Free dance', hint: 'Layered smooth motion with less repetition', axes: 2 },
  { id: 'custom', label: 'Drawn path', hint: 'Your own draggable pan/tilt waypoints', axes: 2 },
];
export const MOTION_DEFAULT_POINTS = [
  { x: 0, y: 0.8 }, { x: 0.8, y: 0 }, { x: 0, y: -0.8 }, { x: -0.8, y: 0 },
];
export const MOTION_DEFAULTS = Object.freeze({
  axes: 1, path: 'sweep', amplitudeDeg: 45, centreDeg: 0,
  panAmplitudeDeg: 60, tiltAmplitudeDeg: 35, centrePanDeg: 0, centreTiltDeg: 15,
  points: MOTION_DEFAULT_POINTS, interpolation: 'smooth', closed: true, turns: 2,
  rollMode: 'spin', rollRpm: 24, rollAmplitudeDeg: 90, centreRollDeg: 0, rollDirection: 1, rollFollowGroup: false,
  limitSpeed: true,
});

export function cleanMotion(raw = {}, axes = null) {
  const a = axes || clamp(Math.round(num(raw.axes, 1)), 1, 3);
  const paths = MOTION_PATHS.filter(p => p.axes <= a).map(p => p.id);
  const m = {
    axes: a,
    path: a === 1 ? 'sweep' : paths.includes(raw.path) ? raw.path : 'circle',
    amplitudeDeg: clamp(num(raw.amplitudeDeg, 45), 0, 180),
    centreDeg: clamp(num(raw.centreDeg, 0), -180, 180),
    panAmplitudeDeg: clamp(num(raw.panAmplitudeDeg, 60), 0, 180),
    tiltAmplitudeDeg: clamp(num(raw.tiltAmplitudeDeg, 35), 0, 180),
    centrePanDeg: clamp(num(raw.centrePanDeg, 0), -180, 180),
    centreTiltDeg: clamp(num(raw.centreTiltDeg, 15), -180, 180),
    interpolation: ['smooth', 'linear', 'hold'].includes(raw.interpolation) ? raw.interpolation : 'smooth',
    closed: raw.closed !== false,
    turns: clamp(num(raw.turns, 2), 0.25, 8),
    rollMode: ['hold', 'spin', 'sway'].includes(raw.rollMode) ? raw.rollMode : 'spin',
    rollRpm: clamp(num(raw.rollRpm, 24), -120, 120),
    rollAmplitudeDeg: clamp(num(raw.rollAmplitudeDeg, 90), 0, 360),
    centreRollDeg: clamp(num(raw.centreRollDeg, 0), -360, 360),
    rollDirection: num(raw.rollDirection, 1) < 0 ? -1 : 1,
    rollFollowGroup: !!raw.rollFollowGroup,
    limitSpeed: raw.limitSpeed !== false,
  };
  m.points = (Array.isArray(raw.points) ? raw.points : MOTION_DEFAULT_POINTS).slice(0, 64).map(p => ({
    x: clamp(num(p.x), -1, 1), y: clamp(num(p.y), -1, 1),
  }));
  if (m.points.length < 2) m.points = MOTION_DEFAULT_POINTS.map(p => ({ ...p }));
  return m;
}

export function motionAxesOf(item) {
  const types = new Set((item?.tracks || []).map(t => t.type));
  if (types.has('motion_roll')) return 3;
  if (types.has('motion_pan') && types.has('motion_tilt')) return 2;
  if (types.has('motion_angle')) return 1;
  return 0;
}

function groupedMember(field, g) {
  const size = Math.max(1, Math.round(num(field.group, 1)));
  if (size === 1 || g.a === undefined) return g;
  const i = Math.floor(g.i / size) * size, d = Math.abs(i - g.a);
  const s = g.n < 2 ? 0 : g.ring ? Math.min(d, g.n - d) / (g.n / 2) : d / Math.max(1, g.n - 1);
  return { ...g, i, p: i / g.n, s: clamp(s, 0, 1) };
}

function customPoint(points, u, interpolation, closed) {
  const n = points.length;
  const segments = closed ? n : n - 1;
  const x = ((u % 1) + 1) % 1;
  const position = Math.min(segments - 1e-9, x * segments);
  const i = Math.floor(position), local = position - i;
  const at = k => points[closed ? (k + n) % n : clamp(k, 0, n - 1)];
  const a = at(i), b = at(i + 1);
  if (interpolation === 'hold') return { x: a.x, y: a.y };
  if (interpolation === 'linear') return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
  const before = at(i - 1), after = at(i + 2), t2 = local * local, t3 = t2 * local;
  const catmull = (p0, p1, p2, p3) => 0.5 * ((2 * p1) + (-p0 + p2) * local + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return { x: catmull(before.x, a.x, b.x, after.x), y: catmull(before.y, a.y, b.y, after.y) };
}

/** Aim in degrees for one member. The returned roll is unwrapped so continuous spins stay continuous. */
export function motionPoint(motion, field, g, t) {
  const m = cleanMotion(motion), f = field || {};
  const member = groupedMember(f, g);
  const opposite = f.opposite && Math.floor(g.i / Math.max(1, Math.round(num(f.group, 1)))) % 2 ? 0.5 : 0;
  const phase = pathPhase(f, member, t) + opposite;
  const period = Math.max(0.2, num(f.period, 5));
  const clock = (t + num(f.offset, 0)) / period - phase;
  const u = ((clock % 1) + 1) % 1;
  if (m.axes === 1) {
    const value = shapeValue(f, clock);
    return { pan: m.centreDeg + m.amplitudeDeg * (2 * value - 1), tilt: 0, roll: 0 };
  }
  const a = TAU * u * (num(f.direction, 1) < 0 ? -1 : 1);
  let x = 0, y = 0;
  switch (m.path) {
    case 'figure8': x = Math.sin(a); y = Math.sin(2 * a); break;
    case 'cross': {
      const v = Math.sin(a * 2);
      if (u < 0.5) x = v; else y = v;
      break;
    }
    case 'spiral': {
      const r = 0.12 + 0.88 * (0.5 - 0.5 * Math.cos(TAU * u)), angle = a * m.turns;
      x = r * Math.cos(angle); y = r * Math.sin(angle); break;
    }
    case 'dance':
      x = 0.72 * Math.sin(a) + 0.28 * Math.sin(2.3 * a + 0.4);
      y = 0.68 * Math.cos(1.3 * a) + 0.32 * Math.sin(2.1 * a); break;
    case 'custom': ({ x, y } = customPoint(m.points, u, m.interpolation, m.closed)); break;
    case 'circle':
    default: x = Math.cos(a); y = Math.sin(a);
  }
  let roll = m.centreRollDeg;
  if (m.axes >= 3 && m.rollMode === 'spin') roll += m.rollDirection * m.rollRpm * 6 * t + (m.rollFollowGroup ? -phase * 360 : 0);
  if (m.axes >= 3 && m.rollMode === 'sway') roll += m.rollAmplitudeDeg * Math.sin(a - (m.rollFollowGroup ? phase * TAU : 0));
  return { pan: m.centrePanDeg + x * m.panAmplitudeDeg, tilt: m.centreTiltDeg + y * m.tiltAmplitudeDeg, roll };
}

/** Estimate and optionally limit the group's coherent pan/tilt speed to its slowest drive. */
export function motionSpeedReport(motion, field, members) {
  const m = cleanMotion(motion), f = field || {};
  if (!members.length) return { peak: 0, drive: 0, scale: 1, limited: false };
  const geo = memberGeometry(members, { origin: f.origin || 'tip', ring: /clockwise/.test(f.order || '') });
  const drive = Math.max(1, Math.min(...members.map(item => num(item.engineering?.speedDegSec ?? item.engineering?.speedDegPerSec, 90))));
  let peak = 0;
  const period = Math.max(0.2, num(f.period, 5)), steps = 72;
  for (const g of geo) {
    let previous = motionPoint(m, f, g, 0);
    for (let i = 1; i <= steps; i++) {
      const t = period * i / steps, next = motionPoint(m, f, g, t);
      peak = Math.max(peak, Math.hypot(next.pan - previous.pan, next.tilt - previous.tilt) / (period / steps));
      previous = next;
    }
  }
  const scale = m.limitSpeed && peak > drive ? drive / peak : 1;
  return { peak, drive, scale, limited: scale < 0.999, limitedPeak: peak * scale };
}

function degreeChannel(track, fn, duration, step) {
  const count = Math.max(2, Math.ceil(duration / step)), values = [];
  for (let i = 0; i <= count; i++) values.push(fn(duration * i / count));
  const low = Math.min(...values), high = Math.max(...values), offset = low, scale = (high - low || 1) / 100;
  return { type: track.type, trackId: track.id, keys: sampleKeys(t => (fn(t) - offset) / scale, duration, step, 0.001, 3),
    motionOffset: round(offset), motionScale: round(scale) };
}

/** Compile one motion recipe into keyed pan/tilt/angle/roll clips. */
export function compileMotionRecipe(recipe, orderedMembers) {
  const m = cleanMotion(recipe.motion), f = { ...(recipe.field || {}), order: recipe.order };
  const duration = Math.max(0.1, num(recipe.duration, 10)), start = num(recipe.start, 0);
  const report = motionSpeedReport(m, f, orderedMembers);
  const geo = memberGeometry(orderedMembers, { origin: f.origin || 'tip', ring: /clockwise/.test(recipe.order || '') });
  const step = clamp(Math.min(0.15, num(f.period, 5) / 24), 0.04, 0.15);
  const clips = [], issues = [];
  orderedMembers.forEach((item, index) => {
    const axes = motionAxesOf(item), tracks = item.tracks || [];
    if (axes < m.axes) { issues.push(`${recipe.name}: ${item.label || item.id} needs a ${m.axes}D nozzle.`); return; }
    const required = m.axes === 1 ? ['motion_angle'] : m.axes === 2 ? ['motion_pan', 'motion_tilt'] : ['motion_pan', 'motion_tilt', 'motion_roll'];
    const missing = required.filter(type => !tracks.some(t => t.type === type));
    if (missing.length) { issues.push(`${recipe.name}: ${item.label || item.id} has no ${missing.join(' / ')} channel.`); return; }
    for (const type of required) {
      const track = tracks.find(t => t.type === type);
      const channel = degreeChannel(track, t => {
        const p = motionPoint(m, f, geo[index], t * report.scale);
        return type === 'motion_tilt' ? p.tilt : type === 'motion_roll' ? p.roll : p.pan;
      }, duration, step);
      const levels = channel.keys.filter((_, i) => i % 2);
      clips.push({ id: `${recipe.id}:${item.id}:${type}`, studioRecipeId: recipe.id, patternBlockId: recipe.pattern?.id || recipe.id,
        fixtureId: item.id, trackId: track.id, type, name: recipe.name, startTime: round(start), duration: round(duration),
        value: round(Math.max(...levels)), keys: channel.keys, motionOffset: channel.motionOffset, motionScale: channel.motionScale,
        color: recipe.color, source: 'show-studio' });
    }
  });
  return { clips, issues, speed: report };
}

/** A complete editable moving-nozzle block: water + motion + optional matching lights. */
export function motionPatternRecipes({ start = 0, duration = 15, name = 'Moving fountain', groupId, lightGroupId = null,
  field = {}, motion = {}, light = {}, order = 'engineering', unitId = null }) {
  const unit = unitId || uid('pattern');
  const f = { kind: 'custom', ...field }, m = cleanMotion(motion), color = light.color || '#65d9d0';
  const base = { version: 1, start: round(start), duration: round(duration), cycles: 1, spread: 1, intensity: 100,
    color, order, seed: 1, muted: false, locked: false };
  const recipes = [
    { ...base, id: uid('recipe'), groupId, name, effect: 'field', attribute: 'level', field: f,
      pattern: { id: unit, role: 'motion-water', kind: 'motion', axes: m.axes } },
    { ...base, id: uid('recipe'), groupId, name, effect: 'motion', attribute: 'motion', field: f, motion: m,
      pattern: { id: unit, role: 'motion', kind: 'motion', axes: m.axes } },
  ];
  if (lightGroupId) recipes.push({ ...base, id: uid('recipe'), groupId: lightGroupId, name: `${name} · lights`, effect: 'field', attribute: 'level',
    field: { ...f, low: light.low ?? 6, high: light.high ?? 20, lowFar: light.low ?? 6, highFar: light.high ?? 20, stairs: 0,
      colorMode: light.colorMode || 'solid', rainbowPeriod: light.rainbowPeriod ?? 10, ...(light.colors ? { colors: light.colors } : {}) },
    pattern: { id: unit, role: 'lights', kind: 'motion', axes: m.axes } });
  return { recipes, unitId: unit, speed: null };
}
