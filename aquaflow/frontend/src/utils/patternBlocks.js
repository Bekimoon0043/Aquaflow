import { nanoid } from "nanoid";
import { ARRAY_PATTERN_LIBRARY, createArrayPatternPlan } from "./arrayPatternEngine";

const round = n => Math.round(n * 1000) / 1000;
const number = (value, label, min = 0) => {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min) throw new Error(`${label} must be at least ${min}.`);
  return round(result);
};
export function patternBlockId(clip) {
  if (clip.patternBlockId) return clip.patternBlockId;
  // Old exported arrays retain their generation stamp. Group without changing any timing.
  const stamp = clip.source === "array-pattern" && String(clip.id).match(/^array-(\d+)-/);
  return stamp ? `legacy-array-${stamp[1]}` : null;
}
export function getPatternBlocks(clips = []) {
  const groups = new Map();
  clips.forEach(clip => {
    const id = patternBlockId(clip);
    if (!id) return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(clip);
  });
  return [...groups].map(([id, members]) => {
    const definition = members.find(c => c.patternBlockDefinition)?.patternBlockDefinition;
    const start = Math.min(...members.map(c => Number(c.startTime)), definition?.startTime ?? Infinity);
    const end = Math.max(...members.map(c => Number(c.startTime) + Number(c.duration)),
      ...members.map(c => Number(c.arrayPattern?.sequenceEndTime || 0)), definition ? definition.startTime + definition.duration : 0);
    const label = ARRAY_PATTERN_LIBRARY.find(p => p.id === members[0].arrayPattern?.patternId)?.label || "Custom pattern";
    return { id, name: definition?.name || label, startTime: round(start), duration: round(end - start),
      endTime: round(end), recipe: definition?.recipe || null, customized: !!definition?.customized,
      clipCount: members.length, outletCount: new Set(members.map(c => c.fixtureId)).size, members };
  }).sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
}
const getBlock = (clips, id) => {
  const block = getPatternBlocks(clips).find(b => b.id === id);
  if (!block) throw new Error("This pattern block no longer exists.");
  return block;
};
function attach(members, definition) {
  return members.map((clip, index) => {
    const copy = { ...clip, patternBlockId: definition.id };
    delete copy.patternBlockDefinition;
    if (index === 0) copy.patternBlockDefinition = structuredClone(definition);
    if (copy.arrayPattern) copy.arrayPattern = { ...copy.arrayPattern, sequenceEndTime: round(definition.startTime + definition.duration) };
    return copy;
  });
}
function replace(clips, id, members) {
  return [...clips.filter(c => patternBlockId(c) !== id), ...members].sort((a, b) => a.startTime - b.startTime);
}
export function createPatternBlock(plan, { id = `block-${nanoid(12)}`, name } = {}) {
  if (!plan.clips?.length) throw new Error("A block needs at least one outlet clip.");
  const startTime = Number(plan.recipe?.startTime ?? plan.startTime ?? Math.min(...plan.clips.map(c => c.startTime)));
  const definition = { version: 1, id, name: name || ARRAY_PATTERN_LIBRARY.find(p => p.id === plan.recipe?.patternId)?.label || "Custom pattern",
    startTime, duration: plan.duration, recipe: plan.recipe ? structuredClone(plan.recipe) : null, customized: false };
  return attach(plan.clips.map(c => ({ ...c, id: `clip-${nanoid(14)}` })), definition);
}
export function transformPatternBlock(clips, id, changes = {}) {
  const block = getBlock(clips, id);
  const startTime = number(changes.startTime ?? block.startTime, "Start time");
  const duration = number(changes.duration ?? block.duration, "Duration", 0.1);
  if (startTime + duration > 600) throw new Error("A site pattern block must end within 10 minutes.");
  const scale = duration / block.duration;
  const recipe = block.recipe ? { ...block.recipe, startTime, stepDuration: round(block.recipe.stepDuration * scale),
    pulseDuration: round(block.recipe.pulseDuration * scale), repeatGap: round(block.recipe.repeatGap * scale) } : null;
  if (recipe && [recipe.stepDuration, recipe.pulseDuration].some(n => n < 0.05 || n > 60)) throw new Error("Resizing must keep array step and pulse timing within 0.05–60 seconds.");
  const members = block.members.map(c => ({ ...c, startTime: round(startTime + (c.startTime - block.startTime) * scale),
    duration: round(c.duration * scale), fadeIn: round((c.fadeIn || 0) * scale), fadeOut: round((c.fadeOut || 0) * scale),
    effects: (c.effects || []).map(e => ({ ...e, startTime: round((e.startTime || 0) * scale), duration: round(e.duration * scale) })) }));
  if (members.some(c => c.duration <= 0)) throw new Error("Resizing would remove an outlet pulse. Increase the duration.");
  const name = String(changes.name ?? block.name).trim();
  if (!name || name.length > 80) throw new Error("Block names must contain 1–80 characters.");
  return replace(clips, id, attach(members, { version: 1, id, name, startTime, duration, recipe, customized: block.customized }));
}
export function repeatPatternBlock(clips, id, repeats, fixtures, tracks) {
  const block = getBlock(clips, id);
  if (!block.recipe || block.customized) throw new Error("This block has individual edits. Duplicate it to repeat those edits, or edit its movement to regenerate the array.");
  const count = Number(repeats);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Cycles must be a whole number from 1 to 100.");
  return regeneratePatternBlock(clips, id, { ...block.recipe, repeats: count }, fixtures, tracks);
}
export function regeneratePatternBlock(clips, id, recipe, fixtures, tracks) {
  const block = getBlock(clips, id);
  const available = new Set(fixtures.map(f => f.id));
  if (recipe.selectedFixtureIds?.some(fid => !available.has(fid))) throw new Error("Some saved outlets are missing from this engineering project. Restore them or explicitly choose a new selection.");
  const plan = createArrayPatternPlan({ ...recipe, fixtures, tracks });
  if (!plan.clips.length || plan.missingTrackFixtureIds.length) throw new Error("Every selected outlet needs a programmable track.");
  if (plan.endTime > 600) throw new Error("The repeated block must end within 10 minutes.");
  const result = replace(clips, id, createPatternBlock(plan, { id, name: block.name }));
  if (result.length > 20000) throw new Error("The show would exceed 20,000 clips. Reduce cycles or split the show.");
  return result;
}
export function copyPatternBlock(clips, id, startTime, name) {
  const block = getBlock(clips, id);
  const duplicateId = `block-${nanoid(12)}`;
  const members = attach(block.members.map(c => ({ ...structuredClone(c), id: `clip-${nanoid(14)}` })),
    { version: 1, id: duplicateId, name: name ?? `${block.name.slice(0, 73)} (copy)`, startTime: block.startTime, duration: block.duration, recipe: block.recipe, customized: block.customized });
  return { id: duplicateId, clips: transformPatternBlock(members, duplicateId, { startTime: startTime ?? block.endTime }) };
}
export function duplicatePatternBlock(clips, id, startTime) {
  const block = getBlock(clips, id);
  if (clips.length + block.members.length > 20000) throw new Error("The show would exceed 20,000 clips.");
  const copy = copyPatternBlock(clips, id, startTime);
  return { id: copy.id, clips: [...clips, ...copy.clips].sort((a, b) => a.startTime - b.startTime) };
}
export const deletePatternBlock = (clips, id) => clips.filter(c => patternBlockId(c) !== id);
export function filterPatternClips(clips, predicate) {
  let result = clips.filter(predicate);
  const retained = new Set(result.map(c => c.id));
  getPatternBlocks(clips).forEach(block => {
    const members = block.members.filter(c => retained.has(c.id));
    if (members.length && members.length !== block.members.length) result = replace(result, block.id, attach(members,
      { version: 1, id: block.id, name: block.name, startTime: block.startTime, duration: block.duration, recipe: null, customized: true }));
  });
  return result;
}
export function unpackPatternBlock(clips, id) {
  return clips.map(c => {
    if (patternBlockId(c) !== id) return c;
    const copy = { ...c, source: "pattern-block-detail" };
    delete copy.patternBlockId; delete copy.patternBlockDefinition;
    return copy;
  });
}
export function editPatternClip(clips, clipId, patch, remove = false) {
  const original = clips.find(c => c.id === clipId);
  if (!original) return clips;
  const id = patternBlockId(original), block = id && getBlock(clips, id);
  let result = remove ? clips.filter(c => c.id !== clipId) : clips.map(c => c.id === clipId
    ? { ...c, ...patch, effects: (patch.effects ?? c.effects ?? []).map(e => e.type === "basic" ? { ...e,
      duration: patch.duration ?? e.duration, params: { ...e.params, value: patch.value ?? e.params?.value } } : e) } : c);
  if (block) {
    const remaining = result.filter(c => patternBlockId(c) === id);
    if (remaining.length) {
      const startTime = Math.min(block.startTime, ...remaining.map(c => c.startTime));
      const endTime = Math.max(block.endTime, ...remaining.map(c => c.startTime + c.duration));
      result = replace(result, id, attach(remaining, { version: 1, id, name: block.name, startTime,
        duration: round(endTime - startTime), recipe: null, customized: true }));
    }
  }
  return result;
}
export function standaloneClip(clip, startTime) {
  const copy = { ...structuredClone(clip), id: `clip-${nanoid(14)}`, startTime, source: "pattern-block-detail" };
  delete copy.patternBlockId; delete copy.patternBlockDefinition; delete copy.arrayPattern;
  return copy;
}
