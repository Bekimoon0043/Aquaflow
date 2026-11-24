// What the Pattern Preview plays for the pattern selected in Show Studio.
// Pure functions: the studio document is never mutated.
import { compileStudio, resolveMembers } from '../../programmer/studio/showModel';

/** The recipes that make up the selected pattern: a builder unit (water + lights) or the recipe alone. */
export function patternRecipes(studio, id) {
  const recipe = studio?.recipes?.find(r => r.id === id);
  if (!recipe) return [];
  const unit = recipe.pattern?.id;
  return unit ? studio.recipes.filter(r => r.pattern?.id === unit) : [recipe];
}

const groupLabel = (names) => names.length ? `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''}` : 'No group';

/**
 * Build the preview subject for a selected timeline item (recipe or legacy clip):
 * { id, name, owner, memberIds, clips, origin, duration }, or null when it does not exist.
 * `groups` is a Map of every group the studio can reference (auto + custom).
 */
export function patternSubject(studio, items, id, groups = new Map()) {
  if (!id || !studio) return null;
  const recipes = patternRecipes(studio, id);
  if (recipes.length) {
    const selected = recipes.find(r => r.id === id);
    const lookup = new Map([...groups, ...(studio.groups || []).map(g => [g.id, g])]);
    // compileStudio only needs the groups that the subject's recipes reference.
    const used = [...new Set(recipes.map(r => r.groupId))].map(g => lookup.get(g)).filter(Boolean);
    const compileGroups = [...(studio.groups || []), ...used.filter(g => !(studio.groups || []).some(x => x.id === g.id))];
    const clips = compileStudio({ ...studio, groups: compileGroups, recipes, legacyClips: [] }, items).clips;
    const memberIds = [...new Set(recipes.flatMap(r => r.frozenIds || (lookup.get(r.groupId) ? resolveMembers(lookup.get(r.groupId), items) : [])))];
    const origin = Math.min(...recipes.map(r => Number(r.start) || 0));
    const end = Math.max(...recipes.map(r => (Number(r.start) || 0) + (Number(r.duration) || 0)), ...clips.map(c => c.startTime + c.duration));
    const owner = groupLabel([...new Set(recipes.map(r => lookup.get(r.groupId)?.name).filter(Boolean))]);
    return { id, kind: 'recipe', name: selected.pattern?.name || selected.name || 'Pattern', owner, memberIds, clips, origin, duration: Math.max(.1, end - origin) };
  }
  const legacy = studio.legacyClips?.find(c => c.id === id);
  if (!legacy) return null;
  const item = items.find(i => i.id === legacy.fixtureId);
  return { id, kind: 'clip', name: legacy.name || 'Clip', owner: item?.label || legacy.fixtureId || 'Item', memberIds: legacy.fixtureId ? [legacy.fixtureId] : [],
    clips: [legacy], origin: Number(legacy.startTime) || 0, duration: Math.max(.1, Number(legacy.duration) || 0) };
}

/** A stable signature of everything that changes what a subject plays (used to skip identical updates). */
export function subjectSignature(subject) {
  if (!subject) return '';
  return JSON.stringify([subject.id, subject.name, subject.owner, subject.memberIds, subject.origin, subject.duration, subject.clips]);
}

/**
 * Wrap a running clock into a looping window [0, duration). Also used after an edit:
 * playback continues from the same moment when it still exists, else wraps into the new length.
 */
export function loopTime(clock, duration) {
  if (!(duration > 0) || !Number.isFinite(clock) || clock < 0) return 0;
  return clock >= duration ? clock % duration : clock;
}
