/**
 * Firework particles as a pure function of show time: every star's position is closed-form
 * ballistics with linear air drag, p(τ) = p0 + v0·(1−e^{−kτ})/k + g·(τ − (1−e^{−kτ})/k)/k, so the live
 * preview and a baked video render the same frame for the same time, with no simulation state.
 *
 * cue: { id, x, y0, z, ignition, product } (world metres, y up). Output arrays are filled from 0;
 * returns { count, flash: { r, g, b, intensity, x, y, z } }.
 */
const G = 9.81;
const TAU = Math.PI * 2;

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rnd(seed, i, salt = 0) {
  let h = (seed ^ Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hexRgb = (hex) => { const v = parseInt(String(hex || "#ffffff").slice(1), 16) || 0xffffff; return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };

/** Position along one axis after τ s with drag k (1/s) and acceleration a. */
const along = (p0, v0, a, k, t) => { const e = (1 - Math.exp(-k * t)) / k; return p0 + v0 * e + (a * (t - e)) / k; };

/** Effect tuning: stars per burst, drag, trail samples, star size (m), speed factor. */
const EFFECT = {
  // Star sizes are the visible glow (a burning star reads ~1–2 m wide at display distance), not the pellet.
  peony:         { stars: 140, k: 2.6, trail: 3, size: 1.3, speed: 1.05 },
  chrysanthemum: { stars: 120, k: 2.2, trail: 5, size: 1.1, speed: 1.05 },
  willow:        { stars: 110, k: 1.5, trail: 7, size: 1.1, speed: 0.85 },
  palm:          { stars: 14,  k: 1.3, trail: 12, size: 2.0, speed: 0.95, lift: 0.45 },
  crossette:     { stars: 10,  k: 1.6, trail: 5, size: 1.6, speed: 0.7, split: 0.65, parts: 4 },
  strobe:        { stars: 100, k: 2.6, trail: 0, size: 1.5, speed: 1.0, strobe: 14 },
  mine:          { stars: 120, k: 1.4, trail: 4, size: 1.1, speed: 1.1, cone: 0.42 },
  gerb:          { stars: 0,   k: 0.6, trail: 2, size: 0.35, rate: 70, life: 0.9, cone: 0.2 },
  comet:         { stars: 0,   k: 0,   trail: 16, size: 1.6 },
};
const TRAIL_DT = 0.045;

/** Unit vector, Fibonacci-sphere distributed with a deterministic jitter. */
function sphereDir(i, n, seed) {
  const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * 2.399963229728653 + rnd(seed, i, 3) * 0.35;
  return [Math.cos(a) * r, y, Math.sin(a) * r];
}

/** Particles a cue would draw at full budget (used to share the budget fairly). */
export function cueParticleCost(cue, t) {
  const p = cue.product || {}, fx = EFFECT[p.effect] || EFFECT.peony;
  const age = t - cue.ignition;
  if (age < 0) return 0;
  const shots = Math.max(1, p.shots || 1), span = (shots - 1) * (p.intervalS || 0) + (p.liftTimeS || 0) + (p.durationS || 1);
  if (age > span) return 0;
  if (p.effect === "gerb") return Math.ceil(fx.rate * fx.life) * (fx.trail + 1);
  if (p.effect === "comet") return fx.trail + 1;
  const perShot = (fx.stars * (fx.parts || 1) + fx.stars) * (fx.trail + 1) + 8;
  return p.kind === "cake" ? Math.min(shots, Math.ceil(((p.durationS || 1) + (p.liftTimeS || 0)) / Math.max(0.05, p.intervalS || 1)) + 1) * Math.ceil(perShot * 0.35) : perShot;
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
  const LAUNCH = hexRgb("#ffc890");

  for (const cue of live) {
    const p = cue.product || {}, fx = EFFECT[p.effect] || EFFECT.peony, seed = hashStr(String(cue.id));
    const colors = (p.colors?.length ? p.colors : ["#ffffff"]).map(hexRgb);
    const H = Math.max(1, p.burstHeightM || 30), R = Math.max(0.5, p.burstRadiusM || H * 0.35);
    const lift = Math.max(0, p.liftTimeS || 0), dur = Math.max(0.2, p.durationS || 1.5);
    const shots = Math.max(1, p.shots || 1), interval = p.intervalS || 0;
    const starCount = (k) => Math.max(1, Math.round(k * scale));

    if (p.effect === "gerb") {
      const life = fx.life, rate = fx.rate * Math.max(0.15, scale), age = t - cue.ignition;
      const v0 = Math.sqrt(2 * G * H) * 1.15;
      const first = Math.max(0, Math.floor((age - life) * rate)), last = Math.floor(Math.min(age, dur) * rate);
      for (let j = first; j <= last; j++) {
        const born = j / rate, a = age - born;
        if (a < 0 || a > life) continue;
        const th = rnd(seed, j, 1) * TAU, sp = rnd(seed, j, 2) * fx.cone;
        const vx = Math.sin(sp) * Math.cos(th) * v0, vz = Math.sin(sp) * Math.sin(th) * v0, vy = Math.cos(sp) * v0 * (0.75 + 0.25 * rnd(seed, j, 4));
        const rgb = colors[j % colors.length], fade = 1 - a / life;
        for (let q = 0; q <= fx.trail; q++) {
          const tq = Math.max(0, a - q * TRAIL_DT * 0.5);
          push(along(cue.x, vx, 0, fx.k, tq), along(cue.y0, vy, -G, fx.k, tq), along(cue.z, vz, 0, fx.k, tq), rgb, fade * (1 - q / (fx.trail + 1)) * 1.4, fx.size);
        }
      }
      if (age <= dur) addFlash(cue.x, cue.y0 + H * 0.5, cue.z, colors[0], 0.25);
      continue;
    }

    for (let s = 0; s < shots; s++) {
      const ign = cue.ignition + s * interval, age = t - ign;
      if (age < 0 || age > lift + dur) continue;
      const fan = p.kind === "cake" ? (((s % 5) / 4) - 0.5) * ((p.fanDeg || 0) * Math.PI / 180) : 0;
      const bx = cue.x + Math.tan(fan) * H, bz = cue.z, by = cue.y0 + H;
      const k = p.kind === "cake" ? 0.35 : 1;

      // Rising shell / comet head with its spark trail.
      if (age < lift || p.effect === "comet") {
        const trail = p.effect === "comet" ? fx.trail : 6;
        const total = p.effect === "comet" ? dur : lift;
        for (let q = 0; q <= trail; q++) {
          const u = Math.min(1, Math.max(0, (age - q * TRAIL_DT) / Math.max(0.05, total)));
          if (age - q * TRAIL_DT < 0) break;
          const e = 1 - (1 - u) * (1 - u);
          const fade = p.effect === "comet" ? (1 - q / (trail + 1)) * (age > total * 0.85 ? Math.max(0, 1 - (age - total * 0.85) / (total * 0.15)) : 1) : 1 - q / (trail + 1);
          push(cue.x + (bx - cue.x) * e, cue.y0 + (by - cue.y0) * e, cue.z, p.effect === "comet" ? colors[0] : LAUNCH, fade * (q === 0 ? 1.6 : 0.8), q === 0 ? fx.size * 0.8 : fx.size * 0.5);
        }
        if (p.effect === "comet") continue;
        if (age < lift) continue;
      }

      const b = age - lift;
      if (b <= 0.45) addFlash(bx, by, bz, colors[0], (1 - b / 0.45) * Math.min(3, R / 10) * k);
      const life = dur;
      const n0 = starCount(fx.stars * k);
      const v0 = R * fx.k * fx.speed;
      const fadeOf = (a) => { const u = a / life; return u >= 1 ? 0 : (1 - u * u) * (0.85 + 0.15 * Math.sin(a * 23 + seed)); };

      if (p.effect === "mine") {
        const vm = H * fx.k * fx.speed;
        for (let i = 0; i < n0; i++) {
          const th = rnd(seed, i, 1) * TAU, sp = Math.sqrt(rnd(seed, i, 2)) * fx.cone;
          const vx = Math.sin(sp) * Math.cos(th) * vm, vz = Math.sin(sp) * Math.sin(th) * vm, vy = Math.cos(sp) * vm * (0.8 + 0.2 * rnd(seed, i, 5));
          const rgb = colors[i % colors.length];
          for (let q = 0; q <= fx.trail; q++) {
            const tq = b - q * TRAIL_DT; if (tq < 0) break;
            push(along(cue.x, vx, 0, fx.k, tq), along(cue.y0, vy, -G, fx.k, tq), along(cue.z, vz, 0, fx.k, tq), rgb, fadeOf(b) * (1 - q / (fx.trail + 1)) * 1.3, fx.size);
          }
        }
        continue;
      }

      for (let i = 0; i < n0; i++) {
        let [dx, dy, dz] = sphereDir(i, n0, seed);
        if (fx.lift) { dy += fx.lift; const m = Math.hypot(dx, dy, dz); dx /= m; dy /= m; dz /= m; }
        const sp = v0 * (0.88 + 0.24 * rnd(seed, i, 6));
        const vx = dx * sp, vy = dy * sp, vz = dz * sp;
        const rgb = colors[i % colors.length];
        const at = (tq) => [along(bx, vx, 0, fx.k, tq), along(by, vy, -G, fx.k, tq), along(bz, vz, 0, fx.k, tq)];

        if (fx.split && b > fx.split) {
          // Crossette: each comet breaks into `parts` stars at the split time.
          const [sx, sy, sz] = at(fx.split);
          const e = Math.exp(-fx.k * fx.split), g = (G / fx.k) * (1 - e);
          const ux = vx * e, uy = vy * e - g, uz = vz * e;
          const bb = b - fx.split, fade = fadeOf(b);
          for (let m = 0; m < fx.parts; m++) {
            const ang = (m / fx.parts) * TAU + rnd(seed, i, 9);
            const kick = v0 * 0.45;
            const px = ux + Math.cos(ang) * kick, py = uy + Math.sin(ang) * kick * 0.7, pz = uz + Math.sin(ang) * kick;
            for (let q = 0; q <= 2; q++) {
              const tq = bb - q * TRAIL_DT; if (tq < 0) break;
              push(along(sx, px, 0, fx.k, tq), along(sy, py, -G, fx.k, tq), along(sz, pz, 0, fx.k, tq), colors[(i + m + 1) % colors.length], fade * (1 - q / 3) * 1.2, fx.size * 0.7);
            }
          }
          continue;
        }
        let bright = fadeOf(b);
        if (fx.strobe) bright *= rnd(seed, i, Math.floor(b * fx.strobe)) > 0.45 ? 1.6 : 0;
        for (let q = 0; q <= fx.trail; q++) {
          const tq = b - q * TRAIL_DT; if (tq < 0) break;
          const [x, y, z] = at(tq);
          push(x, y, z, p.effect === "willow" && q > 0 ? colors[0] : rgb, bright * (1 - q / (fx.trail + 1)) * (q ? 0.8 : 1.25), q ? fx.size * 0.7 : fx.size);
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
