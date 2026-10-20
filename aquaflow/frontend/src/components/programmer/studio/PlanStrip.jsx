// Plan strip — the Show Plan above the 3D show timeline: the arc (each section's role and
// colour) and the look of every phrase. Click a phrase to lock it (it survives Regenerate);
// Variant A / B / C re-search the same plan, New show re-plans with another seed.
import { useMemo } from 'react';
import useProjectStore from '../../../store/projectStore';
import { readStems } from './stemSync';
import { createShow } from './autoShow';
import { designGroups, readFountainDesign } from './fountainDesign';
import { builderGroups } from './patternPresets';
import { lookById } from './lookLibrary';

export const PLAN_STRIP_H = 30;
const ROLE_LABEL = { intro: 'Intro', verse: 'Verse', build: 'Build', high: 'High', climax: 'Climax', rest: 'Rest', outro: 'Outro' };

/** Regenerate the show from the stored plan settings (seed, variant, locks). */
export function regenerate(studio, { items, analysis, stems, seed, variant }) {
  const design = readFountainDesign(items);
  const groups = [...designGroups(design), ...builderGroups(studio, items)];
  return createShow(studio, { analysis, stems, items, groups, design, seed, variant, locks: studio.plan?.locks || {} });
}

export default function PlanStrip({ studio, items, analysis, pps, onChange, onNote }) {
  const programmer = useProjectStore((s) => s.programmer);
  const stems = useMemo(() => readStems(programmer), [programmer]);
  const plan = studio.plan;
  if (!plan?.sections?.length) return null;
  const locked = new Set(Object.keys(plan.locks || {}).map((k) => k.split(':').slice(0, 2).join(':')));
  const run = (patch) => {
    if (!analysis) { onNote?.('Find the beats first'); return; }
    try {
      onChange((s) => {
        const seed = patch.seed ?? s.plan?.seed ?? 0, variant = patch.variant ?? s.plan?.variant ?? 0;
        const base = patch.locks ? { ...s, plan: { ...s.plan, locks: patch.locks } } : s;
        return regenerate(base, { items, analysis, stems, seed, variant }).studio;
      });
    } catch (error) { onNote?.(error.message); }
  };
  const toggle = (s, pi) => {
    const locks = { ...(plan.locks || {}) };
    const phrase = s.phrases[pi];
    const key = `${s.id}:${pi}`;
    if (locked.has(key)) for (const k of Object.keys(locks)) { if (k.startsWith(`${key}:`)) delete locks[k]; }
    else for (const v of phrase.voices) locks[`${key}:${v.areaId}`] = v.look;
    onChange((st) => ({ ...st, plan: { ...st.plan, locks } }));
  };
  return <div className="plan-strip" aria-label="Show plan" style={{ height: PLAN_STRIP_H }}>
    {plan.sections.map((s) => <div key={s.id} className={`plan-section role-${s.role}`} style={{ left: 12 + s.start * pps, width: Math.max(4, (s.end - s.start) * pps), '--hue': s.light?.hue || '#35d0c0' }}
      title={`${ROLE_LABEL[s.role] || s.role} · energy ${Math.round(100 * s.energy)} % · ${s.active.length} area${s.active.length === 1 ? '' : 's'}${s.contrastBefore ? ' · dip before' : ''}${s.hero?.budget ? ` · ${s.hero.budget} hero` : ''}`}>
      <b>{ROLE_LABEL[s.role] || s.role}</b>
      {s.phrases.map((p, pi) => {
        const names = [...new Set(p.voices.map((v) => lookById(v.look)?.name || v.look))];
        const key = `${s.id}:${pi}`;
        return <button key={pi} className={`plan-phrase${locked.has(key) ? ' locked' : ''}`} style={{ left: (p.start - s.start) * pps, width: Math.max(3, (p.end - p.start) * pps) }}
          aria-pressed={locked.has(key)} onClick={() => toggle(s, pi)}
          title={`${names.join(' · ')}\n${locked.has(key) ? 'Locked: kept when you regenerate. Click to unlock.' : 'Click to lock this phrase'}`}>
          {locked.has(key) ? '🔒 ' : ''}{names[0]}{names.length > 1 ? ` +${names.length - 1}` : ''}</button>;
      })}
    </div>)}
    <div className="plan-tools">
      {[0, 1, 2].map((v) => <button key={v} aria-pressed={(plan.variant || 0) === v} onClick={() => run({ variant: v })} title="Another arrangement of the same plan">Variant {'ABC'[v]}</button>)}
      <button onClick={() => run({ seed: (plan.seed || 0) + 1, variant: 0 })} title="Plan the show again with a new casting and palette (locked phrases stay)">New show</button>
    </div>
  </div>;
}
