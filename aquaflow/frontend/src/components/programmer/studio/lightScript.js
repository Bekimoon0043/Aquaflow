// Light script — one colour story per song (concert-lighting practice: a primary colour,
// 4–5 looks per song, the biggest chorus brightest, white kept for the climax). Pure.

const PALETTES = {
  calm: [['#1e4fd8', '#18b7c9', '#7b5cff'], ['#0f6fbf', '#2fd3b5', '#5a4bff'], ['#2747c9', '#36a3ff', '#9d6bff']],
  mid: [['#18b7c9', '#b04dff', '#ff4fa3'], ['#2f6bff', '#00d1a0', '#ff6a3d'], ['#7b5cff', '#18b7c9', '#ffb347']],
  warm: [['#ff8a1e', '#ff2d55', '#ffd23f'], ['#ff4f2d', '#ffb347', '#ff2d95'], ['#e0402a', '#ff9d1e', '#ffe14d']],
};

/** Song mood 0..1 from loudness and tempo (a licence-free arousal estimate). */
export function arousalOf(analysis) {
  const v = analysis?.energy?.values || [];
  const e = v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0.5;
  const tempo = Math.min(1.4, Math.max(0.5, (analysis?.bpm || 110) / 120));
  return Math.min(1, Math.max(0, e * tempo));
}

/** Palette for a song: mood picks the family, the seed picks one of its palettes. */
export function songPalette(analysis, seed = 0) {
  // Deep analysis gives arousal and valence; otherwise loudness × tempo stands in for arousal.
  const a = analysis?.mood?.arousal ?? arousalOf(analysis);
  const family = a < 0.38 ? 'calm' : a < 0.6 ? 'mid' : 'warm';
  const list = PALETTES[family];
  const lean = analysis?.mood ? Math.min(2, Math.floor(analysis.mood.valence * 3)) : 0;   // sadder → cooler palette
  const colors = list[(((lean + seed) % list.length) + list.length) % list.length];
  return { family, arousal: Math.round(a * 100) / 100, valence: analysis?.mood?.valence ?? null, base: colors[0], second: colors[1], accent: colors[2], white: '#ffffff' };
}

/** Colour and intensity of a section, by its role. Repeats of a section keep its colour. */
export function sectionLight(role, palette, { energy = 0.5, occurrence = 0 } = {}) {
  const intensity = Math.round(100 * Math.min(1, 0.25 + 0.75 * energy)) / 100;
  switch (role) {
    case 'intro': case 'outro': return { hue: palette.base, intensity: Math.min(intensity, 0.5) };
    case 'rest': return { hue: palette.base, intensity: Math.min(intensity, 0.4) };
    case 'verse': return { hue: occurrence % 2 ? palette.second : palette.base, intensity };
    case 'build': return { hue: palette.second, intensity };
    case 'high': return { hue: palette.accent, intensity };
    case 'climax': return { hue: palette.accent, intensity: 1, white: true };
    default: return { hue: palette.base, intensity };
  }
}
