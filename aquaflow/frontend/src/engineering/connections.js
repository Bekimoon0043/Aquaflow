// Connections — how pumps, solenoid valves, nozzles and lights are linked, edited the easy way.
// Pure: every function takes the Engineering fixtures and returns a NEW fixtures array (objects
// that do not change keep their identity), so the caller writes it through the engineering
// store in one undoable step.
//
// It writes ONLY the fields the app already reads (fountainDesign.readFountainDesign, the
// group check, the Siemens IO map, the runtime compiler), always on both sides:
//   nozzle → valve   nozzle.engineering.solenoidValveId  +  valve.engineering.controlledFixtureId
//   nozzle → pump    nozzle.engineering.pumpId  +  its valve's engineering.pumpId  +  pump.engineering.servesValveIds
//   light → nozzle   light.engineering.pairedNozzleId
// Older alias fields (linkedValveId, valveId, supplyingPumpId, top-level pumpId / pairedNozzleId /
// controlledFixtureId) are kept in step when a fixture already has them, never added.

import { inventory } from "../components/programmer/studio/showModel";
import { readFountainDesign } from "../components/programmer/studio/fountainDesign";
import { FIXTURE_LIBRARY, getDefaultEngineering } from "../data/fixtureLibrary";
import { newEntityUuid } from "./drafting/entities";
import { jetFlowLpm, pumpRatedLpm } from "./pumpFlow";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const dist = (a, b) => Math.hypot(num(a?.x) - num(b?.x), num(a?.y) - num(b?.y));
const nameOf = (f) => String(f?.label || f?.name || f?.id || "");
const unique = (list) => [...new Set(list.filter(Boolean))];

/** The design as the app reads it (same reader as the show generator). */
export function readConnections(fixtures = []) {
  return readFountainDesign(inventory(fixtures));
}

// ─── writing ────────────────────────────────────────────────────────────────

function setField(obj, key, value) {
  if (value === null || value === undefined) { if (key in obj) { delete obj[key]; return true; } return false; }
  if (obj[key] === value) return false;
  obj[key] = value;
  return true;
}
/** Set the canonical engineering field and every alias the fixture already carries. */
function writeLink(f, canonical, aliasesEng, aliasesTop, value) {
  const e = { ...(f.engineering || {}) }, top = { ...f };
  let changed = setField(e, canonical, value);
  for (const k of aliasesEng) if (k in e) changed = setField(e, k, value) || changed;
  for (const k of aliasesTop) if (k in top) changed = setField(top, k, value) || changed;
  if (!changed) return f;
  top.engineering = e;
  return top;
}

/**
 * Apply link changes consistently on both sides.
 * @param {object[]} fixtures
 * @param {{ nozzles?: Record<string,{valveId?:string|null,pumpId?:string|null}>,
 *           lights?: Record<string,string|null>, valvePumps?: Record<string,string|null> }} changes
 */
export function applyLinks(fixtures = [], { nozzles = {}, lights = {}, valvePumps = {} } = {}, design = readConnections(fixtures)) {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const out = new Map();
  const get = (id) => out.get(id) || byId.get(id);
  const put = (f) => { if (f !== byId.get(f.id) || out.has(f.id)) out.set(f.id, f); };

  // Effective links after the change, for every nozzle.
  const state = new Map(design.nozzles.map((n) => [n.id, { valveId: n.valveId, pumpId: n.pumpId }]));
  const valvePump = (vid) => {
    const p = [...design.pumps.values()].find((x) => (x.item.engineering?.servesValveIds || []).includes(vid));
    return p?.id || (design.pumps.has(design.valves.get(vid)?.item.engineering?.pumpId) ? design.valves.get(vid).item.engineering.pumpId : null);
  };
  const touched = new Set();
  const relevantValves = new Set(Object.keys(valvePumps).filter((id) => design.valves.has(id)));
  for (const [id, ch] of Object.entries(nozzles)) {
    const cur = state.get(id);
    if (!cur) continue;
    const next = { ...cur };
    if ("valveId" in ch) next.valveId = ch.valveId && design.valves.has(ch.valveId) ? ch.valveId : null;
    if ("pumpId" in ch) next.pumpId = ch.pumpId && design.pumps.has(ch.pumpId) ? ch.pumpId : null;
    // A jet joining a valve that already sits on a pump joins that pump when it has none.
    else if (next.valveId && next.valveId !== cur.valveId && !next.pumpId) next.pumpId = valvePump(next.valveId);
    state.set(id, next);
    touched.add(id);
    if (cur.valveId) relevantValves.add(cur.valveId);
    if (next.valveId) relevantValves.add(next.valveId);
  }
  // Valves that still claim a touched jet are re-checked too.
  for (const v of design.valves.values()) {
    const target = v.item.engineering?.controlledFixtureId || v.item.controlledFixtureId;
    if (target && touched.has(target)) relevantValves.add(v.id);
  }

  for (const id of touched) {
    const s = state.get(id);
    let f = get(id);
    f = writeLink(f, "solenoidValveId", ["linkedValveId", "valveId"], ["linkedValveId"], s.valveId);
    f = writeLink(f, "pumpId", ["supplyingPumpId"], ["supplyingPumpId", "pumpId"], s.pumpId);
    put(f);
  }
  const pumpOfValve = new Map();
  for (const vid of relevantValves) {
    const mine = [...state.entries()].filter(([, s]) => s.valveId === vid).map(([nid, s]) => ({ nid, pumpId: s.pumpId }));
    const v = get(vid);
    const claimed = v.engineering?.controlledFixtureId || v.controlledFixtureId;
    const keep = mine.some((m) => m.nid === claimed) ? claimed : (mine[0]?.nid || null);
    let f = writeLink(v, "controlledFixtureId", [], ["controlledFixtureId"], keep);
    let pump;
    if (mine.length) {
      const count = new Map();
      for (const m of mine) if (m.pumpId) count.set(m.pumpId, (count.get(m.pumpId) || 0) + 1);
      pump = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    } else pump = vid in valvePumps ? (valvePumps[vid] && design.pumps.has(valvePumps[vid]) ? valvePumps[vid] : null) : valvePump(vid);
    f = writeLink(f, "pumpId", ["supplyingPumpId"], ["supplyingPumpId"], pump);
    pumpOfValve.set(vid, pump);
    put(f);
  }
  // Pumps: servesValveIds lists exactly the relevant valves on that pump (others untouched).
  for (const p of design.pumps.values()) {
    const serves = p.item.engineering?.servesValveIds;
    const list = Array.isArray(serves) ? serves : [];
    const next = list.filter((vid) => !pumpOfValve.has(vid) || pumpOfValve.get(vid) === p.id);
    for (const [vid, pid] of pumpOfValve) if (pid === p.id && !next.includes(vid)) next.push(vid);
    if (next.length === list.length && next.every((v, i) => v === list[i])) continue;
    if (!Array.isArray(serves) && !next.length) continue;
    const f = get(p.id);
    put({ ...f, engineering: { ...(f.engineering || {}), servesValveIds: next } });
  }
  for (const [lid, nid] of Object.entries(lights)) {
    const f = get(lid);
    if (!f) continue;
    put(writeLink(f, "pairedNozzleId", [], ["pairedNozzleId"], nid && design.nozzleById.has(nid) ? nid : null));
  }
  if (!out.size) return fixtures;
  return fixtures.map((f) => out.get(f.id) || f);
}

/** Valve ids → their jets; nozzle ids stay. */
function jetsOf(ids, design) {
  const out = [];
  for (const id of ids) {
    if (design.nozzleById.has(id)) out.push(id);
    else if (design.valves.has(id)) out.push(...design.valves.get(id).nozzleIds);
  }
  return unique(out);
}

/** Connect nozzles / valves to a pump (pumpId null = disconnect them from their pump). */
export function connectToPump(fixtures, ids = [], pumpId, design = readConnections(fixtures)) {
  const nozzles = {}, valvePumps = {};
  for (const id of jetsOf(ids, design)) nozzles[id] = { pumpId: pumpId || null };
  for (const id of ids) if (design.valves.has(id) && !design.valves.get(id).nozzleIds.length) valvePumps[id] = pumpId || null;
  return applyLinks(fixtures, { nozzles, valvePumps }, design);
}

/** Link one nozzle to a valve (null = no valve). */
export const setNozzleValve = (fixtures, nozzleId, valveId, design = readConnections(fixtures)) =>
  applyLinks(fixtures, { nozzles: { [nozzleId]: { valveId: valveId || null } } }, design);

/** Link nozzles to a valve; `exclusive` unlinks the valve's other nozzles. */
export function connectValve(fixtures, valveId, nozzleIds = [], { exclusive = false } = {}, design = readConnections(fixtures)) {
  const nozzles = {};
  if (exclusive) for (const id of design.valves.get(valveId)?.nozzleIds || []) nozzles[id] = { valveId: null };
  for (const id of nozzleIds) if (design.nozzleById.has(id)) nozzles[id] = { valveId };
  return applyLinks(fixtures, { nozzles }, design);
}

/** The valve's nozzle (one; null = none). */
export const setValveNozzle = (fixtures, valveId, nozzleId, design = readConnections(fixtures)) =>
  connectValve(fixtures, valveId, nozzleId ? [nozzleId] : [], { exclusive: true }, design);

/** Unlink nozzles from their valve. */
export const disconnectValve = (fixtures, nozzleIds = [], design = readConnections(fixtures)) =>
  applyLinks(fixtures, { nozzles: Object.fromEntries(nozzleIds.filter((id) => design.nozzleById.has(id)).map((id) => [id, { valveId: null }])) }, design);

/** Pair lights to a nozzle (null = unpair: the light then follows the nearest nozzle). */
export const pairLights = (fixtures, lightIds = [], nozzleId, design = readConnections(fixtures)) =>
  applyLinks(fixtures, { lights: Object.fromEntries(lightIds.map((id) => [id, nozzleId || null])) }, design);

// ─── auto-connect (preview first, then apply as one step) ───────────────────

/** The fixture library's solenoid for a nozzle: same pipe size when the library has it, else the design's usual one. */
export function defaultSolenoidType(fixtures = [], nozzle = null) {
  const solenoids = FIXTURE_LIBRARY.filter((f) => /solenoid/i.test(`${f.family || ""} ${f.key}`) && /^valve_/.test(f.key));
  const size = String(nozzle?.engineering?.connectionSize || "").toUpperCase();
  const bySize = size && solenoids.find((f) => String(f.engineering?.connectionSize || "").toUpperCase() === size);
  if (bySize) return bySize.key;
  const used = new Map();
  for (const f of fixtures) if (/valve|solenoid/i.test(String(f.type || ""))) used.set(f.type, (used.get(f.type) || 0) + 1);
  const common = [...used.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return common || solenoids.find((f) => /dn25/i.test(f.key))?.key || solenoids[0]?.key || "valve_solenoid_dn25_24v";
}

/**
 * One valve per nozzle: every nozzle without a valve (of `ids`, else all) gets the free valve
 * standing at its position (within `tolerance` m), else a new library solenoid placed on it.
 * @returns {{ fixtures, created: string[], linked: string[], lines: string[] }}
 */
export function autoValves(fixtures = [], { ids = null, tolerance = 0.35 } = {}) {
  const design = readConnections(fixtures);
  const want = design.nozzles.filter((n) => !n.valveId && (!ids?.length || ids.includes(n.id)));
  const free = [...design.valves.values()].filter((v) => !v.nozzleIds.length);
  const taken = new Set(), lines = [], created = [], linked = [], newFixtures = [], nozzles = {};
  let seq = 1;
  const usedIds = new Set(fixtures.map((f) => f.id));
  for (const n of want) {
    const near = free.filter((v) => !taken.has(v.id)).map((v) => ({ v, d: dist(v.item, n.item) })).filter((x) => x.d <= tolerance).sort((a, b) => a.d - b.d)[0];
    if (near) {
      taken.add(near.v.id);
      nozzles[n.id] = { valveId: near.v.id };
      linked.push(near.v.id);
      lines.push(`${nameOf(n.item)} → existing ${nameOf(near.v.item)}`);
      continue;
    }
    const type = defaultSolenoidType(fixtures, n.item);
    let id;
    do id = `solenoid-auto-${String(seq++).padStart(3, "0")}`; while (usedIds.has(id));
    usedIds.add(id);
    const uuid = newEntityUuid();
    newFixtures.push({ id, uuid, owner: n.item.owner || "model", type, label: `Valve · ${nameOf(n.item)}`, x: num(n.item.x), y: num(n.item.y), z: num(n.item.z),
      rotation: 0, zone: n.item.zone, groupId: "solenoid_valves", layer: "equipment", visible: true,
      engineering: { ...getDefaultEngineering(type), controlledFixtureId: n.id, ...(n.pumpId ? { pumpId: n.pumpId } : {}) } });
    created.push(id);
    lines.push(`${nameOf(n.item)} → new ${type}`);
  }
  if (!want.length) return { fixtures, created, linked, lines };
  // New valves first, then link every nozzle (and put new valves on their jet's pump).
  let next = newFixtures.length ? [...fixtures, ...newFixtures] : fixtures;
  const d2 = newFixtures.length ? readConnections(next) : design;
  for (const id of created) nozzles[newFixtures.find((f) => f.id === id).engineering.controlledFixtureId] = { valveId: id };
  next = applyLinks(next, { nozzles }, d2);
  return { fixtures: next, created, linked, lines };
}

/**
 * Pump assignment for jets without a pump (or `ids`, re-assigned):
 *   'nearest'  the closest pump on the plan
 *   'group'    per zone / design group: the pump already feeding most of that group, else the
 *              pump with the most spare rated flow
 */
export function autoPumps(fixtures = [], { mode = "group", ids = null } = {}) {
  const design = readConnections(fixtures);
  const pumps = [...design.pumps.values()];
  const jets = design.nozzles.filter((n) => (ids?.length ? ids.includes(n.id) : !n.pumpId));
  const lines = [], nozzles = {};
  if (!pumps.length || !jets.length) return { fixtures, lines };
  const keyOf = (n) => n.item.zone || n.item.groupId || n.kind;
  if (mode === "nearest") {
    for (const n of jets) {
      const p = pumps.map((x) => ({ x, d: dist(x.item, n.item) })).sort((a, b) => a.d - b.d)[0].x;
      nozzles[n.id] = { pumpId: p.id };
      lines.push(`${nameOf(n.item)} → ${p.name}`);
    }
  } else {
    const load = new Map(pumps.map((p) => [p.id, p.nozzleIds.filter((id) => !jets.some((j) => j.id === id))
      .reduce((s, id) => s + jetFlowLpm(design.nozzleById.get(id)?.item), 0)]));
    const groups = new Map();
    for (const n of jets) { const k = keyOf(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
    for (const [k, list] of groups) {
      const count = new Map();
      for (const n of design.nozzles) if (keyOf(n) === k && n.pumpId && !list.includes(n)) count.set(n.pumpId, (count.get(n.pumpId) || 0) + 1);
      let pid = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!pid) {
        const spare = (p) => num(pumpRatedLpm(p.item)) - load.get(p.id);
        pid = [...pumps].sort((a, b) => spare(b) - spare(a) || a.name.localeCompare(b.name))[0].id;
      }
      for (const n of list) nozzles[n.id] = { pumpId: pid };
      load.set(pid, load.get(pid) + list.reduce((s, n) => s + jetFlowLpm(n.item), 0));
      lines.push(`${String(k).replace(/[-_]+/g, " ")} (${list.length} jet${list.length === 1 ? "" : "s"}) → ${design.pumps.get(pid).name}`);
    }
  }
  return { fixtures: applyLinks(fixtures, { nozzles }, design), lines };
}

/** Pair every light without its own pairing (or `ids`) to the nearest nozzle. */
export function autoPairLights(fixtures = [], { ids = null } = {}) {
  const design = readConnections(fixtures);
  const lights = {}, lines = [];
  if (!design.nozzles.length) return { fixtures, lines };
  for (const l of design.lights) {
    const explicit = l.item.engineering?.pairedNozzleId || l.item.pairedNozzleId;
    if (ids?.length ? !ids.includes(l.id) : (explicit && design.nozzleById.has(explicit))) continue;
    const n = design.nozzles.map((x) => ({ x, d: dist(x.item, l.item) })).sort((a, b) => a.d - b.d)[0].x;
    lights[l.id] = n.id;
    lines.push(`${nameOf(l.item)} → ${nameOf(n.item)}`);
  }
  return { fixtures: applyLinks(fixtures, { lights }, design), lines };
}

// ─── problems ───────────────────────────────────────────────────────────────

/** The pump of a jet's neighbours (the 4 nearest connected jets), else the nearest pump. */
function neighbourPump(n, design) {
  const near = design.nozzles.filter((x) => x.id !== n.id && x.pumpId).map((x) => ({ x, d: dist(x.item, n.item) })).sort((a, b) => a.d - b.d).slice(0, 4);
  const count = new Map();
  for (const { x } of near) count.set(x.pumpId, (count.get(x.pumpId) || 0) + 1);
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (best) return best;
  return [...design.pumps.values()].map((p) => ({ p, d: dist(p.item, n.item) })).sort((a, b) => a.d - b.d)[0]?.p.id || null;
}

/** Every pump id a jet is tied to by any field (its own, its valve's, a pump's served list). */
export function pumpClaims(n, design) {
  const e = n.item.engineering || {};
  const claims = [e.pumpId, n.item.supplyingPumpId, e.supplyingPumpId];
  if (n.valveId) {
    const v = design.valves.get(n.valveId)?.item;
    claims.push(v?.engineering?.pumpId);
    for (const p of design.pumps.values()) if ((p.item.engineering?.servesValveIds || []).includes(n.valveId)) claims.push(p.id);
  }
  return unique(claims).filter((id) => design.pumps.has(id));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Everything that is not connected, or connected two ways. Each problem:
 * { code, severity: 'error'|'warning'|'info', ids, text, fix: { label, apply(fixtures) → fixtures } | { label, pick: pumpId } }
 */
export function connectionProblems(fixtures = [], design = readConnections(fixtures)) {
  const out = [];
  const pumpName = (id) => design.pumps.get(id)?.name || id;
  for (const n of design.nozzles) {
    const label = nameOf(n.item);
    if (!n.valveId && !n.pumpId) {
      const pid = neighbourPump(n, design);
      out.push({ code: "nozzle-orphan", severity: "error", ids: [n.id], text: `${label} has no valve and no pump — it can never get water.`,
        fix: pid ? { label: `Connect to ${pumpName(pid)}`, apply: (f) => connectToPump(f, [n.id], pid) } : null });
      continue;
    }
    if (!n.pumpId) {
      const pid = neighbourPump(n, design);
      out.push({ code: "nozzle-no-pump", severity: "error", ids: [n.id], text: `${label} has a valve but no pump.`,
        fix: pid ? { label: `Connect to ${pumpName(pid)}`, apply: (f) => connectToPump(f, [n.id], pid) } : null });
    }
    if (!n.valveId) {
      out.push({ code: "nozzle-no-valve", severity: "info", ids: [n.id], text: `${label} has no own valve: it rises and falls with ${pumpName(n.pumpId)}.`,
        fix: { label: "Add a valve", apply: (f) => autoValves(f, { ids: [n.id] }).fixtures } });
    }
    const claims = pumpClaims(n, design);
    if (claims.length > 1) {
      out.push({ code: "pump-conflict", severity: "error", ids: [n.id, ...claims], text: `${label} is tied to ${claims.length} pumps (${claims.map(pumpName).join(", ")}) — its own setting, its valve and the pump lists disagree.`,
        fix: { label: `Keep ${pumpName(n.pumpId)}`, apply: (f) => applyLinks(f, { nozzles: { [n.id]: { pumpId: n.pumpId, valveId: n.valveId } } }) } });
    }
  }
  for (const v of design.valves.values()) {
    const target = v.item.engineering?.controlledFixtureId || v.item.controlledFixtureId;
    if (target && design.nozzleById.has(target) && design.nozzleById.get(target).valveId !== v.id) {
      const real = design.nozzleById.get(target).valveId;
      out.push({ code: "valve-mismatch", severity: "warning", ids: [v.id, target], text: `${nameOf(v.item)} says it feeds ${nameOf(design.nozzleById.get(target).item)}, but that jet is linked to ${real ? nameOf(design.valves.get(real)?.item) : "no valve"}.`,
        fix: { label: `Link ${nameOf(design.nozzleById.get(target).item)} to this valve`, apply: (f) => setNozzleValve(f, target, v.id) } });
      continue;
    }
    if (!v.nozzleIds.length) {
      const cand = design.nozzles.filter((n) => !n.valveId).map((n) => ({ n, d: dist(n.item, v.item) })).sort((a, b) => a.d - b.d)[0];
      out.push({ code: "valve-no-nozzle", severity: "warning", ids: [v.id], text: `${nameOf(v.item)} feeds no nozzle.`,
        fix: cand && cand.d <= 3 ? { label: `Link to ${nameOf(cand.n.item)}`, apply: (f) => setValveNozzle(f, v.id, cand.n.id) } : null });
    }
  }
  for (const p of design.pumps.values()) {
    if (!p.nozzleIds.length) out.push({ code: "pump-no-outlets", severity: "warning", ids: [p.id], text: `${p.name} has no outlets connected.`,
      fix: { label: "Pick its nozzles", pick: p.id } });
  }
  for (const l of design.lights) {
    const explicit = l.item.engineering?.pairedNozzleId || l.item.pairedNozzleId;
    if (explicit && design.nozzleById.has(explicit)) continue;
    const near = l.nozzleId ? nameOf(design.nozzleById.get(l.nozzleId)?.item) : null;
    out.push({ code: "light-unpaired", severity: "info", ids: [l.id], text: `${nameOf(l.item)} is not paired${near ? ` (follows the nearest nozzle, ${near})` : ""}.`,
      fix: l.nozzleId ? { label: `Pair to ${near}`, apply: (f) => pairLights(f, [l.id], l.nozzleId) } : null });
  }
  const ORDER = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/** Problems grouped by kind, each group with a "fix all" (applied one by one on the latest fixtures). */
export function problemGroups(problems = []) {
  const TITLE = { "nozzle-orphan": "Nozzles with no valve and no pump", "nozzle-no-pump": "Nozzles without a pump", "nozzle-no-valve": "Nozzles without their own valve",
    "pump-conflict": "Nozzles tied to two pumps", "valve-mismatch": "Valve and nozzle disagree", "valve-no-nozzle": "Valves without a nozzle",
    "pump-no-outlets": "Pumps without outlets", "light-unpaired": "Lights not paired" };
  const groups = new Map();
  for (const p of problems) {
    if (!groups.has(p.code)) groups.set(p.code, { code: p.code, title: TITLE[p.code] || p.code, severity: p.severity, items: [] });
    groups.get(p.code).items.push(p);
  }
  return [...groups.values()].map((g) => ({ ...g, count: g.items.length, label: `${g.title} (${g.items.length})`,
    fixAll: g.items.some((p) => p.fix?.apply) ? (fixtures) => fixAllOf(g.code, fixtures, g.items) : null }));
}

function fixAllOf(code, fixtures, items) {
  const ids = items.flatMap((p) => p.ids);
  if (code === "nozzle-no-valve") return autoValves(fixtures, { ids }).fixtures;
  if (code === "light-unpaired") return autoPairLights(fixtures, { ids }).fixtures;
  let next = fixtures;
  for (const p of items) if (p.fix?.apply) next = p.fix.apply(next);
  return next;
}

/** "3 changes": a short count of what differs between two fixture lists. */
export function describeChange(before = [], after = []) {
  const prev = new Map(before.map((f) => [f.id, f]));
  const added = after.filter((f) => !prev.has(f.id)).length;
  const changed = after.filter((f) => prev.has(f.id) && prev.get(f.id) !== f).length;
  return [added ? `${plural(added, "new valve")}` : "", changed ? `${plural(changed, "fixture")} relinked` : ""].filter(Boolean).join(", ") || "no change";
}
