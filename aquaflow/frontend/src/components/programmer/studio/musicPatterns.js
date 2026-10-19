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
//   * design    with the Engineering design (fountainDesign.js) every area of the fountain gets a
//             part: the melody on moving nozzles, bass on the tallest jets, kicks on the biggest
//             switched area, hats on the low jets, left and right mirrored. Each area only gets
//             looks it can perform — jets on one shared pump without valves rise and fall
//             together, solenoid jets switch on / off no faster than the valves allow — and
//             every other phrase is a world-famous look (famousPatterns.js). The patterns
//             drive the real solenoids and pumps (hardwareFollow.js).

import { buildPatternUnit, ensureGroup, pruneBuilderGroups, QUICK_LIGHTS, QUICK_WATER } from './patternPresets';
import { FILL_CLIP_BUDGET, grid, songPhrases, syncPatternOptions } from './beatSync';
import { compileStudio, resolveMembers, uid } from './showModel';
import { energyBetween } from './musicAnalysis';
import { STEM_RATE } from './stemAnalysis';
import { availableSources, sourceById } from './stemProgram';
import { MIRROR_OF } from './fountainDesign';
import { famousFor } from './famousPatterns';
import { fieldUnitRecipes } from './showBlocks';
import { bandMeans, brightness, readBands } from './stemBands';

const G = 9.81;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Bars per phrase (a chorus uses half): how long one generated pattern lasts. */
export const PHRASE_BARS = 16;
/** Smooth hand-over: the level eases over one bar at each pattern edge towards this share. */
export const EASE_FLOOR = 0.45;
/** Largest change of a part's peak level from one phrase to the next (percent points). */
export const MAX_LEVEL_STEP = 15;
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
      if (v === 1 && members >= 4) return { preset: 'chase', lapSeconds: 2 * barSec, ...level(10, 60 + 40 * eRel), smoothness: 'sharp' };
      if (v === 2) return { preset: 'ripple', lapSeconds: 2 * barSec, ...level(10, 60 + 40 * eRel) };
      return { preset: 'pulse', lapSeconds: 2 * beatSec, ...level(5, 60 + 40 * eRel) };
    }
    if (f.hitsPerBeat >= 0.6) return v === 2 ? { preset: 'ripple', lapSeconds: 2 * barSec, ...level(10, 55 + 40 * eRel) }
      : { preset: 'pulse', lapSeconds: barSec, ...level(5, 55 + 40 * eRel) };
    return { preset: 'ripple', lapSeconds: 2 * barSec, ...level(10, 55 + 40 * eRel) };
  }
  if (source.field === 'hats') {
    if (f.hitsPerBeat >= 1.5 && members >= 3) return v === 1 && members >= 4
      ? { preset: 'chase', lapSeconds: 2 * barSec, crests: 2, ...level(0, 50 + 40 * eRel), smoothness: 'sharp' }
      : { preset: 'sparkle', lapSeconds: 2 * beatSec, ...level(0, 50 + 40 * eRel) };
    if (f.hitsPerBeat >= 0.5 && members >= 2) return { preset: 'chase', lapSeconds: 2 * barSec, ...level(5, 50 + 40 * eRel), smoothness: 'sharp' };
    return null;
  }
  if (source.behaviour === 'melody') {
    if (f.voiced < 0.25) return null;
    const crests = f.pitchRange > 0.5 ? 2 : 1;
    if (chorus && members >= 2) {
      if (v === 1) return { preset: 'wave', lapSeconds: 2 * barSec, crests, ...level(25, 60 + 40 * eRel) };
      if (v === 2) return { preset: 'breathing', lapSeconds: 2 * barSec, ...level(30, 60 + 40 * eRel) };
      return { preset: 'mirror', lapSeconds: 2 * barSec, crests, ...level(25, 55 + 45 * eRel) };
    }
    return v === 2 && members >= 2 ? { preset: 'mirror', lapSeconds: 2 * barSec, crests, ...level(25, 55 + 45 * eRel) }
      : { preset: 'wave', lapSeconds: 2 * barSec, crests, ...level(25, 55 + 45 * eRel) };
  }
  // follow: bass, vocals loudness, other / piano / guitar — slow, phrase-level height
  // (pump-speed effects ramp over seconds, so these never chop on the beat).
  if (eRel < 0.08) return null;
  if ((f.brightness > 0.45 && eRel > 0.5 && members >= 2) || (v === 1 && members >= 2)) return { preset: 'wave', lapSeconds: 2 * barSec, ...level(20, 45 + 50 * eRel) };
  return { preset: 'breathing', lapSeconds: (eRel > 0.6 ? 2 : 4) * barSec, ...level(20, 45 + 50 * eRel) };
}

/**
 * Links from the fountain design: every area gets the part of the music that suits it, its
 * lights follow it, and a left / right pair dances the same part (mirrored).
 */
export function designRows(design, stems) {
  const sources = availableSources(stems).map((s) => s.id);
  const has = (id) => sources.includes(id);
  const areas = (design?.areas || []).filter((a) => a.size);
  if (!areas.length || !sources.length) return [];
  const left = new Set(areas.map((a) => a.id));
  const assign = new Map();
  const give = (a, sourceId) => { assign.set(a.id, sourceId); left.delete(a.id); };
  const take = (sourceId, score) => {
    const pool = areas.filter((a) => left.has(a.id));
    if (!has(sourceId) || !pool.length) return;
    const best = pool.reduce((a, b) => (score(b) > score(a) ? b : a));
    give(best, sourceId);
    const partner = pool.find((a) => a !== best && MIRROR_OF[best.position] === a.position && ['left', 'right'].includes(a.position)
      && a.kind === best.kind && a.control === best.control);
    if (partner) give(partner, sourceId);
  };
  const moving = (a) => a.moving || ['ring', 'curtain', 'swing'].includes(a.kind);
  const tallest = Math.max(...areas.map((a) => a.heightM));
  take('vocals:melody', (a) => (moving(a) ? 1000 : 0) + (a.position === 'centre' ? 300 : 0) + a.heightM);
  take('bass', (a) => a.heightM * 10 + (a.control === 'pump' ? 50 : 0) + (a.position === 'back' ? 20 : 0) + (['shooter', 'geyser'].includes(a.kind) ? 40 : 0));
  take('drums:kicks', (a) => (a.control !== 'pump' ? 500 : 0) + a.size + (a.position === 'front' ? 30 : 0));
  take('drums:hats', (a) => (a.control !== 'pump' ? 500 : 0) - a.heightM * 10 + (a.kind === 'mist' ? 100 : 0));
  for (const id of ['other:melody', 'piano:melody', 'guitar:melody', 'other', 'piano', 'guitar', 'vocals']) take(id, (a) => a.size);
  // Every area dances: the rest take the part that suits them best.
  for (const a of areas.filter((x) => left.has(x.id))) {
    const order = moving(a) ? ['vocals:melody', 'other:melody', 'vocals', 'bass', 'drums:kicks']
      : a.control === 'pump' ? ['bass', 'vocals', 'other', 'drums:kicks']
        : a.heightM >= tallest ? ['bass', 'drums:kicks', 'vocals'] : ['drums:kicks', 'drums:hats', 'bass', 'vocals'];
    give(a, order.find(has) || sources[0]);
  }
  const rows = [];
  for (const a of areas) {
    const sourceId = assign.get(a.id);
    rows.push({ sourceId, groupId: a.id, min: 15, max: 100, kind: 'water' });
    if (a.lightIds.length) rows.push({ sourceId, groupId: `${a.id}:lights`, follows: a.id, min: 15, max: 100, kind: 'lights' });
  }
  return rows;
}

/**
 * What an area can really do with a pick: jets that only move with their shared pump breathe
 * together (a pump ramps over seconds); solenoid jets hit no faster than a valve can cycle.
 */
export function fitToControl(pick, control, { beatSec, barSec }) {
  if (!pick) return null;
  if (control === 'pump') {
    return { preset: 'breathing', lapSeconds: Math.max(2 * barSec, pick.lapSeconds || 0), minLevel: Math.max(30, pick.minLevel || 0), maxLevel: pick.maxLevel };
  }
  if (control === 'switch' && pick.preset === 'pulse') {
    return { ...pick, lapSeconds: Math.max(pick.lapSeconds, beatSec * Math.ceil(2.2 / beatSec)) };
  }
  return pick;
}

/** How a jet's solenoid follows a pattern: on each crest, or open while the pump shapes it. */
const valveMode = (preset) => (preset === 'breathing' ? 'open' : 'hits');
const FLIP = { clockwise: 'counter-clockwise', 'counter-clockwise': 'clockwise', 'left-to-right': 'right-to-left', 'right-to-left': 'left-to-right' };

/**
 * Lay patterns across the song for each water link.
 * @param {object} studio
 * @param {object} p { analysis (song: bpm, sections, energy), stems, rows (links), items, groups }
 * @returns {{ studio, recipes, fillId, counts, warning? }}
 */
export function patternsFromMusic(studio, options) {
  if (!grid(options.analysis)) throw new Error('Find the beats first');
  let result;
  // 16-bar phrases (8 in choruses): a pattern lasts ~30-40 s and the family turns every two.
  for (const phraseBars of [options.phraseBars || PHRASE_BARS, 32, 64]) {
    result = generateOnce(studio, { ...options, phraseBars });
    if (compileStudio(result.studio, options.items).clips.length <= FILL_CLIP_BUDGET) return result;
  }
  return { ...result, warning: 'Very dense show: link fewer or smaller groups.' };
}

function generateOnce(studio, { analysis, stems, rows, items, groups, design = null, phraseBars = PHRASE_BARS, lead = true }) {
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
  const skipped = [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const memberItems = (group) => resolveMembers(group, items).map((id) => itemById.get(id)).filter(Boolean);

  const water = rows.filter((r) => (r.kind || 'water') === 'water');
  const lightsFor = (row) => rows.find((r) => r.kind === 'lights' && (r.follows ? r.follows === row.groupId : r.sourceId === row.sourceId));
  const areaById = new Map((design?.areas || []).map((a) => [a.id, a]));
  const lastChorus = Math.max(-1, ...phrases.filter((p) => p.label === 'chorus' && p.index === 0).map((p) => p.start));
  const driven = new Set();      // solenoids and pumps the music now drives
  // Each jet / light belongs to one linked part only: a later link gets the fixtures earlier
  // links have not claimed (two patterns on one output would overlap — the PLC rejects that).
  const claimed = new Set();
  const claim = (group, label) => {
    const ids = resolveMembers(group, items).filter((id) => !claimed.has(id));
    if (!ids.length) return null;
    ids.forEach((id) => claimed.add(id));
    const all = resolveMembers(group, items);
    if (ids.length === all.length) return group;
    return { id: `${group.id}:free:${ids.length}`, name: `${group.name} · ${label}`, memberFixtureIds: ids, orderMode: group.orderMode || 'engineering',
      color: group.color, quick: true };
  };
  for (const row of water) {
    const source = sourceById(row.sourceId);
    const stem = source && byRole.get(source.stem);
    const linked = groups.find((x) => x.id === row.groupId);
    if (!source || !stem || !linked) continue;
    const group = claim(linked, source.label);
    if (!group) { skipped.push(`${source.label} → ${linked.name} (jets already used)`); continue; }
    const members = memberItems(group);
    const area = areaById.get(linked.area || linked.id) || null;
    const control = area?.control || 'height';
    const routed = !!(area && design?.connected && control !== 'height');
    if (routed) for (const id of resolveMembers(group, items)) {
      const n = design.nozzleById.get(id);
      if (n?.valveId) driven.add(n.valveId);
      if (n?.pumpId) driven.add(n.pumpId);
    }
    // The right side of a mirrored left / right pair runs the other way.
    const flip = !!(area && area.position === 'right' && rows.some((r) => r.sourceId === row.sourceId && r.kind !== 'lights'
      && areaById.get(r.groupId)?.position === 'left'));
    const height = Math.max(0, ...members.map((m) => Number(m.engineering?.jetHeightM) || 0));
    const leadS = lead ? waterLead(height) : 0;
    const feats = phrases.map((p) => phraseFeatures(stem, source, p.start, p.end, g.beatSec));
    const sorted = feats.map((f) => f.energy).sort((a, b) => a - b);
    const rank = (e) => (sorted.length > 1 ? sorted.filter((v) => v < e).length / (sorted.length - 1) : 0.5);
    const memo = new Map();
    let lastMax = null;
    let lastEnd = 0;          // patterns on one group never overlap (the PLC compiler rejects that)
    const lightRow = lightsFor(row);
    const lightLinked = lightRow && groups.find((x) => x.id === lightRow.groupId);
    const lightGroup = lightLinked ? claim(lightLinked, source.label) : null;
    phrases.forEach((p, i) => {
      const eRel = rank(feats[i].energy);
      // Every two phrases the effect family rotates; the same section label at the same
      // position gets the same choice, so music that repeats looks the same in water.
      // With the design, every other turn is a world-famous look the area can perform.
      const turn = Math.floor(p.index / 2);
      const slot = area ? Math.floor(turn / 2) % 3 : turn % 3;
      const ctx = { label: p.label, eRel, beatSec: g.beatSec, barSec: g.barSec, members: control === 'pump' ? 1 : members.length, variant: slot };
      // With the design no area goes dark while its part rests: a calm slow wave instead.
      const rest = !!area && !choosePattern(source, feats[i], ctx);
      const raw = fitToControl(rest ? { preset: 'wave', lapSeconds: 4 * g.barSec, crests: 2, minLevel: 30, maxLevel: 70 } : choosePattern(source, feats[i], ctx), control, ctx);
      if (!raw) { lastMax = null; return; }
      const finale = !!area && p.label === 'chorus' && lastChorus >= 0 && p.start >= lastChorus && eRel >= 0.5;
      const famous = area && !rest && (turn % 2 === 1 || finale) ? famousFor(source, area, { turn: Math.floor(turn / 2) + i, eRel, finale }) : null;
      // Heights move gradually from phrase to phrase.
      const pick = lastMax == null ? raw : { ...raw, maxLevel: Math.round(clamp(raw.maxLevel, lastMax - MAX_LEVEL_STEP, lastMax + MAX_LEVEL_STEP)) };
      lastMax = pick.maxLevel;
      const memoKey = `${p.label}:${slot}:${pick.preset}`;
      if (!memo.has(memoKey)) memo.set(memoKey, pick.preset === 'mirror' ? (memo.size % 2 ? 'outward' : 'inward') : (memo.size % 2 ? 'counter-clockwise' : 'clockwise'));
      const order = flip ? FLIP[memo.get(memoKey)] || memo.get(memoKey) : memo.get(memoKey);
      const color = SECTION_COLORS[p.label] || '#35d0c0';
      const base = { start: p.start, duration: r3(p.end - p.start), lapSeconds: pick.lapSeconds, minLevel: pick.minLevel, maxLevel: pick.maxLevel,
        order: pick.preset === 'ripple' ? 'center-out' : order, crests: pick.crests || 1, smoothness: pick.smoothness || (pick.preset === 'pulse' ? 'sharp' : 'smooth'),
        color, axis: 'sides', seed: i + 1, ...(p.label === 'outro' && p.last ? { fade: 'out' } : {}) };
      const synced = syncPatternOptions(pick.preset, base, analysis, { members: members.length });
      const opts = { ...synced.options, sync: synced.options.sync || sync };
      // Fire early so the water peaks on the music, not after it.
      const shift = Math.min(leadS, opts.start);
      opts.start = r3(opts.start - shift);
      if (opts.start < lastEnd) { opts.duration = r3(opts.duration - (lastEnd - opts.start)); opts.start = r3(lastEnd); }
      if (opts.start + opts.duration > 600) opts.duration = r3(600 - opts.start);
      if (opts.duration < 1) return;
      lastEnd = r3(opts.start + opts.duration);
      const tag = { music: fillId, section: p.label, part: source.id, leadS: shift, ...(famous ? { famous: famous.id } : {}) };
      const lightLevel = Math.round(25 + 65 * eRel);
      const easeS = r3(Math.min(g.barSec, opts.duration / 4));
      const look = famous ? famous.make({ barSec: g.barSec, beatSec: g.beatSec }) : null;
      const hardware = routed ? (famous ? famous.valve : valveMode(pick.preset)) : null;
      let ids;
      if (look?.field) {
        // A famous wave field: water + matching lights, levels and soft edges from the music.
        const field = { ...look.field, low: pick.minLevel, high: pick.maxLevel, lowFar: pick.minLevel, highFar: pick.maxLevel, stairs: 0, ease: easeS, openValves: false,
          ...(flip ? { direction: -(look.field.direction || 1), ...(look.field.origin === 'left' ? { origin: 'right' } : {}) } : {}) };
        const w = ensureGroup(next, group);
        next = w.studio;
        let lightId = null;
        if (lightGroup) { const l = ensureGroup(next, lightGroup); next = l.studio; lightId = l.groupId; }
        const made = fieldUnitRecipes({ kind: field.kind, start: opts.start, duration: opts.duration, name: famous.name, waterGroupId: w.groupId, lightGroupId: lightId,
          field, light: { color, low: 6, high: lightLevel }, order: order || 'clockwise' });
        const recipes = made.recipes.map((r) => ({ ...r, pattern: { ...r.pattern, ...tag, group: r.pattern.role === 'lights' ? lightGroup.id : group.id },
          ...(hardware && r.pattern.role !== 'lights' ? { hardware } : {}) }));
        next = { ...next, recipes: [...next.recipes, ...recipes] };
        ids = new Set(recipes.map((r) => r.id));
      } else {
        const preset = look?.preset || pick.preset;
        const lookOpts = look ? { ...look.options, ...(look.floor === 0 ? { minLevel: 0 } : {}),
          ...(flip && look.options.order ? { order: FLIP[look.options.order] || look.options.order } : {}) } : {};
        const built = look ? syncPatternOptions(preset, { ...opts, ...lookOpts, start: opts.start, duration: opts.duration }, analysis, { members: members.length }).options : opts;
        const unit = buildPatternUnit(next, { preset, options: { ...built, start: opts.start, sync: built.sync || sync }, group, items, name: famous?.name,
          lights: lightGroup ? { group: lightGroup, color, level: lightLevel } : null, tag });
        // Ease every edge over one bar, so one pattern hands over to the next without a jump.
        const ease = { in: easeS, out: easeS, floor: EASE_FLOOR };
        ids = new Set(unit.recipes.map((r) => r.id));
        next = { ...unit.studio, recipes: unit.studio.recipes.map((r) => (!ids.has(r.id) ? r : {
          ...r, ...(r.effect === 'curve' ? { ease } : {}), ...(hardware && r.pattern?.role !== 'lights' ? { hardware } : {}) })) };
      }
      added.push(...next.recipes.filter((r) => ids.has(r.id)));
      counts[source.label] = (counts[source.label] || 0) + 1;
      if (famous) counts['Famous looks'] = (counts['Famous looks'] || 0) + 1;
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
      // Bursts only use jets no linked part is driving.
      const freeWater = claim(allWater, 'burst');
      if (!freeWater) return;
      const members = memberItems(freeWater);
      const height = Math.max(0, ...members.map((m) => Number(m.engineering?.jetHeightM) || 0));
      const start = r3(Math.max(0, p.start - waterLead(height)));
      const freeLights = allLights ? claim(allLights, 'flash') : null;
      const unit = buildPatternUnit(next, { preset: 'ripple', group: freeWater, items,
        options: { start, duration: r3(g.barSec), lapSeconds: r3(g.barSec), minLevel: 0, maxLevel: 100, order: 'center-out', crests: 1,
          smoothness: 'smooth', color: '#ffffff', axis: 'sides', seed: 1, sync: { ...sync, lapBeats: g.beatsPerBar } },
        lights: freeLights ? { group: freeLights, color: '#ffffff', level: 100 } : null,
        tag: { music: fillId, section: 'accent', part: 'drop' } });
      next = unit.studio;
      added.push(...unit.recipes);
      counts.Accents = (counts.Accents || 0) + 1;
    });
  }
  // Recipes that held these solenoids / pumps (e.g. "valves open all show") would fight the
  // music: mute them (unmute to bring them back).
  let muted = 0;
  if (driven.size) {
    next = { ...next, recipes: next.recipes.map((r) => {
      if (r.pattern?.music || r.muted) return r;
      const ids = resolveMembers(next.groups.find((x) => x.id === r.groupId), items);
      if (!ids.length || !ids.every((id) => driven.has(id))) return r;
      muted++;
      return { ...r, muted: true, mutedBy: 'music' };
    }) };
  }
  next = { ...next, tempo: [{ time: r3(g.beatOrigin), bpm: r3(g.bpm) }] };
  return { studio: next, recipes: added, fillId, counts, skipped, muted };
}
