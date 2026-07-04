"""
dependency_graph.py — AquaFlow Recovery, AQ-X-008

Equipment dependency graph for system visualization.

Turns the designed system data (fixtures + their engineering/addressing) into a
directed dependency graph the UI can draw, and flags dependency conflicts before a
show is commissioned:

  * generated from system data — every fixture becomes a node; edges capture what it
    depends on: its control group, its controller (PLC host for Modbus devices, DMX
    universe for lighting/fog/laser), and any explicit `dependsOn` equipment links,
  * conflicts flagged — duplicate hardware addresses, dangling dependencies, circular
    dependencies, single points of failure (one controller many devices rely on), and
    orphaned equipment,
  * visual-ready — nodes carry a `kind`/`layer` so the frontend can lay them out.

Pure and framework-agnostic (operates on plain fixture dicts) so it is fully
unit-tested; the route wires it to the live show payload, and the frontend renders it.
"""
from __future__ import annotations

from services.fixture_registry_bridge import derive_device_type

# Control class → the controller (infrastructure) kind a device depends on.
_MODBUS_CLASSES = {"pump", "valve", "flame", "sensor"}
_DMX_CLASSES = {"lighting", "fog", "laser"}

# Node layers for visual layout (0 = foundation / controllers, higher = leaves).
LAYER = {"plc": 0, "universe": 0, "group": 1, "fixture": 2}

DEFAULT_SPOF_THRESHOLD = 3      # ≥ this many dependents on one controller → SPOF


def _first(*vals):
    for v in vals:
        if v not in (None, ""):
            return v
    return None


def build_dependency_graph(fixtures: list, spof_threshold: int = DEFAULT_SPOF_THRESHOLD) -> dict:
    """
    Build the equipment dependency graph from designed fixtures.

    Returns {nodes, edges, conflicts, stats}. Each edge is
    {from, to, kind} where kind ∈ member_of | controlled_by | depends_on and means
    "from depends on to".
    """
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    conflicts: list[dict] = []

    def add_node(nid, kind, label, **meta):
        if nid not in nodes:
            nodes[nid] = {"id": nid, "kind": kind, "label": label,
                          "layer": LAYER.get(kind, 2), **meta}
        return nodes[nid]

    def add_edge(src, dst, kind):
        edges.append({"from": src, "to": dst, "kind": kind})

    dmx_addr: dict[tuple, list] = {}     # (universe, channel) -> [fixture ids]
    modbus_addr: dict[tuple, list] = {}  # (host, register) -> [fixture ids]
    fixture_ids: set = set()

    for fx in fixtures or []:
        if not isinstance(fx, dict):
            continue
        fid = fx.get("id") or fx.get("fixtureId")
        if not fid:
            continue
        fid = str(fid)
        fixture_ids.add(fid)
        raw_type = fx.get("type") or fx.get("fixtureType") or ""
        dclass = derive_device_type(raw_type)
        eng = fx.get("engineering") or {}

        add_node(fid, "fixture", str(fx.get("label") or fid),
                 type=str(raw_type) or dclass, device_class=dclass)

        # Control group membership.
        gid = fx.get("groupId") or fx.get("group")
        if gid:
            gnid = f"group:{gid}"
            add_node(gnid, "group", str(gid))
            add_edge(fid, gnid, "member_of")

        # Controller dependency (PLC host or DMX universe).
        if dclass in _MODBUS_CLASSES:
            host = str(_first(fx.get("plcHost"), eng.get("plcHost"), fx.get("ip")) or "PLC-default")
            nid = f"plc:{host}"
            add_node(nid, "plc", host)
            add_edge(fid, nid, "controlled_by")
            reg = _first(fx.get("register"), fx.get("plcRegister"), eng.get("register"))
            if reg is not None:
                modbus_addr.setdefault((host, int(reg)), []).append(fid)
        elif dclass in _DMX_CLASSES:
            uni = _first(fx.get("universe"), fx.get("dmxUniverse"), eng.get("dmxUniverse")) or 1
            nid = f"universe:{uni}"
            add_node(nid, "universe", f"Universe {uni}")
            add_edge(fid, nid, "controlled_by")
            ch = _first(fx.get("channel"), fx.get("dmxChannel"), fx.get("dmxAddress"),
                        eng.get("dmxChannel"))
            if ch is not None:
                dmx_addr.setdefault((int(uni), int(ch)), []).append(fid)

        # Explicit equipment dependencies.
        for dep in (fx.get("dependsOn") or []):
            add_edge(fid, str(dep), "depends_on")

    # ── Conflict detection ────────────────────────────────────────────────────
    # 1. Duplicate hardware addresses.
    for (uni, ch), ids in dmx_addr.items():
        if len(ids) > 1:
            conflicts.append({"type": "address_conflict", "severity": "critical",
                              "message": f"DMX address U{uni} Ch{ch} shared by {', '.join(ids)}",
                              "nodes": list(ids)})
    for (host, reg), ids in modbus_addr.items():
        if len(ids) > 1:
            conflicts.append({"type": "address_conflict", "severity": "critical",
                              "message": f"Modbus {host} register {reg} shared by {', '.join(ids)}",
                              "nodes": list(ids)})

    # 2. Dangling dependencies (depends_on a fixture/equipment that is not a node).
    for e in edges:
        if e["kind"] == "depends_on" and e["to"] not in nodes:
            conflicts.append({"type": "missing_dependency", "severity": "critical",
                              "message": f"'{e['from']}' depends on missing equipment '{e['to']}'",
                              "nodes": [e["from"], e["to"]]})

    # 3. Circular dependencies (over the depends_on edges among known nodes).
    for cyc in _find_cycles(edges, nodes):
        conflicts.append({"type": "cycle", "severity": "critical",
                          "message": "Circular dependency: " + " → ".join(cyc + [cyc[0]]),
                          "nodes": cyc})

    # 4. Single points of failure — one controller many devices depend on.
    dependents: dict[str, list] = {}
    for e in edges:
        if e["kind"] == "controlled_by":
            dependents.setdefault(e["to"], []).append(e["from"])
    for nid, deps in dependents.items():
        if len(deps) >= spof_threshold:
            conflicts.append({"type": "single_point_of_failure", "severity": "warning",
                              "message": f"{nodes[nid]['label']} is a single point of failure "
                                         f"for {len(deps)} devices",
                              "nodes": [nid] + deps})

    # 5. Orphaned fixtures (no group, no controller, no dependency).
    connected = set()
    for e in edges:
        connected.add(e["from"])
        connected.add(e["to"])
    for nid, node in nodes.items():
        if node["kind"] == "fixture" and nid not in connected:
            conflicts.append({"type": "orphan", "severity": "warning",
                              "message": f"'{node['label']}' has no controller or group",
                              "nodes": [nid]})

    stats = {
        "node_count": len(nodes),
        "edge_count": len(edges),
        "fixture_count": sum(1 for n in nodes.values() if n["kind"] == "fixture"),
        "controller_count": sum(1 for n in nodes.values() if n["kind"] in ("plc", "universe")),
        "conflict_count": len(conflicts),
        "critical_conflicts": sum(1 for c in conflicts if c["severity"] == "critical"),
    }
    return {"nodes": list(nodes.values()), "edges": edges,
            "conflicts": conflicts, "stats": stats}


def _find_cycles(edges: list, nodes: dict) -> list[list]:
    """Return one representative node list per cycle in the depends_on subgraph."""
    adj: dict[str, list] = {}
    for e in edges:
        if e["kind"] == "depends_on" and e["to"] in nodes and e["from"] in nodes:
            adj.setdefault(e["from"], []).append(e["to"])

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in nodes}
    cycles: list[list] = []
    seen_signatures: set = set()

    def dfs(u, stack):
        color[u] = GRAY
        stack.append(u)
        for v in adj.get(u, []):
            if color[v] == GRAY:                      # back-edge → cycle
                cyc = stack[stack.index(v):]
                sig = frozenset(cyc)
                if sig not in seen_signatures:
                    seen_signatures.add(sig)
                    cycles.append(list(cyc))
            elif color[v] == WHITE:
                dfs(v, stack)
        stack.pop()
        color[u] = BLACK

    for n in nodes:
        if color[n] == WHITE and n in adj:
            dfs(n, [])
    return cycles
