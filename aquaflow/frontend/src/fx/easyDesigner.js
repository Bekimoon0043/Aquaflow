// Easy Fountain Design — the logic behind the drag-and-drop 3D designer. Pure: every function
// takes the Engineering fixtures and returns new data, so the panel writes the result through the
// engineering store in one step (the same store every other AquaFlow tool reads).
//
//   assets      the fixture library, grouped into the tray tabs (nozzles, pumps, valves, lights, effects)
//   drop        a new fixture at a plan point, auto-connected to what is already there:
//                 nozzle → nearest pump (through a free valve standing next to it, when there is one)
//                 pump   → every nozzle / valve that has no pump yet
//                 valve  → the nearest nozzle without a valve (it joins that nozzle's pump)
//                 light  → paired with the nearest nozzle
//   links       the connections as lines: pump → valve, valve → nozzle, pump → nozzle, light → nozzle
//   replug      pull one end of a line off and plug it into another item (or drop it to unplug)
//   live jets   how high every jet really goes from its pump: speed (H ∝ n²) and motor power
//               (P ∝ Q·H, Q ∝ √H ⇒ H ∝ P^⅔ when the jets ask for more than the motor gives)
//
// Connections are written only through engineering/connections.js, so the links are the exact
// fields the show generator, the Siemens I/O map and the runtime compiler already read.

import { FIXTURE_LIBRARY, getFixtureLibraryEntry } from "../data/fixtureLibrary";
import { createFixtureEntity, fixtureLayerKey } from "../engineering/drafting/entities";
import { partRole, nozzleKind } from "../components/programmer/studio/fountainDesign";
import { inventory } from "../components/programmer/studio/showModel";
import {
  readConnections, connectToPump, setNozzleValve, setValveNozzle, disconnectValve, pairLights, autoPumps,
} from "../engineering/connections";
import { jetFlowLpm, jetHeadM } from "../engineering/pumpFlow";

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : fallback);
const dist = (a, b) => Math.hypot(num(a?.x) - num(b?.x), num(a?.y) - num(b?.y));
const nameOf = (f) => String(f?.label || f?.name || f?.id || "");
const G = 9.81;
const RHO = 1000;

// ─── assets ─────────────────────────────────────────────────────────────────

/** Moving (1D / 2D / 3D) nozzles: motorised swing drives, robotic nozzles and dancing jets. */
export function isMovingNozzle(f) {
  const key = String(f?.key || f?.type || "");
  return /^motion_nozzle_/.test(key) || /dancing/i.test(key)
    || (f?.category === "Motion Systems" && num(f?.engineering?.axisCount, 0) > 0 && num(f?.engineering?.jetHeightM, 0) > 0);
}

/** Number of motion axes of a moving nozzle (1 swing · 2 pan + tilt · 3 pan + tilt + lift); 0 = fixed. */
export function axesOf(f) {
  const e = f?.engineering || getFixtureLibraryEntry(f?.type || f?.key)?.engineering || {};
  if (num(e.axisCount, 0) > 0) return Math.min(3, num(e.axisCount));
  const m = String(f?.key || f?.type || "").match(/_([123])d_/);
  if (m) return Number(m[1]);
  return isMovingNozzle(f) ? 1 : 0;
}

const inCats = (...cats) => (f) => cats.includes(f.category);
export const ASSET_GROUPS = [
  { id: "nozzles", label: "Nozzles", match: (f) => f.category === "Nozzles" && !isMovingNozzle(f) },
  { id: "moving", label: "Moving 1D/2D/3D", match: isMovingNozzle, axes: true },
  { id: "pumps", label: "Pumps", match: inCats("Pumps") },
  { id: "valves", label: "Valves", match: inCats("Valves") },
  { id: "lights", label: "Lights", match: inCats("Lights") },
  { id: "lasers", label: "Lasers", match: inCats("Laser") },
  { id: "effects", label: "Flame & fog", match: (f) => ["Flame", "Fog", "Effects", "Air Systems"].includes(f.category) },
];

const ROLE_CACHE = new Map();
/**
 * Role of a library entry or placed fixture: 'nozzle' | 'pump' | 'valve' | 'light' | 'effect'.
 * Read exactly the way the connection reader does (inventory → partRole, which needs the
 * fixture's auto tracks to recognise lights), cached per type.
 */
export function roleOf(item) {
  if (!item) return "effect";
  const type = String(item.type || item.key || "");
  const servesValves = Array.isArray(item.engineering?.servesValveIds);
  const key = `${type}|${servesValves ? 1 : 0}`;
  if (!ROLE_CACHE.has(key)) {
    const engineering = { ...(getFixtureLibraryEntry(type)?.engineering || {}), ...(servesValves ? { servesValveIds: [] } : {}) };
    const [probe] = inventory([{ id: "role-probe", type, x: 0, y: 0, engineering }]);
    ROLE_CACHE.set(key, partRole(probe) || "effect");
  }
  return ROLE_CACHE.get(key);
}

/** Library entries for a tray tab, filtered by a search text (label, family, key) and, for moving nozzles, axes. */
export function assetsFor(groupId, query = "", axes = 0) {
  const group = ASSET_GROUPS.find((g) => g.id === groupId) || ASSET_GROUPS[0];
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  return FIXTURE_LIBRARY.filter(group.match).filter((f) => !axes || axesOf(f) === axes).filter((f) => {
    if (!words.length) return true;
    const text = `${f.label} ${f.family} ${f.key} ${f.manufacturer || ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** One-line spec shown on an asset card. */
export function assetSummary(entry) {
  const e = entry?.engineering || {};
  const bits = [];
  const axes = isMovingNozzle(entry) ? axesOf(entry) : 0;
  if (axes) bits.push(`${axes}D`);
  if (num(e.opticalPowerW) > 0) bits.push(num(e.opticalPowerW) >= 1 ? `${num(e.opticalPowerW)} W` : `${Math.round(num(e.opticalPowerW) * 1000)} mW`);
  if (e.laserKind) bits.push(e.laserKind);
  if (num(e.jetHeightM) > 0) bits.push(`${num(e.jetHeightM).toFixed(1)} m`);
  if (num(e.powerKw) > 0) bits.push(`${num(e.powerKw)} kW`);
  if (num(e.flowM3Hr) > 0) bits.push(`${num(e.flowM3Hr)} m³/h`);
  else if (num(e.flowLpm) > 0) bits.push(`${Math.round(num(e.flowLpm))} L/min`);
  if (num(e.wattage) > 0) bits.push(`${num(e.wattage)} W`);
  if (e.connectionSize) bits.push(e.connectionSize);
  return bits.slice(0, 3).join(" · ");
}

/** The 3D model kind (components/preview/equipmentAssets.js) for a fixture. */
export function modelKindOf(fixture) {
  const role = roleOf(fixture);
  const type = String(fixture?.type || "");
  if (role === "pump") return "pump";
  if (role === "valve") return /manifold|distributor/i.test(type) ? "distributor" : "valve";
  if (role === "light") return "light";
  if (role === "nozzle") {
    const kind = nozzleKind(fixture).id;
    return { basket: "pirouette", geyser: "geyser", jumping: "laminar", curtain: "fan_jet", swing: "motion" }[kind] || "jet";
  }
  if (/laser/i.test(type)) return "laser";
  if (/flame|fire/i.test(type)) return "flame";
  return null;
}

// ─── links ──────────────────────────────────────────────────────────────────

export const LINK_STYLE = {
  pump: { color: "#38bdf8", label: "Water supply" },
  valve: { color: "#a78bfa", label: "Valve outlet" },
  light: { color: "#facc15", label: "Light pairing" },
};

/**
 * Every connection as a line. Each: { id, kind: 'pump'|'valve'|'light', from, to }.
 *   pump  → valve   (valve on a pump)
 *   pump  → nozzle  (nozzle fed directly, no own valve)
 *   valve → nozzle
 *   light → nozzle  (explicit pairing only; an unpaired light just follows the nearest jet)
 */
export function designLinks(fixtures = [], design = readConnections(fixtures)) {
  const links = [];
  const seen = new Set();
  const add = (kind, from, to) => {
    const id = `${kind}:${from}>${to}`;
    if (!from || !to || seen.has(id)) return;
    seen.add(id);
    links.push({ id, kind, from, to });
  };
  for (const n of design.nozzles) {
    if (n.valveId) {
      add("valve", n.valveId, n.id);
      if (n.pumpId) add("pump", n.pumpId, n.valveId);
    } else if (n.pumpId) add("pump", n.pumpId, n.id);
  }
  for (const v of design.valves.values()) {
    if (v.nozzleIds.length) continue;
    const pid = v.item.engineering?.pumpId || v.item.engineering?.supplyingPumpId;
    if (pid && design.pumps.has(pid)) add("pump", pid, v.id);
  }
  for (const l of design.lights) {
    const explicit = l.item.engineering?.pairedNozzleId || l.item.pairedNozzleId;
    if (explicit && design.nozzleById.has(explicit)) add("light", l.id, explicit);
  }
  return links;
}

/** Which roles can be plugged together, as [upstream, downstream]. */
const PAIRS = [["pump", "nozzle"], ["pump", "valve"], ["valve", "nozzle"], ["light", "nozzle"]];

/** True when a and b can be connected (in either order). */
export function canConnect(fixtures, aId, bId) {
  if (!aId || !bId || aId === bId) return false;
  const a = fixtures.find((f) => f.id === aId), b = fixtures.find((f) => f.id === bId);
  if (!a || !b) return false;
  const ra = roleOf(a), rb = roleOf(b);
  return PAIRS.some(([u, d]) => (ra === u && rb === d) || (ra === d && rb === u));
}

/**
 * Connect two fixtures (order does not matter).
 * @returns {{ fixtures, ok: boolean, message: string }}
 */
export function connectPair(fixtures, aId, bId) {
  const a = fixtures.find((f) => f.id === aId), b = fixtures.find((f) => f.id === bId);
  if (!a || !b || aId === bId) return { fixtures, ok: false, message: "Nothing to connect." };
  const pair = PAIRS.find(([u, d]) => (roleOf(a) === u && roleOf(b) === d) || (roleOf(a) === d && roleOf(b) === u));
  if (!pair) return { fixtures, ok: false, message: `A ${roleOf(a)} cannot connect to a ${roleOf(b)}.` };
  const [up, down] = roleOf(a) === pair[0] ? [a, b] : [b, a];
  const key = pair.join("-");
  let next = fixtures;
  if (key === "pump-nozzle" || key === "pump-valve") next = connectToPump(fixtures, [down.id], up.id);
  else if (key === "valve-nozzle") {
    next = setNozzleValve(fixtures, down.id, up.id);
    // The jet takes its valve's pump; a valve with no pump yet takes the jet's.
    const d = readConnections(next);
    const valvePump = up.engineering?.pumpId;
    const jet = d.nozzleById.get(down.id);
    if (valvePump && d.pumps.has(valvePump) && jet?.pumpId !== valvePump) next = connectToPump(next, [down.id], valvePump);
  } else if (key === "light-nozzle") {
    next = pairLights(fixtures, [up.id], down.id);
    const h = num(down.engineering?.jetHeightM, 0) > 0 ? num(down.engineering.jetHeightM) : 2;
    if (!(lightCoverage(up, down, h, nozzleKind(down).id) > 0)) {
      return { fixtures: next, ok: true, message: `${nameOf(up)} → ${nameOf(down)} paired, but the light's beam does not reach that jet — move the light next to it (or widen its beam) to colour the water.` };
    }
  }
  return { fixtures: next, ok: true, message: `${nameOf(up)} → ${nameOf(down)} connected.` };
}

/** Remove one line. */
export function disconnectLink(fixtures, link) {
  if (!link) return fixtures;
  const design = readConnections(fixtures);
  if (link.kind === "light") return pairLights(fixtures, [link.from], null, design);
  if (link.kind === "valve") {
    // Pulling the valve off its jet: the jet loses the valve AND the water it brought.
    const next = disconnectValve(fixtures, [link.to], design);
    return connectToPump(next, [link.to], null);
  }
  return connectToPump(fixtures, [link.to], null, design);
}

/**
 * Pull one end of a line off and plug it into `targetId` (null = just unplug).
 * `end` is 'from' or 'to': the end the user grabbed. The other end stays where it is.
 * @returns {{ fixtures, ok, message }}
 */
export function replugLink(fixtures, link, end, targetId) {
  if (!link) return { fixtures, ok: false, message: "No connection selected." };
  const fixed = end === "from" ? link.to : link.from;
  const moved = end === "from" ? link.from : link.to;
  if (!targetId) return { fixtures: disconnectLink(fixtures, link), ok: true, message: "Connection unplugged." };
  if (targetId === moved) return { fixtures, ok: true, message: "Plugged back in." };
  if (!canConnect(fixtures, fixed, targetId)) {
    const t = fixtures.find((f) => f.id === targetId), k = fixtures.find((f) => f.id === fixed);
    return { fixtures, ok: false, message: `Can't plug a ${roleOf(k)} into a ${roleOf(t)}.` };
  }
  const result = connectPair(disconnectLink(fixtures, link), fixed, targetId);
  return result.ok ? { ...result, message: `Re-plugged: ${result.message}` } : result;
}

// ─── drop + auto-connect ────────────────────────────────────────────────────

function nearest(list, from, filter = () => true) {
  let best = null, bestD = Infinity;
  for (const item of list) {
    if (!filter(item)) continue;
    const d = dist(item.item || item, from);
    if (d < bestD) { bestD = d; best = item; }
  }
  return best ? { item: best, d: bestD } : null;
}

/** Count fixtures already using a library type, for "Straight Jet 3"-style names. */
function nextLabel(fixtures, entry) {
  const base = String(entry?.label || entry?.key || "Item").replace(/\s+Ø.*$/, "");
  const used = new Set(fixtures.map((f) => f.label));
  for (let i = 1; ; i += 1) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * Wire one fixture to the design the way a fountain builder would. Does nothing when there is
 * nothing to wire to yet (a pump dropped later picks the waiting jets up).
 * @returns {{ fixtures, lines: string[] }}
 */
export function autoConnectItem(fixtures, id) {
  const item = fixtures.find((f) => f.id === id);
  if (!item) return { fixtures, lines: [] };
  const design = readConnections(fixtures);
  const role = roleOf(item);
  const lines = [];
  let next = fixtures;
  if (role === "nozzle") {
    const freeValve = nearest([...design.valves.values()], item, (v) => !v.nozzleIds.length);
    if (freeValve && freeValve.d <= 1.5) {
      next = connectPair(next, freeValve.item.id, id).fixtures;
      lines.push(`${nameOf(item)} → ${nameOf(freeValve.item.item)}`);
    }
    const now = readConnections(next).nozzleById.get(id);
    if (!now?.pumpId) {
      const pump = nearest([...design.pumps.values()], item);
      if (pump) {
        next = connectToPump(next, [id], pump.item.id);
        lines.push(`${nameOf(item)} → ${pump.item.name}`);
      }
    }
  } else if (role === "pump") {
    const waiting = [...design.nozzles.filter((n) => !n.pumpId && !n.valveId).map((n) => n.id),
      ...[...design.valves.values()].filter((v) => !v.item.engineering?.pumpId && !v.nozzleIds.some((nid) => design.nozzleById.get(nid)?.pumpId)).map((v) => v.id)];
    if (waiting.length) {
      next = connectToPump(next, waiting, id);
      lines.push(`${nameOf(item)} now feeds ${waiting.length} item${waiting.length === 1 ? "" : "s"}`);
    }
  } else if (role === "valve") {
    const jet = nearest(design.nozzles, item, (n) => !n.valveId);
    if (jet) {
      next = connectPair(next, id, jet.item.id).fixtures;
      lines.push(`${nameOf(item)} → ${nameOf(jet.item.item)}`);
    } else {
      const pump = nearest([...design.pumps.values()], item);
      if (pump) {
        next = connectToPump(next, [id], pump.item.id);
        lines.push(`${nameOf(item)} on ${pump.item.name}`);
      }
    }
  } else if (role === "light") {
    // Only a jet the beam really reaches.
    const jet = litNozzle(fixtures, id, design);
    if (jet) {
      next = pairLights(next, [id], jet.id);
      lines.push(`${nameOf(item)} lights ${nameOf(jet.item)}`);
    }
  }
  return { fixtures: next, lines };
}

/**
 * A new fixture from the library at plan point {x, y}, auto-connected.
 * @returns {{ fixtures, id, lines }}
 */
export function dropAsset(fixtures = [], key, point = { x: 0, y: 0 }) {
  const entry = getFixtureLibraryEntry(key);
  const fixture = createFixtureEntity({
    type: key, x: round(point.x), y: round(point.y), label: nextLabel(fixtures, entry),
    extra: { z: 0, visible: true, layer: fixtureLayerKey(key),
      ...(roleOf(entry || { type: key }) === "light" ? { color: defaultLightColor(entry) } : {}),
      // A laser's catalogue colour is its beam colour (e.g. #3dff4f for 532 nm green).
      ...(effectOf({ type: key }) === "laser" && /^#[0-9a-f]{6}$/i.test(String(entry?.color || "")) ? { color: entry.color } : {}) },
  });
  const placed = [...fixtures, fixture];
  const { fixtures: next, lines } = autoConnectItem(placed, fixture.id);
  return { fixtures: next, id: fixture.id, lines };
}

/** A new light's colour: its datasheet colour, else water blue (entry.color is only the UI swatch). */
function defaultLightColor(entry) {
  const c = entry?.engineering?.color;
  return /^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : "#4fc3ff";
}

const round = (v) => Math.round(num(v) * 1000) / 1000;

/** Connect everything that is still loose: jets to pumps, lights to the jet their beam reaches. */
export function autoConnectAll(fixtures = []) {
  const a = autoPumps(fixtures, { mode: "nearest" });
  let next = a.fixtures;
  const lines = [...a.lines];
  const design = readConnections(next);
  for (const l of design.lights) {
    const explicit = l.item.engineering?.pairedNozzleId || l.item.pairedNozzleId;
    if (explicit && design.nozzleById.has(explicit)) continue;
    const jet = litNozzle(next, l.id, design);
    if (!jet) continue;
    next = pairLights(next, [l.id], jet.id);
    lines.push(`${nameOf(l.item)} → ${nameOf(jet.item)}`);
  }
  return { fixtures: next, lines };
}

/** After an item moved: re-pair the lights whose beams it affects (the light itself, or a jet's lights). */
export function afterMove(fixtures, id) {
  const item = fixtures.find((f) => f.id === id);
  const role = roleOf(item);
  if (role === "light") return repairLight(fixtures, id);
  if (role !== "nozzle") return { fixtures, message: "" };
  let next = fixtures, message = "";
  for (const l of readConnections(fixtures).lights) {
    const paired = l.item.engineering?.pairedNozzleId || l.item.pairedNozzleId;
    if (paired && paired !== id) continue;     // a light lighting another jet keeps its jet
    const r = repairLight(next, l.id);
    next = r.fixtures;
    if (r.message) message += ` ${nameOf(l.item)}:${r.message}`;
  }
  return { fixtures: next, message };
}

/** Remove fixtures and every link that pointed at them. */
export function removeFixtures(fixtures = [], ids = []) {
  const gone = new Set(ids);
  let next = fixtures;
  const design = readConnections(fixtures);
  for (const id of ids) {
    const role = roleOf(fixtures.find((f) => f.id === id));
    if (role === "pump") next = connectToPump(next, design.pumps.get(id)?.nozzleIds || [], null);
    if (role === "valve") next = disconnectValve(next, design.valves.get(id)?.nozzleIds || []);
    if (role === "nozzle") next = pairLights(next, design.nozzleById.get(id)?.lightIds.filter((l) => {
      const f = fixtures.find((x) => x.id === l);
      return f?.engineering?.pairedNozzleId === id;
    }) || [], null);
  }
  return next.filter((f) => !gone.has(f.id));
}

// ─── live water ─────────────────────────────────────────────────────────────

/** The motor power a pump has (kW), from its own fields. */
export function pumpPowerKw(item) {
  const e = item?.engineering || {};
  if (num(e.powerKw) > 0) return num(e.powerKw);
  if (num(e.powerW) > 0) return num(e.powerW) / 1000;
  return num(item?.electrical?.powerW) / 1000 || 0;
}

/** Hydraulic power (kW) a jet needs at full height: ρ·g·Q·H / η. */
export function jetPowerKw(item, efficiency = 0.6) {
  const q = jetFlowLpm(item) / 60000;       // m³/s
  const h = jetHeadM(item) || num(item?.engineering?.jetHeightM) * 1.25;
  return (RHO * G * q * h) / (1000 * Math.max(0.2, efficiency));
}

const HEX = /^#[0-9a-f]{6}$/i;
export const lightColorOf = (item) => {
  const c = item?.color || item?.engineering?.color;
  return HEX.test(String(c || "")) ? c : "#4fc3ff";
};

/**
 * What every jet really does right now.
 * `live` holds the preview switches (not saved): { [id]: { on?: boolean } } — pumps, valves,
 * nozzles and lights all default to on.
 * @returns {{ jets: Array<{ id, kind, heightM, targetHeightM, flowLpm, color, intensity, on, reason }>,
 *             pumps: Map<id,{ loadPct, powerKw, needKw, speedPct, jets, on }> }}
 */
export function liveJets(fixtures = [], live = {}, design = readConnections(fixtures)) {
  const isOn = (id) => live?.[id]?.on !== false;
  const pumps = new Map();
  for (const p of design.pumps.values()) {
    const e = p.item.engineering || {};
    const speed = Math.max(0, Math.min(100, num(e.speedPct, 100))) / 100;
    const on = isOn(p.id);
    const open = p.nozzleIds.filter((id) => {
      const n = design.nozzleById.get(id);
      return isOn(id) && (!n.valveId || isOn(n.valveId));
    });
    const eff = num(e.pumpEfficiency, 0.6) || 0.6;
    const needFull = open.reduce((s, id) => s + jetPowerKw(design.nozzleById.get(id).item, eff), 0);
    const need = needFull * speed ** 3;                     // affinity law P ∝ n³
    const have = pumpPowerKw(p.item);
    const powerScale = have > 0 && need > have ? (have / need) ** (2 / 3) : (have > 0 ? 1 : 0);
    pumps.set(p.id, { id: p.id, name: p.name, on, speedPct: Math.round(speed * 100), powerKw: have,
      needKw: Math.round(need * 100) / 100, loadPct: have > 0 ? Math.round((100 * need) / have) : null,
      jets: p.nozzleIds.length, open: open.length, heightScale: on ? speed ** 2 * powerScale : 0 });
  }
  // Light colour on a jet only where a light's beam really reaches the water (not by pairing:
  // a light moved away from its jet no longer colours it), mixed by intensity × coverage.
  const lightsOn = design.lights.map((l) => ({ l, k: Math.max(0, Math.min(100, num(l.item.engineering?.intensityPct, 100))) / 100 }))
    .filter(({ l, k }) => k > 0 && isOn(l.id));
  const jets = design.nozzles.map((n) => {
    const e = n.item.engineering || {};
    // Only real water outlets spray: control panels, tanks and actuators the reader files as
    // "nozzles" (no jet height, not a nozzle type) stay dry.
    const water = num(e.jetHeightM, 0) > 0 || /^(nozzle_|motion_nozzle_)/.test(String(n.item.type || ""));
    // Without a datasheet height: 6 m for a moving nozzle (they are show jets), 2 m for others.
    const base = num(e.jetHeightM, 0) > 0 ? num(e.jetHeightM) : (water ? (isMovingNozzle({ type: n.item.type, key: n.item.type }) ? 6 : 2) : 0);
    let reason = "";
    let scale = 1;
    if (!water) { scale = 0; reason = "Not a water outlet"; }
    else if (!isOn(n.id)) { scale = 0; reason = "Switched off"; }
    else if (n.valveId && !isOn(n.valveId)) { scale = 0; reason = "Valve closed"; }
    else if (!n.pumpId) { scale = 0; reason = "No pump connected — no water"; }
    else {
      const p = pumps.get(n.pumpId);
      scale = p.heightScale;
      if (!p.on) reason = "Pump is off";
      else if (p.powerKw <= 0) reason = "Pump has no power";
      else if (p.loadPct > 100) reason = `Pump overloaded (${p.loadPct}%) — jets drop`;
    }
    const lights = [];
    for (const { l, k } of lightsOn) {
      const c = lightCoverage(l.item, n.item, base * scale, n.kind);
      if (c > 0) lights.push({ color: lightColorOf(l.item), k: k * c });
    }
    const strength = Math.min(1, lights.reduce((s, x) => s + x.k, 0));
    return { id: n.id, kind: n.kind, heightM: base * scale, nominalHeightM: base, flowLpm: jetFlowLpm(n.item) * Math.sqrt(scale),
      color: lights.length ? mixColors(lights) : null, intensity: strength, on: scale > 0, reason,
      spreadDeg: num(e.sprayAngleDeg, 0), outlets: Math.max(1, Math.round(num(e.outletCount, 0))),
      motion: motionOf(n.item) };
  });
  return { jets, pumps };
}

// ─── moving nozzles ─────────────────────────────────────────────────────────

/**
 * Motion patterns, by the axes they need. Real drives (Huaxin, OASE, Longxin, Symphony …):
 *   1D  one swing axis: the jet sweeps in one vertical plane (typically ±60°)
 *   2D  tilt axis (±80°) + 360° rotation: the jet can point anywhere in a cone
 *   3D  2D + a 360° spinning nozzle head: a multi-outlet / fan head twists the water into helices
 */
export const MOTION_PATTERNS = [
  { id: "sweep", label: "Sweep (swing side to side)", axes: 1 },
  { id: "wave", label: "Wave (sweep, offset along the row)", axes: 1 },
  { id: "circle", label: "Rotating cone", axes: 2 },
  { id: "figure8", label: "Figure 8", axes: 2 },
  { id: "cross", label: "Cross (+)", axes: 2 },
  { id: "dance", label: "Free dance", axes: 2 },
  { id: "spiral", label: "Spiral (cone opening and closing)", axes: 2 },
];

/** Peak angular speed (°/s) of a pattern at `hz` with tilt amplitude `amp` (°). */
function peakDegPerSec(pattern, amp, hz) {
  const w = 2 * Math.PI * hz;
  if (pattern === "circle") return w * Math.sin((amp * 0.8 * Math.PI) / 180) * (180 / Math.PI);  // rotation speed at the cone
  if (pattern === "figure8") return w * amp * 1.56;
  if (pattern === "dance") return w * amp * 1.3;
  return w * amp;
}

/**
 * How a moving nozzle moves (null for a fixed one). Angles in degrees, speed in cycles per second.
 *   range     full swing / tilt range (120 = ±60°)
 *   pan       rotation range (2D/3D)
 *   driveDegS the drive's top speed: the motion is slowed to it, as a real stepper drive would be
 *   spinRpm, outlets, splayDeg   the spinning head of a 3D nozzle
 */
export function motionOf(item) {
  const axes = isMovingNozzle({ type: item?.type, key: item?.type, engineering: item?.engineering, category: getFixtureLibraryEntry(item?.type)?.category })
    ? axesOf(item) : 0;
  if (!axes) return null;
  const e = item.engineering || {};
  const rangeDefault = axes === 1 ? 120 : 140;
  const range = Math.max(0, Math.min(180, num(e.tiltRangeDeg, num(e.swingRangeDeg, num(e.angleRangeDeg, rangeDefault)))));
  const pan = Math.max(0, Math.min(360, num(e.panRangeDeg, axes >= 2 ? 360 : 0)));
  const driveDegS = Math.max(10, num(e.speedDegSec, axes === 1 ? 90 : 120));
  const allowed = MOTION_PATTERNS.filter((p) => p.axes <= axes).map((p) => p.id);
  const pattern = allowed.includes(e.motionPattern) ? e.motionPattern : (axes >= 2 ? "circle" : "sweep");
  const amp = range / 2;
  const wanted = num(e.motionSpeedHz, 0) > 0 ? num(e.motionSpeedHz) : 0.25;
  // Slew limit: the drive cannot turn faster than its rated °/s.
  const peak = peakDegPerSec(pattern, Math.max(1, amp), wanted);
  const speedHz = peak > driveDegS ? wanted * (driveDegS / peak) : wanted;
  return {
    axes, pattern, range, pan, driveDegS,
    speedHz: Math.round(speedHz * 1000) / 1000, wantedHz: wanted, limited: peak > driveDegS * 1.001,
    spinRpm: axes >= 3 ? num(e.headSpinRpm, 30) : 0,
    outlets: axes >= 3 ? Math.max(1, Math.min(6, Math.round(num(e.outletCount, 3)))) : 1,
    splayDeg: axes >= 3 ? num(e.outletSplayDeg, 12) : 0,
    liftM: axes >= 3 ? num(e.liftStrokeMm, 0) / 1000 : 0,
    phase: num(item.x, 0) * 0.35,
  };
}

// ─── lasers, flames, fog ────────────────────────────────────────────────────

export const LASER_PATTERN_OPTIONS = ["beam", "fan", "sheet", "cone", "scan", "searchlight", "liquidsky", "firefly", "graphics"];

/** The effect an item shows in 3D (null for equipment that only stands there). */
export function effectOf(item) {
  const type = String(item?.type || "");
  if (type === "laser" || type.startsWith("laser_")) return "laser";
  if (/^effect_flame|flame_(burner|jet|effect)|^sfx_flame/i.test(type)) return "flame";
  if (/fog|haze|smoke/i.test(type) && !/^nozzle_/i.test(type)) return "fog";
  return null;
}

/** Laser state for the shared laser engine (preview/laser/laserRig.js laserFrame). */
export function laserStateOf(item, on = true) {
  const e = item?.engineering || {};
  // A beam show laser's typical look is a fan of beams; it can be set to a single beam.
  const kindPattern = { beam: "fan", graphics: "graphics", mapping: "graphics", fan: "fan", liquidsky: "liquidsky", sky: "searchlight", firefly: "firefly", movinghead: "scan" }[e.laserKind] || "fan";
  const pattern = LASER_PATTERN_OPTIONS.includes(e.laserPattern) ? e.laserPattern : kindPattern;
  const hex = lightColorOf({ color: item?.color || e.defaultColor || "#3dff4f" });
  const v = parseInt(hex.slice(1), 16);
  const panHalf = Math.min(180, num(e.panRangeDeg, 180) / 2), tiltHalf = Math.min(90, num(e.tiltRangeDeg, 180) / 2);
  return {
    intensity: on ? Math.max(0, Math.min(100, num(e.intensityPct, 100))) / 100 : 0,
    color: { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 },
    pattern,
    pan: Math.max(-panHalf, Math.min(panHalf, num(e.laserPanDeg, 0))),
    tilt: Math.max(-tiltHalf, Math.min(tiltHalf, num(e.laserTiltDeg, pattern === "liquidsky" ? 80 : 0))),
    size: Math.max(2, Math.min(90, num(e.laserSizeDeg, pattern === "sheet" || pattern === "liquidsky" ? 60 : 30))),
    speed: Math.max(0, Math.min(2, num(e.laserSpeedHz, 0.25))),
  };
}

/** Flame / fog settings for the 3D effect. */
export function flameOf(item, on = true) {
  const e = item?.engineering || {};
  return { heightM: Math.max(0.2, num(e.flameHeightM, num(e.heightM, 2))), intensity: on ? Math.max(0, Math.min(100, num(e.intensityPct, 100))) / 100 : 0,
    burst: /burst/i.test(String(item?.type || "")) || e.flameMode === "burst" };
}
export function fogOf(item, on = true) {
  const e = item?.engineering || {};
  return { radiusM: Math.max(0.5, num(e.fogRadiusM, 3)), density: on ? Math.max(0, Math.min(100, num(e.intensityPct, 70))) / 100 : 0 };
}

const LIGHT_LENS_M = 0.15;   // beam width at the lens: a light right beside a jet still reaches it

/** How far the water of a jet spreads sideways from its nozzle (m). */
function jetSpreadM(kind, heightM) {
  if (kind === "ring" || kind === "basket" || kind === "curtain") return 0.4 * heightM;
  if (kind === "mist") return 0.6;
  if (kind === "jumping" || kind === "swing") return 0.5 * heightM;
  return 0.05;
}

/**
 * Share (0..1) of a jet's water inside a light's beam. The beam is a cone straight up from the
 * light with its beam angle; the jet is lit from the height where the cone has widened to reach
 * it up to the top of the water. 0 when the beam never touches the jet.
 */
export function lightCoverage(light, nozzle, heightM, kind = "jet") {
  if (!(heightM > 0)) return 0;
  const d = Math.max(0, dist(light, nozzle) - jetSpreadM(kind, heightM));
  const beam = Math.max(5, Math.min(170, num(light?.engineering?.beamAngleDeg, 40)));
  const t = Math.tan((beam * Math.PI) / 360);
  const reachAt = d <= LIGHT_LENS_M ? 0 : (d - LIGHT_LENS_M) / t;   // height where the cone reaches the jet
  if (reachAt >= heightM) return 0;
  return 1 - reachAt / heightM;
}

/** The nozzle a light's beam covers best (null when its beam reaches none). */
export function litNozzle(fixtures, lightId, design = readConnections(fixtures)) {
  const light = fixtures.find((f) => f.id === lightId);
  if (!light) return null;
  let best = null, bestC = 0;
  for (const n of design.nozzles) {
    const h = num(n.item.engineering?.jetHeightM, 0) > 0 ? num(n.item.engineering.jetHeightM) : 2;
    const c = lightCoverage(light, n.item, h, n.kind);
    if (c > bestC) { bestC = c; best = n; }
  }
  return best;
}

/**
 * After a light moved: pair it with the jet its beam now reaches best, or unpair it when its
 * beam reaches no jet. @returns {{ fixtures, message }}
 */
export function repairLight(fixtures, lightId) {
  const design = readConnections(fixtures);
  const light = fixtures.find((f) => f.id === lightId);
  if (!light || roleOf(light) !== "light") return { fixtures, message: "" };
  const target = litNozzle(fixtures, lightId, design);
  const current = light.engineering?.pairedNozzleId || light.pairedNozzleId || null;
  if (target?.id === current) return { fixtures, message: "" };
  if (target) return { fixtures: pairLights(fixtures, [lightId], target.id, design), message: ` Now lights ${nameOf(target.item)}.` };
  return { fixtures: current ? pairLights(fixtures, [lightId], null, design) : fixtures, message: " Its beam reaches no jet, so it no longer colours any water." };
}

function mixColors(list) {
  let r = 0, g = 0, b = 0, w = 0;
  for (const { color, k } of list) {
    const v = parseInt(color.slice(1), 16);
    r += ((v >> 16) & 255) * k; g += ((v >> 8) & 255) * k; b += (v & 255) * k; w += k;
  }
  const hex = (x) => Math.round(x / Math.max(w, 1e-6)).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ─── properties ─────────────────────────────────────────────────────────────

/** Fields offered first per role (the rest appear under "All properties"). */
export const ROLE_FIELDS = {
  pump: [
    { key: "powerKw", label: "Motor power", unit: "kW", min: 0, max: 75, step: 0.25 },
    { key: "speedPct", label: "Speed (VFD)", unit: "%", min: 0, max: 100, step: 1, fallback: 100, slider: true },
    { key: "flowM3Hr", label: "Rated flow", unit: "m³/h", min: 0, max: 500, step: 1 },
    { key: "headM", label: "Rated head", unit: "m", min: 0, max: 150, step: 0.5 },
  ],
  nozzle: [
    { key: "jetHeightM", label: "Jet height", unit: "m", min: 0, max: 60, step: 0.1, slider: true, sliderMax: 25 },
    { key: "flowLpm", label: "Flow", unit: "L/min", min: 0, max: 5000, step: 1 },
    { key: "nozzleDiaMm", label: "Nozzle bore", unit: "mm", min: 1, max: 200, step: 1 },
    { key: "pressureBar", label: "Pressure", unit: "bar", min: 0, max: 20, step: 0.1 },
    { key: "sprayAngleDeg", label: "Spray angle", unit: "°", min: 0, max: 180, step: 1 },
  ],
  valve: [
    { key: "responseTimeS", label: "Response time", unit: "s", min: 0, max: 5, step: 0.05 },
  ],
  light: [
    { key: "intensityPct", label: "Intensity", unit: "%", min: 0, max: 100, step: 1, fallback: 100, slider: true },
    { key: "wattage", label: "Power", unit: "W", min: 0, max: 1000, step: 1 },
    { key: "beamAngleDeg", label: "Beam angle", unit: "°", min: 1, max: 120, step: 1 },
  ],
  effect: [],
};

/**
 * The fields shown for one placed item: its role's fields, plus motion controls for a moving
 * nozzle and effect controls for lasers, flames and fog. Select fields carry `options`.
 */
export function fieldsFor(item) {
  const role = roleOf(item);
  const e = item?.engineering || {};
  const motion = role === "nozzle" ? motionOf(item) : null;
  // Jet height shows the height the 3D view uses when the datasheet gives none.
  const out = (ROLE_FIELDS[role] || []).map((d) => (d.key === "jetHeightM" ? { ...d, fallback: motion ? 6 : 2 } : d));
  if (motion) {
    const rangeKey = ["tiltRangeDeg", "swingRangeDeg", "angleRangeDeg"].find((k) => k in e) || "tiltRangeDeg";
    out.push(
      { key: "motionPattern", label: `Motion (${motion.axes}D)`, select: true, fallback: motion.pattern,
        options: MOTION_PATTERNS.filter((p) => p.axes <= motion.axes).map((p) => ({ value: p.id, label: p.label })) },
      { key: "motionSpeedHz", label: "Motion speed", unit: "Hz", min: 0.02, max: 2, step: 0.02, slider: true, fallback: motion.wantedHz },
      { key: rangeKey, label: motion.axes === 1 ? "Swing range" : "Tilt range", unit: "°", min: 0, max: 180, step: 5, slider: true, fallback: motion.range },
      { key: "speedDegSec", label: "Drive top speed", unit: "°/s", min: 10, max: 360, step: 5, fallback: motion.driveDegS },
    );
    if (motion.axes >= 2) out.push({ key: "panRangeDeg", label: "Rotation range", unit: "°", min: 0, max: 360, step: 5, slider: true, fallback: motion.pan });
    if (motion.axes >= 3) out.push(
      { key: "headSpinRpm", label: "Head spin", unit: "rpm", min: -120, max: 120, step: 1, slider: true, fallback: motion.spinRpm },
      { key: "outletCount", label: "Outlets on the head", unit: "", min: 1, max: 6, step: 1, slider: true, fallback: motion.outlets },
      { key: "outletSplayDeg", label: "Outlet splay", unit: "°", min: 0, max: 40, step: 1, slider: true, fallback: motion.splayDeg },
    );
  }
  const fx = effectOf(item);
  if (fx === "laser") {
    const s = laserStateOf(item);
    out.push(
      { key: "laserPattern", label: "Laser look", select: true, fallback: s.pattern, options: LASER_PATTERN_OPTIONS.map((p) => ({ value: p, label: p })) },
      { key: "intensityPct", label: "Output", unit: "%", min: 0, max: 100, step: 1, slider: true, fallback: 100 },
      { key: "laserSizeDeg", label: "Fan / cone width", unit: "°", min: 2, max: 90, step: 1, slider: true, fallback: s.size },
      { key: "laserSpeedHz", label: "Scan speed", unit: "Hz", min: 0, max: 2, step: 0.05, slider: true, fallback: s.speed },
      { key: "laserTiltDeg", label: "Tilt from vertical", unit: "°", min: -90, max: 90, step: 1, slider: true, fallback: s.tilt },
      { key: "laserPanDeg", label: "Pan", unit: "°", min: -180, max: 180, step: 1, slider: true, fallback: s.pan },
      { key: "mountHeightM", label: "Mount height", unit: "m", min: 0, max: 30, step: 0.1, slider: true, sliderMax: 12, fallback: 0.5 },
    );
  } else if (fx === "flame") {
    out.push(
      { key: "intensityPct", label: "Flame size", unit: "%", min: 0, max: 100, step: 1, slider: true, fallback: 100 },
      { key: "flameHeightM", label: "Flame height", unit: "m", min: 0.2, max: 12, step: 0.1, slider: true, fallback: flameOf(item).heightM },
      { key: "flameMode", label: "Mode", select: true, fallback: flameOf(item).burst ? "burst" : "steady",
        options: [{ value: "steady", label: "Steady flame" }, { value: "burst", label: "Bursts" }] },
    );
  } else if (fx === "fog") {
    out.push(
      { key: "intensityPct", label: "Fog density", unit: "%", min: 0, max: 100, step: 1, slider: true, fallback: 70 },
      { key: "fogRadiusM", label: "Fog spread", unit: "m", min: 0.5, max: 15, step: 0.5, slider: true, fallback: 3 },
    );
  }
  return out;
}

/** Engineering fields that are links, not properties (edited through the connections). */
export const LINK_FIELDS = new Set(["pumpId", "supplyingPumpId", "solenoidValveId", "linkedValveId", "valveId",
  "controlledFixtureId", "servesValveIds", "pairedNozzleId", "dataSource"]);

/** A fixture with one engineering field changed (numbers stay numbers). */
export function setEngineeringField(fixtures, id, key, value) {
  return fixtures.map((f) => {
    if (f.id !== id) return f;
    const prev = f.engineering?.[key];
    const v = typeof prev === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) && typeof prev !== "string")
      ? num(value, 0) : value;
    return { ...f, engineering: { ...(f.engineering || {}), [key]: v } };
  });
}

/** A fixture with top-level fields changed (label, x, y, z, rotation, color). */
export function setFixtureFields(fixtures, id, patch) {
  return fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f));
}
