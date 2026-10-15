// Wave-field patterns: parametric water/light waves compiled to one keyed clip per
// fixture. A pattern is stored as a recipe { effect: 'field', field: {...} } so it stays
// editable (kind, heights, speed, crests…) and recompiles on every change.
//
// Member geometry (from the group's member order, usually clockwise around the basin):
//   i  rank, p = i / n          position around the group (0..1)
//   s  0..1                     distance from the origin member along the group; on a
//                               closed ring both directions are mirrored (front → back)
// Each kind returns w(member, t) in 0..1; the level is lo + (hi - lo) · w where lo/hi
// ramp from the origin values (low/high) to the far-end values (lowFar/highFar),
// optionally in `stairs` steps.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const r2 = v => Math.round(v * 100) / 100;
const smooth = u => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };
const sinW = x => 0.5 + 0.5 * Math.sin(TAU * x);
const bump = (x, w) => { const d = x - Math.round(x); return Math.exp(-(d * d) / (2 * w * w)); };

export const FIELD_KINDS = [
  { id: 'rolling', label: 'Rolling wave', hint: 'Crests roll from the starting point along both sides to the far end',
    defaults: { period: 6.67, crests: 1.67, origin: 'tip', low: 18, high: 42, lowFar: 32, highFar: 80, stairs: 6 } },
  { id: 'travelling', label: 'Travelling wave', hint: 'Crests travel around the basin; each jet rises just after its neighbour',
    defaults: { period: 5, crests: 4, direction: 1, low: 20, high: 75 } },
  { id: 'seesaw', label: 'See-saw', hint: 'Neighbouring blocks move opposite: one rises while the next lowers',
    defaults: { period: 4, block: 4, drift: 10, low: 22, high: 72 } },
  { id: 'swell', label: 'Grand swell', hint: 'The whole fountain breathes up and down together',
    defaults: { period: 5, lag: 0.6, origin: 'tip', low: 18, high: 80 } },
  { id: 'sweep', label: 'Converge & split', hint: 'One crest runs from the starting point down both sides, meets, and returns',
    defaults: { period: 7.5, width: 0.16, origin: 'tip', low: 18, high: 80 } },
  { id: 'crossing', label: 'Crossing waves', hint: 'Two waves travel in opposite directions and pass through each other',
    defaults: { period: 10, crests: 2, width: 0.12, low: 18, high: 78 } },
  { id: 'stadium', label: 'Stadium wave', hint: 'One crest races around: jets jump up quickly and settle slowly',
    defaults: { period: 7.5, width: 0.05, direction: 1, low: 20, high: 82 } },
  { id: 'finale', label: 'Finale build', hint: 'A travelling wave that grows taller and faster, then settles',
    defaults: { period: 5, crests: 3, accel: 0.00375, direction: 1, low: 20, high: 82 } },
];
export const fieldKind = id => FIELD_KINDS.find(k => k.id === id) || FIELD_KINDS[1];

/** Which settings each kind uses — the editor hides the rest. */
export const FIELD_CONTROLS = {
  rolling: ['period', 'crests', 'origin', 'ramp'],
  travelling: ['period', 'crests', 'direction'],
  seesaw: ['period', 'block', 'drift'],
  swell: ['period', 'lag', 'origin'],
  sweep: ['period', 'width', 'origin'],
  crossing: ['period', 'crests', 'width'],
  stadium: ['period', 'width', 'direction'],
  finale: ['period', 'crests', 'direction'],
};
export const ORIGINS = [['tip', 'Tip (farthest point)'], ['top', 'Plan top'], ['bottom', 'Plan bottom'], ['left', 'Plan left'], ['right', 'Plan right'], ['first', 'First jet']];

export function defaultField(kind, extra = {}) {
  const k = fieldKind(kind);
  return { kind: k.id, ease: 1, ...k.defaults, ...extra };
}

/** Rank/position/distance geometry for ordered members ({ id, x, y }). */
export function memberGeometry(members, { origin = 'tip', ring = true } = {}) {
  const n = members.length;
  if (!n) return [];
  const cx = members.reduce((s, m) => s + num(m.x), 0) / n, cy = members.reduce((s, m) => s + num(m.y), 0) / n;
  const score = m => origin === 'top' ? num(m.y) : origin === 'bottom' ? -num(m.y) : origin === 'left' ? -num(m.x)
    : origin === 'right' ? num(m.x) : Math.hypot(num(m.x) - cx, num(m.y) - cy);
  let a = 0;
  if (origin !== 'first') {
    // Centre of the members sharing the best score (a flat "tip" row starts from its middle).
    const scores = members.map(score), best = Math.max(...scores);
    const span = Math.max(...scores) - Math.min(...scores) || 1;
    const top = scores.map((v, i) => [v, i]).filter(([v]) => best - v <= span * 0.01).map(([, i]) => i);
    a = top[Math.floor(top.length / 2)];
  }
  const half = n / 2;
  return members.map((m, i) => {
    const d = Math.abs(i - a);
    const s = n < 2 ? 0 : ring ? Math.min(d, n - d) / half : d / Math.max(1, n - 1);
    return { id: m.id, i, n, p: i / n, s: clamp(s, 0, 1) };
  });
}

/** Wave value 0..1 of one member at local time t (seconds from the pattern start). */
export function fieldWave(field, g, t) {
  const f = field || {};
  const period = Math.max(0.2, num(f.period, 5));
  const dir = num(f.direction, 1) < 0 ? -1 : 1;
  const width = clamp(num(f.width, 0.1), 0.01, 0.5);
  switch (f.kind) {
    case 'rolling': return sinW(t / period - g.s * num(f.crests, 1.67));
    case 'seesaw': {
      const block = Math.max(1, num(f.block, 4)), drift = num(f.drift, 0);
      return 0.5 + 0.5 * Math.sin(TAU * (g.i / (2 * block) - (drift > 0 ? t / drift : 0))) * Math.cos(TAU * t / period);
    }
    case 'swell': return 0.5 - 0.5 * Math.cos(TAU * (t - num(f.lag, 0) * g.s) / period);
    case 'sweep': { const u = (t / period) % 1, c = u < 0.5 ? u * 2 : 2 - u * 2; return Math.exp(-((g.s - c) ** 2) / (2 * width * width)); }
    case 'crossing': { const c = Math.max(1, num(f.crests, 2));
      return Math.max(bump(c * (g.p - t / period), width * c), bump(c * (g.p + t / period), width * c)); }
    case 'stadium': {
      let d = (t / period - dir * g.p) % 1; if (d < 0) d += 1; if (d > 0.5) d -= 1;
      return d < 0 ? Math.exp(-(d * d) / (2 * width * width)) : Math.exp(-d / (width * 2.4));
    }
    case 'finale': {
      const phase = t / period + num(f.accel, 0) * t * t;
      return sinW(phase - dir * num(f.crests, 3) * g.p);
    }
    case 'travelling':
    default: return sinW(t / period - dir * num(f.crests, 1) * g.p);
  }
}

/** Gain envelope of the finale kind (grows, then settles in the last 20 %). */
const finaleGain = (t, duration) => {
  const peak = duration * 0.8;
  return t < peak ? 0.4 + 0.6 * smooth(t / peak) : 1 - 0.5 * smooth((t - peak) / Math.max(0.1, duration - peak));
};

/** Level 0..100 of one member at local time t, with the ramp/stairs and the soft edges. */
export function fieldLevel(field, g, t, duration) {
  const f = field || {};
  const stairs = Math.round(num(f.stairs, 0));
  const ramp = stairs > 1 ? Math.min(stairs - 1, Math.floor(g.s * stairs)) / (stairs - 1) : g.s;
  const low = num(f.low, 20), high = num(f.high, 80);
  const lo = low + (num(f.lowFar, low) - low) * ramp;
  const hi = high + (num(f.highFar, high) - high) * ramp;
  let w = fieldWave(f, g, t);
  if (f.kind === 'finale') w = 0.5 + (w - 0.5) * finaleGain(t, duration);
  let v = lo + (hi - lo) * w;
  const ease = Math.max(0, num(f.ease, 1));
  if (ease > 0) { // soft start/stop toward the middle level, so patterns hand over smoothly
    const mid = (lo + hi) / 2, k = smooth(Math.min(t, duration - t) / ease);
    v = mid + (v - mid) * k;
  }
  return clamp(v, 0, 100);
}

/** Sample a function over [0, duration] and keep only keys linear interpolation needs. */
export function sampleKeys(fn, duration, step, tolerance = 0.4) {
  const n = Math.max(1, Math.min(2400, Math.round(duration / step)));
  const pts = [];
  for (let k = 0; k <= n; k++) { const t = Math.min(duration, k * duration / n); pts.push([r2(t), r2(clamp(fn(Math.min(t, duration - 1e-6)), 0, 100))]); }
  const keep = [pts[0]];
  let anchor = 0;
  for (let k = 1; k < pts.length - 1; k++) {
    const a = pts[anchor], c = pts[k + 1];
    let ok = true;
    for (let m = anchor + 1; m <= k && ok; m++) {
      const [t, v] = pts[m];
      ok = Math.abs(a[1] + (c[1] - a[1]) * (t - a[0]) / (c[0] - a[0]) - v) <= tolerance;
    }
    if (!ok) { keep.push(pts[k]); anchor = k; }
  }
  keep.push(pts.at(-1));
  // Strictly increasing times (rounding can collapse two very close samples).
  return keep.filter((p, k) => k === 0 || p[0] > keep[k - 1][0]).flat();
}

const hsv = h => { const f = n => { const k = (n + h * 6) % 6; return 100 * (1 - Math.max(0, Math.min(k, 4 - k, 1))); }; return [f(5), f(3), f(1)]; };

/**
 * Channel curves for one member: [{ type, keys, color }]. Water and solid-colour lights
 * get one level curve; rainbow lights add red/green/blue curves that move around.
 */
export function fieldChannels(recipe, g, item) {
  const f = recipe.field || {};
  const duration = num(recipe.duration, 10);
  const step = clamp(Math.min(0.25, num(f.period, 5) / 16), 0.05, 0.25);
  const levels = sampleKeys(t => fieldLevel(f, g, t, duration), duration, step);
  const tracks = item.tracks || [];
  // Waves drive jets and lights only; pumps and valves in the group keep their own clips.
  // Some jet types expose their level as pump_speed (same as the pattern builder uses).
  if (/pump|valve|solenoid/i.test(String(item.type || ''))) return [];
  const level = tracks.find(tr => /^(device_intensity|lighting_master|motion_intensity)$/.test(tr.type))
    || tracks.find(tr => tr.type === 'pump_speed') || null;
  if (!level) return [];
  const out = [{ type: level.type, trackId: level.id, keys: levels, color: recipe.color }];
  if (f.colorMode === 'rainbow' && level.type === 'lighting_master') {
    const speed = Math.max(1, num(f.rainbowPeriod, 10));
    ['lighting_red', 'lighting_green', 'lighting_blue'].forEach((type, c) => {
      const track = tracks.find(tr => tr.type === type);
      if (track) out.push({ type, trackId: track.id, keys: sampleKeys(t => hsv(((g.p - t / speed) % 1 + 1) % 1)[c], duration, 0.5, 1), color: recipe.color });
    });
  }
  return out;
}
