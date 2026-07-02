/**
 * fixtureRuntimeMapper.js — AquaFlow Runtime Mapping Layer
 * 
 * Translates engineering fixtures to runtime channels for:
 * - Timeline tracks
 * - Preview channels  
 * - Hardware control layers
 * 
 * ARCHITECTURE:
 * Engineering Store → Runtime Mapper → Show Store Tracks → Hardware
 * 
 * TEAM B — Runtime Mapping Layer
 */

import { getRuntimeType, FIXTURE_TYPE_MAP } from "../utils/fixtureTypeResolver.js";

// ============================================================
// FIXTURE TYPE MAPPING TABLES
// ============================================================

/**
 * Maps engineering fixture types to runtime types
 * Used to determine which track type a fixture belongs to
 */
const FIXTURE_TO_RUNTIME_TYPE = {};
for (const [key, info] of Object.entries(FIXTURE_TYPE_MAP)) {
  FIXTURE_TO_RUNTIME_TYPE[key] = info.runtimeType;
}

/**
 * Fallback mapping for partial matches
 */
const FIXTURE_PARTIAL_MATCHES = [
  { pattern: "geyser",   runtime: "pump" },
  { pattern: "foam",     runtime: "pump" },
  { pattern: "laminar",  runtime: "pump" },
  { pattern: "running",  runtime: "pump" },
  { pattern: "fan",      runtime: "pump" },
  { pattern: "arch",     runtime: "pump" },
  { pattern: "mist",     runtime: "fog" },
  { pattern: "flame",    runtime: "flame" },
  { pattern: "fire",     runtime: "flame" },
  { pattern: "rgb",      runtime: "lighting" },
  { pattern: "underwater", runtime: "lighting" },
  { pattern: "laser",    runtime: "laser" },
  { pattern: "pump",     runtime: "pump" },
  { pattern: "vfd",      runtime: "pump" },
  { pattern: "valve",    runtime: "equipment" },
  { pattern: "solenoid", runtime: "equipment" },
  { pattern: "sensor",   runtime: "sensor" },
  { pattern: "1d",       runtime: "motion_1d" },
  { pattern: "2d",       runtime: "motion_2d" },
  { pattern: "3d",       runtime: "motion_3d" },
];

// ============================================================
// CHANNEL DEFINITIONS BY RUNTIME TYPE
// ============================================================

/**
 * Channel definitions for each runtime type
 * Each channel has: key, type, range, default value
 */
export const RUNTIME_CHANNELS = {
  // Nozzle / Water effect channels
  pump: {
    type: "pump",
    channels: [
      { key: "intensity",       type: "analog",   range: [0, 255],   default: 0,   unit: "%" },
      { key: "flow_rate",       type: "analog",   range: [0, 5000],  default: 0,   unit: "L/min" },
      { key: "pressure",        type: "analog",   range: [0, 30],    default: 0,   unit: "bar" },
      { key: "height",          type: "analog",   range: [0, 100],   default: 0,   unit: "m" },
      { key: "pwm",             type: "pwm",      range: [0, 100],   default: 0,   unit: "%" },
      { key: "enable",          type: "digital",  range: [0, 1],     default: 0,   unit: "on/off" },
    ]
  },
  
  // RGB Lighting channels
  lighting: {
    type: "lighting",
    channels: [
      { key: "intensity",       type: "analog",   range: [0, 255],   default: 0,   unit: "%" },
      { key: "red",             type: "analog",   range: [0, 255],   default: 0,   unit: "0-255" },
      { key: "green",           type: "analog",   range: [0, 255],   default: 0,   unit: "0-255" },
      { key: "blue",            type: "analog",   range: [0, 255],   default: 0,   unit: "0-255" },
      { key: "white",           type: "analog",   range: [0, 255],   default: 0,   unit: "0-255" },
      { key: "amber",           type: "analog",   range: [0, 255],   default: 0,   unit: "0-255" },
      { key: "strobe",          type: "analog",   range: [0, 255],   default: 0,   unit: "Hz" },
      { key: "dimmer",          type: "analog",   range: [0, 255],   default: 0,   unit: "%" },
      { key: "color_temp",      type: "analog",   range: [2000, 10000], default: 5600, unit: "K" },
    ]
  },
  
  // Laser effects
  laser: {
    type: "laser",
    channels: [
      { key: "intensity",       type: "analog",   range: [0, 255],   default: 0,   unit: "%" },
      { key: "red",             type: "analog",   range: [0, 255],   default: 0,   unit: "0-255" },
      { key: "green",           type: "analog",   range: [0, 255],   default: 0,   unit: "0-255" },
      { key: "blue",            type: "analog",   range: [0, 255],   default: 0,   unit: "0-255" },
      { key: "pattern",         type: "analog",   range: [0, 255],   default: 0,   unit: "index" },
      { key: "rotation",        type: "analog",   range: [0, 360],   default: 0,   unit: "deg" },
      { key: "speed",           type: "analog",   range: [0, 255],   default: 0,   unit: "%" },
    ]
  },
  
  // Flame / Fire effects
  flame: {
    type: "flame",
    channels: [
      { key: "intensity",       type: "analog",   range: [0, 255],   default: 0,   unit: "%" },
      { key: "height",          type: "analog",   range: [0, 100],   default: 0,   unit: "cm" },
      { key: "pulse",           type: "analog",   range: [0, 255],   default: 0,   unit: "%" },
      { key: "color_temp",      type: "analog",   range: [1000, 3000], default: 1800, unit: "K" },
      { key: "gas_flow",        type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "ignition",        type: "digital",  range: [0, 1],     default: 0,   unit: "on/off" },
    ]
  },
  
  // Fog / Haze effects
  fog: {
    type: "fog",
    channels: [
      { key: "density",         type: "analog",   range: [0, 255],   default: 0,   unit: "%" },
      { key: "volume",          type: "analog",   range: [0, 100],   default: 0,   unit: "m³/min" },
      { key: "fan_speed",       type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "heater",          type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "enable",          type: "digital",  range: [0, 1],     default: 0,   unit: "on/off" },
    ]
  },
  
  // Sensors
  sensor: {
    type: "sensor",
    channels: [
      { key: "temperature",     type: "analog",   range: [-40, 150], default: 0,   unit: "°C" },
      { key: "pressure",        type: "analog",   range: [0, 30],    default: 0,   unit: "bar" },
      { key: "flow",            type: "analog",   range: [0, 5000],  default: 0,   unit: "L/min" },
      { key: "ph",              type: "analog",   range: [0, 14],    default: 7,   unit: "pH" },
      { key: "chlorine",        type: "analog",   range: [0, 10],    default: 0,   unit: "ppm" },
      { key: "status",          type: "digital",  range: [0, 1],     default: 0,   unit: "ok/fault" },
    ]
  },
  
  // General Equipment
  equipment: {
    type: "equipment",
    channels: [
      { key: "enable",          type: "digital",  range: [0, 1],     default: 0,   unit: "on/off" },
      { key: "power",           type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "status",          type: "digital",  range: [0, 1],     default: 0,   unit: "ok/fault" },
    ]
  },
  
  // 1D Motion (single axis)
  motion_1d: {
    type: "motion_1d",
    channels: [
      { key: "position",        type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "speed",           type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "acceleration",    type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "enable",          type: "digital",  range: [0, 1],     default: 0,   unit: "on/off" },
      { key: "home",            type: "digital",  range: [0, 1],     default: 0,   unit: "trigger" },
    ]
  },
  
  // 2D Motion (X/Y axes)
  motion_2d: {
    type: "motion_2d",
    channels: [
      { key: "position_x",      type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "position_y",      type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "speed_x",         type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "speed_y",         type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "acceleration",    type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "enable",          type: "digital",  range: [0, 1],     default: 0,   unit: "on/off" },
      { key: "home",            type: "digital",  range: [0, 1],     default: 0,   unit: "trigger" },
      { key: "path_index",      type: "analog",   range: [0, 255],   default: 0,   unit: "index" },
    ]
  },
  
  // 3D Motion (X/Y/Z axes or pan/tilt/roll)
  motion_3d: {
    type: "motion_3d",
    channels: [
      { key: "position_x",      type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "position_y",      type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "position_z",      type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "rotation_pan",    type: "analog",   range: [0, 360],   default: 0,   unit: "deg" },
      { key: "rotation_tilt",   type: "analog",   range: [0, 180],   default: 0,   unit: "deg" },
      { key: "rotation_roll",   type: "analog",   range: [0, 360],   default: 0,   unit: "deg" },
      { key: "speed",           type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "acceleration",    type: "analog",   range: [0, 100],   default: 0,   unit: "%" },
      { key: "enable",          type: "digital",  range: [0, 1],     default: 0,   unit: "on/off" },
      { key: "home",            type: "digital",  range: [0, 1],     default: 0,   unit: "trigger" },
      { key: "path_index",      type: "analog",   range: [0, 255],   default: 0,   unit: "index" },
    ]
  },
};

// ============================================================
// MAIN EXPORTED FUNCTIONS
// ============================================================

/**
 * Gets the runtime type for a fixture based on its type string
 * 
 * @param {string} fixtureType - The fixture.type value (e.g., "nozzle_geyser")
 * @returns {string} Runtime type (e.g., "pump", "lighting", "motion_2d")
 */
export function getRuntimeTypeFromFixture(fixtureType) {
  // Use fixtureTypeResolver as single source of truth
  const resolved = getRuntimeType(fixtureType);
  if (resolved && resolved !== "equipment") {
    return resolved;
  }
  
  // Fallback to partial matches for unknown types
  if (!fixtureType) return "equipment";
  for (const match of FIXTURE_PARTIAL_MATCHES) {
    if (fixtureType.toLowerCase().includes(match.pattern)) {
      return match.runtime;
    }
  }
  
  return "equipment";
}

/**
 * Maps a single fixture to its complete runtime channel definition
 * 
 * @param {object} fixture - The fixture object from engineering store
 * @param {string} fixture.id - Unique fixture ID
 * @param {string} fixture.type - Fixture type (e.g., "nozzle_geyser")
 * @param {string} fixture.label - Display label
 * @param {object} fixture.engineering - Engineering parameters
 * @returns {object} Runtime mapping with channels
 */
export function mapFixtureToRuntimeChannels(fixture) {
  if (!fixture || !fixture.type) {
    return {
      fixtureId: fixture?.id || "unknown",
      runtimeType: "equipment",
      channels: [],
      error: "Missing fixture type"
    };
  }
  
  const runtimeType = getRuntimeTypeFromFixture(fixture.type);
  const channelDefs = RUNTIME_CHANNELS[runtimeType] || RUNTIME_CHANNELS.equipment;
  const engineering = fixture.engineering || {};
  
  // Build channels with current values from engineering
  const channels = channelDefs.channels.map(channelDef => {
    let currentValue = channelDef.default;
    
    // Map engineering values to channels
    switch (channelDef.key) {
      case "intensity":
        currentValue = engineering.intensity ?? engineering.flowLpm ?? channelDef.default;
        break;
      case "flow_rate":
      case "flow":
        currentValue = engineering.flowLpm ?? engineering.flowM3Hr ?? channelDef.default;
        break;
      case "pressure":
        currentValue = engineering.pressureBar ?? channelDef.default;
        break;
      case "height":
        currentValue = engineering.jetHeightM ?? channelDef.default;
        break;
      case "enable":
        currentValue = engineering.enabled ? 1 : 0;
        break;
      case "red":
        currentValue = engineering.red ?? channelDef.default;
        break;
      case "green":
        currentValue = engineering.green ?? channelDef.default;
        break;
      case "blue":
        currentValue = engineering.blue ?? channelDef.default;
        break;
      case "white":
        currentValue = engineering.white ?? channelDef.default;
        break;
      case "strobe":
        currentValue = engineering.strobeRate ?? channelDef.default;
        break;
      case "dimmer":
        currentValue = engineering.dimmer ?? channelDef.default;
        break;
      case "pattern":
        currentValue = engineering.patternIndex ?? channelDef.default;
        break;
      case "speed":
        currentValue = engineering.speedDegPerSec ?? channelDef.default;
        break;
      case "position":
      case "position_x":
        currentValue = engineering.positionX ?? channelDef.default;
        break;
      case "position_y":
        currentValue = engineering.positionY ?? channelDef.default;
        break;
      case "position_z":
        currentValue = engineering.positionZ ?? channelDef.default;
        break;
      case "rotation":
        currentValue = engineering.rotation ?? channelDef.default;
        break;
      case "rotation_pan":
        currentValue = engineering.panAngle ?? channelDef.default;
        break;
      case "rotation_tilt":
        currentValue = engineering.tiltAngle ?? channelDef.default;
        break;
      case "home":
        currentValue = engineering.homeTrigger ? 1 : 0;
        break;
      case "power":
        currentValue = engineering.powerKw ?? engineering.wattage ?? channelDef.default;
        break;
      default:
        if (engineering[channelDef.key] !== undefined) {
          currentValue = engineering[channelDef.key];
        }
    }
    
    // Clamp to range
    const clamped = Math.max(channelDef.range[0], Math.min(channelDef.range[1], currentValue));
    
    return {
      key: channelDef.key,
      type: channelDef.type,
      range: channelDef.range,
      unit: channelDef.unit,
      value: clamped,
      default: channelDef.default,
    };
  });
  
  return {
    fixtureId: fixture.id,
    fixtureLabel: fixture.label,
    fixtureType: fixture.type,
    runtimeType: runtimeType,
    channels: channels,
    channelCount: channels.length,
  };
}

/**
 * Builds complete track definitions for all fixtures
 * Used to create timeline tracks in Show Store
 * 
 * @param {array} fixtures - Array of fixture objects
 * @returns {array} Track definitions ready for timeline
 */
export function buildFixtureTrackDefinitions(fixtures) {
  if (!fixtures || !fixtures.length) {
    return [];
  }
  
  const trackMap = new Map(); // runtimeType -> track definition
  
  for (const fixture of fixtures) {
    const runtimeType = getRuntimeTypeFromFixture(fixture.type);
    
    if (!trackMap.has(runtimeType)) {
      // Create new track for this runtime type
      trackMap.set(runtimeType, {
        trackId: `track_${runtimeType}`,
        trackType: runtimeType,
        label: getTrackLabel(runtimeType),
        deviceType: runtimeType,
        fixtures: [],
        channels: RUNTIME_CHANNELS[runtimeType]?.channels || RUNTIME_CHANNELS.equipment.channels,
        totalChannels: RUNTIME_CHANNELS[runtimeType]?.channels?.length || RUNTIME_CHANNELS.equipment.channels.length,
      });
    }
    
    // Add fixture to its track
    const track = trackMap.get(runtimeType);
    track.fixtures.push({
      id: fixture.id,
      label: fixture.label,
      type: fixture.type,
      engineering: fixture.engineering,
      runtimeMapping: mapFixtureToRuntimeChannels(fixture),
    });
  }
  
  return Array.from(trackMap.values());
}

/**
 * Helper: Get human-readable label for a runtime type
 */
function getTrackLabel(runtimeType) {
  const labels = {
    pump: "💧 Water Effects",
    lighting: "💡 Lighting",
    laser: "⚡ Lasers",
    flame: "🔥 Fire Effects",
    fog: "🌫️ Fog & Haze",
    sensor: "📊 Sensors",
    equipment: "⚙️ Equipment",
    motion_1d: "↔️ 1D Motion",
    motion_2d: "☖ 2D Motion",
    motion_3d: "⬚ 3D Motion",
  };
  return labels[runtimeType] || runtimeType;
}

/**
 * Gets channel count for a fixture type
 * Used for DMX/universe planning
 * 
 * @param {string} fixtureType - The fixture type
 * @returns {number} Number of channels this fixture consumes
 */
export function getChannelCountForFixture(fixtureType) {
  const runtimeType = getRuntimeTypeFromFixture(fixtureType);
  const channelDefs = RUNTIME_CHANNELS[runtimeType];
  return channelDefs?.channels?.length || RUNTIME_CHANNELS.equipment.channels.length;
}

/**
 * Gets DMX footprint for a fixture
 * 
 * @param {string} fixtureType - The fixture type  
 * @returns {object} DMX footprint information
 */
export function getDMXFootprint(fixtureType) {
  const runtimeType = getRuntimeTypeFromFixture(fixtureType);
  const channelCount = getChannelCountForFixture(fixtureType);
  
  const footprints = {
    pump: { mode: "extended", channels: channelCount, recommendation: "Use Art-Net or sACN for water effects" },
    lighting: { mode: "rgb", channels: channelCount, recommendation: "DMX512 universe 1-4" },
    laser: { mode: "full", channels: channelCount, recommendation: "Use dedicated laser interface" },
    flame: { mode: "safety", channels: channelCount, recommendation: "Requires safety interlock" },
    motion_2d: { mode: "positional", channels: channelCount, recommendation: "Use 16-bit resolution for smooth motion" },
    motion_3d: { mode: "full_3d", channels: channelCount, recommendation: "Use 16-bit for each axis" },
  };
  
  return footprints[runtimeType] || { mode: "basic", channels: channelCount, recommendation: "Standard DMX512" };
}

/**
 * Batch maps multiple fixtures to runtime channels
 * 
 * @param {array} fixtures - Array of fixture objects
 * @returns {array} Array of runtime mappings
 */
export function mapFixturesToRuntimeChannels(fixtures) {
  if (!fixtures || !fixtures.length) {
    return [];
  }
  
  return fixtures.map(fixture => mapFixtureToRuntimeChannels(fixture));
}

// ============================================================
// EXPORTS
// ============================================================

export default {
  getRuntimeTypeFromFixture,
  mapFixtureToRuntimeChannels,
  buildFixtureTrackDefinitions,
  getChannelCountForFixture,
  getDMXFootprint,
  mapFixturesToRuntimeChannels,
  RUNTIME_CHANNELS,
  FIXTURE_TO_RUNTIME_TYPE,
};