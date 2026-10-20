// Merge the engine's deep music analysis into the song analysis. Pure.

/**
 * The song analysis with the deep result merged in: sections with repeat groups (labels =
 * groups, so repeats link up), the K-weighted energy curve, drops, build-ups, mood and vocal
 * phrases. Beats, downbeats and tempo stay the browser's (one shared grid).
 */
export function mergeDeep(analysis, deep) {
  if (!analysis || !deep?.sections?.length) return analysis;
  return {
    ...analysis,
    sections: deep.sections.map((s) => ({ start: s.start, end: s.end, label: s.group, group: s.group, bars: s.bars })),
    energy: deep.energy?.values?.length ? deep.energy : analysis.energy,
    drops: deep.drops || [], builds: deep.builds || [], mood: deep.mood || null, vocalPhrases: deep.vocalPhrases || [],
    loudness: deep.loudness || null, deepVersion: deep.version, source: analysis.source,
  };
}

/** The analysis the generator should use: deep results when the song has them. */
export const songAnalysis = (analysis) => (analysis?.deep ? mergeDeep(analysis, analysis.deep) : analysis);
