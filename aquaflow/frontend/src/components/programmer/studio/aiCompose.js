// AI compose (words → patterns) — the app side of backend/services/ai_compose.py. Writes a
// compact text description of the show groups, the song and the look library, asks Claude for
// placements (group, look, start / end, colour, level) and turns each one into real, editable
// patterns with planRender — the generator's own look → recipe machinery — so beat sync, the
// water's lead time, shooter refill, swing sway and the hardwareFollow limits at compile all
// apply. Ids, times and looks are checked again here; a look the group cannot perform is swapped
// for one it can.

import { apiPost } from '../../../utils/apiClient';
import { LOOKS, lookById } from './lookLibrary';
import { renderPlan } from './planRender';
import { applyMeter } from './musicMeter';
import { songAnalysis } from './deepMerge';
import { designGroups, readFountainDesign } from './fountainDesign';
import { buildSiteModel } from './siteCapability';
import { builderGroups, isWaterItem } from './patternPresets';
import { resolveMembers, uid } from './showModel';

export const MAX_PLACEMENTS = 80;
export const PROMPT_KEY = 'aquaflow.aiCompose.prompt';
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HEX = /^#[0-9a-f]{6}$/i;
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

/** The last prompt (per browser; storage may be blocked). */
export function readPrompt(fallback) {
  try { return localStorage.getItem(PROMPT_KEY) || fallback; } catch { return fallback; }
}
export function rememberPrompt(text) {
  try { localStorage.setItem(PROMPT_KEY, text); } catch { /* storage blocked */ }
}

/**
 * Groups AI compose may use: the fountain's areas (with their real control) and the user's own
 * show groups (treated as height-controlled; they carry no valve routing).
 */
export function composeGroups(scm, studio, items) {
  const out = scm.areas.map((a) => ({ id: a.id, name: a.name, size: a.size, control: a.control, family: a.family,
    heightM: r1((a.heightM || 0) * (a.heightScale ?? 1)), lights: a.lightIds.length > 0, area: a }));
  const known = new Set(out.map((g) => g.id));
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const g of studio.groups) {
    if (known.has(g.id) || g.createdBy === 'pattern-builder') continue;
    const water = resolveMembers(g, items).map((id) => itemById.get(id)).filter((i) => i && isWaterItem(i));
    if (!water.length) continue;
    const heightM = Math.max(0, ...water.map((m) => Number(m.engineering?.jetHeightM) || 0));
    out.push({ id: g.id, name: g.name, size: water.length, control: 'height', family: 'jet', heightM: r1(heightM), lights: false,
      area: { id: g.id, name: g.name, family: 'jet', control: 'height', size: water.length, heightM, heightScale: 1, nozzleIds: [], lightIds: [], sources: [] } });
  }
  return out.slice(0, 200);
}

/** The song as compose sees it, and the analysis the renderer syncs to (a plain grid without beats found). */
export function songFacts(studio, analysis, showEnd = 60) {
  const a = analysis?.bpm ? applyMeter(songAnalysis(analysis), studio.meter) : null;
  const bpm = a?.bpm || studio.tempo?.[0]?.bpm || 120;
  const duration = r3(Math.min(600, a?.duration || showEnd || 60));
  const sections = studio.plan?.sections?.length
    ? studio.plan.sections.map((s) => ({ id: s.id, start: s.start, end: s.end, label: s.label, role: s.role, drop: !!s.drop }))
    : (a?.sections || []).map((s, i) => ({ id: `S${i + 1}`, start: s.start, end: s.end, label: s.label || 'section', role: null, drop: false }));
  const render = a || { bpm, beatsPerBar: 4, beats: [], duration };
  return { bpm, beatsPerBar: render.beatsPerBar || 4, duration, sections, drops: (a?.drops || []).map((d) => d.time), analysis: render };
}

/** Everything compose needs from the studio: design, site model, groups, song. */
export function composeContext(studio, items, analysis, { basin = null, showEnd } = {}) {
  const design = readFountainDesign(items);
  const scm = buildSiteModel(items, { design, overrides: { ...(studio.site || {}), ...(basin ? { basin } : {}) } });
  const groups = composeGroups(scm, studio, items);
  return { design, scm, groups, song: songFacts(studio, analysis, showEnd), renderGroups: [...designGroups(design), ...builderGroups(studio, items)] };
}

/** The text Claude reads (no audio, no drawings — just numbers and names). */
export function describeForCompose({ groups, song }, words, time = 0) {
  const lines = [];
  lines.push(`SONG: ${mmss(song.duration)} long (${song.duration} s), ${Math.round(song.bpm)} BPM, ${song.beatsPerBar} beats per bar. The playhead is at ${r1(time)} s.`);
  if (song.sections.length) {
    lines.push('SECTIONS (start s – end s · label · role · drop):');
    for (const s of song.sections) lines.push(`${r1(s.start)}–${r1(s.end)} · ${s.label}${s.role ? ` · ${s.role}` : ''}${s.drop ? ' · drop at start' : ''}`);
  } else lines.push('SECTIONS: not detected (use times in seconds).');
  if (song.drops.length) lines.push(`DROPS at ${song.drops.map(r1).join(', ')} s.`);
  lines.push('GROUPS (id · name · jets · control · height · lights):');
  for (const g of groups) {
    const move = g.control === 'switch' ? 'switch (on/off solenoids, height from a shared pump)' : g.control === 'pump' ? 'pump (no valves, the whole group rises and falls together)' : 'height (own height control)';
    lines.push(`${g.id} · ${g.name} · ${g.size} ${g.family} · ${move} · ${g.heightM} m${g.lights ? ' · has lights' : ''}`);
  }
  lines.push('LOOKS (id · name · controls it works on · min jets · energy 0–100 · description):');
  for (const l of LOOKS) lines.push(`${l.id} · ${l.name} · ${l.controls.join('/')} · ${l.minJets || 1} · ${Math.round(100 * l.energy)}${l.hero ? ' · HERO' : ''}${l.style ? ` — ${l.style}` : ''}`);
  lines.push(`USER'S WORDS: ${words.trim()}`);
  lines.push(`Return placements (at most ${MAX_PLACEMENTS}) with start/end in seconds inside 0–${song.duration}, colour #rrggbb and level low/high in % (0–100).`);
  return lines.join('\n');
}

/** Ask the engine. Throws with a readable message when unavailable. */
export async function requestCompose(ctx, words, time, { post = apiPost } = {}) {
  return post('/ai/compose', { description: describeForCompose(ctx, words, time), groups: ctx.groups.map((g) => g.id),
    looks: LOOKS.map((l) => l.id), duration: ctx.song.duration });
}

const fits = (look, g) => look.controls.includes(g.control) && g.size >= (look.minJets || 1);

/** A look this group can perform: the asked one, else one with the same music part, else Breathing. */
export function fitLook(lookId, g) {
  const look = lookById(lookId);
  if (look && fits(look, g)) return look.id;
  const alt = LOOKS.find((l) => !l.hero && fits(l, g) && look && l.parts.some((p) => look.parts.includes(p)) && Math.abs(l.energy - look.energy) <= 0.25);
  return alt?.id || 'breathing';
}

/**
 * Check the AI's answer again: known groups and looks, times inside the song (≥ 1 s), levels
 * 0–100 with low ≤ high, #rrggbb colours, at most MAX_PLACEMENTS. Returns { placements, dropped, adapted }.
 */
export function validatePlacements(answer, { groups, song }) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const list = Array.isArray(answer?.placements) ? answer.placements : [];
  const placements = [];
  let dropped = 0, adapted = 0;
  for (const p of list) {
    const g = byId.get(p?.groupId), look = lookById(p?.look);
    const a = Number(p?.start), b = Number(p?.end);
    if (!g || !look || !Number.isFinite(a) || !Number.isFinite(b)) { dropped++; continue; }
    const start = r3(clamp(a, 0, song.duration)), end = r3(clamp(b, 0, song.duration));
    if (end - start < 1) { dropped++; continue; }
    const high = Math.round(clamp(Number.isFinite(Number(p.high)) ? Number(p.high) : 100, 5, 100));
    const low = Math.round(clamp(Number.isFinite(Number(p.low)) ? Number(p.low) : 0, 0, high));
    const lookId = fitLook(look.id, g);
    if (lookId !== look.id) adapted++;
    placements.push({ groupId: g.id, look: lookId, asked: lookId !== look.id ? look.id : null, start, end,
      color: HEX.test(p.color || '') ? p.color.toLowerCase() : '#35d0c0', low, high, why: String(p.why || '').slice(0, 200) });
    if (placements.length >= MAX_PLACEMENTS) break;
  }
  placements.sort((x, y) => x.start - y.start);
  return { placements, dropped: dropped + Math.max(0, list.length - dropped - placements.length), adapted };
}

/**
 * Set a water recipe's level range (0–100): field heights, or a curve's top and floor. Lights
 * and motion recipes are left alone. `low` null keeps the pattern's own floor.
 */
export function setLevels(recipe, { low = null, high }) {
  if (['lights', 'motion', 'accent'].includes(recipe.pattern?.role)) return recipe;
  const top = Math.round(clamp(Number(high) || 0, 0, 100));
  if (recipe.effect === 'field') {
    const f = recipe.field || {};
    const lo = low == null ? Math.min(Number(f.low ?? 20), top) : clamp(low, 0, top);
    return { ...recipe, field: { ...f, low: lo, lowFar: lo, high: top, highFar: top } };
  }
  const next = { ...recipe, intensity: top };
  if (low != null && recipe.effect === 'curve' && recipe.envelope?.length) {
    const vals = recipe.envelope.map((p) => Number(p.value) || 0), m = Math.min(...vals), f = top > 0 ? clamp(low / top, 0, 1) : 0;
    if (m < 1) next.envelope = recipe.envelope.map((p) => ({ ...p, value: r3(f + ((1 - f) * ((Number(p.value) || 0) - m)) / (1 - m)) }));
  }
  if (recipe.pattern?.options) next.pattern = { ...recipe.pattern, options: { ...recipe.pattern.options, maxLevel: top, ...(low != null ? { minLevel: Math.min(low, top) } : {}) } };
  return next;
}

const roleAt = (song, p) => {
  const s = song.sections.find((x) => p.start >= x.start - 0.5 && p.start < x.end);
  return s?.role || (p.high >= 85 ? 'high' : 'verse');
};

/**
 * Placements → editable recipes, through planRender on a scratch copy of the studio (one
 * one-phrase section per placement). Returns { recipes, groups (new groups the recipes use),
 * items: [{ id, name, start, end, why, recipeIds }], skipped }.
 */
export function placementsToRecipes(studio, placements, { groups, song, scm, design, renderGroups }, items) {
  if (!placements.length) return { recipes: [], groups: [], items: [], skipped: 0 };
  const byId = new Map(groups.map((g) => [g.id, g]));
  const barSec = (60 / song.bpm) * song.beatsPerBar;
  const plan = { id: uid('compose'), analysis: { bpm: song.bpm, beatsPerBar: song.beatsPerBar, barSec: r3(barSec) },
    sections: placements.map((p, i) => ({ id: `AI${i + 1}`, role: roleAt(song, p), start: p.start, end: p.end, energyRank: 1, targets: { peak: 1 },
      light: { hue: p.color, intensity: clamp(p.high / 100, 0.3, 1) },
      phrases: [{ start: p.start, end: p.end, voices: [{ areaId: p.groupId, look: p.look, part: lookById(p.look)?.parts[0] || 'follow' }] }] })) };
  const out = renderPlan({ ...studio, recipes: [] }, plan, { analysis: song.analysis, items, groups: renderGroups, design, scm: { ...scm, areas: groups.map((g) => g.area) } });
  const known = new Set(studio.groups.map((g) => g.id));
  const newGroups = out.studio.groups.filter((g) => !known.has(g.id));
  const recipes = [], list = [];
  placements.forEach((p, i) => {
    const g = byId.get(p.groupId), hs = g.area.heightScale ?? scm.heightScale ?? 1;
    const high = Math.round(p.high * hs), low = Math.min(p.low, high);
    const mine = out.recipes.filter((r) => r.pattern?.phrase === `AI${i + 1}:0`).map((r) => {
      const { music, ...pattern } = r.pattern;                // user patterns: Regenerate leaves them alone
      return setLevels({ ...r, pattern: { ...pattern, ai: 'compose', why: p.why } }, { low, high });
    });
    if (!mine.length) return;
    recipes.push(...mine);
    const name = `${g.name} · ${lookById(p.look)?.name || p.look}`;
    list.push({ id: `${plan.id}:${i}`, name, start: Math.min(...mine.map((r) => r.start)), end: Math.max(...mine.map((r) => r.start + r.duration)),
      why: p.asked ? `${p.why}${p.why ? ' · ' : ''}${lookById(p.asked)?.name || p.asked} does not suit this group's hardware` : p.why, recipeIds: mine.map((r) => r.id) });
  });
  return { recipes, groups: newGroups.filter((g) => recipes.some((r) => r.groupId === g.id)), items: list, skipped: placements.length - list.length };
}

/** The whole AI answer → a proposal (validated placements made into recipes). */
export function composeProposal(studio, answer, ctx, items) {
  const checked = validatePlacements(answer, ctx);
  const made = placementsToRecipes(studio, checked.placements, ctx, items);
  return { ...made, dropped: checked.dropped, adapted: checked.adapted, summary: String(answer?.summary || '').slice(0, 600), model: answer?.model || null };
}
