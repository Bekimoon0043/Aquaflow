/**
 * splashEnvelope.js — AF-NEXT-008 safety and splash (overspray) envelope.
 *
 * ADVISORY — NOT FIELD CALIBRATED. For every active jet at each sampled show time this
 * predicts where the water lands and tests that landing region against the basin water
 * (outer polygons minus islands, via basinMask's contains()), attributing any spill to the
 * source nozzle and its clip, with a recommended correction.
 *
 * Model (plan frame: metres, x across, y as in the engineering plan; world z = plan y):
 *   * jet height h: the AF-NEXT-007 engineering timeline's delivered height when available,
 *     otherwise the nominal (creative) height = level × design jet height;
 *   * nozzle uncertainty u (default ±10 %): the envelope uses h × (1 + u);
 *   * ballistic throw from the renderer's own tilt convention (tiltX / tiltZ about the
 *     nozzle yaw): vy = sqrt(2 g h), speed = vy / (cos tx · cos tz), time of flight 2 vy / g;
 *   * wind drift: weather/windDrift.windDrift(h, wind × gust factor, coupling);
 *   * landing radius: base splash radius + spray spread × h + u × throw.
 * A landing region is "outside" when any of 17 points (centre + 16 on the rim) is not in
 * water; the distance outside is the farthest such point's distance to the water edge.
 */
import { createBasinMask } from "../components/preview/basinMask.js";
import { DEFAULT_COUPLING, DEFAULT_GUST_FACTOR, GRAVITY, windDrift } from "../weather/windDrift.js";
import { basinOuterPoints, reconcileBasins } from "./basins.js";
import { evaluateShowFrameAt } from "../show/evaluateShowFrame.js";
import { fixturesToNozzleConfigs, classifyFixtureType } from "../hooks/fixtureTypeMap.js";

export const ADVISORY_LABEL = "Advisory — not field calibrated";

export const SPLASH_DEFAULTS = Object.freeze({
  gustFactor: DEFAULT_GUST_FACTOR,      // 1.4, weather/windDrift.js
  nozzleUncertainty: 0.10,              // ±10 % jet height
  coupling: DEFAULT_COUPLING,           // fraction of wind speed the falling water takes up
  baseSplashRadiusM: 0.5,               // weather/windDrift DEFAULT_SPLASH_RADIUS_M
  spraySpreadPerM: 0.06,                // extra landing radius per metre of jet height
  sampleStepMs: 250,
  rimPoints: 16,
});

const BAR_TO_M = 10.19716213;
const toRad = d => (Number(d) || 0) * Math.PI / 180;

/** Normalise wind: {x, y} (plan vector the wind blows TOWARD, m/s), or {speedMs, fromDeg}
 *  (meteorological, 0 = from north; plan north = −y), or {windX, windZ} from the preview. */
export function normalizeWind(wind = {}) {
  if (wind == null) return { x: 0, y: 0, speed: 0, source: "none" };
  if (Number.isFinite(Number(wind.x)) || Number.isFinite(Number(wind.y))) {
    const x = Number(wind.x) || 0, y = Number(wind.y) || 0;
    return { x, y, speed: Math.hypot(x, y), source: wind.source || "plan vector" };
  }
  if (Number.isFinite(Number(wind.windX)) || Number.isFinite(Number(wind.windZ))) {
    const x = Number(wind.windX) || 0, y = Number(wind.windZ) || 0;
    return { x, y, speed: Math.hypot(x, y), source: wind.source || "3D preview wind" };
  }
  const speed = Math.abs(Number(wind.speedMs ?? wind.windSpeed) || 0);
  const to = toRad((Number(wind.fromDeg ?? wind.windDirection) || 0) + 180);
  return { x: speed * Math.sin(to), y: -speed * Math.cos(to), speed, source: wind.source || "weather" };
}

/** Basin list (plan frame) of an engineering project: [{ outer:[{x,y}], holes }]. */
export function projectBasins(project = {}) {
  let basins = Array.isArray(project.basins) && project.basins.length ? project.basins : null;
  if (!basins && project.geometry) {
    try { basins = reconcileBasins({ basins: [], geometry: project.geometry, poolType: project.poolType || project.pool_type, params: project.params || {} }); }
    catch { basins = null; }
  }
  return (basins || []).map(b => ({ id: b.id, outer: Array.isArray(b.outer) && b.outer.length ? b.outer : basinOuterPoints(b),
    holes: b.holes || [] })).filter(b => (b.outer || []).length >= 3);
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a point to the nearest basin edge (outer or island ring). */
function edgeDistance(rings, x, y) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      best = Math.min(best, segDist(x, y, ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
    }
  }
  return best;
}

/** Water test for a basin list, reusing basinMask (one definition of "in the water"). */
export function createWaterTest(basins) {
  const mask = createBasinMask(basins.map(b => ({ outer: b.outer, holes: b.holes })), { resolution: 64 });
  const rings = [];
  for (const b of basins) {
    const toPairs = r => (r || []).map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.x), Number(p.y ?? p.z)]);
    rings.push(toPairs(b.outer));
    (b.holes || []).forEach(h => rings.push(toPairs(h)));
  }
  const contains = mask.containsExact || mask.contains;
  return { contains: (x, y) => contains(x, y), edgeDistance: (x, y) => edgeDistance(rings, x, y), empty: !basins.length };
}

/** Ballistic landing of one jet. `jet` = { x, y, heightM, tiltX, tiltZ, rotationY } (degrees). */
export function jetLanding(jet, wind, opts = {}) {
  const o = { ...SPLASH_DEFAULTS, ...opts };
  const w = normalizeWind(wind);
  const h = Math.max(0, Number(jet.heightM) || 0) * (1 + Math.max(0, o.nozzleUncertainty));
  const tx = toRad(jet.tiltX), tz = toRad(jet.tiltZ), yaw = toRad(jet.rotationY);
  const vy = Math.sqrt(2 * GRAVITY * h);
  const cosV = Math.max(0.05, Math.cos(tx) * Math.cos(tz));
  const speed = vy / cosV;
  const tof = 2 * vy / GRAVITY;
  const lx = Math.sin(tx) * speed * tof, lz = Math.sin(tz) * speed * tof;
  const throwX = lx * Math.cos(yaw) + lz * Math.sin(yaw);
  const throwY = -lx * Math.sin(yaw) + lz * Math.cos(yaw);
  const throwM = Math.hypot(throwX, throwY);
  const drift = windDrift(h, w.speed * o.gustFactor, o.coupling);
  const ux = w.speed > 1e-9 ? w.x / w.speed : 0, uy = w.speed > 1e-9 ? w.y / w.speed : 0;
  const x0 = Number(jet.x) || 0, y0 = Number(jet.y) || 0;
  return {
    origin: { x: x0, y: y0 },
    center: { x: x0 + throwX + drift * ux, y: y0 + throwY + drift * uy },
    radiusM: o.baseSplashRadiusM + o.spraySpreadPerM * h + o.nozzleUncertainty * throwM,
    envelopeHeightM: h, throwM, driftM: drift,
  };
}

/** Test a landing region against the water. Returns { outside, distanceOutsideM, worstPoint }. */
export function testLanding(landing, water, opts = {}) {
  if (water.empty) return { outside: false, distanceOutsideM: 0, worstPoint: null };
  const n = opts.rimPoints || SPLASH_DEFAULTS.rimPoints;
  const pts = [landing.center];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push({ x: landing.center.x + Math.cos(a) * landing.radiusM, y: landing.center.y + Math.sin(a) * landing.radiusM });
  }
  let worst = 0, worstPoint = null;
  for (const p of pts) {
    if (water.contains(p.x, p.y)) continue;
    const d = water.edgeDistance(p.x, p.y);
    if (d >= worst) { worst = d; worstPoint = p; }
  }
  return { outside: !!worstPoint, distanceOutsideM: worst, worstPoint };
}

/** Largest height (≤ current) whose landing region stays in the water; null if none does. */
export function maxContainedHeight(jet, wind, water, opts = {}) {
  const at = h => !testLanding(jetLanding({ ...jet, heightM: h }, wind, opts), water, opts).outside;
  const h0 = Math.max(0, Number(jet.heightM) || 0);
  if (at(h0)) return h0;
  if (!at(Math.min(0.05, h0))) return null;
  let lo = Math.min(0.05, h0), hi = h0;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

function recommendation(jet, hMax) {
  const h = Number(jet.heightM) || 0;
  if (hMax == null) {
    return { recommendedHeightM: 0, recommendedSpeedPct: 0,
      text: "Even a minimal jet lands outside the water here: move the nozzle inward, re-aim it, or pause it in this wind." };
  }
  const ratio = h > 0 ? hMax / h : 0;
  const speedPct = Math.floor(Math.sqrt(ratio) * 100);          // h ∝ v² ⇒ v ∝ sqrt(h)
  return { recommendedHeightM: Math.floor(hMax * 100) / 100, recommendedSpeedPct: speedPct,
    text: `Reduce jet height to ${hMax.toFixed(2)} m (${Math.round(ratio * 100)}% of ${h.toFixed(2)} m), i.e. about ${speedPct}% exit speed / pump speed.` };
}

/** Jets of an engineering project with their render geometry (tilt/yaw exactly as the 3D preview). */
export function projectJets(project = {}) {
  const water = (project.fixtures || []).filter(f => f && f.id != null && classifyFixtureType(f.type) === "nozzle");
  const { nozzleConfigs } = fixturesToNozzleConfigs(water);
  const byId = new Map(water.map(f => [String(f.id), f]));
  return nozzleConfigs.map(c => {
    const f = byId.get(String(c.id)) || {};
    const e = f.engineering || {};
    const design = Number(e.jetHeightM) > 0 ? Number(e.jetHeightM)
      : Number(e.pressureBar) > 0 ? 0.8 * Number(e.pressureBar) * BAR_TO_M : null;
    return { id: String(c.id), x: Number(c.x) || 0, y: Number(c.z) || 0, tiltX: c.tiltX || 0, tiltZ: c.tiltZ || 0,
      rotationY: c.rotationY || 0, designHeightM: design };
  });
}

function showProjectFor(project, show) {
  return { ...show, fixtures: project.fixtures || show.fixtures || [], clips: show.clips || [] };
}

function showDurationS(show) {
  const d = Number(show.duration);
  if (d > 0) return d;
  let end = 0;
  for (const c of show.clips || []) {
    const s = Number(c.startTime ?? c.start ?? 0);
    const e = c.end != null && c.startTime == null ? Number(c.end) : s + Number(c.duration || 0);
    if (Number.isFinite(e)) end = Math.max(end, e);
  }
  return end;
}

/** Active jets at one time: [{ ...jet, heightM, clipId, level, basis }]. */
export function activeJetsAt(jets, project, show, tMs, { sampleTimeline = null, frameOpts } = {}) {
  const frame = evaluateShowFrameAt(showProjectFor(project, show), tMs / 1000, frameOpts || show.frameOpts || {});
  const hyd = sampleTimeline ? sampleTimeline(tMs) : null;
  const out = [];
  for (const jet of jets) {
    const rec = frame.fixtures?.[jet.id];
    const level = rec?.level || 0;
    if (!(level > 0)) continue;
    const h = hyd?.[jet.id];
    let heightM, basis;
    if (h && !h.passthrough && h.heightM != null) { heightM = h.heightM; basis = "engineering"; }
    else if (jet.designHeightM) { heightM = level * jet.designHeightM; basis = "nominal"; }
    else continue;
    if (!(heightM > 0)) continue;
    out.push({ ...jet, heightM, level, basis, clipId: rec?.source?.clipId ?? null });
  }
  return out;
}

/** Landing regions of the given active jets: [{ id, clipId, origin, center, radiusM, outside, distanceOutsideM, ... }]. */
export function splashAt(activeJets, water, wind, opts = {}) {
  return activeJets.map(jet => {
    const landing = jetLanding(jet, wind, opts);
    const test = testLanding(landing, water, opts);
    return { id: jet.id, clipId: jet.clipId, heightM: jet.heightM, basis: jet.basis, ...landing, ...test };
  });
}

/**
 * Splash envelope across the show timeline.
 * opts: { wind, gustFactor, nozzleUncertainty, coupling, sampleStepMs, timeline (AF-NEXT-007
 *         timeline or null), sampleTimeline (fn tMs → per-nozzle sample), frameOpts }.
 * Returns { report, samples, assumptions, advisory, offendingNozzles }.
 */
export function computeSplashEnvelope(project = {}, show = {}, opts = {}) {
  const o = { ...SPLASH_DEFAULTS, ...opts };
  const basins = projectBasins(project);
  const water = createWaterTest(basins);
  const jets = projectJets(project);
  const wind = normalizeWind(opts.wind || { x: 0, y: 0 });
  const durationMs = Math.max(0, (Number(opts.durationS) || showDurationS(show)) * 1000);
  const step = Math.max(10, Number(o.sampleStepMs) || 250);
  const times = [];
  for (let t = 0; t < durationMs; t += step) times.push(t);
  const samples = [];
  const open = new Map();          // nozzleId -> running span
  const report = [];
  const close = (id) => {
    const s = open.get(id);
    if (!s) return;
    open.delete(id);
    const hMax = maxContainedHeight(s.worstJet, wind, water, o);
    const rec = recommendation(s.worstJet, hMax);
    report.push({ timeMs: s.startMs, endMs: s.endMs, worstTimeMs: s.worstTimeMs, nozzleId: id, clipId: s.clipId,
      landingPoint: { x: round(s.worst.center.x), y: round(s.worst.center.y) }, landingRadiusM: round(s.worst.radiusM),
      distanceOutsideM: round(s.worst.distanceOutsideM), heightM: round(s.worstJet.heightM), heightBasis: s.worstJet.basis,
      recommendedHeightM: rec.recommendedHeightM, recommendedSpeedPct: rec.recommendedSpeedPct, recommendation: rec.text });
  };
  for (const t of times) {
    const active = activeJetsAt(jets, project, show, t, { sampleTimeline: o.sampleTimeline, frameOpts: o.frameOpts });
    const regions = splashAt(active, water, wind, o);
    const outside = regions.filter(r => r.outside);
    samples.push({ timeMs: t, active: regions.length, outside: outside.map(r => r.id) });
    const seen = new Set();
    for (const r of outside) {
      seen.add(r.id);
      const jet = active.find(j => j.id === r.id);
      const s = open.get(r.id);
      if (!s) open.set(r.id, { startMs: t, endMs: t + step, clipId: r.clipId, worst: r, worstJet: jet, worstTimeMs: t });
      else {
        s.endMs = t + step;
        if (!s.clipId && r.clipId) s.clipId = r.clipId;
        if (r.distanceOutsideM > s.worst.distanceOutsideM) { s.worst = r; s.worstJet = jet; s.worstTimeMs = t; }
      }
    }
    for (const id of [...open.keys()]) if (!seen.has(id)) close(id);
  }
  for (const id of [...open.keys()]) close(id);
  report.sort((a, b) => a.timeMs - b.timeMs || String(a.nozzleId).localeCompare(String(b.nozzleId)));
  return {
    advisory: ADVISORY_LABEL,
    report,
    samples,
    offendingNozzles: [...new Set(report.map(r => r.nozzleId))],
    basinsTested: basins.length,
    assumptions: splashAssumptions(o, wind, !!o.sampleTimeline),
  };
}

export function splashAssumptions(o = SPLASH_DEFAULTS, wind = normalizeWind(null), engineeringHeights = false) {
  return [
    { key: "gustFactor", label: "Gust factor", value: o.gustFactor ?? SPLASH_DEFAULTS.gustFactor, unit: "×", source: o.gustFactor === DEFAULT_GUST_FACTOR ? "DEFAULT" : "SETTING" },
    { key: "nozzleUncertainty", label: "Nozzle uncertainty", value: `±${Math.round((o.nozzleUncertainty ?? SPLASH_DEFAULTS.nozzleUncertainty) * 100)}%`, unit: "height", source: "ASSUMED" },
    { key: "wind", label: "Wind", value: `${(wind.speed || 0).toFixed(1)} m/s`, unit: "m/s", source: wind.source || "none" },
    { key: "coupling", label: "Wind coupling", value: o.coupling ?? SPLASH_DEFAULTS.coupling, unit: "", source: "ASSUMED" },
    { key: "splashRadius", label: "Landing radius", value: `${o.baseSplashRadiusM ?? SPLASH_DEFAULTS.baseSplashRadiusM} m + ${o.spraySpreadPerM ?? SPLASH_DEFAULTS.spraySpreadPerM} × height`, unit: "m", source: "ASSUMED" },
    { key: "heights", label: "Jet heights", value: engineeringHeights ? "engineering timeline (AF-NEXT-007)" : "nominal (level × design height)", unit: "m", source: engineeringHeights ? "CALCULATED" : "NOMINAL" },
    { key: "calibration", label: "Calibration", value: ADVISORY_LABEL, unit: "", source: "ADVISORY" },
  ];
}

const round = v => Math.round(Number(v) * 1000) / 1000;
