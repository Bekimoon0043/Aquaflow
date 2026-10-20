// Site Capability Model (SCM) — the contract between the fountain design and the show
// generator (reports/Automatic fountain shows for any site.md). Built on fountainDesign.js;
// every field has a default derived from the design and a provenance flag, so a site works
// with zero commissioning and measured values win when they exist. Pure.
//
//   outputs   every nozzle: family, actuator, area, layer (front / mid / back), chase order,
//             mirror partner, hydraulic source, coupled siblings, limits, latency, role
//   sources   every pump: rated flow, its outputs, free (valve-less) outlets, ramp limits
//   front     which way the audience looks (user > seating / plaza > layout axis > default)
//   symmetry  mirror axis and score
//   wind      staged height reduction (defaults are unverified — set them on site), and with the
//             basin outline, the height each area can keep without blowing water out (waterPhysics)
//   timing    command → visible top per output: valve / drive delay + rise time, calibrated
//             per nozzle type from video when the site has been measured

import { readFountainDesign } from './fountainDesign';
import { visibleLead, windSafeScale } from '../../preview/waterPhysics';

export const SCM_VERSION = 1;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Musical role each nozzle family plays by default (Forme d'Acqua / SafeRain / Huaxin casting). */
export const FAMILY_ROLE = {
  swing: 'melody', basket: 'melody', ring: 'melody', curtain: 'melody',
  jet: 'rhythm', jumping: 'bass', geyser: 'climax', shooter: 'accent', mist: 'ambient',
};
/** Hero families: rare by design (refill / cooldown) and saved for climaxes. */
export const HERO_FAMILIES = new Set(['shooter']);

/** Limits per actuator / family. Values marked (unverified) come from the research gaps. */
export function defaultLimits(family, actuator) {
  const base = { minOnS: 0, minOffS: 0, upPctPerS: 100, downPctPerS: 100, degPerS: null, cooldownS: null, provenance: 'derived' };
  if (actuator === 'solenoid') Object.assign(base, { minOnS: 1, minOffS: 1 });
  if (actuator === 'vfd_pump' || actuator === 'shared_pump') Object.assign(base, { upPctPerS: 40, downPctPerS: 30 });
  if (family === 'basket') Object.assign(base, { upPctPerS: Math.min(base.upPctPerS, 33) });   // OASE: ≥ 3 s 0→100 %
  if (family === 'swing') Object.assign(base, { degPerS: 60 });                                   // OASE MDD ≈ 60–72 °/s
  if (family === 'shooter') Object.assign(base, { cooldownS: 25, minOnS: 0.3 });                   // AirNozzle 50 E refill (unverified default)
  return base;
}

/** Default wind policy (unverified starting values: configure per site). */
export const DEFAULT_WIND = { avgS: 30, hysteresisS: 10, provenance: 'unverified',
  stages: [{ fromMs: 4.5, heightScale: 0.7 }, { fromMs: 8, heightScale: 0.4 }, { fromMs: 10.5, heightScale: 0 }] };
export function windScale(wind, ms) {
  let s = 1;
  for (const st of wind?.stages || []) if (ms >= st.fromMs) s = st.heightScale;
  return s;
}

/**
 * Which way the audience looks. User setting wins; then seating / plaza scenery; then the
 * normal to the long axis of the layout (towards +y, as Engineering draws Lebu); else +y.
 */
export function inferFront(items, nozzles, override = null) {
  if (override?.vector) return { vector: override.vector, source: 'user', confidence: 1 };
  const cx = mean(nozzles.map((n) => num(n.item.x))), cy = mean(nozzles.map((n) => num(n.item.y)));
  const audience = items.filter((i) => i.category === 'scenery' && /seat|stand|terrace|plaza|audience|bench|viewing|amphi/i.test(`${i.label} ${i.name || ''}`));
  if (audience.length) {
    const ax = mean(audience.map((a) => num(a.x))) - cx, ay = mean(audience.map((a) => num(a.y))) - cy, l = Math.hypot(ax, ay) || 1;
    return { vector: [r3(ax / l), r3(ay / l)], source: 'seating', confidence: 0.8 };
  }
  if (nozzles.length >= 3) {
    const xs = nozzles.map((n) => num(n.item.x)), ys = nozzles.map((n) => num(n.item.y));
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    if (w > 1.3 * h) return { vector: [0, 1], source: 'axis', confidence: 0.4 };
    if (h > 1.3 * w) return { vector: [1, 0], source: 'axis', confidence: 0.3 };
  }
  return { vector: [0, 1], source: 'default', confidence: 0.2 };
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Mirror axis across the audience's left / right, and each nozzle's partner. */
export function mirrorPairs(nozzles, front) {
  if (nozzles.length < 2) return { axis: null, score: 0, partner: new Map() };
  const cx = mean(nozzles.map((n) => num(n.item.x))), cy = mean(nozzles.map((n) => num(n.item.y)));
  // Reflect across the line through the centre along the front vector (left ↔ right for the audience).
  const [fx, fy] = front.vector;
  const reflect = (x, y) => { const dx = x - cx, dy = y - cy, d = dx * fx + dy * fy; return [cx + 2 * d * fx - dx, cy + 2 * d * fy - dy]; };
  const span = Math.max(1, Math.max(...nozzles.map((n) => Math.hypot(num(n.item.x) - cx, num(n.item.y) - cy))));
  const tol = 0.06 * span;
  const partner = new Map();
  let matched = 0;
  for (const n of nozzles) {
    const [rx, ry] = reflect(num(n.item.x), num(n.item.y));
    let best = null, bd = tol;
    for (const m of nozzles) {
      if (m.kind !== n.kind) continue;
      const d = Math.hypot(num(m.item.x) - rx, num(m.item.y) - ry);
      if (d <= bd) { bd = d; best = m; }
    }
    if (best) { matched++; if (best.id !== n.id) partner.set(n.id, best.id); }
  }
  return { axis: { p: [r3(cx), r3(cy)], dir: [fx, fy] }, score: r3(matched / nozzles.length), partner };
}

/**
 * Build the SCM.
 * @param {object[]} items  show inventory
 * @param {object} [options] { design, overrides: { front, windMs, wind, outputs: { [id]: partial } } }
 */
export function buildSiteModel(items, { design = readFountainDesign(items), overrides = {} } = {}) {
  const front = inferFront(items, design.nozzles, overrides.front);
  const symmetry = mirrorPairs(design.nozzles, front);
  const [fx, fy] = front.vector;
  const cx = mean(design.nozzles.map((n) => num(n.item.x))), cy = mean(design.nozzles.map((n) => num(n.item.y)));
  const depth = design.nozzles.map((n) => (num(n.item.x) - cx) * fx + (num(n.item.y) - cy) * fy);
  const dMin = Math.min(...depth, 0), dMax = Math.max(...depth, 0);
  const layerOf = (d) => (dMax - dMin < 0.5 ? 'mid' : d > dMin + 0.66 * (dMax - dMin) ? 'front' : d < dMin + 0.33 * (dMax - dMin) ? 'back' : 'mid');
  const calibration = overrides.calibration || {};
  const cal = (n) => calibration[n.item.type] || calibration[n.kind] || null;
  const areaOf = new Map();
  for (const a of design.areas) a.nozzleIds.forEach((id, i) => areaOf.set(id, { area: a, order: i }));

  const outputs = design.nozzles.map((n, k) => {
    const actuator = n.valveId ? 'solenoid' : n.pumpId ? (design.pumps.get(n.pumpId).nozzleIds.length > 1 ? 'shared_pump' : 'vfd_pump')
      : n.item.tracks?.some((t) => /^motion_/.test(t.type)) ? 'servo' : 'direct';
    const pumpSiblings = n.pumpId ? design.pumps.get(n.pumpId).nozzleIds.filter((id) => id !== n.id && !design.nozzleById.get(id).valveId) : [];
    const e = n.item.engineering || {};
    const o = {
      id: n.id, family: n.kind, actuator, pos: [num(n.item.x), num(n.item.y), num(n.item.z)],
      area: areaOf.get(n.id)?.area.id || null, layer: layerOf(depth[k]), chaseOrder: areaOf.get(n.id)?.order ?? 0,
      mirrorOf: symmetry.partner.get(n.id) || null, sourceId: n.pumpId, valveId: n.valveId,
      coupledWith: n.valveId ? [] : pumpSiblings, heightM: n.heightM, flowLpm: num(e.flowLpm),
      limits: defaultLimits(n.kind, actuator), latency: { delayS: cal(n)?.delayS ?? 0.1, leadS: Math.round(visibleLead(n.heightM, { delayS: cal(n)?.delayS ?? 0.1, vt: cal(n)?.vtMs }) * 1000) / 1000,
        provenance: cal(n) ? 'calibrated' : 'derived' },
      role: { default: FAMILY_ROLE[n.kind] || 'rhythm', hero: HERO_FAMILIES.has(n.kind) }, lightIds: n.lightIds,
    };
    const patch = overrides.outputs?.[n.id];
    return patch ? { ...o, ...patch, limits: { ...o.limits, ...(patch.limits || {}), provenance: 'commissioned' } } : o;
  });
  const sources = [...design.pumps.values()].map((p) => {
    const free = p.nozzleIds.filter((id) => !design.nozzleById.get(id).valveId);
    return { id: p.id, name: p.name, kind: 'vfd_pump', qMaxLpm: num(p.item.engineering?.flowLpm), outputs: p.nozzleIds, valved: p.valveIds,
      freeOutlets: free, upPctPerS: 40, downPctPerS: 30, openCountFeedForward: [[1, 1]], provenance: 'derived' };
  });
  const wind = { ...DEFAULT_WIND, ...(overrides.wind || {}) };
  const windMs = num(overrides.windMs, 0);
  const stage = windScale(wind, windMs);
  const basin = Array.isArray(overrides.basin) && overrides.basin.length >= 3 ? overrides.basin : null;
  const eng = (o) => design.nozzleById.get(o.id)?.item.engineering || {};
  const splashLimit = Number.isFinite(Number(overrides.splashLimit)) ? Number(overrides.splashLimit) : 0.05;
  const areas = design.areas.map((a) => {
    const outs = outputs.filter((o) => o.area === a.id);
    const layers = outs.map((o) => o.layer);
    const layer = ['front', 'mid', 'back'].sort((x, y) => layers.filter((l) => l === y).length - layers.filter((l) => l === x).length)[0];
    const hero = outs.some((o) => o.role.hero);
    const coupled = a.control === 'pump' && outs.some((o) => o.coupledWith.some((id) => !a.nozzleIds.includes(id)) || sources.find((s) => s.id === o.sourceId)?.valved.length);
    // Wind: the staged reduction, and with a basin outline the height this area keeps its water in.
    // (Even in calm air: splash reaches about one jet height sideways.)
    let heightScale = stage;
    if (basin && stage > 0) {
      for (const o of outs) heightScale = Math.min(heightScale, windSafeScale({ x: o.pos[0], y: o.pos[1], heightM: o.heightM, sprayAngleDeg: eng(o).sprayAngleDeg, nozzleDiaMm: eng(o).nozzleDiaMm }, basin, { windMs, windDirDeg: overrides.windDirDeg ?? null, limit: splashLimit }));
    }
    return { id: a.id, name: a.name, family: a.kind, control: a.control, position: a.position, layer, size: a.size, heightM: a.heightM,
      role: FAMILY_ROLE[a.kind] || 'rhythm', hero, coupled, sources: a.pumpIds, lightIds: a.lightIds, nozzleIds: a.nozzleIds,
      mirrorArea: null, heightScale: Math.round(heightScale * 100) / 100, leadS: Math.max(0, ...outs.map((o) => o.latency.leadS)) };
  });
  // Mirror areas: most of an area's partners fall in one other area.
  // Tips: areas the basin cannot hold at full height.
  const tips = [...(design.tips || [])];
  for (const a of areas) if (basin && a.heightScale < 1) {
    tips.push(`${a.name}: ${a.heightScale ? `kept to ${Math.round(100 * a.heightScale)} % of design height (${Math.round(a.heightM * a.heightScale * 10) / 10} m)` : 'switched off'} so no more than ${Math.round(100 * splashLimit)} % of the water lands outside the basin${windMs ? ` at ${windMs} m/s wind` : ''}. `
      + 'For full height: move or angle these nozzles inward, widen the basin, or allow more splash in the site settings.');
  }
  for (const a of areas) {
    const hits = {};
    for (const id of a.nozzleIds) { const p = symmetry.partner.get(id); const pa = p && outputs.find((o) => o.id === p)?.area; if (pa && pa !== a.id) hits[pa] = (hits[pa] || 0) + 1; }
    const best = Object.entries(hits).sort((x, y) => y[1] - x[1])[0];
    if (best && best[1] >= 0.5 * a.size) a.mirrorArea = best[0];
  }
  return {
    version: SCM_VERSION, units: 'm', front, symmetry: { axis: symmetry.axis, score: symmetry.score }, wind, windMs, heightScale: stage, basin,
    outputs, sources, areas, tips, design, splashLimit,
  };
}
