// Show-arc planner — level 1 of the generator (reports/Automatic fountain shows for any site.md).
// Turns the song's sections and energy plus the Site Capability Model into a Show Plan: one
// entry per section with a role in the arc (intro → verse → build → climax → outro), targets
// (energy, coverage, layers, peak height), the areas that play and the part each one plays,
// a hero budget, a contrast dip before the climax, a colour, and links between repeats. Pure.
//
// Section labels from any detector are wrong ~20–25 % of the time, so the arc follows the
// sections' energy rank; labels only group repeats.

import { energyBetween } from './musicAnalysis';
import { availableSources } from './stemProgram';
import { songPalette, sectionLight } from './lightScript';

export const PLAN_VERSION = 1;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Role targets (AquaFlow design choices, tuned with the evaluation harness — not industry numbers). */
export const ROLE_TARGETS = {
  intro: { energy: 0.35, coverage: 0.35, layers: 1, peak: 0.7 },
  verse: { energy: 0.5, coverage: 0.6, layers: 2, peak: 0.8 },
  build: { energy: 0.65, coverage: 0.7, layers: 2, peak: 0.85 },
  high: { energy: 0.8, coverage: 0.85, layers: 3, peak: 0.95 },
  climax: { energy: 1, coverage: 1, layers: 3, peak: 1 },
  rest: { energy: 0.3, coverage: 0.35, layers: 1, peak: 0.65 },
  outro: { energy: 0.35, coverage: 0.4, layers: 1, peak: 0.7 },
};
/** Which areas a role prefers to light up first (layering: foreground melody in quiet parts, all at the climax). */
const ROLE_PRIORITY = {
  intro: ['melody', 'ambient', 'rhythm', 'bass', 'climax', 'accent'],
  rest: ['melody', 'ambient', 'rhythm', 'bass', 'climax', 'accent'],
  outro: ['melody', 'ambient', 'rhythm', 'bass', 'climax', 'accent'],
  verse: ['rhythm', 'melody', 'bass', 'ambient', 'climax', 'accent'],
  build: ['rhythm', 'melody', 'bass', 'climax', 'ambient', 'accent'],
  high: ['rhythm', 'melody', 'bass', 'climax', 'ambient', 'accent'],
  climax: ['climax', 'rhythm', 'melody', 'bass', 'accent', 'ambient'],
};
const PART_FOR_ROLE = { melody: ['vocals:melody', 'other:melody', 'piano:melody', 'guitar:melody', 'vocals', 'other'], rhythm: ['drums:kicks', 'drums:hats', 'drums:hits'],
  bass: ['bass', 'drums:kicks'], climax: ['drums:kicks', 'bass'], accent: ['drums:kicks', 'drums:hits'], ambient: ['vocals', 'other', 'bass'] };

/** Seeded random 0..1. */
export function rng(seed) { let s = (Math.round(seed) * 2654435761) >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Music part per area: family role first, hats on the lowest switched jets, rotated by seed between songs. */
export function castAreas(scm, stems, seed = 0) {
  const sources = availableSources(stems).map((s) => s.id);
  // Without stems every area still gets the part its family plays (features then come from the song).
  const pick = (role) => (PART_FOR_ROLE[role] || []).find((id) => sources.includes(id)) || (sources.length ? sources[0] : (PART_FOR_ROLE[role] || ['bass'])[0]);
  const cast = new Map();
  const switched = scm.areas.filter((a) => a.control === 'switch' && a.role === 'rhythm').sort((a, b) => a.heightM - b.heightM || b.size - a.size);
  const tallest = Math.max(0, ...scm.areas.map((a) => a.heightM));
  for (const a of scm.areas) {
    let part = pick(a.role);
    if (a.role === 'rhythm' && a.heightM >= tallest && scm.areas.length > 2) part = pick('bass');
    cast.set(a.id, part);
  }
  // The lowest switched areas carry the hats when there is more than one rhythm area.
  if (switched.length > 1 && (sources.includes('drums:hats') || !sources.length)) {
    const lowH = switched[0].heightM;
    for (const a of switched) if (a.heightM <= lowH && a.heightM < tallest) cast.set(a.id, 'drums:hats');
  }
  // "In the next song the roles are reversed": rotate rhythm parts between rhythm areas by seed.
  const rot = ((seed % 3) + 3) % 3;
  if (rot && switched.length > 1) {
    const parts = switched.map((a) => cast.get(a.id));
    switched.forEach((a, i) => cast.set(a.id, parts[(i + rot) % parts.length]));
  }
  // Mirror areas play the same part.
  for (const a of scm.areas) if (a.mirrorArea && cast.has(a.mirrorArea) && a.position === 'right') cast.set(a.id, cast.get(a.mirrorArea));
  return cast;
}

/** The climax: the loudest section; among near-equals (within 0.04) the last one — the arc peaks late. */
export function climaxIndex(energy) {
  if (!energy.length) return -1;
  const top = Math.max(...energy);
  let c = energy.indexOf(top);
  energy.forEach((e, i) => { if (e >= top - 0.04 && i > c) c = i; });
  return c;
}

/**
 * The song's sections for the arc: detected sections, short ones merged into a neighbour,
 * long ones (> 24 bars) split into 16-bar parts so a coarse detector still gives the arc a shape.
 * Each has its mean energy from the loudness curve.
 */
export function arcSections(analysis) {
  const end = Math.min(600, analysis.duration);
  const barSec = (60 / (analysis.bpm || 120)) * (analysis.beatsPerBar || 4);
  const raw = (analysis.sections?.length ? analysis.sections : [{ start: 0, end, label: 'verse' }]).filter((s) => s.end - s.start > 0.5);
  const merged = [];
  for (const s of raw) {
    if (merged.length && s.end - s.start < 4 * barSec) merged.at(-1).end = s.end;
    else merged.push({ start: s.start, end: s.end, label: s.label || 'verse' });
  }
  if (merged.length) { merged[0].start = 0; merged.at(-1).end = end; }
  const out = [];
  for (const s of merged) {
    const bars = Math.round((s.end - s.start) / barSec);
    if (bars <= 24) { out.push(s); continue; }
    const parts = Math.max(2, Math.round(bars / 16));
    for (let k = 0; k < parts; k++) {
      const a = s.start + Math.round((k * bars) / parts) * barSec, b = k === parts - 1 ? s.end : s.start + Math.round(((k + 1) * bars) / parts) * barSec;
      out.push({ start: r3(a), end: r3(b), label: s.label, part: k });
    }
  }
  return out.map((s) => ({ ...s, energy: r3(energyBetween(analysis.energy, s.start, s.end)) }));
}

/**
 * @param {object} p { analysis (meter applied), stems, scm, seed }
 * @returns {object} Show Plan (showPlan schema v1, phrases filled in by phraseSearch)
 */
export function planShow({ analysis, stems = [], scm, seed = 0 }) {
  const end = Math.min(600, analysis.duration);
  const barSec = (60 / (analysis.bpm || 120)) * (analysis.beatsPerBar || 4);
  const secs = arcSections(analysis);
  const energy = secs.map((s) => s.energy);
  const slope = secs.map((s) => {
    const third = (s.end - s.start) / 3;
    return energyBetween(analysis.energy, s.end - third, s.end) - energyBetween(analysis.energy, s.start, s.start + third);
  });
  const sorted = [...energy].sort((a, b) => a - b);
  const rank = energy.map((e) => (sorted.length > 1 ? sorted.indexOf(e) / (sorted.length - 1) : 0.5));
  const top = Math.max(...energy);
  const climax = climaxIndex(energy);
  const roles = secs.map((s, i) => {
    if (i === climax) return 'climax';
    if (i === 0 && rank[i] < 0.5) return 'intro';
    // An outro only when the music really comes down (DJ mixes often end at full power).
    if (i === secs.length - 1 && energy[i] < 0.75 * top) return 'outro';
    if (rank[i] >= 0.66) return 'high';
    if (rank[i] <= 0.25 && i > 0 && i < secs.length - 1) return 'rest';
    return 'verse';
  });
  // Deep analysis: a section that starts on a drop hits hard; one that holds a build-up builds.
  const drops = analysis.drops || [], builds = analysis.builds || [];
  const dropAt = secs.map((s) => drops.some((d) => Math.abs(d.time - s.start) <= barSec));
  secs.forEach((s, i) => { if (dropAt[i] && !['climax'].includes(roles[i]) && rank[i] >= 0.4 && i > 0) roles[i] = 'high'; });
  roles.forEach((r, i) => {
    const next = roles[i + 1];
    const holdsBuild = builds.some((b) => b.end > secs[i].start + barSec && b.start < secs[i].end - barSec);
    if ((r === 'verse' || r === 'rest') && (next === 'high' || next === 'climax') && (slope[i] > 0.02 || holdsBuild || dropAt[i + 1])) roles[i] = 'build';
  });

  const cast = castAreas(scm, stems, seed);
  const palette = songPalette(analysis, seed);
  const seen = new Map();
  const occurrences = {};
  const sections = secs.map((s, i) => {
    const role = roles[i];
    const t = ROLE_TARGETS[role];
    const e = 0.55 * t.energy + 0.45 * (0.2 + 0.8 * rank[i]);
    const targets = { energy: r3(e), coverage: r3(clamp(t.coverage * (0.85 + 0.3 * rank[i]), 0.2, 1)), layers: t.layers, peak: t.peak,
      ...(role === 'build' ? { energyTo: r3(Math.min(1, e + 0.2)), coverageTo: r3(Math.min(1, t.coverage + 0.25)) } : {}) };
    // Areas that play: by the role's priority, until the coverage target (by jet count) is met.
    const order = [...scm.areas].sort((a, b) => ROLE_PRIORITY[role].indexOf(a.role) - ROLE_PRIORITY[role].indexOf(b.role) || b.size - a.size);
    const total = scm.areas.reduce((n, a) => n + a.size, 0) || 1;
    const active = [];
    let jets = 0;
    for (const a of order) {
      if (a.hero && role !== 'climax' && role !== 'high') continue;
      if (jets / total >= targets.coverage && active.length) break;
      active.push(a.id); jets += a.size;
      if (a.mirrorArea && !active.includes(a.mirrorArea)) { active.push(a.mirrorArea); jets += scm.areas.find((x) => x.id === a.mirrorArea)?.size || 0; }
    }
    // Areas without valves on a pump that also feeds playing areas ride along with that pump.
    for (const a of scm.areas) if (a.coupled && !active.includes(a.id) && a.sources.some((p) => active.some((id) => scm.areas.find((x) => x.id === id)?.sources.includes(p)))) active.push(a.id);
    const key = `${s.label}:${s.part ?? 0}`;
    const repeatOf = seen.has(key) && Math.abs(seen.get(key).energy - energy[i]) < 0.15 ? seen.get(key).id : null;
    if (!seen.has(key)) seen.set(key, { id: `S${i + 1}`, energy: energy[i] });
    occurrences[role] = (occurrences[role] || 0) + 1;
    return {
      id: `S${i + 1}`, start: r3(s.start), end: r3(s.end), label: s.label, labelConfidence: analysis.deepVersion ? 0.8 : 0.75, role, energy: r3(energy[i]), energyRank: r3(rank[i]),
      targets, active, casting: Object.fromEntries(active.map((id) => [id, cast.get(id)])),
      hero: role === 'climax' ? { budget: 2 } : role === 'high' && (dropAt[i] || roles.slice(0, i).every((x) => x !== 'high' && x !== 'climax')) ? { budget: 1 } : { budget: 0 },
      drop: dropAt[i],
      finale: role === 'climax' && i >= secs.length - 2,
      contrastBefore: null, light: sectionLight(role, palette, { energy: targets.energy, occurrence: occurrences[role] - 1 }),
      repeatOf, variation: repeatOf ? 'mirror' : null, phrases: [],
    };
  });
  // A dip before the climax (and before the first high section after a build) makes it land.
  sections.forEach((s, i) => {
    if (i && (s.role === 'climax' || (s.role === 'high' && (sections[i - 1].role === 'build' || s.drop))) && !['rest', 'intro'].includes(sections[i - 1].role)) {
      sections[i - 1].contrastBefore = null;
      s.contrastBefore = { bars: 1, level: 0.2 };
    }
  });
  return {
    version: PLAN_VERSION, id: `plan-${seed}-${Math.round(end)}`, seed,
    analysis: { bpm: analysis.bpm, beatsPerBar: analysis.beatsPerBar || 4, barSec: r3(barSec), meter: analysis.meter || null, deep: !!analysis.deepVersion, mood: analysis.mood || null },
    palette, casting: Object.fromEntries(cast), sections,
    site: { front: scm.front, symmetry: scm.symmetry.score, heightScale: scm.heightScale, areas: scm.areas.map((a) => ({ id: a.id, name: a.name, control: a.control, role: a.role })) },
    provenance: { planner: 'rules', plannerVersion: '1.0.0' },
  };
}
