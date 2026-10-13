// fixtureTypeReplacement.js — AF-NEXT-012 (Fixture data trust)
//
// Replacing a placed fixture's TYPE (e.g. DN15 jet → DN25 jet, RGB → RGBW light):
//   * the type's engineering defaults replace the old type's values, so every
//     dependent calculation (BOM, equipment totals, electrical load, pipework,
//     hydraulic solve) is recomputed from the new type — the report lists them;
//   * the CONTROL FOOTPRINT (protocol, DMX channel count, valve/PLC/DI/DO/AI/AO
//     needs) is compared, and any change is flagged on the fixture as
//     `controlReview` with a visible list of affected items;
//   * addresses are NEVER silently reassigned: the fixture's existing DMX / PLC /
//     Modbus / valve addresses are kept exactly as they were, and the new type's
//     library default addresses (e.g. dmxUniverse/dmxAddress) are NOT applied. A
//     new type that needs an address it does not have is flagged "unassigned".
//   * an instance-level provenance link (e.g. a measured model of the old type) is
//     dropped — it described the old equipment — and reported.
import { getDefaultEngineering, getFixtureLibraryEntry, getFixtureRatings, getFixtureProvenance } from "../data/fixtureLibrary.js";
import { readPatch } from "../runtime/dmxPatch.js";
import { isWaterNozzleFixture } from "./hydraulicAdapter.js";

/** Engineering keys that hold control ADDRESSES (never overwritten by a type swap). */
const ADDRESS_KEY = /^(dmxUniverse|dmxAddress|dmxChannel|universe|channel|startChannel|artnetUniverse|sacnUniverse|plcChannel|plcAddress|plcTag|modbusAddress|modbusUnitId|modbusRegister|valveAddress|valveChannel|ioAddress|relayChannel|outputAddress)$/;

export function isAddressKey(key) {
  return ADDRESS_KEY.test(String(key));
}

function pickAddresses(engineering = {}) {
  const out = {};
  for (const [k, v] of Object.entries(engineering || {})) {
    if (isAddressKey(k) && v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

function stripAddresses(engineering = {}) {
  const out = {};
  for (const [k, v] of Object.entries(engineering || {})) if (!isAddressKey(k)) out[k] = v;
  return out;
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Control footprint of a placed fixture (or a bare type key): what the control
 * system has to provide for it.
 */
export function controlFootprint(fixtureOrType) {
  const fixture = typeof fixtureOrType === "string"
    ? { type: fixtureOrType, engineering: getDefaultEngineering(fixtureOrType) }
    : (fixtureOrType || {});
  const entry = getFixtureLibraryEntry(fixture.type);
  const eng = fixture.engineering || {};
  const elec = fixture.electrical || entry?.electrical || {};
  const protocol = String(eng.controlProtocol || elec.controlProtocol || "");
  const dmxChannels = getFixtureRatings(fixture).dmxChannels || 0;
  const io = {
    digitalOutputs: n(eng.digitalOutputs), digitalInputs: n(eng.digitalInputs),
    analogOutputs: n(eng.analogOutputs), analogInputs: n(eng.analogInputs),
  };
  const category = entry?.category || "";
  const needsValve = /solenoid|valve/i.test(protocol) || category === "Valves"
    || (category === "Nozzles" && !/dmx/i.test(protocol));
  const needsDmx = dmxChannels > 0 || /dmx|art-?net|sacn/i.test(protocol);
  const needsPlc = needsValve || /modbus|plc|relay|profinet/i.test(protocol)
    || io.digitalOutputs + io.digitalInputs + io.analogOutputs + io.analogInputs > 0;
  return { protocol, dmxChannels, ...io, needsDmx, needsValve, needsPlc };
}

const FOOTPRINT_FIELDS = [
  ["protocol", "Control protocol"],
  ["dmxChannels", "DMX channel count"],
  ["needsDmx", "Needs DMX address"],
  ["needsValve", "Needs valve output"],
  ["needsPlc", "Needs PLC I/O"],
  ["digitalOutputs", "Digital outputs"],
  ["digitalInputs", "Digital inputs"],
  ["analogOutputs", "Analog outputs"],
  ["analogInputs", "Analog inputs"],
];

export function diffControlFootprint(before, after) {
  return FOOTPRINT_FIELDS
    .filter(([k]) => before[k] !== after[k])
    .map(([k, label]) => ({ field: k, label, from: before[k], to: after[k] }));
}

/** readPatch + the designer's `engineering.dmxAddress` start channel. */
function patchOf(fixture) {
  const p = readPatch(fixture);
  if (p.startChannel !== null) return p;
  const start = Number(fixture?.engineering?.dmxAddress);
  if (!Number.isFinite(start) || start <= 0) return p;
  const count = p.channelCount && p.channelCount > 0 ? p.channelCount : 1;
  return { ...p, startChannel: start, endChannel: start + count - 1 };
}

function dmxOverlaps(fixture, others) {
  const p = patchOf(fixture);
  if (p.startChannel === null) return [];
  const uni = p.universe ?? 1;
  const end = p.endChannel ?? p.startChannel;
  return others.filter((o) => {
    const q = patchOf(o);
    if (q.startChannel === null || (q.universe ?? 1) !== uni) return false;
    const qEnd = q.endChannel ?? q.startChannel;
    return q.startChannel <= end && qEnd >= p.startChannel;
  }).map((o) => o.id);
}

const NUMERIC_COMPARE = ["flowLpm", "flowM3Hr", "pressureBar", "jetHeightM", "kFactor", "connectionSize", "wattage", "powerKw"];

/**
 * Replace the type of fixture `fixtureId`.
 * @param {object[]} fixtures       all placed fixtures
 * @param {string|number} fixtureId
 * @param {string} newType          library key
 * @param {{ ioPoints?: object[], now?: string }} options  ioPoints: Siemens I/O map rows
 * @returns {{ fixtures: object[], report: object }}
 */
export function replaceFixtureType(fixtures = [], fixtureId, newType, { ioPoints = [], now } = {}) {
  const index = fixtures.findIndex((f) => String(f.id) === String(fixtureId));
  if (index < 0) throw new Error(`Fixture ${fixtureId} not found`);
  const entry = getFixtureLibraryEntry(newType);
  if (!entry) throw new Error(`Unknown fixture type '${newType}' — pick a library type`);
  const old = fixtures[index];
  if (old.type === newType) {
    return { fixtures, report: { changed: false, fixtureId: old.id, fromType: old.type, toType: newType, footprintChanged: false, changes: [], affectedItems: [], recompute: [], warnings: [] } };
  }

  const oldEng = old.engineering || getDefaultEngineering(old.type);
  const preserved = pickAddresses(oldEng);
  const newDefaults = getDefaultEngineering(newType);
  const droppedDefaultAddresses = Object.keys(pickAddresses(newDefaults));
  const engineering = { ...stripAddresses(newDefaults), ...preserved };
  if (oldEng.group && !engineering.group) engineering.group = oldEng.group;

  const { electrical: _oldElectrical, provenance: oldInstanceProvenance, equipmentModelId: _oldModel, controlReview: _oldReview, ...rest } = old;
  const replaced = { ...rest, type: newType, engineering };

  const before = controlFootprint(old);
  const after = controlFootprint(replaced);
  const changes = diffControlFootprint(before, after);
  const footprintChanged = changes.length > 0;

  const valueChanges = NUMERIC_COMPARE
    .filter((k) => (oldEng[k] ?? null) !== (engineering[k] ?? null) && (oldEng[k] !== undefined || engineering[k] !== undefined))
    .map((k) => ({ field: k, from: oldEng[k] ?? null, to: engineering[k] ?? null }));

  const affectedItems = [];
  const warnings = [];
  const patch = patchOf(replaced);
  const others = fixtures.filter((_, i) => i !== index);
  if (after.needsDmx || before.needsDmx) {
    if (patch.startChannel === null && after.needsDmx) {
      affectedItems.push({ kind: "dmx", status: "unassigned", message: `New type needs ${after.dmxChannels} DMX channel(s) but this fixture has no DMX address — assign one in the DMX patch (not auto-assigned).` });
    } else if (patch.startChannel !== null) {
      const overlaps = dmxOverlaps(replaced, others);
      affectedItems.push({
        kind: "dmx", status: overlaps.length ? "conflict" : (before.dmxChannels !== after.dmxChannels ? "review" : "kept"),
        message: `DMX U${patch.universe ?? 1}/${patch.startChannel} kept; footprint ${before.dmxChannels} → ${after.dmxChannels} ch (ends ${patch.endChannel})`
          + (overlaps.length ? ` — overlaps fixture(s) ${overlaps.join(", ")}` : "")
          + (!after.needsDmx ? " — new type has no DMX control; remove the patch if unused" : ""),
        overlaps,
      });
    }
  }
  for (const [k, v] of Object.entries(preserved)) {
    if (/^(dmx|universe|channel|startChannel|artnet|sacn)/i.test(k)) continue;
    affectedItems.push({ kind: "plc", status: footprintChanged ? "review" : "kept", message: `${k} = ${v} kept unchanged${footprintChanged ? " — verify it still matches the new control footprint" : ""}` });
  }
  if ((after.needsValve || after.needsPlc) && !Object.keys(preserved).some((k) => !/^(dmx|universe|channel|startChannel|artnet|sacn)/i.test(k)) && !(before.needsValve || before.needsPlc)) {
    affectedItems.push({ kind: "plc", status: "unassigned", message: "New type needs a valve/PLC output that this fixture does not have — wire it in Devices → PLC (not auto-assigned)." });
  }
  const io = (ioPoints || []).filter((p) => String(p.device_id) === String(old.id) || String(p.fixture_id) === String(old.id) || (p.nozzle_ids || []).map(String).includes(String(old.id)));
  for (const p of io) {
    affectedItems.push({ kind: "siemens_io", status: footprintChanged ? "review" : "kept", message: `Siemens ${p.plc_tag || p.role || "point"} · ${p.address || "not wired"} kept${footprintChanged ? " — re-check against the new control footprint" : ""}` });
  }
  if (old.groupId) affectedItems.push({ kind: "group", status: "kept", message: `Group ${old.groupId} membership kept` });
  if (oldInstanceProvenance) {
    warnings.push("The fixture's linked equipment data described the old type and was removed; it now uses the new type's library data.");
  }
  if (droppedDefaultAddresses.length) {
    warnings.push(`New type's library default address(es) ${droppedDefaultAddresses.join(", ")} were NOT applied — addresses are only ever set explicitly.`);
  }

  const water = isWaterNozzleFixture(old) || isWaterNozzleFixture(replaced);
  const recompute = ["bom", "equipmentTotals", "electricalLoad"];
  if (water) recompute.push("hydraulicSummary", "pipework", "solvedHydraulics");
  if (water) affectedItems.push({ kind: "hydraulics", status: "recompute", message: "Hydraulic results depend on this nozzle — solver re-run required." });

  const report = {
    changed: true,
    fixtureId: old.id,
    fixtureLabel: old.label || String(old.id),
    fromType: old.type,
    toType: newType,
    footprintBefore: before,
    footprintAfter: after,
    footprintChanged,
    changes,
    valueChanges,
    preservedAddresses: preserved,
    affectedItems,
    recompute,
    warnings,
    provenance: getFixtureProvenance(replaced),
    at: now || new Date().toISOString(),
  };
  if (footprintChanged || affectedItems.some((a) => a.status === "conflict" || a.status === "unassigned")) {
    replaced.controlReview = {
      required: true, fromType: old.type, toType: newType, at: report.at,
      changes, affectedItems: affectedItems.filter((a) => a.kind !== "hydraulics" && a.kind !== "group"),
    };
  }
  const next = fixtures.slice();
  next[index] = replaced;
  return { fixtures: next, report };
}

/** User confirms the control footprint review; the record is kept for traceability. */
export function acknowledgeControlReview(fixture, { now } = {}) {
  if (!fixture?.controlReview) return fixture;
  return { ...fixture, controlReview: { ...fixture.controlReview, required: false, reviewedAt: now || new Date().toISOString() } };
}
