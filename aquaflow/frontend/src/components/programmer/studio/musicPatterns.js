// Patterns from the music — real, editable pattern-builder units chosen phrase by phrase
// from what each linked stem is doing in its frequency bands. Pure (no React).
//
// Method (see reports/Music frequency fountain choreography.md):
//   * grid      the song's beat / bar grid and sections; phrases of 8 bars (4 in choruses)
//   * features  per phrase and linked part: loudness (relative to the part's own phrases),
//               hits per beat (kick / snare-hat onsets), singing share and pitch range
//               (melody), band brightness (sub … brilliance)
//   * choose    kick → pulse on the beat (ripple when sparse); hats → sparkle / chase;
//               bass, pads → slow breathing (pump-speed effects ramp over seconds, not beats);
//               melody → wave / mirror while singing, rest when silent
//   * repeat    the same section label reuses the same pattern choice (music repeats → water repeats)
//   * accents   a jump into a chorus fires a one-bar burst on all water + a white light flash
//   * timing    every pattern starts early by the water's rise time:
//               lead = 0.1 s (valve) + 1.2 · √(2h/g) for the group's tallest jet
//   * lights    follow their water in the section's colour, brighter with the part's energy

import { buildPatternUnit, pruneBuilderGroups, QUICK_LIGHTS, QUICK_WATER } from './patternPresets';
import { FILL_CLIP_BUDGET, grid, songPhrases, syncPatternOptions } from './beatSync';
import { compileStudio, resolveMembers, uid } from './showModel';
import { energyBetween } from './musicAnalysis';
import { STEM_RATE } from './stemAnalysis';
import { sourceById } from './stemProgram';
import { bandMeans, brightness, readBands } from './stemBands';

const G = 9.81;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Lowest peak level of a generated pattern, % of the jets' design height. */
export const PEAK_FLOOR = 70;
export const SECTION_COLORS = { intro: '#2f6bff', verse: '#35d0c0', chorus: '#ffb347', bridge: '#9b6bff', outro: '#2f6bff' };

/** Seconds the water needs to reach its top: valve opening + 1.2 × ballistic rise time. */
export function waterLead(heightM) {
  const h = Math.max(0, Number(heightM) || 0);
  return r3(Math.min(3, 0.1 + 1.2 * Math.sqrt((2 * h) / G)));
}

/** Features of one part of the music over [t0, t1]. */
export function phraseFeatures(analysis, source, t0, t1, beatSec) {
  const i0 = Math.max(0, Math.floor(t0 * STEM_RATE)), i1 = Math.min(analysis.level?.length || 0, Math.ceil(t1 * STEM_RATE));
  let energy = 0;
  for (let i = i0; i < i1; i++) energy += analysis.level[i];
  energy = i1 > i0 ? energy / (i1 - i0) : 0;
  const beats = Math.max(1, (t1 - t0) / beatSec);
  const list = source.behaviour === 'hits' ? (analysis[source.field] || []) : (analysis.hits || []);
  const hitsPerBeat = list.filter((h) => h.t >= t0 && h.t < t1 && h.s > 0.3).length / beats;
  let voiced = 0, lo = Infinity, hi = -Infinity;
  if (analysis.pitch) {
    for (let i = i0; i < i1; i++) {
      const p = analysis.pitch[i];
      if (p >= 0) { voiced++; lo = Math.min(lo, p); hi = Math.max(hi, p); }
    }
  }
  const bands = readBands(analysis.bands);
  return {
    energy, hitsPerBeat, voiced: i1 > i0 ? voiced / (i1 - i0) : 0, pitchRange: voiced ? hi - lo : 0,
    brightness: bands ? brightness(bandMeans(bands, t0, t1)) : 0.5,
  };
}

/**
 * The pattern a part asks for in one phrase, or null to rest. Pure rule table.
 * `variant` (0, 1, 2) rotates the effect family inside long sections — the same part keeps
 * its character (hits stay hits) but the audience does not see one look for minutes.
 */
export function choosePattern(source, f, { label, eRel, beatSec, barSec, members, variant = 0 }) {
  const chorus = label === 'chorus';
  const v = ((variant % 3) + 3) % 3;
  // Peaks never below 70 % of the design height: tall water on every phrase, louder = higher.
  const level = (lo, hi) => ({ minLevel: lo, maxLevel: Math.round(clamp(Math.max(hi, PEAK_FLOOR + (100 - PEAK_FLOOR) * eRel), Math.max(lo + 10, PEAK_FLOOR), 100)) });
  if (source.id.startsWith('drums') && source.field !== 'hats') {
    if (eRel < 0.12 || f.hitsPerBeat < 0.15) return null;
    if (chorus || eRel >= 0.7) {
      // Strong kicks: a hit on every beat, a chase that steps on the beat, or ripples on the bar.
      if (v === 1 && members >= 4) return { preset: 'chase', lapSeconds: barSec, ...level(10, 60 + 40 * eRel), smoothness: 'sharp' };
      if (v === 2) return { preset: 'ripple', lapSeconds: barSec, ...level(10, 60 + 40 * eRel) };
      return { preset: 'pulse', lapSeconds: beatSec, ...level(5, 60 + 40 * eRel) };
    }
    if (f.hitsPerBeat >= 0.6) return v === 2 ? { preset: 'ripple', lapSeconds: 2 * barSec, ...level(10, 55 + 40 * eRel) }
      : { preset: 'pulse', lapSeconds: 2 * beatSec, ...level(5, 55 + 40 * eRel) };
    return { preset: 'ripple', lapSeconds: 2 * barSec, ...level(10, 55 + 40 * eRel) };
  }
  if (source.field === 'hats') {
    if (f.hitsPerBeat >= 1.5 && members >= 3) return v === 1 && members >= 4
      ? { preset: 'chase', lapSeconds: barSec, crests: 2, ...level(0, 50 + 40 * eRel), smoothness: 'sharp' }
      : { preset: 'sparkle', lapSeconds: beatSec, ...level(0, 50 + 40 * eRel) };
    if (f.hitsPerBeat >= 0.5 && members >= 2) return { preset: 'chase', lapSeconds: barSec, ...level(5, 50 + 40 * eRel), smoothness: 'sharp' };
    return null;
  }
  if (source.behaviour === 'melody') {
    if (f.voiced < 0.25) return null;
    const crests = f.pitchRange > 0.5 ? 2 : 1;
    if (chorus && members >= 2) {
      if (v === 1) return { preset: 'wave', lapSeconds: barSec, crests, ...level(25, 60 + 40 * eRel) };
      if (v === 2) return { preset: 'breathing', lapSeconds: barSec, ...level(30, 60 + 40 * eRel) };
      return { preset: 'mirror', lapSeconds: 2 * barSec, crests, ...level(25, 55 + 45 * eRel) };
    }
    return v === 2 && members >= 2 ? { preset: 'mirror', lapSeconds: 2 * barSec, crests, ...level(25, 55 + 45 * eRel) }
      : { preset: 'wave', lapSeconds: 2 * barSec, crests, ...level(25, 55 + 45 * eRel) };
  }
  // follow: bass, vocals loudness, other / piano / guitar — slow, phrase-level height
  // (pump-speed effects ramp over seconds, so these never chop on the beat).
  if (eRel < 0.08) return null;
  if ((f.brightness > 0.45 && eRel > 0.5 && members >= 2) || (v === 1 && members >= 2)) return { preset: 'wave', lapSeconds: 2 * barSec, ...level(20, 45 + 50 * eRel) };
  return { preset: 'breathing', lapSeconds: (eRel > 0.6 ? 1 : 2) * barSec, ...level(20, 45 + 50 * eRel) };
}

/**
 * Lay patterns across the song for each water link.
 * @param {object} studio
 * @param {object} p { analysis (song: bpm, sections, energy), stems, rows (links), items, groups }
 * @returns {{ studio, recipes, fillId, counts, warning? }}
 */
export function patternsFromMusic(studio, options) {
  if (!grid(options.analysis)) throw new Error('Find the beats first');
  let result;
  for (const phraseBars of [8, 16, 32]) {
    result = generateOnce(studio, { ...options, phraseBars });
    if (compileStudio(result.studio, options.items).clips.length <= FILL_CLIP_BUDGET) return result;
  }
  return { ...result, warning: 'Very dense show: link fewer or smaller groups.' };
}

function generateOnce(studio, { analysis, stems, rows, items, groups, phraseBars = 8, lead = true }) {
  const g = grid(analysis);
  const end = r3(Math.min(600, analysis.duration));
  const byRole = new Map(stems.map((s) => [s.role, s.analysis]));
  const previous = studio.recipes.filter((r) => r.pattern?.music);
  let next = pruneBuilderGroups({ ...studio, recipes: studio.recipes.filter((r) => !r.pattern?.music) }, previous.map((r) => r.groupId));
  const fillId = uid('music');
  const { phrases } = songPhrases(analysis, g, { phraseBars, end });
  const sync = { bpm: r3(g.bpm), beatsPerBar: g.beatsPerBar };
  const added = [];
  const counts = {};
  const itemById = new Map(items.map((i) => [i.id, i]));
  const memberItems = (group) => resolveMembers(group, items).map((id) => itemById.get(id)).filter(Boolean);

  const water = rows.filter((r) => (r.kind || 'water') === 'water');
  const lightsFor = (sourceId) => rows.find((r) => r.kind === 'lights' && r.sourceId === sourceId);
  for (const row of water) {
    const source = sourceById(row.sourceId);
    const stem = source && byRole.get(source.stem);
    const group = groups.find((x) => x.id === row.groupId);
    if (!source || !stem || !group) continue;
    const members = memberItems(group);
    const height = Math.max(0, ...members.map((m) => Number(m.engineering?.jetHeightM) || 0));
    const leadS = lead ? waterLead(height) : 0;
    const feats = phrases.map((p) => phraseFeatures(stem, source, p.start, p.end, g.beatSec));
    const sorted = feats.map((f) => f.energy).sort((a, b) => a - b);
    const rank = (e) => (sorted.length > 1 ? sorted.filter((v) => v < e).length / (sorted.length - 1) : 0.5);
    const memo = new Map();
    const lightRow = lightsFor(row.sourceId);
    const lightGroup = lightRow && groups.find((x) => x.id === lightRow.groupId);
    phrases.forEach((p, i) => {
      const eRel = rank(feats[i].energy);
      // Every two phrases the effect family rotates; the same section label at the same
      // position gets the same choice, so music that repeats looks the same in water.
      const slot = Math.floor(p.index / 2) % 3;
      const pick = choosePattern(source, feats[i], { label: p.label, eRel, beatSec: g.beatSec, barSec: g.barSec, members: members.length, variant: slot });
      if (!pick) return;
      const memoKey = `${p.label}:${slot}:${pick.preset}`;
      if (!memo.has(memoKey)) memo.set(memoKey, pick.preset === 'mirror' ? (memo.size % 2 ? 'outward' : 'inward') : (memo.size % 2 ? 'counter-clockwise' : 'clockwise'));
      const order = memo.get(memoKey);
      const color = SECTION_COLORS[p.label] || '#35d0c0';
      const base = { start: p.start, duration: r3(p.end - p.start), lapSeconds: pick.lapSeconds, minLevel: pick.minLevel, maxLevel: pick.maxLevel,
        order: pick.preset === 'ripple' ? 'center-out' : order, crests: pick.crests || 1, smoothness: pick.smoothness || (pick.preset === 'pulse' ? 'sharp' : 'smooth'),
        color, axis: 'sides', seed: i + 1, ...(p.label === 'outro' && p.last ? { fade: 'out' } : {}) };
      const synced = syncPatternOptions(pick.preset, base, analysis, { members: members.length });
      const opts = { ...synced.options, sync: synced.options.sync || sync };
      // Fire early so the water peaks on the music, not after it.
      const shift = Math.min(leadS, opts.start);
      opts.start = r3(opts.start - shift);
      if (opts.start + opts.duration > 600) opts.duration = r3(600 - opts.start);
      const unit = buildPatternUnit(next, { preset: pick.preset, options: opts, group, items,
        lights: lightGroup ? { group: lightGroup, color, level: Math.round(25 + 65 * eRel) } : null,
        tag: { music: fillId, section: p.label, part: source.id, leadS: shift } });
      next = unit.studio;
      added.push(...unit.recipes);
      counts[source.label] = (counts[source.label] || 0) + 1;
    });
  }

  // Accents: a big energy jump into a chorus → one-bar burst on all water with a white flash.
  const allWater = groups.find((x) => x.id === QUICK_WATER);
  const allLights = groups.find((x) => x.id === QUICK_LIGHTS);
  if (allWater && analysis.energy?.length) {
    const e = phrases.map((p) => energyBetween(analysis.energy, p.start, p.end));
    const lo = Math.min(...e), hi = Math.max(...e);
    const norm = (v) => (hi - lo > 1e-9 ? (v - lo) / (hi - lo) : 0);
    phrases.forEach((p, i) => {
      if (i === 0 || p.label !== 'chorus' || p.index !== 0) return;
      if (norm(e[i]) - norm(e[i - 1]) < 0.3) return;
      const members = memberItems(allWater);
      const height = Math.max(0, ...members.map((m) => Number(m.engineering?.jetHeightM) || 0));
      const start = r3(Math.max(0, p.start - waterLead(height)));
      const unit = buildPatternUnit(next, { preset: 'ripple', group: allWater, items,
        options: { start, duration: r3(g.barSec), lapSeconds: r3(g.barSec), minLevel: 0, maxLevel: 100, order: 'center-out', crests: 1,
          smoothness: 'smooth', color: '#ffffff', axis: 'sides', seed: 1, sync: { ...sync, lapBeats: g.beatsPerBar } },
        lights: allLights ? { group: allLights, color: '#ffffff', level: 100 } : null,
        tag: { music: fillId, section: 'accent', part: 'drop' } });
      next = unit.studio;
      added.push(...unit.recipes);
      counts.Accents = (counts.Accents || 0) + 1;
    });
  }
  next = { ...next, tempo: [{ time: r3(g.beatOrigin), bpm: r3(g.bpm) }] };
  return { studio: next, recipes: added, fillId, counts };
}
