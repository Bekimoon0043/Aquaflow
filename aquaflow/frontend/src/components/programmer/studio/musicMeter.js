// Meter controls — the user's correction of the beat grid. Beat trackers are trained mostly on
// Western 4/4 and 3/4; for 6/8 grooves (Ethiopian chik-chika, many Arabic rhythms) a few
// clicks of correction beat any detector. Pure.
//
//   meter = { beatsPerBar: 'auto' | 3 | 4 | 6 | 12, pulse: 'beat' | 'dotted', bpm: null | number,
//             downbeat: 0 (shift the bar start by beats), nudgeS: 0, accent: 'rise' | 'bend' }
//   pulse 'dotted'  6/8 and 12/8 are felt in dotted quarters: patterns hit every 3 eighths
//   accent 'bend'   the water dips on the beat and rises between ("bending the knee at the beat")

const r3 = (v) => Math.round(v * 1000) / 1000;
export const DEFAULT_METER = { beatsPerBar: 'auto', pulse: 'beat', bpm: null, downbeat: 0, nudgeS: 0, accent: 'rise' };
export const METER_CHOICES = [['auto', 'Auto'], [3, '3/4'], [4, '4/4'], [6, '6/8'], [12, '12/8']];

/** Tempo from tap times (seconds): median interval, ignoring stray taps. */
export function tapTempo(times) {
  const t = [...times].sort((a, b) => a - b).slice(-12);
  const gaps = t.slice(1).map((x, i) => x - t[i]).filter((g) => g > 0.2 && g < 2);
  if (gaps.length < 3) return null;
  gaps.sort((a, b) => a - b);
  return r3(60 / gaps[Math.floor(gaps.length / 2)]);
}

/** The analysis with the user's meter applied (beats, downbeats, bpm, beats per bar). */
export function applyMeter(analysis, meter) {
  if (!analysis || !meter) return analysis;
  const m = { ...DEFAULT_METER, ...meter };
  const duration = analysis.duration || 0;
  let beats = [...(analysis.beats || [])];
  let bpm = Number(analysis.bpm) || 120;
  if (Number(m.bpm) >= 30 && Number(m.bpm) <= 300) {
    bpm = Number(m.bpm);
    const t0 = beats[0] ?? 0;
    beats = [];
    for (let t = t0; t < duration; t += 60 / bpm) beats.push(r3(t));
  }
  if (m.nudgeS) beats = beats.map((t) => r3(t + Number(m.nudgeS))).filter((t) => t >= 0);
  let bpb = m.beatsPerBar === 'auto' ? analysis.beatsPerBar || 4 : Number(m.beatsPerBar);
  // First downbeat: the detector's, moved by the user's shift.
  const d0 = analysis.downbeats?.[0];
  let first = d0 == null ? 0 : beats.reduce((best, t, i) => (Math.abs(t - (d0 + (m.nudgeS || 0))) < Math.abs(beats[best] - (d0 + (m.nudgeS || 0))) ? i : best), 0);
  first = (((first + Number(m.downbeat || 0)) % bpb) + bpb) % bpb;
  if (m.pulse === 'dotted' && bpb % 3 === 0) {
    beats = beats.filter((_, i) => i >= first && (i - first) % 3 === 0);
    bpm /= 3; bpb /= 3; first = 0;
  }
  const downbeats = beats.filter((_, i) => i >= first && (i - first) % bpb === 0);
  return { ...analysis, beats, downbeats, bpm: r3(bpm), beatsPerBar: bpb, meter: m };
}
