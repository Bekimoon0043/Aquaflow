/**
 * particleTextures.js — AF-3D-003 (realism plan, Phase R1)
 *
 * Procedurally generated sprite textures for the particle billboards. Depence-class
 * water reads as water partly because every droplet, mist puff and foam clump has
 * micro-structure; a mathematically perfect radial falloff reads as a "sprite".
 * These are drawn once into small canvases at startup — no binary assets to ship,
 * nothing to load, and the analytic shading in the particle shader still does the
 * lighting work on top.
 *
 * Every builder returns a THREE.CanvasTexture, or null when no DOM is available
 * (jsdom/tests, headless export) — the particle material then falls back to the
 * pure analytic shape, which is exactly the pre-R1 behaviour.
 */

function makeCanvas(size) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

function finish(T, canvas) {
  const tex = new T.CanvasTexture(canvas);
  tex.minFilter = T.LinearMipmapLinearFilter;
  tex.magFilter = T.LinearFilter;
  tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
  // Alpha-shape textures carry no colour information; keep them out of sRGB decode.
  if (T.NoColorSpace) tex.colorSpace = T.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Soft radial blob helper — alpha only, white ink. */
function blob(ctx, x, y, r, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.55})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Deterministic pseudo-random — same texture every launch, no test flakiness. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Water droplet: a bright slightly-off-centre body with a thin dark rim and a
 * small refraction hot-spot, the way a backlit drop actually photographs.
 */
export function makeDropletTexture(T, size = 128) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext("2d");
  const s = size;
  ctx.clearRect(0, 0, s, s);

  // Main body.
  blob(ctx, s * 0.5, s * 0.5, s * 0.46, 0.95);
  // Interior refraction lobe, offset like the analytic spec highlight.
  blob(ctx, s * 0.40, s * 0.40, s * 0.16, 0.85);
  // A faint counter-lobe at the bottom — internal reflection.
  blob(ctx, s * 0.60, s * 0.66, s * 0.10, 0.45);

  // Slight edge irregularity: nibble the rim with destination-out blobs.
  const r = rng(7);
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 10; i++) {
    const a = r() * Math.PI * 2;
    const rad = s * (0.44 + r() * 0.06);
    blob(ctx, s * 0.5 + Math.cos(a) * rad, s * 0.5 + Math.sin(a) * rad, s * 0.07, 0.5);
  }
  ctx.globalCompositeOperation = "source-over";
  return finish(T, c);
}

/**
 * Mist / spray puff: several overlapping soft lobes plus fine speckle, so a cloud
 * of these overlaps into a convincing volume instead of visible circles.
 */
export function makeMistTexture(T, size = 128) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext("2d");
  const s = size;
  ctx.clearRect(0, 0, s, s);

  const r = rng(23);
  // Core mass.
  blob(ctx, s * 0.5, s * 0.5, s * 0.42, 0.55);
  // Irregular lobes.
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const d = s * (0.10 + r() * 0.18);
    blob(ctx, s * 0.5 + Math.cos(a) * d, s * 0.5 + Math.sin(a) * d, s * (0.14 + r() * 0.14), 0.30);
  }
  // Fine droplet speckle riding on the puff.
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * s * 0.40;
    blob(ctx, s * 0.5 + Math.cos(a) * d, s * 0.5 + Math.sin(a) * d, s * (0.008 + r() * 0.02), 0.5);
  }
  return finish(T, c);
}

/**
 * Foam clump: high-frequency froth — many small bright cells inside a soft mass.
 */
export function makeFoamTexture(T, size = 128) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext("2d");
  const s = size;
  ctx.clearRect(0, 0, s, s);

  const r = rng(41);
  blob(ctx, s * 0.5, s * 0.5, s * 0.40, 0.40);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * s * 0.34;
    blob(ctx, s * 0.5 + Math.cos(a) * d, s * 0.5 + Math.sin(a) * d, s * (0.03 + r() * 0.055), 0.85);
  }
  return finish(T, c);
}

/**
 * Flame tongue: a vertically elongated teardrop, hot at the base, feathered at
 * the tip. Drawn elongated in Y — the emitter throws flame particles upward, so
 * the velocity-stretch in the billboard shader aligns this with the rise.
 */
export function makeFlameTexture(T, size = 128) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext("2d");
  const s = size;
  ctx.clearRect(0, 0, s, s);

  // Stacked, shrinking lobes: wide at the bottom, narrow at the top.
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);           // 0 base → 1 tip
    const y = s * (0.78 - t * 0.52);
    const rad = s * (0.30 - t * 0.20);
    blob(ctx, s * 0.5, y, Math.max(rad, s * 0.05), 0.75 - t * 0.35);
  }
  return finish(T, c);
}
