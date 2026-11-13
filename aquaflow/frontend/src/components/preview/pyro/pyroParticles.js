/**
 * Firework and special-effect particles as a pure function of show time: every spark's position is
 * closed-form ballistics with linear air drag, p(τ) = p0 + v0·(1−e^{−kτ})/k + a·(τ − (1−e^{−kτ})/k)/k,
 * and continuous emitters derive each spark from its birth time, so the live preview and a baked
 * video render the same frame for the same time, with no simulation state.
 *
 * cue (show/pyro.js pyroCuesFromClips):
 *   pyro { id, x, y0, z, rot, ignition, product }      — one firing cue
 *   sfx  { id, x, y0, z, rot, sfx: true, segments, … } — a DMX special effect, level from its clips
 * Output arrays are filled from 0; returns { count, flash: { r, g, b, intensity, x, y, z } }.
 */
import { sfxLevel } from "../../../show/pyro.js";

const G = 9.81;
const TAU = Math.PI * 2;
const TRAIL_DT = 0.045;

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rnd(seed, i, salt = 0) {
  let h = (seed ^ Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hexRgb = (hex) => { const v = parseInt(String(hex || "#ffffff").slice(1), 16); const c = Number.isFinite(v) ? v : 0xffffff; return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]; };
const mix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

/** Position along one axis after t s with drag k (1/s) and acceleration a. */
const along = (p0, v0, a, k, t) => { if (k < 1e-6) return p0 + v0 * t + 0.5 * a * t * t; const e = (1 - Math.exp(-k * t)) / k; return p0 + v0 * e + (a * (t - e)) / k; };

/**
 * Burst tuning: stars per burst, drag k (1/s), trail samples, star glow size (m), speed factor.
 * Star sizes are the visible glow (a burning star reads ~1–2 m wide at display distance).
 */
const BURST = {
  peony:         { stars: 140, k: 2.6, trail: 3,  size: 1.3, speed: 1.05 },
  chrysanthemum: { stars: 120, k: 2.2, trail: 5,  size: 1.1, speed: 1.05 },
  dahlia:        { stars: 44,  k: 2.0, trail: 7,  size: 2.0, speed: 1.0 },
  willow:        { stars: 110, k: 1.5, trail: 7,  size: 1.1, speed: 0.85, tailColor: 0 },
  kamuro:        { stars: 96,  k: 1.9, trail: 11, size: 1.15, speed: 0.8, tailColor: 0, hang: true },
  palm:          { stars: 14,  k: 1.3, trail: 12, size: 2.0, speed: 0.95, lift: 0.45 },
  crossette:     { stars: 10,  k: 1.6, trail: 5,  size: 1.6, speed: 0.7, split: 0.65, parts: 4 },
  strobe:        { stars: 100, k: 2.6, trail: 0,  size: 1.5, speed: 1.0, strobe: 14 },
  ring:          { stars: 72,  k: 2.4, trail: 3,  size: 1.4, speed: 1.0, shape: "ring" },
  heart:         { stars: 80,  k: 2.4, trail: 2,  size: 1.4, speed: 1.0, shape: "heart" },
  star:          { stars: 80,  k: 2.4, trail: 2,  size: 1.4, speed: 1.0, shape: "star" },
  smiley:        { stars: 84,  k: 2.4, trail: 2,  size: 1.4, speed: 1.0, shape: "smiley" },
  horsetail:     { stars: 80,  k: 0.7, trail: 9,  size: 1.0, speed: 0.55, up: true },
  crackling:     { stars: 70,  k: 2.4, trail: 2,  size: 0.9, speed: 0.95, crackle: true },
  salute:        { stars: 36,  k: 4.0, trail: 0,  size: 0.7, speed: 1.4, report: true },
  multibreak:    { stars: 70,  k: 2.6, trail: 3,  size: 1.2, speed: 1.0 },
  colorchange:   { stars: 120, k: 2.4, trail: 3,  size: 1.3, speed: 1.0, change: true },
  comettail:     { stars: 120, k: 2.4, trail: 4,  size: 1.2, speed: 1.0 },
  mine:          { stars: 120, k: 1.4, trail: 4,  size: 1.1, speed: 1.1, cone: 0.42 },
};

/** Continuous emitters: sparks/s, spark life (s), trail samples, size (m), cone half-angle (rad). */
const EMIT = {
  gerb:          { rate: 70,  life: 0.9, trail: 2, size: 0.35, cone: 0.2, k: 0.6 },
  waterfall:     { rate: 26,  life: 1.6, trail: 2, size: 0.3, k: 0.9 },         // per metre of width
  wheel:         { rate: 160, life: 0.55, trail: 2, size: 0.3, k: 1.2 },
  coldspark:     { rate: 260, life: 0.8, trail: 1, size: 0.13, cone: 0.07, k: 0.4 },
  coldsparkfall: { rate: 220, life: 1.1, trail: 1, size: 0.13, k: 0.4 },
  flame:         { rate: 90,  life: 0.55, trail: 0, size: 1.1, cone: 0.06, k: 1.6 },
  co2:           { rate: 110, life: 1.1, trail: 0, size: 1.4, cone: 0.1, k: 2.6 },
  smoke:         { rate: 18,  life: 6.0, trail: 0, size: 3.2, k: 0.8 },
  haze:          { rate: 8,   life: 9.0, trail: 0, size: 6.0, k: 0.5 },
};
const CONFETTI = { pieces: 260, life: 9, size: 0.16, k: 2.6 };
const STREAMER = { pieces: 60, life: 10, size: 0.22, k: 1.8, trail: 4 };

const PLANAR = {
  ring: (u) => [Math.cos(u * TAU), Math.sin(u * TAU)],
  heart: (u) => { const a = u * TAU; return [(16 * Math.sin(a) ** 3) / 17, (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17]; },
  star: (u) => {
    const k = u * 10, i = Math.floor(k) % 10, f = k - Math.floor(k);
    const pt = (j) => { const r = j % 2 ? 0.42 : 1, a = Math.PI / 2 + (j * Math.PI) / 5; return [Math.cos(a) * r, Math.sin(a) * r]; };
    const a = pt(i), b = pt(i + 1);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  },
  smiley: (u) => {
    if (u < 0.6) { const a = (u / 0.6) * TAU; return [Math.cos(a), Math.sin(a)]; }
    if (u < 0.7) { const a = ((u - 0.6) / 0.1) * TAU; return [-0.35 + Math.cos(a) * 0.08, 0.3 + Math.sin(a) * 0.08]; }
    if (u < 0.8) { const a = ((u - 0.7) / 0.1) * TAU; return [0.35 + Math.cos(a) * 0.08, 0.3 + Math.sin(a) * 0.08]; }
    const a = Math.PI * (1.15 + ((u - 0.8) / 0.2) * 0.7); return [Math.cos(a) * 0.55, Math.sin(a) * 0.55];
  },
};

/** Default lancework outline: a 5-pointed star, unit size (x across, y up). */
const DEFAULT_LANCE = Array.from({ length: 11 }, (_, j) => { const r = j % 2 ? 0.42 : 1, a = Math.PI / 2 + (j * Math.PI) / 5; return [Math.cos(a) * r * 0.5, 0.5 + Math.sin(a) * r * 0.5]; });

/** Unit vector, Fibonacci-sphere distributed with a deterministic jitter. */
function sphereDir(i, n, seed) {
  const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * 2.399963229728653 + rnd(seed, i, 3) * 0.35;
  return [Math.cos(a) * r, y, Math.sin(a) * r];
}

const span = (p) => (Math.max(1, p.shots || 1) - 1) * (p.intervalS || 0) + (p.liftTimeS || 0) + (p.durationS || 1);
const burstCost = (effect, k = 1) => { const fx = BURST[effect] || BURST.peony; return Math.ceil(fx.stars * k * (fx.parts || 1) * (fx.trail + 1)) + (fx.crackle ? fx.stars * 3 : 0) + 8; };

/** Particles a cue would draw at full budget (used to share the budget fairly). */
export function cueParticleCost(cue, t) {
  const p = cue.product || {};
  if (cue.sfx) {
    if (t < cue.ignition || t > (cue.end || 0) + 10) return 0;
    if (p.effect === "confetti") return CONFETTI.pieces;
    if (p.effect === "streamer") return STREAMER.pieces * (STREAMER.trail + 1);
    const e = EMIT[p.effect] || EMIT.coldspark;
    return Math.ceil(e.rate * e.life * (e.trail + 1));
  }
  const age = t - cue.ignition;
  if (age < 0 || age > span(p) + 0.5) return 0;
  switch (p.kind) {
    case "gerb": return Math.ceil(EMIT.gerb.rate * EMIT.gerb.life * 3);
    case "waterfall": return Math.ceil(EMIT.waterfall.rate * Math.max(1, p.widthM || 10) * EMIT.waterfall.life * 3);
    case "wheel": return Math.ceil(EMIT.wheel.rate * EMIT.wheel.life * 3);
    case "lancework": return 260;
    case "comet": return p.effect === "crossettecomet" ? 4 * 6 * 4 + 20 : 17;
    case "candle": return 8 * 6;
    case "swimmer": return Math.max(1, p.shots || 1) * 40;
    case "proximate": return p.effect === "gerb" ? Math.ceil(EMIT.gerb.rate * EMIT.gerb.life * 3) : 160;
    case "watershell": return 120 * 4;
    case "mine": return burstCost("mine") + (p.crackle ? 200 : 0);
    case "cake": {
      const live = Math.min(p.shots || 1, Math.ceil(((p.durationS || 1) + (p.liftTimeS || 0)) / Math.max(0.03, p.intervalS || 1)) + 1);
      return live * Math.ceil(burstCost(p.effect, 0.35));
    }
    default: return burstCost(p.effect) * Math.max(1, p.breaks || 1) + 8;
  }
}

export function fillPyroParticles(cues, t, { budget = 12000 } = {}, out) {
  const cap = Math.min(budget, out.size.length);
  let n = 0;
  const flash = { r: 0, g: 0, b: 0, intensity: 0, x: 0, y: 0, z: 0 };
  let fw = 0;
  const live = cues.filter((c) => cueParticleCost(c, t) > 0);
  const want = live.reduce((s, c) => s + cueParticleCost(c, t), 0);
  const scale = want > cap ? cap / want : 1;

  const push = (x, y, z, rgb, bright, size) => {
    if (n >= cap || bright <= 0.003) return;
    out.pos[n * 3] = x; out.pos[n * 3 + 1] = y; out.pos[n * 3 + 2] = z;
    out.col[n * 3] = rgb[0] * bright; out.col[n * 3 + 1] = rgb[1] * bright; out.col[n * 3 + 2] = rgb[2] * bright;
    out.size[n] = size; n++;
  };
  const addFlash = (x, y, z, rgb, w) => { flash.r += rgb[0] * w; flash.g += rgb[1] * w; flash.b += rgb[2] * w; flash.x += x * w; flash.y += y * w; flash.z += z * w; fw += w; };
  const LAUNCH = hexRgb("#ffc890"), WHITE = [1, 1, 1];
  const count = (k) => Math.max(1, Math.round(k * scale));

  /** A ballistic spark with a fading trail. */
  const spark = (p0, v, k, ay, tq0, rgb, bright, size, trail, dt = TRAIL_DT) => {
    for (let q = 0; q <= trail; q++) {
      const tq = tq0 - q * dt; if (tq < 0) break;
      push(along(p0[0], v[0], 0, k, tq), along(p0[1], v[1], ay, k, tq), along(p0[2], v[2], 0, k, tq), rgb, bright * (1 - q / (trail + 1)) * (q ? 0.8 : 1.2), q ? size * 0.7 : size);
    }
  };

  /** Rising shell / comet head from (x, y0, z) to (bx, by, bz) over `total` seconds. */
  const rise = (cue, bx, by, bz, age, total, rgb, trail, size, fadeEnd = false) => {
    for (let q = 0; q <= trail; q++) {
      const a = age - q * TRAIL_DT; if (a < 0) break;
      const u = Math.min(1, a / Math.max(0.05, total)), e = 1 - (1 - u) * (1 - u);
      const fade = (1 - q / (trail + 1)) * (fadeEnd && age > total * 0.85 ? Math.max(0, 1 - (age - total * 0.85) / (total * 0.15)) : 1);
      push(cue.x + (bx - cue.x) * e, cue.y0 + (by - cue.y0) * e, cue.z + (bz - cue.z) * e, rgb, fade * (q === 0 ? 1.6 : 0.8), q === 0 ? size * 0.8 : size * 0.5);
    }
  };

  /** One aerial burst of `effect` at (bx, by, bz), `b` s after the break. */
  const burst = (cue, seed, effect, bx, by, bz, b, R, dur, colors, k = 1, salt = 0) => {
    const fx = BURST[effect] || BURST.peony;
    if (b < 0 || b > dur + (fx.crackle ? 0.4 : 0)) return;
    if (b <= 0.45) addFlash(bx, by, bz, colors[0], (1 - b / 0.45) * Math.min(3, R / 10) * k * (fx.report ? 3 : 1));
    const n0 = count(fx.stars * k), v0 = R * fx.k * fx.speed;
    const fadeOf = (a) => { const u = a / dur; return u >= 1 ? 0 : (1 - u * u) * (0.85 + 0.15 * Math.sin(a * 23 + seed)); };
    const ax = Math.cos(cue.rot || 0), az = Math.sin(cue.rot || 0);   // planar shapes face across this axis
    for (let i = 0; i < n0; i++) {
      let dx, dy, dz;
      if (fx.shape) {
        const [px, py] = PLANAR[fx.shape]((i + rnd(seed, i, 11 + salt) * 0.2) / n0);
        dx = px * ax; dz = px * az; dy = py;
      } else {
        [dx, dy, dz] = sphereDir(i, n0, seed + salt);
        if (fx.lift) { dy += fx.lift; const m = Math.hypot(dx, dy, dz); dx /= m; dy /= m; dz /= m; }
        if (fx.up) { dy = Math.abs(dy) * 0.9 + 0.1; const m = Math.hypot(dx, dy, dz); dx /= m; dy /= m; dz /= m; }
      }
      const sp = v0 * (fx.shape ? 1 : 0.88 + 0.24 * rnd(seed, i, 6 + salt));
      const v = [dx * sp, dy * sp, dz * sp];
      let rgb = hexRgb(colors[i % colors.length]);
      if (fx.change && colors.length > 1) rgb = mix(hexRgb(colors[0]), hexRgb(colors[1]), Math.min(1, Math.max(0, (b / dur - 0.4) / 0.15)));
      const ay = fx.hang ? -G * 0.55 : -G;

      if (fx.split && b > fx.split) {
        // Crossette: each comet breaks into `parts` stars at the split time.
        const at = (tq) => [along(bx, v[0], 0, fx.k, tq), along(by, v[1], ay, fx.k, tq), along(bz, v[2], 0, fx.k, tq)];
        const s = at(fx.split), e = Math.exp(-fx.k * fx.split), g = (G / fx.k) * (1 - e);
        const u = [v[0] * e, v[1] * e - g, v[2] * e], bb = b - fx.split, fade = fadeOf(b);
        for (let m = 0; m < fx.parts; m++) {
          const ang = (m / fx.parts) * TAU + rnd(seed, i, 9), kick = v0 * 0.45;
          spark(s, [u[0] + Math.cos(ang) * kick, u[1] + Math.sin(ang) * kick * 0.7, u[2] + Math.sin(ang) * kick], fx.k, -G, bb, hexRgb(colors[(i + m + 1) % colors.length]), fade, fx.size * 0.7, 2);
        }
        continue;
      }
      let bright = fadeOf(b);
      if (fx.strobe) bright *= rnd(seed, i, Math.floor(b * fx.strobe)) > 0.45 ? 1.6 : 0;
      if (fx.report) bright *= b < 0.15 ? 2 : 0.6;
      const tail = fx.tailColor !== undefined ? hexRgb(colors[fx.tailColor]) : rgb;
      for (let q = 0; q <= fx.trail; q++) {
        const tq = b - q * TRAIL_DT * (fx.hang ? 4 : 1); if (tq < 0) break;   // kamuro: long hanging brocade trails
        push(along(bx, v[0], 0, fx.k, tq), along(by, v[1], ay, fx.k, tq), along(bz, v[2], 0, fx.k, tq), q ? tail : rgb, bright * (1 - q / (fx.trail + 1)) * (q ? 0.8 : 1.25), q ? fx.size * 0.7 : fx.size);
      }
      // Crackling: late in its life each star pops into a few white flashes.
      if (fx.crackle) {
        const pop = dur * (0.55 + 0.35 * rnd(seed, i, 13)), pb = b - pop;
        if (pb >= 0 && pb < 0.25) {
          const at = [along(bx, v[0], 0, fx.k, pop), along(by, v[1], -G, fx.k, pop), along(bz, v[2], 0, fx.k, pop)];
          for (let m = 0; m < 3; m++) {
            const [ox, oy, oz] = sphereDir(m, 3, seed + i);
            push(at[0] + ox * pb * 6, at[1] + oy * pb * 6, at[2] + oz * pb * 6, WHITE, (1 - pb / 0.25) * 1.8, 0.6);
          }
        }
      }
    }
  };

  /** Continuous emitter: sparks born at j/rate over [start, end]; `make(j, born, a)` draws one spark aged `a`. */
  const emit = (seed, rate, life, start, end, make) => {
    const r = rate * Math.max(0.15, scale);
    const first = Math.max(Math.ceil(start * r), Math.floor((t - life) * r)), last = Math.floor(Math.min(t, end) * r);
    for (let j = first; j <= last; j++) {
      const born = j / r, a = t - born;
      if (a < 0 || a > life || born < start) continue;
      make(j, born, a);
    }
  };

  for (const cue of live) {
    const p = cue.product || {}, seed = hashStr(String(cue.id));
    const colors = p.colors?.length ? p.colors : ["#ffffff"];
    const rgbs = colors.map(hexRgb);
    const ax = Math.cos(cue.rot || 0), az = Math.sin(cue.rot || 0);

    // ── DMX special effects: level from the effect's clips ───────────────────
    if (cue.sfx) {
      const lvl = (tt) => sfxLevel(cue, tt), H = Math.max(0.5, p.heightM || 3);
      const e = EMIT[p.effect] || EMIT.coldspark;
      if (p.effect === "confetti" || p.effect === "streamer") {
        // Each switch-on fires one load; flakes rise to the throw height, then flutter down.
        const cfg = p.effect === "confetti" ? CONFETTI : STREAMER;
        for (const [s] of cue.segments || []) {
          const a0 = t - s;
          if (a0 < 0 || a0 > cfg.life) continue;
          const pieces = count(cfg.pieces), v0 = Math.sqrt(2 * G * H) * 1.25;
          for (let i = 0; i < pieces; i++) {
            const th = rnd(seed, i, 1) * TAU, sp = rnd(seed, i, 2) * 0.35;
            const v = [Math.sin(sp) * Math.cos(th) * v0, Math.cos(sp) * v0, Math.sin(sp) * Math.sin(th) * v0];
            const k = cfg.k * (0.8 + 0.4 * rnd(seed, i, 4)), sway = Math.sin(a0 * 3 + i) * 0.4 * Math.min(1, a0);
            const y = Math.max(0.05, along(cue.y0, v[1], -G, k, a0));
            const flicker = 0.55 + 0.45 * Math.abs(Math.sin(a0 * 7 + i * 1.7));
            const fade = a0 > cfg.life - 1 ? cfg.life - a0 : 1;
            if (cfg.trail) spark([cue.x + sway, cue.y0, cue.z], v, k, -G, a0, rgbs[i % rgbs.length], flicker * fade, cfg.size, cfg.trail, 0.08);
            else push(along(cue.x, v[0], 0, k, a0) + sway, y, along(cue.z, v[2], 0, k, a0), rgbs[i % rgbs.length], flicker * fade, cfg.size);
          }
        }
        continue;
      }
      emit(seed, e.rate, e.life, cue.ignition, cue.end, (j, born, a) => {
        const l = lvl(born); if (l <= 0.02) return;
        const th = rnd(seed, j, 1) * TAU, rgb = rgbs[j % rgbs.length];
        if (p.effect === "coldsparkfall") {
          const v = [Math.cos(th) * 0.4, -0.5, Math.sin(th) * 0.4];
          spark([cue.x, Math.max(H, cue.y0), cue.z], v, e.k, -G, a, rgb, (1 - a / e.life) * 1.3 * l, e.size, e.trail, 0.03);
          return;
        }
        if (p.effect === "smoke" || p.effect === "haze") {
          const rr = (p.effect === "haze" ? 6 : 2.5) * Math.sqrt(a) * (0.5 + rnd(seed, j, 2));
          const up = p.effect === "haze" ? H * (a / e.life) : Math.min(H, 0.4 * a);
          push(cue.x + Math.cos(th) * rr, cue.y0 + up + 0.2, cue.z + Math.sin(th) * rr, rgb, 0.07 * l * Math.sin(Math.PI * a / e.life), e.size * (0.6 + a / e.life));
          return;
        }
        const sp = rnd(seed, j, 2) * e.cone, v0 = Math.sqrt(2 * G * H * l) * (p.effect === "co2" ? 2.2 : p.effect === "flame" ? 1.5 : 1.08);
        const v = [Math.sin(sp) * Math.cos(th) * v0, Math.cos(sp) * v0 * (0.85 + 0.15 * rnd(seed, j, 4)), Math.sin(sp) * Math.sin(th) * v0];
        const u = a / e.life;
        if (p.effect === "flame") {
          const c = mix(rgbs[1] || rgbs[0], rgbs[0], u);
          push(along(cue.x, v[0], 0, e.k, a), cue.y0 + Math.min(H * l, along(0, v[1], 3, e.k, a)), along(cue.z, v[2], 0, e.k, a), mix(c, [0.6, 0.08, 0], u * u), (1 - u) * 1.6, e.size * (1 - 0.5 * u) * (0.5 + l));
          if (j % 9 === 0) addFlash(cue.x, cue.y0 + H * l * 0.5, cue.z, rgbs[0], 0.04 * l);
          return;
        }
        if (p.effect === "co2") {
          const spread = 0.6 + 2.2 * u;
          push(along(cue.x, v[0] * spread, 0, e.k, a), cue.y0 + along(0, v[1], -1, e.k, a), along(cue.z, v[2] * spread, 0, e.k, a), rgb, 0.22 * (1 - u) * l, e.size * (0.4 + 1.6 * u));
          return;
        }
        spark([cue.x, cue.y0, cue.z], v, e.k, -G, a, rgb, (1 - u) * 1.5, e.size, e.trail, 0.025);   // cold spark
      });
      if (lvl(t) > 0.02 && p.effect === "coldspark") addFlash(cue.x, cue.y0 + H * 0.5, cue.z, rgbs[0], 0.05 * lvl(t));
      continue;
    }

    const H = Math.max(1, p.burstHeightM || 30), R = Math.max(0.5, p.burstRadiusM || H * 0.35);
    const lift = Math.max(0, p.liftTimeS || 0), dur = Math.max(0.2, p.durationS || 1.5);
    const shots = Math.max(1, p.shots || 1), interval = p.intervalS || 0;
    const age = t - cue.ignition;

    switch (p.kind === "proximate" ? p.effect : p.kind) {
      case "gerb": {
        const e = EMIT.gerb, v0 = Math.sqrt(2 * G * H) * 1.15;
        emit(seed, e.rate, e.life, cue.ignition, cue.ignition + dur, (j, born, a) => {
          const th = rnd(seed, j, 1) * TAU, sp = rnd(seed, j, 2) * e.cone;
          const v = [Math.sin(sp) * Math.cos(th) * v0, Math.cos(sp) * v0 * (0.75 + 0.25 * rnd(seed, j, 4)), Math.sin(sp) * Math.sin(th) * v0];
          spark([cue.x, cue.y0, cue.z], v, e.k, -G, a, rgbs[j % rgbs.length], (1 - a / e.life) * 1.4, e.size, e.trail, TRAIL_DT * 0.5);
          if (p.crackle && a > e.life * 0.7 && j % 4 === 0) push(along(cue.x, v[0], 0, e.k, a), along(cue.y0, v[1], -G, e.k, a), along(cue.z, v[2], 0, e.k, a), WHITE, 1.8, 0.5);
        });
        if (age <= dur) addFlash(cue.x, cue.y0 + H * 0.5, cue.z, rgbs[0], 0.25);
        break;
      }
      case "waterfall": {
        // A curtain: a line of fuses at height H along the position's axis, sparks falling to the ground.
        const W = Math.max(1, p.widthM || 10), e = EMIT.waterfall;
        emit(seed, e.rate * W, e.life, cue.ignition, cue.ignition + dur, (j, born, a) => {
          const s = (rnd(seed, j, 1) - 0.5) * W, v = [rnd(seed, j, 2) * 0.6 - 0.3, -0.4 - rnd(seed, j, 3), rnd(seed, j, 5) * 0.6 - 0.3];
          spark([cue.x + ax * s, cue.y0 + H, cue.z + az * s], v, e.k, -G, a, rgbs[j % rgbs.length], (1 - a / e.life) * 1.3, e.size, e.trail, 0.05);
        });
        if (age <= dur) addFlash(cue.x, cue.y0 + H * 0.6, cue.z, rgbs[0], 0.3);
        break;
      }
      case "wheel": {
        // Six drivers spinning in a vertical plane, throwing sparks along the rim's tangent.
        const r = Math.max(0.3, (p.diameterM || 1.5) / 2), w = 7, e = EMIT.wheel, cy = cue.y0 + H;
        emit(seed, e.rate, e.life, cue.ignition, cue.ignition + dur, (j, born, a) => {
          const ang = born * w + (j % 6) * (TAU / 6), cs = Math.cos(ang), sn = Math.sin(ang);
          const p0 = [cue.x + ax * r * cs, cy + r * sn, cue.z + az * r * cs];
          const vt = r * w * 1.6, v = [-ax * sn * vt, cs * vt, -az * sn * vt];
          spark(p0, v, e.k, -G, a, rgbs[j % rgbs.length], (1 - a / e.life) * 1.5, e.size, e.trail, 0.03);
        });
        if (age >= 0 && age <= dur) {
          for (let m = 0; m < 6; m++) { const ang = age * w + m * (TAU / 6); push(cue.x + ax * r * Math.cos(ang), cy + r * Math.sin(ang), cue.z + az * r * Math.cos(ang), WHITE, 2, 0.45); }
          addFlash(cue.x, cy, cue.z, rgbs[0], 0.2);
        }
        break;
      }
      case "lancework": {
        // Lances burning along the outline (engineering.lanceOutline, else a star) in a vertical plane.
        if (age < 0 || age > dur) break;
        const pts = Array.isArray(p.outline) && p.outline.length >= 2 ? p.outline : DEFAULT_LANCE;
        const W = Math.max(1, p.widthM || 6), lances = count(220);
        const segLen = []; let total = 0;
        for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segLen.push(d); total += d; }
        const ignite = Math.min(1, age / 0.6), endFade = age > dur - 2 ? Math.max(0, (dur - age) / 2) : 1;
        for (let i = 0; i < lances; i++) {
          let s = (i / lances) * total, k = 0;
          while (k < segLen.length - 1 && s > segLen[k]) { s -= segLen[k]; k++; }
          const u = segLen[k] ? s / segLen[k] : 0, a = pts[k], b = pts[k + 1] || a;
          const lx = (a[0] + (b[0] - a[0]) * u) * W, ly = (a[1] + (b[1] - a[1]) * u) * W;
          if (i / lances > ignite) continue;
          const flick = 0.75 + 0.25 * Math.sin(age * 31 + i * 2.1);
          push(cue.x + ax * lx, cue.y0 + 0.5 + ly, cue.z + az * lx, rgbs[i % rgbs.length], flick * endFade * 1.4, 0.32);
        }
        addFlash(cue.x, cue.y0 + W * 0.5, cue.z, rgbs[0], 0.35 * endFade);
        break;
      }
      case "flashpot": {
        if (age < 0 || age > dur + 0.6) break;
        if (age < 0.25) addFlash(cue.x, cue.y0 + H * 0.5, cue.z, WHITE, 6 * (1 - age / 0.25));
        const nn = count(120), v0 = Math.sqrt(2 * G * H) * 1.1;
        for (let i = 0; i < nn; i++) {
          const th = rnd(seed, i, 1) * TAU, sp = rnd(seed, i, 2) * 0.5;
          const v = [Math.sin(sp) * Math.cos(th) * v0, Math.cos(sp) * v0, Math.sin(sp) * Math.sin(th) * v0];
          spark([cue.x, cue.y0, cue.z], v, 3, -G, age, rgbs[i % rgbs.length], Math.max(0, 1 - age / (dur + 0.6)) * 2, i < 12 ? 1.6 : 0.4, 1);
        }
        break;
      }
      case "airburst": {
        if (age < 0) break;
        if (age < lift) { rise(cue, cue.x, cue.y0 + H, cue.z, age, lift, LAUNCH, 3, 0.6); break; }
        burst(cue, seed, "peony", cue.x, cue.y0 + H, cue.z, age - lift, R, dur, colors, 0.6);
        break;
      }
      case "watershell": {
        // Bursts AT the water surface: a half-sphere of stars and a bright reflection.
        if (age < lift) break;
        const b = age - lift; if (b > dur) break;
        if (b <= 0.4) addFlash(cue.x, 0.5, cue.z, rgbs[0], (1 - b / 0.4) * Math.min(3, R / 8));
        const nn = count(120), k = 2.2, v0 = R * k;
        for (let i = 0; i < nn; i++) {
          let [dx, dy, dz] = sphereDir(i, nn, seed); dy = Math.abs(dy);
          const fade = (1 - (b / dur) ** 2);
          spark([cue.x, 0.05, cue.z], [dx * v0, dy * v0, dz * v0], k, -G, b, rgbs[i % rgbs.length], fade, 0.5, 4);
          push(along(cue.x, dx * v0, 0, k, b), 0.03, along(cue.z, dz * v0, 0, k, b), rgbs[i % rgbs.length], fade * 0.35, 0.4);   // reflection
        }
        break;
      }
      case "swimmer": {
        // Water comets skim across the surface with a weave, throwing spray; fish swarms fan out.
        const range = Math.max(2, p.rangeM || 30);
        for (let s = 0; s < shots; s++) {
          const a = age - s * interval; if (a < 0 || a > dur) continue;
          const dirA = p.effect === "fish" ? (rnd(seed, s, 1) - 0.5) * 2.4 : 0;
          const dx = Math.cos((cue.rot || 0) + dirA), dz = Math.sin((cue.rot || 0) + dirA);
          const u = a / dur, d = range * (1 - (1 - u) ** 1.6), weave = Math.sin(a * 9 + s) * 0.6;
          const hx = cue.x + dx * d - dz * weave, hz = cue.z + dz * d + dx * weave;
          push(hx, 0.15, hz, rgbs[s % rgbs.length], 2, p.effect === "fish" ? 0.35 : 0.7);
          for (let q = 1; q <= 30; q++) {
            const back = q * 0.12, sx = hx - dx * back * (p.effect === "fish" ? 0.6 : 1.2), sz = hz - dz * back * (p.effect === "fish" ? 0.6 : 1.2);
            push(sx, 0.1 + rnd(seed, s * 31 + q, 7) * 0.6 * (1 - q / 31), sz, rgbs[(s + q) % rgbs.length], (1 - q / 31) * (1 - u * 0.5), 0.25);
          }
          if (p.effect !== "fish") addFlash(hx, 0.4, hz, rgbs[0], 0.15);
        }
        break;
      }
      case "comet": {
        const top = [cue.x, cue.y0 + H, cue.z];
        if (age <= dur) rise(cue, top[0], top[1], top[2], age, dur, rgbs[0], 16, 1.6, p.effect !== "crossettecomet");
        if (p.effect === "crossettecomet" && age > dur) {
          const b = age - dur, life = 1.4; if (b > life) break;
          for (let m = 0; m < 4; m++) {
            const ang = (m / 4) * TAU + rnd(seed, m, 9), v0 = Math.max(4, R * 1.6);
            spark(top, [Math.cos(ang) * ax * v0, v0 * 0.5, Math.cos(ang) * az * v0 + Math.sin(ang) * v0 * 0.6], 1.2, -G, b, rgbs[m % rgbs.length], (1 - b / life) * 1.5, 1.2, 6);
          }
          if (b < 0.3) addFlash(top[0], top[1], top[2], rgbs[0], 0.8);
        }
        break;
      }
      case "candle": {
        // Roman candle: star balls fired one after another, no break.
        const v0 = Math.sqrt(2 * G * H) * 1.05;
        for (let s = 0; s < shots; s++) {
          const a = age - s * interval; if (a < 0 || a > dur) continue;
          spark([cue.x, cue.y0, cue.z], [ax * (s % 2 ? 0.6 : -0.6), v0, az * (s % 2 ? 0.6 : -0.6)], 0.25, -G, a, rgbs[s % rgbs.length], (1 - (a / dur) ** 3) * 1.6, 1.4, 5);
        }
        break;
      }
      case "mine": {
        const y0 = cue.y0 + (p.fromHeightM || 0);
        if (p.fromHeightM && age < lift) { rise(cue, cue.x, y0, cue.z, age, lift, LAUNCH, 5, 1); break; }
        const b = age - (p.fromHeightM ? lift : 0); if (b < 0 || b > dur + 0.4) break;
        if (b <= 0.4) addFlash(cue.x, y0 + 3, cue.z, rgbs[0], (1 - b / 0.4) * 1.5);
        const fx = BURST.mine, nn = count(fx.stars), vm = H * fx.k * fx.speed;
        for (let i = 0; i < nn; i++) {
          const th = rnd(seed, i, 1) * TAU, sp = Math.sqrt(rnd(seed, i, 2)) * fx.cone;
          const v = [Math.sin(sp) * Math.cos(th) * vm, Math.cos(sp) * vm * (0.8 + 0.2 * rnd(seed, i, 5)), Math.sin(sp) * Math.sin(th) * vm];
          const fade = b / dur >= 1 ? 0 : 1 - (b / dur) ** 2;
          spark([cue.x, y0, cue.z], v, fx.k, -G, b, rgbs[i % rgbs.length], fade * 1.3, fx.size, fx.trail);
          if (p.crackle && b > dur * 0.6 && i % 2 === 0) {
            const pt = [along(cue.x, v[0], 0, fx.k, b), along(y0, v[1], -G, fx.k, b), along(cue.z, v[2], 0, fx.k, b)];
            push(pt[0] + Math.sin(b * 40 + i), pt[1], pt[2], WHITE, rnd(seed, i, Math.floor(b * 20)) > 0.5 ? 2 : 0, 0.5);
          }
        }
        break;
      }
      default: {
        // Shells, single shots and cakes: rise, then one (or several) bursts.
        for (let s = 0; s < shots; s++) {
          const ign = cue.ignition + s * interval, a = t - ign;
          if (a < 0 || a > lift + dur + 0.5) continue;
          let ang = 0;
          if (p.kind === "cake") {
            const fan = ((p.fanDeg || 0) * Math.PI) / 180, half = fan / 2;
            if (p.pattern === "fan") ang = shots > 1 ? -half + (fan * (s % 10)) / 9 : 0;
            else if (p.pattern === "vfan") ang = s % 2 ? half : -half;
            else if (p.pattern === "wfan") ang = [-half, 0, half, 0][s % 4];
            else if (p.pattern === "zipper") { const u = (s % 20) / 10; ang = -half + fan * (u <= 1 ? u : 2 - u); }
          }
          const off = Math.tan(ang) * H;
          const bx = cue.x + ax * off, by = cue.y0 + H, bz = cue.z + az * off;
          const k = p.kind === "cake" ? 0.35 : 1;
          if (a < lift) {
            const comet = p.effect === "comettail";
            rise(cue, bx, by, bz, a, lift, comet ? rgbs[0] : LAUNCH, comet ? 14 : 6, comet ? 1.4 : 1);
            continue;
          }
          const b = a - lift;
          const breaks = Math.max(1, p.breaks || 1);
          for (let m = 0; m < breaks; m++) {
            const bm = b - m * 0.45;
            const effect = p.effect === "multibreak" ? "multibreak" : p.effect;
            burst(cue, seed + s * 977, effect, bx, by - m * R * 0.5, bz, bm, R * (breaks > 1 ? 0.8 : 1), dur, breaks > 1 ? [colors[m % colors.length]] : colors, k, m);
          }
        }
      }
    }
  }
  if (fw > 0) {
    flash.x /= fw; flash.y /= fw; flash.z /= fw;
    const m = Math.max(flash.r, flash.g, flash.b) || 1;
    flash.r /= m; flash.g /= m; flash.b /= m;
    flash.intensity = Math.min(1, fw / 2);
  }
  return { count: n, flash };
}

/** The look each catalogue effect gets (for the tests and the effect list). */
export const PYRO_EFFECT_LOOKS = [
  ...Object.keys(BURST), "gerb", "waterfall", "wheel", "lancework", "flashpot", "airburst", "watershell", "swimmer", "fish",
  "comet", "crossettecomet", "candle", "coldspark", "coldsparkfall", "flame", "co2", "confetti", "streamer", "smoke", "haze",
];
