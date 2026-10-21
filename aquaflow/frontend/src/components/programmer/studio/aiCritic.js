// AI critic — the app side of backend/services/ai_critic.py. Describes a finished show as text
// (the measured quality from showMetrics.measureShow, the plan's sections / phrases / looks,
// the areas and the song sections), asks Claude for a review and applies the fixes it suggests
// through the existing mechanisms: a look swap is a phrase lock + Regenerate (like clicking a
// phrase on the plan strip), a retime / mute / level is an edit of that phrase's recipes.
// Ids are checked again here; anything that does not map to the plan stays advice only.

import { apiPost } from '../../../utils/apiClient';
import { LOOKS, lookById } from './lookLibrary';
import { setLevels } from './aiCompose';

export const SEVERITIES = ['high', 'medium', 'low'];
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const pct = (v) => `${Math.round(100 * (Number(v) || 0))} %`;

/** Phrase id ("S3:1") → the area ids playing in it. */
export function planPhrases(plan) {
  const out = new Map();
  for (const s of plan?.sections || []) s.phrases.forEach((p, pi) => out.set(`${s.id}:${pi}`, [...new Set(p.voices.map((v) => v.areaId))]));
  return out;
}

/** The text Claude reads: quality, plan, areas, song (no audio). */
export function describeForCritic({ plan, measured, scm, analysis }) {
  const lines = [];
  const m = measured || {};
  lines.push(`QUALITY: score ${m.score ?? '?'} / 100, hard gates ${m.pass ? 'all pass' : 'FAIL'}.`);
  if (m.metrics) lines.push(`METRICS (0–100 %): ${Object.entries(m.metrics).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}.`);
  const g = m.gates;
  if (g && !g.pass) {
    lines.push(`GATE VIOLATIONS: ${Object.entries(g.counts || {}).map(([k, n]) => `${k} × ${n}`).join(', ')}`);
    for (const v of (g.violations || []).slice(0, 8)) lines.push(`- ${v.text || `${v.gate} at ${r1(v.t || 0)} s`}`);
  }
  const d = m.detail;
  if (d) {
    lines.push(`DETAIL: ${d.looks} pattern looks, ${d.distinctLooks} distinct, ${d.heroes} hero looks, look repeat rate ${pct(d.repeatRate)}, ${d.events} visible water events.`
      + (d.climax ? ` Measured climax ${mmss(d.climax.start)}–${mmss(d.climax.end)}.` : '')
      + (d.arc ? ` Arc: climax has most water ${d.arc.climaxHighest ? 'yes' : 'no'}, dip before climax ${d.arc.dipBefore ? 'yes' : 'no'}, strong ending ${d.arc.strongEnd ? 'yes' : 'no'}.` : ''));
    if (d.areas?.length) lines.push(`AREA ACTIVITY (share of time with water · in the climax): ${d.areas.map((a) => `${a.id} ${pct(a.all)} · ${pct(a.climax)}`).join('; ')}.`);
  }
  if (analysis?.bpm) lines.push(`SONG: ${mmss(analysis.duration || plan.sections.at(-1)?.end || 0)} long, ${Math.round(analysis.bpm)} BPM.`);
  lines.push('AREAS (id · name · jets · control · height):');
  for (const a of scm?.areas || []) lines.push(`${a.id} · ${a.name} · ${a.size} ${a.family} · ${a.control} · ${r1((a.heightM || 0) * (a.heightScale ?? 1))} m${a.hero ? ' · HERO' : ''}`);
  lines.push('PLAN (section id · time · label · role · energy rank · flags), then its phrases (phrase id · time · area=look …):');
  for (const s of plan.sections) {
    lines.push(`${s.id} · ${mmss(s.start)}–${mmss(s.end)} · ${s.label} · ${s.role} · ${pct(s.energyRank)}${s.drop ? ' · drop' : ''}${s.contrastBefore ? ' · dip before' : ''}${s.hero?.budget ? ` · hero budget ${s.hero.budget}` : ''}`);
    s.phrases.forEach((p, pi) => lines.push(`  ${s.id}:${pi} · ${r1(p.start)}–${r1(p.end)} s · ${p.voices.map((v) => `${v.areaId}=${v.look}`).join(' ')}`));
  }
  lines.push(`LOOKS: ${LOOKS.map((l) => `${l.id} (${l.name}, ${l.controls.join('/')}, min ${l.minJets || 1} jets, energy ${Math.round(100 * l.energy)}${l.hero ? ', HERO' : ''})`).join('; ')}.`);
  lines.push('Review this show. Most important findings first; give a fix only when it is one of the listed kinds.');
  return lines.join('\n');
}

/** Ask the engine. Throws with a readable message when unavailable. */
export async function requestCritique({ plan, measured, scm, analysis }, { post = apiPost } = {}) {
  const phrases = planPhrases(plan);
  const groups = [...new Set([...(scm?.areas || []).map((a) => a.id), ...[...phrases.values()].flat()])];
  return post('/ai/critique', { description: describeForCritic({ plan, measured, scm, analysis }), sections: plan.sections.map((s) => s.id),
    phrases: [...phrases].map(([id, g]) => ({ id, groups: g })), groups, looks: LOOKS.map((l) => l.id) });
}

/** Check the review again against this plan: unknown ids turn a fix into advice ('none'). */
export function validateCritique(answer, plan) {
  const phrases = planPhrases(plan), sections = new Set(plan.sections.map((s) => s.id));
  const groups = new Set([...phrases.values()].flat());
  const checkFix = (f) => {
    const none = { kind: 'none' };
    if (!f || typeof f !== 'object') return none;
    const phraseId = phrases.has(f.phraseId) ? f.phraseId : null;
    const sectionId = phraseId ? phraseId.split(':')[0] : sections.has(f.sectionId) ? f.sectionId : null;
    const groupId = groups.has(f.groupId) && (!phraseId || phrases.get(phraseId).includes(f.groupId)) ? f.groupId : null;
    const where = phraseId ? { phraseId } : sectionId ? { sectionId } : null;
    if (f.kind === 'swap-look') return phraseId && lookById(f.look) ? { kind: f.kind, phraseId, groupId, look: f.look } : none;
    if (f.kind === 'retime') return where && Number.isFinite(Number(f.shiftS)) && Math.abs(f.shiftS) >= 0.05 ? { kind: f.kind, ...where, shiftS: r3(Math.max(-4, Math.min(4, Number(f.shiftS)))) } : none;
    if (f.kind === 'mute') return where && groupId ? { kind: f.kind, ...where, groupId } : none;
    if (f.kind === 'level') return where && Number.isFinite(Number(f.level)) ? { kind: f.kind, ...where, groupId, level: Math.round(Math.max(5, Math.min(100, Number(f.level)))) } : none;
    return none;
  };
  const findings = (Array.isArray(answer?.findings) ? answer.findings : [])
    .filter((f) => f && SEVERITIES.includes(f.severity) && String(f.title || '').trim())
    .slice(0, 12)
    .map((f, i) => ({ id: `F${i + 1}`, severity: f.severity, title: String(f.title).slice(0, 120), detail: String(f.detail || '').slice(0, 600), fix: checkFix(f.fix) }))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  return { summary: String(answer?.summary || '').slice(0, 600), findings, model: answer?.model || null };
}

/** Short button text for a fix ('' when it is advice only). */
export function fixLabel(fix) {
  switch (fix?.kind) {
    case 'swap-look': return `Swap to ${lookById(fix.look)?.name || fix.look}`;
    case 'retime': return `${fix.shiftS > 0 ? 'Later' : 'Earlier'} by ${Math.abs(fix.shiftS)} s`;
    case 'mute': return 'Mute there';
    case 'level': return `Level ${fix.level} %`;
    default: return '';
  }
}

/** Does a recipe belong to the fix's phrase / section (and group, when given)? */
function targets(r, fix, planId) {
  const p = r.pattern;
  if (!p || p.plan !== planId || !p.phrase) return false;
  if (fix.phraseId ? p.phrase !== fix.phraseId : !p.phrase.startsWith(`${fix.sectionId}:`)) return false;
  return !fix.groupId || p.group === fix.groupId || p.group === `${fix.groupId}:lights`;
}

/**
 * Apply one fix. Returns { locks } (swap-look: regenerate with these phrase locks), { studio }
 * (recipe edit) or null when nothing in the show matches.
 */
export function applyFix(studio, fix) {
  const plan = studio.plan;
  if (!plan || !fix || fix.kind === 'none') return null;
  if (fix.kind === 'swap-look') {
    const s = plan.sections.find((x) => x.id === fix.phraseId.split(':')[0]);
    const phrase = s?.phrases[Number(fix.phraseId.split(':')[1])];
    const voices = (phrase?.voices || []).filter((v) => !fix.groupId || v.areaId === fix.groupId);
    if (!voices.length) return null;
    const locks = { ...(plan.locks || {}) };
    for (const v of voices) locks[`${fix.phraseId}:${v.areaId}`] = fix.look;
    return { locks };
  }
  let n = 0;
  const recipes = studio.recipes.map((r) => {
    if (!targets(r, fix, plan.id)) return r;
    if (fix.kind === 'retime') { n++; return { ...r, start: r3(Math.max(0, Math.min(600 - r.duration, r.start + fix.shiftS))) }; }
    if (fix.kind === 'mute') { n++; return { ...r, muted: true, mutedBy: 'critic' }; }
    if (fix.kind === 'level' && !['lights', 'motion'].includes(r.pattern.role)) { n++; return setLevels(r, { high: fix.level }); }
    return r;
  });
  return n ? { studio: { ...studio, recipes }, changed: n } : null;
}
