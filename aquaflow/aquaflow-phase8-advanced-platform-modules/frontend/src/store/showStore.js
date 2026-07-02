import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import { buildRuntimeSignature } from "../utils/runtimeSync";

const DEFAULT_SHOW = {
  id: "show-001",
  name: "Untitled Show",
  bpm: 128,
  duration: 240,
  sampleRate: 48000,
  loop: false,
};

const INITIAL_NODES = [
  {
    id: "node-master-pump",
    type: "pump",
    label: "Master Pump Array",
    x: 160, y: 100,
    width: 180, height: 80,
    ports: { in: ["trigger", "speed"], out: ["flow"] },
    params: { speed: 75, rampTime: 1.2, maxPressure: 8.5 },
    protocol: "modbus",
    deviceId: "pump-01",
    status: "online",
  },
  {
    id: "node-dmx-lights",
    type: "lighting",
    label: "RGB Ring Lights",
    x: 420, y: 80,
    width: 180, height: 80,
    ports: { in: ["trigger", "color", "intensity"], out: ["feedback"] },
    params: { universe: 1, startAddr: 1, channels: 48 },
    protocol: "dmx",
    deviceId: "light-01",
    status: "online",
  },
  {
    id: "node-solenoid-bank",
    type: "valve",
    label: "Solenoid Bank A",
    x: 160, y: 260,
    width: 180, height: 80,
    ports: { in: ["trigger", "pattern"], out: ["flow"] },
    params: { valveCount: 12, openTime: 200, pressure: 4.2 },
    protocol: "artnet",
    deviceId: "valve-01",
    status: "online",
  },
  {
    id: "node-sequence",
    type: "sequencer",
    label: "Pattern Sequencer",
    x: 420, y: 260,
    width: 180, height: 80,
    ports: { in: ["clock", "reset"], out: ["trigger", "pattern"] },
    params: { steps: 16, divisions: "1/16", swing: 0 },
    protocol: null,
    deviceId: null,
    status: "ready",
  },
  {
    id: "node-audio-in",
    type: "audio",
    label: "Audio Analyzer",
    x: 290, y: 420,
    width: 180, height: 80,
    ports: { in: ["audio"], out: ["beat", "bass", "mid", "treble", "bpm"] },
    params: { sensitivity: 0.8, smoothing: 0.4, beatThreshold: 0.7 },
    protocol: null,
    deviceId: null,
    status: "ready",
  },
];

const INITIAL_CONNECTIONS = [
  { id: "conn-1", from: "node-audio-in", fromPort: "beat", to: "node-sequence", toPort: "clock" },
  { id: "conn-2", from: "node-sequence", fromPort: "trigger", to: "node-solenoid-bank", toPort: "trigger" },
  { id: "conn-3", from: "node-sequence", fromPort: "pattern", to: "node-solenoid-bank", toPort: "pattern" },
  { id: "conn-4", from: "node-audio-in", fromPort: "bass", to: "node-master-pump", toPort: "speed" },
  { id: "conn-5", from: "node-audio-in", fromPort: "treble", to: "node-dmx-lights", toPort: "intensity" },
];

const TRACK_COLORS = {
  pump: "#00d4ff",
  valve: "#8b5cf6",
  lighting: "#f59e0b",
  flame: "#ef4444",
  fog: "#6b7280",
  laser: "#f97316",
  audio: "#10b981",
};

const TRACK_TYPE_ORDER = ["pump", "valve", "lighting", "flame", "fog", "laser", "audio"];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundTime = (value) => Number(Number(value || 0).toFixed(3));
const getBeatStep = (show, subdivision = 0.25) => {
  const bpm = Math.max(1, Number(show?.bpm || 120));
  return Math.max(0.05, (60 / bpm) * subdivision);
};
const getDefaultClipSpan = (show) => Math.max(0.5, getBeatStep(show, 1));
const getMinClipDuration = (show) => Math.max(0.1, getBeatStep(show, 0.25));
const MAX_HISTORY_ENTRIES = 80;
const cloneHistoryValue = (value) => JSON.parse(JSON.stringify(value));
const buildHistorySnapshot = (state) => ({
  currentShow: cloneHistoryValue(state.currentShow),
  nodes: cloneHistoryValue(state.nodes),
  connections: cloneHistoryValue(state.connections),
  timelineTracks: cloneHistoryValue(state.timelineTracks),
  devices: cloneHistoryValue(state.devices),
  selectedNodeId: state.selectedNodeId ?? null,
  selectedClipId: state.selectedClipId ?? null,
  selectedClipIds: cloneHistoryValue(state.selectedClipIds || []),
  selectedTrackId: state.selectedTrackId ?? null,
  selectedDeviceId: state.selectedDeviceId ?? null,
});
const syncHistoryFlags = (state) => {
  state.canUndo = state.undoStack.length > 0;
  state.canRedo = state.redoStack.length > 0;
};
const pushUndoSnapshot = (state, snapshot = buildHistorySnapshot(state)) => {
  state.undoStack.push(snapshot);
  if (state.undoStack.length > MAX_HISTORY_ENTRIES) state.undoStack.shift();
  state.redoStack = [];
  state.pendingHistorySnapshot = null;
  syncHistoryFlags(state);
};
const beginHistoryTransactionState = (state) => {
  if (!state.pendingHistorySnapshot) state.pendingHistorySnapshot = buildHistorySnapshot(state);
};
const commitHistoryTransactionState = (state) => {
  if (!state.pendingHistorySnapshot) return false;
  pushUndoSnapshot(state, state.pendingHistorySnapshot);
  state.pendingHistorySnapshot = null;
  syncHistoryFlags(state);
  return true;
};
const cancelHistoryTransactionState = (state) => {
  state.pendingHistorySnapshot = null;
};
const resetHistoryState = (state) => {
  state.undoStack = [];
  state.redoStack = [];
  state.pendingHistorySnapshot = null;
  syncHistoryFlags(state);
};
const applyHistorySnapshot = (state, snapshot) => {
  if (!snapshot) return;
  state.currentShow = cloneHistoryValue(snapshot.currentShow || DEFAULT_SHOW);
  state.nodes = cloneHistoryValue(snapshot.nodes || []);
  state.connections = cloneHistoryValue(snapshot.connections || []);
  state.timelineTracks = (snapshot.timelineTracks || []).map((track) => normalizeTrack(track));
  state.devices = cloneHistoryValue(snapshot.devices || []);
  state.selectedNodeId = snapshot.selectedNodeId ?? null;
  state.selectedClipId = snapshot.selectedClipId ?? null;
  state.selectedClipIds = cloneHistoryValue(snapshot.selectedClipIds || (snapshot.selectedClipId ? [snapshot.selectedClipId] : []));
  state.selectedTrackId = snapshot.selectedTrackId ?? null;
  state.selectedDeviceId = snapshot.selectedDeviceId ?? null;
};
const snapTimeValue = (value, show, enabled) => {
  if (!enabled) return roundTime(Math.max(0, Number(value || 0)));
  const step = getBeatStep(show, 0.25);
  return roundTime(Math.round(Math.max(0, Number(value || 0)) / step) * step);
};

const normalizeClip = (clip = {}, index = 0) => {
  const start = roundTime(Math.max(0, Number(clip.start ?? 0)));
  const endCandidate = Number(clip.end ?? start + 1);
  const end = roundTime(Math.max(start + 0.1, endCandidate));
  return {
    ...clip,
    id: clip.id || nanoid(),
    start,
    end,
    label: clip.label || `Cue ${index + 1}`,
    intensity: clamp(Number(clip.intensity ?? 80), 0, 100),
  };
};

const normalizeTrack = (track = {}) => ({
  ...track,
  id: track.id || nanoid(),
  label: track.label || `${String(track.type || "track").charAt(0).toUpperCase()}${String(track.type || "track").slice(1)} Track`,
  color: track.color || TRACK_COLORS[track.type] || "#94a3b8",
  type: track.type || "pump",
  deviceId: track.deviceId ?? null,
  muted: Boolean(track.muted),
  solo: Boolean(track.solo),
  clips: Array.isArray(track.clips) ? track.clips.map((clip, idx) => normalizeClip(clip, idx)).sort((a, b) => a.start - b.start) : [],
});

const createTimelineTrack = (type, device) => normalizeTrack({
  id: nanoid(),
  label: device?.label || `${type.charAt(0).toUpperCase()}${type.slice(1)} Track`,
  color: TRACK_COLORS[type] || "#94a3b8",
  type,
  deviceId: device?.id || null,
  muted: false,
  solo: false,
  clips: [],
});

const healTrackClips = (clips = [], show) => {
  const minDuration = getMinClipDuration(show);
  const normalized = (clips || [])
    .map((clip, idx) => normalizeClip(clip, idx))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let cursor = 0;
  return normalized.map((clip, idx) => {
    const duration = Math.max(minDuration, roundTime(Number(clip.end) - Number(clip.start)));
    const start = roundTime(Math.max(cursor, Number(clip.start)));
    const end = roundTime(start + duration);
    cursor = end;
    return normalizeClip({ ...clip, start, end }, idx);
  });
};

const collectSelectedClipIds = (state) => {
  const validIds = new Set();
  state.timelineTracks.forEach((track) => {
    (track.clips || []).forEach((clip) => validIds.add(clip.id));
  });
  return (state.selectedClipIds || []).filter((clipId) => validIds.has(clipId));
};

const syncClipSelectionState = (state, preferredClipId = null) => {
  const selectedIds = collectSelectedClipIds(state);
  state.selectedClipIds = selectedIds;
  if (!selectedIds.length) {
    state.selectedClipId = null;
    return;
  }
  if (preferredClipId && selectedIds.includes(preferredClipId)) {
    state.selectedClipId = preferredClipId;
    return;
  }
  if (state.selectedClipId && selectedIds.includes(state.selectedClipId)) {
    return;
  }
  state.selectedClipId = selectedIds[selectedIds.length - 1];
};

const getTimelineClipSelection = (state) => {
  const selectedIds = state.selectedClipIds?.length
    ? state.selectedClipIds
    : (state.selectedClipId ? [state.selectedClipId] : []);
  const trackMap = new Map();
  state.timelineTracks.forEach((track) => {
    (track.clips || []).forEach((clip) => {
      if (selectedIds.includes(clip.id)) {
        if (!trackMap.has(track.id)) trackMap.set(track.id, []);
        trackMap.get(track.id).push(clip);
      }
    });
  });
  return { selectedIds, trackMap };
};

const INITIAL_TIMELINE_TRACKS = [
  normalizeTrack({
    id: "track-1", label: "Master Pump", color: "#00d4ff", type: "pump", deviceId: "pump-01",
    clips: [
      { id: "clip-1", start: 0, end: 16, label: "Intro Surge", intensity: 60 },
      { id: "clip-2", start: 20, end: 48, label: "Build", intensity: 80 },
      { id: "clip-3", start: 52, end: 96, label: "Main Show", intensity: 100 },
      { id: "clip-4", start: 100, end: 120, label: "Drop", intensity: 90 },
      { id: "clip-5", start: 136, end: 160, label: "Finale", intensity: 100 },
    ],
  }),
  normalizeTrack({
    id: "track-2", label: "Solenoid Bank A", color: "#8b5cf6", type: "valve", deviceId: "valve-01",
    clips: [
      { id: "clip-6", start: 4, end: 12, label: "Pattern 1", intensity: 70 },
      { id: "clip-7", start: 24, end: 40, label: "Cascade", intensity: 85 },
      { id: "clip-8", start: 56, end: 88, label: "Full Open", intensity: 100 },
      { id: "clip-9", start: 104, end: 116, label: "Burst", intensity: 95 },
      { id: "clip-10", start: 140, end: 162, label: "Finale", intensity: 100 },
    ],
  }),
  normalizeTrack({
    id: "track-3", label: "RGB Ring Lights", color: "#f59e0b", type: "lighting", deviceId: "light-01",
    clips: [
      { id: "clip-11", start: 0, end: 20, label: "Blue Wash", intensity: 50 },
      { id: "clip-12", start: 20, end: 52, label: "Pulse Beat", intensity: 75 },
      { id: "clip-13", start: 52, end: 100, label: "Full Color", intensity: 100 },
      { id: "clip-14", start: 100, end: 124, label: "Strobe", intensity: 90 },
      { id: "clip-15", start: 136, end: 164, label: "Grand Finale", intensity: 100 },
    ],
  }),
  normalizeTrack({
    id: "track-4", label: "Flame System", color: "#ef4444", type: "flame", deviceId: "flame-01",
    clips: [
      { id: "clip-16", start: 48, end: 56, label: "Burst 1", intensity: 100 },
      { id: "clip-17", start: 96, end: 104, label: "Burst 2", intensity: 100 },
      { id: "clip-18", start: 148, end: 160, label: "Grand Burst", intensity: 100 },
    ],
  }),
  normalizeTrack({
    id: "track-5", label: "Audio Reactive", color: "#10b981", type: "audio", deviceId: null,
    clips: [
      { id: "clip-19", start: 0, end: 164, label: "Main Mix", intensity: 80 },
    ],
  }),
];

const INITIAL_DEVICES = [
  { id: "pump-01", label: "Master Pump Array", type: "pump", protocol: "modbus", ip: "192.168.1.10", port: 502, status: "online", health: 98 },
  { id: "pump-02", label: "Side Pumps", type: "pump", protocol: "modbus", ip: "192.168.1.11", port: 502, status: "online", health: 96 },
  { id: "valve-01", label: "Solenoid Bank A", type: "valve", protocol: "artnet", ip: "192.168.1.20", port: 6454, status: "online", health: 100 },
  { id: "valve-02", label: "Solenoid Bank B", type: "valve", protocol: "artnet", ip: "192.168.1.21", port: 6454, status: "online", health: 100 },
  { id: "light-01", label: "RGB Ring Lights", type: "lighting", protocol: "dmx", ip: null, port: null, status: "online", health: 92 },
  { id: "light-02", label: "Spotlights", type: "lighting", protocol: "sacn", ip: "192.168.1.30", port: 5568, status: "online", health: 88 },
  { id: "flame-01", label: "Flame System", type: "flame", protocol: "modbus", ip: "192.168.1.40", port: 502, status: "offline", health: 0 },
  { id: "fog-01", label: "Fog Machines", type: "fog", protocol: "dmx", ip: null, port: null, status: "warn", health: 65 },
  { id: "laser-01", label: "Laser Array", type: "laser", protocol: "ilda", ip: "192.168.1.50", port: 7770, status: "offline", health: 0 },
  { id: "sensor-01", label: "Pressure Sensor", type: "sensor", protocol: "mqtt", ip: "192.168.1.60", port: 1883, status: "online", health: 100 },
];

function findTrack(state, trackId) {
  return state.timelineTracks.find((track) => track.id === trackId);
}

function ensureShowDuration(state, value) {
  if (value > Number(state.currentShow.duration || 0)) {
    state.currentShow.duration = roundTime(value);
  }
}

export const useShowStore = create(
  immer((set, get) => ({
    currentShow: DEFAULT_SHOW,
    nodes: INITIAL_NODES,
    connections: INITIAL_CONNECTIONS,
    timelineTracks: INITIAL_TIMELINE_TRACKS,
    timelineZoom: 4,
    playhead: 0,
    devices: INITIAL_DEVICES,
    selectedNodeId: null,
    selectedClipId: null,
    selectedClipIds: [],
    selectedTrackId: null,
    selectedDeviceId: null,
    playbackState: "stopped",
    showGrid: true,
    snapToGrid: true,
    gridSize: 20,
    connectionState: "disconnected",
    serverLogs: [],
    telemetry: {},
    isDirty: false,
    lastServerSyncAt: null,
    serverMirrorSignature: null,
    serverRevision: 0,
    undoStack: [],
    redoStack: [],
    pendingHistorySnapshot: null,
    canUndo: false,
    canRedo: false,

    beginHistoryTransaction: () => set((s) => {
      beginHistoryTransactionState(s);
    }),

    commitHistoryTransaction: () => set((s) => {
      commitHistoryTransactionState(s);
    }),

    cancelHistoryTransaction: () => set((s) => {
      cancelHistoryTransactionState(s);
    }),

    undo: () => set((s) => {
      if (!s.undoStack.length) return;
      const previous = s.undoStack.pop();
      s.redoStack.push(buildHistorySnapshot(s));
      applyHistorySnapshot(s, previous);
      s.isDirty = true;
      s.pendingHistorySnapshot = null;
      syncHistoryFlags(s);
    }),

    redo: () => set((s) => {
      if (!s.redoStack.length) return;
      const next = s.redoStack.pop();
      s.undoStack.push(buildHistorySnapshot(s));
      if (s.undoStack.length > MAX_HISTORY_ENTRIES) s.undoStack.shift();
      applyHistorySnapshot(s, next);
      s.isDirty = true;
      s.pendingHistorySnapshot = null;
      syncHistoryFlags(s);
    }),

    clearSelection: () => set((s) => {
      s.selectedNodeId = null;
      s.selectedDeviceId = null;
      s.selectedClipId = null;
      s.selectedClipIds = [];
      s.selectedTrackId = null;
    }),

    selectNode: (id) => set((s) => {
      s.selectedNodeId = id;
      s.selectedDeviceId = null;
      s.selectedClipId = null;
      s.selectedClipIds = [];
      s.selectedTrackId = null;
    }),

    selectDevice: (id) => set((s) => {
      s.selectedDeviceId = id;
      s.selectedNodeId = null;
      s.selectedClipId = null;
      s.selectedClipIds = [];
      s.selectedTrackId = null;
    }),

    selectTrack: (trackId) => set((s) => {
      s.selectedTrackId = trackId;
      s.selectedClipId = null;
      s.selectedClipIds = [];
      s.selectedNodeId = null;
      s.selectedDeviceId = null;
    }),

    selectClip: (trackId, clipId) => set((s) => {
      s.selectedTrackId = trackId;
      s.selectedClipId = clipId;
      s.selectedClipIds = clipId ? [clipId] : [];
      s.selectedNodeId = null;
      s.selectedDeviceId = null;
    }),

    toggleClipSelection: (trackId, clipId) => set((s) => {
      const existing = new Set(s.selectedClipIds || []);
      if (existing.has(clipId)) {
        existing.delete(clipId);
      } else {
        existing.add(clipId);
      }
      s.selectedTrackId = trackId;
      s.selectedClipIds = [...existing];
      s.selectedClipId = s.selectedClipIds.length ? clipId : null;
      s.selectedNodeId = null;
      s.selectedDeviceId = null;
    }),

    setSelectedClips: (trackId, clipIds = []) => set((s) => {
      const uniqueIds = [...new Set((clipIds || []).filter(Boolean))];
      s.selectedTrackId = trackId;
      s.selectedClipIds = uniqueIds;
      s.selectedClipId = uniqueIds[uniqueIds.length - 1] || null;
      s.selectedNodeId = null;
      s.selectedDeviceId = null;
    }),

    clearClipSelection: () => set((s) => {
      s.selectedClipId = null;
      s.selectedClipIds = [];
    }),

    updateNodeParam: (nodeId, key, value, options = {}) =>
      set((s) => {
        const node = s.nodes.find((n) => n.id === nodeId);
        if (node) {
          if (options.captureHistory !== false) pushUndoSnapshot(s);
          node.params[key] = value;
          s.isDirty = true;
        }
      }),

    moveNode: (nodeId, x, y, options = {}) =>
      set((s) => {
        const node = s.nodes.find((n) => n.id === nodeId);
        if (node) {
          if (options.captureHistory !== false) pushUndoSnapshot(s);
          node.x = x;
          node.y = y;
          s.isDirty = true;
        }
      }),

    addNode: (type, x, y) =>
      set((s) => {
        pushUndoSnapshot(s);
        const nodeId = nanoid();
        s.nodes.push({
          id: nodeId,
          type,
          label: type.charAt(0).toUpperCase() + type.slice(1),
          x,
          y,
          width: 180,
          height: 80,
          ports: { in: ["trigger"], out: ["out"] },
          params: {},
          protocol: null,
          deviceId: null,
          status: "ready",
        });
        s.selectedNodeId = nodeId;
        s.selectedDeviceId = null;
        s.selectedClipId = null;
        s.selectedClipIds = [];
        s.selectedTrackId = null;
        s.isDirty = true;
      }),

    addConnection: (from, fromPort, to, toPort) =>
      set((s) => {
        const exists = s.connections.some((c) => c.from === from && c.fromPort === fromPort && c.to === to && c.toPort === toPort);
        if (!exists) {
          pushUndoSnapshot(s);
          s.connections.push({ id: nanoid(), from, fromPort, to, toPort });
          s.isDirty = true;
        }
      }),

    addTimelineTrack: (preferredType = null) =>
      set((s) => {
        pushUndoSnapshot(s);
        const existingTypes = new Set(s.timelineTracks.map((t) => t.type));
        const inferredType = preferredType || TRACK_TYPE_ORDER.find((type) => !existingTypes.has(type)) || "pump";
        const preferredDevice = s.devices.find((d) => d.type === inferredType && !s.timelineTracks.some((t) => t.deviceId === d.id));
        const track = createTimelineTrack(inferredType, preferredDevice);
        s.timelineTracks.push(track);
        s.selectedTrackId = track.id;
        s.selectedClipId = null;
        s.selectedClipIds = [];
        s.isDirty = true;
      }),

    createTimelineClip: (trackId, insertAt = null, options = {}) =>
      set((s) => {
        const track = findTrack(s, trackId);
        if (!track) return;
        if (options.captureHistory !== false) pushUndoSnapshot(s);
        const baseStart = insertAt ?? s.playhead ?? 0;
        const start = snapTimeValue(baseStart, s.currentShow, s.snapToGrid);
        const span = getDefaultClipSpan(s.currentShow);
        const end = roundTime(start + span);
        const clip = normalizeClip({
          id: nanoid(),
          start,
          end,
          label: `${track.label} Cue ${(track.clips?.length || 0) + 1}`,
          intensity: 80,
        }, track.clips?.length || 0);
        track.clips = healTrackClips([...(track.clips || []), clip], s.currentShow);
        ensureShowDuration(s, track.clips.at(-1)?.end || end);
        s.selectedTrackId = track.id;
        s.selectedClipId = clip.id;
        s.selectedClipIds = [clip.id];
        s.selectedNodeId = null;
        s.selectedDeviceId = null;
        s.isDirty = true;
      }),

    updateTimelineClip: (trackId, clipId, patch, options = {}) =>
      set((s) => {
        const track = findTrack(s, trackId);
        if (!track) return;
        const clip = track.clips?.find((entry) => entry.id === clipId);
        if (!clip) return;
        if (options.captureHistory !== false) pushUndoSnapshot(s);

        const minDuration = getMinClipDuration(s.currentShow);
        let nextStart = patch.start !== undefined ? Number(patch.start) : Number(clip.start);
        let nextEnd = patch.end !== undefined ? Number(patch.end) : Number(clip.end);

        if (s.snapToGrid) {
          nextStart = snapTimeValue(nextStart, s.currentShow, true);
          nextEnd = snapTimeValue(nextEnd, s.currentShow, true);
        } else {
          nextStart = roundTime(nextStart);
          nextEnd = roundTime(nextEnd);
        }

        nextStart = Math.max(0, nextStart);
        nextEnd = Math.max(nextStart + minDuration, nextEnd);

        clip.start = nextStart;
        clip.end = nextEnd;
        if (patch.label !== undefined) clip.label = patch.label || clip.label;
        if (patch.intensity !== undefined) clip.intensity = clamp(Number(patch.intensity), 0, 100);
        if (patch.id !== undefined) clip.id = patch.id;

        track.clips = healTrackClips(track.clips || [], s.currentShow);
        ensureShowDuration(s, track.clips.at(-1)?.end || nextEnd);
        s.selectedTrackId = track.id;
        if (!(s.selectedClipIds || []).includes(clipId)) s.selectedClipIds = [clipId];
        syncClipSelectionState(s, clipId);
        s.isDirty = true;
      }),

    removeTimelineClip: (trackId, clipId) =>
      set((s) => {
        const track = findTrack(s, trackId);
        if (!track) return;
        const before = track.clips?.length || 0;
        const nextClips = (track.clips || []).filter((clip) => clip.id !== clipId);
        if ((nextClips?.length || 0) !== before) {
          pushUndoSnapshot(s);
          track.clips = nextClips;
          s.selectedTrackId = track.id;
          s.selectedClipIds = (s.selectedClipIds || []).filter((id) => id !== clipId);
          syncClipSelectionState(s);
          s.isDirty = true;
        }
      }),

    duplicateTimelineClip: (trackId, clipId) =>
      set((s) => {
        const track = findTrack(s, trackId);
        if (!track) return;
        const clip = track.clips?.find((entry) => entry.id === clipId);
        if (!clip) return;
        pushUndoSnapshot(s);
        const offset = s.snapToGrid ? getBeatStep(s.currentShow, 0.25) : 0.25;
        const duration = Math.max(getMinClipDuration(s.currentShow), Number(clip.end) - Number(clip.start));
        const start = snapTimeValue(Number(clip.end) + offset, s.currentShow, s.snapToGrid);
        const end = roundTime(start + duration);
        const duplicate = normalizeClip({
          ...clip,
          id: nanoid(),
          start,
          end,
          label: `${clip.label} Copy`,
        }, track.clips?.length || 0);
        track.clips = healTrackClips([...(track.clips || []), duplicate], s.currentShow);
        ensureShowDuration(s, track.clips.at(-1)?.end || end);
        s.selectedTrackId = track.id;
        s.selectedClipId = duplicate.id;
        s.selectedClipIds = [duplicate.id];
        s.isDirty = true;
      }),

    removeSelectedTimelineClips: () =>
      set((s) => {
        const { selectedIds } = getTimelineClipSelection(s);
        if (!selectedIds.length) return;
        pushUndoSnapshot(s);
        const selectedSet = new Set(selectedIds);
        s.timelineTracks.forEach((track) => {
          track.clips = (track.clips || []).filter((clip) => !selectedSet.has(clip.id));
        });
        s.selectedClipId = null;
        s.selectedClipIds = [];
        s.isDirty = true;
      }),

    duplicateSelectedTimelineClips: () =>
      set((s) => {
        const { selectedIds, trackMap } = getTimelineClipSelection(s);
        if (!selectedIds.length) return;
        pushUndoSnapshot(s);
        const offset = s.snapToGrid ? getBeatStep(s.currentShow, 0.25) : 0.25;
        const nextSelectedIds = [];
        const touchedTrackIds = [];

        s.timelineTracks.forEach((track) => {
          const selectedClips = (trackMap.get(track.id) || []).slice().sort((a, b) => a.start - b.start);
          if (!selectedClips.length) return;
          touchedTrackIds.push(track.id);
          const working = [...(track.clips || [])];
          selectedClips.forEach((clip) => {
            const duration = Math.max(getMinClipDuration(s.currentShow), Number(clip.end) - Number(clip.start));
            const start = snapTimeValue(Number(clip.end) + offset, s.currentShow, s.snapToGrid);
            const end = roundTime(start + duration);
            const duplicate = normalizeClip({
              ...clip,
              id: nanoid(),
              start,
              end,
              label: `${clip.label} Copy`,
            }, working.length);
            working.push(duplicate);
            nextSelectedIds.push(duplicate.id);
          });
          track.clips = healTrackClips(working, s.currentShow);
          ensureShowDuration(s, track.clips.at(-1)?.end || 0);
        });

        s.selectedTrackId = touchedTrackIds.length === 1 ? touchedTrackIds[0] : null;
        s.selectedClipIds = nextSelectedIds;
        s.selectedClipId = nextSelectedIds[nextSelectedIds.length - 1] || null;
        s.isDirty = true;
      }),

    moveTimelineTrack: (trackId, direction) =>
      set((s) => {
        const index = s.timelineTracks.findIndex((track) => track.id === trackId);
        if (index < 0) return;
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= s.timelineTracks.length) return;
        pushUndoSnapshot(s);
        const [track] = s.timelineTracks.splice(index, 1);
        s.timelineTracks.splice(nextIndex, 0, track);
        s.selectedTrackId = trackId;
        s.isDirty = true;
      }),

    healTimelineOverlaps: () =>
      set((s) => {
        pushUndoSnapshot(s);
        s.timelineTracks = s.timelineTracks.map((track) => {
          const healed = healTrackClips(track.clips || [], s.currentShow);
          ensureShowDuration(s, healed.at(-1)?.end || 0);
          return normalizeTrack({ ...track, clips: healed });
        });
        syncClipSelectionState(s);
        s.isDirty = true;
      }),

    toggleTrackMute: (trackId) =>
      set((s) => {
        const track = findTrack(s, trackId);
        if (!track) return;
        pushUndoSnapshot(s);
        track.muted = !track.muted;
        s.selectedTrackId = track.id;
        s.isDirty = true;
      }),

    toggleTrackSolo: (trackId) =>
      set((s) => {
        const track = findTrack(s, trackId);
        if (!track) return;
        pushUndoSnapshot(s);
        track.solo = !track.solo;
        s.selectedTrackId = track.id;
        s.isDirty = true;
      }),

    addDevice: (device) =>
      set((s) => {
        pushUndoSnapshot(s);
        const id = device.id || nanoid();
        s.devices.push({
          status: "offline",
          health: 0,
          ip: null,
          port: null,
          ...device,
          id,
        });
        s.selectedDeviceId = id;
        s.selectedNodeId = null;
        s.selectedClipId = null;
        s.selectedClipIds = [];
        s.selectedTrackId = null;
        s.isDirty = true;
      }),

    updateDevicePatch: (deviceId, patch) =>
      set((s) => {
        const device = s.devices.find((d) => d.id === deviceId);
        if (device) Object.assign(device, patch);
      }),

    quantizeTimeline: (subdivision = 0.25) =>
      set((s) => {
        pushUndoSnapshot(s);
        const step = getBeatStep(s.currentShow, subdivision);
        s.timelineTracks = s.timelineTracks.map((track) => normalizeTrack({
          ...track,
          clips: healTrackClips((track.clips || []).map((clip) => {
            const start = Math.max(0, Math.round(clip.start / step) * step);
            const end = Math.max(start + step, Math.round(clip.end / step) * step);
            return {
              ...clip,
              start: roundTime(start),
              end: roundTime(end),
            };
          }), s.currentShow),
        }));
        syncClipSelectionState(s);
        s.isDirty = true;
      }),

    autoGenerateTimeline: () =>
      set((s) => {
        pushUndoSnapshot(s);
        const beatSeconds = 60 / Math.max(1, s.currentShow.bpm || 120);
        const duration = Math.max(16, Number(s.currentShow.duration || 60));
        const targetTypes = TRACK_TYPE_ORDER.filter((type) => type !== "audio" && s.devices.some((d) => d.type === type));

        targetTypes.forEach((type, typeIndex) => {
          let track = s.timelineTracks.find((t) => t.type === type);
          if (!track) {
            const device = s.devices.find((d) => d.type === type && !s.timelineTracks.some((t) => t.deviceId === d.id));
            track = createTimelineTrack(type, device);
            s.timelineTracks.push(track);
          }

          if ((track.clips || []).length > 0) return;

          const clipSpan = Math.max(beatSeconds * 2, 1.0);
          const gap = Math.max(beatSeconds * 2, 0.5);
          const phase = typeIndex * beatSeconds;
          const clips = [];
          for (let t = phase; t < duration; t += clipSpan + gap) {
            const start = roundTime(t);
            const end = roundTime(Math.min(duration, start + clipSpan));
            clips.push({
              id: nanoid(),
              start,
              end,
              label: `${type.charAt(0).toUpperCase()}${type.slice(1)} Cue ${clips.length + 1}`,
              intensity: Math.max(35, Math.min(100, 55 + ((clips.length + typeIndex) % 4) * 12)),
            });
          }
          track.clips = healTrackClips(clips, s.currentShow);
        });

        s.timelineTracks = s.timelineTracks.map((track) => normalizeTrack(track));
        syncClipSelectionState(s);
        s.isDirty = true;
      }),

    setPlayback: (state) => set((s) => { s.playbackState = state; }),
    setPlayhead: (t) => set((s) => { s.playhead = t; }),
    setTimelineZoom: (z) => set((s) => { pushUndoSnapshot(s); s.timelineZoom = Math.max(1, Math.min(20, z)); }),
    toggleShowGrid: () => set((s) => { pushUndoSnapshot(s); s.showGrid = !s.showGrid; }),
    toggleSnapToGrid: () => set((s) => { pushUndoSnapshot(s); s.snapToGrid = !s.snapToGrid; }),

    setConnectionState: (state) =>
      set((s) => { s.connectionState = state; }),

    setPlaybackFromServer: (pb) =>
      set((s) => {
        if (pb.state) s.playbackState = pb.state;
        if (pb.playhead !== undefined) s.playhead = pb.playhead;
        if (pb.bpm !== undefined) s.currentShow.bpm = pb.bpm;
        if (pb.duration !== undefined) s.currentShow.duration = pb.duration;
        if (pb.loop !== undefined) s.currentShow.loop = pb.loop;
        if (pb.show_name) s.currentShow.name = pb.show_name;
        if (pb.show_id) s.currentShow.id = pb.show_id;
        if (pb.revision !== undefined) s.serverRevision = pb.revision;
        s.lastServerSyncAt = Date.now();
      }),

    updateDevicesFromServer: (serverDevices) =>
      set((s) => {
        serverDevices.forEach((sd) => {
          const existing = s.devices.find((d) => d.id === sd.id);
          if (existing) {
            Object.assign(existing, {
              label: sd.label ?? existing.label,
              type: sd.type ?? sd.device_type ?? existing.type,
              protocol: sd.protocol ?? existing.protocol,
              ip: sd.ip ?? existing.ip,
              port: sd.port ?? existing.port,
              status: sd.status ?? existing.status,
              health: sd.health ?? existing.health,
              last_seen: sd.last_seen ?? existing.last_seen,
            });
          } else {
            s.devices.push({
              status: "offline",
              health: 0,
              ...sd,
              type: sd.type ?? sd.device_type ?? "unknown",
            });
          }
        });
      }),

    applyServerNodeUpdate: (nodeId, key, value) =>
      set((s) => {
        const node = s.nodes.find((n) => n.id === nodeId);
        if (node) node.params[key] = value;
      }),

    applyServerShowSnapshot: (snapshot) =>
      set((s) => {
        const payload = snapshot?.currentShow ? snapshot : {
          currentShow: snapshot?.show || {},
          nodes: snapshot?.nodes || [],
          connections: snapshot?.connections || [],
          timelineTracks: snapshot?.timelineTracks || snapshot?.tracks || [],
          devices: snapshot?.devices || [],
          timelineZoom: snapshot?.ui?.timelineZoom,
          showGrid: snapshot?.ui?.showGrid,
          snapToGrid: snapshot?.ui?.snapToGrid,
        };
        if (payload.currentShow) Object.assign(s.currentShow, payload.currentShow);
        if (payload.nodes) s.nodes = payload.nodes;
        if (payload.connections) s.connections = payload.connections;
        if (payload.timelineTracks) s.timelineTracks = payload.timelineTracks.map((track) => normalizeTrack(track));
        if (payload.devices) s.devices = payload.devices;
        if (payload.timelineZoom !== undefined) s.timelineZoom = payload.timelineZoom;
        if (payload.showGrid !== undefined) s.showGrid = payload.showGrid;
        if (payload.snapToGrid !== undefined) s.snapToGrid = payload.snapToGrid;
        if (snapshot?.revision !== undefined) s.serverRevision = snapshot.revision;
        resetHistoryState(s);
        if (s.selectedTrackId && !s.timelineTracks.some((track) => track.id === s.selectedTrackId)) {
          s.selectedTrackId = null;
          s.selectedClipId = null;
          s.selectedClipIds = [];
        }
        syncClipSelectionState(s);
        s.serverMirrorSignature = buildRuntimeSignature({
          currentShow: s.currentShow,
          nodes: s.nodes,
          connections: s.connections,
          timelineTracks: s.timelineTracks,
          devices: s.devices,
          timelineZoom: s.timelineZoom,
          showGrid: s.showGrid,
          snapToGrid: s.snapToGrid,
        });
        s.lastServerSyncAt = Date.now();
      }),

    updateTelemetry: (deviceId, values) =>
      set((s) => {
        s.telemetry[deviceId] = { ...(s.telemetry[deviceId] || {}), ...values };
      }),

    addServerLog: (entry) =>
      set((s) => {
        s.serverLogs.unshift({ ...entry, ts: Date.now() });
        if (s.serverLogs.length > 200) s.serverLogs.length = 200;
      }),

    clearLogs: () => set((s) => { s.serverLogs = []; }),

    loadShow: (newState) =>
      set((s) => {
        if (newState.currentShow) Object.assign(s.currentShow, newState.currentShow);
        if (newState.nodes) s.nodes = newState.nodes;
        if (newState.connections) s.connections = newState.connections;
        if (newState.timelineTracks) s.timelineTracks = newState.timelineTracks.map((track) => normalizeTrack(track));
        if (newState.devices) s.devices = newState.devices;
        if (newState.timelineZoom !== undefined) s.timelineZoom = newState.timelineZoom;
        if (newState.showGrid !== undefined) s.showGrid = newState.showGrid;
        if (newState.snapToGrid !== undefined) s.snapToGrid = newState.snapToGrid;
        s.playbackState = "stopped";
        s.playhead = 0;
        s.selectedNodeId = null;
        s.selectedClipId = null;
        s.selectedClipIds = [];
        s.selectedTrackId = null;
        s.selectedDeviceId = null;
        s.isDirty = false;
        resetHistoryState(s);
      }),

    setShowName: (name) =>
      set((s) => { pushUndoSnapshot(s); s.currentShow.name = name; s.isDirty = true; }),

    applyPatternToTrack: (trackType, clips) =>
      set((s) => {
        pushUndoSnapshot(s);
        let track = s.timelineTracks.find((t) => t.type === trackType);
        if (!track) {
          const mappedDevice = s.devices.find((d) => d.type === trackType);
          track = createTimelineTrack(trackType, mappedDevice);
          s.timelineTracks.push(track);
        }
        track.clips = healTrackClips((clips || []).map((clip, index) => normalizeClip({ ...clip, id: clip.id || nanoid() }, index)), s.currentShow);
        s.selectedTrackId = track.id;
        s.selectedClipId = track.clips[0]?.id || null;
        s.selectedClipIds = track.clips[0]?.id ? [track.clips[0].id] : [];
        s.isDirty = true;
      }),

    markDirty: () => set((s) => { s.isDirty = true; }),
    markClean: () => set((s) => { s.isDirty = false; }),
  }))
);
