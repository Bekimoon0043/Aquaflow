// Plan render — level 3 of the generator: every voice's look in every phrase becomes a real,
// editable pattern-builder unit (or wave field), synced to the beat, started early by the
// water's rise time, eased at its edges, with its lights in the plan's colours and tagged so
// the constraint compiler drives the real solenoids and pumps. Pure.

import { buildPatternUnit, ensureGroup, pruneBuilderGroups } from './patternPresets';
import { syncPatternOptions } from './beatSync';
import { resolveMembers, uid } from './showModel';
import { famousById } from './famousPatterns';
import { fieldUnitRecipes } from './showBlocks';
import { lookById } from './lookLibrary';
import { EASE_FLOOR, fitToControl, waterLead } from './musicPatterns';

const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const FLIP = { clockwise: 'counter-clockwise', 'counter-clockwise': 'clockwise', 'left-to-right': 'right-to-left', 'right-to-left': 'left-to-right' };
const MIN_LEVEL = { breathing: 30, wave: 25, mirror: 25, ripple: 10, chase: 5, sparkle: 0, pulse: 5 };
const HIT_LOOKS = new Set(['pulse', 'chase', 'sparkle', 'rain', 'heartbeat', 'waterfall-steps', 'shooter-salvo']);

/** Lap of a builder preset look, from its speed and the section's role (bars / beats). */
function presetLap(lookId, role, { beatSec, barSec }) {
  const hot = role === 'climax' || role === 'high';
  switch (lookId) {
    case 'breathing': return (hot ? 2 : 4) * barSec;
    case 'pulse': return 2 * beatSec;
    case 'sparkle': return 2 * beatSec;
    case 'ripple': return (role === 'climax' ? 1 : 2) * barSec;
    default: return 2 * barSec;
  }
}

/**
 * @param {object} studio
 * @param {object} plan  searched Show Plan
 * @param {object} p { analysis (meter applied), items, groups (with design groups), design, scm, lead = true }
 * @returns {{ studio, recipes, fillId, counts, muted }}
 */
export function renderPlan(studio, plan, { analysis, items, groups, design, scm, lead = true }) {
  const barSec = plan.analysis.barSec, beatSec = barSec / (plan.analysis.beatsPerBar || 4);
  const bend = analysis.meter?.accent === 'bend';
  const previous = studio.recipes.filter((r) => r.pattern?.music);
  let next = pruneBuilderGroups({ ...studio, recipes: studio.recipes.filter((r) => !r.pattern?.music) }, previous.map((r) => r.groupId));
  const fillId = uid('music');
  const sync = { bpm: r3(analysis.bpm), beatsPerBar: analysis.beatsPerBar || 4 };
  const areaById = new Map(scm.areas.map((a) => [a.id, a]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const added = [], counts = {};
  const lastEnd = new Map();
  const driven = new Set();
  const memo = new Map();

  plan.sections.forEach((s, si) => {
    const nextSec = plan.sections[si + 1];
    s.phrases.forEach((p, pi) => {
      const lastPhrase = pi === s.phrases.length - 1;
      for (const v of p.voices) {
        const area = areaById.get(v.areaId), group = groupById.get(v.areaId), look = lookById(v.look);
        if (!area || !group || !look) continue;
        const lightGroup = groupById.get(`${v.areaId}:lights`) || null;
        const members = resolveMembers(group, items).map((id) => itemById.get(id)).filter(Boolean);
        const routed = !!(design?.connected && area.control !== 'height');
        if (routed) for (const id of area.nozzleIds) { const n = design.nozzleById.get(id); if (n?.valveId) driven.add(n.valveId); if (n?.pumpId) driven.add(n.pumpId); }
        // Levels: the section's peak target, scaled by the wind stage.
        const peak = clamp(s.targets.peak * (0.9 + 0.1 * s.energyRank), 0.5, 1) * (scm.heightScale ?? 1);
        let pick = { preset: look.preset || 'breathing', lapSeconds: presetLap(look.id, s.role, { beatSec, barSec }), minLevel: MIN_LEVEL[look.id] ?? 15, maxLevel: Math.round(100 * peak) };
        if (look.preset) pick = fitToControl(pick, area.control, { beatSec, barSec });
        // Direction: one per section and look (repeats mirror), flipped for the mirror partner.
        const key = `${s.repeatOf || s.id}:${look.id}`;
        if (!memo.has(key)) memo.set(key, (pick.preset === 'mirror' ? ['inward', 'outward'] : ['clockwise', 'counter-clockwise'])[memo.size % 2]);
        let order = memo.get(key);
        if (s.variation === 'mirror') order = FLIP[order] || (order === 'inward' ? 'outward' : order === 'outward' ? 'inward' : order);
        if (v.mirrorOf) order = FLIP[order] || order;
        let start = p.start, duration = r3(p.end - p.start);
        // The dip before the climax: this phrase stops a bar early so the water drops.
        if (lastPhrase && nextSec?.contrastBefore) duration = r3(duration - nextSec.contrastBefore.bars * barSec);
        if (bend && HIT_LOOKS.has(look.id)) { start = r3(start + beatSec / 2); duration = r3(duration - beatSec / 2); }
        const color = s.light?.white && pi % 2 ? '#ffffff' : s.light?.hue || '#35d0c0';
        const lightLevel = Math.round(100 * clamp(s.light?.intensity ?? 0.6, 0.15, 1));
        const base = { start, duration, lapSeconds: r3(pick.lapSeconds), minLevel: pick.minLevel, maxLevel: pick.maxLevel, order: pick.preset === 'ripple' ? 'center-out' : order,
          crests: 1, smoothness: ['pulse', 'chase', 'sparkle'].includes(pick.preset) ? 'sharp' : 'smooth', color, axis: 'sides', seed: si * 10 + pi + 1,
          ...(s.role === 'outro' && lastPhrase && si === plan.sections.length - 1 ? { fade: 'out' } : {}) };
        const famous = look.famous ? famousById(look.famous) : null;
        const made = famous ? famous.make({ barSec, beatSec }) : null;
        const preset = made?.preset || pick.preset;
        const synced = made?.field ? { options: base } : syncPatternOptions(preset, { ...base, ...(made?.options || {}), ...(made?.floor === 0 ? { minLevel: 0 } : {}),
          ...(v.mirrorOf && made?.options?.order ? { order: FLIP[made.options.order] || made.options.order } : {}) }, analysis, { members: members.length });
        const opts = { ...synced.options, sync: synced.options.sync || sync };
        const height = Math.max(0, ...members.map((m) => Number(m.engineering?.jetHeightM) || 0));
        const shift = lead ? Math.min(waterLead(height), opts.start) : 0;
        opts.start = r3(opts.start - shift);
        const le = lastEnd.get(v.areaId) || 0;
        if (opts.start < le) { opts.duration = r3(opts.duration - (le - opts.start)); opts.start = r3(le); }
        if (opts.start + opts.duration > 600) opts.duration = r3(600 - opts.start);
        if (opts.duration < 1) continue;
        lastEnd.set(v.areaId, r3(opts.start + opts.duration));
        const tag = { music: fillId, plan: plan.id, section: s.role, part: v.part, look: look.id, phrase: `${s.id}:${pi}`, leadS: shift, ...(famous ? { famous: famous.id } : {}) };
        const hardware = routed ? (famous ? famous.valve : pick.preset === 'breathing' ? 'open' : 'hits') : null;
        const easeS = r3(Math.min(barSec, opts.duration / 4));
        let ids;
        if (made?.field) {
          const field = { ...made.field, low: pick.minLevel, high: pick.maxLevel, lowFar: pick.minLevel, highFar: pick.maxLevel, stairs: 0, ease: easeS, openValves: false,
            ...(v.mirrorOf ? { direction: -(made.field.direction || 1), ...(made.field.origin === 'left' ? { origin: 'right' } : {}) } : {}) };
          const w = ensureGroup(next, group); next = w.studio;
          let lightId = null;
          if (lightGroup) { const l = ensureGroup(next, lightGroup); next = l.studio; lightId = l.groupId; }
          const out = fieldUnitRecipes({ kind: field.kind, start: opts.start, duration: opts.duration, name: famous.name, waterGroupId: w.groupId, lightGroupId: lightId,
            field, light: { color, low: 6, high: lightLevel }, order: order || 'clockwise' });
          const recipes = out.recipes.map((r) => ({ ...r, pattern: { ...r.pattern, ...tag, group: r.pattern.role === 'lights' ? lightGroup.id : group.id },
            ...(hardware && r.pattern.role !== 'lights' ? { hardware } : {}) }));
          next = { ...next, recipes: [...next.recipes, ...recipes] };
          ids = new Set(recipes.map((r) => r.id));
        } else {
          const unit = buildPatternUnit(next, { preset, options: opts, group, items, name: famous?.name || look.name,
            lights: lightGroup ? { group: lightGroup, color, level: lightLevel } : null, tag });
          const ease = { in: easeS, out: easeS, floor: EASE_FLOOR };
          ids = new Set(unit.recipes.map((r) => r.id));
          next = { ...unit.studio, recipes: unit.studio.recipes.map((r) => (!ids.has(r.id) ? r : {
            ...r, ...(r.effect === 'curve' ? { ease } : {}), ...(hardware && r.pattern?.role !== 'lights' ? { hardware } : {}) })) };
        }
        added.push(...next.recipes.filter((r) => ids.has(r.id)));
        counts[s.role] = (counts[s.role] || 0) + 1;
        if (famous) counts['Famous looks'] = (counts['Famous looks'] || 0) + 1;
      }
    });
  });
  // Recipes that held these solenoids / pumps fixed would fight the music: mute them.
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
  next = { ...next, tempo: [{ time: r3((analysis.beats?.[0] ?? 0) % beatSec), bpm: r3(analysis.bpm) }] };
  return { studio: next, recipes: added, fillId, counts, muted };
}
