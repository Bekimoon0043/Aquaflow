// frontend/src/utils/runtimePlaybackQueue.js
// Runtime playback queue for deterministic event execution

const toQueueNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizePlaybackEvent = (event = {}, index = 0) => {
  const safeTime = Math.max(0, toQueueNumber(event.time, 0));
  const safePriority = toQueueNumber(event.priority, 0);
  const safeValue = toQueueNumber(event.value, 0);

  return {
    ...event,
    time: safeTime,
    priority: safePriority,
    value: safeValue,
    eventId:
      event.eventId ||
      generateEventId(
        event.clipId || `clip_${index}`,
        event.channelId || "channel",
        safeTime,
        safeValue
      ),
    __queueOrder: index,
  };
};

const sortPlaybackEvents = (events = []) => {
  return [...events]
    .map((event, index) => normalizePlaybackEvent(event, index))
    .sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      if (a.priority !== b.priority) return b.priority - a.priority;

      const deviceCompare = String(a.deviceId || "").localeCompare(String(b.deviceId || ""));
      if (deviceCompare !== 0) return deviceCompare;

      const channelCompare = String(a.channelId || "").localeCompare(String(b.channelId || ""));
      if (channelCompare !== 0) return channelCompare;

      const clipCompare = String(a.clipId || "").localeCompare(String(b.clipId || ""));
      if (clipCompare !== 0) return clipCompare;

      const eventCompare = String(a.eventId || "").localeCompare(String(b.eventId || ""));
      if (eventCompare !== 0) return eventCompare;

      return a.__queueOrder - b.__queueOrder;
    });
};

export class RuntimePlaybackQueue {
  constructor(events = []) {
    this.events = sortPlaybackEvents(events);
    this.currentIndex = 0;
    this.lastExecutedIndex = -1;
    this.lastWindowEnd = 0;
    this.paused = false;
  }

  loadEvents(events = []) {
    this.events = sortPlaybackEvents(events);
    this.currentIndex = 0;
    this.lastExecutedIndex = -1;
    this.lastWindowEnd = 0;
    this.paused = false;
  }

  getEventsInWindow(fromTime, toTime) {
    const from = Math.max(0, toQueueNumber(fromTime, 0));
    const to = Math.max(0, toQueueNumber(toTime, from));

    if (this.paused) return [];

    if (to < from) {
      this.seek(to);
      return [];
    }

    const results = [];
    let i = this.currentIndex;

    while (i < this.events.length) {
      const event = this.events[i];

      if (event.time > to) break;

      if (event.time > from && event.time <= to) {
        results.push(event);
      }

      i++;
    }

    this.currentIndex = i;
    this.lastExecutedIndex = this.currentIndex - 1;
    this.lastWindowEnd = to;

    return results;
  }

  seek(position = 0) {
    const safePosition = Math.max(0, toQueueNumber(position, 0));

    let lo = 0;
    let hi = this.events.length;

    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);

      if (this.events[mid].time <= safePosition) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    this.currentIndex = lo;
    this.lastExecutedIndex = lo - 1;
    this.lastWindowEnd = safePosition;

    return this.getState();
  }

  pause() {
    this.paused = true;
    return this.getState();
  }

  resume(position = this.lastWindowEnd) {
    this.paused = false;

    if (position !== undefined && position !== null) {
      this.seek(position);
    }

    return this.getState();
  }

  replay() {
    this.paused = false;
    this.reset();
    return this.getState();
  }

  getNextEventTime() {
    if (this.currentIndex >= this.events.length) return null;
    return this.events[this.currentIndex].time;
  }

  getEventCount() {
    return this.events.length;
  }

  getCurrentIndex() {
    return this.currentIndex;
  }

  isExhausted() {
    return this.currentIndex >= this.events.length;
  }

  reset() {
    this.currentIndex = 0;
    this.lastExecutedIndex = -1;
    this.lastWindowEnd = 0;
    this.paused = false;
  }

  cleanup() {
    this.events = [];
    this.currentIndex = 0;
    this.lastExecutedIndex = -1;
    this.lastWindowEnd = 0;
    this.paused = false;
  }

  getState() {
    return {
      totalEvents: this.events.length,
      currentIndex: this.currentIndex,
      remainingEvents: Math.max(0, this.events.length - this.currentIndex),
      isExhausted: this.isExhausted(),
      nextEventTime: this.getNextEventTime(),
      paused: this.paused,
      lastWindowEnd: this.lastWindowEnd,
    };
  }
}

export function generateEventId(clipId, channelId, time, value) {
  const safeTime = toQueueNumber(time, 0);
  const safeValue = toQueueNumber(value, 0);
  const str = `${clipId || "clip"}|${channelId || "channel"}|${safeTime.toFixed(6)}|${safeValue.toFixed(6)}`;

  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }

  return `evt_${Math.abs(hash).toString(16)}`;
}