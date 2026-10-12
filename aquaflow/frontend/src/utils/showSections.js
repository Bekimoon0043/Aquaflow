import { nanoid } from "nanoid";
import { getPatternBlocks, patternBlockId, transformPatternBlock, copyPatternBlock } from "./patternBlocks";

export const SECTION_LIBRARY_KEY = "aquaflow_show_sections_v1";
export const MAX_SECTION_FILE_SIZE = 2 * 1024 * 1024;
const round = n => Math.round(n * 1000) / 1000;
const finite = (value, label, min = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) throw new Error(`${label} must be at least ${min}.`);
  return round(n);
};
function selectedBlocks(clips, ids) {
  const selection = new Set(ids);
  const blocks = getPatternBlocks(clips).filter(b => selection.has(b.id));
  if (!blocks.length) throw new Error("Select at least one pattern block using its checkbox.");
  if (blocks.length !== selection.size) throw new Error("Some selected blocks no longer exist. Select the blocks again.");
  return blocks;
}

// Operates on the same flat clips used by preview, export and site conversion.
export function arrangeShowBlocks(clips, ids, { mode = "sequence", startTime = 0, gap = 0 } = {}) {
  const blocks = selectedBlocks(clips, ids);
  if (!["sequence", "layer", "move"].includes(mode)) throw new Error("Choose sequence, layer or move.");
  let cursor = finite(startTime, "Section start");
  const space = finite(gap, "Block gap");
  const earliest = Math.min(...blocks.map(b => b.startTime));
  let result = clips;
  blocks.forEach(block => {
    const start = mode === "move" ? cursor + block.startTime - earliest : cursor;
    result = transformPatternBlock(result, block.id, { startTime: start });
    if (mode === "sequence") cursor = round(cursor + block.duration + space);
  });
  return result;
}

export function saveShowSection(clips, ids, name) {
  const title = String(name).trim();
  if (!title || title.length > 80) throw new Error("Section names must contain 1–80 characters.");
  const blocks = selectedBlocks(clips, ids);
  const start = Math.min(...blocks.map(b => b.startTime));
  const selected = new Set(blocks.map(b => b.id));
  let normalized = clips.filter(c => selected.has(patternBlockId(c)));
  blocks.forEach(b => { normalized = transformPatternBlock(normalized, b.id, { startTime: round(b.startTime - start) }); });
  return validateShowSection({ version: 1, fileType: "aquaflow-show-section", id: `section-${nanoid(12)}`,
    name: title, duration: round(Math.max(...blocks.map(b => b.endTime)) - start), clips: structuredClone(normalized) });
}

export function validateShowSection(value) {
  if (!value || value.version !== 1 || value.fileType !== "aquaflow-show-section") throw new Error("This is not an AquaFlow show-section file.");
  if (typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80) throw new Error("The section name or identity is invalid.");
  if (!Array.isArray(value.clips) || !value.clips.length || value.clips.length > 20000) throw new Error("A section needs 1–20,000 clips.");
  const duration = finite(value.duration, "Section duration", 0.1);
  if (duration > 600) throw new Error("A section must fit within 10 minutes.");
  const identities = new Set();
  value.clips.forEach(c => {
    if (!c || typeof c.id !== "string" || identities.has(c.id) || typeof c.patternBlockId !== "string" || !c.patternBlockId
      || typeof c.fixtureId !== "string" || typeof c.trackId !== "string" || typeof c.type !== "string") throw new Error("The section has invalid or duplicate clip identities.");
    identities.add(c.id);
    const start = finite(c.startTime, "Clip start"), length = finite(c.duration, "Clip duration", 0.001);
    if (start + length > duration + 0.001 || typeof c.value !== "number" || !Number.isFinite(c.value)) throw new Error("A section clip exceeds its duration or has an invalid value.");
    if (c.arrayPattern?.sequenceEndTime != null && (finite(c.arrayPattern.sequenceEndTime, "Programmed end") > duration + 0.001)) throw new Error("A programmed OFF interval exceeds the section duration.");
    if (c.patternBlockDefinition) {
      const d = c.patternBlockDefinition;
      if (d.id !== c.patternBlockId || typeof d.name !== "string" || !d.name.trim() || d.name.length > 80
        || finite(d.startTime, "Block start") + finite(d.duration, "Block duration", 0.1) > duration + 0.001) throw new Error("A block definition is invalid.");
      if (d.recipe && (!Array.isArray(d.recipe.selectedFixtureIds) || d.recipe.selectedFixtureIds.some(id => typeof id !== "string"))) throw new Error("A saved block has invalid outlet selection.");
      if (d.recipe && (!Number.isInteger(d.recipe.repeats) || d.recipe.repeats < 1 || d.recipe.repeats > 100
        || [d.recipe.stepDuration, d.recipe.pulseDuration].some(n => !Number.isFinite(n) || n < 0.05 || n > 60)
        || finite(d.recipe.repeatGap, "Array gap") > 600 || Math.abs(finite(d.recipe.startTime, "Array start") - d.startTime) > 0.001)) throw new Error("A saved block recipe has invalid timing.");
    }
  });
  const blocks = getPatternBlocks(value.clips);
  if (blocks.length > 64 || blocks.some(b => !Number.isFinite(b.startTime) || !Number.isFinite(b.duration)
    || b.members.filter(c => c.patternBlockDefinition).length !== 1)) throw new Error("A section needs 1–64 valid blocks, each with one definition.");
  if (Math.abs(Math.min(...blocks.map(b => b.startTime))) > 0.001
    || Math.abs(Math.max(...blocks.map(b => b.endTime)) - duration) > 0.001) throw new Error("Section timing must start at zero and match its declared duration.");
  const section = { version: 1, fileType: "aquaflow-show-section", id: value.id, name: value.name.trim(), duration, clips: structuredClone(value.clips) };
  if (JSON.stringify(section).length > MAX_SECTION_FILE_SIZE) throw new Error("The section file is too large. Save a smaller selection.");
  return section;
}

export function insertShowSection(clips, value, fixtures, tracks, { startTime = 0, repeats = 1, gap = 0 } = {}) {
  const section = validateShowSection(value);
  const start = finite(startTime, "Insert time"), space = finite(gap, "Section gap");
  const cycles = Number(repeats);
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 20) throw new Error("Section repeats must be a whole number from 1 to 20.");
  if (round(start + section.duration * cycles + space * (cycles - 1)) > 600) throw new Error("The inserted sections must end within 10 minutes.");
  if (clips.length + section.clips.length * cycles > 20000) throw new Error("The show would exceed 20,000 clips.");
  const outlets = new Map(fixtures.map(f => [f.id, f]));
  const currentTracks = new Map(tracks.map(t => [t.id, t]));
  section.clips.forEach(c => {
    const fixture = outlets.get(c.fixtureId), track = currentTracks.get(c.trackId);
    if (!fixture || !String(fixture.type).startsWith("nozzle_")
      || !["running-fountain", "foam", "peacock"].includes(fixture.engineering?.siteFunction)
      || !track || track.fixtureId !== c.fixtureId || track.type !== c.type) throw new Error("This section's outlets or tracks do not match the current engineering project. Restore the original project; outlets are never remapped silently.");
  });
  const inserted = [], ids = [];
  const blocks = getPatternBlocks(section.clips);
  if (blocks.some(b => b.recipe?.selectedFixtureIds.some(id => !outlets.has(id)))) throw new Error("Some saved outlets are missing from the current engineering project.");
  for (let cycle = 0; cycle < cycles; cycle++) {
    const offset = round(start + cycle * (section.duration + space));
    blocks.forEach(block => {
      const copy = copyPatternBlock(section.clips, block.id, round(offset + block.startTime), block.name);
      inserted.push(...copy.clips); ids.push(copy.id);
    });
  }
  return { clips: [...clips, ...inserted].sort((a, b) => a.startTime - b.startTime), ids,
    endTime: round(start + section.duration * cycles + space * (cycles - 1)) };
}

export function readSectionLibrary(raw) {
  if (!raw) return [];
  const values = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 32) throw new Error("The section library is invalid or exceeds 32 saved sections.");
  const result = values.map(validateShowSection);
  if (new Set(result.map(s => s.id)).size !== result.length) throw new Error("The section library contains duplicate identities.");
  if (new Set(result.map(s => s.name.toLowerCase())).size !== result.length) throw new Error("The section library contains duplicate names.");
  return result;
}
