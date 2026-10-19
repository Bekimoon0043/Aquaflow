// Split a full song into estimated stems for the fountain — no AI model, plain signal
// processing (so no licence limits on the weights):
//
//   STFT (2048 / hop 512 at ~22 kHz) → harmonic / percussive separation by median
//   filtering (across time = sustained notes, across frequency = hits; soft masks)
//   drums   = the percussive part: full band (every hit), > 3 kHz (hats); kicks from the
//             low band (< 150 Hz) of the whole mix
//   bass    = the harmonic part below 250 Hz
//   vocals  = the harmonic part 250 Hz – 3 kHz (the lead melody: usually the voice),
//             resynthesised so the same pitch tracker as real stems can follow it
//
// It is an estimate: clean stems from the producer are better when you have them.
// Output records match stemAnalysis.analyzeStem, so the rest of the pipeline is shared.

import { downsample } from './musicAnalysis';
import { STEM_RATE, STEM_VERSION, levelCurve, pickOnsets, pitchCurve } from './stemAnalysis';
import { fft } from './fft';
import { BANDS, bandOfHz, packBands } from './stemBands';

export { fft };

export const SPLIT_RATE = 22050;
const N = 2048, HOP = 512, BINS = N / 2 + 1;
const r3 = (v) => Math.round(v * 1000) / 1000;

const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));

function median17(buf, len) {
  // insertion sort of a tiny window
  for (let i = 1; i < len; i++) { const v = buf[i]; let j = i - 1; while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; } buf[j + 1] = v; }
  return buf[len >> 1];
}

/** Resample a frame-rate series to exactly STEM_RATE·k Hz by averaging each output window. */
function resample(series, fromRate, toRate) {
  const n = Math.floor(series.length * toRate / fromRate);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * fromRate / toRate), b = Math.max(a + 1, Math.floor((i + 1) * fromRate / toRate));
    let s = 0;
    for (let k = a; k < b && k < series.length; k++) s += series[k];
    out[i] = s / (b - a);
  }
  return out;
}

/**
 * @param {Float32Array} samples mono, any rate
 * @param {number} rate
 * @param {function} [onProgress] (0..1)
 * @returns {{ drums, bass, vocals }} analyses shaped like analyzeStem's
 */
export function splitSong(samples, rate, onProgress = null) {
  const red = downsample(samples, rate, SPLIT_RATE);
  const x = red.samples, sr = red.rate;
  const frames = Math.max(1, Math.floor((x.length - N) / HOP) + 1);
  const mag = new Float32Array(frames * BINS);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = (x[f * HOP + i] || 0) * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < BINS; k++) mag[f * BINS + k] = Math.hypot(re[k], im[k]);
  }
  onProgress?.(0.25);

  // Median filters: harmonic (17 frames ≈ 0.4 s along time), percussive (17 bins ≈ 180 Hz).
  const W = 17, half = 8, buf = new Float64Array(W);
  const H = new Float32Array(frames * BINS), P = new Float32Array(frames * BINS);
  for (let k = 0; k < BINS; k++) {
    for (let f = 0; f < frames; f++) {
      let n = 0;
      for (let d = -half; d <= half; d++) { const g = f + d; if (g >= 0 && g < frames) buf[n++] = mag[g * BINS + k]; }
      H[f * BINS + k] = median17(buf, n);
    }
  }
  onProgress?.(0.5);
  for (let f = 0; f < frames; f++) {
    const row = f * BINS;
    for (let k = 0; k < BINS; k++) {
      let n = 0;
      for (let d = -half; d <= half; d++) { const q = k + d; if (q >= 0 && q < BINS) buf[n++] = mag[row + q]; }
      P[row + k] = median17(buf, n);
    }
  }
  onProgress?.(0.7);

  const hz = (k) => k * sr / N;
  const kick = Math.round(150 * N / sr), hat = Math.round(3000 * N / sr);
  const bassLo = Math.max(1, Math.round(30 * N / sr)), bassHi = Math.round(250 * N / sr), melHi = Math.round(3000 * N / sr);
  const eDrum = new Float64Array(frames), eKick = new Float64Array(frames), eHat = new Float64Array(frames);
  const eBass = new Float64Array(frames), eMel = new Float64Array(frames);
  const melMask = new Float32Array(frames * (melHi - bassHi + 1));
  // Per-band energies of each estimated stem and of the whole mix (the music graph).
  const nb = BANDS.length;
  const band = { mix: BANDS.map(() => new Float64Array(frames)), drums: BANDS.map(() => new Float64Array(frames)),
    bass: BANDS.map(() => new Float64Array(frames)), vocals: BANDS.map(() => new Float64Array(frames)) };
  const binBand = Int8Array.from({ length: BINS }, (_, k) => bandOfHz(k * sr / N));
  void nb;
  for (let f = 0; f < frames; f++) {
    for (let k = 1; k < BINS; k++) {
      const i = f * BINS + k, h2 = H[i] * H[i], p2 = P[i] * P[i], s = mag[i];
      const mh = h2 / (h2 + p2 + 1e-12), mp = 1 - mh;
      const ep = (mp * s) ** 2, eh = (mh * s) ** 2;
      const b = binBand[k];
      if (b >= 0) {
        band.mix[b][f] += s * s;
        band.drums[b][f] += ep;
        if (k <= bassHi) band.bass[b][f] += eh;
        else band.vocals[b][f] += eh;
      }
      eDrum[f] += ep;
      // A kick is a narrow low thump that median filtering calls "harmonic": find it in
      // the low band of the full mix (bass note starts can also count as kicks).
      if (k <= kick) eKick[f] += s * s;
      if (k >= hat) eHat[f] += ep;
      if (k >= bassLo && k <= bassHi) eBass[f] += eh;
      if (k > bassHi && k <= melHi) { eMel[f] += eh; melMask[f * (melHi - bassHi + 1) + (k - bassHi)] = mh; }
    }
  }
  void hz;

  // Lead melody resynthesis (harmonic mask, 250 Hz – 3 kHz) for the pitch tracker.
  const mel = new Float32Array(x.length);
  const norm = new Float32Array(x.length);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = (x[f * HOP + i] || 0) * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < BINS; k++) {
      const m = k > bassHi && k <= melHi ? melMask[f * (melHi - bassHi + 1) + (k - bassHi)] : 0;
      re[k] *= m; im[k] *= m;
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) { const at = f * HOP + i; if (at < mel.length) { mel[at] += re[i] * hann[i]; norm[at] += hann[i] * hann[i]; } }
  }
  for (let i = 0; i < mel.length; i++) if (norm[i] > 1e-6) mel[i] /= norm[i];
  onProgress?.(0.9);

  const frameRate = sr / HOP;
  const fine = 100;                                 // onset curves at 100 Hz
  const onsets = (e, opts) => {
    const r = resample(e, frameRate, fine);
    const nov = new Float64Array(r.length);
    let prev = Math.log1p(r[0] * 1e3);
    for (let i = 1; i < r.length; i++) { const l = Math.log1p(r[i] * 1e3); nov[i] = Math.max(0, l - prev); prev = l; }
    return pickOnsets(nov, fine, opts);
  };
  const level = (e, opts) => levelCurve(resample(e, frameRate, STEM_RATE), STEM_RATE, opts);
  const duration = r3(x.length / sr);
  const base = { version: STEM_VERSION, rate: STEM_RATE, duration, estimated: true };
  const vocalsLevel = level(eMel);
  const packed = (key) => packBands(band[key], frameRate, sr / 2);
  const result = {
    mix: { ...base, role: 'mix', level: level(eDrum.map((v, i) => v + eBass[i] + eMel[i])), bands: packed('mix') },
    drums: { ...base, role: 'drums', bands: packed('drums'), level: level(eDrum, { release: 0.15 }), hits: onsets(eDrum), kicks: onsets(eKick, { minGap: 0.15 }), hats: onsets(eHat, { minGap: 0.07 }) },
    bass: { ...base, role: 'bass', bands: packed('bass'), level: level(eBass), hits: onsets(eBass, { minGap: 0.15 }) },
    vocals: { ...base, role: 'vocals', bands: packed('vocals'), level: vocalsLevel, hits: onsets(eMel), pitch: pitchCurve(mel, sr, vocalsLevel) },
  };
  onProgress?.(1);
  return result;
}
