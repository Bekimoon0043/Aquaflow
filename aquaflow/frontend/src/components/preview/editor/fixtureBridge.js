/**
 * fixtureBridge.js — keeps the scene graph and the renderer talking.
 *
 * The SceneGraph owns layout; FountainScene draws it. This module is the only place that
 * translates between them, so there is exactly one definition of "what a nozzle node
 * means to the renderer" and the two can never drift.
 *
 * It also imports an existing design (the flat nozzle array the Engineering Designer has
 * always produced) into a graph, so switching the preview into a workspace does not
 * orphan any project already on disk.
 *
 * Pure — no three.js — so the mapping is unit-testable.
 */

import { NODE_TYPES } from "./sceneGraph";
import { classifyFixtureType, resolveFixtureType } from "../../../hooks/fixtureTypeMap";
import { engineeringToWorld, worldToEngineering } from "../../../engineering/geometryContract";

const R2D = 180 / Math.PI;

/** Reuse persisted group IDs so hierarchy references remain stable across saves. */
function ensureGroup(graph, groups, groupId) {
  if (!groupId) return undefined;
  if (groups.has(groupId)) return groups.get(groupId).id;
  const existing = graph.get(String(groupId));
  const group = existing?.type === NODE_TYPES.GROUP
    ? existing
    : graph.add({
      // Avoid overwriting a malformed project where a fixture already owns this ID.
      id: existing ? undefined : String(groupId),
      type: NODE_TYPES.GROUP,
      name: String(groupId),
    });
  groups.set(groupId, group);
  return group.id;
}

/** Extract world Euler XYZ (degrees) from the graph's affine matrix. */
function worldRotation(graph, id) {
  const m = graph.worldMatrix(id);
  // Scale lives in the matrix columns. Normalize it out before reading rotation.
  const sx = Math.hypot(m[0], m[4], m[8]) || 1;
  const sy = Math.hypot(m[1], m[5], m[9]) || 1;
  const sz = Math.hypot(m[2], m[6], m[10]) || 1;
  const r00 = m[0] / sx, r10 = m[4] / sx, r20 = m[8] / sx;
  const r11 = m[5] / sy, r21 = m[9] / sy;
  const r12 = m[6] / sz, r22 = m[10] / sz;
  const y = Math.asin(Math.max(-1, Math.min(1, -r20)));
  const cy = Math.cos(y);
  const x = Math.abs(cy) > 1e-6 ? Math.atan2(r21, r22) : Math.atan2(-r12, r11);
  const z = Math.abs(cy) > 1e-6 ? Math.atan2(r10, r00) : 0;
  return { x: x * R2D, y: y * R2D, z: z * R2D };
}

/**
 * Renderer nozzle configs from the graph.
 * World positions are used, so a nozzle inside a rotated group exports where it actually
 * IS, not where its local coordinates say — otherwise grouping would silently break the
 * render.
 */
export function graphToNozzles(graph) {
  if (!graph) return [];
  const out = [];
  for (const node of graph.byType(NODE_TYPES.NOZZLE)) {
    if (!graph.isVisible(node.id)) continue;
    const p = graph.worldPosition(node.id);
    const rot = worldRotation(graph, node.id);
    out.push({
      id: node.id,
      type: node.props.nozzleType || "jet_1d",
      x: p.x,
      z: p.z,
      tiltX: rot.x || 0,
      tiltZ: rot.z || 0,
      rotationY: rot.y || 0,
      groupId: node.parentId || null,
      engineering: node.props.engineering || null,
    });
  }
  return out;
}

/** Renderer light configs from the graph. */
export function graphToLights(graph) {
  if (!graph) return [];
  const out = [];
  for (const node of graph.byType(NODE_TYPES.LIGHT)) {
    if (!graph.isVisible(node.id)) continue;
    const p = graph.worldPosition(node.id);
    out.push({
      id: node.id,
      x: p.x,
      z: p.z,
      color: node.props.color || "#3aa0ff",
      intensity: node.props.intensity ?? 0.8,
      radius: node.props.radius ?? 6,
    });
  }
  return out;
}

/**
 * Import a flat design (nozzles and lights as the Engineering Designer emits them) into
 * a graph, preserving any groupId as a real parent group.
 *
 * @param {SceneGraph} graph  target graph, mutated in place
 * @param {object} design     { nozzles?: [], lights?: [] }
 */
export function importDesign(graph, design) {
  if (!graph || !design) return { nozzles: 0, lights: 0, groups: 0 };
  const groups = new Map();
  let nozzles = 0, lights = 0;

  const groupFor = (groupId) => {
    return ensureGroup(graph, groups, groupId);
  };

  for (const n of design.nozzles || []) {
    graph.add({
      id: n.id,
      name: n.name || n.id || "Nozzle",
      type: NODE_TYPES.NOZZLE,
      parentId: groupFor(n.groupId),
      // The legacy format is 2D: it carries x and either z or y for the ground plane.
      position: { x: n.x ?? 0, y: 0, z: n.z ?? n.y ?? 0 },
      rotation: { x: n.tiltX || 0, y: n.rotationY || 0, z: n.tiltZ || 0 },
      props: {
        nozzleType: n.type || n.nozzleType || "jet_1d",
        engineering: n.engineering || null,
      },
    });
    nozzles++;
  }

  for (const l of design.lights || []) {
    graph.add({
      id: l.id,
      name: l.name || l.id || "Light",
      type: NODE_TYPES.LIGHT,
      position: { x: l.x ?? 0, y: l.y ?? 0, z: l.z ?? 0 },
      props: {
        color: l.color || "#3aa0ff",
        intensity: l.intensity ?? 0.8,
        radius: l.radius ?? 6,
      },
    });
    lights++;
  }

  // Re-centre each imported group on its children so rotating it behaves sensibly.
  for (const g of groups.values()) {
    const kids = g.childIds.map(id => graph.worldPosition(id));
    if (!kids.length) continue;
    const c = kids.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), { x: 0, y: 0, z: 0 });
    c.x /= kids.length; c.y /= kids.length; c.z /= kids.length;
    // Order matters. reparent() preserves world position, so detach the children FIRST,
    // then move the group, then reattach. Moving the group while they are still attached
    // would drag them along and the "preserved" world position captured afterwards would
    // already be the shifted one.
    const children = [...g.childIds];
    for (const id of children) graph.reparent(id, null);
    graph.setTransform(g.id, { position: c });
    for (const id of children) graph.reparent(id, g.id);
  }

  return { nozzles, lights, groups: groups.size };
}

/**
 * Export the graph back to the flat design format, so the workspace round-trips into
 * whatever already consumes an AquaFlow design.
 */
export function exportDesign(graph) {
  return { nozzles: graphToNozzles(graph), lights: graphToLights(graph) };
}

function nodeTypeForFixture(type) {
  const key = String(type || "").toLowerCase();
  if (classifyFixtureType(key) !== "equipment") {
    return resolveFixtureType(key).isLight ? NODE_TYPES.LIGHT : NODE_TYPES.NOZZLE;
  }
  if (key.includes("pump")) return NODE_TYPES.PUMP;
  if (key.includes("valve") || key.includes("solenoid")) return NODE_TYPES.VALVE;
  return NODE_TYPES.DISTRIBUTOR;
}

/** Import the canonical Engineering Designer fixture records into the editable graph. */
export function importEngineeringFixtures(graph, fixtures = [], { center = { cx: 0, cy: 0 } } = {}) {
  if (!graph || !Array.isArray(fixtures)) return 0;
  const groups = new Map();
  const groupFor = (groupId) => {
    return ensureGroup(graph, groups, groupId);
  };

  for (const fixture of fixtures) {
    const type = nodeTypeForFixture(fixture.type);
    const mapped = resolveFixtureType(fixture.type);
    const world = engineeringToWorld(fixture, center);
    graph.add({
      id: fixture.id,
      name: fixture.label || fixture.name || fixture.id || "Fixture",
      type,
      parentId: groupFor(fixture.groupId),
      position: { x: world.x, y: fixture.z ?? 0, z: world.z },
      rotation: {
        x: fixture.tiltX ?? mapped.tiltX ?? 0,
        y: fixture.rotation ?? fixture.rotationY ?? 0,
        z: fixture.tiltZ ?? mapped.tiltZ ?? 0,
      },
      visible: fixture.visible !== false,
      locked: fixture.locked,
      props: {
        engineeringType: fixture.type,
        nozzleType: mapped.nozzleType,
        engineering: fixture.engineering || null,
        color: fixture.color || fixture.params?.color || fixture.engineering?.color || mapped.color,
        intensity: fixture.intensity ?? mapped.intensity,
        radius: fixture.radius ?? fixture.engineering?.beamRadiusM,
        zone: fixture.zone,
        symbol: fixture.symbol,
      },
    });
  }
  return fixtures.length;
}

const DEFAULT_ENGINEERING_TYPE = {
  [NODE_TYPES.NOZZLE]: "nozzle_jet_3d",
  [NODE_TYPES.LIGHT]: "light_uw_rgb_18w",
  [NODE_TYPES.PUMP]: "pump",
  [NODE_TYPES.VALVE]: "valve",
  [NODE_TYPES.DISTRIBUTOR]: "distributor",
};

/**
 * Flatten editable graph fixtures back into Engineering Designer records.
 * Existing records are merged by id, preserving hydraulic and manufacturer data.
 */
export function graphToEngineeringFixtures(graph, existingFixtures = [], { center = { cx: 0, cy: 0 } } = {}) {
  if (!graph) return [];
  const existing = new Map((existingFixtures || []).map(fixture => [fixture.id, fixture]));
  const supported = new Set([
    NODE_TYPES.NOZZLE, NODE_TYPES.LIGHT, NODE_TYPES.PUMP,
    NODE_TYPES.VALVE, NODE_TYPES.DISTRIBUTOR,
  ]);
  const fixtures = [];
  for (const node of graph.nodes.values()) {
    if (!supported.has(node.type)) continue;
    const previous = existing.get(node.id) || {};
    const position = graph.worldPosition(node.id);
    const engineeringPosition = worldToEngineering(position, center);
    const rotation = worldRotation(graph, node.id);
    fixtures.push({
      ...previous,
      id: node.id,
      type: node.props.engineeringType || previous.type || DEFAULT_ENGINEERING_TYPE[node.type],
      label: node.name || previous.label || "Fixture",
      x: engineeringPosition.x,
      y: engineeringPosition.y,
      z: engineeringPosition.z,
      rotation: rotation.y || 0,
      tiltX: rotation.x || 0,
      tiltZ: rotation.z || 0,
      // The graph hierarchy is authoritative here. Falling back to the old record
      // would silently undo an explicit Ungroup operation on the next refresh.
      groupId: node.parentId || null,
      zone: node.props.zone ?? previous.zone,
      engineering: node.props.engineering ?? previous.engineering ?? {},
      symbol: node.props.symbol ?? previous.symbol,
      color: node.props.color ?? previous.color,
      visible: node.visible !== false,
      locked: node.locked,
    });
  }
  return fixtures;
}

const FIXTURE_NODE_TYPES = new Set([
  NODE_TYPES.NOZZLE, NODE_TYPES.LIGHT, NODE_TYPES.PUMP,
  NODE_TYPES.VALVE, NODE_TYPES.DISTRIBUTOR,
]);

/** Import project-owned textured venue models, recreating their hierarchy first. */
export function importSiteModels(graph, siteModels = []) {
  if (!graph || !Array.isArray(siteModels)) return 0;
  const groups = new Map();
  let count = 0;
  for (const model of siteModels) {
    if (!model?.props?.assetId) continue;
    graph.add({
      id: model.id,
      name: model.name,
      type: NODE_TYPES.MODEL,
      parentId: ensureGroup(graph, groups, model.parentId),
      position: model.transform?.position || model.position,
      rotation: model.transform?.rotation || model.rotation,
      scale: model.transform?.scale ?? model.scale,
      visible: model.visible,
      locked: model.locked,
      props: model.props,
    });
    count += 1;
  }
  return count;
}

/**
 * Replace the editable fixture/model portion of an existing graph from Engineering.
 * The SceneGraph instance itself is retained, so the editor, hierarchy and inspector
 * keep their subscriptions. Selection is restored for IDs that still exist.
 */
export function reconcileEngineeringGraph(
  graph,
  { fixtures = [], siteModels = [], center = { cx: 0, cy: 0 } } = {},
) {
  if (!graph) return { fixtures: 0, models: 0 };
  const selected = graph.selected();

  graph.transaction(() => {
    // Remove leaves first. Groups are retained when they still contain unrelated nodes.
    for (const node of [...graph.nodes.values()]) {
      if (FIXTURE_NODE_TYPES.has(node.type) || node.type === NODE_TYPES.MODEL) graph.remove(node.id);
    }
    // Nested groups can become empty from the leaves upward, so repeat until stable.
    let removedEmptyGroup = true;
    while (removedEmptyGroup) {
      removedEmptyGroup = false;
      for (const node of [...graph.nodes.values()]) {
        if (node.type === NODE_TYPES.GROUP && node.childIds.length === 0) {
          graph.remove(node.id);
          removedEmptyGroup = true;
        }
      }
    }

    importEngineeringFixtures(graph, fixtures, { center });
    importSiteModels(graph, siteModels);

    graph.selection = new Set(selected.filter(id => graph.nodes.has(id)));
  }, "external-sync");

  return {
    fixtures: [...graph.nodes.values()].filter(node => FIXTURE_NODE_TYPES.has(node.type)).length,
    models: graph.byType(NODE_TYPES.MODEL).length,
  };
}

/** Project-safe records for people, vegetation, buildings and imported GLB assets. */
export function graphToSiteModels(graph) {
  if (!graph) return [];
  return [...graph.nodes.values()]
    .filter(node => node.type === NODE_TYPES.MODEL && node.props?.assetId)
    .map(node => ({
      id: node.id,
      name: node.name,
      type: node.type,
      parentId: node.parentId || null,
      // Project state must not share mutable references with the live graph.
      transform: {
        position: { ...node.transform.position },
        rotation: { ...node.transform.rotation },
        scale: typeof node.transform.scale === "object"
          ? { ...node.transform.scale }
          : node.transform.scale,
      },
      visible: node.visible,
      locked: node.locked,
      props: { ...node.props },
    }));
}

/**
 * The fixture palette the Library panel offers. Each entry is a node spec template.
 * Kept as data so the palette and the drop handler cannot disagree.
 */
export const FIXTURE_PALETTE = [
  { key: "jet_1d",   label: "Jet (1D)",     type: NODE_TYPES.NOZZLE, props: { nozzleType: "jet_1d", engineeringType: "nozzle_straight_dn15" } },
  { key: "jet_2d",   label: "Jet (2D)",     type: NODE_TYPES.NOZZLE, props: { nozzleType: "jet_2d", engineeringType: "motion_nozzle_2d_pan_tilt" } },
  { key: "jet_3d",   label: "Jet (3D)",     type: NODE_TYPES.NOZZLE, props: { nozzleType: "jet_3d", engineeringType: "nozzle_jet_3d" } },
  { key: "geyser",   label: "Geyser",       type: NODE_TYPES.NOZZLE, props: { nozzleType: "geyser", engineeringType: "nozzle_geyser" } },
  { key: "laminar",  label: "Laminar",      type: NODE_TYPES.NOZZLE, props: { nozzleType: "laminar", engineeringType: "nozzle_laminar" } },
  { key: "mist",     label: "Mist",         type: NODE_TYPES.NOZZLE, props: { nozzleType: "mist", engineeringType: "nozzle_mist" } },
  { key: "fan_jet",  label: "Fan jet",      type: NODE_TYPES.NOZZLE, props: { nozzleType: "fan_jet", engineeringType: "nozzle_fan" } },
  { key: "ring",     label: "Ring",         type: NODE_TYPES.NOZZLE, props: { nozzleType: "ring", engineeringType: "nozzle_ring" } },
  { key: "arch",     label: "Arch",         type: NODE_TYPES.NOZZLE, props: { nozzleType: "arch", engineeringType: "nozzle_arch" } },
  { key: "light",    label: "RGB light",    type: NODE_TYPES.LIGHT,  props: { engineeringType: "light_uw_rgb_18w", color: "#3aa0ff", intensity: 0.85, radius: 6 } },
  { key: "pump",     label: "Pump",         type: NODE_TYPES.PUMP,   props: { engineeringType: "pump" } },
  { key: "valve",    label: "Valve",        type: NODE_TYPES.VALVE,  props: { engineeringType: "valve" } },
  { key: "distributor", label: "Distributor", type: NODE_TYPES.DISTRIBUTOR, props: { engineeringType: "distributor" } },
];

/** Look up a palette entry and turn it into a node spec ready for SceneEditor.dropAt. */
export function paletteSpec(key, index = 0) {
  const item = FIXTURE_PALETTE.find(f => f.key === key);
  if (!item) return null;
  return {
    type: item.type,
    name: index > 0 ? `${item.label} ${index}` : item.label,
    props: { ...item.props },
  };
}
