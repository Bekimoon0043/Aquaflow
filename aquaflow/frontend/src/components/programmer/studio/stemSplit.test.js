import { describe, it, expect } from 'vitest';
import { fft, splitSong } from './stemSplit';
import { drumTrack, toneTrack, STEM_RATE } from './stemAnalysis';

const near = (list, t, tol = 0.06) => list.some(h => Math.abs(h.t - t) <= tol);

describe('splitting a full mix', () => {
  it('FFT round-trips', () => {
    const re = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i) + i * 0.1), im = new Float64Array(16);
    const copy = Float64Array.from(re);
    fft(re, im); fft(re, im, true);
    re.forEach((v, i) => expect(v).toBeCloseTo(copy[i], 9));
  });

  it('separates drums, bass and a lead melody from one mixed signal', () => {
    const seconds = 12, rate = 22050;
    const kicks = Array.from({ length: 22 }, (_, i) => 0.5 + i * 0.5);
    const drums = drumTrack({ seconds, rate, kicks, hats: kicks.map(k => k + 0.25) });
    const voice = toneTrack({ seconds, rate, fromHz: 300, toHz: 600, on: t => t < 5 || t > 7 });
    const bass = Float32Array.from({ length: seconds * rate }, (_, i) => (i / rate > 6 ? 0.4 : 0.05) * Math.sin(2 * Math.PI * 70 * i / rate));
    const mix = drums.map((v, i) => v + 0.6 * voice[i] + bass[i]);
    const s = splitSong(mix, rate);
    // Drum hits found in the percussive part.
    const found = kicks.filter(t => near(s.drums.kicks, t)).length;
    expect(found / kicks.length).toBeGreaterThan(0.8);
    // Bass louder after 6 s.
    expect(s.bass.level[Math.round(9 * STEM_RATE)]).toBeGreaterThan(s.bass.level[Math.round(3 * STEM_RATE)] + 0.3);
    // Melody rises and rests in the 5–7 s gap.
    const p = t => s.vocals.pitch[Math.round(t * STEM_RATE)];
    expect(p(6)).toBe(-1);
    expect(p(1)).toBeGreaterThanOrEqual(0);
    expect(p(11)).toBeGreaterThan(p(1));
    expect(Math.abs(s.drums.level.length - seconds * STEM_RATE)).toBeLessThanOrEqual(2);
  });
});
