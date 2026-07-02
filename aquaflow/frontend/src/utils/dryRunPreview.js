/**
 * dryRunPreview.js — Frontend-only dry-run playback
 * 
 * Creates a preview session that compiles timeline clips
 * and allows safe playback WITHOUT any hardware output.
 * 
 * Usage:
 *   const session = await createDryRunPreviewSession({
 *     timelineClips: timelineClips,
 *     deviceRegistry: deviceRegistry,
 *     audioDuration: audioDuration,
 *     bpm: bpmFromStore,
 *   });
 *   
 *   session.seek(5.0);
 *   const state = session.evaluateAllChannels(5.0);
 *   const events = session.getEventsInWindow(4.0, 6.0);
 */

import { compileShow } from "./runtimeEventCompiler.js";
import { RuntimePlaybackQueue } from "./runtimePlaybackQueue.js";
import { EASING } from "./runtimeSignalSchema.js";

/**
 * Create a dry-run preview session from timeline clips
 * 
 * @param {Object} params
 * @param {Array} params.timelineClips - Clips from ShowProgrammer state
 * @param {Object} params.deviceRegistry - Device address map
 * @param {number} params.audioDuration - Show duration in seconds
 * @param {number} params.bpm - Show BPM (for beat grid)
 * @param {Array} [params.beatMarkers=[]] - Optional beat markers
 * @param {Array} [params.cues=[]] - Optional cue points
 * 
 * @returns {Promise<Object>} Preview session object
 */
export async function createDryRunPreviewSession({
  timelineClips = [],
  deviceRegistry = {},
  audioDuration = 120,
  bpm = 128,
  beatMarkers = [],
  cues = [],
}) {
  // Step 1: Compile clips to events (frontend-only, no backend call)
  const { compiled, errors, warnings } = compileShow({
    timelineClips,
    deviceRegistry,
    audioDuration,
    bpm,
    beatMarkers,
    cues,
    options: {
      ignoreErrors: false,
      ignoreSafetyErrors: true, // Safety errors don't block preview
    },
  });

  if (!compiled || errors.length > 0) {
    console.warn('[dryRunPreview] Compilation had errors:', errors);
    return {
      success: false,
      errors,
      warnings,
      queue: null,
      events: [],
      eventCount: 0,
    };
  }

  // Step 2: Extract events from compiled show
  const events = compiled.events || [];
  
  // Step 3: Ensure events have eventId (they should from compiler)
  const eventsWithIds = events.map((event, index) => ({
    ...event,
    eventId: event.eventId || `evt_fallback_${index}`,
  }));

  // Step 4: Create playback queue
  const queue = new RuntimePlaybackQueue(eventsWithIds);
  const previewIndex = buildPreviewIndex(eventsWithIds);

  let playbackStatus = "stopped";
  let lastPosition = 0;

  const normalizeSessionTime = (time) => {
    const n = Number(time);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(n, compiled.duration || audioDuration || 0));
  };

  // Step 5: Return session object
  return {
    success: true,
    errors: [],
    warnings,
    queue,
    events: eventsWithIds,
    eventCount: eventsWithIds.length,
    duration: compiled.duration,
    bpm: compiled.bpm,
    deviceMap: compiled.deviceMap,

    // --- Session Methods ---

    /**
     * Seek to a specific time position
     * @param {number} time - Time in seconds
     */
    seek: (time) => {
      const safeTime = normalizeSessionTime(time);
      lastPosition = safeTime;
      return queue.seek(safeTime);
    },

    /**
     * Pause dry-run playback without clearing events
     */
    pause: () => {
      playbackStatus = "paused";
      return queue.pause();
    },

    /**
     * Resume dry-run playback from the current or supplied time
     */
    resume: (time = lastPosition) => {
      const safeTime = normalizeSessionTime(time);
      lastPosition = safeTime;
      playbackStatus = "playing";
      return queue.resume(safeTime);
    },

    /**
     * Replay from the beginning
     */
    replay: () => {
      playbackStatus = "playing";
      lastPosition = 0;
      return queue.replay();
    },

    /**
     * Get current queue state
     */
    getState: () => {
      return {
        ...queue.getState(),
        playbackStatus,
        lastPosition,
      };
    },

    /**
     * Get events that occur between fromTime and toTime
     * @param {number} fromTime - Start time exclusive
     * @param {number} toTime - End time inclusive
     */
    getEventsInWindow: (fromTime, toTime) => {
      const safeFrom = normalizeSessionTime(fromTime);
      const safeTo = normalizeSessionTime(toTime);

      if (safeTo < safeFrom) {
        queue.seek(safeTo);
        return [];
      }

      lastPosition = safeTo;
      return queue.getEventsInWindow(safeFrom, safeTo);
    },

    /**
     * Get all events read-only
     */
    getAllEvents: () => {
      return eventsWithIds.map((event) => ({ ...event }));
    },

    /**
     * Evaluate all channels at a given playhead position
     * Returns { deviceId: { channelId: value } }
     * @param {number} playhead - Time in seconds
     */
    evaluateAllChannels: (playhead) => {
      const safePlayhead = normalizeSessionTime(playhead);
      lastPosition = safePlayhead;

      if (safePlayhead >= (compiled.duration || audioDuration || 0)) {
        queue.seek(safePlayhead);
      }

      return evaluateAllChannelsPreview(previewIndex, safePlayhead);
    },

    /**
     * Evaluate a single channel at a given playhead
     * @param {number} playhead - Time in seconds
     * @param {string} deviceId - Device identifier
     * @param {string} channelId - Channel identifier
     */
    evaluateChannel: (playhead, deviceId, channelId) => {
      const safePlayhead = normalizeSessionTime(playhead);
      lastPosition = safePlayhead;
      return evaluateChannelPreview(previewIndex, deviceId, channelId, safePlayhead);
    },

    /**
     * Reset playback to beginning
     */
    reset: () => {
      playbackStatus = "stopped";
      lastPosition = 0;
      queue.reset();
      return queue.getState();
    },

    /**
     * Cleanup dry-run playback session
     */
    cleanup: () => {
      playbackStatus = "stopped";
      lastPosition = 0;
      queue.cleanup();
    },

    /**
     * Check if all events have been processed
     */
    isExhausted: () => {
      return queue.isExhausted();
    },

    /**
     * Get next event time for scheduling
     */
    getNextEventTime: () => {
      return queue.getNextEventTime();
    },

    /**
     * Get all device IDs that have events
     */
    getDeviceIds: () => {
      return Array.from(previewIndex.deviceIds);
    },

    /**
     * Get all channel IDs for a specific device
     * @param {string} deviceId
     */
    getDeviceChannels: (deviceId) => {
      return Array.from(previewIndex.deviceChannels.get(deviceId) || []);
    },
  };
}

// ─── Internal Preview Evaluation ─────────────────────────────────────────────

const toPreviewNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function buildPreviewIndex(events = []) {
  const channelEvents = new Map();
  const deviceIds = new Set();
  const deviceChannels = new Map();

  for (const event of events) {
    if (!event.deviceId || !event.channelId) continue;

    const safeEvent = {
      ...event,
      time: Math.max(0, toPreviewNumber(event.time, 0)),
      value: toPreviewNumber(event.value, 0),
    };

    const key = `${safeEvent.deviceId}::${safeEvent.channelId}`;

    if (!channelEvents.has(key)) {
      channelEvents.set(key, []);
    }

    channelEvents.get(key).push(safeEvent);
    deviceIds.add(safeEvent.deviceId);

    if (!deviceChannels.has(safeEvent.deviceId)) {
      deviceChannels.set(safeEvent.deviceId, new Set());
    }

    deviceChannels.get(safeEvent.deviceId).add(safeEvent.channelId);
  }

  for (const list of channelEvents.values()) {
    list.sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      if ((a.priority || 0) !== (b.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      return String(a.eventId || "").localeCompare(String(b.eventId || ""));
    });
  }

  return {
    channelEvents,
    deviceIds,
    deviceChannels,
  };
}

/**
 * Evaluate a single channel at playhead position
 */
function evaluateChannelPreview(previewIndex, deviceId, channelId, playhead) {
  const key = `${deviceId}::${channelId}`;
  const relevant = previewIndex.channelEvents.get(key) || [];

  if (relevant.length === 0) return 0;

  const safePlayhead = Math.max(0, toPreviewNumber(playhead, 0));

  let prevIdx = -1;

  for (let i = 0; i < relevant.length; i++) {
    if (relevant[i].time <= safePlayhead) {
      prevIdx = i;
    } else {
      break;
    }
  }

  if (prevIdx === -1) return 0;

  const prev = relevant[prevIdx];
  const next = relevant[prevIdx + 1] ?? null;

  if (!next || prev.easing === EASING.STEP) {
    return toPreviewNumber(prev.value, 0);
  }

  const span = next.time - prev.time;

  if (!Number.isFinite(span) || span <= 0) {
    return toPreviewNumber(next.value ?? prev.value, 0);
  }

  const t = Math.max(0, Math.min(1, (safePlayhead - prev.time) / span));

  return applyEasingPreview(
    prev.easing,
    t,
    toPreviewNumber(prev.value, 0),
    toPreviewNumber(next.value, 0)
  );
}

/**
 * Apply easing function for interpolation
 */
function applyEasingPreview(type, t, from, to) {
  const range = to - from;

  switch (type) {
    case EASING.STEP:
      return t < 1 ? from : to;

    case EASING.LINEAR:
      return from + range * t;

    case EASING.EASE_IN:
      return from + range * (t * t);

    case EASING.EASE_OUT:
      return from + range * (1 - (1 - t) * (1 - t));

    case EASING.EASE_BOTH: {
      const c = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      return from + range * c;
    }

    case EASING.SINE:
    case "sine": {
      const c = 0.5 - Math.cos(t * Math.PI) / 2;
      return from + range * c;
    }

    default:
      return from + range * t;
  }
}

/**
 * Evaluate all channels at playhead position
 */
function evaluateAllChannelsPreview(previewIndex, playhead) {
  const result = {};

  for (const [pair] of previewIndex.channelEvents) {
    const [deviceId, channelId] = pair.split("::");
    const value = evaluateChannelPreview(previewIndex, deviceId, channelId, playhead);

    if (!result[deviceId]) {
      result[deviceId] = {};
    }

    result[deviceId][channelId] = value;
  }

  return result;
}


export default { createDryRunPreviewSession };