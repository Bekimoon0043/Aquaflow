/** Local timeline conversion only: no API, socket, device writes, or inferred addresses. */
import { expandKeyedClips } from "../show/evaluateShowFrame.js";
const SUPPORTED_TRACKS = new Set(["solenoid_open", "pump_speed", "motion_intensity", "device_intensity", "device_enable"]);
const emptyGroups = () => ({ "1": [], "2": [], "9": [], "17": [], "25": [] });
export const CAPTURED_SITE_SUPPORT = Object.freeze([9, 25, 29, 31, 32, 33, 37]);

export function createSiteWaterTrack(fixture) {
  const e = fixture.engineering;
  if (!String(fixture.type).startsWith("nozzle_") || !["running-fountain", "foam", "peacock"].includes(e?.siteFunction)) return null;
  const mapped = e.siteFunction === "running-fountain" && [1, 9].includes(e.icanGroup)
    && Number.isInteger(e.icanChannel) && e.icanChannel >= 9 && e.icanChannel <= 40;
  return { id: `${fixture.id}-speed`, fixtureId: fixture.id, siteWaterOutlet: true,
    label: `${fixture.label || fixture.id} / ${mapped ? "Valve ON/OFF" : "Design intensity (uncommissioned)"}`,
    type: mapped ? "solenoid_open" : "device_intensity" };
}

export function readWaterTimeline(rawClips = [], fixtures = []) {
  const clips = expandKeyedClips(rawClips);
  if (!clips.length) throw new Error("Generate water clips in the Arrays panel first.");
  const byId = new Map(fixtures.map(f => [f.id, f]));
  const entries = clips.map(clip => {
    const fixture = byId.get(clip.fixtureId);
    const title = clip.name || clip.id || "Clip";
    if (!fixture || !String(fixture.type).startsWith("nozzle_") || !["running-fountain", "foam", "peacock"].includes(fixture.engineering?.siteFunction)) {
      throw new Error(`${title}: site previews accept water outlet clips only. Pump, light and other equipment tracks must be kept separate.`);
    }
    if (!SUPPORTED_TRACKS.has(clip.type)) throw new Error(`${title}: this track type is not a water intensity or valve track.`);
    const start = Number(clip.startTime), duration = Number(clip.duration), value = Number(clip.value);
    const fadeIn = Number(clip.fadeIn || 0), fadeOut = Number(clip.fadeOut || 0);
    if (![start, duration, value, fadeIn, fadeOut].every(Number.isFinite) || start < 0 || duration <= 0 || value < 0 || value > 100 || fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > duration) {
      throw new Error(`${title}: invalid time, intensity or fade values.`);
    }
    const effects = clip.effects || [];
    if (effects.length > 1 || effects.some(effect => effect.type !== "basic"
      || Number(effect.startTime || 0) !== 0 || Math.abs(Number(effect.duration) - duration) > 0.001
      || Number(effect.params?.value) !== value) || (clip.curveType && clip.curveType !== "linear")) {
      throw new Error(`${title}: use a single constant intensity with linear fades. Complex effects must be converted into explicit stages first.`);
    }
    return { fixtureId: fixture.id, fixture, start, end: start + duration, value, fadeIn, fadeOut, title };
  });
  const sequenceEnds = clips.map(c => Number(c.arrayPattern?.sequenceEndTime || 0));
  if (sequenceEnds.some(end => !Number.isFinite(end) || end < 0)) throw new Error("Invalid array sequence end time.");
  const duration = Math.max(...entries.map(entry => entry.end), ...sequenceEnds);
  if (duration > 600) throw new Error("Site shows must fit within 10 minutes.");
  return { entries, duration };
}

export function createDesignShowPreview(clips, fixtures, name = "Water dance design") {
  const { entries, duration } = readWaterTimeline(clips, fixtures);
  const durationMs = Math.max(100, Math.ceil(duration * 1000));
  const steps = [];
  let remaining = durationMs;
  while (remaining > 60000) { steps.push({ duration_ms: 60000, groups: emptyGroups() }); remaining -= 60000; }
  // Avoid a last remainder shorter than the preview schema's minimum.
  if (remaining && remaining < 100 && steps.length) { steps[steps.length - 1].duration_ms -= 100 - remaining; remaining = 100; }
  if (remaining) steps.push({ duration_ms: remaining, groups: emptyGroups() });
  return { id: "show-design-preview", name, steps,
    designClips: entries.map(({ fixture, title, ...entry }) => entry) };
}

export function compileSiteWaterShow(clips, fixtures, { name = "Site water dance", includeCapturedSupport = false } = {}) {
  name = name.trim();
  if (!name || name.length > 80) throw new Error("Give the site show a name containing 1–80 characters.");
  const { entries, duration } = readWaterTimeline(clips, fixtures);
  const addresses = new Map();
  entries.forEach(entry => {
    const e = entry.fixture.engineering;
    if (e.siteFunction !== "running-fountain" || ![1, 9].includes(e.icanGroup)
      || !Number.isInteger(e.icanChannel) || e.icanChannel < 9 || e.icanChannel > 40) {
      throw new Error(`${entry.fixture.label || entry.fixtureId}: no capture-derived running valve address. Foam, peacock and unresolved running outlets remain design only.`);
    }
    if (![0, 100].includes(entry.value) || entry.fadeIn || entry.fadeOut) {
      throw new Error(`${entry.title}: the site supports valve ON/OFF here. Use 0 or 100 with no fades; height and frequency control remain protected.`);
    }
    const key = `${e.icanGroup}:${e.icanChannel}`;
    const aliases = fixtures.filter(f => f.id !== entry.fixtureId && f.engineering?.siteFunction === "running-fountain"
      && f.engineering.icanGroup === e.icanGroup && f.engineering.icanChannel === e.icanChannel);
    if (aliases.length) throw new Error(`Duplicate address G${e.icanGroup} C${e.icanChannel}: correct the engineering mapping first.`);
    addresses.set(entry.fixtureId, [e.icanGroup, e.icanChannel]);
  });
  const boundaries = [...new Set([0, Math.round(duration * 1000), ...entries.flatMap(e => [Math.round(e.start * 1000), Math.round(e.end * 1000)])])].sort((a, b) => a - b);
  const onEntries = entries.filter(e => e.value === 100);
  const supportStart = Math.min(...onEntries.map(e => e.start));
  const supportEnd = Math.max(...onEntries.map(e => e.end));
  entries.forEach(e => {
    if (Math.abs(e.start * 1000 - Math.round(e.start * 1000)) > 0.00001 || Math.abs(e.end * 1000 - Math.round(e.end * 1000)) > 0.00001) {
      throw new Error("Use timeline timings with millisecond precision.");
    }
  });
  const steps = [];
  const append = (ms, groups) => {
    if (!ms) return;
    const previous = steps.at(-1);
    if (previous && JSON.stringify(previous.groups) === JSON.stringify(groups)) previous.duration_ms += ms;
    else steps.push({ duration_ms: ms, groups });
  };
  for (let i = 0; i < boundaries.length - 1; i++) {
    const time = (boundaries[i] + boundaries[i + 1]) / 2000;
    const live = entries.filter(e => e.start <= time && time < e.end);
    const on = new Set(live.filter(e => e.value === 100).map(e => e.fixtureId));
    if (live.some(e => e.value === 0 && on.has(e.fixtureId))) throw new Error("Overlapping ON and OFF clips on the same outlet are ambiguous. Remove the overlap.");
    const groups = emptyGroups();
    on.forEach(id => { const [group, channel] = addresses.get(id); groups[group].push(channel); });
    [1, 9].forEach(group => groups[group].sort((a, b) => a - b));
    // Hold the full captured support through valve gaps; never beat-pulse possible motors.
    if (includeCapturedSupport && time >= supportStart && time < supportEnd) groups[17] = [...CAPTURED_SITE_SUPPORT];
    append(boundaries[i + 1] - boundaries[i], groups);
  }
  if (steps.some(s => s.duration_ms < 100)) throw new Error("A valve state lasts less than 100 ms. Increase pulse lengths or gaps; use the beat buttons for site-compatible timing.");
  const bounded = [];
  steps.forEach(step => {
    let ms = step.duration_ms;
    while (ms > 60000) {
      const part = ms - 60000 < 100 ? 59900 : 60000;
      bounded.push({ duration_ms: part, groups: structuredClone(step.groups) }); ms -= part;
    }
    bounded.push({ duration_ms: ms, groups: structuredClone(step.groups) });
  });
  if (bounded.at(-1)?.groups["1"].length || bounded.at(-1)?.groups["9"].length) bounded.push({ duration_ms: 100, groups: emptyGroups() });
  if (!entries.some(e => e.value === 100)) throw new Error("The timeline has no ON clips.");
  if (bounded.length > 500) throw new Error("This show exceeds 500 valve states. Reduce repetitions or combine stages.");
  if (bounded.reduce((sum, s) => sum + s.duration_ms, 0) > 600000) throw new Error("Leave room for the final OFF state within the 10-minute limit.");
  return { id: `site-show-${Date.now()}`, name, description: `Converted from Show Programmer: ${entries.length} valve clips. Captured support ${includeCapturedSupport ? "included" : "OFF"}. Final OFF included.`,
    layout_id: "curved-seven-pump-fountain-v2", steps: bounded, timelineDuration: duration };
}
