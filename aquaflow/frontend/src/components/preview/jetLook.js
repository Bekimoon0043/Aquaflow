/**
 * jetLook.js — lit top band and bushy crown (the "viewpoint illusion tree" look).
 *
 * A night fountain where a spotlight beside each clear jet is aimed up at its TOP reads
 * very differently from a jet lit from below: the long column stays thin, faint and pale
 * and only the top glows — a bright, aerated tuft in the light's colour. Rows of such
 * tufts overlap into a canopy. This module holds the pure maths for that; nozzleEmitters.js
 * turns it into emitter fields (band, TUFT emitters) and the particle shaders draw it.
 *
 * FIELDS (all optional; a fixture without any of them renders exactly as before).
 * Read from fixture.engineering.* first, then the top-level fixture / config:
 *
 *   topLitFraction  0..1 — only the top fraction of the jet's height (mount → drawn apex)
 *                   is lit at full brightness; below it the particles are drawn dim and
 *                   pale. Smooth transition over ~10 % of the height (±BAND_SOFT_FRACTION).
 *   columnGlow      0..1, default 0.22 — brightness/alpha factor of the unlit column
 *                   (desaturated toward a cool white).
 *   crownTuft       true, or { widthM = 0.9, heightM = 1.2, density = 1 (0..2) } —
 *                   an aerated, foamy head at the apex (EMIT_MODE.TUFT).
 *
 * AUTOMATIC BAND. A nozzle without topLitFraction whose paired light (light
 * engineering.pairedNozzleId) is aimed (aimDeg > 0) gets the band the beam actually hits:
 * the heights on the jet axis inside the beam cone (beamAngleDeg) — see beamHitBand. The
 * scene attaches those lights to the nozzle config as `litBeams`.
 *
 * World axes: x = plan x, y = height, z = plan y. Pure: no three.js, no WebGL.
 */

import { fieldOf } from "./elevatedNozzles";
import { designHeightOf } from "./designTrajectory";

const DEG = Math.PI / 180;

export const DEFAULT_COLUMN_GLOW = 0.22;
/** Half-width of the band's soft edge, as a fraction of the jet height (≈10 % in total). */
export const BAND_SOFT_FRACTION = 0.05;
/** "Open" band edges — far outside any scene; the shaders' smoothstep then yields exactly 1. */
export const BAND_OPEN = 1e6;
/** The neutral band every emitter without one carries (shader factor exactly 1). */
export const NO_BAND = Object.freeze({ lo: -BAND_OPEN, hi: BAND_OPEN, soft: 1, glow: 1 });

export const CROWN_DEFAULTS = Object.freeze({ widthM: 0.9, heightM: 1.2, density: 1 });
/** The tuft spans apex − TUFT_BASE·h … apex + (1 − TUFT_BASE)·h: the column ends inside it. */
export const TUFT_BASE = 0.6;
/** Life of a tuft particle, s (short: the head is re-made continuously). */
export const TUFT_LIFE = 0.5;
/** Particle weight (pool share) of a default tuft at density 1; never more than TUFT_MAX_WEIGHT. */
export const TUFT_BASE_WEIGHT = 320;
export const TUFT_MAX_WEIGHT = 900;
/** Shedding droplets, as a fraction of the tuft's weight. */
export const TUFT_SHED_SHARE = 0.22;
/** A beam without beamAngleDeg: the light field's default 56° beam. */
const DEFAULT_BEAM_DEG = 56;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Explicit top-lit fraction (0..1), or null when absent. */
export function topLitFractionOf(cfg) {
  const f = fieldOf(cfg, "topLitFraction");
  return f == null ? null : clamp(f, 0, 1);
}

/** Brightness/alpha factor of the unlit column (default 0.22). */
export function columnGlowOf(cfg) {
  const g = fieldOf(cfg, "columnGlow");
  return g != null && g >= 0 ? Math.min(1, g) : DEFAULT_COLUMN_GLOW;
}

/**
 * The crown tuft, normalised, or null. Accepts `crownTuft: true` (defaults) or an object.
 * @returns {{widthM:number, heightM:number, density:number}|null}
 */
export function crownTuftOf(cfg) {
  const raw = cfg?.engineering?.crownTuft ?? cfg?.crownTuft;
  if (!raw) return null;
  const o = raw === true ? {} : typeof raw === "object" ? raw : null;
  if (!o) return null;
  const n = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);
  const widthM = clamp(n(o.widthM, CROWN_DEFAULTS.widthM), 0.1, 5);
  const heightM = clamp(n(o.heightM, CROWN_DEFAULTS.heightM), 0.1, 6);
  const density = clamp(n(o.density, CROWN_DEFAULTS.density), 0, 2);
  return density > 0 ? { widthM, heightM, density } : null;
}

/** Is this an aerated (foam / frothy) jet? engineering.aerated, or the scene's flag. */
export function isAerated(cfg) {
  return cfg?.aerated === true || cfg?.engineering?.aerated === true;
}

/** Does the fixture use the lit band / crown at all? (Absent → descriptors untouched.) */
export function hasJetLook(cfg) {
  return topLitFractionOf(cfg) != null || crownTuftOf(cfg) != null
    || (Array.isArray(cfg?.litBeams) && cfg.litBeams.length > 0);
}

/**
 * Band for an explicit fraction: the top `fraction` of base → apex is lit.
 * @returns {{lo:number, hi:number, soft:number}}  world heights, m
 */
export function litBandFromFraction(baseY, apexY, fraction) {
  const H = Math.max(0, apexY - baseY);
  const f = clamp(Number(fraction) || 0, 0, 1);
  return { lo: baseY + (1 - f) * H, hi: BAND_OPEN, soft: Math.max(0.02, BAND_SOFT_FRACTION * H) };
}

/**
 * Heights on a vertical jet axis (x, z) that lie inside a light's beam cone.
 * @param beam {x, y, z, dir:[x,y,z] (unit aim), beamAngleDeg}
 * @param jet  {x, z, y0, y1}  the axis segment to test (world)
 * @returns {{lo:number, hi:number}|null}  hi = BAND_OPEN when the beam still covers y1
 */
export function beamHitBand(beam, jet, steps = 240) {
  const d = beam?.dir;
  if (!Array.isArray(d)) return null;
  const n = Math.hypot(d[0], d[1], d[2]);
  if (!(n > 1e-9)) return null;
  const ax = d[0] / n, ay = d[1] / n, az = d[2] / n;
  const half = clamp((Number(beam.beamAngleDeg) || DEFAULT_BEAM_DEG) / 2, 0.5, 89) * DEG;
  const cosH = Math.cos(half);
  const lx = Number(beam.x) || 0, ly = Number(beam.y) || 0, lz = Number(beam.z) || 0;
  const dx = (Number(jet.x) || 0) - lx, dz = (Number(jet.z) || 0) - lz;
  const y0 = Number(jet.y0) || 0, y1 = Math.max(y0 + 1e-3, Number(jet.y1) || 0);
  const inside = (y) => {
    const dy = y - ly;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return true;
    return (dx * ax + dy * ay + dz * az) / L >= cosH;
  };
  // Bisect a sampled sign change to ~1 mm.
  const edge = (a, b) => {
    const ia = inside(a);
    for (let i = 0; i < 30 && Math.abs(b - a) > 1e-3; i++) {
      const m = (a + b) / 2;
      if (inside(m) === ia) a = m; else b = m;
    }
    return (a + b) / 2;
  };
  let lo = null, hi = null, prevY = y0, prevIn = inside(y0);
  if (prevIn) lo = y0;
  for (let i = 1; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    const now = inside(y);
    if (now && !prevIn && lo == null) lo = edge(prevY, y);
    if (!now && prevIn) hi = edge(prevY, y);   // the last exit wins (union of the hits)
    prevY = y; prevIn = now;
  }
  if (lo == null) return null;
  return { lo, hi: prevIn ? BAND_OPEN : hi };
}

const beamCache = new WeakMap();

/**
 * The band the paired, aimed lights hit on this jet (union of their beams), or null.
 * Evaluated against the full design range so it is stable while intensity moves (cached).
 */
export function autoLitBand(cfg, baseY) {
  const beams = cfg?.litBeams;
  if (!Array.isArray(beams) || !beams.length) return null;
  const H = designHeightOf(cfg) ?? fieldOf(cfg, "jetHeightM") ?? 10;
  const x = Number(cfg.x) || 0, z = Number(cfg.z) || 0;
  const key = `${x}|${z}|${baseY}|${H}`;
  const hit = beamCache.get(beams);
  if (hit && hit.key === key) return hit.band;
  let band = null;
  for (const b of beams) {
    const r = beamHitBand(b, { x, z, y0: baseY, y1: baseY + H * 1.3 + 0.5 });
    if (!r) continue;
    band = band ? { lo: Math.min(band.lo, r.lo), hi: Math.max(band.hi, r.hi) } : r;
  }
  beamCache.set(beams, { key, band });
  return band;
}

/**
 * The lit band for this frame, or null: an explicit topLitFraction wins, else the
 * paired beams. `glow` is the column factor; `soft` the half-width of the transition.
 * @returns {{lo, hi, soft, glow}|null}
 */
export function jetBandOf(cfg, baseY, apexY) {
  const glow = columnGlowOf(cfg);
  const f = topLitFractionOf(cfg);
  if (f != null) return { ...litBandFromFraction(baseY, apexY, f), glow };
  const auto = autoLitBand(cfg, baseY);
  if (!auto) return null;
  const soft = Math.max(0.02, BAND_SOFT_FRACTION * Math.max(0, apexY - baseY));
  return { lo: auto.lo, hi: auto.hi, soft, glow };
}

/** Shader twin: brightness weight of height y in a band (1 inside, 0 well outside). */
export function bandFactor(band, y) {
  if (!band) return 1;
  const ss = (a, b, x) => { const t = clamp((x - a) / ((b - a) || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
  return ss(band.lo - band.soft, band.lo + band.soft, y) * (1 - ss(band.hi - band.soft, band.hi + band.soft, y));
}

/** Radius of the tuft at height fraction s (0 bottom … 1 top), as a fraction of half-width.
 *  A flame / teardrop: narrower at the bottom, widest a little below the middle, rounded top.
 *  Same formula as the shader's TUFT spawn. */
export function tuftProfile(s) {
  const t = clamp(s, 0, 1);
  return Math.pow(Math.max(0, Math.sin(Math.PI * (0.1 + 0.9 * t))), 0.6);
}

/** Pool weight of a tuft: scales with density and (gently) with its size; bounded. */
export function tuftWeight(tuft) {
  if (!tuft) return 0;
  const size = Math.sqrt((tuft.widthM * tuft.heightM) / (CROWN_DEFAULTS.widthM * CROWN_DEFAULTS.heightM));
  return Math.round(clamp(TUFT_BASE_WEIGHT * tuft.density * clamp(size, 0.5, 1.6), 0, TUFT_MAX_WEIGHT));
}
