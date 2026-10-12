const WATER_FUNCTIONS = new Set(["running-fountain", "foam", "peacock"]);

export const ARRAY_PATTERN_LIBRARY = Object.freeze([
  { id: "all_pulse", label: "All Together", description: "Pulse every selected outlet together." },
  { id: "left_to_right", label: "Left to Right", description: "Run one outlet at a time from left to right." },
  { id: "right_to_left", label: "Right to Left", description: "Run one outlet at a time from right to left." },
  { id: "bounce", label: "Bounce", description: "Travel forward and return without repeating the end points." },
  { id: "center_out", label: "Center Out", description: "Open matching pairs from the center toward both edges." },
  { id: "outside_in", label: "Outside In", description: "Open matching pairs from both edges toward the center." },
  { id: "odd_even", label: "Odd / Even", description: "Alternate odd and even outlet numbers." },
  { id: "section_chase", label: "Section Chase", description: "Run the physical sections as coordinated banks." },
  { id: "alternating_sections", label: "Alternating Sections", description: "Alternate odd and even physical sections." },
  { id: "block_chase", label: "Block Chase", description: "Travel in operator-sized blocks." },
  { id: "mirrored_blocks", label: "Mirrored Blocks", description: "Move matching blocks from both edges toward the center." },
  { id: "traveling_wave", label: "Traveling Window", description: "Move an overlapping window of outlets along the array." },
  { id: "fill_drain", label: "Fill and Drain", description: "Build the array, then close it in reverse order." },
  { id: "progressive_fill", label: "Progressive Fill", description: "Build the fountain progressively until all selected outlets are active." },
  { id: "sparkle", label: "Deterministic Sparkle", description: "A repeatable scattered sequence for music accents." },
  { id: "custom", label: "Custom Array", description: "Program stages using numbers, ranges, odd, even, center, edges, or all." },
]);

export const ARRAY_TARGETS = Object.freeze([
  { id: "mapped_running", label: "Running valves with capture-derived addresses" },
  { id: "running", label: "Running fountain — 76 outlets" },
  { id: "foam_all", label: "Foam — left and right" },
  { id: "foam_left", label: "Foam — left 8" },
  { id: "foam_right", label: "Foam — right 8" },
  { id: "peacock", label: "Peacock — center 8" },
  { id: "all_water", label: "All water outlets" },
]);

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, number(value, min)));

export function getArrayTargetFixtures(fixtures = [], target = "running") {
  const water = fixtures.filter((fixture) => {
    const siteFunction = fixture?.engineering?.siteFunction;
    return String(fixture?.type || "").startsWith("nozzle_") && WATER_FUNCTIONS.has(siteFunction);
  });

  const selected = water.filter((fixture) => {
    const siteFunction = fixture.engineering?.siteFunction;
    if (target === "all_water") return true;
    if (target === "running") return siteFunction === "running-fountain";
    if (target === "mapped_running") return siteFunction === "running-fountain"
      && [1, 9].includes(fixture.engineering?.icanGroup)
      && Number.isInteger(fixture.engineering?.icanChannel)
      && fixture.engineering.icanChannel >= 9 && fixture.engineering.icanChannel <= 40;
    if (target === "peacock") return siteFunction === "peacock";
    if (target === "foam_all") return siteFunction === "foam";
    if (target === "foam_left") return siteFunction === "foam" && fixture.engineering?.side === "left";
    if (target === "foam_right") return siteFunction === "foam" && fixture.engineering?.side === "right";
    return false;
  });

  return [...selected].sort((left, right) => {
    if (left.engineering?.siteFunction === "foam" && right.engineering?.siteFunction === "foam") {
      const sideDelta = (left.engineering.side === "right" ? 1 : 0) - (right.engineering.side === "right" ? 1 : 0);
      if (sideDelta) return sideDelta;
    }
    const leftIndex = number(left.engineering?.legacyValveIndex ?? left.engineering?.outletIndex, Number.NaN);
    const rightIndex = number(right.engineering?.legacyValveIndex ?? right.engineering?.outletIndex, Number.NaN);
    if (Number.isFinite(leftIndex) && Number.isFinite(rightIndex) && leftIndex !== rightIndex) {
      if (left.engineering?.side !== right.engineering?.side) {
        const sideOrder = { left: 0, right: 1 };
        const sideDelta = number(sideOrder[left.engineering?.side], 0) - number(sideOrder[right.engineering?.side], 0);
        if (sideDelta) return sideDelta;
      }
      return leftIndex - rightIndex;
    }
    const xDelta = number(left.x) - number(right.x);
    if (xDelta) return xDelta;
    const yDelta = number(left.y) - number(right.y);
    if (yDelta) return yDelta;
    return String(left.id).localeCompare(String(right.id));
  });
}

function splitPairs(indexes) {
  const stages = [];
  let left = 0;
  let right = indexes.length - 1;
  while (left <= right) {
    stages.push(left === right ? [indexes[left]] : [indexes[left], indexes[right]]);
    left += 1;
    right -= 1;
  }
  return stages;
}

function groupBySection(fixtures) {
  const sections = new Map();
  fixtures.forEach((fixture, index) => {
    const section = fixture.engineering?.sectionIndex ?? fixture.zone ?? index + 1;
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push(index);
  });
  return [...sections.values()];
}

function deterministicSparkle(indexes) {
  if (indexes.length < 2) return indexes.map((index) => [index]);
  const used = new Set();
  const stages = [];
  let cursor = 0;
  const stride = indexes.length % 2 === 0 ? Math.max(1, indexes.length - 1) : Math.max(1, indexes.length - 2);
  while (used.size < indexes.length) {
    while (used.has(cursor)) cursor = (cursor + 1) % indexes.length;
    used.add(cursor);
    stages.push([indexes[cursor]]);
    cursor = (cursor + stride) % indexes.length;
  }
  return stages;
}

function parseIndexToken(token, count) {
  const normalized = token.trim().toLowerCase();
  const all = Array.from({ length: count }, (_, index) => index);
  if (!normalized) return [];
  if (normalized === "all") return all;
  if (normalized === "odd") return all.filter((index) => index % 2 === 0);
  if (normalized === "even") return all.filter((index) => index % 2 === 1);
  if (normalized === "center") {
    const left = Math.floor((count - 1) / 2);
    const right = Math.ceil((count - 1) / 2);
    return left === right ? [left] : [left, right];
  }
  if (normalized === "edges") return count <= 1 ? all : [0, count - 1];

  const range = normalized.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start < 1 || end < 1 || start > count || end > count) throw new Error(`Outlet range ${token} must be within 1–${count}.`);
    const direction = start <= end ? 1 : -1;
    const values = [];
    for (let value = start; direction > 0 ? value <= end : value >= end; value += direction) {
      values.push(value - 1);
    }
    return values;
  }

  const single = /^\d+$/.test(normalized) ? Number(normalized) : NaN;
  if (single >= 1 && single <= count) return [single - 1];
  throw new Error(`Unknown outlet selector "${token}". Use 1–${count}, ranges, odd, even, center, edges, all, or off.`);
}

export function parseCustomArray(program = "", fixtureCount = 0) {
  if (!fixtureCount) return [];
  return String(program)
    .split(/[|;\n]+/).filter(stage => stage.trim())
    .map((stage) => {
      if (stage.trim().toLowerCase() === "off") return [];
      const unique = new Set();
      stage.split(",").forEach((token) => parseIndexToken(token, fixtureCount).forEach((index) => unique.add(index)));
      return [...unique];
    });
}

export function buildPatternStages(patternId, fixtures = [], options = {}) {
  const indexes = fixtures.map((_, index) => index);
  const sections = groupBySection(fixtures);
  const blockSize = Math.max(1, Math.floor(number(options.blockSize, 4)));

  switch (patternId) {
    case "all_pulse": return indexes.length ? [indexes] : [];
    case "left_to_right": return indexes.map((index) => [index]);
    case "right_to_left": return [...indexes].reverse().map((index) => [index]);
    case "bounce": {
      const forward = indexes.map((index) => [index]);
      const reverse = indexes.slice(1, -1).reverse().map((index) => [index]);
      return [...forward, ...reverse];
    }
    case "center_out": return splitPairs(indexes).reverse();
    case "outside_in": return splitPairs(indexes);
    case "odd_even": return [indexes.filter((index) => index % 2 === 0), indexes.filter((index) => index % 2 === 1)].filter((stage) => stage.length);
    case "section_chase": return sections;
    case "alternating_sections": return [
      sections.filter((_, index) => index % 2 === 0).flat(),
      sections.filter((_, index) => index % 2 === 1).flat(),
    ].filter((stage) => stage.length);
    case "block_chase": {
      const stages = [];
      for (let index = 0; index < indexes.length; index += blockSize) stages.push(indexes.slice(index, index + blockSize));
      return stages;
    }
    case "mirrored_blocks": {
      const stages = [];
      for (let i = 0; i < Math.ceil(indexes.length / 2); i += blockSize) {
        const stage = indexes.slice(i, Math.min(i + blockSize, Math.ceil(indexes.length / 2)));
        stages.push([...new Set([...stage, ...stage.map(index => indexes.length - 1 - index)])]);
      }
      return stages;
    }
    case "traveling_wave": return indexes.map((_, index) => indexes.slice(index, index + blockSize));
    case "fill_drain": return [...indexes.map((_, index) => indexes.slice(0, index + 1)),
      ...indexes.slice(1).reverse().map(index => indexes.slice(0, index)), []];
    case "progressive_fill": return indexes.map((_, index) => indexes.slice(0, index + 1));
    case "sparkle": return deterministicSparkle(indexes);
    case "custom": return parseCustomArray(options.customProgram, indexes.length);
    default: return [];
  }
}

function preferredTrackForFixture(tracks, fixtureId) {
  const candidates = tracks.filter((track) => track.fixtureId === fixtureId);
  const preference = ["pump_speed", "solenoid_open", "motion_intensity", "device_intensity", "lighting_master", "device_enable"];
  return [...candidates].sort((left, right) => {
    const leftRank = preference.indexOf(left.type);
    const rightRank = preference.indexOf(right.type);
    return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank);
  })[0] || null;
}

export function createArrayPatternPlan({
  fixtures = [],
  tracks = [],
  target = "running",
  patternId = "section_chase",
  startTime = 0,
  stepDuration = 0.5,
  pulseDuration = 0.4,
  intensity = 80,
  repeats = 1,
  repeatGap = 0,
  blockSize = 4,
  customProgram = "1-4 | 5-8 | odd | even | all",
  selectedFixtureIds = null,
  order = "outlet",
  valveMode = false,
} = {}) {
  let targetFixtures = getArrayTargetFixtures(fixtures, target);
  if (selectedFixtureIds !== null) {
    const selected = new Set(selectedFixtureIds);
    const available = new Set(targetFixtures.map(fixture => fixture.id));
    if ([...selected].some(id => !available.has(id))) throw new Error("Some selected outlets are missing or no longer match this target. Explicitly choose the outlets again.");
    targetFixtures = targetFixtures.filter(fixture => selected.has(fixture.id));
  }
  if (order === "x") targetFixtures.sort((a, b) => number(a.x) - number(b.x) || String(a.id).localeCompare(String(b.id)));
  if (order === "reverse") targetFixtures.reverse();
  const stages = buildPatternStages(patternId, targetFixtures, { blockSize, customProgram });
  const safeStart = Math.max(0, number(startTime));
  const safeStep = clamp(stepDuration, 0.05, 60);
  const safePulse = clamp(pulseDuration, 0.05, 60);
  const safeIntensity = clamp(intensity, 0, 100);
  const safeRepeats = Math.max(1, Math.min(100, Math.floor(number(repeats, 1))));
  const safeGap = Math.max(0, number(repeatGap));
  if (stages.reduce((n, stage) => n + stage.length, 0) * safeRepeats > 20000) {
    throw new Error("This array would exceed 20,000 clips. Reduce repeats or split it into smaller sequences.");
  }
  const clips = [];
  const missingTrackFixtureIds = [];
  const cycleDuration = stages.length * safeStep;
  const createdAt = Date.now();

  for (let repeat = 0; repeat < safeRepeats; repeat += 1) {
    stages.forEach((stage, stageIndex) => {
      const stageStart = safeStart + (repeat * (cycleDuration + safeGap)) + (stageIndex * safeStep);
      stage.forEach((fixtureIndex) => {
        const fixture = targetFixtures[fixtureIndex];
        if (!fixture) return;
        const track = preferredTrackForFixture(tracks, fixture.id);
        if (!track) {
          missingTrackFixtureIds.push(fixture.id);
          return;
        }
        const clipId = `array-${createdAt}-${repeat}-${stageIndex}-${fixtureIndex}-${clips.length}`;
        clips.push({
          id: clipId,
          trackId: track.id,
          fixtureId: fixture.id,
          name: `${ARRAY_PATTERN_LIBRARY.find((pattern) => pattern.id === patternId)?.label || "Array"} · ${fixture.label || fixture.id}`,
          type: track.type,
          startTime: Number(stageStart.toFixed(3)),
          duration: Number(safePulse.toFixed(3)),
          value: valveMode ? (safeIntensity > 0 ? 100 : 0) : safeIntensity,
          color: track.color || "#00b7ff",
          fadeIn: valveMode ? 0 : Math.min(0.15, safePulse / 4),
          fadeOut: valveMode ? 0 : Math.min(0.15, safePulse / 4),
          curveType: "linear",
          parameter: "intensity",
          source: "array-pattern",
          arrayPattern: { patternId, target, repeat: repeat + 1, stage: stageIndex + 1, fixtureIndex: fixtureIndex + 1 },
          effects: [{ type: "basic", startTime: 0, duration: safePulse, params: { value: valveMode ? (safeIntensity > 0 ? 100 : 0) : safeIntensity } }],
        });
      });
    });
  }

  const endTime = clips.reduce((maximum, clip) => Math.max(maximum, clip.startTime + clip.duration),
    stages.length ? safeStart + (safeRepeats - 1) * (cycleDuration + safeGap) + Math.max(cycleDuration, (stages.length - 1) * safeStep + safePulse) : safeStart);
  clips.forEach(clip => { clip.arrayPattern.sequenceEndTime = Number(endTime.toFixed(3)); });
  return {
    clips,
    recipe: { target, patternId, startTime: safeStart, stepDuration: safeStep, pulseDuration: safePulse,
      intensity: safeIntensity, repeats: safeRepeats, repeatGap: safeGap, blockSize, customProgram,
      selectedFixtureIds: targetFixtures.map(f => f.id), order, valveMode },
    fixtures: targetFixtures,
    stages,
    missingTrackFixtureIds: [...new Set(missingTrackFixtureIds)],
    duration: Number((endTime - safeStart).toFixed(3)),
    endTime: Number(endTime.toFixed(3)),
  };
}

export default {
  ARRAY_PATTERN_LIBRARY,
  ARRAY_TARGETS,
  getArrayTargetFixtures,
  parseCustomArray,
  buildPatternStages,
  createArrayPatternPlan,
};
