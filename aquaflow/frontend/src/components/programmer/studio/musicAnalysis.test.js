import { describe, expect, it } from 'vitest';
import {
  analyzeSamples, clickTrack, downsample, energyBetween, estimateTempo, extractFeatures, labelSections, toMono,
} from './musicAnalysis';

// 32 bars: quiet intro (4) · verse (8) · loud chorus (8) · verse (8) · quiet outro (4).
const LEVELS = [...Array(4).fill(.2), ...Array(8).fill(.5), ...Array(8).fill(1), ...Array(8).fill(.5), ...Array(4).fill(.2)];
const song = (bpm, rate = 22050) => analyzeSamples(clickTrack({ bpm, bars: 32, rate, level: b => LEVELS[b] ?? .2 }), rate).analysis;

describe('song analysis on a synthetic click track', () => {
  it.each([96, 120, 140])('finds %s BPM, the beat grid and beat one', bpm => {
    const a = song(bpm);
    const beatSec = 60 / bpm;
    expect(a.bpm).toBeCloseTo(bpm, 0);
    expect(Math.abs(a.bpm - bpm)).toBeLessThan(.5);
    // Beats sit on the clicks (within 30 ms) all the way through the song.
    for (const t of [a.beats[0], a.beats[40], a.beats.at(-1)]) {
      const offset = t / beatSec - Math.round(t / beatSec);
      expect(Math.abs(offset * beatSec)).toBeLessThan(.03);
    }
    // Downbeats are the accented bass clicks: every 4th beat, starting on bar lines.
    expect(a.downbeats.length).toBeGreaterThanOrEqual(31);
    for (const t of a.downbeats.slice(0, 8)) expect(Math.abs(t / (4 * beatSec) - Math.round(t / (4 * beatSec))) * 4 * beatSec).toBeLessThan(.03);
  });

  it('estimates intro / verse / chorus / verse / outro from the energy changes', () => {
    const a = song(120);
    expect(a.sections.map(s => s.label)).toEqual(['intro', 'verse', 'chorus', 'verse', 'outro']);
    // Boundaries land on the bar lines where the level changes (2 s bars).
    expect(a.sections.map(s => Math.round(s.start))).toEqual([0, 8, 24, 40, 56]);
    expect(a.sections.at(-1).end).toBeCloseTo(64, 1);
    const chorus = a.sections[2];
    expect(chorus.energy).toBeGreaterThan(a.sections[1].energy);
    expect(a.sections[0].energy).toBeLessThan(a.sections[1].energy);
  });

  it('builds a 0–1 energy curve that follows the loudness', () => {
    const a = song(120);
    expect(a.energy.rate).toBe(4);
    expect(a.energy.values.length).toBeGreaterThanOrEqual(255);
    expect(Math.max(...a.energy.values)).toBeLessThanOrEqual(1);
    expect(energyBetween(a.energy, 26, 38)).toBeGreaterThan(energyBetween(a.energy, 10, 22));
    expect(energyBetween(a.energy, 10, 22)).toBeGreaterThan(energyBetween(a.energy, 1, 7));
  });

  it('labels a bridge between late choruses and handles flat or tiny inputs', () => {
    const labels = labelSections([.2, .5, .9, .5, .9, .45, .95, .2].map((energy, i) => ({ start: i * 10, end: i * 10 + 10, energy }))).map(s => s.label);
    expect(labels).toEqual(['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro']);
    expect(labelSections([{ start: 0, end: 5, energy: .4 }])[0].label).toBe('verse');
    expect(estimateTempo(new Float32Array(4), 100).bpm).toBe(0);
    const silent = analyzeSamples(new Float32Array(22050 * 4), 22050).analysis;
    expect(silent.bpm).toBe(0);
    expect(silent.sections).toHaveLength(1);
  });

  it('mixes channels and downsamples to about 11 kHz', () => {
    expect(Array.from(toMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([.5, .5]);
    const { samples, rate } = downsample(new Float32Array(44100), 44100);
    expect(rate).toBe(11025);
    expect(samples.length).toBe(11025);
    expect(extractFeatures(samples, rate).envRate).toBeCloseTo(100, 0);
  });
});
