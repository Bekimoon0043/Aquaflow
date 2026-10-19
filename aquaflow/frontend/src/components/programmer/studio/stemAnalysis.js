// Stem analysis — one separated track of the song (drums, bass, vocals, other, piano,
// guitar) turned into the curves the fountain follows. Pure functions (run in a Web Worker
// by stemSync.js and directly by the tests). Input: mono samples at any rate.
//
//   level   loudness 0..1 at 20 per second (dB between a floor and the stem's own peak,
//           fast attack / slower release so jets rise with a note and settle after it)
//   hits    onsets (time, strength 0..1): full band, plus kick (low band) and hat/snare
//           (high band) for drums
//   pitch   melody 0..1 at 20 per second (YIN pitch, mapped across the stem's own range),
//           -1 where nothing is sung / played

import { downsample, TARGET_RATE } from './musicAnalysis';

export const STEM_RATE = 20;          // curve points per second
export const STEM_VERSION = 1;

export const STEM_ROLES = {
  drums: { label: 'Drums', color: '#ff4d4d', melodic: false },
  bass: { label: 'Bass', color: '#2f6bff', melodic: false },
  vocals: { label: 'Vocals', color: '#ff4fd8', melodic: true },
  other: { label: 'Other', color: '#35d0c0', melodic: true },
  piano: { label: 'Piano', color: '#ffd84d', melodic: true },
  guitar: { label: 'Guitar', color: '#ff9a3c', melodic: true },
};

/** "Song (Vocals).wav" → vocals; "drums.mp3" → drums; unknown → other. */
export function guessRole(fileName = '') {
  const n = String(fileName).toLowerCase();
  if (/drum|perc|kick|beat/.test(n)) return 'drums';
  if (/bass/.test(n)) return 'bass';
  if (/vocal|voice|vox|sing|acapella/.test(n)) return 'vocals';
  if (/piano|keys|keyboard/.test(n)) return 'piano';
  if (/guitar|gtr/.test(n)) return 'guitar';
  return 'other';
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const percentile = (arr, p) => {
  const a = Array.from(arr).filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))] : 0;
};

/** Band energies every 10 ms: full, low (< ~150 Hz) and high (> ~3 kHz). */
function bandEnergies(samples, rate) {
  const hop = Math.max(1, Math.round(rate * 0.01));
  const n = Math.floor(samples.length / hop);
  const full = new Float64Array(n), low = new Float64Array(n), high = new Float64Array(n);
  const aLow = 1 - Math.exp(-2 * Math.PI * 150 / rate);
  const aHigh = 1 - Math.exp(-2 * Math.PI * 3000 / rate);
  let lp = 0, lp3 = 0;
  for (let b = 0; b < n; b++) {
    let e = 0, el = 0, eh = 0;
    for (let i = b * hop, end = i + hop; i < end; i++) {
      const x = samples[i];
      lp += aLow * (x - lp);
      lp3 += aHigh * (x - lp3);
      const hp = x - lp3;
      e += x * x; el += lp * lp; eh += hp * hp;
    }
    full[b] = e / hop; low[b] = el / hop; high[b] = eh / hop;
  }
  return { full, low, high, rate: rate / hop };
}

/** Half-wave rectified log-energy difference (onset strength) of a 10 ms energy series. */
function novelty(energy) {
  const out = new Float64Array(energy.length);
  let prev = Math.log1p(energy[0] * 1000);
  for (let i = 1; i < energy.length; i++) {
    const l = Math.log1p(energy[i] * 1000);
    out[i] = Math.max(0, l - prev);
    prev = l;
  }
  return out;
}

/**
 * Peaks of an onset curve above a running threshold (median of the last second + margin),
 * at least `minGap` seconds apart. Strength is normalised to the stem's strongest onsets.
 */
export function pickOnsets(curve, curveRate, { minGap = 0.09, k = 1.6 } = {}) {
  const n = curve.length;
  if (!n) return [];
  const win = Math.max(3, Math.round(curveRate));
  const peakRef = percentile(curve, 0.995) || 1;
  const floor = percentile(curve, 0.6);
  const hits = [];
  let last = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const v = curve[i];
    if (!(v > curve[i - 1] && v >= curve[i + 1])) continue;
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - win); j < i; j++) { sum += curve[j]; cnt++; }
    const local = cnt ? sum / cnt : 0;
    if (v < Math.max(floor * 2, local * k, peakRef * 0.12)) continue;
    const t = i / curveRate;
    if (t - last < minGap) {
      if (hits.length && v > hits.at(-1).raw) { hits[hits.length - 1] = { t: r3(t), raw: v }; last = t; }
      continue;
    }
    hits.push({ t: r3(t), raw: v });
    last = t;
  }
  return hits.map((h) => ({ t: h.t, s: r3(clamp(h.raw / peakRef, 0.05, 1)) }));
}

/** Loudness 0..1 at STEM_RATE with attack/release smoothing. */
export function levelCurve(energy10ms, rate10ms, { attack = 0.03, release = 0.25, range = 36 } = {}) {
  // Average each 1/STEM_RATE window by time (exact, so long songs do not drift).
  const n = Math.floor(energy10ms.length * STEM_RATE / rate10ms);
  const db = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * rate10ms / STEM_RATE), b = Math.max(a + 1, Math.floor((i + 1) * rate10ms / STEM_RATE));
    let e = 0;
    for (let k = a; k < b; k++) e += energy10ms[k] || 0;
    db[i] = 10 * Math.log10(e / (b - a) + 1e-12);
  }
  const peak = percentile(db, 0.98);
  const floor = Math.max(peak - range, percentile(db, 0.05));
  const out = new Array(n);
  const dt = 1 / STEM_RATE;
  const up = 1 - Math.exp(-dt / attack), down = 1 - Math.exp(-dt / release);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const x = peak - floor > 1e-6 ? clamp((db[i] - floor) / (peak - floor), 0, 1) : 0;
    y += (x > y ? up : down) * (x - y);
    out[i] = r3(y);
  }
  return out;
}

/** YIN fundamental frequency (Hz) of one frame, or 0 when unvoiced. */
function yin(frame, rate, minHz = 70, maxHz = 1000, threshold = 0.15) {
  const W = frame.length >> 1;
  const tauMin = Math.max(2, Math.floor(rate / maxHz)), tauMax = Math.min(W - 1, Math.ceil(rate / minHz));
  const d = new Float64Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = frame[i] - frame[i + tau]; s += x * x; }
    d[tau] = s;
  }
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    run += d[tau];
    d[tau] = run > 0 ? d[tau] * tau / run : 1;
  }
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (d[tau] < threshold) {
      while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a - 2 * b + c;
      const shift = den > 0 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0;
      return rate / (tau + shift);
    }
  }
  return 0;
}

/** Melody 0..1 at STEM_RATE (−1 = silent / unpitched), over the stem's own pitch range. */
export function pitchCurve(samples, rate, level) {
  const size = 1024;
  const startOf = (i) => Math.round(i * rate / STEM_RATE);
  const n = Math.min(level.length, Math.floor((samples.length - size) * STEM_RATE / rate) + 1);
  const midi = new Array(Math.max(0, n)).fill(null);
  const frame = new Float32Array(size);
  for (let i = 0; i < n; i++) {
    if (!(level[i] > 0.12)) continue;
    frame.set(samples.subarray(startOf(i), startOf(i) + size));
    const hz = yin(frame, rate);
    if (hz > 0) midi[i] = 69 + 12 * Math.log2(hz / 440);
  }
  // Median-of-3 to drop octave blips, then map the stem's own range (5th–95th pct) to 0..1.
  const clean = midi.map((m, i) => {
    if (m == null) return null;
    const w = [midi[i - 1], m, midi[i + 1]].filter((v) => v != null).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  const voiced = clean.filter((m) => m != null);
  if (voiced.length < 3) return clean.map(() => -1);
  const lo = percentile(voiced, 0.05), hi = percentile(voiced, 0.95);
  return clean.map((m) => (m == null ? -1 : r3(hi - lo > 0.5 ? clamp((m - lo) / (hi - lo), 0, 1) : 0.5)));
}

/** Full analysis of one stem. */
export function analyzeStem(samples, rate, role = 'other') {
  const reduced = downsample(samples, rate, TARGET_RATE);
  const s = reduced.samples, sr = reduced.rate;
  const bands = bandEnergies(s, sr);
  const level = levelCurve(bands.full, bands.rate);
  const result = {
    version: STEM_VERSION, role, rate: STEM_RATE, duration: r3(s.length / sr),
    level, hits: pickOnsets(novelty(bands.full), bands.rate),
  };
  if (role === 'drums') {
    result.kicks = pickOnsets(novelty(bands.low), bands.rate, { minGap: 0.15 });
    result.hats = pickOnsets(novelty(bands.high), bands.rate, { minGap: 0.07 });
  }
  if (STEM_ROLES[role]?.melodic) result.pitch = pitchCurve(s, sr, level);
  return result;
}

// ── Synthetic test signals ──────────────────────────────────────────────────────

/** A sung-like tone: pitch glides from `fromHz` to `toHz`, silent where `on(t)` is false. */
export function toneTrack({ seconds = 6, rate = TARGET_RATE, fromHz = 220, toHz = 440, on = () => true }) {
  const out = new Float32Array(Math.round(seconds * rate));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const hz = fromHz * Math.pow(toHz / fromHz, t / seconds);
    phase += 2 * Math.PI * hz / rate;
    out[i] = on(t) ? 0.5 * Math.sin(phase) + 0.15 * Math.sin(2 * phase) : 0;
  }
  return out;
}

/** Drum-like signal: low thumps (kick) and short noise bursts (hat) at given times. */
export function drumTrack({ seconds = 4, rate = TARGET_RATE, kicks = [], hats = [], seed = 3 }) {
  const out = new Float32Array(Math.round(seconds * rate));
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) >>> 0; return r / 4294967296 * 2 - 1; };
  for (const t0 of kicks) {
    for (let i = 0; i < 0.15 * rate; i++) {
      const t = i / rate, at = Math.round(t0 * rate) + i;
      if (at < out.length) out[at] += 0.9 * Math.exp(-t / 0.05) * Math.sin(2 * Math.PI * 60 * t);
    }
  }
  for (const t0 of hats) {
    for (let i = 0; i < 0.04 * rate; i++) {
      const at = Math.round(t0 * rate) + i;
      if (at < out.length) out[at] += 0.35 * Math.exp(-(i / rate) / 0.01) * rnd();
    }
  }
  return out;
}
