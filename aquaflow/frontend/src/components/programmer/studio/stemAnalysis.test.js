import { describe, it, expect } from 'vitest';
import { analyzeStem, guessRole, toneTrack, drumTrack, levelCurve, STEM_RATE } from './stemAnalysis';

const near = (list, t, tol = 0.05) => list.some(h => Math.abs(h.t - t) <= tol);

describe('stem analysis', () => {
  it('guesses the role from the file name', () => {
    expect(guessRole('Lebu - Drums.wav')).toBe('drums');
    expect(guessRole('song_bass.mp3')).toBe('bass');
    expect(guessRole('Vocals.flac')).toBe('vocals');
    expect(guessRole('piano stem.wav')).toBe('piano');
    expect(guessRole('Guitar.wav')).toBe('guitar');
    expect(guessRole('mystery.wav')).toBe('other');
  });

  it('finds kicks and hats in a drum stem', () => {
    const kicks = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    const hats = [0.75, 1.25, 1.75, 2.25, 2.75, 3.25];
    const a = analyzeStem(drumTrack({ seconds: 4, kicks, hats }), 11025, 'drums');
    for (const t of kicks) expect(near(a.kicks, t), `kick ${t}`).toBe(true);
    for (const t of hats) expect(near(a.hats, t), `hat ${t}`).toBe(true);
    expect(a.kicks.length).toBeLessThanOrEqual(kicks.length + 1);
    for (const t of [...kicks, ...hats]) expect(near(a.hits, t), `hit ${t}`).toBe(true);
    expect(a.level.length).toBeGreaterThanOrEqual(Math.floor(4 * STEM_RATE) - 1);
  });

  it('follows a rising melody and rests where nothing is sung', () => {
    const a = analyzeStem(toneTrack({ seconds: 6, fromHz: 200, toHz: 400, on: t => t < 2.5 || t > 3.5 }), 11025, 'vocals');
    const at = t => a.pitch[Math.round(t * STEM_RATE)];
    expect(at(3)).toBe(-1);
    expect(at(0.5)).toBeLessThan(0.3);
    expect(at(5.5)).toBeGreaterThan(0.7);
    expect(at(1.5)).toBeLessThan(at(4.5));
    expect(a.level[Math.round(3 * STEM_RATE)]).toBeLessThan(0.2);
    expect(a.level[Math.round(1 * STEM_RATE)]).toBeGreaterThan(0.6);
  });

  it('level rises fast and releases slowly', () => {
    const e = new Float64Array(300);
    for (let i = 100; i < 150; i++) e[i] = 1;   // 10 ms frames: loud 1.0–1.5 s
    const lv = levelCurve(e, 100);
    expect(lv[Math.round(1.1 * STEM_RATE)]).toBeGreaterThan(0.8);
    expect(lv[Math.round(1.6 * STEM_RATE)]).toBeGreaterThan(0.3);   // still releasing
    expect(lv[Math.round(2.9 * STEM_RATE)]).toBeLessThan(0.1);
  });
});
