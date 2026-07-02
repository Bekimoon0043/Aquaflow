/**
 * pipeworkEngine.js — AquaFlow Professional Pipe Routing Engine v2
 *
 * Features:
 * - Minimum spanning tree routing (no random straight lines)
 * - Orthogonal routing only (horizontal + vertical segments with proper elbows)
 * - Hydraulic pipe sizing per branch based on flow rate
 * - Automatic pump connection point
 * - Loop vs tree topology selection
 * - Full BOM: pipes, elbows, tees, reducers, valves, flanges
 * - Manual pipe polyline support (consumed from PoolGeometryDesigner state)
 */

// ─── Pipe sizing table (DN → flow capacity in L/min) ────────────────────────
const PIPE_SIZES = [
  { dn: 20,  mm: 20,  maxFlowLpm: 30,   velocityMs: 1.5 },
  { dn: 25,  mm: 25,  maxFlowLpm: 60,   velocityMs: 1.5 },
  { dn: 32,  mm: 32,  maxFlowLpm: 100,  velocityMs: 1.5 },
  { dn: 40,  mm: 40,  maxFlowLpm: 160,  velocityMs: 1.5 },
  { dn: 50,  mm: 50,  maxFlowLpm: 250,  velocityMs: 1.5 },
  { dn: 65,  mm: 65,  maxFlowLpm: 420,  velocityMs: 1.5 },
  { dn: 80,  mm: 80,  maxFlowLpm: 650,  velocityMs: 1.5 },
  { dn: 100, mm: 100, maxFlowLpm: 1000, velocityMs: 1.5 },
  { dn: 125, mm: 125, maxFlowLpm: 1600, velocityMs: 1.5 },
  { dn: 150, mm: 150, maxFlowLpm: 2400, velocityMs: 1.5 },
];

export function selectPipeDN(flowLpm) {
  for (const size of PIPE_SIZES) {
    if (flowLpm <= size.maxFlowLpm) return size.dn;
  }
  return 150;
}

// ─── Orthogonal path between two points ─────────────────────────────────────
// Returns array of {x,y} waypoints forming L-shape or Z-shape path
function orthogonalPath(from, to, preferHorizontalFirst = true) {
  const points = [{ x: from.x, y: from.y }];
  if (Math.abs(from.x - to.x) < 0.01) {
    // Already vertical
    points.push({ x: to.x, y: to.y });
  } else if (Math.abs(from.y - to.y) < 0.01) {
    // Already horizontal
    points.push({ x: to.x, y: to.y });
  } else if (preferHorizontalFirst) {
    // Go horizontal first, then vertical
    points.push({ x: to.x, y: from.y });
    points.push({ x: to.x, y: to.y });
  } else {
    // Go vertical first, then horizontal
    points.push({ x: from.x, y: to.y });
    points.push({ x: to.x, y: to.y });
  }
  return points;
}

// ─── Path length ─────────────────────────────────────────────────────────────
function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.abs(points[i].x - points[i-1].x) + Math.abs(points[i].y - points[i-1].y);
  }
  return len;
}

// ─── Count elbows in path ────────────────────────────────────────────────────
function countElbows(points) {
  let count = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const dx1 = points[i].x - points[i-1].x;
    const dy1 = points[i].y - points[i-1].y;
    const dx2 = points[i+1].x - points[i].x;
    const dy2 = points[i+1].y - points[i].y;
    if (Math.abs(dx1) > 0.01 && Math.abs(dy2) > 0.01) count++;
    if (Math.abs(dy1) > 0.01 && Math.abs(dx2) > 0.01) count++;
  }
  return count;
}

// ─── Find pool centroid for pump connection ──────────────────────────────────
function getPoolCentroid(geometry) {
  if (!geometry) return { x: 0, y: -2 };
  if (geometry.type === "circle") return { x: geometry.center.x, y: geometry.center.y - geometry.radius - 1.5 };
  if (geometry.type === "ellipse") return { x: geometry.center.x, y: geometry.center.y - geometry.ry - 1.5 };
  if (geometry.points?.length) {
    const xs = geometry.points.map(p => p.x);
    const ys = geometry.points.map(p => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) - 1.5 };
  }
  return { x: 0, y: -2 };
}

// ─── Minimum spanning tree (Prim's algorithm) ────────────────────────────────
function buildMST(fixtures) {
  if (fixtures.length === 0) return [];
  const nodes = fixtures.map(f => ({ x: Number(f.x||0), y: Number(f.y||0), id: f.id, f }));
  const inTree = new Set([0]);
  const edges = [];
  while (inTree.size < nodes.length) {
    let best = null, bestDist = Infinity, bestFrom = -1, bestTo = -1;
    for (const i of inTree) {
      for (let j = 0; j < nodes.length; j++) {
        if (inTree.has(j)) continue;
        const d = Math.abs(nodes[i].x - nodes[j].x) + Math.abs(nodes[i].y - nodes[j].y);
        if (d < bestDist) { bestDist = d; bestFrom = i; bestTo = j; }
      }
    }
    if (bestTo === -1) break;
    edges.push({ from: nodes[bestFrom], to: nodes[bestTo], length: bestDist });
    inTree.add(bestTo);
  }
  return edges;
}

// ─── Ring/loop topology ──────────────────────────────────────────────────────
function buildRingLayout(fixtures) {
  if (fixtures.length < 2) return buildTreeLayout(fixtures);
  // Sort by angle from centroid for ring
  const xs = fixtures.map(f => Number(f.x||0));
  const ys = fixtures.map(f => Number(f.y||0));
  const cx = xs.reduce((a,b)=>a+b,0)/xs.length;
  const cy = ys.reduce((a,b)=>a+b,0)/ys.length;
  const sorted = [...fixtures].sort((a,b) => {
    const aa = Math.atan2(Number(a.y||0)-cy, Number(a.x||0)-cx);
    const ba = Math.atan2(Number(b.y||0)-cy, Number(b.x||0)-cx);
    return aa - ba;
  });
  const edges = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i];
    const to   = sorted[(i+1) % sorted.length];
    edges.push({
      from: { x: Number(from.x||0), y: Number(from.y||0), id: from.id },
      to:   { x: Number(to.x||0),   y: Number(to.y||0),   id: to.id },
      length: Math.abs(Number(from.x||0)-Number(to.x||0)) + Math.abs(Number(from.y||0)-Number(to.y||0)),
    });
  }
  return edges;
}

// ─── Tree topology (MST-based) ────────────────────────────────────────────────
function buildTreeLayout(fixtures) {
  return buildMST(fixtures);
}

// ─── Main export ─────────────────────────────────────────────────────────────
export function generatePipework(fixtures = [], geometry = null, options = {}) {
  const {
    topology = "tree",      // "tree" | "ring"
    pipeMaterial = "upvc",  // "upvc" | "hdpe" | "stainless" | "cpvc"
    includeValves = true,
    includeFlexConnectors = true,
  } = options;

  const nozzleFixtures = fixtures.filter(f =>
    String(f.type||"").startsWith("nozzle") ||
    String(f.label||"").toLowerCase().includes("jet") ||
    String(f.label||"").toLowerCase().includes("nozzle") ||
    String(f.label||"").toLowerCase().includes("geyser") ||
    String(f.label||"").toLowerCase().includes("fountain")
  );

  if (nozzleFixtures.length === 0) {
    return { branches:[], nodes:[], bom:[], totalBranchLengthM:0, mainHeaderLengthM:0, topology, pumpConnection:null };
  }

  // Build tree or ring
  const edges = topology === "ring" ? buildRingLayout(nozzleFixtures) : buildTreeLayout(nozzleFixtures);

  // Total flow for header sizing
  const totalFlowLpm = nozzleFixtures.reduce((sum, f) => {
    const eng = f.engineering || {};
    return sum + Number(eng.flowLpm || 80);
  }, 0);
  const headerDN = selectPipeDN(totalFlowLpm);

  // Per-fixture branch flow and sizing
  const branches = [];
  let totalBranchLengthM = 0;
  let elbowCount = 0;
  let teeCount = 0;
  let reducerCount = 0;

  edges.forEach((edge, idx) => {
    const fromF = nozzleFixtures.find(f => f.id === edge.from.id);
    const toF   = nozzleFixtures.find(f => f.id === edge.to.id);
    const flowLpm = toF ? Number((toF.engineering||{}).flowLpm || 80) : 80;
    const dn = selectPipeDN(flowLpm);

    // Build orthogonal path
    const pathH = orthogonalPath(edge.from, edge.to, true);
    const pathV = orthogonalPath(edge.from, edge.to, false);
    const path  = pathLength(pathH) <= pathLength(pathV) ? pathH : pathV;
    const len   = pathLength(path);
    const elbows = countElbows(path);

    elbowCount  += elbows;
    teeCount    += (idx > 0 && topology === "tree") ? 1 : 0;
    totalBranchLengthM += len;

    // Reducer if DN changes
    if (idx > 0 && dn !== headerDN) reducerCount++;

    branches.push({
      id: `branch_${idx}`,
      fromId: edge.from.id,
      toId:   edge.to.id,
      path,
      points: path,           // for canvas rendering
      diameterMm: dn,
      dn,
      lengthM: Number(len.toFixed(3)),
      elbows,
      flowLpm,
    });
  });

  // Pump connection line from pool edge to first fixture
  const pumpPoint = getPoolCentroid(geometry);
  const firstFixture = nozzleFixtures[0];
  const pumpPath = orthogonalPath(
    pumpPoint,
    { x: Number(firstFixture.x||0), y: Number(firstFixture.y||0) },
    false
  );
  const pumpLineLength = pathLength(pumpPath);

  // ─── BOM ──────────────────────────────────────────────────────────────────
  const bom = [];

  // Header/main pipe
  if (topology === "tree") {
    const xs = nozzleFixtures.map(f => Number(f.x||0));
    const ys = nozzleFixtures.map(f => Number(f.y||0));
    const mainLen = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
    bom.push({
      key: `pipe_dn${headerDN}_main`,
      label: `Main Header Pipe DN${headerDN} (${pipeMaterial.toUpperCase()})`,
      category: "Pipework",
      unit: "m",
      quantity: Number((mainLen + pumpLineLength).toFixed(2)),
    });
  }

  // Branch pipes grouped by DN
  const branchByDN = {};
  branches.forEach(b => {
    if (!branchByDN[b.dn]) branchByDN[b.dn] = 0;
    branchByDN[b.dn] += b.lengthM;
  });
  Object.entries(branchByDN).forEach(([dn, len]) => {
    bom.push({
      key: `pipe_dn${dn}_branch`,
      label: `Branch Pipe DN${dn} (${pipeMaterial.toUpperCase()})`,
      category: "Pipework",
      unit: "m",
      quantity: Number(len.toFixed(2)),
    });
  });

  // Fittings
  if (elbowCount > 0) {
    bom.push({
      key: `elbow_dn${headerDN}`,
      label: `90° Elbow DN${headerDN}`,
      category: "Fittings",
      unit: "pcs",
      quantity: elbowCount,
    });
  }
  if (teeCount > 0) {
    bom.push({
      key: `tee_dn${headerDN}`,
      label: `Equal Tee DN${headerDN}`,
      category: "Fittings",
      unit: "pcs",
      quantity: teeCount,
    });
  }
  if (reducerCount > 0) {
    bom.push({
      key: `reducer_dn${headerDN}`,
      label: `Reducer DN${headerDN}×DN25`,
      category: "Fittings",
      unit: "pcs",
      quantity: reducerCount,
    });
  }

  // Valves
  if (includeValves) {
    bom.push({
      key: "isolation_valve",
      label: "Isolation Ball Valve",
      category: "Valves",
      unit: "pcs",
      quantity: nozzleFixtures.length,
    });
    bom.push({
      key: "gate_valve_main",
      label: `Gate Valve DN${headerDN} (Main Header)`,
      category: "Valves",
      unit: "pcs",
      quantity: 2,
    });
  }

  // Flex connectors
  if (includeFlexConnectors) {
    bom.push({
      key: "flex_connector",
      label: "Flexible Connector",
      category: "Fittings",
      unit: "pcs",
      quantity: nozzleFixtures.length,
    });
  }

  // Nozzle flanges
  bom.push({
    key: "flange_set",
    label: "Flange Set (PN10)",
    category: "Fittings",
    unit: "set",
    quantity: nozzleFixtures.length,
  });

  // Support clamps
  const totalPipeM = totalBranchLengthM + pumpLineLength;
  bom.push({
    key: "pipe_clamp",
    label: "Pipe Support Clamp",
    category: "Supports",
    unit: "pcs",
    quantity: Math.ceil(totalPipeM / 1.5),
  });

  return {
    branches,
    nodes: nozzleFixtures.map(f => ({ id: f.id, x: Number(f.x||0), y: Number(f.y||0) })),
    bom,
    totalBranchLengthM: Number(totalBranchLengthM.toFixed(2)),
    mainHeaderLengthM:  Number(pumpLineLength.toFixed(2)),
    headerDN,
    topology,
    pumpConnection: { point: pumpPoint, path: pumpPath, lengthM: Number(pumpLineLength.toFixed(2)) },
  };
}
