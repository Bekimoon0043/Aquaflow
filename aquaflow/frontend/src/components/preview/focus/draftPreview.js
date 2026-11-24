import { compileStudio } from '../../programmer/studio/showModel';
import { buildPatternUnit } from '../../programmer/studio/patternPresets';

export function buildDraftClips(studio, options, items) {
  const temporary = { ...studio, recipes: [], legacyClips: [] };
  const result = buildPatternUnit(temporary, { ...options, options: { ...options.options, start: 0 }, items, unitId: null, replaceIds: [] });
  return compileStudio(result.studio, items).clips;
}

/**
 * Shift clips to local time (0 = the pattern's start) without mutating them.
 * `span.origin` / `span.duration` pin the loop to a pattern's own start and length;
 * without them the earliest clip start and the last clip end are used.
 */
export function localizeClips(clips = [], span = {}) {
  const pinned = Number.isFinite(span.origin);
  if (!clips.length) return { clips: [], duration: Math.max(1, Number(span.duration) || 1) };
  const origin = pinned ? span.origin : Math.min(...clips.map(c => Number(c.startTime) || 0));
  const local = clips.map(c => ({ ...c, startTime: (Number(c.startTime) || 0) - origin }));
  const end = Math.max(...local.map(c => c.startTime + (Number(c.duration) || 0)));
  return { clips: local, duration: Math.max(pinned ? .1 : 1, Number(span.duration) || 0, end) };
}
