/**
 * showHydraulicsClient.js — AF-NEXT-007 frontend side of the time-dependent hydraulics.
 *
 * The backend (POST /api/hydraulics/show-timeline → services/show_hydraulics.py) solves the
 * network at every sampled show time and returns a timeline. This module builds the request
 * from the engineering project + show, caches one timeline per request revision, and samples
 * it at the playhead (linear interpolation between samples; state codes take the earlier
 * sample). Pure apart from `fetchShowTimeline`; never talks to hardware.
 */
import { apiPost } from "../utils/apiClient.js";
import { getFixtureProvenance } from "../data/fixtureLibrary.js";

export const GRAVITY = 9.81;
export const TIMELINE_CONTRACT = "aquaflow-show-hydraulics";

/** State codes returned per nozzle sample (mirror of show_hydraulics.STATE_CODES). */
export const NOZZLE_STATE = Object.freeze({
  0: "off", 1: "ok", 2: "under_pressure", 3: "valve_closed", 4: "pump_off",
  5: "filling", 6: "ramping", 7: "no_hydraulic_data", 8: "solver_failed", 9: "not_connected",
});
/** States in which the engineering preview removes the jet. */
const REMOVED = new Set([3, 4, 5, 8]);
/** States the engineering preview leaves at their creative height. */
const PASSTHROUGH = new Set([7, 9]);

function plainFixture(f) {
  let provenance = null;
  try { provenance = getFixtureProvenance(f); } catch { provenance = null; }
  return {
    id: f.id, type: f.type, kind: f.kind, x: Number(f.x ?? f.position?.x ?? 0), y: Number(f.y ?? f.position?.y ?? 0),
    engineering: f.engineering || {}, ...(provenance ? { provenance } : {}),
  };
}

/** Request body for POST /hydraulics/show-timeline. `show` = { clips, duration?, groups?,
 *  recipes?, tempo?, sections?, frameOpts? } — the same clips evaluateShowFrame reads. */
export function buildShowTimelinePayload(project = {}, show = {}, options = {}) {
  const fixtures = (project.fixtures || show.fixtures || []).filter(f => f && f.id != null).map(plainFixture);
  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  return {
    project: {
      fixtures,
      params: project.params || {},
      ...(project.hydraulic_network ? { hydraulic_network: project.hydraulic_network } : {}),
    },
    show: {
      clips: (show.clips || []).map(c => ({ ...c })),
      ...pick(show, ["duration", "groups", "recipes", "tempo", "sections", "frameOpts"]),
    },
    options: { ...options },
  };
}

const cache = new Map();          // key -> Promise<timeline>
const CACHE_LIMIT = 6;

export function timelineKey(payload) {
  return JSON.stringify(payload);
}

/** Fetch (or reuse) the timeline for this project + show revision. Rejects on API errors. */
export function fetchShowTimeline(project, show, options = {}, { post = apiPost } = {}) {
  const payload = buildShowTimelinePayload(project, show, options);
  const key = timelineKey(payload);
  if (cache.has(key)) return cache.get(key);
  const pending = Promise.resolve(post("/hydraulics/show-timeline", payload)).then(res => {
    if (!res || res.contract !== TIMELINE_CONTRACT) throw new Error("Unexpected hydraulic timeline response.");
    return res;
  });
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return pending;
}

export function clearShowTimelineCache() { cache.clear(); }

/** Index of the last sample at or before tMs (binary search), and the interpolation weight. */
export function locateSample(timesMs = [], tMs) {
  const n = timesMs.length;
  if (!n) return { i: -1, j: -1, w: 0 };
  const t = Number(tMs) || 0;
  if (t <= timesMs[0]) return { i: 0, j: 0, w: 0 };
  if (t >= timesMs[n - 1]) return { i: n - 1, j: n - 1, w: 0 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timesMs[mid] <= t) lo = mid; else hi = mid;
  }
  const span = timesMs[hi] - timesMs[lo];
  return { i: lo, j: hi, w: span > 0 ? (t - timesMs[lo]) / span : 0 };
}

const lerp = (a, b, w) => (a == null || b == null ? (a ?? b ?? null) : a + (b - a) * w);

/**
 * Per-nozzle hydraulic state at the playhead:
 * { [nozzleId]: { heightM, demandHeightM, renderSpeedMs, exitVelocityMs, flowLpm, state,
 *   stateName, removed, passthrough, nominalRenderSpeedMs } }.
 * `renderSpeedMs` = sqrt(2 g h): the launch speed whose ballistic apex is the delivered height.
 */
export function sampleHydraulicTimeline(timeline, tMs) {
  const out = {};
  if (!timeline?.timesMs?.length) return out;
  const { i, j, w } = locateSample(timeline.timesMs, tMs);
  for (const [id, n] of Object.entries(timeline.nozzles || {})) {
    const state = n.state?.[i] ?? 0;
    // A state change between samples is a step: interpolate only within one state.
    const same = (n.state?.[j] ?? state) === state;
    const h = same ? lerp(n.heightM?.[i], n.heightM?.[j], w) : n.heightM?.[i];
    const height = h == null ? null : Math.max(0, h);
    out[id] = {
      heightM: height,
      demandHeightM: same ? lerp(n.demandHeightM?.[i], n.demandHeightM?.[j], w) : n.demandHeightM?.[i] ?? null,
      exitVelocityMs: n.exitVelocityMs?.[i] ?? null,
      flowLpm: n.flowLpm?.[i] ?? null,
      renderSpeedMs: height == null ? null : Math.sqrt(2 * GRAVITY * height),
      nominalRenderSpeedMs: timeline.nominal?.[id]?.renderSpeedMs ?? null,
      state, stateName: NOZZLE_STATE[state] || "unknown",
      removed: REMOVED.has(state), passthrough: PASSTHROUGH.has(state),
    };
  }
  return out;
}

/** Pump operating point at the playhead: { [pumpId]: { speedCmd, speedEff, flowLpm, headM, solve } }. */
export function samplePumps(timeline, tMs) {
  const out = {};
  if (!timeline?.timesMs?.length) return out;
  const { i } = locateSample(timeline.timesMs, tMs);
  for (const [id, p] of Object.entries(timeline.pumps || {})) {
    const solve = timeline.solves?.[p.solve?.[i]] || null;
    out[id] = { speedCmd: p.speedCmd?.[i], speedEff: p.speedEff?.[i], flowLpm: p.flowLpm?.[i],
      headM: p.headM?.[i], drive: p.drive, converged: solve ? solve.converged && solve.operatingPoint?.converged : null };
  }
  return out;
}

/** Timeline diagnostics active at tMs (span contains t), plus static (timeMs null) ones. */
export function activeHydraulicDiagnostics(timeline, tMs, { includeStatic = false } = {}) {
  const t = Number(tMs) || 0;
  return (timeline?.diagnostics || []).filter(d => d.timeMs == null
    ? includeStatic
    : d.timeMs <= t && t <= (d.endMs ?? d.timeMs));
}
