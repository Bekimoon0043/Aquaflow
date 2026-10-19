import { describe, it, expect } from 'vitest';
import { BANDS, computeBands, readBands, bandMeans, brightness, toBase64, fromBase64 } from './stemBands';
import { fft } from './fft';
import { splitSong } from './stemSplit';
import { drumTrack } from './stemAnalysis';

const rate = 22050;
const tone = (hz, seconds = 3) => Float32Array.from({ length: seconds * rate }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / rate));
const strongest = (bands, t0, t1) => { const m = bandMeans(bands, t0, t1); return BANDS[m.indexOf(Math.max(...m))].id; };

describe('frequency bands', () => {
  it('round-trips the compact storage', () => {
    const bytes = Uint8Array.from({ length: 50 }, (_, i) => (i * 37) % 256);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('puts a 100 Hz tone in Bass and an 1 kHz tone in Mid', () => {
    const low = readBands(computeBands(tone(100), rate, fft));
    const mid = readBands(computeBands(tone(1000), rate, fft));
    expect(low.frames).toBe(60);
    // Each band is normalised to its own range, so compare the tone's band with the rest.
    const lm = bandMeans(low, 0.5, 2.5), mm = bandMeans(mid, 0.5, 2.5);
    expect(lm[1]).toBeGreaterThan(0.5);
    expect(mm[3]).toBeGreaterThan(0.5);
    expect(brightness(mm)).toBeGreaterThan(brightness(lm));
  });

  it('a split drum track shows hats in the top bands and the mix graph covers the song', () => {
    const kicks = Array.from({ length: 8 }, (_, i) => 0.5 + i * 0.5);
    const d = drumTrack({ seconds: 5, rate, kicks, hats: kicks.map(k => k + 0.25) });
    const s = splitSong(d, rate);
    const drums = readBands(s.drums.bands), mix = readBands(s.mix.bands);
    expect(mix.frames).toBeGreaterThanOrEqual(5 * 20 - 3);
    expect(s.drums.bands.present[6]).toBe(true);          // 22 kHz input reaches the brilliance band
    expect(bandMeans(drums, 0.5, 4.5)[5] + bandMeans(drums, 0.5, 4.5)[6]).toBeGreaterThan(0.3);
    void strongest;
  });
});
