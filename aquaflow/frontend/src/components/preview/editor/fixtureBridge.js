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
    const rot = node.transform.rotation || {};
    out.push({
      id: node.id,
      type: node.props.nozzleType || "jet_1d",
      x: p.x,
      z: p.z,
      tiltX: rot.x || 0,
      tiltZ: rot.z || 0,
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
    if (!groupId) return undefined;
    if (!groups.has(groupId)) {
      groups.set(groupId, graph.add({ type: NODE_TYPES.GROUP, name: String(groupId) }));
    }
    return groups.get(groupId).id;
  };

  for (const n of design.nozzles || []) {
    graph.add({
      id: n.id,
      name: n.name || n.id || "Nozzle",
      type: NODE_TYPES.NOZZLE,
      parentId: groupFor(n.groupId),
      // The legacy format is 2D: it carries x and either z or y for the ground plane.
      position: { x: n.x ?? 0, y: 0, z: n.z ?? n.y ?? 0 },
      rotation: { x: n.tiltX || 0, y: 0, z: n.tiltZ || 0 },
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

/**
 * The fixture palette the Library panel offers. Each entry is a node spec template.
 * Kept as data so the palette and the drop handler cannot disagree.
 */
export const FIXTURE_PALETTE = [
  { key: "jet_1d",   label: "Jet (1D)",     type: NODE_TYPES.NOZZLE, props: { nozzleType: "jet_1d" } },
  { key: "jet_2d",   label: "Jet (2D)",     type: NODE_TYPES.NOZZLE, props: { nozzleType: "jet_2d" } },
  { key: "jet_3d",   label: "Jet (3D)",     type: NODE_TYPES.NOZZLE, props: { nozzleType: "jet_3d" } },
  { key: "geyser",   label: "Geyser",       type: NODE_TYPES.NOZZLE, props: { nozzleType: "geyser" } },
  { key: "laminar",  label: "Laminar",      type: NODE_TYPES.NOZZLE, props: { nozzleType: "laminar" } },
  { key: "mist",     label: "Mist",         type: NODE_TYPES.NOZZLE, props: { nozzleType: "mist" } },
  { key: "fan_jet",  label: "Fan jet",      type: NODE_TYPES.NOZZLE, props: { nozzleType: "fan_jet" } },
  { key: "ring",     label: "Ring",         type: NODE_TYPES.NOZZLE, props: { nozzleType: "ring" } },
  { key: "arch",     label: "Arch",         type: NODE_TYPES.NOZZLE, props: { nozzleType: "arch" } },
  { key: "light",    label: "RGB light",    type: NODE_TYPES.LIGHT,  props: { color: "#3aa0ff", intensity: 0.85, radius: 6 } },
  { key: "pump",     label: "Pump",         type: NODE_TYPES.PUMP,   props: {} },
  { key: "valve",    label: "Valve",        type: NODE_TYPES.VALVE,  props: {} },
  { key: "distributor", label: "Distributor", type: NODE_TYPES.DISTRIBUTOR, props: {} },
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
