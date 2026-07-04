"""
Contract tests for the Equipment Dependency Graph (AQ-X-008).

Asserts the acceptance criteria:
  1. a graph is generated from system data (fixture/group/controller nodes + edges),
  2. dependency conflicts are flagged (address clash, missing dep, cycle, SPOF, orphan),
     while a clean/valid system produces none.
"""
from services.dependency_graph import build_dependency_graph


def _types(g):
    return {c["type"] for c in g["conflicts"]}


# ── 1. generation ─────────────────────────────────────────────────────────────

def test_graph_generated_from_fixtures():
    g = build_dependency_graph([
        {"id": "jet-1", "type": "center_jets", "groupId": "jets", "engineering": {"plcHost": "10.0.0.5"}},
        {"id": "rgb-1", "type": "light_rgb", "groupId": "lights", "universe": 1, "channel": 1},
    ])
    ids = {n["id"] for n in g["nodes"]}
    assert {"jet-1", "rgb-1", "group:jets", "group:lights", "plc:10.0.0.5", "universe:1"} <= ids
    assert g["stats"]["fixture_count"] == 2
    assert g["stats"]["controller_count"] == 2
    assert any(e["from"] == "jet-1" and e["to"] == "plc:10.0.0.5" and e["kind"] == "controlled_by"
               for e in g["edges"])
    assert any(e["from"] == "rgb-1" and e["to"] == "group:lights" and e["kind"] == "member_of"
               for e in g["edges"])


def test_nodes_have_layers_for_layout():
    g = build_dependency_graph([{"id": "j", "type": "center_jets", "groupId": "g",
                                 "engineering": {"plcHost": "h"}}])
    by_kind = {n["kind"]: n["layer"] for n in g["nodes"]}
    assert by_kind["plc"] == 0 and by_kind["group"] == 1 and by_kind["fixture"] == 2


def test_clean_design_has_no_conflicts():
    g = build_dependency_graph([
        {"id": "rgb-1", "type": "light_rgb", "universe": 1, "channel": 1},
        {"id": "rgb-2", "type": "light_rgb", "universe": 1, "channel": 5},
    ])
    assert g["conflicts"] == []


def test_empty_input_is_safe():
    g = build_dependency_graph([])
    assert g["nodes"] == [] and g["edges"] == [] and g["conflicts"] == []


# ── 2. conflicts ──────────────────────────────────────────────────────────────

def test_duplicate_dmx_address_flagged():
    g = build_dependency_graph([
        {"id": "a", "type": "light_rgb", "universe": 1, "channel": 1},
        {"id": "b", "type": "light_rgb", "universe": 1, "channel": 1},
    ])
    assert "address_conflict" in _types(g)
    c = next(c for c in g["conflicts"] if c["type"] == "address_conflict")
    assert set(c["nodes"]) == {"a", "b"} and c["severity"] == "critical"


def test_duplicate_modbus_register_flagged():
    g = build_dependency_graph([
        {"id": "p1", "type": "pump", "engineering": {"plcHost": "h"}, "register": 10},
        {"id": "p2", "type": "pump", "engineering": {"plcHost": "h"}, "register": 10},
    ])
    assert "address_conflict" in _types(g)


def test_missing_dependency_flagged():
    g = build_dependency_graph([{"id": "p2", "type": "pump", "dependsOn": ["ghost"]}])
    assert "missing_dependency" in _types(g)


def test_circular_dependency_flagged():
    g = build_dependency_graph([
        {"id": "a", "type": "pump", "dependsOn": ["b"]},
        {"id": "b", "type": "pump", "dependsOn": ["c"]},
        {"id": "c", "type": "pump", "dependsOn": ["a"]},
    ])
    assert "cycle" in _types(g)
    cyc = next(c for c in g["conflicts"] if c["type"] == "cycle")
    assert set(cyc["nodes"]) == {"a", "b", "c"}


def test_no_false_cycle_on_dag():
    g = build_dependency_graph([
        {"id": "a", "type": "pump", "dependsOn": ["b", "c"]},
        {"id": "b", "type": "pump", "dependsOn": ["c"]},
        {"id": "c", "type": "pump"},
    ])
    assert "cycle" not in _types(g)


def test_single_point_of_failure_flagged():
    g = build_dependency_graph([
        {"id": f"j{i}", "type": "center_jets", "engineering": {"plcHost": "shared"}}
        for i in range(3)
    ])
    assert "single_point_of_failure" in _types(g)
    spof = next(c for c in g["conflicts"] if c["type"] == "single_point_of_failure")
    assert spof["severity"] == "warning" and "plc:shared" in spof["nodes"]


def test_spof_threshold_respected():
    # 2 devices on one host with threshold 3 → no SPOF
    g = build_dependency_graph([
        {"id": "j1", "type": "center_jets", "engineering": {"plcHost": "h"}},
        {"id": "j2", "type": "center_jets", "engineering": {"plcHost": "h"}},
    ], spof_threshold=3)
    assert "single_point_of_failure" not in _types(g)


def test_orphan_flagged():
    g = build_dependency_graph([{"id": "widget", "type": "totally_unknown"}])
    assert "orphan" in _types(g)


def test_valid_dependency_chain_has_no_conflicts():
    g = build_dependency_graph([
        {"id": "main", "type": "pump", "engineering": {"plcHost": "10.0.0.1"}},
        {"id": "boost", "type": "pump", "engineering": {"plcHost": "10.0.0.2"}, "dependsOn": ["main"]},
        {"id": "jet", "type": "center_jets", "groupId": "jets", "engineering": {"plcHost": "10.0.0.2"},
         "dependsOn": ["boost"]},
    ])
    assert g["conflicts"] == []
    assert sum(1 for e in g["edges"] if e["kind"] == "depends_on") == 2
