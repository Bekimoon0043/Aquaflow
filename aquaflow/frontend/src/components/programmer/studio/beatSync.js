// Music sync for the pattern builder — pure functions.
//   * grid/bars: the song's regular beat grid (bpm + phase from the analysis)
//   * syncPatternOptions: snap start/length to bars, laps to whole beats/bars, hits on beats
//   * fillSong: lay patterns across the detected sections as ordinary editable recipes
import {
  HIT_PRESETS, MAX_CYCLES, MIN_OFF_S, MIN_ON_S, buildPatternUnit, ensureGroup, pruneBuilderGroups,
} from './patternPresets';
import { compileStudio, resolveMembers, uid } from './showModel';
import { energyBetween } from './musicAnalysis';

const r3 = v => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mod = (a, b) => ((a % b) + b) % b;
const MIN_LAP_S = MIN_ON_S + MIN_OFF_S;

/** Beat grid of an analysis, or null when it has no tempo. */
export function grid(analysis) {
  const bpm = Number(analysis?.bpm);
  if (!(bpm >= 20 && bpm <= 300)) return null;
  const beatsPerBar = analysis.beatsPerBar || 4, beatSec = 60 / bpm, barSec = beatSec * beatsPerBar;
  const origin = analysis.downbeats?.[0] ?? analysis.beats?.[0] ?? 0;
  return { bpm, beatSec, barSec, beatsPerBar, barOrigin: mod(origin, barSec), beatOrigin: mod(origin, beatSec), duration: Number(analysis.duration) || 0 };
}

/** Nearest bar line at or after the first bar. */
export function nearestBar(t, g) {
  const k = Math.max(0, Math.round((t - g.barOrigin) / g.barSec));
  return r3(g.barOrigin + k * g.barSec);
}

/** Snap a clip to whole bars (at least one bar, inside the 10-minute limit). */
export function snapRangeToBars(start, duration, g) {
  const s = nearestBar(Math.max(0, Number(start) || 0), g);
  let bars = Math.max(1, Math.round((nearestBar(s + Math.max(0, Number(duration) || 0), g) - s) / g.barSec));
  while (bars > 1 && s + bars * g.barSec > 600) bars--;
  return { start: s, duration: r3(bars * g.barSec), bars };
}

/** Whole bars or beats → short label ("2 bars", "3 beats"). */
export function beatsLabel(beats, g) {
  if (beats % g.beatsPerBar === 0) { const bars = beats / g.beatsPerBar; return `${bars} bar${bars > 1 ? 's' : ''}`; }
  return `${beats} beat${beats > 1 ? 's' : ''}`;
}

/**
 * Lap = a whole number of beats that divides the clip exactly (seamless loop),
 * preferring whole bars, closest to the requested lap time, ≤ MAX_CYCLES laps.
 */
export function wholeBeatLap(duration, lapSeconds, g, { minLap = MIN_LAP_S } = {}) {
  const totalBeats = Math.max(1, Math.round(duration / g.beatSec));
  const wanted = Math.max(.1, Number(lapSeconds) || g.barSec);
  let best = null;
  for (let lapBeats = 1; lapBeats <= totalBeats; lapBeats++) {
    if (totalBeats % lapBeats) continue;
    const cycles = totalBeats / lapBeats;
    if (cycles > MAX_CYCLES || (lapBeats * g.beatSec < minLap && lapBeats < totalBeats)) continue;
    const cost = Math.abs(Math.log(lapBeats * g.beatSec / wanted)) + (lapBeats >= g.beatsPerBar && lapBeats % g.beatsPerBar ? .25 : 0);
    if (!best || cost < best.cost) best = { lapBeats, cycles, cost };
  }
  return { lapBeats: best.lapBeats, cycles: best.cycles, totalBeats, lapSeconds: r3(duration / best.cycles) };
}

const STEPS = [1, 2, 4, 8, 16];
const nearestStep = (wanted, minimum = 1) => STEPS.filter(s => s >= minimum)
  .reduce((a, b) => Math.abs(Math.log(b / wanted)) < Math.abs(Math.log(a / wanted)) ? b : a, STEPS.find(s => s >= minimum) || 16);

/**
 * Options synced to the music. Returns { options, info } — `options` carries
 * `sync` (bpm, lap in beats, step/hit spacing) and exact start/length/lap values.
 */
export function syncPatternOptions(preset, options, analysis, { members = 1 } = {}) {
  const g = grid(analysis);
  if (!g) return { options, info: null };
  const range = snapRangeToBars(options.start, options.duration, g);
  const base = { ...options, start: range.start };
  const sync = { bpm: r3(g.bpm), beatsPerBar: g.beatsPerBar };
  const totalBeats = Math.round(range.duration / g.beatSec);

  if (preset === 'pulse') {
    // A hit every k beats; on-time ≥ MIN_ON_S and off-time ≥ MIN_OFF_S.
    const minK = STEPS.find(k => k * g.beatSec >= MIN_LAP_S) || 16;
    const k = nearestStep((Number(options.lapSeconds) || 2) / g.beatSec, minK);
    let hits = Math.max(1, Math.floor(totalBeats / k));
    const crests = clamp(Math.ceil(hits / MAX_CYCLES), 1, 8);
    hits = Math.max(crests, Math.floor(hits / crests) * crests);
    const duration = r3(hits * k * g.beatSec);
    return { options: { ...base, duration, crests, lapSeconds: r3(crests * k * g.beatSec), sync: { ...sync, hitBeats: k, lapBeats: crests * k } },
      info: { bpm: sync.bpm, cycles: hits / crests, label: `hit every ${beatsLabel(k, g)}` } };
  }
  if (preset === 'chase' || preset === 'sparkle') {
    // The crest moves one jet per step (a whole number of beats), so hits land on beats.
    const n = Math.max(1, members);
    const crests = preset === 'sparkle' ? clamp(Math.round(n / 6), 1, 8) : clamp(Math.round(Number(options.crests) || 1), 1, 8);
    const minStep = STEPS.find(s => (n * s * g.beatSec) / crests >= MIN_LAP_S) || 16;
    const step = nearestStep((Number(options.lapSeconds) || 6) / (n * g.beatSec), minStep);
    const lapBeats = n * step;
    let cycles = clamp(Math.floor(totalBeats / lapBeats), 1, MAX_CYCLES);
    while (cycles > 1 && range.start + cycles * lapBeats * g.beatSec > 600) cycles--;
    const duration = r3(Math.min(600 - range.start, cycles * lapBeats * g.beatSec));
    return { options: { ...base, duration, crests, lapSeconds: r3(duration / cycles), sync: { ...sync, stepBeats: step, lapBeats } },
      info: { bpm: sync.bpm, cycles, label: `step ${beatsLabel(step, g)}` } };
  }
  const lap = wholeBeatLap(range.duration, options.lapSeconds, g);
  return { options: { ...base, duration: range.duration, lapSeconds: lap.lapSeconds, sync: { ...sync, lapBeats: lap.lapBeats } },
    info: { bpm: sync.bpm, cycles: lap.cycles, label: `lap ${beatsLabel(lap.lapBeats, g)}` } };
}

// ── Fill the song ───────────────────────────────────────────────────────────────
export const FILL_STYLE = {
  intro: { presets: ['breathing'], lapBars: 2, min: 25, max: [40, 60], color: '#2f6bff', light: [20, 35] },
  verse: { presets: ['wave'], lapBars: 4, min: 30, max: [60, 80], color: '#35d0c0', light: [25, 45] },
  chorus: { presets: ['chase', 'mirror'], lapBars: 2, min: 20, max: [85, 100], color: '#ffb347', light: [45, 70] },
  bridge: { presets: ['ripple'], lapBars: 2, min: 25, max: [55, 75], color: '#9b6bff', light: [25, 45] },
  outro: { presets: ['breathing'], lapBars: 2, min: 25, max: [45, 60], color: '#2f6bff', light: [20, 35], fade: 'out' },
};
export const SECTION_NAMES = { intro: 'Intro', verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', outro: 'Outro' };
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

/** Split sections into phrases of `phraseBars` bars (short tails join the phrase before). */
export function songPhrases(analysis, g, { phraseBars = 8, end = Math.min(600, analysis.duration) } = {}) {
  const sections = (analysis.sections?.length ? analysis.sections : [{ start: 0, end, label: 'verse' }])
    .map(s => ({ ...s, start: Math.max(0, s.start), end: Math.min(end, s.end) })).filter(s => s.end - s.start > .05);
  const merged = [];
  for (const s of sections) { // a section shorter than one lap joins its neighbour
    if (merged.length && s.end - s.start < MIN_LAP_S * 2) merged.at(-1).end = s.end;
    else merged.push({ ...s });
  }
  if (merged.length) { merged[0].start = 0; merged.at(-1).end = end; }
  const phrases = [];
  merged.forEach((s, si) => {
    // Choruses change every 4 bars (chase ↔ mirror); calmer parts every `phraseBars`.
    const bars = s.label === 'chorus' ? Math.max(2, Math.round(phraseBars / 2)) : phraseBars;
    const cuts = [s.start];
    for (let t = nearestBar(s.start, g) + bars * g.barSec; t < s.end - (bars / 2) * g.barSec + 1e-3; t += bars * g.barSec) cuts.push(r3(t));
    cuts.push(s.end);
    for (let k = 0; k + 1 < cuts.length; k++) phrases.push({ section: si, label: s.label, index: k, last: k + 2 === cuts.length, start: r3(cuts[k]), end: r3(cuts[k + 1]) });
  });
  return { sections: merged, phrases };
}

/**
 * Lay patterns across the song for the chosen water (and optional light) group.
 * Replaces a previous fill. Every recipe is a normal builder unit (reopens in the
 * builder); sections become markers. Returns { studio, recipes, markers, fillId }.
 */
export const FILL_CLIP_BUDGET = 45000;
export function fillSong(studio, options) {
  if (!grid(options.analysis)) throw new Error('Find the beats first');
  if (!options.waterGroup) throw new Error('Choose a water group');
  // Big sites: longer phrases resolve to fewer timed clips (the show limit is 50,000).
  let result;
  for (const phraseBars of [options.phraseBars || 8, 16, 32, 100000]) {
    result = fillOnce(studio, { ...options, phraseBars });
    if (compileStudio(result.studio, options.items).clips.length <= FILL_CLIP_BUDGET) return result;
  }
  return { ...result, warning: 'Very dense show: use fewer jets per group or a shorter song.' };
}

function fillOnce(studio, { analysis, items, waterGroup, lightGroup = null, phraseBars = 8 }) {
  const g = grid(analysis);
  const end = r3(Math.min(600, analysis.duration));
  const fillId = uid('fill');
  const previous = studio.recipes.filter(r => r.pattern?.fill);
  let next = pruneBuilderGroups({ ...studio, recipes: studio.recipes.filter(r => !r.pattern?.fill), markers: studio.markers.filter(m => !m.fill) },
    previous.map(r => r.groupId));
  const memberIds = resolveMembers(waterGroup, items);
  const count = memberIds.length;
  const { sections, phrases } = songPhrases(analysis, g, { phraseBars, end });
  const energies = phrases.map(p => energyBetween(analysis.energy, p.start, p.end));
  const lo = Math.min(...energies), hi = Math.max(...energies);
  const level = e => hi - lo > 1e-6 ? (e - lo) / (hi - lo) : .5;
  const added = [];
  const sync = { bpm: r3(g.bpm), beatsPerBar: g.beatsPerBar };
  let chorusCount = 0;

  phrases.forEach((p, i) => {
    const style = FILL_STYLE[p.label] || FILL_STYLE.verse;
    let preset = style.presets[(p.label === 'chorus' ? chorusCount++ : p.index) % style.presets.length];
    if ((preset === 'chase' && count < 4) || (preset === 'mirror' && count < 2)) preset = 'wave';
    const e = level(energies[i]);
    const duration = r3(p.end - p.start);
    const lap = wholeBeatLap(duration, style.lapBars * g.barSec, g);
    const options = {
      start: p.start, duration, lapSeconds: lap.lapSeconds, minLevel: style.min, maxLevel: Math.round(lerp(style.max[0], style.max[1], e)),
      order: preset === 'mirror' ? (p.index % 2 ? 'outward' : 'inward') : p.label === 'chorus' && p.index % 2 ? 'counter-clockwise' : 'clockwise',
      crests: 1, smoothness: preset === 'chase' ? 'sharp' : 'smooth', color: style.color, axis: 'sides', seed: i + 1,
      sync: { ...sync, lapBeats: lap.lapBeats },
      ...(style.fade && p.last ? { fade: style.fade } : {}),
    };
    const unit = buildPatternUnit(next, { preset, options, group: waterGroup, items,
      lights: lightGroup ? { group: lightGroup, level: Math.round(lerp(style.light[0], style.light[1], e)), color: style.color } : null,
      tag: { fill: fillId, section: p.label } });
    next = unit.studio;
    added.push(...unit.recipes);
  });

  // Ripple accents on the strongest downbeat of each chorus phrase (own lane, ≥ 4 bars apart).
  const chorus = phrases.filter(p => p.label === 'chorus');
  if (chorus.length && count) {
    const ensured = ensureGroup(next, { name: `${waterGroup.name} · accents`, memberFixtureIds: memberIds, orderMode: 'center-out', color: '#ffffff', quick: true });
    next = ensured.studio;
    const accentGroup = next.groups.find(x => x.id === ensured.groupId);
    const length = Math.max(g.barSec, Math.ceil(MIN_LAP_S / g.beatSec) * g.beatSec);
    let lastAccent = -Infinity;
    for (const p of chorus) {
      let best = null;
      for (let t = nearestBar(p.start, g); t + length <= p.end + 1e-3; t += g.barSec) {
        const rise = energyBetween(analysis.energy, t, t + .5) - energyBetween(analysis.energy, Math.max(0, t - 1), t);
        if (t - lastAccent >= 4 * g.barSec - 1e-3 && (!best || rise > best.rise)) best = { t: r3(t), rise };
      }
      if (!best) continue;
      lastAccent = best.t;
      const unit = buildPatternUnit(next, { preset: 'ripple', group: accentGroup, items, tag: { fill: fillId, section: 'accent' },
        options: { start: best.t, duration: r3(length), lapSeconds: r3(length), minLevel: 0, maxLevel: 100, crests: 1, smoothness: 'smooth',
          color: '#ffffff', seed: 1, sync: { ...sync, lapBeats: Math.round(length / g.beatSec) } } });
      next = unit.studio;
      added.push(...unit.recipes);
    }
  }

  const markers = sections.map(s => ({ id: uid('marker'), name: SECTION_NAMES[s.label] || 'Section', time: r3(s.start), kind: 'section', fill: fillId }));
  next = { ...next, markers: [...next.markers, ...markers], tempo: [{ time: r3(g.beatOrigin), bpm: r3(g.bpm) }] };
  return { studio: next, recipes: added, markers, fillId };
}
