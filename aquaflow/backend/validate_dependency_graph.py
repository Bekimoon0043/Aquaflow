"""
validate_dependency_graph.py — AQ-X-008 verification

Hand-checked scenarios for the equipment dependency graph:
  1. a graph is generated from system data (fixture/group/controller nodes + edges),
  2. dependency conflicts are flagged (address clash, missing dep, cycle, SPOF, orphan),
  3. a clean system produces no conflicts.

Run:  python backend/validate_dependency_graph.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.dependency_graph import build_dependency_graph

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def conflict_types(g):
    return {c["type"] for c in g["conflicts"]}


print("== 1. graph generated from system data ==")
fixtures = [
    {"id": "jet-1", "type": "center_jets", "groupId": "jets", "engineering": {"plcHost": "10.0.0.5"}},
    {"id": "jet-2", "type": "nozzle_geyser", "groupId": "jets", "engineering": {"plcHost": "10.0.0.5"}},
    {"id": "rgb-1", "type": "light_rgb", "groupId": "lights", "universe": 1, "channel": 1},
    {"id": "rgb-2", "type": "light_rgb", "groupId": "lights", "universe": 1, "channel": 5},
]
g = build_dependency_graph(fixtures)
kinds = {n["kind"] for n in g["nodes"]}
check("fixture nodes created", g["stats"]["fixture_count"] == 4)
check("group nodes created", "group" in kinds and any(n["id"] == "group:jets" for n in g["nodes"]))
check("plc controller node created", any(n["id"] == "plc:10.0.0.5" for n in g["nodes"]))
check("universe controller node created", any(n["id"] == "universe:1" for n in g["nodes"]))
check("member_of edges present", any(e["kind"] == "member_of" for e in g["edges"]))
check("controlled_by edges present", any(e["kind"] == "controlled_by" for e in g["edges"]))
check("jet-1 depends on its PLC host",
      any(e["from"] == "jet-1" and e["to"] == "plc:10.0.0.5" for e in g["edges"]))
check("nodes carry a layer for layout", all("layer" in n for n in g["nodes"]))
check("clean design has no conflicts", g["conflicts"] == [], str(conflict_types(g)))

print("== 2. dependency conflicts flagged ==")
# Address conflict: two RGB fixtures on the same universe+channel.
clash = build_dependency_graph([
    {"id": "a", "type": "light_rgb", "universe": 1, "channel": 1},
    {"id": "b", "type": "light_rgb", "universe": 1, "channel": 1},
])
check("duplicate DMX address flagged", "address_conflict" in conflict_types(clash),
      str(clash["conflicts"]))

# Missing dependency.
miss = build_dependency_graph([{"id": "pump-2", "type": "center_jets", "dependsOn": ["pump-main"]}])
check("missing dependency flagged", "missing_dependency" in conflict_types(miss))

# Circular dependency: a → b → a.
cyc = build_dependency_graph([
    {"id": "a", "type": "center_jets", "dependsOn": ["b"]},
    {"id": "b", "type": "center_jets", "dependsOn": ["a"]},
])
check("circular dependency flagged", "cycle" in conflict_types(cyc), str(cyc["conflicts"]))

# Single point of failure: 4 jets on one PLC host (threshold 3).
spof = build_dependency_graph([
    {"id": f"j{i}", "type": "center_jets", "engineering": {"plcHost": "10.0.0.9"}}
    for i in range(4)
])
check("single point of failure flagged", "single_point_of_failure" in conflict_types(spof))
check("SPOF is a warning, not critical",
      all(c["severity"] == "warning" for c in spof["conflicts"] if c["type"] == "single_point_of_failure"))

# Orphan: an aux device with no group, controller, or dependency.
orph = build_dependency_graph([{"id": "mystery", "type": "unknown_widget"}])
check("orphan equipment flagged", "orphan" in conflict_types(orph))

print("== 3. mixed valid dependency chain (no false positives) ==")
chain = build_dependency_graph([
    {"id": "main-pump", "type": "pump", "engineering": {"plcHost": "10.0.0.1"}},
    {"id": "booster", "type": "pump", "engineering": {"plcHost": "10.0.0.2"}, "dependsOn": ["main-pump"]},
    {"id": "jet", "type": "center_jets", "groupId": "jets", "engineering": {"plcHost": "10.0.0.2"},
     "dependsOn": ["booster"]},
])
check("valid dependency chain has no conflicts", chain["conflicts"] == [], str(chain["conflicts"]))
check("depends_on edges recorded",
      sum(1 for e in chain["edges"] if e["kind"] == "depends_on") == 2)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
