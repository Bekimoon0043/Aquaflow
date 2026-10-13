"""
cad_topology.py — AquaFlow AF-CAD-015

Pipe topology inference: turn the pipe polylines and recognised components of an
imported CAD drawing into a hydraulic network and a pump → valve → nozzle grouping,
then hand that network to the GGA solver with no manual re-entry.

Pipeline
--------
1. **Vertex clustering.** Every polyline vertex is snapped into a node; vertices
   closer than ``tolerance_m`` (union-find over a spatial hash) share a node.
   Consecutive vertices become links (zero-length links are dropped).
2. **T-junctions.** A polyline *end* that lies on the interior of another pipe's
   segment (within tolerance) splits that segment and joins it there.
3. **Component attachment.** Each candidate (nozzle / valve / pump / …) attaches to
   the nearest node within tolerance, or — failing that — splits the nearest segment
   within tolerance (a riser tee on a manifold). Anything further away is reported
   in ``unattached``.
4. **Grouping.** Multi-source Dijkstra (by pipe length) from every pump assigns each
   node to its nearest pump. Walking a nozzle's shortest-path back towards its pump,
   the first valve met is its valve; nozzles with no valve on that path are
   ``direct_nozzles``. Groups are proposals (``confirmed: false``) the user confirms.
5. **Dangling ends.** Degree-1 nodes with no component attached.
6. **Solver input.** ``solver_input`` is the exact dict ``hydraulic_solver.solve_network``
   accepts (``nodes`` with ``fixed_head`` / ``emitter_k``; ``pipes`` with
   ``from``/``to``/``length``/``diameter``/``roughness``). Interior degree-2 nodes with
   no component are collapsed, so a flattened arc does not become fifty unknowns.

Modelling assumptions (all reported in ``assumptions``)
-------------------------------------------------------
* A pump is a fixed-head source at its discharge node (``head_m`` from its fields,
  else ``DEFAULT_PUMP_HEAD_M``). Pump curves are not modelled here.
* A nozzle is a pressure-dependent emitter ``q = k·p^0.5``. ``k`` comes from the
  nozzle's design flow and pressure (``flow_lpm`` + ``pressure_bar``), or flow and jet
  height (``height_m``, inverting the solver's jet-height relation), else a nominal
  40 L/min @ 1 bar.
* Valves are open, lossless junctions (their K is not known from a drawing).
* Pipe DN (mm) and material come from the pipe record, its attributes, or text such as
  ``"DN50 PVC"``; DN is used as the internal diameter. Defaults: DN50, C = 140.
* Only network components that contain a pump are sent to the solver; the rest are
  listed in ``unsolved_components``.

Coordinates are CAD-frame metres (``docs/CAD-IMPORT-CONTRACT.md``).
"""
from __future__ import annotations

import heapq
import math
import re
from collections import defaultdict
from typing import Optional

from services.hydraulic_solver import GRAVITY, JET_EFFICIENCY

DEFAULT_TOLERANCE_M = 0.05
DEFAULT_DN_MM = 50.0
DEFAULT_ROUGHNESS_C = 140.0
DEFAULT_PUMP_HEAD_M = 20.0
DEFAULT_NOZZLE_FLOW_LPM = 40.0
DEFAULT_NOZZLE_PRESSURE_BAR = 1.0
DEFAULT_DISCHARGE_COEFF = 0.97
BAR_TO_M = 1e5 / (1000.0 * GRAVITY)      # 1 bar of fresh water ≈ 10.19 m

# Hazen-Williams C by pipe material (typical new-pipe values).
MATERIAL_C = {
    "PVC": 150.0, "UPVC": 150.0, "CPVC": 150.0, "ABS": 150.0,
    "PE": 140.0, "HDPE": 140.0, "PEX": 150.0, "PP": 145.0,
    "STAINLESS": 140.0, "SS": 140.0, "COPPER": 135.0, "CU": 135.0,
    "STEEL": 120.0, "GALV": 120.0, "DUCTILE": 130.0, "CAST": 100.0, "CI": 100.0,
}
_DN_RE = re.compile(r"(?:\bDN\s*(\d{1,4}(?:\.\d+)?))|(?:[ØøΦ⌀]\s*(\d{1,4}(?:\.\d+)?))"
                    r"|(?:\b(\d{1,4}(?:\.\d+)?)\s*mm\b)", re.IGNORECASE)

_TYPE_ALIASES = {"nozzle": "nozzle", "jet": "nozzle", "valve": "valve", "pump": "pump"}


# ── Small helpers ─────────────────────────────────────────────────────────────

def _f(v, default=None):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return x if math.isfinite(x) else default


def _xy(p) -> Optional[tuple[float, float]]:
    if isinstance(p, dict):
        x, y = _f(p.get("x")), _f(p.get("y"))
    elif isinstance(p, (list, tuple)) and len(p) >= 2:
        x, y = _f(p[0]), _f(p[1])
    else:
        return None
    return None if x is None or y is None else (x, y)


def _ctype(c: dict) -> str:
    t = str(c.get("type") or "").lower()
    for key, val in _TYPE_ALIASES.items():
        if key in t:
            return val
    return t or "equipment"


def parse_pipe_spec(pipe: dict) -> dict:
    """DN (mm) and material for a pipe from its fields, attributes or text.

    Returns ``{"dn": float|None, "material": str|None, "provenance": {...}}``.
    """
    out = {"dn": None, "material": None, "provenance": {}}
    dn = _f(pipe.get("dn")) or _f(pipe.get("diameterMm")) or _f(pipe.get("diameter_mm"))
    if dn:
        out["dn"], out["provenance"]["dn"] = dn, "pipe field"
    mat = pipe.get("material")
    if mat:
        out["material"], out["provenance"]["material"] = str(mat).upper(), "pipe field"
    attribs = pipe.get("attribs") or {}
    if isinstance(attribs, dict):
        up = {str(k).upper(): v for k, v in attribs.items()}
        if out["dn"] is None:
            for key in ("DN", "SIZE", "DIA", "DIAMETER", "PIPE_SIZE"):
                if key not in up:
                    continue
                v = _f(up[key])
                if v is None:
                    m = _DN_RE.search(str(up[key]))
                    v = _f(next(g for g in m.groups() if g)) if m else None
                if v:
                    out["dn"], out["provenance"]["dn"] = v, f"attribute {key}"
                    break
        if out["material"] is None:
            for key in ("MATERIAL", "MAT", "PIPE_MATERIAL"):
                if up.get(key):
                    out["material"], out["provenance"]["material"] = str(up[key]).upper(), f"attribute {key}"
                    break
    text = " ".join(str(pipe.get(k) or "") for k in ("text", "label", "layer"))
    if out["dn"] is None:
        m = _DN_RE.search(text)
        if m:
            out["dn"] = _f(next(g for g in m.groups() if g))
            out["provenance"]["dn"] = "text"
    if out["material"] is None:
        for token in sorted(MATERIAL_C, key=len, reverse=True):
            if re.search(rf"(?<![A-Z]){token}(?![A-Z])", text.upper()):
                out["material"], out["provenance"]["material"] = token, "text"
                break
    return out


def roughness_for(material: Optional[str]) -> float:
    if not material:
        return DEFAULT_ROUGHNESS_C
    m = str(material).upper()
    for token in sorted(MATERIAL_C, key=len, reverse=True):
        if token in m:
            return MATERIAL_C[token]
    return DEFAULT_ROUGHNESS_C


def nozzle_emitter_k(fields: dict) -> tuple[float, str]:
    """Emitter coefficient k (m³/s per m^0.5) and its basis for a nozzle's fields."""
    fields = fields or {}
    q_lpm = _f(fields.get("flow_lpm"))
    p_bar = _f(fields.get("pressure_bar"))
    h_m = _f(fields.get("height_m"))
    cd = _f(fields.get("discharge_coeff"), DEFAULT_DISCHARGE_COEFF) or DEFAULT_DISCHARGE_COEFF
    if q_lpm and q_lpm > 0:
        if p_bar and p_bar > 0:
            p_m, basis = p_bar * BAR_TO_M, "flow_lpm + pressure_bar"
        elif h_m and h_m > 0:
            # Invert the solver's jet relation h = eff·(Cd·√(2gp))²/2g = eff·Cd²·p.
            p_m, basis = h_m / (JET_EFFICIENCY * cd * cd), "flow_lpm + height_m"
        else:
            p_m, basis = DEFAULT_NOZZLE_PRESSURE_BAR * BAR_TO_M, "flow_lpm @ assumed 1 bar"
        return (q_lpm / 60000.0) / math.sqrt(p_m), basis
    q = DEFAULT_NOZZLE_FLOW_LPM / 60000.0
    return q / math.sqrt(DEFAULT_NOZZLE_PRESSURE_BAR * BAR_TO_M), "assumed 40 L/min @ 1 bar"


# ── Geometry ──────────────────────────────────────────────────────────────────

def _project(p, a, b) -> tuple[float, float, tuple[float, float]]:
    """(t, distance, foot) of point p onto segment a-b."""
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 <= 0:
        return 0.0, math.hypot(p[0] - ax, p[1] - ay), a
    t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2
    t = max(0.0, min(1.0, t))
    foot = (ax + t * dx, ay + t * dy)
    return t, math.hypot(p[0] - foot[0], p[1] - foot[1]), foot


class _Network:
    def __init__(self, tol: float):
        self.tol = tol
        self.coords: list[tuple[float, float]] = []
        # segments: [a, b, pipe_index]
        self.segs: list[list[int]] = []

    def add_node(self, p) -> int:
        self.coords.append((float(p[0]), float(p[1])))
        return len(self.coords) - 1

    def seg_len(self, s) -> float:
        (ax, ay), (bx, by) = self.coords[s[0]], self.coords[s[1]]
        return math.hypot(bx - ax, by - ay)

    def nearest_node(self, p, exclude=()) -> tuple[Optional[int], float]:
        best, bd = None, math.inf
        for i, q in enumerate(self.coords):
            if i in exclude:
                continue
            d = math.hypot(p[0] - q[0], p[1] - q[1])
            if d < bd:
                best, bd = i, d
        return best, bd

    def split_segments(self, requests: dict[int, list[tuple[float, int]]]):
        """Split segments at (t, node) points; requests keyed by segment index."""
        if not requests:
            return
        new = []
        for si, s in enumerate(self.segs):
            if si not in requests:
                new.append(s)
                continue
            chain = [s[0]] + [n for _, n in sorted(requests[si])] + [s[1]]
            for a, b in zip(chain, chain[1:]):
                if a != b:
                    new.append([a, b, s[2]])
        self.segs = new


def _cluster(points: list[tuple[float, float]], tol: float) -> list[int]:
    """Union-find clustering of points within tol via a spatial hash. Returns labels."""
    parent = list(range(len(points)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    cell = max(tol, 1e-9)
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, (x, y) in enumerate(points):
        grid[(math.floor(x / cell), math.floor(y / cell))].append(i)
    for (gx, gy), members in grid.items():
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), ()):
                    for i in members:
                        if i < j and math.hypot(points[i][0] - points[j][0],
                                                points[i][1] - points[j][1]) <= tol:
                            ri, rj = find(i), find(j)
                            if ri != rj:
                                parent[ri] = rj
    return [find(i) for i in range(len(points))]


# ── Main entry point ──────────────────────────────────────────────────────────

def infer_topology(pipes: list, candidates: list, tolerance_m: float = DEFAULT_TOLERANCE_M,
                   *, pump_head_m: Optional[float] = None) -> dict:
    """Infer the pipe network, component groups and solver input (see module doc)."""
    tol = _f(tolerance_m, DEFAULT_TOLERANCE_M)
    if tol is None or tol <= 0:
        tol = DEFAULT_TOLERANCE_M
    warnings: list[str] = []
    assumptions: list[str] = []

    # ── 1. Pipes → raw vertices → clustered nodes ────────────────────────────
    pipe_recs = []
    raw_pts: list[tuple[float, float]] = []
    raw_runs: list[tuple[int, list[int]]] = []          # (pipe_idx, raw vertex indices)
    for pi, p in enumerate(pipes or []):
        if not isinstance(p, dict):
            continue
        pts = [q for q in (_xy(v) for v in (p.get("points") or [])) if q is not None]
        if len(pts) < 2:
            warnings.append(f"Pipe {p.get('source_handle') or pi} has fewer than 2 points — skipped.")
            continue
        if p.get("closed") and pts[0] != pts[-1]:
            pts = pts + [pts[0]]
        spec = parse_pipe_spec(p)
        rec = {"index": len(pipe_recs), "source_handle": p.get("source_handle") or p.get("handle"),
               "id": p.get("id"), "layer": p.get("layer"), **spec}
        pipe_recs.append(rec)
        idxs = []
        for q in pts:
            raw_pts.append(q)
            idxs.append(len(raw_pts) - 1)
        raw_runs.append((rec["index"], idxs))

    net = _Network(tol)
    labels = _cluster(raw_pts, tol)
    label_to_node: dict[int, int] = {}
    members: dict[int, list[int]] = defaultdict(list)
    for i, lab in enumerate(labels):
        members[lab].append(i)
    for lab, mem in members.items():
        cx = sum(raw_pts[i][0] for i in mem) / len(mem)
        cy = sum(raw_pts[i][1] for i in mem) / len(mem)
        label_to_node[lab] = net.add_node((cx, cy))
    endpoints: set[int] = set()
    for pidx, idxs in raw_runs:
        nodes = [label_to_node[labels[i]] for i in idxs]
        endpoints.add(nodes[0]); endpoints.add(nodes[-1])
        for a, b in zip(nodes, nodes[1:]):
            if a != b:
                net.segs.append([a, b, pidx])

    # ── 2. T-junctions: pipe ends lying on another segment's interior ────────
    requests: dict[int, list[tuple[float, int]]] = defaultdict(list)
    for n in sorted(endpoints):
        p = net.coords[n]
        for si, s in enumerate(net.segs):
            if n in (s[0], s[1]):
                continue
            t, d, _ = _project(p, net.coords[s[0]], net.coords[s[1]])
            seg_len = net.seg_len(s)
            if d <= tol and seg_len > 0 and tol / seg_len < t < 1 - tol / seg_len:
                requests[si].append((t, n))
                break
    net.split_segments(requests)

    # ── 3. Attach candidates ─────────────────────────────────────────────────
    attachments: dict[int, list[dict]] = defaultdict(list)
    attached, unattached = {}, []
    cand_list = [c for c in (candidates or []) if isinstance(c, dict)]
    pending_splits: dict[int, list[tuple[float, int]]] = defaultdict(list)
    for ci, c in enumerate(cand_list):
        cid = str(c.get("id") or f"cand_{ci}")
        pos = _xy(c.get("position"))
        if pos is None:
            unattached.append({"id": cid, "reason": "no position"})
            continue
        node, dist = net.nearest_node(pos)
        if node is not None and dist <= tol:
            attached[cid] = node
        else:
            best = None
            for si, s in enumerate(net.segs):
                t, d, foot = _project(pos, net.coords[s[0]], net.coords[s[1]])
                if d <= tol and (best is None or d < best[1]):
                    best = (si, d, t, foot)
            if best is None:
                unattached.append({"id": cid, "type": _ctype(c), "position": list(pos),
                                   "distance_m": None if node is None else round(dist, 4),
                                   "reason": f"no pipe within {tol} m"})
                continue
            si, d, t, foot = best
            # Several components on one segment: reuse a split node when it is close.
            existing = next((n for tt, n in pending_splits[si]
                             if math.hypot(net.coords[n][0] - foot[0],
                                           net.coords[n][1] - foot[1]) <= tol), None)
            if existing is None:
                existing = net.add_node(foot)
                pending_splits[si].append((t, existing))
            attached[cid] = existing
        attachments[attached[cid]].append({"id": cid, "type": _ctype(c), "candidate": c})
    net.split_segments(pending_splits)

    # ── Adjacency ────────────────────────────────────────────────────────────
    used_nodes = sorted({n for s in net.segs for n in s[:2]} | set(attached.values()))
    node_name = {n: f"n{i}" for i, n in enumerate(used_nodes)}
    adj: dict[int, list[tuple[int, float, int]]] = defaultdict(list)
    for li, s in enumerate(net.segs):
        L = net.seg_len(s)
        adj[s[0]].append((s[1], L, li))
        adj[s[1]].append((s[0], L, li))

    # Connected components.
    comp_of: dict[int, int] = {}
    n_comps = 0
    for start in used_nodes:
        if start in comp_of:
            continue
        cid, n_comps = n_comps, n_comps + 1
        stack = [start]
        comp_of[start] = cid
        while stack:
            u = stack.pop()
            for v, _, _ in adj[u]:
                if v not in comp_of:
                    comp_of[v] = cid
                    stack.append(v)

    def nodes_of(kind):
        return [(a["id"], n) for n, lst in attachments.items() for a in lst if a["type"] == kind]

    pumps, valves, nozzles = nodes_of("pump"), nodes_of("valve"), nodes_of("nozzle")
    valve_at = defaultdict(list)
    for vid, n in valves:
        valve_at[n].append(vid)

    # ── 4. Grouping: multi-source Dijkstra from pumps ────────────────────────
    dist: dict[int, float] = {}
    owner: dict[int, str] = {}
    parent: dict[int, Optional[int]] = {}
    heap = []
    for pid, n in pumps:
        if n not in dist:
            dist[n], owner[n], parent[n] = 0.0, pid, None
            heapq.heappush(heap, (0.0, n))
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        for v, L, _ in adj[u]:
            nd = d + L
            if nd < dist.get(v, math.inf) - 1e-12:
                dist[v], owner[v], parent[v] = nd, owner[u], u
                heapq.heappush(heap, (nd, v))

    groups_by_pump: dict[Optional[str], dict] = {}

    def group_for(pump_id):
        if pump_id not in groups_by_pump:
            groups_by_pump[pump_id] = {"pump": pump_id, "valves": [], "nozzles": [],
                                       "valve_nozzles": {}, "direct_nozzles": [],
                                       "confirmed": False}
        return groups_by_pump[pump_id]

    for pid, _ in pumps:
        group_for(pid)
    for vid, n in valves:
        g = group_for(owner.get(n))
        if vid not in g["valves"]:
            g["valves"].append(vid)
            g["valve_nozzles"].setdefault(vid, [])
    for nid, n in nozzles:
        g = group_for(owner.get(n))
        g["nozzles"].append(nid)
        valve = None
        u = n
        while u is not None:
            if valve_at.get(u):
                valve = valve_at[u][0]
                break
            u = parent.get(u)
        if valve is None:
            g["direct_nozzles"].append(nid)
        else:
            g["valve_nozzles"].setdefault(valve, []).append(nid)
            if valve not in g["valves"]:
                g["valves"].append(valve)
    groups = sorted(groups_by_pump.values(), key=lambda g: (g["pump"] is None, str(g["pump"])))

    # ── 5. Dangling ends ─────────────────────────────────────────────────────
    degree = defaultdict(int)
    for s in net.segs:
        degree[s[0]] += 1
        degree[s[1]] += 1
    dangling = [[round(net.coords[n][0], 6), round(net.coords[n][1], 6)]
                for n in used_nodes if degree[n] == 1 and not attachments.get(n)]

    # ── Output nodes / links ─────────────────────────────────────────────────
    out_nodes = []
    for n in used_nodes:
        out_nodes.append({
            "id": node_name[n], "position": [round(net.coords[n][0], 6), round(net.coords[n][1], 6)],
            "degree": degree[n], "component": comp_of.get(n),
            "attachments": [{"id": a["id"], "type": a["type"]} for a in attachments.get(n, [])],
            "pump": owner.get(n),
        })
    out_links = []
    for li, s in enumerate(net.segs):
        rec = pipe_recs[s[2]]
        out_links.append({
            "id": f"l{li}", "from": node_name[s[0]], "to": node_name[s[1]],
            "length_m": round(net.seg_len(s), 6), "pipe_index": s[2],
            "source_handle": rec["source_handle"], "dn": rec["dn"], "material": rec["material"],
        })

    solver_input, solver_notes, unsolved = _build_solver_input(
        net, used_nodes, node_name, attachments, comp_of, pipe_recs, degree,
        dist, pump_head_m)
    assumptions.extend(solver_notes)
    if not pumps:
        warnings.append("No pump attached to the network — the solver needs a pump (fixed-head source).")

    return {
        "tolerance_m": tol,
        "nodes": out_nodes,
        "links": out_links,
        "groups": groups,
        "dangling": dangling,
        "attached": {cid: node_name[n] for cid, n in attached.items()},
        "unattached": unattached,
        "pipes": [{k: v for k, v in r.items()} for r in pipe_recs],
        "stats": {"nodes": len(out_nodes), "links": len(out_links),
                  "components": len(set(comp_of.values())),
                  "pumps": len(pumps), "valves": len(valves), "nozzles": len(nozzles),
                  "dangling": len(dangling)},
        "solver_input": solver_input,
        "unsolved_components": unsolved,
        "assumptions": assumptions,
        "warnings": warnings,
    }


def _build_solver_input(net, used_nodes, node_name, attachments, comp_of, pipe_recs,
                        degree, dist, pump_head_m):
    """Build the ``solve_network`` payload; collapse plain degree-2 chain nodes."""
    notes: list[str] = []
    pump_comps = {comp_of[n] for n, lst in attachments.items()
                  for a in lst if a["type"] == "pump" and n in comp_of}
    all_comps = set(comp_of.values())
    unsolved = sorted(all_comps - pump_comps)
    if not pump_comps:
        return None, ["No pump-fed network component — solver_input not built."], unsolved

    def pipe_props(pidx):
        rec = pipe_recs[pidx]
        dn = rec["dn"] or DEFAULT_DN_MM
        return dn / 1000.0, roughness_for(rec["material"])

    if any(rec["dn"] is None for rec in pipe_recs):
        notes.append(f"Pipes without a DN were sized DN{DEFAULT_DN_MM:g}.")
    if any(rec["material"] is None for rec in pipe_recs):
        notes.append(f"Pipes without a material use Hazen-Williams C={DEFAULT_ROUGHNESS_C:g}.")
    notes.append("Valves are modelled as open, lossless junctions.")

    keep = set()
    for n in used_nodes:
        if comp_of.get(n) not in pump_comps:
            continue
        if attachments.get(n) or degree[n] != 2:
            keep.add(n)
    # Walk chains between kept nodes, merging segments with identical properties.
    adj = defaultdict(list)
    for li, s in enumerate(net.segs):
        if comp_of.get(s[0]) in pump_comps:
            adj[s[0]].append((s[1], li))
            adj[s[1]].append((s[0], li))
    seen_links: set[int] = set()
    solver_pipes = []

    def emit(a, b, length, pidx, ids):
        d, c = pipe_props(pidx)
        # Orient away from the pump (shorter Dijkstra distance first).
        if dist.get(b, math.inf) < dist.get(a, math.inf):
            a, b = b, a
        solver_pipes.append({"id": f"p{len(solver_pipes)}", "from": node_name[a], "to": node_name[b],
                             "length": round(max(length, 1e-3), 6), "diameter": d, "roughness": c,
                             "minor_loss": 0.0, "links": [f"l{i}" for i in ids]})

    for start in sorted(keep):
        for v0, li0 in adj[start]:
            if li0 in seen_links:
                continue
            pidx = net.segs[li0][2]
            props = pipe_props(pidx)
            length, ids = 0.0, []
            u, v, li = start, v0, li0
            while True:
                seen_links.add(li)
                length += net.seg_len(net.segs[li])
                ids.append(li)
                if v in keep:
                    break
                nxt = [(w, lj) for w, lj in adj[v] if lj != li and lj not in seen_links]
                if not nxt:
                    break
                w, lj = nxt[0]
                if pipe_props(net.segs[lj][2]) != props:
                    keep.add(v)          # property change: v becomes a real junction
                    break
                u, v, li = v, w, lj
            keep.add(v)
            emit(start, v, length, pidx, ids)
    # Loops made only of degree-2 nodes (no kept node) are skipped: they carry no flow.

    nodes_payload = []
    referenced = {p["from"] for p in solver_pipes} | {p["to"] for p in solver_pipes}
    by_name = {node_name[n]: n for n in keep}
    nozzle_basis = set()
    for name in sorted(referenced, key=lambda s: int(s[1:])):
        n = by_name[name]
        entry = {"id": name, "elevation": 0.0, "demand": 0.0}
        comps = attachments.get(n, [])
        zs = [_f((a["candidate"] or {}).get("z"), 0.0) or 0.0 for a in comps]
        pump = next((a for a in comps if a["type"] == "pump"), None)
        nozzle = next((a for a in comps if a["type"] == "nozzle"), None)
        if pump is not None:
            fields = pump["candidate"].get("fields") or {}
            head = (_f(fields.get("head_m")) or _f(fields.get("pump_head_m"))
                    or _f(fields.get("tdh_m")) or pump_head_m or DEFAULT_PUMP_HEAD_M)
            if not (_f(fields.get("head_m")) or _f(fields.get("pump_head_m")) or _f(fields.get("tdh_m"))):
                notes.append(f"Pump {pump['id']} head not in drawing — using {head:g} m.")
            entry["fixed_head"] = float(head) + (zs[0] if zs else 0.0)
            entry["elevation"] = zs[0] if zs else 0.0
        elif nozzle is not None:
            k, basis = nozzle_emitter_k(nozzle["candidate"].get("fields") or {})
            entry["emitter_k"] = k
            entry["emitter_exponent"] = 0.5
            entry["discharge_coeff"] = _f((nozzle["candidate"].get("fields") or {}).get(
                "discharge_coeff"), DEFAULT_DISCHARGE_COEFF) or DEFAULT_DISCHARGE_COEFF
            entry["elevation"] = _f(nozzle["candidate"].get("z"), 0.0) or 0.0
            nozzle_basis.add(basis)
        nodes_payload.append(entry)
    for basis in sorted(nozzle_basis):
        notes.append(f"Nozzle emitter k from: {basis}.")
    payload = {"method": "hazen-williams", "nodes": nodes_payload, "pipes": solver_pipes}
    return payload, notes, unsolved


def solve_topology(topology: dict) -> Optional[dict]:
    """Run ``topology['solver_input']`` through the GGA solver (no re-entry)."""
    payload = (topology or {}).get("solver_input")
    if not payload:
        return None
    from services.hydraulic_solver import solve_network
    return solve_network(payload)
