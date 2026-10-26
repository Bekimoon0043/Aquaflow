// Show quality metrics — measured on the compiled show (what the hardware and the audience
// get), not on the generator's intent. Pure. See reports/Automatic fountain shows for any site.md.
//
//   gates    hard limits: valve minimum on / off, pump ramp, flow per pump, light overlaps.
//            Any violation fails the show.
//   metrics  event alignment, energy tracking, arc fidelity, coverage, structure consistency,
//            diversity, hero discipline, peak usage — each 0..1, plus a weighted score 0..100.
//
// Water seen by the audience lags the command by the rise time of the jet, so water events
// are measured at command time + waterLead(height).

import { clipLevel } from './hardwareFollow';
import { readFountainDesign } from './fountainDesign';
import { waterLead } from './musicPatterns';
import { MIN_OFF_S, MIN_ON_S } from './patternPresets';
import { arcSections, climaxIndex } from './arcPlanner';
import { songAnalysis } from './deepMerge';
import { oversprayShare, visibleLead } from '../../preview/waterPhysics';
import { DEFAULT_FLOW_MARGIN_PCT, isVfdPump, jetFlowLpm, pumpCapLpm } from '../../../engineering/pumpFlow';

export const METRICS_VERSION = 1;
export const DT = 0.05;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const WATER = /^(pump_speed|pump_pressure|device_intensity|motion_intensity)$/;
const LIGHT = /^lighting_master$/;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Weights of the overall score (sum 1). Phase 5 tunes these from A/B ratings. */
export const SCORE_WEIGHTS = {
  eventAlignment: 0.15, energyTracking: 0.15, arcFidelity: 0.15, coverage: 0.15,
  structureConsistency: 0.1, diversity: 0.1, heroDiscipline: 0.05, peakUsage: 0.15,
};
/** Looks that count as hero moments (rare by design: shooters, finales). */
export const HERO_LOOKS = new Set(['shooter-salvo', 'grand-finale']);

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** Level grid (0..100) per fixture from its clips: the highest clip wins at each instant. */
export function levelGrids(clips, ids, T, dt = DT, test = WATER) {
  const N = Math.ceil(T / dt) + 1;
  const byFixture = new Map();
  for (const c of clips) {
    if (c.muted || c.disabled || !ids.has(c.fixtureId) || !test.test(c.type)) continue;
    if (!byFixture.has(c.fixtureId)) byFixture.set(c.fixtureId, []);
    byFixture.get(c.fixtureId).push(c);
  }
  const out = new Map();
  for (const id of ids) {
    const g = new Float32Array(N);
    for (const c of byFixture.get(id) || []) {
      const i0 = Math.max(0, Math.floor(c.startTime / dt)), i1 = Math.min(N - 1, Math.ceil((c.startTime + c.duration) / dt));
      for (let i = i0; i <= i1; i++) { const v = clipLevel(c, i * dt); if (v > g[i]) g[i] = v; }
    }
    out.set(id, g);
  }
  return out;
}

/** Hard gates on the compiled clips. */
export function showGates(clips, design, { minOn = MIN_ON_S, minOff = MIN_OFF_S, pumpUp = 40, pumpDown = 30 } = {}) {
  const violations = [];
  const valves = new Map();
  for (const c of clips) if (c.type === 'solenoid_open' && !c.muted && Number(c.value) > 0) (valves.get(c.fixtureId) || valves.set(c.fixtureId, []).get(c.fixtureId)).push(c);
  for (const [id, list] of valves) {
    list.sort((a, b) => a.startTime - b.startTime);
    list.forEach((c, i) => {
      if (c.duration < minOn - 0.011) violations.push({ gate: 'valve-min-on', id, t: c.startTime, text: `${id} open ${c.duration.toFixed(2)} s` });
      if (i) {
        const gap = c.startTime - (list[i - 1].startTime + list[i - 1].duration);
        if (gap > 0.011 && gap < minOff - 0.011) violations.push({ gate: 'valve-min-off', id, t: c.startTime, text: `${id} closed ${gap.toFixed(2)} s` });
      }
    });
  }
  for (const c of clips) {
    if (c.type !== 'pump_speed' || !design?.pumps?.has(c.fixtureId) || !Array.isArray(c.keys) || c.muted) continue;
    for (let k = 2; k < c.keys.length; k += 2) {
      const dt = c.keys[k] - c.keys[k - 2], dv = c.keys[k + 1] - c.keys[k - 1];
      if (dt <= 0) continue;
      const rate = dv / dt;
      // 25 % slack: the key simplification rounds slopes.
      if (rate > pumpUp * 1.25 + 2 || rate < -(pumpDown * 1.25 + 2)) {
        violations.push({ gate: 'pump-ramp', id: c.fixtureId, t: r3(c.startTime + c.keys[k - 2]), text: `${c.fixtureId} ramps ${rate.toFixed(0)} %/s` });
        break;
      }
    }
  }
  const lights = new Map();
  for (const c of clips) if (/^lighting_/.test(c.type) && !c.muted) (lights.get(`${c.fixtureId}:${c.type}`) || lights.set(`${c.fixtureId}:${c.type}`, []).get(`${c.fixtureId}:${c.type}`)).push(c);
  for (const [key, list] of lights) {
    list.sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1].startTime + list[i - 1].duration > list[i].startTime + 1e-3) { violations.push({ gate: 'light-overlap', id: key, t: list[i].startTime, text: `${key} overlaps` }); break; }
    }
  }
  return { pass: violations.length === 0, violations, counts: violations.reduce((m, v) => ({ ...m, [v.gate]: (m[v.gate] || 0) + 1 }), {}) };
}

/**
 * What every pump really delivers through the show (L/min per sample): its jets that are open
 * — by their solenoid's clips when the valve is driven, else by the jet's own level — times
 * each jet's flow (pumpFlow.jetFlowLpm); on a VFD pump the flow falls with the pump's speed
 * (its pump_speed clips, else the jet's level). Returns Map pumpId → { lpm, t, capLpm, overS, firstOverT }:
 * `lpm` is the highest flow held for at least `minRunS` (a valve hand-over is not a peak).
 */
export function pumpPeaks(clips, design, { T = null, dt = DT, levels = null, minRunS = 0.3, marginPct = DEFAULT_FLOW_MARGIN_PCT } = {}) {
  const out = new Map();
  const pumps = [...(design?.pumps?.values() || [])].filter((p) => p.nozzleIds.length);
  if (!pumps.length || !clips?.length) return out;
  const end = T ?? Math.min(600, Math.max(1, ...clips.map((c) => (Number(c.startTime) || 0) + (Number(c.duration) || 0))));
  const nozzleIds = new Set(pumps.flatMap((p) => p.nozzleIds));
  const lv = levels && [...nozzleIds].every((id) => levels.has(id)) ? levels : levelGrids(clips, nozzleIds, end, dt);
  const live = (c) => !c.muted && !c.disabled;
  const drivenValves = new Set(clips.filter((c) => c.type === 'solenoid_open' && live(c)).map((c) => c.fixtureId));
  const drivenPumps = new Set(clips.filter((c) => c.type === 'pump_speed' && live(c)).map((c) => c.fixtureId));
  const valveIds = new Set(pumps.flatMap((p) => p.nozzleIds.map((id) => design.nozzleById.get(id)?.valveId)).filter((id) => id && drivenValves.has(id)));
  const vg = valveIds.size ? levelGrids(clips, valveIds, end, dt, /^solenoid_open$/) : new Map();
  const pg = levelGrids(clips, new Set(pumps.map((p) => p.id).filter((id) => drivenPumps.has(id))), end, dt, /^pump_speed$/);
  const k = Math.max(1, Math.round(minRunS / dt));
  for (const p of pumps) {
    const vfd = isVfdPump(p.item), cap = pumpCapLpm(p.item, marginPct);
    const jets = p.nozzleIds.map((id) => ({ id, q: jetFlowLpm(design.nozzleById.get(id)?.item), valve: vg.get(design.nozzleById.get(id)?.valveId) || null }))
      .filter((j) => j.q > 0 && lv.has(j.id));
    if (!jets.length) continue;
    const N = lv.get(jets[0].id).length, speed = pg.get(p.id) || null;
    const q = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (const j of jets) {
        const level = lv.get(j.id)[i];
        if (!(j.valve ? j.valve[i] > 5 : level > 5)) continue;
        s += j.q * (vfd ? Math.min(1, Math.max(0, (speed ? speed[i] : level > 5 ? level : 100) / 100)) : 1); // no speed data: full flow
      }
      q[i] = s;
    }
    let best = 0, at = 0, overS = 0, firstOverT = null;
    for (let i = 0; i + k <= N; i++) {
      let m = Infinity;
      for (let j = i; j < i + k; j++) if (q[j] < m) m = q[j];
      if (m > best) { best = m; at = i * dt; }
    }
    if (cap) for (let i = 0; i < N; i++) if (q[i] > cap * 1.02) { overS += dt; if (firstOverT === null) firstOverT = r3(i * dt); }
    out.set(p.id, { lpm: Math.round(best * 10) / 10, t: r3(at), capLpm: cap, overS: r3(overS), firstOverT });
  }
  return out;
}

/**
 * Flow budget per pump (gate): the flow a pump is asked for, held ≥ 0.3 s, may not exceed its
 * rated flow × margin (+2 % for rounding of the drive's ramps). `clips` gives the real
 * hardware picture (valves, pump speed); without them the jets' levels are used.
 */
export function flowBudget(levels, design, { clips = null, marginPct = DEFAULT_FLOW_MARGIN_PCT, T = null } = {}) {
  const over = [];
  const levelClips = clips || null;
  const peaks = levelClips ? pumpPeaks(levelClips, design, { levels, T, marginPct }) : peaksFromLevels(levels, design, marginPct);
  for (const [pid, pk] of peaks) {
    if (!(pk.capLpm > 0) || !(pk.lpm > pk.capLpm * 1.02)) continue;
    const pump = design.pumps.get(pid);
    over.push({ gate: 'flow-budget', id: pid, t: pk.t, text: `${pump.name}: ${Math.round(pk.lpm)} of ${Math.round(pk.capLpm)} L/min` });
  }
  return over;
}

function peaksFromLevels(levels, design, marginPct) {
  const out = new Map();
  for (const [pid, pump] of design.pumps) {
    const cap = pumpCapLpm(pump.item, marginPct), vfd = isVfdPump(pump.item);
    const jets = pump.nozzleIds.filter((id) => levels.has(id));
    if (!cap || !jets.length) continue;
    const N = levels.get(jets[0]).length, k = 6;
    const q = new Float32Array(N);
    for (let i = 0; i < N; i++) for (const id of jets) {
      const v = levels.get(id)[i];
      if (v > 5) q[i] += jetFlowLpm(design.nozzleById.get(id).item) * (vfd ? Math.min(1, v / 100) : 1);
    }
    let best = 0, at = 0;
    for (let i = 0; i + k <= N; i++) { let m = Infinity; for (let j = i; j < i + k; j++) m = Math.min(m, q[j]); if (m > best) { best = m; at = i * DT; } }
    out.set(pid, { lpm: best, t: r3(at), capLpm: cap });
  }
  return out;
}

/** Look id of a recipe (famous look, preset, wave-field kind or effect). */
export const lookOf = (r) => r.pattern?.famous || r.pattern?.look || r.pattern?.preset || r.field?.kind || r.effect;

/**
 * @param {object} p { clips, items, analysis, studio?, design?, plan? }
 * @returns {{ version, score, pass, gates, metrics, detail }}
 */
export function measureShow({ clips, items, analysis: raw, studio = null, design = readFountainDesign(items), weights = SCORE_WEIGHTS, basin = null, windMs = 0, splashLimit = 0.05 }) {
  const analysis = songAnalysis(raw);
  const T = Math.min(600, analysis?.duration || Math.max(1, ...clips.map((c) => c.startTime + c.duration)));
  const nozzleIds = new Set(design.nozzles.map((n) => n.id));
  const levels = levelGrids(clips, nozzleIds, T);
  const N = Math.ceil(T / DT) + 1;
  const gates = showGates(clips, design);
  const flow = flowBudget(levels, design, { clips, T, marginPct: Number(studio?.site?.flowMarginPct) || DEFAULT_FLOW_MARGIN_PCT });
  if (flow.length) { gates.violations.push(...flow); gates.pass = false; gates.counts['flow-budget'] = flow.length; }
  // Splash: at the site's wind, no jet may throw more than `splashLimit` of its water out of the basin.
  if (basin?.length >= 3) {
    const splash = [];
    for (const n of design.nozzles) {
      const top = Math.max(0, ...levels.get(n.id)) / 100;
      if (!(top > 0.05) || !(n.heightM > 0)) continue;
      const e = n.item.engineering || {};
      const share = oversprayShare({ x: Number(n.item.x) || 0, y: Number(n.item.y) || 0, heightM: n.heightM, sprayAngleDeg: e.sprayAngleDeg, nozzleDiaMm: e.nozzleDiaMm }, basin, { windMs, scale: top });
      if (share > splashLimit + 0.01) splash.push({ gate: 'splash', id: n.id, t: 0, text: `${n.item.label || n.id}: ${Math.round(100 * share)} % of its water lands outside the basin at ${windMs} m/s` });
    }
    if (splash.length) { gates.violations.push(...splash); gates.pass = false; gates.counts.splash = splash.length; }
  }

  // Visible water mass per instant: Σ level × design height, normalised by the fountain's total.
  const totalH = design.nozzles.reduce((s, n) => s + (n.heightM || 1), 0) || 1;
  const mass = new Float32Array(N);
  for (const n of design.nozzles) {
    const g = levels.get(n.id), h = n.heightM || 1;
    const lag = Math.round(visibleLead(h) / DT);
    for (let i = 0; i < N; i++) mass[i] += (g[Math.max(0, i - lag)] / 100) * h;
  }
  for (let i = 0; i < N; i++) mass[i] /= totalH;
  const massBetween = (a, b) => { const i0 = Math.max(0, Math.floor(a / DT)), i1 = Math.min(N, Math.ceil(b / DT)); let s = 0; for (let i = i0; i < i1; i++) s += mass[i]; return i1 > i0 ? s / (i1 - i0) : 0; };

  // 1. Event alignment: apexes of each area's water (command peak + rise time) near a beat / onset.
  const beats = [...(analysis?.beats || []), ...(analysis?.downbeats || [])].sort((a, b) => a - b);
  const nearest = (t) => { let lo = 0, hi = beats.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (beats[m] < t) lo = m + 1; else hi = m; } return Math.min(Math.abs(beats[lo] - t), lo ? Math.abs(beats[lo - 1] - t) : Infinity); };
  const events = [];
  for (const a of design.areas) {
    const lag = visibleLead(a.heightM);
    const series = new Float32Array(N);
    for (const id of a.nozzleIds) { const g = levels.get(id); for (let i = 0; i < N; i++) series[i] += g[i] / a.nozzleIds.length; }
    // A visible event: the area's water starts a rise of ≥ 15 points within 0.3 s (a jet
    // shooting up, a wave front). The audience sees its top one rise time later.
    let armed = true;
    for (let i = 1; i < N - 6; i++) {
      const rise = series[i + 6] - series[i - 1];
      if (armed && rise >= 15 && series[i] > series[i - 1]) { events.push(i * DT + lag); armed = false; }
      else if (!armed && series[i] <= series[i - 1]) armed = true;
    }
  }
  const sigma = 0.08;
  const eventAlignment = beats.length && events.length ? mean(events.map((t) => Math.exp(-(nearest(t) ** 2) / (2 * sigma * sigma)))) : 0;

  // 2. Energy tracking: per-bar loudness vs visible water mass.
  const barSec = (60 / (analysis?.bpm || 120)) * (analysis?.beatsPerBar || 4);
  const e = analysis?.energy;
  const loud = [], water = [];
  for (let t = 0; t + barSec <= T; t += barSec) {
    if (!e?.values?.length) break;
    const i0 = Math.floor(t * e.rate), i1 = Math.min(e.values.length, Math.ceil((t + barSec) * e.rate));
    loud.push(mean(e.values.slice(i0, i1)));
    water.push(massBetween(t, t + barSec));
  }
  const energyTracking = clamp01(pearson(loud, water));

  // Sections with their loudness rank.
  // The same sections the planner uses (long ones split; energy from the loudness curve).
  const sections = analysis?.energy?.values?.length ? arcSections(analysis) : [{ start: 0, end: T, label: 'verse', energy: 0.5 }];
  const secE = sections.map((s) => s.energy);
  const climaxI = climaxIndex(secE);
  const secMass = sections.map((s) => massBetween(s.start, s.end));

  // 3. Arc fidelity: climax has the most water; a dip before it; the ending ≥ 80 % of it (or a fade-out).
  let arc = 0, arcParts = {};
  if (sections.length >= 2) {
    const top = secMass[climaxI];
    arcParts.climaxHighest = secMass.every((m, i) => i === climaxI || m <= top * 1.02);
    const c = sections[climaxI];
    const dip = c.start > barSec ? massBetween(c.start - barSec, c.start) : top;
    arcParts.dipBefore = dip <= 0.75 * top;
    const last = secMass.at(-1);
    arcParts.strongEnd = last >= 0.8 * top || sections.at(-1).label === 'outro';
    const ranked = [...secE].map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    const order = [...secMass].map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    let agree = 0;
    for (let i = 0; i < ranked.length; i++) for (let j = i + 1; j < ranked.length; j++) if (order.indexOf(ranked[i]) < order.indexOf(ranked[j])) agree++;
    arcParts.rankAgreement = ranked.length > 1 ? agree / (ranked.length * (ranked.length - 1) / 2) : 1;
    arc = 0.35 * arcParts.climaxHighest + 0.2 * arcParts.dipBefore + 0.15 * arcParts.strongEnd + 0.3 * arcParts.rankAgreement;
  }

  // 4. Coverage: share of time each area has water, overall and in the climax.
  const areaActive = design.areas.map((a) => {
    const on = (i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) { let k = 0; for (const id of a.nozzleIds) if (levels.get(id)[i] > 5) k++; s += k / a.nozzleIds.length; } return i1 > i0 ? s / (i1 - i0) : 0; };
    const c = sections[climaxI];
    return { id: a.id, name: a.name, control: a.control, all: on(0, N), climax: c ? on(Math.floor(c.start / DT), Math.ceil(c.end / DT)) : 0 };
  });
  const switched = areaActive.filter((a) => a.control === 'switch');
  const coverage = clamp01(0.5 * mean(areaActive.map((a) => a.all)) / 0.6 + 0.5 * mean(areaActive.map((a) => a.climax)) / 0.8);

  // 5–7. Looks from the studio recipes: structure consistency, diversity, hero discipline.
  const made = (studio?.recipes || []).filter((r) => !['lights', 'motion'].includes(r.pattern?.role) && !r.muted && (r.pattern?.music || r.pattern?.plan));
  const looks = made.map((r) => ({ look: lookOf(r), t: r.start, label: r.pattern?.section || '' })).sort((a, b) => a.t - b.t);
  const lookSet = (s) => new Set(looks.filter((l) => l.t >= s.start - 4 && l.t < s.end).map((l) => l.look));
  const jac = (A, B) => { const u = new Set([...A, ...B]); if (!u.size) return 1; let i = 0; for (const x of A) if (B.has(x)) i++; return i / u.size; };
  let same = [], diff = [];
  for (let i = 0; i < sections.length; i++) for (let j = i + 1; j < sections.length; j++) {
    const v = jac(lookSet(sections[i]), lookSet(sections[j]));
    (sections[i].label === sections[j].label ? same : diff).push(v);
  }
  const structureConsistency = same.length && diff.length ? clamp01(0.5 + mean(same) - mean(diff)) : 0.5;
  const distinct = new Set(looks.map((l) => l.look)).size;
  const counts = {};
  looks.forEach((l) => { counts[l.look] = (counts[l.look] || 0) + 1; });
  const H = -Object.values(counts).reduce((s, c) => s + (c / looks.length) * Math.log2(c / looks.length), 0);
  const bigrams = looks.slice(1).map((l, i) => `${looks[i].look}>${l.look}`);
  const repeatRate = bigrams.length ? 1 - new Set(bigrams).size / bigrams.length : 0;
  const diversity = looks.length ? clamp01(0.4 * clamp01(distinct >= 4 && distinct <= 12 ? 1 : distinct / 4) + 0.3 * clamp01(H / 3) + 0.3 * (1 - repeatRate)) : 0;
  const heroes = looks.filter((l) => HERO_LOOKS.has(l.look));
  const c = sections[climaxI];
  const heroInClimax = heroes.filter((h) => c && h.t >= c.start - 8 && h.t < c.end + 2).length;
  const heroPerMin = heroes.length / (T / 60);
  const heroDiscipline = heroes.length ? clamp01((heroInClimax / heroes.length) * (heroPerMin <= 2 ? 1 : 2 / heroPerMin)) : 0.6;

  // 8. Peak usage: share of climax time with the active jets at ≥ 70 % of the height they are
  //    allowed (their own top in this show — wind and splash may cap it below design height).
  let peakUsage = 0;
  if (c) {
    const topOf = new Map([...nozzleIds].map((id) => [id, Math.max(1, ...levels.get(id))]));
    let hit = 0, n = 0;
    for (let i = Math.floor(c.start / DT); i < Math.min(N, Math.ceil(c.end / DT)); i++) {
      const on = []; for (const id of nozzleIds) { const v = levels.get(id)[i]; if (v > 5) on.push(v / topOf.get(id)); }
      if (on.length) { n++; if (mean(on) >= 0.7) hit++; }
    }
    peakUsage = n ? hit / n : 0;
  }

  const metrics = { eventAlignment, energyTracking, arcFidelity: arc, coverage, structureConsistency, diversity, heroDiscipline, peakUsage };
  for (const k of Object.keys(metrics)) metrics[k] = r3(metrics[k]);
  const score = Math.round(100 * Object.entries(weights).reduce((s, [k, w]) => s + w * (metrics[k] || 0), 0) * 10) / 10;
  return {
    version: METRICS_VERSION, score, pass: gates.pass, gates, metrics,
    detail: {
      events: events.length, distinctLooks: distinct, looks: looks.length, heroes: heroes.length, repeatRate: r3(repeatRate),
      arc: arcParts, climax: c ? { start: c.start, end: c.end, label: c.label } : null,
      areas: areaActive.map((a) => ({ ...a, all: r3(a.all), climax: r3(a.climax) })),
      switchedActive: r3(mean(switched.map((a) => a.all))), switchedActiveClimax: r3(mean(switched.map((a) => a.climax))),
      sectionMass: secMass.map(r3),
    },
  };
}
