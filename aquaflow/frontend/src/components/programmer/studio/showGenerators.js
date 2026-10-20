// Show generators the evaluation harness can compare. Each takes one site and one song and
// returns the studio it made. Pure (no React).

import { compileStudio, inventory, readStudio } from './showModel';
import { builderGroups } from './patternPresets';
import { designGroups, readFountainDesign } from './fountainDesign';
import { designRows, patternsFromMusic } from './musicPatterns';
import { measureShow } from './showMetrics';
import { createShow } from './autoShow';

/** Everything a generator needs about one site. */
export function siteContext(fixtures, studio = readStudio({}), { basin = null, windMs = 0 } = {}) {
  const items = inventory(fixtures);
  const design = readFountainDesign(items);
  const groups = [...designGroups(design), ...builderGroups(studio, items)];
  return { fixtures, items, design, groups, studio: basin || windMs ? { ...studio, site: { ...(studio.site || {}), basin, windMs } } : studio, basin, windMs };
}

/** The basin outline of an Engineering project ([[x, y]]), or null. */
export const basinOf = (engineering) => {
  const b = engineering?.basins?.[0]?.outer || engineering?.geometry?.points;
  return Array.isArray(b) && b.length >= 3 ? b.map((p) => [Number(p.x), Number(p.y)]) : null;
};

export const GENERATORS = {
  /** 1.2.52: design rows + rule table + famous looks every other phrase. */
  'rules-1.2.52': ({ site, song }) => patternsFromMusic(site.studio, {
    analysis: song.analysis, stems: song.stems, rows: designRows(site.design, song.stems), items: site.items, groups: site.groups, design: site.design,
  }).studio,
  /** Phases 1–2: site model → show-arc plan → phrase search → render. */
  'plan-v1': ({ site, song, seed = 0, variant = 0 }) => createShow(site.studio, {
    analysis: song.analysis, stems: song.stems, items: site.items, groups: site.groups, design: site.design, seed, variant,
    meter: song.meter === 6 ? { beatsPerBar: 6, pulse: 'dotted' } : undefined,
  }).studio,
};

/** Generate, compile and measure one show. */
export function runCase(generator, site, song, extra = {}) {
  const t0 = Date.now();
  const studio = GENERATORS[generator]({ site, song, ...extra });
  const genMs = Date.now() - t0;
  const { clips, issues } = compileStudio(studio, site.items);
  const result = measureShow({ clips, items: site.items, analysis: song.analysis, studio, design: site.design, basin: site.basin, windMs: site.windMs });
  return { ...result, issues, clips: clips.length, genMs, studio };
}
