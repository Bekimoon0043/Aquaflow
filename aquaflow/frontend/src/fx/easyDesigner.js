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

export const ASSET_GROUPS = [
  { id: "nozzles", label: "Nozzles", categories: ["Nozzles"] },
  { id: "pumps", label: "Pumps", categories: ["Pumps"] },
  { id: "valves", label: "Valves", categories: ["Valves"] },
  { id: "lights", label: "Lights", categories: ["Lights"] },
  { id: "effects", label: "Effects", categories: ["Laser", "Flame", "Fog", "Effects", "Air Systems", "Motion Systems"] },
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

/** Library entries for a tray tab, filtered by a search text (label, family, key). */
export function assetsFor(groupId, query = "") {
  const group = ASSET_GROUPS.find((g) => g.id === groupId) || ASSET_GROUPS[0];
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  return FIXTURE_LIBRARY.filter((f) => group.categories.includes(f.category)).filter((f) => {
    if (!words.length) return true;
    const text = `${f.label} ${f.family} ${f.key} ${f.manufacturer || ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** One-line spec shown on an asset card. */
export function assetSummary(entry) {
  const e = entry?.engineering || {};
  const bits = [];
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
    extra: { z: 0, visible: true, layer: fixtureLayerKey(key), ...(roleOf(entry || { type: key }) === "light" ? { color: defaultLightColor(entry) } : {}) },
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
    const base = num(e.jetHeightM, 0) > 0 ? num(e.jetHeightM) : 2;
    let reason = "";
    let scale = 1;
    if (!isOn(n.id)) { scale = 0; reason = "Switched off"; }
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
      spreadDeg: num(e.sprayAngleDeg, 0), outlets: Math.max(1, Math.round(num(e.outletCount, 0))) };
  });
  return { jets, pumps };
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
