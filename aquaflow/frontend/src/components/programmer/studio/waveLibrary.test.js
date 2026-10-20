import { describe, it, expect } from 'vitest';
import { WAVE_KINDS, flowNoise, libraryWave } from './waveLibrary';
import { FIELD_KINDS, FIELD_CONTROLS, defaultField, fieldLevel, memberGeometry } from './wavePatterns';
import { FAMOUS_PATTERNS } from './famousPatterns';
import { LOOKS, lookById } from './lookLibrary';

const ring = Array.from({ length: 24 }, (_, i) => ({ id: `r${i}`, x: 8 * Math.cos((i / 24) * 2 * Math.PI), y: 5 * Math.sin((i / 24) * 2 * Math.PI) }));
const line = Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, x: -10 + i, y: 0 }));
const ringGeo = memberGeometry(ring, { origin: 'tip', ring: true });
const lineGeo = memberGeometry(line, { origin: 'left', ring: false });

describe('wave library', () => {
  it('adds every wave kind to the pattern menu and the editor controls', () => {
    for (const k of WAVE_KINDS) {
      expect(FIELD_KINDS.some((x) => x.id === k.id)).toBe(true);
      expect(FIELD_CONTROLS[k.id]).toEqual(k.controls);
    }
    expect(WAVE_KINDS.length).toBeGreaterThanOrEqual(16);
  });

  it('gives every jet a level between 0 and 1 on lines and rings, deterministically', () => {
    for (const k of WAVE_KINDS) {
      const f = defaultField(k.id);
      for (const geo of [ringGeo, lineGeo]) for (const t of [0, 0.37, 1.9, 7.3]) for (const g of geo) {
        const w = libraryWave(f, g, t);
        expect(w, `${k.id} at ${t}`).toBeGreaterThanOrEqual(0);
        expect(w, `${k.id} at ${t}`).toBeLessThanOrEqual(1.0001);
        expect(libraryWave(f, g, t)).toBe(w);
      }
    }
    expect(libraryWave({ kind: 'travelling' }, ringGeo[0], 0)).toBeNull();
  });

  it('uses real geometry: ripples by distance from the centre, spirals by angle', () => {
    expect(ringGeo.every((g) => g.r > 0.5 && g.r <= 1.0001)).toBe(true);
    expect(lineGeo[0].ro).toBe(0);
    expect(lineGeo.at(-1).ro).toBe(1);
    // A ripple from the left end reaches near jets before far ones.
    const f = { ...defaultField('ripple'), origin: 'tip' };
    const peakTime = (g) => { let best = 0, bt = 0; for (let t = 0; t < 2; t += 0.01) { const w = libraryWave(f, g, t); if (w > best) { best = w; bt = t; } } return bt; };
    expect(peakTime(lineGeo[2])).not.toBe(peakTime(lineGeo[10]));
    // Spiral arms: 3 arms → the ring shows three crests at once.
    const s = defaultField('spiral');
    const lv = ringGeo.map((g) => libraryWave(s, g, 0));
    const peaks = lv.filter((v, i) => v > lv[(i + 1) % lv.length] && v >= lv[(i + lv.length - 1) % lv.length] && v > 0.8).length;
    expect(peaks).toBe(3);
  });

  it('repeats every period, and the heartbeat beats on alternating jets', () => {
    for (const id of ['ripple', 'standing', 'saw', 'bounce', 'surf', 'firework', 'heartbeat2']) {
      const f = defaultField(id), P = f.period;
      for (const g of lineGeo.slice(0, 5)) expect(libraryWave(f, g, 0.4 + P)).toBeCloseTo(libraryWave(f, g, 0.4), 6);
    }
    const hb = defaultField('heartbeat2');
    const a = lineGeo[0], b = lineGeo[1];
    expect(libraryWave(hb, a, 0.06 * hb.period)).toBeGreaterThan(0.9);       // lub on even jets
    expect(libraryWave(hb, b, 0.06 * hb.period)).toBeLessThan(0.2);
    expect(libraryWave(hb, b, 0.32 * hb.period)).toBeGreaterThan(0.9);       // dub on odd jets
    expect(flowNoise(0.3, 0.7, 1.1)).toBe(flowNoise(0.3, 0.7, 1.1));
  });

  it('turns each wave into a field level with the soft start and stop', () => {
    const f = { ...defaultField('lake'), low: 20, high: 80 };
    const lv = fieldLevel(f, ringGeo[3], 4, 30);
    expect(lv).toBeGreaterThanOrEqual(20);
    expect(lv).toBeLessThanOrEqual(80);
  });

  it('offers the waves as looks for the music generator, tied to bars', () => {
    const ids = ['radial-ripple', 'spiral-arms', 'moving-spot', 'pond-interference', 'lake-aurora', 'standing-wave', 'ocean-sets',
      'sawtooth-run', 'wave-packet', 'bounce', 'ringdown', 'surf-break', 'tidal-bore', 'firework-burst', 'willow-burst'];
    for (const id of ids) {
      const look = lookById(id), famous = FAMOUS_PATTERNS.find((f) => f.id === id);
      expect(look, id).toBeTruthy();
      const made = famous.make({ barSec: 2.58, beatSec: 0.645 });
      expect(FIELD_KINDS.some((k) => k.id === made.field.kind), id).toBe(true);
    }
    // The heartbeat now reads on on/off jets (lub and dub on alternating jets).
    expect(lookById('heartbeat').controls).toContain('switch');
    expect(LOOKS.length).toBeGreaterThanOrEqual(37);
  });
});
