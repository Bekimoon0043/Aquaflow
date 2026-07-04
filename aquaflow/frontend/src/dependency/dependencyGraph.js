// dependencyGraph.js — AquaFlow Equipment Dependency Graph (AQ-X-008)
//
// Pure, framework-agnostic builder that turns designed fixtures into an equipment
// dependency graph the UI can draw, and flags dependency conflicts. Mirrors the
// backend services/dependency_graph.py so the frontend can render either the live
// API response or compute the graph locally.
//
//   * buildDependencyGraph(fixtures) → { nodes, edges, conflicts, stats }
//   * layoutGraph(graph)             → adds {x, y} to every node for SVG layout
//
// Edge kind ∈ member_of | controlled_by | depends_on  ("from depends on to").

const MODBUS_CLASSES = new Set(["pump", "valve", "flame", "sensor"]);
const DMX_CLASSES = new Set(["lighting", "fog", "laser"]);
export const LAYER = { plc: 0, universe: 0, group: 1, fixture: 2 };
export const DEFAULT_SPOF_THRESHOLD = 3;

// Lightweight control-class derivation (matches the backend fixture bridge).
export function deriveDeviceClass(rawType) {
  const t = String(rawType || "").trim().toLowerCase();
  if (/light|rgb|under|led|spot|par|beam|wash/.test(t)) return "lighting";
  if (t.includes("laser")) return "laser";
  if (/flame|fire/.test(t)) return "flame";
  if (/fog|mist|haze|smoke/.test(t)) return "fog";
  if (/valve|solenoid/.test(t)) return "valve";
  if (/pump|vfd/.test(t)) return "pump";
  if (t.includes("sensor")) return "sensor";
  if (/nozzle|jet|geyser|foam|laminar|running|fan|arch|spray/.test(t)) return "pump";
  return "aux";
}

function first(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}

export function buildDependencyGraph(fixtures, spofThreshold = DEFAULT_SPOF_THRESHOLD) {
  const nodes = new Map();
  const edges = [];
  const conflicts = [];

  const addNode = (id, kind, label, meta = {}) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, layer: LAYER[kind] ?? 2, ...meta });
    return nodes.get(id);
  };
  const addEdge = (from, to, kind) => edges.push({ from, to, kind });

  const dmxAddr = new Map();     // "u|ch" -> [ids]
  const modbusAddr = new Map();  // "host|reg" -> [ids]

  for (const fx of fixtures || []) {
    if (!fx || typeof fx !== "object") continue;
    const fid = fx.id || fx.fixtureId;
    if (!fid) continue;
    const id = String(fid);
    const rawType = fx.type || fx.fixtureType || "";
    const dclass = deriveDeviceClass(rawType);
    const eng = fx.engineering || {};

    addNode(id, "fixture", String(fx.label || id), { type: String(rawType) || dclass, deviceClass: dclass });

    const gid = fx.groupId || fx.group;
    if (gid) {
      addNode(`group:${gid}`, "group", String(gid));
      addEdge(id, `group:${gid}`, "member_of");
    }

    if (MODBUS_CLASSES.has(dclass)) {
      const host = String(first(fx.plcHost, eng.plcHost, fx.ip) || "PLC-default");
      addNode(`plc:${host}`, "plc", host);
      addEdge(id, `plc:${host}`, "controlled_by");
      const reg = first(fx.register, fx.plcRegister, eng.register);
      if (reg !== undefined) {
        const key = `${host}|${reg}`;
        modbusAddr.set(key, [...(modbusAddr.get(key) || []), id]);
      }
    } else if (DMX_CLASSES.has(dclass)) {
      const uni = first(fx.universe, fx.dmxUniverse, eng.dmxUniverse) ?? 1;
      addNode(`universe:${uni}`, "universe", `Universe ${uni}`);
      addEdge(id, `universe:${uni}`, "controlled_by");
      const ch = first(fx.channel, fx.dmxChannel, fx.dmxAddress, eng.dmxChannel);
      if (ch !== undefined) {
        const key = `${uni}|${ch}`;
        dmxAddr.set(key, [...(dmxAddr.get(key) || []), id]);
      }
    }

    for (const dep of fx.dependsOn || []) addEdge(id, String(dep), "depends_on");
  }

  // ── Conflicts ──────────────────────────────────────────────────────────────
  for (const [key, ids] of dmxAddr) {
    if (ids.length > 1) {
      const [u, ch] = key.split("|");
      conflicts.push({ type: "address_conflict", severity: "critical",
        message: `DMX address U${u} Ch${ch} shared by ${ids.join(", ")}`, nodes: [...ids] });
    }
  }
  for (const [key, ids] of modbusAddr) {
    if (ids.length > 1) {
      const [host, reg] = key.split("|");
      conflicts.push({ type: "address_conflict", severity: "critical",
        message: `Modbus ${host} register ${reg} shared by ${ids.join(", ")}`, nodes: [...ids] });
    }
  }
  for (const e of edges) {
    if (e.kind === "depends_on" && !nodes.has(e.to)) {
      conflicts.push({ type: "missing_dependency", severity: "critical",
        message: `'${e.from}' depends on missing equipment '${e.to}'`, nodes: [e.from, e.to] });
    }
  }
  for (const cyc of findCycles(edges, nodes)) {
    conflicts.push({ type: "cycle", severity: "critical",
      message: `Circular dependency: ${[...cyc, cyc[0]].join(" → ")}`, nodes: cyc });
  }
  const dependents = new Map();
  for (const e of edges) {
    if (e.kind === "controlled_by") dependents.set(e.to, [...(dependents.get(e.to) || []), e.from]);
  }
  for (const [nid, deps] of dependents) {
    if (deps.length >= spofThreshold) {
      conflicts.push({ type: "single_point_of_failure", severity: "warning",
        message: `${nodes.get(nid).label} is a single point of failure for ${deps.length} devices`,
        nodes: [nid, ...deps] });
    }
  }
  const connected = new Set();
  for (const e of edges) { connected.add(e.from); connected.add(e.to); }
  for (const node of nodes.values()) {
    if (node.kind === "fixture" && !connected.has(node.id)) {
      conflicts.push({ type: "orphan", severity: "warning",
        message: `'${node.label}' has no controller or group`, nodes: [node.id] });
    }
  }

  const nodeList = [...nodes.values()];
  const stats = {
    nodeCount: nodeList.length,
    edgeCount: edges.length,
    fixtureCount: nodeList.filter((n) => n.kind === "fixture").length,
    controllerCount: nodeList.filter((n) => n.kind === "plc" || n.kind === "universe").length,
    conflictCount: conflicts.length,
    criticalConflicts: conflicts.filter((c) => c.severity === "critical").length,
  };
  return { nodes: nodeList, edges, conflicts, stats };
}

function findCycles(edges, nodes) {
  const adj = new Map();
  for (const e of edges) {
    if (e.kind === "depends_on" && nodes.has(e.to) && nodes.has(e.from)) {
      adj.set(e.from, [...(adj.get(e.from) || []), e.to]);
    }
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...nodes.keys()].map((k) => [k, WHITE]));
  const cycles = [];
  const seen = new Set();

  const dfs = (u, stack) => {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) || []) {
      if (color.get(v) === GRAY) {
        const cyc = stack.slice(stack.indexOf(v));
        const sig = [...cyc].sort().join(",");
        if (!seen.has(sig)) { seen.add(sig); cycles.push([...cyc]); }
      } else if (color.get(v) === WHITE) {
        dfs(v, stack);
      }
    }
    stack.pop();
    color.set(u, BLACK);
  };
  for (const n of nodes.keys()) if (color.get(n) === WHITE && adj.has(n)) dfs(n, []);
  return cycles;
}

// ── Layout for SVG rendering ──────────────────────────────────────────────────
// Layered top-down: controllers (layer 0) at the top, then groups, then fixtures.
export function layoutGraph(graph, { width = 900, rowHeight = 140, nodeGapX = 150 } = {}) {
  const byLayer = new Map();
  for (const n of graph.nodes) {
    if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
    byLayer.get(n.layer).push(n);
  }
  const conflictIds = new Set(graph.conflicts.flatMap((c) => c.nodes));
  const positioned = graph.nodes.map((n) => ({ ...n }));
  const posById = new Map(positioned.map((n) => [n.id, n]));

  for (const [layer, list] of byLayer) {
    list.forEach((n, i) => {
      const node = posById.get(n.id);
      const span = (list.length - 1) * nodeGapX;
      node.x = width / 2 - span / 2 + i * nodeGapX;
      node.y = 60 + layer * rowHeight;
      node.hasConflict = conflictIds.has(n.id);
    });
  }
  const height = 60 + (Math.max(0, byLayer.size - 1)) * rowHeight + 80;
  return { nodes: positioned, edges: graph.edges, conflicts: graph.conflicts,
    stats: graph.stats, width, height };
}
