import { classifyFixtureType } from "../hooks/fixtureTypeMap";
import { evaluateShowFrameAt, lightViewState, normalizeCurve, parseKeys } from "../show/evaluateShowFrame";

const WATER_TYPES = new Set(["device_intensity", "device_enable", "solenoid_open", "motion_intensity"]);
const MOTION_TYPES = new Set(["motion_pan", "motion_tilt", "motion_angle"]);
const LIGHT_TYPES = new Set(["lighting_master", "lighting_red", "lighting_green", "lighting_blue"]);
const PUMP_TYPES = new Set(["pump_speed"]);
const hexColor = value => /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#ffffff";

/** Convert editable Show Programmer clips to an isolated 3D visualization. */
export function createFullShowPreview(clips, fixtures, name = "Full fountain show", options = {}) {
  if (!Array.isArray(clips) || !clips.length) throw new Error("Add show clips before opening the 3D preview.");
  const skipUnsupported = Boolean(options.skipUnsupported);
  const byId = new Map((fixtures || []).map(fixture => [fixture.id, fixture]));
  const visualClips = [];
  let skippedClips = 0;
  for (const clip of clips) {
    const fixture = byId.get(clip.fixtureId);
    if (!fixture) {
      if (skipUnsupported) { skippedClips++; continue; }
      throw new Error(`${clip.name || clip.id}: its engineering fixture is missing.`);
    }
    const category = classifyFixtureType(fixture.type);
    const type = clip.type;
    const allowed = category === "light" ? LIGHT_TYPES.has(type)
      : category === "equipment" ? /pump/i.test(fixture.type) && PUMP_TYPES.has(type)
        : WATER_TYPES.has(type) || PUMP_TYPES.has(type) // any water nozzle may be driven by its pump speed (e.g. rotating_jet)
          || (String(fixture.type).startsWith("motion") && MOTION_TYPES.has(type));
    if (!allowed) {
      if (skipUnsupported) { skippedClips++; continue; }
      throw new Error(`${clip.name || clip.id}: this track cannot yet be shown in the 3D design preview.`);
    }
    const start = Number(clip.startTime), duration = Number(clip.duration), value = Number(clip.value);
    const fadeIn = Number(clip.fadeIn || 0), fadeOut = Number(clip.fadeOut || 0);
    if (![start, duration, value, fadeIn, fadeOut].every(Number.isFinite) || start < 0 || duration <= 0
      || fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > duration
      || (MOTION_TYPES.has(type) ? Math.abs(value) > 60 : value < 0 || value > 100)) {
      if (skipUnsupported) { skippedClips++; continue; }
      throw new Error(`${clip.name || clip.id}: invalid timing, value, or fade.`);
    }
    // Fade curves are evaluated by the canonical show frame (linear/ease/step).
    if ((clip.curveType && normalizeCurve(clip.curveType) === null)
      || (clip.effects || []).some(effect => effect.type !== "basic")) {
      if (skipUnsupported) { skippedClips++; continue; }
      throw new Error(`${clip.name || clip.id}: convert complex effects to timed clips before the 3D preview.`);
    }
    const keyed = Array.isArray(clip.keys) && parseKeys(clip.keys, clip.keyMode) ? { keys: clip.keys, keyMode: clip.keyMode } : {};
    visualClips.push({ id: clip.id, fixtureId: fixture.id, type, start, end: start + duration, value, fadeIn, fadeOut, ...keyed,
      curveType: normalizeCurve(clip.curveType) || "linear", color: hexColor(clip.color), pan: Number.isFinite(Number(clip.pan)) ? Number(clip.pan) : 0,
      tilt: Number.isFinite(Number(clip.tilt)) ? Number(clip.tilt) : 0 });
  }
  if (!visualClips.length) throw new Error("The timeline has no channels that can be shown in the 3D preview.");
  const duration = Math.max(...visualClips.map(clip => clip.end));
  if (duration > 600) throw new Error("3D show previews must fit within 10 minutes.");
  const steps = [];
  let remaining = Math.max(100, Math.ceil(duration * 1000));
  while (remaining > 60000) { steps.push({ duration_ms: 60000, groups: {} }); remaining -= 60000; }
  if (remaining < 100 && steps.length) { steps.at(-1).duration_ms -= 100 - remaining; remaining = 100; }
  steps.push({ duration_ms: remaining, groups: {} });
  return { id: "full-show-design-preview", name, steps, visualClips, skippedClips };
}

// Canonical project for a preview plan, cached per (visualClips, fixtures) pair so a
// 60 fps render loop indexes the show once.
const EMPTY = Object.freeze([]);
const planProjects = new WeakMap();
export function previewPlanProject(plan, fixtures = EMPTY) {
  const clips = plan.visualClips || EMPTY;
  let byFixtures = planProjects.get(clips);
  if (!byFixtures) { byFixtures = new WeakMap(); planProjects.set(clips, byFixtures); }
  let project = byFixtures.get(fixtures);
  if (!project) {
    project = { fixtures, clips: clips.map(clip => ({ id: clip.id, fixtureId: clip.fixtureId, type: clip.type,
      start: clip.start, end: clip.end, value: clip.value, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut,
      curveType: clip.curveType, color: clip.color, pan: clip.pan, tilt: clip.tilt, keys: clip.keys, keyMode: clip.keyMode })) };
    byFixtures.set(fixtures, project);
  }
  return project;
}

/**
 * Pure frame evaluation; all values are visual and never reach a hardware driver.
 * AF-NEXT-004: levels, fades, colour and overlap come from the canonical show frame;
 * this adapter only maps the frame onto the renderer's legacy signal shape.
 */
export function evaluateFullShowPreview(plan, position, fixtures = EMPTY, stopped = false) {
  const ended = Number(position) >= plan.duration;
  const frame = evaluateShowFrameAt(previewPlanProject(plan, fixtures), Math.max(0, Number(position) || 0),
    { loop: { startMs: 0, endMs: plan.passMs }, stopped: stopped || ended });
  const fixtureIntensities = {}, fixtureLightStates = {}, fixtureMotion = {};
  fixtures.forEach(fixture => {
    const category = classifyFixtureType(fixture.type);
    if (category === "light") fixtureLightStates[fixture.id] = { intensity: 0, color: "#ffffff" };
    else if (category !== "equipment") fixtureIntensities[fixture.id] = 0;
    if (String(fixture.type).startsWith("motion")) fixtureMotion[fixture.id] = { pan: 0, tilt: 0 };
  });
  let pump = 0;
  for (const [id, record] of Object.entries(frame.fixtures)) {
    if (record.kind === "light") fixtureLightStates[id] = lightViewState(record);
    else if (record.kind === "pump") pump = Math.max(pump, record.level);
    else if (record.kind !== "valve" && record.kind !== "equipment") fixtureIntensities[id] = record.level;
    if (fixtureMotion[id] && record.motion) fixtureMotion[id] = { ...record.motion };
  }
  const active = Object.values(fixtureIntensities).filter(value => value > 0).length;
  const lightsActive = Object.values(fixtureLightStates).filter(state => state.intensity > 0).length;
  const representative = Object.values(fixtureLightStates).find(state => state.intensity > 0);
  const color = representative?.color || "#ffffff";
  return { source: "full-show-simulation", pump, valve: 0, lighting: lightsActive ? 1 : 0,
    lightingColor: { r: parseInt(color.slice(1, 3), 16) / 255, g: parseInt(color.slice(3, 5), 16) / 255,
      b: parseInt(color.slice(5, 7), 16) / 255, w: 0 },
    flame: 0, fog: 0, laser: 0, groups: {}, fixtureIntensities, fixtureLightStates, fixtureMotion,
    active, lightsActive, mapped: 0, unmapped: 0, supportSelected: false, protectedSelected: false,
    stepIndex: 0, passIndex: Math.min(plan.repeat, Math.floor(Math.max(0, Number(position) || 0) * 1000 / plan.passMs) + 1), ended,
    showFrame: frame };
}
