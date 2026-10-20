// AI director (optional, Phase 5) — the app side. Writes a compact text description of the
// song and the fountain for the engine's director (backend/services/show_director.py), and
// merges the section-level answer into the Show Plan: roles, playing areas, preferred looks,
// hero moments, dips and colours. Ids are checked again here; the phrase search and the
// constraint compiler still decide every phrase and enforce every limit.

import { apiPost } from '../../../utils/apiClient';
import { LOOKS } from './lookLibrary';
import { ROLE_TARGETS } from './arcPlanner';

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

/** The text the director reads (no audio, no drawings — just numbers and names). */
export function describeForDirector(plan, scm, analysis) {
  const lines = [];
  const m = plan.analysis?.mood || analysis?.mood;
  lines.push(`SONG: ${mmss(analysis?.duration || plan.sections.at(-1)?.end || 0)} long, ${Math.round(plan.analysis.bpm)} BPM, ${plan.analysis.beatsPerBar} beats per bar`
    + (m ? `, key ${m.key}, energy ${Math.round(100 * m.arousal)} %, brightness ${Math.round(100 * m.valence)} %` : '') + '.');
  lines.push('SECTIONS (index · time · label · loudness rank 0–100 · flags · current role):');
  plan.sections.forEach((s, i) => lines.push(`${i} · ${mmss(s.start)}–${mmss(s.end)} · ${s.label} · ${Math.round(100 * s.energyRank)}${s.drop ? ' · drop at start' : ''}${s.repeatOf ? ` · repeats ${s.repeatOf}` : ''} · ${s.role}`));
  lines.push('FOUNTAIN AREAS (id · name · nozzles · how they move · height · where):');
  for (const a of scm.areas) {
    const move = a.control === 'switch' ? 'on/off solenoid per jet, height from a shared pump' : a.control === 'pump' ? 'no valves, rise and fall together with their pump' : 'own height control';
    lines.push(`${a.id} · ${a.name} · ${a.size} ${a.family} · ${move}${a.coupled ? ' (coupled to other areas through its pump)' : ''} · ${Math.round(a.heightM * (a.heightScale ?? 1) * 10) / 10} m allowed · ${a.position}, ${a.layer} layer${a.hero ? ' · HERO (rare)' : ''}`);
  }
  lines.push('LOOKS you may prefer per section (id · name · music parts · controls · energy):');
  for (const l of LOOKS) lines.push(`${l.id} · ${l.name} · ${l.parts.join('/')} · ${l.controls.join('/')} · ${Math.round(100 * l.energy)}${l.hero ? ' · HERO' : ''}${l.style ? ` — ${l.style}` : ''}`);
  lines.push(`AUDIENCE faces the ${scm.front.source === 'user' ? 'side the user set' : 'long side'}; mirror symmetry score ${Math.round(100 * scm.symmetry.score)} %.`);
  lines.push('Return one entry per section index: its role, the areas that play (at least one), up to 4 preferred looks that suit those areas, whether it is a hero moment, whether the moment just before it should dip, and its colour as #rrggbb.');
  return lines.join('\n');
}

/** Ask the engine's director. Throws with a readable message when unavailable. */
export async function requestDirection(plan, scm, analysis, { post = apiPost } = {}) {
  return post('/director/plan', { description: describeForDirector(plan, scm, analysis), areas: scm.areas.map((a) => a.id),
    looks: LOOKS.map((l) => l.id), sections: plan.sections.length });
}

/** Merge a director answer into a Show Plan (unknown ids dropped; coupled riders kept). */
export function applyDirection(plan, direction, scm) {
  if (!direction?.sections?.length) return plan;
  const areaIds = new Set(scm.areas.map((a) => a.id)), lookIds = new Set(LOOKS.map((l) => l.id));
  const sections = plan.sections.map((s, i) => {
    const d = direction.sections.find((x) => x.index === i);
    if (!d) return s;
    const role = ROLE_TARGETS[d.role] ? d.role : s.role;
    let active = (d.areas || []).filter((id) => areaIds.has(id));
    if (!active.length) active = s.active;
    for (const a of scm.areas) if (a.coupled && !active.includes(a.id) && a.sources.some((p) => active.some((id) => scm.areas.find((x) => x.id === id)?.sources.includes(p)))) active.push(a.id);
    const t = ROLE_TARGETS[role];
    return { ...s, role, active, casting: Object.fromEntries(active.map((id) => [id, s.casting[id] || plan.casting[id]])),
      targets: { ...s.targets, energy: Math.max(s.targets.energy, t.energy * 0.9), coverage: Math.max(0.2, active.reduce((n, id) => n + (scm.areas.find((a) => a.id === id)?.size || 0), 0) / (scm.areas.reduce((n, a) => n + a.size, 0) || 1)), layers: t.layers, peak: t.peak },
      prefer: (d.looks || []).filter((id) => lookIds.has(id)),
      hero: { budget: d.hero ? (role === 'climax' ? 2 : 1) : 0 }, finale: s.finale || (role === 'climax' && d.hero && i >= plan.sections.length - 2),
      contrastBefore: d.dipBefore && i > 0 ? { bars: 1, level: 0.2 } : null,
      light: { ...s.light, ...(d.color ? { hue: d.color } : {}), ...(role === 'climax' ? { white: true } : {}) }, why: d.why || '' };
  });
  return { ...plan, sections, ...(direction.palette ? { palette: { ...plan.palette, ...direction.palette } } : {}),
    provenance: { planner: 'llm', model: direction.model || null, summary: direction.summary || '', plannerVersion: plan.provenance?.plannerVersion } };
}
