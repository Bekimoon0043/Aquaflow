/**
 * sceneLights.js — the design's RGB fixtures for the simulation cache: their live colour
 * and level per frame (from the show), and the light they put on each droplet, using the
 * 3D preview's own light field (fixtureLightField: beam cone × windowed inverse-square,
 * clustered, overlap-normalised).
 */
import { encodeLight, buildClusters, clusteredLightN, densityNormalize } from "../components/preview/fixtureLightField.js";
import { hexToSrgb, srgbToLinear } from "../show/evaluateShowFrame.js";

/** "#ff8800" → linear RGB 0..1 (the preview's colour management does the same). */
export function hexToLinear(hex, fallback = "#ffffff") {
  const s = hexToSrgb(/^#[0-9a-f]{6}$/i.test(String(hex || "")) ? hex : fallback);
  return [srgbToLinear(s.r), srgbToLinear(s.g), srgbToLinear(s.b)];
}

/**
 * @param {Array} lightConfigs from fixturesToNozzleConfigs (id, x, y, z, color, intensity, radius)
 * @param {Array} fixtures     engineering fixtures (wattage / beam data)
 */
export function createLightRig(lightConfigs = [], fixtures = []) {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const lights = lightConfigs.map((c) => {
    const f = byId.get(c.id) || {};
    const e = f.engineering || {};
    return {
      id: c.id, x: Number(c.x) || 0, y: Number(c.y) || 0, z: Number(c.z) || 0,
      baseColor: hexToLinear(typeof c.color === "number" ? `#${(c.color >>> 0).toString(16).padStart(6, "0").slice(-6)}`
        : typeof c.color === "string" ? c.color : "#ffffff"),
      baseIntensity: Number(c.intensity) || 4, radius: Number(c.radius) || 4.5,
      tiltX: Number(f.tiltX) || 0, tiltZ: Number(f.tiltZ) || 0,
      beamAngle: Number(e.beamAngleDeg) || undefined, wattage: Number(e.wattage) || 18,
    };
  });
  const encodeAll = (states) => lights.map((L, i) => {
    const s = states?.[i];
    return encodeLight({ ...L, color: { r: s ? s.color[0] : L.baseColor[0], g: s ? s.color[1] : L.baseColor[1], b: s ? s.color[2] : L.baseColor[2] },
      intensity: L.baseIntensity * (s ? s.level : 1) });
  });
  // Lights never move during a show, so the cluster grid is built once.
  const clusters = lights.length ? buildClusters(encodeAll(null)) : null;
  return {
    lights,
    /** Per-light { level 0..1, color linear } at one show frame (null state → full base colour). */
    statesFrom(lightState) {
      return lights.map((L) => {
        if (!lightState) return { level: 1, color: L.baseColor };
        const s = lightState(L.id);
        return { level: Math.max(0, Math.min(1, Number(s?.intensity) || 0)), color: hexToLinear(s?.color) };
      });
    },
    /** Light reaching each particle (linear HDR RGB), as the preview lights its droplets. */
    particleColors(particles, states) {
      const out = new Float32Array(particles.count * 3);
      if (!clusters) return out;
      const enc = encodeAll(states);
      const p = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < particles.count; i++) {
        p.x = particles.pos[i * 3]; p.y = particles.pos[i * 3 + 1]; p.z = particles.pos[i * 3 + 2];
        const { rgb, n } = clusteredLightN(enc, clusters, p, null);
        const c = densityNormalize(rgb, n);
        out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
      }
      return out;
    },
  };
}
