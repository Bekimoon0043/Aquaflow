// Phrase search — level 2 of the generator. For every area that plays ("voice"), choose one
// look per phrase from the look library by minimising a cost (beam search over paths, the
// ChoreoMaster approach): music fit, arc tracking, coverage, repetition, structure
// consistency, hero discipline and layering contrast. Seeded noise gives Variant A / B / C;
// locked phrases are kept. Pure.

import { LOOKS, SPEED_RANK, lookById } from './lookLibrary';
import { partFamily } from './famousPatterns';
import { phraseFeatures } from './musicPatterns';
import { sourceById } from './stemProgram';
import { rng } from './arcPlanner';

const r3 = (v) => Math.round(v * 1000) / 1000;
export const BEAM = 48;
export const COST_WEIGHTS = { energy: 2, part: 0.8, speed: 0.8, coverage: 3, repeatPrev: 0.6, repeatRecent: 0.3, structure: 0.7, hero: 0.5, layering: 0.25, noise: 0.35 };

/** Phrases of one section: 8 bars in builds / high / climax, 16 elsewhere (a look change every ~30–60 s). */
export function sectionPhrases(section, barSec) {
  const bars = ['build', 'high', 'climax'].includes(section.role) ? 8 : 16;
  const len = bars * barSec, out = [];
  let t = section.start;
  while (section.end - t > 0.5) {
    const e = section.end - (t + len) < 0.5 * len ? section.end : t + len;
    out.push({ start: r3(t), end: r3(e), bars: Math.round((e - t) / barSec) });
    t = e;
  }
  return out;
}

function candidates(area, part, { heroLeft, finale }) {
  const fam = partFamily(sourceById(part));
  return LOOKS.filter((l) => {
    if (!l.controls.includes(area.control) || area.size < (l.minJets || 1)) return false;
    if (area.control === 'pump' && !['breathing', 'grand-swell'].includes(l.id)) return false;
    if (l.hero && !(heroLeft > 0 || (finale && l.id === 'grand-finale'))) return false;
    if (l.id === 'grand-finale' && !finale) return false;
    return l.parts.includes(fam) || l.id === 'breathing';
  });
}

/**
 * Fill plan.sections[].phrases. `locks`: { "<sectionId>:<phraseIndex>:<areaId>": lookId }.
 * @returns plan (new object)
 */
export function searchPhrases(plan, { analysis, stems = [], scm, variant = 0, locks = {}, weights = COST_WEIGHTS }) {
  const W = { ...COST_WEIGHTS, ...weights };
  const barSec = plan.analysis.barSec, beatSec = barSec / (plan.analysis.beatsPerBar || 4);
  const byRole = new Map(stems.map((s) => [s.role, s.analysis]));
  const areaById = new Map(scm.areas.map((a) => [a.id, a]));
  const rand = rng(1000 + plan.seed * 7 + variant * 131);
  const sections = plan.sections.map((s) => ({ ...s, phrases: sectionPhrases(s, barSec).map((p) => ({ ...p, voices: [] })) }));
  // Voices: areas that play somewhere; a right-hand mirror area copies its left partner (flipped).
  const playing = [...new Set(sections.flatMap((s) => s.active))];
  const followers = new Map();
  for (const id of playing) { const a = areaById.get(id); if (a?.mirrorArea && a.position === 'right' && playing.includes(a.mirrorArea)) followers.set(id, a.mirrorArea); }
  const voices = playing.filter((id) => !followers.has(id)).map((id) => areaById.get(id)).filter(Boolean)
    .sort((a, b) => (b.hero ? 1 : 0) - (a.hero ? 1 : 0) || b.size - a.size);
  const heroLeft = new Map(sections.map((s) => [s.id, s.hero?.budget || 0]));
  const used = new Map();      // `${si}:${pi}` → looks already chosen there by earlier voices
  const flat = sections.flatMap((s, si) => s.phrases.map((p, pi) => ({ s, si, p, pi })));

  for (const area of voices) {
    let beam = [{ looks: [], cost: 0 }];
    for (const { s, si, p, pi } of flat) {
      const part = s.casting[area.id] || plan.casting[area.id];
      if (!s.active.includes(area.id) || !part) { beam = beam.map((b) => ({ ...b, looks: [...b.looks, null] })); continue; }
      const stem = byRole.get(sourceById(part)?.stem);
      const fam = partFamily(sourceById(part));
      const k = s.phrases.length > 1 ? pi / (s.phrases.length - 1) : 1;
      const energyT = s.targets.energyTo != null ? s.targets.energy + (s.targets.energyTo - s.targets.energy) * k : s.targets.energy;
      const coverT = s.targets.coverageTo != null ? s.targets.coverage + (s.targets.coverageTo - s.targets.coverage) * k : s.targets.coverage;
      // No stems: hits follow the song's onsets as one beat-level pulse, melody counts as sung.
      const f = stem ? phraseFeatures(stem, sourceById(part), p.start, p.end, beatSec) : { hitsPerBeat: 0.5 + 0.8 * energyT, voiced: 0.6, energy: energyT };
      const density = fam === 'hits' || fam === 'hats' ? Math.min(1, f.hitsPerBeat / 1.5) : fam === 'melody' ? (f.voiced > 0.25 ? 0.5 : 0) : 0.3;
      const finale = s.finale && pi === s.phrases.length - 1;
      const lockKey = `${s.id}:${pi}:${area.id}`;
      let cands = locks[lockKey] ? [lookById(locks[lockKey])].filter(Boolean) : candidates(area, part, { heroLeft: heroLeft.get(s.id), finale });
      if (!cands.length) cands = [lookById('breathing')];
      const original = s.repeatOf ? sections.find((x) => x.id === s.repeatOf) : null;
      const echo = original?.phrases[pi]?.voices.find((v) => v.areaId === area.id)?.look;
      const others = used.get(`${si}:${pi}`) || [];
      const base = cands.map((l) => {
        let c = W.energy * Math.abs(l.energy - energyT) + (l.parts.includes(fam) ? 0 : W.part) + W.speed * Math.abs(SPEED_RANK[l.speed] - density);
        if (area.control === 'switch') c += W.coverage * Math.abs(l.duty - coverT);
        if (echo) c += l.id === echo ? -W.structure : 0;
        if (l.hero) c -= W.hero;
        if (others.includes(l.id)) c += W.layering;
        if (variant) c += W.noise * -Math.log(-Math.log(Math.max(1e-9, rand())));   // Gumbel noise per variant
        return { l, c };
      });
      const next = [];
      for (const b of beam) {
        const prev = b.looks.filter(Boolean);
        for (const { l, c } of base) {
          let t = c;
          if (prev.at(-1) === l.id) t += W.repeatPrev;
          t += W.repeatRecent * prev.slice(-3).filter((x) => x === l.id).length;
          next.push({ looks: [...b.looks, l.id], cost: b.cost + t });
        }
      }
      next.sort((a, b) => a.cost - b.cost);
      beam = next.slice(0, BEAM);
    }
    const best = beam[0];
    flat.forEach(({ s, si, p, pi }, k) => {
      const look = best.looks[k];
      if (!look) return;
      const part = s.casting[area.id] || plan.casting[area.id];
      p.voices.push({ areaId: area.id, part, look, locked: !!locks[`${s.id}:${pi}:${area.id}`] });
      used.set(`${si}:${pi}`, [...(used.get(`${si}:${pi}`) || []), look]);
      if (lookById(look)?.hero) heroLeft.set(s.id, Math.max(0, heroLeft.get(s.id) - 1));
      for (const [fid, leader] of followers) if (leader === area.id && s.active.includes(fid)) p.voices.push({ areaId: fid, part, look, mirrorOf: area.id, locked: false });
    });
  }
  return { ...plan, variant, sections };
}
