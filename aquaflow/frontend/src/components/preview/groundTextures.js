/**
 * groundTextures.js — AF-3D-012 (realism plan, pulled forward from Phase R4)
 *
 * Procedural PBR texture sets for the hard surfaces around the fountain. The deck,
 * pool wall, coping and basin were flat single-colour MeshStandardMaterials — with
 * IBL and bloom in place, that flatness was the loudest remaining "rendered" cue:
 * real stone has tile joints, tonal variation, speckle, and roughness breakup for
 * the sky probe and fixture lights to catch.
 *
 * Everything is drawn into canvases at startup from one seeded height field, so:
 *   • albedo, normal and roughness maps agree with each other by construction
 *     (the normal map is the analytic gradient of the same height field the
 *     albedo shades), and
 *   • there are no binary assets to ship, and no test flakiness — the seed fixes
 *     every pixel.
 *
 * Headless/jsdom returns null; callers keep their flat-colour materials, which is
 * exactly the pre-texture behaviour.
 */

function makeCanvas(size) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise: random lattice + bilinear interpolation, torus-wrapped. */
function valueNoise(size, cells, seed) {
  const rand = mulberry(seed);
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(size * size);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * cells;
    const y0 = Math.floor(gy), fy = smooth(gy - y0);
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const x0 = Math.floor(gx), fx = smooth(gx - x0);
      const a = lat[(y0 % cells) * cells + (x0 % cells)];
      const b = lat[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = lat[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = lat[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return out;
}

/** Fractal noise: a few octaves of the tileable value noise. */
function fbm(size, baseCells, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, baseCells << o, seed + o * 131);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * Height field for a tiled stone surface: per-tile height offsets, bevelled
 * grooves at the joints, fractal surface noise. `tiles` per texture edge.
 */
function tileHeightField(size, tiles, seed, { grooveW = 0.045, noiseAmp = 0.35 } = {}) {
  const rand = mulberry(seed);
  const tileTone = new Float32Array(tiles * tiles);
  for (let i = 0; i < tileTone.length; i++) tileTone[i] = rand();
  const noise = fbm(size, 8, 4, seed + 7);
  const h = new Float32Array(size * size);
  const tone = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * tiles;
    const ty = Math.floor(v), fy = v - ty;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * tiles;
      const tx = Math.floor(u), fx = u - tx;
      const t = tileTone[(ty % tiles) * tiles + (tx % tiles)];
      // Distance to the nearest joint, in tile units.
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      // Groove: drops sharply inside grooveW of a joint, bevelled.
      const groove = Math.min(edge / grooveW, 1);
      const bevel = groove * groove * (3 - 2 * groove);
      const i = y * size + x;
      h[i] = bevel * (0.75 + t * 0.25) + noise[i] * noiseAmp * bevel;
      tone[i] = t;
    }
  }
  return { h, tone, noise };
}

/** Sobel-style normal map from a height field. */
function normalCanvas(size, h, strength) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function grayCanvas(size, values, lo, hi) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < values.length; i++) {
    const g = Math.max(0, Math.min(255, (lo + (hi - lo) * values[i]) * 255));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function albedoCanvas(size, field, base, tint, speckleSeed) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const { h, tone, noise } = field;
  for (let i = 0; i < h.length; i++) {
    // Per-tile tonal variation + fine noise + darkened grooves.
    const groove = Math.min(h[i] / 0.6, 1);
    const v = (0.72 + tone[i] * 0.28) * (0.82 + noise[i] * 0.36) * (0.35 + groove * 0.65);
    d[i * 4] = Math.min(255, base[0] * v + tint[0] * tone[i]);
    d[i * 4 + 1] = Math.min(255, base[1] * v + tint[1] * tone[i]);
    d[i * 4 + 2] = Math.min(255, base[2] * v + tint[2] * tone[i]);
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Mineral speckle — tiny bright flecks that catch the fixture lights.
  const rand = mulberry(speckleSeed);
  for (let s = 0; s < size * 14; s++) {
    const x = rand() * size, y = rand() * size;
    const b = 90 + rand() * 120;
    ctx.fillStyle = `rgba(${b},${b},${b + 14},${0.10 + rand() * 0.20})`;
    ctx.fillRect(x, y, 1, 1);
  }
  return c;
}

function toTexture(T, canvas, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  if (!canvas) return null;
  const tex = new T.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.minFilter = T.LinearMipmapLinearFilter;
  tex.magFilter = T.LinearFilter;
  tex.anisotropy = aniso;
  if (srgb && T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
  else if (!srgb && T.NoColorSpace) tex.colorSpace = T.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A complete PBR map set for one surface. Returns null in headless contexts.
 *
 * @param {object} T three namespace
 * @param {object} opts
 *   kind: "deck" | "coping" | "basin"
 *   repeat: texture tiling across the mesh
 */
export function createStoneMaps(T, { kind = "deck", repeat = 1, size = 512 } = {}) {
  if (typeof document === "undefined") return null;

  let field, base, tint, rough, normalStrength;
  if (kind === "coping") {
    // Polished lighter stone: shallow joints, tight roughness, subtle veining.
    field = tileHeightField(size, 8, 311, { grooveW: 0.03, noiseAmp: 0.12 });
    base = [168, 168, 178]; tint = [10, 8, 6];
    rough = [0.18, 0.42];
    normalStrength = 1.4;
  } else if (kind === "basin") {
    // Dark-blue mosaic tiles — the classic fountain basin lining, visible through
    // the water. Kept coarse and gently bumped: seen through the animated surface
    // a fine mosaic is sub-pixel and moirés into stripes.
    field = tileHeightField(size, 12, 977, { grooveW: 0.07, noiseAmp: 0.18 });
    base = [26, 52, 86]; tint = [8, 26, 48];
    rough = [0.22, 0.55];
    normalStrength = 1.2;
  } else {
    // Deck: large dark granite pavers.
    field = tileHeightField(size, 6, 137, { grooveW: 0.045, noiseAmp: 0.35 });
    base = [56, 62, 70]; tint = [6, 7, 9];
    rough = [0.55, 0.95];
    normalStrength = 2.6;
  }

  // Roughness follows the height field inverted: grooves and pits are rougher
  // than worn tile faces.
  const roughVals = new Float32Array(field.h.length);
  for (let i = 0; i < roughVals.length; i++) roughVals[i] = 1 - Math.min(field.h[i], 1);

  const map = toTexture(T, albedoCanvas(size, field, base, tint, 555), { srgb: true, repeat });
  const normalMap = toTexture(T, normalCanvas(size, field.h, normalStrength * size * 0.01), { repeat });
  const roughnessMap = toTexture(T, grayCanvas(size, roughVals, rough[0], rough[1]), { repeat });
  if (!map || !normalMap || !roughnessMap) return null;
  return { map, normalMap, roughnessMap };
}

/**
 * Clone a map set with a different tiling — the clones share the underlying
 * images (one canvas each), so a wall can reuse the deck's stone at wall scale
 * for the cost of three texture objects, not three regenerations.
 */
export function cloneStoneMaps(maps, rx, ry) {
  if (!maps) return null;
  const cl = (t) => {
    const c = t.clone();
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    return c;
  };
  return { map: cl(maps.map), normalMap: cl(maps.normalMap), roughnessMap: cl(maps.roughnessMap) };
}

/** Apply a map set to a MeshStandardMaterial, keeping its lighting parameters. */
export function applyStoneMaps(material, maps, { normalScale = 0.85 } = {}) {
  if (!material || !maps) return false;
  material.map = maps.map;
  material.normalMap = maps.normalMap;
  material.roughnessMap = maps.roughnessMap;
  if (material.normalScale?.set) material.normalScale.set(normalScale, normalScale);
  // The albedo now carries the colour; the material tint becomes a multiplier and
  // must move to near-white or the texture reads as a faint watermark.
  material.color?.setRGB(1, 1, 1);
  material.roughness = 1.0;   // roughnessMap multiplies this
  material.needsUpdate = true;
  return true;
}

/** Dispose one map set. */
export function disposeStoneMaps(maps) {
  maps?.map?.dispose?.();
  maps?.normalMap?.dispose?.();
  maps?.roughnessMap?.dispose?.();
}
