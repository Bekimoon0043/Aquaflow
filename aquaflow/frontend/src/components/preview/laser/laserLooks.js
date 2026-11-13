// Laser looks for Show Studio: a recipe { effect: 'laser', laser: { look } } compiles to keyed
// clips on each laser's channels (laserRig.js). Pure.
import { laserLimits, patternLevel } from "./laserRig";
import { sampleKeys } from "../../programmer/studio/wavePatterns";

export const LASER_LOOKS = Object.freeze([
  { id: "fan-sweep", label: "Laser fan sweep", hint: "A fan of beams sweeps over the fountain and back" },
  { id: "tunnel", label: "Tunnel", hint: "A rotating cone of beams aimed across the pool" },
  { id: "beam-chase", label: "Beam chase", hint: "Single beams fire one projector after another while they swing" },
  { id: "liquid-sky", label: "Sheet / liquid sky", hint: "A flat sheet of light drifts above the audience" },
  { id: "cone-spin", label: "Cone spin", hint: "Cones point up and spin like a crown of light" },
  { id: "scan-wave", label: "Scan wave", hint: "One beam scans side to side, each projector a little later" },
]);
export const laserLookById = (id) => LASER_LOOKS.find((l) => l.id === id) || LASER_LOOKS[0];

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const r2 = (v) => Math.round(v * 100) / 100;
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const sizeLevel = (deg) => clamp01((deg - 2) / 88);
const speedLevel = (hz) => clamp01(hz / 2);

/** Channel functions (seconds from the pattern start → degrees / 0..1) for one projector. */
function lookChannels(look, { i, n, duration, cycle, spread, level }) {
  const phase = n > 1 ? (i / n) * spread : 0;
  const swing = (amp, extra = 0) => (t) => amp * Math.sin(TAU * (t / cycle - phase) + extra);
  const ease = (t) => smooth(Math.min(t, duration - t) / 0.3);
  const steady = (t) => level * ease(t);
  switch (look) {
    case "tunnel": return { pattern: "cone", tilt: () => 65, pan: swing(15), size: 18, speed: 0.5, intensity: steady };
    case "beam-chase": {
      const slot = 1 / Math.max(1, n);
      const on = (t) => { const u = (((t / cycle - phase) % 1) + 1) % 1; return u < slot * 1.4 ? smooth(Math.min(u, slot * 1.4 - u) / (slot * 0.3)) : 0; };
      return { pattern: "beam", tilt: () => 20, pan: swing(40), size: 30, speed: 0.25, intensity: (t) => level * ease(t) * on(t) };
    }
    case "liquid-sky": return { pattern: "sheet", tilt: () => 75, pan: swing(20), size: 90, speed: 0.1, intensity: (t) => 0.7 * steady(t) };
    case "cone-spin": return { pattern: "cone", tilt: () => 0, pan: () => 0, size: 30, speed: 1, intensity: steady };
    case "scan-wave": return { pattern: "scan", tilt: () => 30, pan: () => 0, size: 70, speed: 0.5, intensity: steady };
    case "fan-sweep":
    default: return { pattern: "fan", tilt: swing(35), pan: () => 0, size: 50, speed: 0.25, intensity: steady };
  }
}

const hexRgb = (hex) => (/^#[0-9a-f]{6}$/i.test(hex || "") ? [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 2.55) : [10, 100, 25]);

/**
 * Clips for one laser recipe. `members` are inventory items (with .tracks) in group order;
 * members without laser channels are skipped.
 */
export function compileLaserRecipe(recipe, members, { round = r2 } = {}) {
  const duration = Number(recipe.duration) || 8;
  const cycle = duration / Math.max(1, Number(recipe.cycles) || 1);
  const look = recipe.laser?.look || "fan-sweep";
  const lasers = members.filter((m) => (m.tracks || []).some((t) => t.type === "laser_intensity"));
  const clips = [];
  lasers.forEach((item, i) => {
    const lim = laserLimits(item);
    const ch = lookChannels(look, { i, n: lasers.length, duration, cycle, spread: Number(recipe.spread ?? 1), level: (Number(recipe.intensity) || 0) / 100 });
    const track = (type) => (item.tracks || []).find((t) => t.type === type);
    const push = (type, clip) => {
      const tr = track(type);
      if (!tr) return;
      clips.push({ id: `${recipe.id}:${item.id}:${type}`, studioRecipeId: recipe.id, patternBlockId: recipe.id, fixtureId: item.id,
        trackId: tr.id, type, name: recipe.name, startTime: round(recipe.start), duration: round(duration), color: recipe.color, source: "show-studio", ...clip });
    };
    const keyed = (type, fn) => {
      const keys = sampleKeys((t) => 100 * fn(t), duration, 0.1);
      push(type, { value: round(Math.max(...keys.filter((_, k) => k % 2))), keys });
    };
    keyed("laser_intensity", ch.intensity);
    keyed("laser_pan", (t) => clamp01(ch.pan(t) / (2 * lim.pan) + 0.5));
    keyed("laser_tilt", (t) => clamp01(ch.tilt(t) / (2 * lim.tilt) + 0.5));
    push("laser_pattern", { value: round(100 * patternLevel(ch.pattern)) });
    push("laser_size", { value: round(100 * sizeLevel(ch.size)) });
    push("laser_speed", { value: round(100 * speedLevel(ch.speed)) });
    const [r, g, b] = hexRgb(recipe.color);
    push("lighting_red", { value: round(r) }); push("lighting_green", { value: round(g) }); push("lighting_blue", { value: round(b) });
  });
  return clips;
}
