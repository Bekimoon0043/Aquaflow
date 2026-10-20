// Show generators the evaluation harness can compare. Each takes one site and one song and
// returns the studio it made. Pure (no React).

import { compileStudio, inventory, readStudio } from './showModel';
import { builderGroups } from './patternPresets';
import { designGroups, readFountainDesign } from './fountainDesign';
import { designRows, patternsFromMusic } from './musicPatterns';
import { measureShow } from './showMetrics';

/** Everything a generator needs about one site. */
export function siteContext(fixtures, studio = readStudio({})) {
  const items = inventory(fixtures);
  const design = readFountainDesign(items);
  const groups = [...designGroups(design), ...builderGroups(studio, items)];
  return { fixtures, items, design, groups, studio };
}

export const GENERATORS = {
  /** 1.2.52: design rows + rule table + famous looks every other phrase. */
  'rules-1.2.52': ({ site, song }) => patternsFromMusic(site.studio, {
    analysis: song.analysis, stems: song.stems, rows: designRows(site.design, song.stems), items: site.items, groups: site.groups, design: site.design,
  }).studio,
};

/** Generate, compile and measure one show. */
export function runCase(generator, site, song, extra = {}) {
  const t0 = Date.now();
  const studio = GENERATORS[generator]({ site, song, ...extra });
  const genMs = Date.now() - t0;
  const { clips, issues } = compileStudio(studio, site.items);
  const result = measureShow({ clips, items: site.items, analysis: song.analysis, studio, design: site.design });
  return { ...result, issues, clips: clips.length, genMs, studio };
}
