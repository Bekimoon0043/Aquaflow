/**
 * runtimeDeviceGraph.js — AquaFlow Team B
 * Runtime Device Graph Abstraction Layer
 * 
 * Pure frontend runtime abstraction — NO protocol logic, NO DMX logic, NO PLC logic.
 * Generates runtime device graph from engineeringStore fixtures.
 * 
 * ARCHITECTURE:
 * Engineering Store Fixtures → Runtime Device Graph → Runtime Mapper → Hardware
 * 
 * This module:
 * - Creates runtime device abstractions from engineering fixtures
 * - Maintains fixture-to-runtime relationships
 * - Provides preview and track capability metadata
 * - No side effects, no store imports, pure functions
 */

import { RUNTIME_CHANNELS } from "./fixtureRuntimeMapper.js";
import { getFixtureInfo, getRuntimeType, getFixtureCategory, getFixtureChannels } from "../utils/fixtureTypeResolver.js";

// ============================================================
// RUNTIME DEVICE GRAPH
// ============================================================

/**
 * Runtime Device Node — represents a single fixture in runtime context
 * 
 * @typedef {Object} RuntimeDeviceNode
 * @property {string} runtimeId - Unique runtime identifier (derived from fixture.id)
 * @property {string} fixtureId - Original fixture ID from engineering store
 * @property {string} fixtureLabel - Human-readable fixture label
 * @property {string} fixtureType - Original fixture type (e.g., "nozzle_geyser")
 * @property {string} runtimeType - Mapped runtime type (e.g., "pump", "lighting")
 * @property {Array} channels - Channel definitions with current values
 * @property {Object} groups - Group memberships (zone, type, custom)
 * @property {Object} previewCapabilities - What this device can do in 3D preview
 * @property {Object} trackCapabilities - What timeline tracks this device supports
 * @property {Object} metadata - Additional fixture metadata
 */

/**
 * Runtime Device Graph — complete runtime abstraction of all fixtures
 * 
 * @typedef {Object} RuntimeDeviceGraph
 * @property {string} version - Graph version
 * @property {string} generatedAt - ISO timestamp
 * @property {number} fixtureCount - Total number of fixtures
 * @property {Object} byRuntimeType - Fixtures grouped by runtime type
 * @property {Object} byGroupId - Fixtures grouped by groupId
 * @property {Map<string, RuntimeDeviceNode>} nodes - All runtime nodes
 * @property {Array<string>} runtimeIds - List of all runtime IDs
 */

// ============================================================
// PREVIEW CAPABILITIES
// ============================================================

/**
 * Preview capabilities by runtime type
 * Defines what visual representation this device has in 3D preview
 */
// Preview capabilities now come from fixtureTypeResolver.js via getFixtureInfo()

// ============================================================
// TRACK CAPABILITIES
// ============================================================

/**
 * Track capabilities by runtime type
 * Defines what timeline track types this device supports
 */
// Track capabilities now come from fixtureTypeResolver.js via getFixtureInfo()

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Generate a stable runtime ID from fixture ID
 * 
 * @param {string} fixtureId
 * @returns {string}
 */
function generateRuntimeId(fixtureId) {
  return `runtime_${fixtureId}`;
}

/**
 * Extract group memberships from fixture
 * 
 * @param {Object} fixture
 * @param {string} runtimeType
 * @returns {Object}
 */
function extractGroups(fixture, runtimeType) {
  const groups = {
    byType: runtimeType,
    byZone: fixture.zone || "unknown",
    byCustom: {},
  };

  // Get group from fixtureTypeResolver via getFixtureInfo
  const fixtureInfo = getFixtureInfo(fixture.type);
  if (fixtureInfo && fixtureInfo.group) {
    groups.byCustom.resolvedGroup = fixtureInfo.group;
  }

  if (fixture.groupId) {
    groups.byCustom.groupId = fixture.groupId;
  }

  if (fixture.engineering?.group) {
    groups.byCustom.engineeringGroup = fixture.engineering.group;
  }

  return groups;
}

/**
 * Build preview capabilities for a fixture
 * 
 * @param {string} runtimeType
 * @param {Object} fixture
 * @returns {Object}
 */
function buildPreviewCapabilities(runtimeType, fixture) {
  // Build preview from fixture info
  const fixtureInfo = getFixtureInfo(fixture.type);
  const category = getFixtureCategory(fixture.type);
  
  // Default preview based on runtime type
  const previewDefaults = {
    pump: { hasWaterEffect: true, icon: "💧", color: "#00d4ff", previewType: "water_jet", animatable: true },
    lighting: { hasWaterEffect: false, icon: "💡", color: "#f59e0b", previewType: "light_emitter", animatable: true },
    laser: { hasWaterEffect: false, icon: "⚡", color: "#ec4899", previewType: "laser_beam", animatable: true },
    flame: { hasWaterEffect: false, icon: "🔥", color: "#f97316", previewType: "fire_effect", animatable: true, safetyCritical: true },
    fog: { hasWaterEffect: false, icon: "🌫️", color: "#6b7280", previewType: "fog_emitter", animatable: true },
    sensor: { hasWaterEffect: false, icon: "📊", color: "#88ff88", previewType: "sensor_point", animatable: false },
    equipment: { hasWaterEffect: false, icon: "⚙️", color: "#94a3b8", previewType: "equipment_box", animatable: false },
    motion_1d: { hasWaterEffect: false, icon: "↔️", color: "#38bdf8", previewType: "motion_1d", animatable: true },
    motion_2d: { hasWaterEffect: false, icon: "☖", color: "#38bdf8", previewType: "motion_2d", animatable: true },
    motion_3d: { hasWaterEffect: false, icon: "⬚", color: "#38bdf8", previewType: "motion_3d", animatable: true },
  };
  
  const base = previewDefaults[runtimeType] || previewDefaults.equipment;
  
  return {
    ...base,
    position: fixture.x !== undefined && fixture.y !== undefined
      ? { x: fixture.x, y: fixture.y, z: fixture.z || 0 }
      : null,
    rotation: fixture.rotation || 0,
    label: fixture.label,
    enabled: fixture.engineering?.enabled !== false,
    channelCount: fixtureInfo?.channels?.length || 1,
    protocol: fixtureInfo?.protocol || "virtual",
    latencyMs: fixtureInfo?.latencyMs || 0,
  };
}

/**
 * Build track capabilities for a fixture
 * 
 * @param {string} runtimeType
 * @param {Object} fixture
 * @returns {Object}
 */
function buildTrackCapabilities(runtimeType, fixture) {
  const engineering = fixture.engineering || {};
  const fixtureInfo = getFixtureInfo(fixture.type);
  const channels = getFixtureChannels(fixture.type);
  
  // Track type mapping based on runtime type
  const trackTypeMap = {
    pump: { primary: "pump_speed", secondary: ["pump_pressure", "device_enable"], hasIntensity: true, suggestedEasing: "ease_both" },
    lighting: { primary: "lighting_master", secondary: ["lighting_red", "lighting_green", "lighting_blue"], hasIntensity: true, hasColor: true, suggestedEasing: "linear" },
    laser: { primary: "laser_intensity", secondary: ["laser_pattern"], hasIntensity: true, suggestedEasing: "step" },
    flame: { primary: "fire_intensity", secondary: ["fire_trigger"], hasIntensity: true, suggestedEasing: "step", safetyFlags: ["safety_critical"] },
    fog: { primary: "fog_density", secondary: [], hasIntensity: true, suggestedEasing: "linear" },
    sensor: { primary: null, secondary: [], hasIntensity: false, isReadOnly: true },
    equipment: { primary: "device_intensity", secondary: ["device_enable"], hasIntensity: true, suggestedEasing: "linear" },
    motion_1d: { primary: "motion_angle", secondary: ["motion_intensity"], hasAngle: true, suggestedEasing: "ease_both" },
    motion_2d: { primary: "motion_pan", secondary: ["motion_tilt", "motion_intensity"], hasPan: true, hasTilt: true, suggestedEasing: "ease_both" },
    motion_3d: { primary: "motion_pan", secondary: ["motion_tilt", "motion_intensity"], hasPan: true, hasTilt: true, hasRoll: true, suggestedEasing: "ease_both" },
  };
  
  const base = trackTypeMap[runtimeType] || trackTypeMap.equipment;
  
  return {
    ...base,
    deviceId: fixture.id,
    deviceLabel: fixture.label,
    minIntensity: engineering.minIntensity ?? 0,
    maxIntensity: engineering.maxIntensity ?? 255,
    availableChannels: channels,
    protocol: fixtureInfo?.protocol || "virtual",
    latencyMs: fixtureInfo?.latencyMs || 0,
    channelMap: getChannelMapping(fixture.type, engineering),
  };
}

/**
 * Get channel mapping for a runtime type
 * 
 * @param {string} runtimeType
 * @param {Object} engineering
 * @returns {Object}
 */
function getChannelMapping(fixtureType, engineering) {
  // Use fixture type (e.g., "nozzle_geyser") not runtime type (e.g., "pump")
  const fixtureInfo = getFixtureInfo(fixtureType);
  const runtimeType = getRuntimeType(fixtureType);
  const channelDefs = RUNTIME_CHANNELS[runtimeType];
  
  if (!channelDefs) return { count: fixtureInfo?.channels?.length || 1, mapping: {} };
  
  const mapping = {};
  for (const channel of channelDefs.channels) {
    mapping[channel.key] = {
      type: channel.type,
      range: channel.range,
      unit: channel.unit,
      currentValue: engineering[channel.key] ?? channel.default,
    };
  }
  return { count: fixtureInfo?.channels?.length || channelDefs.channels.length, mapping };
}

/**
 * Create a single runtime device node from a fixture
 * 
 * @param {Object} fixture
 * @returns {RuntimeDeviceNode}
 */
export function createRuntimeDeviceNode(fixture) {
  if (!fixture || !fixture.id) {
    throw new Error("createRuntimeDeviceNode: fixture must have an id");
  }

  // Use getRuntimeType from fixtureTypeResolver.js (not getRuntimeTypeFromFixture)
  const runtimeType = getRuntimeType(fixture.type);
  const fixtureInfo = getFixtureInfo(fixture.type);
  const fixtureCategory = getFixtureCategory(fixture.type);
  const fixtureChannels = getFixtureChannels(fixture.type);
  const runtimeId = generateRuntimeId(fixture.id);

  return {
    runtimeId,
    fixtureId: fixture.id,
    fixtureLabel: fixture.label || fixture.type || "Unknown Fixture",
    fixtureType: fixture.type || "unknown",
    runtimeType: runtimeType,
    category: fixtureCategory,
    channels: getFixtureChannels(fixture.type),
    groups: extractGroups(fixture, runtimeType),
    previewCapabilities: buildPreviewCapabilities(runtimeType, fixture),
    trackCapabilities: buildTrackCapabilities(runtimeType, fixture),
    metadata: {
      zone: fixture.zone,
      rotation: fixture.rotation,
      position: { x: fixture.x, y: fixture.y, z: fixture.z || 0 },
      engineering: fixture.engineering || {},
      protocol: fixtureInfo?.protocol || "virtual",
      latencyMs: fixtureInfo?.latencyMs || 0,
      deviceType: fixtureInfo?.deviceType || "unknown",
    },
  };
}

/**
 * Build complete runtime device graph from fixtures
 * 
 * @param {Array} fixtures - Array of fixture objects from engineering store
 * @returns {RuntimeDeviceGraph}
 */
export function buildRuntimeDeviceGraph(fixtures = []) {
  if (!Array.isArray(fixtures)) {
    console.warn("buildRuntimeDeviceGraph: fixtures must be an array");
    return {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      fixtureCount: 0,
      byRuntimeType: {},
      byGroupId: {},
      nodes: new Map(),
      runtimeIds: [],
    };
  }

  const nodes = new Map();
  const byRuntimeType = new Map();
  const byGroupId = new Map();
  const runtimeIds = [];

  for (const fixture of fixtures) {
    try {
      const node = createRuntimeDeviceNode(fixture);
      nodes.set(node.runtimeId, node);
      runtimeIds.push(node.runtimeId);

      // Group by runtime type
      const rt = node.runtimeType;
      if (!byRuntimeType.has(rt)) {
        byRuntimeType.set(rt, []);
      }
      byRuntimeType.get(rt).push(node.runtimeId);

      // Group by groupId if present
      const groupId = fixture.groupId || "ungrouped";
      if (!byGroupId.has(groupId)) {
        byGroupId.set(groupId, []);
      }
      byGroupId.get(groupId).push(node.runtimeId);
    } catch (error) {
      console.warn(`Failed to create runtime node for fixture ${fixture?.id}:`, error);
    }
  }

  // Convert Maps to plain objects for serialization
  const byRuntimeTypeObj = {};
  for (const [key, value] of byRuntimeType) {
    byRuntimeTypeObj[key] = value;
  }

  const byGroupIdObj = {};
  for (const [key, value] of byGroupId) {
    byGroupIdObj[key] = value;
  }

  // Convert nodes Map to plain object for serialization (preserve for internal use)
  const nodesObj = {};
  for (const [key, value] of nodes) {
    nodesObj[key] = value;
  }

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    fixtureCount: fixtures.length,
    byRuntimeType: byRuntimeTypeObj,
    byGroupId: byGroupIdObj,
    nodes: nodesObj,
    runtimeIds,
  };
}

/**
 * Get a runtime device node by its runtime ID
 * 
 * @param {RuntimeDeviceGraph} graph
 * @param {string} runtimeId
 * @returns {RuntimeDeviceNode | null}
 */
export function getRuntimeDeviceNode(graph, runtimeId) {
  if (!graph || !graph.nodes) return null;
  return graph.nodes[runtimeId] || null;
}

/**
 * Get runtime device node by fixture ID
 * 
 * @param {RuntimeDeviceGraph} graph
 * @param {string} fixtureId
 * @returns {RuntimeDeviceNode | null}
 */
export function getRuntimeDeviceByFixtureId(graph, fixtureId) {
  if (!graph || !graph.nodes) return null;
  const runtimeId = generateRuntimeId(fixtureId);
  return graph.nodes[runtimeId] || null;
}

/**
 * Get all runtime devices of a specific type
 * 
 * @param {RuntimeDeviceGraph} graph
 * @param {string} runtimeType
 * @returns {Array<RuntimeDeviceNode>}
 */
export function getRuntimeDevicesByType(graph, runtimeType) {
  if (!graph || !graph.byRuntimeType || !graph.nodes) return [];
  
  const runtimeIds = graph.byRuntimeType[runtimeType] || [];
  return runtimeIds
    .map(id => graph.nodes[id])
    .filter(node => node !== undefined);
}

/**
 * Get all runtime devices in a group
 * 
 * @param {RuntimeDeviceGraph} graph
 * @param {string} groupId
 * @returns {Array<RuntimeDeviceNode>}
 */
export function getRuntimeDevicesByGroup(graph, groupId) {
  if (!graph || !graph.byGroupId || !graph.nodes) return [];
  
  const runtimeIds = graph.byGroupId[groupId] || [];
  return runtimeIds
    .map(id => graph.nodes[id])
    .filter(node => node !== undefined);
}

/**
 * Get preview-ready device list for 3D visualization
 * 
 * @param {RuntimeDeviceGraph} graph
 * @returns {Array<Object>}
 */
export function getPreviewDevices(graph) {
  if (!graph || !graph.nodes) return [];
  
  return Object.values(graph.nodes).map(node => ({
    id: node.runtimeId,
    fixtureId: node.fixtureId,
    label: node.fixtureLabel,
    type: node.runtimeType,
    position: node.previewCapabilities.position,
    rotation: node.previewCapabilities.rotation,
    icon: node.previewCapabilities.icon,
    color: node.previewCapabilities.color,
    previewType: node.previewCapabilities.previewType,
    animatable: node.previewCapabilities.animatable,
    parameters: node.previewCapabilities.parameters || [],
  }));
}

/**
 * Get track-ready device list for Show Programmer
 * 
 * @param {RuntimeDeviceGraph} graph
 * @returns {Array<Object>}
 */
export function getTrackDevices(graph) {
  if (!graph || !graph.nodes) return [];
  
  return Object.values(graph.nodes).map(node => ({
    id: node.fixtureId,
    label: node.fixtureLabel,
    type: node.runtimeType,
    trackType: node.trackCapabilities.primaryTrackType || node.trackCapabilities.primary,
    secondaryTrackTypes: node.trackCapabilities.secondaryTrackTypes || node.trackCapabilities.secondary || [],
    hasIntensity: node.trackCapabilities.hasIntensity,
    hasColor: node.trackCapabilities.hasColor,
    minIntensity: node.trackCapabilities.minIntensity,
    maxIntensity: node.trackCapabilities.maxIntensity,
    suggestedEasing: node.trackCapabilities.suggestedEasing,
    channelMap: node.trackCapabilities.channelMap,
  }));
}

/**
 * Validate a runtime device graph
 * 
 * @param {RuntimeDeviceGraph} graph
 * @returns {Object} { valid: boolean, errors: Array<string> }
 */
export function validateRuntimeDeviceGraph(graph) {
  const errors = [];
  
  if (!graph) {
    errors.push("Graph is null or undefined");
    return { valid: false, errors };
  }
  
  if (graph.version !== "1.0.0") {
    errors.push(`Unsupported graph version: ${graph.version}`);
  }
  
  if (typeof graph.fixtureCount !== "number") {
    errors.push("Missing fixtureCount");
  }
  
  if (!graph.nodes) {
    errors.push("Missing nodes");
  } else {
    const nodeList = Object.values(graph.nodes);
    for (const node of nodeList) {
      if (!node.runtimeId) errors.push(`Node missing runtimeId: ${node.fixtureId}`);
      if (!node.fixtureId) errors.push(`Node missing fixtureId: ${node.runtimeId}`);
      if (!node.runtimeType) errors.push(`Node missing runtimeType: ${node.runtimeId}`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}

// ============================================================
// EXPORTS
// ============================================================

export default {
  createRuntimeDeviceNode,
  buildRuntimeDeviceGraph,
  getRuntimeDeviceNode,
  getRuntimeDeviceByFixtureId,
  getRuntimeDevicesByType,
  getRuntimeDevicesByGroup,
  getPreviewDevices,
  getTrackDevices,
  validateRuntimeDeviceGraph,
};