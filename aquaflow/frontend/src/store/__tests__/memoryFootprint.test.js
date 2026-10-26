// Memory refactors for long shows: undo snapshots share unchanged state instead of copying
// every clip; the compiled clip array is shared by the project store instead of JSON-copied;
// the waveform keeps a ~1 kHz peak envelope instead of the decoded song. Save/load output is
// unchanged.
import { describe, expect, it } from "vitest";
import { useShowStore, MAX_HISTORY_CLIPS } from "../showStore.js";
import useProjectStore from "../projectStore.js";
import useEngineeringStore from "../engineeringStore.js";
import { serializeShow, deserializeShow } from "../../utils/showFile.js";
import { waveformEnvelope } from "../../utils/waveformEnvelope.js";

const clip = (i) => ({ id: `c${i}`, start: i, end: i + 1, label: `Clip ${i}`, params: { value: 50, keys: [0, 0, 0.5, 60, 1, 0] } });
const track = (t, n) => ({ id: `t${t}`, label: `Track ${t}`, type: "pump_speed", color: "#0af", muted: false, solo: false, clips: Array.from({ length: n }, (_, i) => clip(t * 1000 + i)) });

function loadLongShow(tracks = 20, clipsPerTrack = 50) {
  useShowStore.getState().loadShow({ currentShow: { name: "Long" }, timelineTracks: Array.from({ length: tracks }, (_, t) => track(t, clipsPerTrack)) });
}

describe("showStore undo history", () => {
  it("snapshots share the unchanged timeline (no per-step copy) and undo still restores", () => {
    loadLongShow();
    const before = useShowStore.getState().timelineTracks;
    const grid = useShowStore.getState().showGrid;
    useShowStore.getState().toggleShowGrid();
    useShowStore.getState().toggleShowGrid();
    const { undoStack } = useShowStore.getState();
    expect(undoStack).toHaveLength(2);
    expect(undoStack[0].timelineTracks).toBe(before);           // same object, not a copy
    expect(undoStack[1].timelineTracks).toBe(before);
    expect(useShowStore.getState().timelineTracks).toBe(before);
    expect(undoStack[0].historyWeight).toBe(20 + 20 * 50);
    useShowStore.getState().undo();
    expect(useShowStore.getState().undoStack).toHaveLength(1);
    expect(useShowStore.getState().redoStack[0].timelineTracks).toBe(before);
    expect(useShowStore.getState().timelineTracks[3].clips[7]).toEqual(before[3].clips[7]);
    expect(typeof grid).toBe("boolean");
  });

  it("a clip edit is undone exactly; only the edited parts are new objects", () => {
    loadLongShow(4, 10);
    const before = useShowStore.getState().timelineTracks;
    const target = before[1].clips[2];
    useShowStore.getState().updateTimelineClip(before[1].id, target.id, { start: 5.5, end: 6.5 });
    const after = useShowStore.getState().timelineTracks;
    expect(after[1].clips.find((c) => c.id === target.id).start).not.toBe(target.start);
    expect(after[0]).toBe(before[0]);                            // untouched track shared
    useShowStore.getState().undo();
    const restored = useShowStore.getState().timelineTracks;
    expect(restored[1].clips.find((c) => c.id === target.id).start).toBe(target.start);
  });

  it("very long shows drop the oldest undo steps past the clip budget", () => {
    const perTrack = 1000;
    const tracks = 50; // 50k clips per snapshot
    loadLongShow(tracks, perTrack);
    const steps = Math.ceil(MAX_HISTORY_CLIPS / (tracks * perTrack)) + 3;
    for (let i = 0; i < steps; i++) useShowStore.getState().toggleSnapToGrid();
    const { undoStack } = useShowStore.getState();
    const total = undoStack.reduce((n, s) => n + s.historyWeight, 0);
    expect(total).toBeLessThanOrEqual(MAX_HISTORY_CLIPS);
    expect(undoStack.length).toBeGreaterThan(1);
    expect(undoStack.length).toBeLessThan(steps);
  });
});

describe("project store keeps the compiled clips by reference", () => {
  it("rememberProgrammer shares timelineClips, still detaches the rest, and drops File/AudioBuffer", () => {
    const clips = Array.from({ length: 100 }, (_, i) => ({ id: `k${i}`, startTime: i, duration: 1, keys: [0, 1] }));
    const studio = { recipes: [{ id: "r1" }] };
    useProjectStore.getState().rememberProgrammer({ timelineClips: clips, studio, audioBuffer: { big: true }, audioDuration: 100 });
    const p = useProjectStore.getState().programmer;
    expect(p.timelineClips).toBe(clips);
    expect(p.studio).toEqual(studio);
    expect(p.studio).not.toBe(studio);
    expect(p.audioBuffer).toBeNull();
    expect(Object.keys(p).indexOf("timelineClips")).toBe(0); // key order (and so the file) unchanged
  });

  it("save → load → save round trip is byte-identical", () => {
    loadLongShow(3, 5);
    useProjectStore.getState().loadProjectDocument({
      metadata: { id: "rt-1", name: "Round trip" }, workspace: {}, render: {}, integrations: {},
      programmer: { timelineClips: [{ id: "x", startTime: 0, duration: 2, keys: [0, 0, 1, 80] }], studio: { recipes: [] }, audioDuration: 30 },
    }, "Round trip");
    const save = () => {
      const json = JSON.parse(JSON.stringify(serializeShow(useShowStore.getState(), useEngineeringStore.getState().getProjectPayload(), useProjectStore.getState().getProjectDocument())));
      delete json.savedAt;
      if (json.engineering) delete json.engineering.exported_at;
      return json;
    };
    const first = save();
    const state = deserializeShow(JSON.parse(JSON.stringify({ ...first, savedAt: "2026-10-22T00:00:00Z" })));
    useShowStore.getState().loadShow(state);
    useEngineeringStore.getState().loadProject(state.engineeringProject);
    useProjectStore.getState().loadProjectDocument(state.projectDocument, state.currentShow?.name);
    expect(JSON.stringify(save())).toBe(JSON.stringify(first));
  });
});

describe("waveform envelope", () => {
  it("keeps the peak per ~1 ms bin across channels and the AudioBuffer fields the waveform reads", () => {
    const rate = 48000, seconds = 2;
    const left = new Float32Array(rate * seconds), right = new Float32Array(rate * seconds);
    left[100] = -0.8; right[48000 + 10] = 0.5;
    const buffer = { sampleRate: rate, length: left.length, duration: seconds, numberOfChannels: 2, getChannelData: (i) => (i ? right : left) };
    const env = waveformEnvelope(buffer);
    expect(env.sampleRate).toBe(1000);
    expect(env.duration).toBe(2);
    expect(env.length).toBe(2000);
    const data = env.getChannelData(0);
    expect(data).toBeInstanceOf(Float32Array);
    expect(data[2]).toBeCloseTo(0.8);
    expect(data[1000]).toBeCloseTo(0.5);
    expect(data[500]).toBe(0);
    // A 5:28 stereo song at 48 kHz: 126 MB decoded vs ~1.3 MB envelope.
    expect(data.byteLength * 96).toBe(left.byteLength + right.byteLength);
    expect(waveformEnvelope(null)).toBeNull();
  });
});
