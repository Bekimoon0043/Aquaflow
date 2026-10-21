// AI design review (optional) — the app side. Writes a compact text description of the fountain
// design for the engine's design advisor (backend/services/ai_design_advisor.py): areas, valves,
// pumps (power, flow, VFD, what they feed), lights, groups that share jets or pumps, site limits,
// basin splash / wind limits and the pump flow budget. Text only — no drawings, no files.
// Advice only: nothing here changes the design.

import { apiPost } from '../utils/apiClient';
export { aiErrorMessage } from '../utils/aiError';
import { inventory, readStudio, resolveMembers } from '../components/programmer/studio/showModel';
import { readFountainDesign } from '../components/programmer/studio/fountainDesign';
import { buildSiteModel } from '../components/programmer/studio/siteCapability';
import { groupConflicts } from '../components/programmer/studio/groupAdvisor';
import { builderGroups } from '../components/programmer/studio/patternPresets';
import { windSafeScale } from '../components/preview/waterPhysics';
import { pumpRating } from './pumpDuty';
import { basinArea } from './basins';

export const REVIEW_WIND_MS = 6; // a fresh breeze: how much height each area keeps outdoors
const MAX_TEXT = 38000;
const r1 = (v) => Math.round(Number(v) * 10) / 10;
const isVfd = (item) => /vfd|variable|inverter/i.test(`${item?.engineering?.controlType || ''} ${item?.type || ''} ${item?.label || ''}`);

/** Each pump's rated flow (L/min) against what its jets ask for when all are open. */
export function pumpFlowBudget(design) {
  return [...design.pumps.values()].map((p) => {
    const e = p.item.engineering || {};
    const rating = pumpRating(e);
    const ratedLpm = rating.flowM3s > 0 ? Math.round(rating.flowM3s * 60000) : null;
    const known = p.nozzleIds.map((id) => Number(design.nozzleById.get(id)?.item.engineering?.flowLpm) || 0);
    const demandLpm = known.some((q) => q > 0) ? Math.round(known.reduce((a, b) => a + b, 0)) : null;
    return { id: p.id, name: p.name, powerKw: Number(e.powerKw) || (rating.powerW ? rating.powerW / 1000 : null), vfd: isVfd(p.item),
      ratedLpm, demandLpm, missingFlow: known.filter((q) => !(q > 0)).length, jets: p.nozzleIds.length, valved: p.valveIds.length,
      powerLimited: rating.powerLimited, headM: rating.headM || null,
      over: ratedLpm && demandLpm ? Math.round((100 * demandLpm) / ratedLpm) : null };
  });
}

/** Lowest share of design height an area keeps at `windMs` (1 = full height) inside the basin. */
function areaWindScale(scm, area, basin, windMs) {
  let s = 1;
  for (const o of scm.outputs.filter((x) => x.area === area.id)) {
    const e = scm.design.nozzleById.get(o.id)?.item.engineering || {};
    s = Math.min(s, windSafeScale({ x: o.pos[0], y: o.pos[1], heightM: o.heightM, sprayAngleDeg: e.sprayAngleDeg, nozzleDiaMm: e.nozzleDiaMm }, basin,
      { windMs, limit: scm.splashLimit }));
  }
  return s;
}

/**
 * Everything the advisor reads, from the Engineering fixtures, basins and the show's groups.
 * @returns {{ description, areas: string[], ids: string[], design, items }}
 */
export function designReviewInput({ fixtures = [], basins = [], programmer = null } = {}) {
  const items = inventory(fixtures);
  const design = readFountainDesign(items);
  const studio = readStudio(programmer);
  const b = basins?.[0]?.outer;
  const basin = Array.isArray(b) && b.length >= 3 ? b.map((p) => [Number(p.x), Number(p.y)]) : null;
  const scm = buildSiteModel(items, { design, overrides: { ...(studio.site || {}), basin } });
  const groups = builderGroups(studio, items);
  const conflicts = groupConflicts({ groups, membersOf: (g) => resolveMembers(g, items), design, recipes: studio.recipes,
    focus: [] }).slice(0, 20);
  const budget = pumpFlowBudget(design);

  const L = [];
  L.push(`FOUNTAIN: ${design.summary}. ${design.connected ? '' : 'No nozzle is linked to a valve or pump yet. '}`
    + `Audience faces ${scm.front.source === 'user' ? 'the side the user set' : 'the long side (guessed)'}; mirror symmetry ${Math.round(100 * scm.symmetry.score)} %.`);
  L.push('AREAS (id · name · nozzles · kind · height · control · pumps · lights · layer · command→visible lead · calm-air basin height kept):');
  for (const a of scm.areas) {
    const ctl = a.control === 'switch' ? 'own solenoid per jet, height from the pump' : a.control === 'pump' ? 'no valves, rise and fall with their pump' : 'own height control';
    const o = scm.outputs.find((x) => x.area === a.id);
    const lim = o?.limits ? ` · limits min on ${o.limits.minOnS}s / off ${o.limits.minOffS}s, ramp ${o.limits.upPctPerS}%/s${o.limits.cooldownS ? `, cooldown ${o.limits.cooldownS}s` : ''}` : '';
    L.push(`${a.id} · ${a.name} · ${a.size} · ${a.family} · ${r1(a.heightM)} m · ${ctl}${a.coupled ? ' (coupled to other areas through its pump)' : ''}`
      + ` · pumps ${a.sources.join(', ') || 'none'} · ${a.lightIds.length} lights · ${a.layer} · lead ${r1(a.leadS)}s · ${basin ? `${Math.round(100 * a.heightScale)} %` : 'no basin'}${lim}`
      + `${a.hero ? ' · HERO' : ''} · nozzles ${a.nozzleIds.slice(0, 40).join(', ')}${a.nozzleIds.length > 40 ? ' …' : ''}`);
  }
  if (basin) {
    L.push(`BASIN: ${r1(basinArea(basins[0]))} m², splash limit ${Math.round(100 * scm.splashLimit)} % of water outside. Height each area keeps at ${REVIEW_WIND_MS} m/s wind (worst direction):`);
    for (const a of scm.areas) L.push(`${a.id} · ${Math.round(100 * areaWindScale(scm, a, basin, REVIEW_WIND_MS))} % of ${r1(a.heightM)} m`);
  } else L.push('BASIN: no basin outline drawn — splash and wind cannot be checked.');
  L.push('PUMPS (id · name · power · VFD · rated flow · demand with every jet open · jets / valved · notes):');
  for (const p of budget) {
    L.push(`${p.id} · ${p.name} · ${p.powerKw ? `${r1(p.powerKw)} kW` : 'power ?'} · ${p.vfd ? 'VFD' : 'no VFD'} · ${p.ratedLpm ? `${p.ratedLpm} L/min` : 'rated flow ?'}`
      + ` · ${p.demandLpm ? `${p.demandLpm} L/min${p.over ? ` (${p.over} % of rated)` : ''}` : 'demand ?'}${p.missingFlow ? ` (${p.missingFlow} jets without flow data)` : ''}`
      + ` · ${p.jets} / ${p.valved}${p.headM ? ` · head ${r1(p.headM)} m` : ''}${p.powerLimited ? ' · motor too small for its duty point' : ''}`);
  }
  const unvalved = design.nozzles.filter((n) => !n.valveId && !n.pumpId);
  const idleValves = [...design.valves.values()].filter((v) => !v.nozzleIds.length);
  L.push(`VALVES: ${design.valves.size} solenoids; ${idleValves.length} not linked to a nozzle${idleValves.length ? ` (${idleValves.slice(0, 20).map((v) => v.id).join(', ')})` : ''};`
    + ` ${unvalved.length} nozzles with neither valve nor pump${unvalved.length ? ` (${unvalved.slice(0, 20).map((n) => n.id).join(', ')})` : ''}.`);
  const unpaired = design.lights.filter((l) => !l.item.engineering?.pairedNozzleId && !l.item.pairedNozzleId);
  L.push(`LIGHTS: ${design.lights.length}; ${unpaired.length} not paired to a nozzle (placed by nearest); areas without lights: ${scm.areas.filter((a) => !a.lightIds.length).map((a) => a.id).join(', ') || 'none'}.`);
  L.push(`GROUP CHECK (groups that cannot move on their own): ${conflicts.length ? '' : 'no conflicts among groups in use.'}`);
  for (const c of conflicts) L.push(`- ${c.text} ${c.fix}`);
  if (scm.tips.length) { L.push('APP TIPS:'); for (const t of scm.tips.slice(0, 20)) L.push(`- ${t}`); }
  L.push('Review this design: weak spots and the upgrades that would help most, most important first.');
  const description = L.join('\n').slice(0, MAX_TEXT);
  const ids = [...design.nozzles.map((n) => n.id), ...design.valves.keys(), ...design.pumps.keys(), ...design.lights.map((l) => l.id)].slice(0, 5000);
  return { description, areas: scm.areas.map((a) => a.id), ids, design, items };
}

/** Ask the engine's design advisor. Throws with a readable message when unavailable. */
export async function requestDesignReview(input, { post = apiPost } = {}) {
  return post('/ai/design-review', { description: input.description, areas: input.areas, ids: input.ids });
}

/** The fixtures a finding concerns: its own ids, then the nozzles of its areas. */
export function findingFixtureIds(finding, design) {
  const out = [...(finding?.ids || [])];
  for (const id of finding?.areas || []) out.push(...(design?.areas.find((a) => a.id === id)?.nozzleIds || []));
  return [...new Set(out)];
}
