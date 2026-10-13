// colorPipeline.js — AF-NEXT-013: JS mirrors of the preview's colour path.
//
// The 3D preview's colour pipeline is documented in docs/COLOR-PIPELINE.md. These
// mirrors let tests check it without a GPU: sRGB transfer functions (IEC 61966-2-1,
// identical to three.js ColorManagement and to evaluateShowFrame's srgbToLinear) and
// three r165's tone-mapping operators line for line (tonemapping_pars_fragment.glsl.js).
// Pure functions on [r, g, b] arrays, linear Rec.709/sRGB primaries.

export const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** "#rrggbb" → linear [r, g, b] (what new THREE.Color(hex) holds with ColorManagement on). */
export function hexToLinear(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => srgbToLinear(v / 255));
}

const clamp01 = v => Math.min(1, Math.max(0, v));
// GLSL mat3(c0, c1, c2) is column-major: (M * v)[i] = c0[i]*v.x + c1[i]*v.y + c2[i]*v.z.
const mulCols = (c0, c1, c2, v) => [0, 1, 2].map(i => c0[i] * v[0] + c1[i] * v[1] + c2[i] * v[2]);

const ACES_IN = [[0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]];
const ACES_OUT = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]];
const rrtOdt = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);

/** three r165 ACESFilmicToneMapping (includes its 1/0.6 gain). */
export function acesFilmic(rgb, exposure = 1) {
  let c = rgb.map(v => (v * exposure) / 0.6);
  c = mulCols(...ACES_IN, c).map(rrtOdt);
  return mulCols(...ACES_OUT, c).map(clamp01);
}

const REC2020_TO_SRGB = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
const SRGB_TO_REC2020 = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.0880], [0.0433, 0.0113, 0.8956]];
const AGX_IN = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]];
const AGX_OUT = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]];
const agxContrast = x => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; };

/** three r165 AgXToneMapping. */
export function agx(rgb, exposure = 1) {
  const mn = -12.47393, mx = 4.026069;
  let c = rgb.map(v => v * exposure);
  c = mulCols(...SRGB_TO_REC2020, c);
  c = mulCols(...AGX_IN, c);
  c = c.map(v => clamp01((Math.log2(Math.max(v, 1e-10)) - mn) / (mx - mn))).map(agxContrast);
  c = mulCols(...AGX_OUT, c).map(v => Math.pow(Math.max(0, v), 2.2));
  return mulCols(...REC2020_TO_SRGB, c).map(clamp01);
}

/** three r165 NeutralToneMapping (Khronos PBR Neutral). */
export function neutral(rgb, exposure = 1) {
  const start = 0.8 - 0.04, desat = 0.15;
  let c = rgb.map(v => v * exposure);
  const x = Math.min(...c);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c = c.map(v => v - offset);
  const peak = Math.max(...c);
  if (peak < start) return c;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  c = c.map(v => (v * newPeak) / peak);
  const g = 1 - 1 / (desat * (peak - newPeak) + 1);
  return c.map(v => v + (newPeak - v) * g);
}

export const TONE_MAPPERS = Object.freeze({ aces: acesFilmic, agx, neutral });

/** Rec.709 relative luminance of linear RGB. */
export const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** HSV-style chroma ratio (max - min) / max, 0 = grey/white, 1 = fully saturated. */
export function chroma(rgb) {
  const mx = Math.max(...rgb), mn = Math.min(...rgb);
  return mx > 1e-6 ? (mx - mn) / mx : 0;
}
