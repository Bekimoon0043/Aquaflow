import { createPatternBlock, getPatternBlocks } from "./patternBlocks";
import { createSiteWaterTrack, compileSiteWaterShow } from "./siteShowCompiler";

export const CHOREOGRAPHY_STYLES = ["auto", "wave", "reverse-wave", "center-out", "edges-in", "alternate", "pulse", "cascade", "calm", "dramatic"];
const beatTime = beat => typeof beat === "number" ? beat : beat?.time;
export function choreographyProjectSignature(fixtures, tracks) {
  return JSON.stringify({ outlets: fixtures.map(f => [f.id, f.type, f.engineering?.siteFunction, f.engineering?.icanGroup, f.engineering?.icanChannel]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    tracks: tracks.map(t => [t.id, t.fixtureId, t.type]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) });
}
export function validateMusicAnalysis(analysis) {
  if (!["pcm-wav", "librosa"].includes(analysis?.analysis_method)) {
    throw new Error("This file received metadata estimates only. Use a PCM WAV for measured music analysis, or generate a prompt pattern with a manual BPM.");
  }
  if (!Number.isFinite(analysis.duration) || analysis.duration <= 0 || !Number.isFinite(analysis.bpm) || analysis.bpm <= 0
    || !Array.isArray(analysis.beats) || analysis.beats.some(beat => {
      const time = beatTime(beat);
      return !Number.isFinite(time) || time < 0 || time > analysis.duration + 0.01;
    })) {
    throw new Error("Music analysis contains invalid duration, tempo or beat times.");
  }
  return analysis;
}

/** Convert absolute gateway states to editable water blocks. No control calls or inferred addresses. */
export function choreographyToBlocks(pattern, fixtures, tracks, { duration = 60, startTime = 0, name = "Generated dance", analysis = null } = {}) {
  if (!Number.isFinite(duration) || duration < 1 || duration > 600 || !Number.isFinite(startTime) || startTime < 0
    || Math.round((startTime + duration) * 1000) > 600000) throw new Error("Generated shows must fit within 10 minutes, with at least one second of music or movement.");
  name = String(name).trim();
  if (!name || name.length > 60) throw new Error("Give the dance a name of 1–60 characters.");
  if (analysis) validateMusicAnalysis(analysis);
  if (!Array.isArray(pattern?.steps) || !pattern.steps.length || pattern.steps.length > 500) throw new Error("Invalid generated valve states.");
  const addresses = new Map();
  fixtures.forEach(f => {
    const track = createSiteWaterTrack(f);
    if (track?.type !== "solenoid_open") return;
    const key = `${f.engineering.icanGroup}:${f.engineering.icanChannel}`;
    if (addresses.has(key)) throw new Error(`Duplicate engineering address ${key}. Correct the mapping first.`);
    const actual = tracks.find(t => t.id === track.id && t.fixtureId === f.id && t.type === track.type);
    addresses.set(key, { fixture: f, track: actual });
  });
  let elapsed = 0;
  const states = pattern.steps.map(step => {
    if (!Number.isInteger(step.duration_ms) || step.duration_ms < 100 || step.duration_ms > 60000
      || !step.groups || Object.keys(step.groups).some(g => !["1", "2", "9", "17", "25"].includes(g))) throw new Error("Malformed generated valve state.");
    for (const g of ["1", "2", "9", "17", "25"]) {
      const channels = step.groups[g];
      if (!Array.isArray(channels) || new Set(channels).size !== channels.length
        || channels.some(c => !Number.isInteger(c) || c < 9 || c > 40)) throw new Error("Malformed generated channels.");
      if (["2", "17", "25"].includes(g) && channels.length) throw new Error("Generated pump, frequency and rear outputs must remain OFF.");
    }
    const outlets = ["1", "9"].flatMap(g => step.groups[g].map(c => {
      const mapped = addresses.get(`${g}:${c}`);
      if (!mapped?.track) throw new Error(`G${g} C${c} needs a unique commissioned outlet and matching valve track in this engineering project.`);
      return mapped;
    }));
    const state = { start: elapsed, end: elapsed + step.duration_ms, outlets };
    elapsed = state.end;
    return state;
  });
  if (elapsed > 600000) throw new Error("Generated source exceeds 10 minutes.");
  const durationMs = Math.min(Math.round(duration * 1000), elapsed, analysis ? Math.round(analysis.duration * 1000) : Infinity);
  if (durationMs < 1000) throw new Error("The generated source is too short.");
  // Reserve the final 100 ms for OFF. If cutting within 100 ms of a state change,
  // close the preceding state early so a real run never gains a sub-100 ms pulse.
  let cutoff = durationMs - 100;
  const near = states.find(s => s.start < cutoff && cutoff - s.start < 100);
  if (near) cutoff = near.start;
  const clipped = states.filter(s => s.start < cutoff).map(s => ({ ...s, end: Math.min(s.end, cutoff) }));
  if (!clipped.some(s => s.outlets.length)) throw new Error("The generated dance has no ON valves.");
  const chunks = [];
  for (let i = 0; i < clipped.length; i += 8) chunks.push(clipped.slice(i, i + 8));
  const offset = Math.round(startTime * 1000);
  const clips = chunks.flatMap((chunk, index) => {
    const begin = chunk[0].start;
    const end = index === chunks.length - 1 ? durationMs : chunk.at(-1).end;
    const runs = new Map();
    chunk.forEach(state => state.outlets.forEach(({ fixture, track }) => {
      if (!runs.has(fixture.id)) runs.set(fixture.id, []);
      const list = runs.get(fixture.id), previous = list.at(-1);
      if (previous?.end === state.start) previous.end = state.end;
      else list.push({ fixture, track, start: state.start, end: state.end });
    }));
    let members = [...runs.values()].flat().map(run => ({ fixtureId: run.fixture.id, trackId: run.track.id, type: run.track.type,
      name: `${run.fixture.label || run.fixture.id} / Generated valve`, startTime: (offset + run.start) / 1000,
      duration: (run.end - run.start) / 1000, value: 100, fadeIn: 0, fadeOut: 0, effects: [], curveType: "linear",
      color: "#22d3ee", source: "site-choreography", arrayPattern: { sequenceEndTime: (offset + end) / 1000 } }));
    if (!members.length) {
      const mapped = [...addresses.values()].find(item => item.track);
      members = [{ fixtureId: mapped.fixture.id, trackId: mapped.track.id, type: mapped.track.type, name: "Musical rest",
        startTime: (offset + begin) / 1000, duration: (end - begin) / 1000, value: 0, effects: [],
        source: "site-choreography", arrayPattern: { sequenceEndTime: (offset + end) / 1000 } }];
    }
    const block = createPatternBlock({ clips: members, startTime: (offset + begin) / 1000, duration: (end - begin) / 1000 },
      { name: `${name} / ${analysis ? "Music phrase" : "Phrase"} ${index + 1}` });
    block[0].choreography = { version: 1, prompt: pattern.provenance?.prompt || "", style: pattern.provenance?.style || "",
      musicFilename: analysis?.filename || "", bpm: analysis?.bpm || pattern.music?.bpm || null,
      analysisMethod: analysis?.analysis_method || "operator-bpm" };
    return block;
  });
  if (clips.length > 20000) throw new Error("Generated dance exceeds 20,000 clips. Use a shorter excerpt.");
  // Exercise the same conversion gate as a reviewed site show before exposing Apply.
  compileSiteWaterShow(clips, fixtures, { name });
  const beatMarkers = analysis ? [...new Set(analysis.beats.map(beatTime))].sort((a, b) => a - b).filter(t => t * 1000 < durationMs)
    .map((time, i) => ({ time: Math.round((startTime + time) * 1000) / 1000, bpm: analysis.bpm, label: `Beat ${i + 1}` })) : [];
  return { clips, name, duration: durationMs / 1000, endTime: (offset + durationMs) / 1000,
    blockCount: getPatternBlocks(clips).length, beatMarkers, music: !!analysis };
}
