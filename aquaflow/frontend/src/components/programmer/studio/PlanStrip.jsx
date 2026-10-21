// Plan strip — the Show Plan above the 3D show timeline: the arc (each section's role and
// colour) and the look of every phrase. Click a phrase to lock it (it survives Regenerate);
// Variant A / B / C re-search the same plan, New show re-plans with another seed, Best of 4
// tries four and keeps the one that scores highest with your taste; 👍 Prefer this teaches
// AquaFlow which variant you liked (preferences.js); ✦ AI critic asks Claude to review the show
// and offers fixes (aiCritic.js).
import { useMemo, useState } from 'react';
import useProjectStore from '../../../store/projectStore';
import useEngineeringStore from '../../../store/engineeringStore';
import { readStems } from './stemSync';
import { bestOf, createShow } from './autoShow';
import { designGroups, readFountainDesign } from './fountainDesign';
import { builderGroups } from './patternPresets';
import { lookById } from './lookLibrary';
import { compileStudio } from './showModel';
import { measureShow } from './showMetrics';
import { emptyPreferences, fitWeights, nudgeLook, recordChoice } from './preferences';
import { requestDirection } from './directorPlan';
import { applyFix, fixLabel, requestCritique, validateCritique } from './aiCritic';
import { buildSiteModel } from './siteCapability';

export const PLAN_STRIP_H = 30;
const ROLE_LABEL = { intro: 'Intro', verse: 'Verse', build: 'Build', high: 'High', climax: 'Climax', rest: 'Rest', outro: 'Outro' };

function context(studio, { items, analysis, stems, basin }) {
  const design = readFountainDesign(items);
  const groups = [...designGroups(design), ...builderGroups(studio, items)];
  return { analysis, stems, items, groups, design, site: { ...(studio.site || {}), basin } };
}

/** Regenerate the show from the stored plan settings (seed, variant, locks). */
export function regenerate(studio, { items, analysis, stems, seed, variant, basin = null }) {
  return createShow(studio, { ...context(studio, { items, analysis, stems, basin }), seed, variant, locks: studio.plan?.locks || {} });
}

/** Plan looks the user deleted from the timeline since the plan was made (they lose favour). */
export function deletedPlanLooks(studio) {
  const plan = studio.plan;
  let prefs = studio.preferences;
  if (!plan) return prefs;
  const made = studio.recipes.filter((r) => r.pattern?.plan === plan.id && r.pattern?.role !== 'lights');
  if (!made.length) return prefs;
  const have = new Set(made.map((r) => `${r.pattern.phrase}:${r.pattern.look}`));
  for (const s of plan.sections) s.phrases.forEach((p, pi) => {
    for (const v of p.voices) if (v.rendered && !have.has(`${s.id}:${pi}:${v.look}`)) prefs = nudgeLook(prefs, v.look, 'delete');
  });
  return prefs;
}

export default function PlanStrip({ studio, items, analysis, pps, onChange, onNote }) {
  const programmer = useProjectStore((s) => s.programmer);
  const stems = useMemo(() => readStems(programmer), [programmer]);
  const basins = useEngineeringStore((s) => s.basins);
  const basin = basins?.[0]?.outer?.length >= 3 ? basins[0].outer.map((p) => [Number(p.x), Number(p.y)]) : null;
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [review, setReview] = useState(null);
  const plan = studio.plan;
  if (!plan?.sections?.length) return null;
  const locked = new Set(Object.keys(plan.locks || {}).map((k) => k.split(':').slice(0, 2).join(':')));
  const note = (text) => { setMsg(text); onNote?.(text); };
  const run = (patch) => {
    if (!analysis) { note('Find the beats first'); return; }
    try {
      onChange((s) => {
        const seed = patch.seed ?? s.plan?.seed ?? 0, variant = patch.variant ?? s.plan?.variant ?? 0;
        const learned = { ...s, preferences: deletedPlanLooks(s) };
        const base = patch.locks ? { ...learned, plan: { ...learned.plan, locks: patch.locks } } : learned;
        return regenerate(base, { items, analysis, stems, seed, variant, basin }).studio;
      });
    } catch (error) { note(error.message); }
  };
  const measure = (s) => {
    const { clips } = compileStudio(s, items);
    return measureShow({ clips, items, analysis, studio: s, basin, windMs: s.site?.windMs || 0 }).metrics;
  };
  const best = () => {
    if (!analysis) { note('Find the beats first'); return; }
    setBusy('Trying 4 shows…');
    setTimeout(() => {
      try {
        const r = bestOf(studio, context(studio, { items, analysis, stems, basin }), { n: 4 });
        onChange(() => r.best.studio);
        note(`Best of 4 · kept seed ${r.ranked[0].seed}${'AB'[r.ranked[0].variant] ? ` variant ${'ABC'[r.ranked[0].variant]}` : ''} · scores ${r.ranked.map((x) => x.score).join(' / ')}`);
      } catch (error) { note(error.message); } finally { setBusy(''); }
    });
  };
  const prefer = () => {
    if (!analysis) return;
    setBusy('Learning…');
    setTimeout(() => {
      try {
        const mine = measure(studio);
        const others = [0, 1, 2].filter((v) => v !== (plan.variant || 0))
          .map((v) => measure(regenerate(studio, { items, analysis, stems, seed: plan.seed || 0, variant: v, basin }).studio));
        onChange((s) => ({ ...s, preferences: recordChoice(s.preferences, mine, others) }));
        const fit = fitWeights(recordChoice(studio.preferences, mine, others));
        note(`Thanks — ${fit.n} choice${fit.n === 1 ? '' : 's'} learned${fit.n >= 3 ? ` · you value ${Object.entries(fit.weights).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase()).join(' and ')}` : ''}`);
      } catch (error) { note(error.message); } finally { setBusy(''); }
    });
  };
  const askDirector = async () => {
    if (!analysis) { note('Find the beats first'); return; }
    setBusy('AI director…');
    try {
      const ctx = context(studio, { items, analysis, stems, basin });
      const scm = buildSiteModel(items, { design: ctx.design, overrides: ctx.site });
      const direction = await requestDirection(plan, scm, analysis);
      onChange((s) => createShow(s, { ...context(s, { items, analysis, stems, basin }), seed: s.plan?.seed ?? 0, variant: 0, direction, locks: s.plan?.locks || {} }).studio);
      note(`AI director · ${direction.summary || 'plan applied'} — the phrases and every physical limit are still AquaFlow's`);
    } catch (error) {
      note(`${/HTTP 404|fetch|Failed/i.test(error.message) ? 'The AI director needs the AquaFlow engine and an API key (Your fountain → AI director)' : error.message} — kept the rule plan`);
    } finally { setBusy(''); }
  };
  // ✦ AI critic: measure the compiled show, send it as text, list the findings with their fixes.
  const askCritic = async () => {
    setBusy('AI critic…');
    try {
      const ctx = context(studio, { items, analysis, stems, basin });
      const scm = buildSiteModel(items, { design: ctx.design, overrides: ctx.site });
      const { clips } = compileStudio(studio, items);
      const measured = measureShow({ clips, items, analysis, studio, basin, windMs: studio.site?.windMs || 0 });
      const t0 = Date.now();
      const answer = validateCritique(await requestCritique({ plan, measured, scm, analysis }), plan);
      setReview({ ...answer, planId: plan.id, applied: [], seconds: Math.round((Date.now() - t0) / 1000), score: measured.score });
      note(`AI critic · ${answer.findings.length} finding${answer.findings.length === 1 ? '' : 's'}`);
    } catch (error) {
      note(/HTTP 404|Failed to fetch|NetworkError/i.test(error.message) ? 'The AI critic needs the AquaFlow engine and an API key (Your fountain → AI director)' : error.message.replace(/^HTTP \d+ — /, ''));
    } finally { setBusy(''); }
  };
  const applyFinding = (f) => {
    const out = applyFix(studio, f.fix);
    if (!out) { note('Nothing in the show matches this fix any more'); return; }
    if (out.locks) run({ locks: out.locks });
    else onChange(() => out.studio);
    setReview((r) => r && { ...r, applied: [...r.applied, f.id] });
    note(`Applied: ${fixLabel(f.fix)} — Undo restores the show`);
  };
  const toggle = (s, pi) => {
    const locks = { ...(plan.locks || {}) };
    const phrase = s.phrases[pi];
    const key = `${s.id}:${pi}`;
    let prefs = studio.preferences || emptyPreferences();
    if (locked.has(key)) for (const k of Object.keys(locks)) { if (k.startsWith(`${key}:`)) delete locks[k]; }
    else for (const v of phrase.voices) { locks[`${key}:${v.areaId}`] = v.look; prefs = nudgeLook(prefs, v.look, 'lock'); }
    onChange((st) => ({ ...st, plan: { ...st.plan, locks }, preferences: prefs }));
  };
  return <div className="plan-strip" aria-label="Show plan" style={{ height: PLAN_STRIP_H }}>
    {plan.sections.map((s) => <div key={s.id} className={`plan-section role-${s.role}`} style={{ left: 12 + s.start * pps, width: Math.max(4, (s.end - s.start) * pps), '--hue': s.light?.hue || '#35d0c0' }}
      title={`${ROLE_LABEL[s.role] || s.role} · energy ${Math.round(100 * s.energy)} % · ${s.active.length} area${s.active.length === 1 ? '' : 's'}${s.contrastBefore ? ' · dip before' : ''}${s.drop ? ' · drop' : ''}${s.hero?.budget ? ` · ${s.hero.budget} hero` : ''}`}>
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
      {busy ? <small role="status">{busy}</small> : msg && <small className="plan-msg" role="status" title={msg}>{msg}</small>}
      {[0, 1, 2].map((v) => <button key={v} aria-pressed={(plan.variant || 0) === v} onClick={() => run({ variant: v })} disabled={!!busy} title="Another arrangement of the same plan">Variant {'ABC'[v]}</button>)}
      <button onClick={() => run({ seed: (plan.seed || 0) + 1, variant: 0 })} disabled={!!busy} title="Plan the show again with a new casting and palette (locked phrases stay)">New show</button>
      <button onClick={best} disabled={!!busy} title="Try four shows, check every hard limit and keep the one that scores best with your taste">Best of 4</button>
      <button onClick={prefer} disabled={!!busy} title="Tell AquaFlow you prefer this variant over the other two: it learns what you value">👍 Prefer this</button>
      <button onClick={askDirector} disabled={!!busy} aria-pressed={plan.provenance?.planner === 'llm'}
        title="Optional: Claude reads the song's structure and your fountain's areas (text only — no audio) and directs the arc; AquaFlow still picks the phrases and keeps every physical limit. Needs an Anthropic API key (Your fountain → AI director).">✦ AI director</button>
      <button onClick={askCritic} disabled={!!busy} aria-pressed={!!review}
        title="Optional: Claude reviews this show (its measured quality, plan and looks — text only, no audio) and suggests fixes you can apply. Uses your Anthropic key; takes about half a minute.">✦ AI critic</button>
      {review && <div className="plan-critic" role="dialog" aria-label="AI critic">
      <div className="plan-critic-head"><b>✦ AI critic</b><small>score {review.score} · {review.model || 'Claude'} · {review.seconds} s · uses your Anthropic key</small>
        <button onClick={() => setReview(null)} aria-label="Close AI critic">✕</button></div>
      {review.summary && <p>{review.summary}</p>}
      {review.planId !== plan.id && <p className="plan-critic-stale">The show was re-planned since this review — fixes may no longer match.</p>}
      {!review.findings.length && <p>No findings.</p>}
      <ul>{review.findings.map((f) => <li key={f.id} className={`sev-${f.severity}`}>
        <span className="plan-critic-sev">{f.severity}</span> <b>{f.title}</b>{f.detail && <small> — {f.detail}</small>}
        {f.fix.kind !== 'none'
          ? <button disabled={!!busy || review.applied.includes(f.id)} onClick={() => applyFinding(f)}>{review.applied.includes(f.id) ? 'Applied' : `Apply · ${fixLabel(f.fix)}`}</button>
          : <small className="plan-critic-advice"> (advice)</small>}
      </li>)}</ul>
    </div>}
    </div>
  </div>;
}
