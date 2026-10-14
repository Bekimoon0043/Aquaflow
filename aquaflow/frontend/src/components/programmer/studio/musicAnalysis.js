// Song analysis for music sync — pure functions (run inside a Web Worker by musicSync.js,
// and directly by the unit tests). Input: mono samples. Output: bpm, a regular beat
// grid, downbeats/bars, an energy curve and estimated sections
// (intro / verse / chorus / bridge / outro).
//
// Method (deliberately simple and deterministic):
//   onset envelope  = half-wave rectified difference of log frame energy (10 ms hop)
//   tempo           = autocorrelation of the envelope, weighted towards 120 BPM
//                     (the same idea as the backend's /api/beat/detect)
//   beat grid       = the phase whose regular grid collects the most onset strength
//   downbeats       = which of every 4 beats carries the most low-frequency onset
//   sections        = per-bar features (energy, bass, onset density) → novelty peaks
//                     between blocks of bars, then labelled from relative energy.

export const ANALYSIS_VERSION = 1;
export const TARGET_RATE = 11025;
export const ENERGY_RATE = 4;           // energy curve points per second
export const BEATS_PER_BAR = 4;
const HOP_S = 0.01;

const r3 = v => Math.round(v * 1000) / 1000;
const r4 = v => Math.round(v * 10000) / 10000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Average channels into one Float32Array. */
export function toMono(channels) {
  if (!channels?.length) return new Float32Array(0);
  if (channels.length === 1) return Float32Array.from(channels[0]);
  const n = Math.min(...channels.map(c => c.length));
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i] / channels.length;
  return out;
}

/** Block-average downsampling to about `toRate` (never upsamples). */
export function downsample(samples, fromRate, toRate = TARGET_RATE) {
  const factor = Math.max(1, Math.floor(fromRate / toRate));
  if (factor === 1) return { samples: Float32Array.from(samples), rate: fromRate };
  const n = Math.floor(samples.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += samples[i * factor + k];
    out[i] = s / factor;
  }
  return { samples: out, rate: fromRate / factor };
}

/**
 * Frame features at a 10 ms hop: onset novelty (full band and bass), frame energy.
 * @returns {{ novelty: Float32Array, bassNovelty: Float32Array, energy: Float32Array, envRate: number, duration: number }}
 */
export function extractFeatures(samples, rate) {
  const hop = Math.max(1, Math.round(rate * HOP_S));
  const blocks = Math.floor(samples.length / hop);
  const blockE = new Float64Array(blocks), blockB = new Float64Array(blocks);
  const a = 1 - Math.exp(-2 * Math.PI * 150 / rate);   // one-pole low-pass ≈150 Hz
  let low = 0;
  for (let b = 0; b < blocks; b++) {
    let e = 0, eb = 0;
    for (let i = b * hop, end = i + hop; i < end; i++) {
      const x = samples[i];
      low += a * (x - low);
      e += x * x; eb += low * low;
    }
    blockE[b] = e / hop; blockB[b] = eb / hop;
  }
  const frames = Math.max(0, blocks - 1);           // frame = two hops
  const energy = new Float32Array(frames), novelty = new Float32Array(frames), bassNovelty = new Float32Array(frames);
  let prev = 0, prevB = 0;
  for (let f = 0; f < frames; f++) {
    const e = (blockE[f] + blockE[f + 1]) / 2, eb = (blockB[f] + blockB[f + 1]) / 2;
    energy[f] = e;
    const le = Math.log1p(e * 1000), lb = Math.log1p(eb * 1000);
    novelty[f] = f ? Math.max(0, le - prev) : 0;
    bassNovelty[f] = f ? Math.max(0, lb - prevB) : 0;
    prev = le; prevB = lb;
  }
  return { novelty, bassNovelty, energy, envRate: rate / hop, duration: samples.length / rate };
}

/** Tempo from the onset envelope: weighted autocorrelation with parabolic refinement. */
export function estimateTempo(novelty, envRate, { min = 60, max = 200, center = 120 } = {}) {
  const n = novelty.length;
  if (n < 8) return { bpm: 0, confidence: 0 };
  let mean = 0;
  for (let i = 0; i < n; i++) mean += novelty[i];
  mean /= n;
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) env[i] = novelty[i] - mean;
  const ac = lag => { let s = 0; for (let i = lag; i < n; i++) s += env[i] * env[i - lag]; return s / (n - lag); };
  const zero = ac(0);
  if (!(zero > 0)) return { bpm: 0, confidence: 0 };
  const lagMin = Math.max(2, Math.floor(envRate * 60 / max)), lagMax = Math.min(n - 2, Math.ceil(envRate * 60 / min));
  if (lagMax <= lagMin) return { bpm: 0, confidence: 0 };
  const values = new Map();
  const at = lag => { if (!values.has(lag)) values.set(lag, ac(lag) / zero); return values.get(lag); };
  let best = -Infinity, bestLag = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = 60 * envRate / lag;
    const weight = Math.exp(-0.5 * (Math.log2(bpm / center) / 0.9) ** 2);
    const score = at(lag) * weight;
    if (score > best) { best = score; bestLag = lag; }
  }
  if (!(best > 0)) return { bpm: 0, confidence: 0 };
  const y0 = at(bestLag - 1), y1 = at(bestLag), y2 = at(bestLag + 1);
  const denom = y0 - 2 * y1 + y2;
  const shift = denom < 0 ? clamp(0.5 * (y0 - y2) / denom, -0.5, 0.5) : 0;
  const lag = bestLag + shift;
  return { bpm: r3(60 * envRate / lag), confidence: r3(clamp(y1, 0, 1)) };
}

const strengthAt = (curve, frame) => {
  const i = Math.round(frame);
  let s = 0;
  for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < curve.length) s = Math.max(s, curve[k]);
  return s;
};

/** Regular beat grid for `bpm`: the phase that collects the most onset strength. */
export function beatGrid(novelty, envRate, bpm, duration) {
  if (!(bpm > 0)) return { beats: [], offset: 0, score: 0 };
  const period = envRate * 60 / bpm;
  let best = -1, bestPhase = 0;
  for (let phase = 0; phase < period; phase += 0.5) {
    let s = 0, count = 0;
    for (let f = phase; f < novelty.length; f += period) { s += strengthAt(novelty, f); count++; }
    if (count && s / count > best) { best = s / count; bestPhase = phase; }
  }
  // Refine tempo and phase: least-squares line through the strongest onset near
  // each grid beat (weighted by strength). Two passes absorb small tempo errors.
  let start = bestPhase, step = period;
  for (let pass = 0; pass < 2; pass++) {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    const half = Math.max(1, Math.floor(step / 4));
    for (let k = 0, f = start; f < novelty.length; k++, f = start + k * step) {
      const c = Math.round(f);
      let peak = -1, at = c;
      for (let j = Math.max(0, c - half); j <= Math.min(novelty.length - 1, c + half); j++) if (novelty[j] > peak) { peak = novelty[j]; at = j; }
      if (peak <= 0) continue;
      sw += peak; sx += peak * k; sy += peak * at; sxx += peak * k * k; sxy += peak * k * at;
    }
    const det = sw * sxx - sx * sx;
    if (!(sw > 0) || Math.abs(det) < 1e-9) break;
    const slope = (sw * sxy - sx * sy) / det, intercept = (sy - slope * sx) / sw;
    if (!(slope > period * 0.97 && slope < period * 1.03)) break;
    step = slope; start = intercept;
    while (start - step >= -3) start -= step;
    while (start < -3) start += step;
  }
  const fittedBpm = 60 * envRate / step;
  const beatSec = 60 / fittedBpm, offset = Math.max(0, start / envRate), beats = [];
  for (let t = offset; t < duration - 1e-6; t += beatSec) beats.push(r4(t));
  // Score of the final grid: mean onset strength on its beats (compares tempo candidates).
  const score = beats.length ? beats.reduce((s, t) => s + strengthAt(novelty, t * envRate), 0) / beats.length : 0;
  return { beats, offset: r4(offset), score, bpm: r3(fittedBpm) };
}

/** Which beat of the bar is "one": the slot with the most bass onset. */
export function findDownbeats(beats, features, beatsPerBar = BEATS_PER_BAR) {
  if (beats.length < beatsPerBar) return { downbeats: beats.slice(0, 1), first: 0 };
  const scores = Array.from({ length: beatsPerBar }, () => 0);
  beats.forEach((t, i) => {
    const f = t * features.envRate;
    scores[i % beatsPerBar] += strengthAt(features.bassNovelty, f) + 0.5 * strengthAt(features.novelty, f);
  });
  const first = scores.indexOf(Math.max(...scores));
  return { downbeats: beats.filter((_, i) => i % beatsPerBar === first % beatsPerBar), first };
}

/** Energy curve at ENERGY_RATE Hz, 0..1 (95th percentile = 1), lightly smoothed. */
export function energyCurve(features, rate = ENERGY_RATE) {
  const per = Math.max(1, Math.round(features.envRate / rate));
  const n = Math.max(1, Math.ceil(features.energy.length / per));
  const raw = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let f = i * per; f < Math.min(features.energy.length, (i + 1) * per); f++) { s += features.energy[f]; c++; }
    raw[i] = Math.sqrt(c ? s / c : 0);
  }
  const sorted = [...raw].sort((a, b) => a - b);
  const ref = sorted[Math.floor(0.95 * (sorted.length - 1))] || sorted.at(-1) || 1;
  const smooth = raw.map((_, i) => {
    let s = 0, c = 0;
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < n) { s += raw[k]; c++; }
    return s / c;
  });
  return { rate, values: smooth.map(v => r3(clamp(ref > 0 ? v / ref : 0, 0, 1))) };
}

/** Mean of the energy curve between two times. */
export function energyBetween(energy, a, b) {
  const vals = energy?.values || [];
  if (!vals.length) return 0;
  const i0 = clamp(Math.floor(a * energy.rate), 0, vals.length - 1), i1 = clamp(Math.ceil(b * energy.rate), i0 + 1, vals.length);
  let s = 0;
  for (let i = i0; i < i1; i++) s += vals[i];
  return s / (i1 - i0);
}

/**
 * Sections from per-bar features. Boundaries sit on bar lines, at least `minBars`
 * apart; labels come from position and relative energy.
 */
export function detectSections({ bars, duration, energy, features = null, minBars = 4 }) {
  const end = duration;
  if (!bars?.length || bars.length < 2) {
    return labelSections([{ start: 0, end: r3(end), energy: r3(energyBetween(energy, 0, end)) }]);
  }
  const spans = bars.map((t, i) => [i === 0 ? 0 : t, i + 1 < bars.length ? bars[i + 1] : end]).filter(([a, b]) => b - a > 1e-3);
  const feat = spans.map(([a, b]) => {
    const e = energyBetween(energy, a, b);
    let onset = 0, bass = 0;
    if (features) {
      const f0 = Math.floor(a * features.envRate), f1 = Math.min(features.novelty.length, Math.ceil(b * features.envRate));
      for (let f = f0; f < f1; f++) { onset += features.novelty[f]; bass += features.bassNovelty[f]; }
      const len = Math.max(1, f1 - f0);
      onset /= len; bass /= len;
    }
    return [e, onset, bass];
  });
  // z-score each feature (energy weighted double — it drives the labels too)
  const dims = feat[0].length, weights = [2, 1, 1];
  const norm = feat.map(row => row.slice());
  for (let d = 0; d < dims; d++) {
    const col = feat.map(r => r[d]);
    const m = col.reduce((s, v) => s + v, 0) / col.length;
    const sd = Math.sqrt(col.reduce((s, v) => s + (v - m) ** 2, 0) / col.length) || 1;
    norm.forEach((r, i) => { r[d] = (feat[i][d] - m) / sd * weights[d]; });
  }
  const w = minBars;
  const novelty = spans.map((_, i) => {
    if (i < 2 || i > spans.length - 2) return 0;
    const before = norm.slice(Math.max(0, i - w), i), after = norm.slice(i, Math.min(spans.length, i + w));
    const mean = rows => Array.from({ length: dims }, (_, d) => rows.reduce((s, r) => s + r[d], 0) / rows.length);
    const mb = mean(before), ma = mean(after);
    return Math.sqrt(mb.reduce((s, v, d) => s + (v - ma[d]) ** 2, 0));
  });
  const nz = novelty.filter(v => v > 0);
  const mu = nz.reduce((s, v) => s + v, 0) / (nz.length || 1);
  const sd = Math.sqrt(nz.reduce((s, v) => s + (v - mu) ** 2, 0) / (nz.length || 1));
  const threshold = Math.max(0.8, mu + 0.5 * sd);
  const maxSections = clamp(Math.round(duration / 10), 2, 16);
  const candidates = novelty.map((v, i) => ({ i, v }))
    .filter(({ i, v }) => v >= threshold && v >= (novelty[i - 1] ?? 0) && v >= (novelty[i + 1] ?? 0))
    .sort((a, b) => b.v - a.v);
  const cuts = [];
  for (const c of candidates) {
    if (cuts.length >= maxSections - 1) break;
    if (c.i < minBars || spans.length - c.i < minBars / 2) continue;
    if (cuts.every(k => Math.abs(k - c.i) >= minBars)) cuts.push(c.i);
  }
  cuts.sort((a, b) => a - b);
  const edges = [0, ...cuts, spans.length];
  const sections = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const a = spans[edges[k]][0], b = spans[edges[k + 1] - 1][1];
    sections.push({ start: r3(a), end: r3(b), bars: edges[k + 1] - edges[k], energy: r3(energyBetween(energy, a, b)) });
  }
  return labelSections(sections);
}

/** intro / verse / chorus / bridge / outro from position and relative energy. */
export function labelSections(sections) {
  const n = sections.length;
  if (!n) return [];
  if (n === 1) return [{ ...sections[0], label: 'verse' }];
  const es = sections.map(s => s.energy);
  const lo = Math.min(...es), hi = Math.max(...es);
  const flat = hi - lo < 0.08;
  const high = lo + 0.6 * (hi - lo);
  const labels = sections.map((s, i) => {
    if (n >= 3 && i === 0 && (flat || s.energy < high)) return 'intro';
    if (n >= 3 && i === n - 1 && (flat || s.energy < high)) return 'outro';
    if (!flat && s.energy >= high) return 'chorus';
    return 'verse';
  });
  // A quieter middle part after two choruses, with a chorus still to come → bridge.
  let choruses = 0;
  labels.forEach((label, i) => {
    if (label === 'chorus') { choruses++; return; }
    if (label === 'verse' && choruses >= 2 && labels.slice(i + 1).includes('chorus')) labels[i] = 'bridge';
  });
  return sections.map((s, i) => ({ ...s, label: labels[i] }));
}

/** Assemble an analysis from features for a given bpm (detected when omitted). */
export function buildAnalysis(features, { bpm = null, source = 'browser', beatsPerBar = BEATS_PER_BAR } = {}) {
  const tempo = bpm ? { bpm, confidence: null } : estimateTempo(features.novelty, features.envRate);
  const duration = r3(features.duration);
  const grid = beatGrid(features.novelty, features.envRate, tempo.bpm, duration);
  if (grid.bpm) tempo.bpm = grid.bpm;  // the fitted grid tempo (refines a seeded bpm too)
  const { downbeats } = findDownbeats(grid.beats, features, beatsPerBar);
  const energy = energyCurve(features);
  const sections = detectSections({ bars: downbeats, duration, energy, features });
  return {
    version: ANALYSIS_VERSION, source, duration, bpm: r3(tempo.bpm), confidence: tempo.confidence,
    beatsPerBar, beats: grid.beats, downbeats, gridScore: r4(grid.score), energy, sections,
  };
}

/** Full analysis of mono samples (any rate). */
export function analyzeSamples(samples, rate, options = {}) {
  const reduced = downsample(samples, rate, TARGET_RATE);
  const features = extractFeatures(reduced.samples, reduced.rate);
  return { analysis: buildAnalysis(features, options), features };
}

/** Synthetic test signal: clicks at `bpm`, louder on beat one, with a per-bar level. */
export function clickTrack({ bpm = 120, bars = 32, rate = 11025, level = () => 1, accent = 1.6, noise = 0.02, seed = 7 }) {
  const beatSec = 60 / bpm, n = Math.ceil(bars * 4 * beatSec * rate);
  const out = new Float32Array(n);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) out[i] = noise * level(Math.floor(i / rate / beatSec / 4)) * rnd();
  for (let b = 0; b < bars * 4; b++) {
    const start = Math.round(b * beatSec * rate), gain = level(Math.floor(b / 4)) * (b % 4 === 0 ? accent : 1) * 0.5;
    for (let k = 0; k < Math.round(0.03 * rate) && start + k < n; k++) {
      const env = Math.exp(-k / (0.006 * rate));
      out[start + k] += gain * env * Math.sin(2 * Math.PI * (b % 4 === 0 ? 90 : 900) * k / rate);
    }
  }
  return out;
}
