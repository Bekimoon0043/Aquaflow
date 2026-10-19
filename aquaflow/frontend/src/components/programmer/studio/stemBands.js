// Frequency bands of a stem (or the whole mix) over time — what the music graph in the
// timeline draws and what "patterns from the music" reads.
//
// Seven bands (audio-engineering convention): sub 20–60, bass 60–250, low-mid 250–500,
// mid 500–2k, high-mid 2–4k, presence 4–6k, brilliance 6k–Nyquist Hz. Energy per band at
// 20 frames a second, in dB, normalised per band to 0..1 between (peak − 45 dB) and the
// band's own 98th percentile — so a quiet hi-hat band is as readable as the bass. Stored
// compactly as base64 bytes (0..255).

export const BANDS = [
  { id: 'sub', label: 'Sub', lo: 20, hi: 60, color: '#ff3b3b' },
  { id: 'bass', label: 'Bass', lo: 60, hi: 250, color: '#ff8a3b' },
  { id: 'lowMid', label: 'Low-mid', lo: 250, hi: 500, color: '#ffd23b' },
  { id: 'mid', label: 'Mid', lo: 500, hi: 2000, color: '#6dff8a' },
  { id: 'highMid', label: 'High-mid', lo: 2000, hi: 4000, color: '#3bd6ff' },
  { id: 'presence', label: 'Presence', lo: 4000, hi: 6000, color: '#5b7bff' },
  { id: 'brilliance', label: 'Brilliance', lo: 6000, hi: 20000, color: '#c77dff' },
];
export const BAND_RATE = 20;
export const BAND_RANGE_DB = 45;

const percentile = (arr, p) => {
  const a = Array.from(arr).filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))] : 0;
};

/** Which band a frequency bin belongs to (−1 = outside). */
export function bandOfHz(hz) {
  for (let b = 0; b < BANDS.length; b++) if (hz >= BANDS[b].lo && hz < BANDS[b].hi) return b;
  return -1;
}

/**
 * Normalise per-band energy series (7 × frames, any frame rate) to the stored form:
 * resampled to BAND_RATE by averaging, dB, per-band 0..1, packed as bytes.
 * @param {Float64Array[]} energy one series per band
 * @param {number} frameRate     frames per second of `energy`
 * @param {number} nyquist       highest frequency present (bands above it are marked empty)
 */
export function packBands(energy, frameRate, nyquist) {
  const frames = energy[0]?.length || 0;
  const n = Math.floor(frames * BAND_RATE / frameRate);
  const bytes = new Uint8Array(n * BANDS.length);
  const present = BANDS.map((b) => b.lo < nyquist);
  for (let b = 0; b < BANDS.length; b++) {
    if (!present[b]) continue;
    const db = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * frameRate / BAND_RATE), z = Math.max(a + 1, Math.floor((i + 1) * frameRate / BAND_RATE));
      let s = 0;
      for (let k = a; k < z && k < frames; k++) s += energy[b][k];
      db[i] = 10 * Math.log10(s / (z - a) + 1e-14);
    }
    const peak = percentile(db, 0.98);
    const floor = Math.max(peak - BAND_RANGE_DB, percentile(db, 0.02));
    for (let i = 0; i < n; i++) {
      const v = peak - floor > 1e-6 ? (db[i] - floor) / (peak - floor) : 0;
      bytes[i * BANDS.length + b] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
  return { rate: BAND_RATE, count: BANDS.length, frames: n, present, data: toBase64(bytes) };
}

/** Band energies straight from samples (STFT 2048, frames at exactly BAND_RATE·2). */
export function computeBands(samples, rate, fft) {
  const N = 2048, frameRate = BAND_RATE * 2;
  // Every frame up to the end of the song (the last windows read zeros past the end).
  const frames = Math.max(1, Math.floor(samples.length * frameRate / rate));
  const energy = BANDS.map(() => new Float64Array(frames));
  const re = new Float64Array(N), im = new Float64Array(N);
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  const binBand = Int8Array.from({ length: N / 2 + 1 }, (_, k) => bandOfHz(k * rate / N));
  for (let f = 0; f < frames; f++) {
    const at = Math.round(f * rate / frameRate);
    for (let i = 0; i < N; i++) { re[i] = (samples[at + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k <= N / 2; k++) {
      const b = binBand[k];
      if (b >= 0) energy[b][f] += re[k] * re[k] + im[k] * im[k];
    }
  }
  return packBands(energy, frameRate, rate / 2);
}

/** Stored bands → { at(i, b) 0..1, frames, rate }. */
export function readBands(packed) {
  if (!packed?.data) return null;
  const bytes = fromBase64(packed.data);
  const count = packed.count || BANDS.length;
  return {
    frames: packed.frames, rate: packed.rate || BAND_RATE, present: packed.present || BANDS.map(() => true), bytes, count,
    at: (i, b) => (i >= 0 && i < packed.frames ? bytes[i * count + b] / 255 : 0),
  };
}

/** Mean of each band between two times (seconds): the band "fingerprint" of a phrase. */
export function bandMeans(bands, t0, t1) {
  const out = new Array(BANDS.length).fill(0);
  if (!bands) return out;
  const a = Math.max(0, Math.floor(t0 * bands.rate)), b = Math.min(bands.frames, Math.ceil(t1 * bands.rate));
  if (b <= a) return out;
  for (let i = a; i < b; i++) for (let k = 0; k < BANDS.length; k++) out[k] += bands.at(i, k);
  return out.map((v) => v / (b - a));
}

/** Spectral "brightness": the weighted band index 0 (sub) … 1 (brilliance). */
export function brightness(means) {
  let s = 0, w = 0;
  means.forEach((v, k) => { s += v * k; w += v; });
  return w > 0 ? s / w / (BANDS.length - 1) : 0;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    s += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
      + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : B64[c & 63]);
  }
  return s;
}
export function fromBase64(s) {
  const clean = String(s).replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
