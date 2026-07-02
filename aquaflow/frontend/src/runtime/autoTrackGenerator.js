/**
 * autoTrackGenerator.js — AquaFlow Team D
 * Engineering fixtures → Show Programmer track folders.
 *
 * INPUT:  fixtures from engineeringStore (each has id, type, label, groupId)
 * OUTPUT: a folder tree grouping fixtures by groupId, plus a flat track
 *         list that is structurally compatible with the existing
 *         `programmableTracks` array in ShowProgrammerPanel.jsx
 *         (same { id, fixtureId, label, type } shape, with extra fields
 *         added — nothing existing is removed).
 *
 * Example output shape:
 *   {
 *     folders: [
 *       {
 *         groupId: "center_jets",
 *         label: "CENTER JETS",
 *         color: "#00d4ff",
 *         fixtureCount: 3,
 *         trackCount: 6,
 *         fixtures: [
 *           { fixtureId, fixtureLabel: "Geyser 01", fixtureType, category,
 *             tracks: [ {id, fixtureId, label, type, color}, ... ] },
 *           ...
 *         ],
 *       },
 *       ...
 *     ],
 *     tracks: [ ...flat list of every track across every folder... ],
 *   }
 *
 * This file is STANDALONE:
 *   - No React imports
 *   - No store imports (useEngineeringStore / useShowStore)
 *   - No side effects, no mutation of inputs
 *
 * It is NOT imported anywhere yet. Wiring it into ShowProgrammerPanel.jsx
 * is a separate, future step.
 */

// ─── Track Type Colors ────────────────────────────────────────────────────────
// Duplicated from ShowProgrammerPanel.jsx TRACK_TYPE_COLORS (local const there,
// not exported). Keeping this list identical keeps track dot colors consistent
// if this generator is later used to feed the timeline.

export const TRACK_TYPE_COLORS = Object.freeze({
  lighting_master:   "#f59e0b",
  lighting_red:      "#ef4444",
  lighting_green:    "#22c55e",
  lighting_blue:     "#3b82f6",
  pump_speed:        "#00d4ff",
  pump_pressure:     "#06b6d4",
  solenoid_open:     "#8b5cf6",
  solenoid_duration: "#a78bfa",
  fire_trigger:      "#f97316",
  fire_intensity:    "#fb923c",
  fog_density:       "#6b7280",
  laser_intensity:   "#ec4899",
  laser_pattern:     "#db2777",
  device_enable:     "#94a3b8",
  device_intensity:  "#64748b",
  motion_intensity:  "#38bdf8",
  motion_angle:      "#0ea5e9",
  motion_pan:        "#2563eb",
  motion_tilt:       "#1d4ed8",
});

// ─── Folder (Group) Labels ────────────────────────────────────────────────────
// Maps groupId → display label and folder color.
// groupId values come from getDefaultGroupId() in PoolGeometryDesigner.jsx,
// which writes one of these 8 values onto every fixture at creation time.
// Any groupId NOT in this table (e.g. a custom or future value) still works —
// see FALLBACK_PALETTE and titleCase() below.

export const GROUP_LABELS = Object.freeze({
  center_jets:          "CENTER JETS",
  arch_jets:            "ARCH JETS",
  outer_ring_jets:      "OUTER RING JETS",
  rgb_lights:           "RGB LIGHTS",
  flame_units:          "FLAME UNITS",
  fog_machines:         "FOG MACHINES",
  laser_units:          "LASER UNITS",
  engineering_equipment:"EQUIPMENT",
});

export const GROUP_COLORS = Object.freeze({
  center_jets:          "#00d4ff",
  arch_jets:            "#06b6d4",
  outer_ring_jets:      "#22c55e",
  rgb_lights:           "#f59e0b",
  flame_units:          "#f97316",
  fog_machines:         "#6b7280",
  laser_units:          "#ec4899",
  engineering_equipment:"#94a3b8",
});

// Palette used for any groupId not found in GROUP_COLORS above.
// Picked deterministically by hashing the groupId string, so the same
// custom groupId always gets the same color across reloads.
const FALLBACK_PALETTE = [
  "#8b5cf6", "#14b8a6", "#eab308", "#f43f5e",
  "#3b82f6", "#84cc16", "#a78bfa", "#fb7185",
];

// ─── Equipment Category Detection ─────────────────────────────────────────────
// Mirrors getEquipmentCategory() inside ShowProgrammerPanel.jsx (a local,
// non-exported function there). Duplicated here so this file has no
// dependency on that component. Uses .includes() so it correctly handles
// both short names ("geyser") and Pool Designer prefixed names
// ("nozzle_geyser").

import { getFixtureCategory } from "../utils/fixtureTypeResolver.js";

export function getEquipmentCategory(type = "") {
  const category = getFixtureCategory(type);

  const categoryMap = {
    pump: "pump",
    lighting: "lighting",
    laser: "laser",
    fire: "fire",
    fog: "fog",
    motion_1d: "motion_1d",
    motion_2d: "motion_2d",
    motion_3d: "motion_3d",
    sensor: "generic",
    generic: "generic",
    solenoid: "solenoid",
  };

  return categoryMap[category] || "generic";
}

// ─── Group ID Detection (fallback only) ───────────────────────────────────────
// Mirrors getDefaultGroupId() in PoolGeometryDesigner.jsx. Used ONLY when a
// fixture has no groupId field (e.g. fixtures created before the groupId
// patch, or imported from an older project file).

import { getDefaultGroupId as getResolverGroupId } from "../utils/fixtureTypeResolver.js";

export function getDefaultGroupId(type) {
  return getResolverGroupId(type);
}

// ─── Per-Category Channel Track Definitions ───────────────────────────────────
// Mirrors the track-generation switch inside programmableTracks (lines
// 178-300 of ShowProgrammerPanel.jsx). Each entry is a list of
// { suffix, type } pairs. suffix is appended to the fixture id to build a
// unique track id; type is one of the TRACK_TYPE_COLORS keys.

const CATEGORY_CHANNELS = Object.freeze({
  lighting: [
    { suffix: "master", type: "lighting_master", label: "Intensity" },
    { suffix: "red",    type: "lighting_red",    label: "Red" },
    { suffix: "green",  type: "lighting_green",  label: "Green" },
    { suffix: "blue",   type: "lighting_blue",   label: "Blue" },
  ],
  pump: [
    { suffix: "speed",    type: "pump_speed",    label: "Speed" },
    { suffix: "pressure", type: "pump_pressure", label: "Pressure" },
  ],
  motion_1d: [
    { suffix: "intensity", type: "motion_intensity", label: "Intensity" },
    { suffix: "angle",     type: "motion_angle",     label: "Angle" },
  ],
  motion_2d: [
    { suffix: "intensity", type: "motion_intensity", label: "Intensity" },
    { suffix: "pan",       type: "motion_pan",       label: "Pan" },
    { suffix: "tilt",      type: "motion_tilt",      label: "Tilt" },
  ],
  motion_3d: [
    { suffix: "intensity", type: "motion_intensity", label: "Intensity" },
    { suffix: "pan",       type: "motion_pan",       label: "Pan" },
    { suffix: "tilt",      type: "motion_tilt",      label: "Tilt" },
    { suffix: "angle",     type: "motion_angle",     label: "Angle" },
  ],
  solenoid: [
    { suffix: "open",     type: "solenoid_open",     label: "Open" },
    { suffix: "duration", type: "solenoid_duration", label: "Duration" },
  ],
  fire: [
    { suffix: "trigger",   type: "fire_trigger",   label: "Trigger" },
    { suffix: "intensity", type: "fire_intensity", label: "Intensity" },
  ],
  fog: [
    { suffix: "density", type: "fog_density", label: "Density" },
  ],
  laser: [
    { suffix: "intensity", type: "laser_intensity", label: "Intensity" },
    { suffix: "pattern",   type: "laser_pattern",   label: "Pattern" },
  ],
  generic: [
    { suffix: "enable",    type: "device_enable",    label: "Enable" },
    { suffix: "intensity", type: "device_intensity", label: "Intensity" },
  ],
});

// ─── Type Display Names ────────────────────────────────────────────────────────
// Converts a raw fixture.type string into a human-friendly base name used
// for auto-numbering ("Geyser 01", "Geyser 02", ...). Strips common Pool
// Designer prefixes ("nozzle_", "light_") and underscores, then title-cases.
// Falls back to titleCase(type) for anything not in this table.

const TYPE_DISPLAY_NAMES = Object.freeze({
  nozzle_geyser:   "Geyser",
  nozzle_arch:     "Arch Jet",
  nozzle_fan:      "Fan Jet",
  nozzle_ring:     "Ring Jet",
  nozzle_cascade:  "Cascade",
  nozzle_laminar:  "Laminar Jet",
  nozzle_mist:     "Mist Nozzle",
  nozzle_jet:      "Jet",
  nozzle_jet_1d:   "Jet 1D",
  nozzle_jet_2d:   "Jet 2D",
  nozzle_jet_3d:   "Jet 3D",
  geyser:          "Geyser",
  arch:            "Arch Jet",
  fan_jet:         "Fan Jet",
  ring:            "Ring Jet",
  cascade:         "Cascade",
  laminar:         "Laminar Jet",
  mist:            "Mist Nozzle",
  jet_1d:          "Jet 1D",
  jet_2d:          "Jet 2D",
  jet_3d:          "Jet 3D",
  motion_1d:       "Motion Nozzle 1D",
  motion_2d:       "Motion Nozzle 2D",
  motion_3d:       "Motion Nozzle 3D",
  flame:           "Flame Unit",
  fog_machine:     "Fog Machine",
  laser:           "Laser Unit",
});

function titleCase(str) {
  return String(str || "")
    .replace(/^nozzle_|^light_/, "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || "Fixture";
}

function getTypeDisplayName(type) {
  const key = String(type || "").toLowerCase();
  return TYPE_DISPLAY_NAMES[key] || titleCase(key);
}

// ─── Deterministic Fallback Color ──────────────────────────────────────────────
// Hashes a groupId string to a stable index into FALLBACK_PALETTE, so any
// custom groupId not in GROUP_COLORS always gets the same color.

function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[index];
}

function getFolderLabel(groupId) {
  return GROUP_LABELS[groupId] || titleCase(groupId).toUpperCase();
}

function getFolderColor(groupId) {
  return GROUP_COLORS[groupId] || hashColor(String(groupId || "unknown"));
}

// ─── Per-Fixture Track Generation ──────────────────────────────────────────────
// Builds the channel track list for one fixture, matching the shape and
// type strings used by programmableTracks in ShowProgrammerPanel.jsx.

function buildFixtureTracks(fixtureId, fixtureLabel, category) {
  const channels = CATEGORY_CHANNELS[category] || CATEGORY_CHANNELS.generic;

  return channels.map(({ suffix, type, label }) => ({
    id:        `${fixtureId}-${suffix}`,
    fixtureId: fixtureId,
    label:     `${fixtureLabel} / ${label}`,
    type:      type,
    color:     TRACK_TYPE_COLORS[type] || "#94a3b8",
  }));
}

// ─── Main Entry Point ───────────────────────────────────────────────────────────

/**
 * Generate folder-grouped Show Programmer tracks from engineering fixtures.
 *
 * @param {Object} params
 * @param {Array}  params.fixtures - fixtures from useEngineeringStore(s => s.fixtures)
 * @param {Array}  [params.devices] - fallback devices from useShowStore(s => s.devices),
 *                                    used only if fixtures is empty (matches
 *                                    programmableTracks fallback behavior)
 *
 * @returns {{ folders: Array, tracks: Array }}
 */
export function generateAutoTracks({ fixtures = [], devices = [] } = {}) {
  const sourceItems = (fixtures && fixtures.length > 0) ? fixtures : devices;

  // groupId -> { groupId, label, color, fixtures: [], trackCount }
  const foldersById = new Map();

  // Track how many fixtures of each (groupId + display-name) combo we've
  // seen, so duplicates get numbered: "Geyser 01", "Geyser 02", ...
  const nameCounters = new Map();

  sourceItems.forEach((fx, index) => {
    const fixtureId   = fx.id ?? fx.deviceId ?? `item-${index}`;
    const fixtureType = String(fx.type || fx.kind || "").toLowerCase();
    const category    = getEquipmentCategory(fixtureType);

    // Resolve groupId: prefer fixture.groupId (written at creation time by
    // the groupId patch). Fall back to deriving one if missing (older
    // fixtures / imported projects).
    const groupId = fx.groupId || getDefaultGroupId(fixtureType);

    // Auto-numbered display label: "Geyser 01", "Geyser 02", ...
    // Counter key includes groupId so the same fixture type in two
    // different folders numbers independently.
    const baseName  = getTypeDisplayName(fixtureType);
    const counterKey = `${groupId}::${baseName}`;
    const nextIndex  = (nameCounters.get(counterKey) || 0) + 1;
    nameCounters.set(counterKey, nextIndex);

    // If the fixture already has a custom label that ISN'T just the raw
    // type name, prefer it. Otherwise auto-generate "BaseName NN".
    const hasCustomLabel = fx.label
      && fx.label.toLowerCase() !== fixtureType
      && fx.label.toLowerCase() !== baseName.toLowerCase();
    const fixtureLabel = hasCustomLabel
      ? fx.label
      : `${baseName} ${String(nextIndex).padStart(2, "0")}`;

    const tracks = buildFixtureTracks(fixtureId, fixtureLabel, category);

    if (!foldersById.has(groupId)) {
      foldersById.set(groupId, {
        groupId,
        label: getFolderLabel(groupId),
        color: getFolderColor(groupId),
        fixtureCount: 0,
        trackCount: 0,
        fixtures: [],
      });
    }

    const folder = foldersById.get(groupId);
    folder.fixtures.push({
      fixtureId,
      fixtureLabel,
      fixtureType,
      category,
      tracks,
    });
    folder.fixtureCount += 1;
    folder.trackCount += tracks.length;
  });

  const folders = Array.from(foldersById.values());

  // Flat list of every track across every folder — same shape as
  // programmableTracks ({id, fixtureId, label, type}) plus extra fields
  // (color, groupId, folderLabel, folderColor).
  const tracks = [];
  for (const folder of folders) {
    for (const fixture of folder.fixtures) {
      for (const track of fixture.tracks) {
        tracks.push({
          ...track,
          groupId:    folder.groupId,
          folderLabel: folder.label,
          folderColor: folder.color,
        });
      }
    }
  }

  return { folders, tracks };
}

export default { generateAutoTracks, getEquipmentCategory, getDefaultGroupId, TRACK_TYPE_COLORS, GROUP_LABELS, GROUP_COLORS };
