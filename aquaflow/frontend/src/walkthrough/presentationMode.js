// presentationMode.js — AquaFlow Stage 3, Priority 6 (AQ-S3-006)
//
// Client presentation mode: a scripted, auto-advancing camera tour with captions
// for showing a design to a client. Pure sequencing logic (no timers, no DOM) so
// it is deterministic and unit-tested; the PreviewPanel ticks it against a clock
// and hides the UI / goes fullscreen per the config.

/** Default guided tour — cinematic stops with captions. */
export const DEFAULT_TOUR = Object.freeze([
  { cameraMode: "aerial",     caption: "Welcome — an aerial view of your fountain.", duration: 6 },
  { cameraMode: "audience",   caption: "The view your guests will enjoy.",           duration: 7 },
  { cameraMode: "flythrough", caption: "A cinematic fly-through of the water show.", duration: 8 },
  { cameraMode: "dramatic",   caption: "Signature moments, up close.",               duration: 7 },
  { cameraMode: "orbit",      caption: "A full 360° of the finished design.",        duration: 8 },
]);

/** Build a tour from waypoints (or return a supplied tour), applying defaults. */
export function buildTour(steps, { stepDuration = 6 } = {}) {
  const src = Array.isArray(steps) && steps.length ? steps : DEFAULT_TOUR;
  return src.map((s, i) => ({
    index: i,
    cameraMode: s.cameraMode || "orbit",
    caption: s.caption || "",
    position: s.position || null,
    lookAt: s.lookAt || null,
    duration: Math.max(0.5, s.duration != null ? s.duration : stepDuration),
  }));
}

/** Total tour duration (seconds). */
export function tourTotalDuration(tour) {
  return tour.reduce((a, s) => a + s.duration, 0);
}

/**
 * Which tour step is active at `elapsed` seconds. With loop=true the elapsed time
 * wraps around the total duration. Returns { index, step, localT, done }.
 */
export function tourStepAt(tour, elapsed, { loop = true } = {}) {
  const total = tourTotalDuration(tour);
  if (total <= 0) return { index: 0, step: tour[0], localT: 0, done: true };
  let t = elapsed;
  let done = false;
  if (loop) {
    t = ((elapsed % total) + total) % total;
  } else if (elapsed >= total) {
    const last = tour.length - 1;
    return { index: last, step: tour[last], localT: 1, done: true };
  }
  let acc = 0;
  for (let i = 0; i < tour.length; i++) {
    if (t < acc + tour[i].duration || i === tour.length - 1) {
      const localT = Math.min(1, (t - acc) / tour[i].duration);
      return { index: i, step: tour[i], localT, done };
    }
    acc += tour[i].duration;
  }
  return { index: 0, step: tour[0], localT: 0, done };
}

/** Presentation UX config (client mode). */
export function presentationConfig(overrides = {}) {
  return {
    hideUI: true,
    fullscreen: true,
    autoAdvance: true,
    loop: true,
    showCaptions: true,
    ...overrides,
  };
}
