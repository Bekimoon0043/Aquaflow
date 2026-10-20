// Evaluation corpus — licence-free synthetic songs with real structure and synthetic fountain
// sites of different kinds, so the show generator can be scored the same way every run.
// Real songs and sites are added to the harness as .aquapkg files (their stored analysis and
// stems are used); nothing copyrighted lives in the repo.

import { analyzeSamples, clickTrack, downsample } from './musicAnalysis';
import { analyzeStem, drumTrack, toneTrack } from './stemAnalysis';

const SR = 22050;

/**
 * A song from a section list: [{ label, bars, level }] → { name, analysis, stems }.
 * `meter`: 4 (4/4) or 6 (6/8: six eighths per bar, felt as two dotted-quarter pulses).
 */
export function makeSong({ name, bpm = 120, meter = 4, sections }) {
  const barLevels = sections.flatMap((s) => Array.from({ length: s.bars }, () => s.level));
  const bars = barLevels.length;
  const beatSec = 60 / bpm;
  const seconds = bars * meter * beatSec;
  const click = clickTrack({ bpm, bars, rate: 11025, level: (b) => barLevels[Math.min(bars - 1, b)] ?? 0.5 });
  // 4/4 click tracks accent every 4th beat; for 6/8 rebuild the accents every 6th eighth.
  const mix = meter === 4 ? click : sixEight({ bpm, bars, barLevels });
  const { analysis } = analyzeSamples(mix, 11025, { beatsPerBar: meter });
  // Stems: kicks on strong beats (more in loud bars), hats in between, a melody in sung bars.
  const kicks = [], hats = [];
  for (let b = 0; b < bars; b++) {
    const lvl = barLevels[b];
    for (let k = 0; k < meter; k++) {
      const t = (b * meter + k) * beatSec;
      const strong = meter === 6 ? k % 3 === 0 : k % 2 === 0 || lvl > 0.7;
      if (lvl > 0.25 && strong) kicks.push(t);
      if (lvl > 0.45) hats.push(t + beatSec / 2);
    }
  }
  const sungBars = new Set();
  let bar = 0;
  for (const s of sections) { for (let k = 0; k < s.bars; k++) if (s.label !== 'intro' && s.label !== 'outro' && (k % 4) < 3) sungBars.add(bar + k); bar += s.bars; }
  const barOf = (t) => Math.floor(t / (meter * beatSec));
  const stems = [
    { role: 'drums', analysis: analyzeStem(drumTrack({ seconds, rate: SR, kicks, hats }), SR, 'drums') },
    { role: 'vocals', analysis: analyzeStem(toneTrack({ seconds, rate: SR, on: (t) => sungBars.has(barOf(t)) }), SR, 'vocals') },
    { role: 'bass', analysis: analyzeStem(scaled(toneTrack({ seconds, rate: SR, fromHz: 55, toHz: 82 }), (i) => barLevels[barOf(i / SR)] ?? 0.3), SR, 'bass') },
  ];
  return { name, analysis, stems, meter, bpm };
}

function scaled(samples, gain) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain(i);
  return out;
}

/** A 6/8 click track: eighth notes, accents on 1 and 4, louder on 1. */
function sixEight({ bpm, bars, barLevels, rate = 11025 }) {
  const beatSec = 60 / bpm, n = Math.ceil(bars * 6 * beatSec * rate) + rate;
  const out = new Float32Array(n);
  let s = 11;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  for (let i = 0; i < n; i++) out[i] = 0.02 * rnd();
  for (let b = 0; b < bars; b++) for (let k = 0; k < 6; k++) {
    const t0 = Math.round((b * 6 + k) * beatSec * rate), amp = (barLevels[b] ?? 0.5) * (k === 0 ? 1.6 : k === 3 ? 1.2 : 0.6);
    for (let j = 0; j < 0.03 * rate && t0 + j < n; j++) out[t0 + j] += amp * Math.exp(-j / (0.006 * rate)) * Math.sin(2 * Math.PI * 900 * j / rate);
  }
  return out;
}

export const SONGS = {
  pop: { name: 'Pop 4/4 · 120 BPM', bpm: 120, meter: 4, sections: [
    { label: 'intro', bars: 8, level: 0.3 }, { label: 'verse', bars: 16, level: 0.5 }, { label: 'chorus', bars: 16, level: 0.95 },
    { label: 'verse', bars: 16, level: 0.5 }, { label: 'chorus', bars: 16, level: 0.95 }, { label: 'bridge', bars: 8, level: 0.35 },
    { label: 'chorus', bars: 16, level: 1 }, { label: 'outro', bars: 8, level: 0.3 }] },
  ballad: { name: 'Ballad 4/4 · 72 BPM', bpm: 72, meter: 4, sections: [
    { label: 'intro', bars: 4, level: 0.2 }, { label: 'verse', bars: 8, level: 0.4 }, { label: 'chorus', bars: 8, level: 0.75 },
    { label: 'verse', bars: 8, level: 0.45 }, { label: 'chorus', bars: 8, level: 0.85 }, { label: 'outro', bars: 4, level: 0.2 }] },
  edm: { name: 'EDM build & drop · 128 BPM', bpm: 128, meter: 4, sections: [
    { label: 'intro', bars: 8, level: 0.3 }, { label: 'verse', bars: 8, level: 0.45 }, { label: 'build', bars: 4, level: 0.6 }, { label: 'build', bars: 4, level: 0.75 },
    { label: 'chorus', bars: 16, level: 1 }, { label: 'bridge', bars: 8, level: 0.25 }, { label: 'build', bars: 8, level: 0.7 },
    { label: 'chorus', bars: 16, level: 1 }, { label: 'outro', bars: 8, level: 0.3 }] },
  sixEight: { name: 'Ethiopian-style 6/8 · 150 eighths/min', bpm: 150, meter: 6, sections: [
    { label: 'intro', bars: 4, level: 0.3 }, { label: 'verse', bars: 12, level: 0.55 }, { label: 'chorus', bars: 12, level: 0.95 },
    { label: 'verse', bars: 12, level: 0.55 }, { label: 'chorus', bars: 16, level: 1 }, { label: 'outro', bars: 4, level: 0.3 }] },
};

// ── Sites ────────────────────────────────────────────────────────────────────────────────
const ringXY = (n, rx, ry, i) => { const a = (i / n) * 2 * Math.PI; return [Math.round(rx * Math.cos(a) * 1000) / 1000, Math.round(ry * Math.sin(a) * 1000) / 1000]; };

/** Perimeter ring of solenoid jets on 2 shared pumps, plus centre baskets on one of them (Lebu-like). */
export function ringSite({ jets = 24 } = {}) {
  const f = [];
  for (let i = 0; i < jets; i++) {
    const [x, y] = ringXY(jets, 8, 5, i), pump = i < jets / 2 ? 'pA' : 'pB';
    f.push({ id: `j${i}`, type: 'nozzle_straight_dn25', label: `Ring jet ${i}`, x, y, zone: 'ring', engineering: { jetHeightM: 4, flowLpm: 55, solenoidValveId: `v${i}`, pumpId: pump } });
    f.push({ id: `v${i}`, type: 'valve_solenoid_dn25_24v', label: `Valve ${i}`, x, y, zone: 'ring', engineering: { controlledFixtureId: `j${i}`, pumpId: pump } });
    f.push({ id: `l${i}`, type: 'light_uw_rgb_18w', label: `Light ${i}`, x, y, engineering: { pairedNozzleId: `j${i}` } });
  }
  [-0.6, 0.6].forEach((x, k) => f.push({ id: `b${k}`, type: 'rotating_jet', label: `Centre rotating basket ${k}`, x, y: 0, zone: 'centre', engineering: { jetHeightM: 8, flowLpm: 120, nozzleStyle: 'Rotating Basket', pumpId: 'pB' } }));
  f.push({ id: 'pA', type: 'pump_inline_vfd_pump_18_5kw', label: 'Pump A', x: -12, y: 0, engineering: { powerKw: 18.5, flowLpm: jets / 2 * 60, servesValveIds: Array.from({ length: jets / 2 }, (_, i) => `v${i}`) } });
  f.push({ id: 'pB', type: 'pump_inline_vfd_pump_18_5kw', label: 'Pump B', x: 12, y: 0, engineering: { powerKw: 18.5, flowLpm: jets / 2 * 60 + 240, servesValveIds: Array.from({ length: jets / 2 }, (_, i) => `v${i + jets / 2}`) } });
  return { name: `Ring · ${jets} solenoid jets + baskets`, fixtures: f };
}

/** A linear lake front: swing nozzles, jumping jets, a back row of shooters, mist — each on its own drive. */
export function lineSite() {
  const f = [];
  for (let i = 0; i < 16; i++) f.push({ id: `sw${i}`, type: 'nozzle_swing', label: `Swing nozzle ${i}`, x: -15 + i * 2, y: 2, zone: 'swing-line', engineering: { jetHeightM: 6, flowLpm: 80 } });
  for (let i = 0; i < 12; i++) f.push({ id: `jj${i}`, type: 'nozzle_jumping', label: `Jumping jet ${i}`, x: -11 + i * 2, y: 4, zone: 'front-jumpers', engineering: { jetHeightM: 2, flowLpm: 20 } });
  for (let i = 0; i < 6; i++) f.push({ id: `sh${i}`, type: 'nozzle_air_shooter', label: `Air shooter ${i}`, x: -10 + i * 4, y: -2, zone: 'shooters', engineering: { jetHeightM: 25, flowLpm: 300 } });
  for (let i = 0; i < 8; i++) f.push({ id: `m${i}`, type: 'nozzle_mist', label: `Mist ${i}`, x: -14 + i * 4, y: 5, zone: 'mist', engineering: { jetHeightM: 1, flowLpm: 5 } });
  for (let i = 0; i < 16; i++) f.push({ id: `ls${i}`, type: 'light_uw_rgb_18w', label: `Light ${i}`, x: -15 + i * 2, y: 2, engineering: { pairedNozzleId: `sw${i}` } });
  return { name: 'Lake front · swing, jumping, shooters, mist', fixtures: f };
}

/** A small plaza: 4 rings of crown jets, each ring on its own VFD pump without valves. */
export function plazaSite() {
  const f = [];
  for (let r = 0; r < 4; r++) {
    const pid = `pr${r}`, cx = (r % 2 ? 4 : -4), cy = (r < 2 ? 3 : -3);
    const ids = [];
    for (let i = 0; i < 8; i++) {
      const [x, y] = ringXY(8, 1.2, 1.2, i);
      ids.push(`c${r}_${i}`);
      f.push({ id: `c${r}_${i}`, type: 'nozzle_crown', label: `Crown ${r}.${i}`, x: cx + x, y: cy + y, zone: `ring-${r}`, engineering: { jetHeightM: 3, flowLpm: 30, pumpId: pid } });
      f.push({ id: `cl${r}_${i}`, type: 'light_uw_rgb_18w', label: `Light ${r}.${i}`, x: cx + x, y: cy + y, engineering: { pairedNozzleId: `c${r}_${i}` } });
    }
    f.push({ id: pid, type: 'pump_inline_vfd_pump_18_5kw', label: `Ring pump ${r}`, x: cx, y: cy, engineering: { powerKw: 5.5, flowLpm: 260 } });
  }
  return { name: 'Plaza · 4 crown rings, one VFD pump each', fixtures: f };
}

export const SITES = { ring: ringSite, line: lineSite, plaza: plazaSite };
export { downsample };
