// Wave library — the wave types from reports/Wave pattern catalogue for fountains.md, each a
// closed form w(jet, t) in 0..1 (the field's low…high maps it to height). Every wave is
// lo + (hi − lo)·form(t/T − φ_jet): `form` is the shape, T the period (seconds, set from bars by
// the generator) and φ the jet's phase from its place on a line, its angle on a ring or its
// real distance from a point. Pure.
//
// Geometry per jet (memberGeometry): p (0..1 along the path), s (0..1 distance from the start
// jet along the path), i/n, and real plan geometry nx, ny (−1..1 about the group's centre),
// r (0..1 from the centre), th (angle) and ro (0..1 real distance from the start jet).

const TAU = Math.PI * 2;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const frac = (x) => x - Math.floor(x);
const gauss = (d, w) => Math.exp(-(d * d) / (2 * w * w));

// ── Smooth value noise (deterministic, 3-D: x, y, time) ──────────────────────────────────
const hash3 = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function valueNoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
}
/** Two-octave flowing noise, 0..1. */
export function flowNoise(x, y, t) {
  return clamp01((valueNoise3(x, y, t) * 0.67 + valueNoise3(x * 2.1 + 7.3, y * 2.1 + 3.1, t * 1.7 + 11) * 0.33 - 0.5) * 1.6 + 0.5);
}

/** The new wave kinds: id, label, hint, defaults (seconds ≈ 1 bar at 120 BPM = 2 s), controls. */
export const WAVE_KINDS = [
  { id: 'ripple', label: 'Radial ripple', hint: 'Rings spread out over the real ground from a point (the centre or the start jet), fading with distance',
    defaults: { period: 2, crests: 1.5, origin: 'centre', fadeOut: 0.4, low: 15, high: 85 }, controls: ['period', 'crests', 'origin', 'fadeOut'] },
  { id: 'spiral', label: 'Spiral arms', hint: 'Arms rotate around the centre like a pinwheel, twisting outwards',
    defaults: { period: 4, mode: 3, twist: 1, direction: 1, low: 15, high: 85 }, controls: ['period', 'mode', 'twist', 'direction'] },
  { id: 'spot', label: 'Moving spot', hint: 'A bright spot of water glides over the fountain on a figure-of-eight (Lissajous) path — a soloist',
    defaults: { period: 8, width: 0.28, low: 10, high: 90 }, controls: ['period', 'width'] },
  { id: 'interference', label: 'Interference', hint: 'Two ripple sources overlap: still lines and moving peaks, like stones dropped in a pond',
    defaults: { period: 2, crests: 3, low: 15, high: 85 }, controls: ['period', 'crests'] },
  { id: 'lake', label: 'Lake / aurora', hint: 'Soft flowing patches drift over the water like a lake surface or aurora curtains',
    defaults: { period: 8, crests: 1.5, low: 20, high: 80 }, controls: ['period', 'crests'] },
  { id: 'standing', label: 'Standing wave', hint: 'Fixed nodes, the parts between them rise and fall in turn (change the mode for more nodes)',
    defaults: { period: 2, mode: 2, low: 15, high: 85 }, controls: ['period', 'mode'] },
  { id: 'sets', label: 'Ocean sets', hint: 'Sharp-crested swells travel along in sets: a few big waves, then calmer ones, like real ocean swell',
    defaults: { period: 4, crests: 1, sets: 7, low: 15, high: 85 }, controls: ['period', 'crests', 'sets', 'direction'] },
  { id: 'saw', label: 'Sawtooth run', hint: 'Water climbs steadily along the line and snaps back — a run that builds',
    defaults: { period: 4, crests: 1, direction: 1, low: 10, high: 90 }, controls: ['period', 'crests', 'direction'] },
  { id: 'packet', label: 'Wave packet (beats)', hint: 'Two close waves beat together: the wave swells and fades in slow groups',
    defaults: { period: 4, crests: 2, sets: 4, low: 15, high: 85 }, controls: ['period', 'crests', 'sets'] },
  { id: 'bounce', label: 'Bounce', hint: 'Every jet bounces like a dropped ball — high, lower, lower — one after another',
    defaults: { period: 4, lag: 1, low: 0, high: 95 }, controls: ['period', 'lag'] },
  { id: 'ringdown', label: 'Ringdown', hint: 'A hit makes the water ring and die away, spreading from the start point',
    defaults: { period: 4, decay: 1.5, origin: 'tip', low: 10, high: 90 }, controls: ['period', 'decay', 'origin'] },
  { id: 'surf', label: 'Surf break', hint: 'A wave races in, breaks on the beat and washes out in white water',
    defaults: { period: 6, origin: 'tip', low: 5, high: 95 }, controls: ['period', 'origin'] },
  { id: 'bore', label: 'Tidal bore', hint: 'A steep wall of water advances with smaller rollers (whelps) behind it',
    defaults: { period: 8, origin: 'tip', low: 10, high: 90 }, controls: ['period', 'origin'] },
  { id: 'firework', label: 'Firework burst', hint: 'A burst flies out from the centre and falls away — short (peony) or slow-hanging (willow)',
    defaults: { period: 4, decay: 1.2, origin: 'centre', low: 0, high: 100 }, controls: ['period', 'decay', 'origin'] },
  { id: 'flame', label: 'Flame flicker', hint: 'Restless flickering tongues, like fire (best on lights; slow on water)',
    defaults: { period: 2, low: 25, high: 85 }, controls: ['period'] },
  { id: 'heartbeat2', label: 'Heartbeat (lub-dub)', hint: 'Two alternating sets of jets beat lub … dub on every bar — readable on on/off jets',
    defaults: { period: 2, width: 0.12, low: 0, high: 95 }, controls: ['period', 'width'] },
];
export const waveKindIds = new Set(WAVE_KINDS.map((k) => k.id));

/** Value 0..1 of one of the new kinds, or null when the kind is not one of them. */
export function libraryWave(f, g, t) {
  if (!waveKindIds.has(f.kind)) return null;
  const P = Math.max(0.2, num(f.period, 4));
  const dir = num(f.direction, 1) < 0 ? -1 : 1;
  const k = Math.max(0, num(f.crests, 1));
  const nx = num(g.nx, 0), ny = num(g.ny, 0), r = num(g.r, 0), th = num(g.th, 0);
  const ro = f.origin === 'centre' ? r : num(g.ro, g.s ?? 0);
  const q = g.ring ? g.p : g.n > 1 ? g.i / (g.n - 1) : 0;          // 0..1 along the path
  switch (f.kind) {
    case 'ripple': return clamp01(0.5 + 0.5 * Math.cos(TAU * (t / P - ro * k)) * (1 - clamp01(num(f.fadeOut, 0.4)) * ro));
    case 'spiral': return 0.5 + 0.5 * Math.cos(Math.round(num(f.mode, 3)) * (th - dir * TAU * t / P) - TAU * r * num(f.twist, 1));
    case 'spot': {
      const px = 0.85 * Math.sin(TAU * 2 * t / P), py = 0.85 * Math.sin(TAU * 3 * t / P + Math.PI / 2);
      // On a line the spot runs along it; on a ring or grid it traces the figure-of-eight.
      const flat = Math.abs(ny) < 0.05 && Math.abs(py) > 0;
      return gauss(Math.hypot(nx - px, flat ? 0 : ny - py), Math.max(0.05, num(f.width, 0.28)));
    }
    case 'interference': {
      const d1 = Math.hypot(nx + 0.5, ny), d2 = Math.hypot(nx - 0.5, ny);
      return clamp01(0.5 + 0.25 * (Math.cos(TAU * (t / P - d1 * k)) + Math.cos(TAU * (t / P - d2 * k))));
    }
    case 'lake': return flowNoise(nx * k + 10, ny * k + 20, t / P);
    case 'standing': { const m = Math.max(1, Math.round(num(f.mode, 2))); return 0.5 + 0.5 * Math.cos((g.ring ? TAU : Math.PI) * m * q) * Math.cos(TAU * t / P); }
    case 'sets': {
      const base = ((1 + Math.cos(TAU * (t / P - dir * k * q))) / 2) ** 2;
      const n = Math.max(2, num(f.sets, 7));
      const env = 0.5 * (1 + Math.cos(TAU * (t / (n * P) - dir * k * q / n)));
      return clamp01(base * (0.3 + 0.7 * env));
    }
    case 'saw': { const u = frac(t / P - dir * k * q); return u < 0.85 ? u / 0.85 : (1 - u) / 0.15; }
    case 'packet': {
      const M = Math.max(2, num(f.sets, 4));
      return clamp01(0.5 + 0.25 * (Math.cos(TAU * (t / P - k * q)) + Math.cos(TAU * (t / (P * (1 + 1 / M)) - k * q))));
    }
    case 'bounce': {
      const e = 0.6, T0 = P / (1 + e + e * e + e * e * e);
      let tau = frac((t - num(f.lag, 1) * q) / P) * P, n = 0, Tn = T0;
      while (n < 3 && tau > Tn) { tau -= Tn; n++; Tn *= e; }
      const u = clamp01(tau / Tn);
      return e ** (2 * n) * 4 * u * (1 - u);
    }
    case 'ringdown': {
      const tau = frac((t - 0.25 * P * ro) / P) * P;
      return clamp01(0.5 + 0.5 * Math.exp(-tau / Math.max(0.2, num(f.decay, 1.5))) * Math.cos(TAU * tau / (P / 3)));
    }
    case 'surf': {
      const tp = frac(t / P), run = 0.7;
      if (tp < run) {                                    // the wave runs in: steep front, long back
        const xi = ro - tp / run;
        return xi > 0 ? Math.exp(-xi / 0.06) : 0.25 + 0.75 * Math.exp(xi / 0.35);
      }
      const after = (tp - run) / (1 - run);              // break → white water washes out
      return clamp01((1 - after) * (0.55 + 0.45 * flowNoise(nx * 4, ny * 4, t * 3)));
    }
    case 'bore': {
      const xi = ro - frac(t / P) * 1.4;
      return xi > 0 ? Math.exp(-xi / 0.04) * 0.9 : clamp01(0.62 + 0.28 * Math.cos(TAU * xi * 7) * Math.exp(xi / 0.45));
    }
    case 'firework': {
      const tau = frac(t / P) * P;
      const radius = 1 - Math.exp(-tau / (0.12 * P));
      return clamp01(gauss(ro - radius, 0.1) * Math.exp(-tau / Math.max(0.2, num(f.decay, 1.2))) * 1.05);
    }
    case 'flame': return clamp01(0.3 + 0.7 * flowNoise(nx * 3 + 5, ny * 3 + (t / P) * 0.6, t * 2.4 / P) ** 1.3);
    case 'heartbeat2': {
      const tau = frac(t / P), w = Math.max(0.04, num(f.width, 0.12));
      return gauss(tau - (g.i % 2 ? 0.32 : 0.06), w / 2) + gauss(tau - 1 - (g.i % 2 ? 0.32 : 0.06), w / 2);
    }
    default: return null;
  }
}
