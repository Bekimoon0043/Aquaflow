import { classifyFixtureType } from "../hooks/fixtureTypeMap";

const WATER_TYPES = new Set(["device_intensity", "device_enable", "solenoid_open", "motion_intensity"]);
const MOTION_TYPES = new Set(["motion_pan", "motion_tilt", "motion_angle"]);
const LIGHT_TYPES = new Set(["lighting_master", "lighting_red", "lighting_green", "lighting_blue"]);
const PUMP_TYPES = new Set(["pump_speed"]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hexColor = value => /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#ffffff";

/** Convert editable Show Programmer clips to an isolated 3D visualization. */
export function createFullShowPreview(clips, fixtures, name = "Full fountain show") {
  if (!Array.isArray(clips) || !clips.length) throw new Error("Add show clips before opening the 3D preview.");
  const byId = new Map((fixtures || []).map(fixture => [fixture.id, fixture]));
  const visualClips = clips.map(clip => {
    const fixture = byId.get(clip.fixtureId);
    if (!fixture) throw new Error(`${clip.name || clip.id}: its engineering fixture is missing.`);
    const category = classifyFixtureType(fixture.type);
    const type = clip.type;
    const allowed = category === "light" ? LIGHT_TYPES.has(type)
      : category === "equipment" ? fixture.type === "pump" && PUMP_TYPES.has(type)
        : WATER_TYPES.has(type) || (String(fixture.type).startsWith("nozzle_") && PUMP_TYPES.has(type))
          || (String(fixture.type).startsWith("motion") && MOTION_TYPES.has(type));
    if (!allowed) throw new Error(`${clip.name || clip.id}: this track cannot yet be shown in the 3D design preview.`);
    const start = Number(clip.startTime), duration = Number(clip.duration), value = Number(clip.value);
    const fadeIn = Number(clip.fadeIn || 0), fadeOut = Number(clip.fadeOut || 0);
    if (![start, duration, value, fadeIn, fadeOut].every(Number.isFinite) || start < 0 || duration <= 0
      || fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > duration
      || (MOTION_TYPES.has(type) ? Math.abs(value) > 60 : value < 0 || value > 100)) {
      throw new Error(`${clip.name || clip.id}: invalid timing, value, or fade.`);
    }
    if ((clip.curveType && clip.curveType !== "linear")
      || (clip.effects || []).some(effect => effect.type !== "basic")) {
      throw new Error(`${clip.name || clip.id}: convert complex effects to timed clips before the 3D preview.`);
    }
    return { fixtureId: fixture.id, type, start, end: start + duration, value, fadeIn, fadeOut,
      color: hexColor(clip.color), pan: Number.isFinite(Number(clip.pan)) ? Number(clip.pan) : 0,
      tilt: Number.isFinite(Number(clip.tilt)) ? Number(clip.tilt) : 0 };
  });
  const duration = Math.max(...visualClips.map(clip => clip.end));
  if (duration > 600) throw new Error("3D show previews must fit within 10 minutes.");
  const steps = [];
  let remaining = Math.max(100, Math.ceil(duration * 1000));
  while (remaining > 60000) { steps.push({ duration_ms: 60000, groups: {} }); remaining -= 60000; }
  if (remaining < 100 && steps.length) { steps.at(-1).duration_ms -= 100 - remaining; remaining = 100; }
  steps.push({ duration_ms: remaining, groups: {} });
  return { id: "full-show-design-preview", name, steps, visualClips };
}

/** Pure frame evaluation; all values are visual and never reach a hardware driver. */
export function evaluateFullShowPreview(plan, position, fixtures = [], stopped = false) {
  const ended = Number(position) >= plan.duration;
  const time = ((Math.max(0, Number(position) || 0) * 1000) % plan.passMs) / 1000;
  const fixtureIntensities = {}, fixtureLightStates = {}, fixtureMotion = {};
  const byId = new Map(fixtures.map(fixture => [fixture.id, fixture]));
  fixtures.forEach(fixture => {
    const category = classifyFixtureType(fixture.type);
    if (category === "light") fixtureLightStates[fixture.id] = { intensity: 0, color: "#ffffff" };
    else if (category !== "equipment") fixtureIntensities[fixture.id] = 0;
    if (String(fixture.type).startsWith("motion")) fixtureMotion[fixture.id] = { pan: 0, tilt: 0 };
  });
  let pump = 0;
  const rgb = new Map();
  if (!stopped && !ended) for (const clip of plan.visualClips) {
    if (clip.start > time || time >= clip.end) continue;
    const fraction = Math.min(1, clip.fadeIn ? (time - clip.start) / clip.fadeIn : 1,
      clip.fadeOut ? (clip.end - time) / clip.fadeOut : 1);
    const level = clamp(clip.value / 100 * fraction, 0, 1);
    if (WATER_TYPES.has(clip.type) || (clip.type === "pump_speed" && String(byId.get(clip.fixtureId)?.type).startsWith("nozzle_"))) {
      fixtureIntensities[clip.fixtureId] = Math.max(fixtureIntensities[clip.fixtureId] || 0, level);
      if (fixtureMotion[clip.fixtureId]) fixtureMotion[clip.fixtureId] = { pan: clamp(clip.pan, -45, 45), tilt: clamp(clip.tilt, -45, 45) };
    } else if (clip.type === "lighting_master") {
      const current = fixtureLightStates[clip.fixtureId];
      if (current && level >= current.intensity) fixtureLightStates[clip.fixtureId] = { intensity: level, color: clip.color };
    } else if (LIGHT_TYPES.has(clip.type)) {
      const channels = rgb.get(clip.fixtureId) || { r: 0, g: 0, b: 0 };
      channels[clip.type.slice("lighting_".length)[0]] = level;
      rgb.set(clip.fixtureId, channels);
    } else if (clip.type === "pump_speed") pump = Math.max(pump, level);
    else if (fixtureMotion[clip.fixtureId]) {
      const axis = clip.type === "motion_tilt" ? "tilt" : "pan";
      fixtureMotion[clip.fixtureId][axis] = clamp(clip.value, -45, 45);
    }
  }
  rgb.forEach((channels, id) => {
    const intensity = Math.max(channels.r, channels.g, channels.b);
    fixtureLightStates[id] = { intensity, color: `#${[channels.r, channels.g, channels.b]
      .map(value => Math.round(value * 255).toString(16).padStart(2, "0")).join("")}` };
  });
  const active = Object.values(fixtureIntensities).filter(value => value > 0).length;
  const lightsActive = Object.values(fixtureLightStates).filter(state => state.intensity > 0).length;
  const representative = Object.values(fixtureLightStates).find(state => state.intensity > 0);
  const color = representative?.color || "#ffffff";
  return { source: "full-show-simulation", pump, valve: 0, lighting: lightsActive ? 1 : 0,
    lightingColor: { r: parseInt(color.slice(1, 3), 16) / 255, g: parseInt(color.slice(3, 5), 16) / 255,
      b: parseInt(color.slice(5, 7), 16) / 255, w: 0 },
    flame: 0, fog: 0, laser: 0, groups: {}, fixtureIntensities, fixtureLightStates, fixtureMotion,
    active, lightsActive, mapped: 0, unmapped: 0, supportSelected: false, protectedSelected: false,
    stepIndex: 0, passIndex: Math.min(plan.repeat, Math.floor(Math.max(0, Number(position) || 0) * 1000 / plan.passMs) + 1), ended };
}
