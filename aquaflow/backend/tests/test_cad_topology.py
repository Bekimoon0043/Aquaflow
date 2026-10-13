"""
Tests for pipe topology inference (AF-CAD-015).

  1. polylines connect by endpoint/vertex tolerance and T-junctions; dangling ends
     are reported,
  2. nozzles are grouped to valves and pumps (as unconfirmed proposals),
  3. the produced solver_input runs through the GGA solver unchanged,
  4. pipe DN and material are read from fields, attributes or text.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.cad_topology import (
    infer_topology, parse_pipe_spec, nozzle_emitter_k, roughness_for, solve_topology,
    BAR_TO_M, DEFAULT_DN_MM,
)
from services.hydraulic_solver import solve_network, JET_EFFICIENCY

# Pump at the origin feeds a DN80 main along +X. Two DN40 risers branch off it:
#   riser A starts 2 cm off the main's vertex at x=5 (endpoint tolerance),
#   riser B tees into the main mid-segment at x=8 (T-junction, no vertex there).
# Valve V1 sits on riser A, valve V2 on riser B; a third nozzle sits on the main.
PIPES = [
    {"source_handle": "MAIN", "points": [[0, 0], [5, 0], [10, 0]], "dn": 80, "material": "PVC"},
    {"source_handle": "RA", "points": [[5, 0.02], [5, 4]], "attribs": {"SIZE": "DN40"}},
    {"source_handle": "RB", "points": [[8, 0.01], [8, 4]], "text": "DN40 HDPE"},
    {"source_handle": "STUB", "points": [[10, 0], [12, 0]]},           # dangling end at x=12
    {"source_handle": "ORPHAN", "points": [[30, 30], [31, 30]]},       # separate component
]
CANDIDATES = [
    {"id": "pump", "type": "pump", "position": [0, 0], "fields": {"head_m": 25}},
    {"id": "v1", "type": "valve", "position": [5, 1]},
    {"id": "v2", "type": "valve", "position": [8, 1.03]},
    {"id": "nA", "type": "nozzle", "position": [5, 4], "z": 0.1,
     "fields": {"flow_lpm": 60, "height_m": 3}},
    {"id": "nB", "type": "nozzle", "position": [8, 4], "fields": {"flow_lpm": 60, "pressure_bar": 0.5}},
    {"id": "nM", "type": "nozzle", "position": [2.5, 0.01]},
    {"id": "far", "type": "nozzle", "position": [50, 50]},
]


@pytest.fixture(scope="module")
def topo():
    return infer_topology(PIPES, CANDIDATES, 0.05)


def _node_at(topo, x, y, tol=1e-6):
    return next(n for n in topo["nodes"]
                if abs(n["position"][0] - x) < tol and abs(n["position"][1] - y) < tol)


# ── 1. connectivity ───────────────────────────────────────────────────────────

def test_endpoint_tolerance_joins_riser_to_main(topo):
    # Riser A's start (5, 0.02) and the main's vertex (5, 0) are one node.
    node = next(n for n in topo["nodes"] if abs(n["position"][0] - 5) < 1e-6
                and abs(n["position"][1]) < 0.05)
    assert node["degree"] == 3


def test_t_junction_splits_main(topo):
    node = next(n for n in topo["nodes"] if abs(n["position"][0] - 8) < 0.02
                and abs(n["position"][1]) < 0.05)
    assert node["degree"] == 3                     # main-left, main-right, riser B


def test_dangling_ends_reported(topo):
    dangling = {tuple(p) for p in topo["dangling"]}
    assert (12.0, 0.0) in dangling
    assert (30.0, 30.0) in dangling and (31.0, 30.0) in dangling
    # Ends with a component attached are not dangling.
    assert (5.0, 4.0) not in dangling and (0.0, 0.0) not in dangling


def test_components_and_unattached(topo):
    assert topo["stats"]["components"] == 2
    assert [u["id"] for u in topo["unattached"]] == ["far"]
    assert len(topo["unsolved_components"]) == 1   # the orphan has no pump


def test_candidate_on_segment_interior_attaches_by_split(topo):
    # nM is 1 cm off the main mid-segment — it gets its own tee node.
    node = topo["attached"]["nM"]
    entry = next(n for n in topo["nodes"] if n["id"] == node)
    assert abs(entry["position"][0] - 2.5) < 1e-3 and entry["degree"] == 2


# ── 2. grouping ───────────────────────────────────────────────────────────────

def test_pump_valve_nozzle_groups(topo):
    assert len(topo["groups"]) == 1
    g = topo["groups"][0]
    assert g["pump"] == "pump" and g["confirmed"] is False
    assert sorted(g["valves"]) == ["v1", "v2"]
    assert sorted(g["nozzles"]) == ["nA", "nB", "nM"]
    assert g["valve_nozzles"] == {"v1": ["nA"], "v2": ["nB"]}
    assert g["direct_nozzles"] == ["nM"]


def test_two_pumps_split_the_network():
    pipes = [{"points": [[0, 0], [10, 0]]}, {"points": [[2, 0], [2, 3]]}, {"points": [[9, 0], [9, 3]]}]
    cands = [{"id": "P1", "type": "pump", "position": [0, 0]},
             {"id": "P2", "type": "pump", "position": [10, 0]},
             {"id": "N1", "type": "nozzle", "position": [2, 3]},
             {"id": "N2", "type": "nozzle", "position": [9, 3]}]
    t = infer_topology(pipes, cands, 0.05)
    by_pump = {g["pump"]: g["nozzles"] for g in t["groups"]}
    assert by_pump == {"P1": ["N1"], "P2": ["N2"]}


def test_nozzles_without_pump_grouped_under_none():
    t = infer_topology([{"points": [[0, 0], [1, 0]]}],
                       [{"id": "N", "type": "nozzle", "position": [1, 0]}], 0.05)
    assert t["groups"] == [{"pump": None, "valves": [], "nozzles": ["N"], "valve_nozzles": {},
                            "direct_nozzles": ["N"], "confirmed": False}]
    assert t["solver_input"] is None
    assert any("pump" in w.lower() for w in t["warnings"])


# ── 3. solver input runs unchanged ────────────────────────────────────────────

def test_solver_input_solves(topo):
    payload = topo["solver_input"]
    assert payload["method"] == "hazen-williams"
    res = solve_network(payload)
    assert res["converged"]
    assert res["residuals"]["max_continuity"] < 1e-6
    nozzles = [n for n in res["nodes"] if n.get("is_nozzle")]
    assert len(nozzles) == 3
    assert all(n["nozzle_flow_lpm"] > 0 for n in nozzles)
    # Mass balance: everything the pump pushes leaves through the three nozzles.
    pump_node = topo["attached"]["pump"]
    out = sum(p["flow_m3s"] for p in res["pipes"]
              if next(sp for sp in payload["pipes"] if sp["id"] == p["id"])["from"] == pump_node)
    assert out == pytest.approx(sum(n["nozzle_flow_m3s"] for n in nozzles), rel=1e-4)


def test_solve_topology_helper(topo):
    assert solve_topology(topo)["converged"]


def test_solver_input_shape(topo):
    payload = topo["solver_input"]
    fixed = [n for n in payload["nodes"] if n.get("fixed_head") is not None]
    assert len(fixed) == 1 and fixed[0]["fixed_head"] == 25.0
    emitters = {n["id"] for n in payload["nodes"] if n.get("emitter_k")}
    assert emitters == {topo["attached"][k] for k in ("nA", "nB", "nM")}
    ids = {n["id"] for n in payload["nodes"]}
    for p in payload["pipes"]:
        assert p["from"] in ids and p["to"] in ids and p["length"] > 0
    # Orphan component is not in the solver payload.
    assert all(abs(n["position"][0] - 30) > 1 for n in topo["nodes"] if n["id"] in ids)
    # DN from attribute/text → 40 mm risers; DN80 PVC main → C=150.
    diams = {round(p["diameter"], 3) for p in payload["pipes"]}
    assert {0.08, 0.04} <= diams
    assert any(p["roughness"] == 150.0 and p["diameter"] == 0.08 for p in payload["pipes"])


def test_degree_two_chains_are_collapsed():
    # A flattened arc: 50 vertices between pump and nozzle → one solver pipe.
    import math
    pts = [[math.cos(i * math.pi / 98) * 5, math.sin(i * math.pi / 98) * 5] for i in range(50)]
    t = infer_topology([{"points": pts, "dn": 50}],
                       [{"id": "P", "type": "pump", "position": pts[0]},
                        {"id": "N", "type": "nozzle", "position": pts[-1]}], 0.01)
    assert len(t["links"]) == 49
    assert len(t["solver_input"]["pipes"]) == 1
    assert t["solver_input"]["pipes"][0]["length"] == pytest.approx(
        sum(l["length_m"] for l in t["links"]), rel=1e-5)
    assert solve_network(t["solver_input"])["converged"]


def test_emitter_k_from_height_matches_solver_jet_model():
    k, basis = nozzle_emitter_k({"flow_lpm": 60, "height_m": 3})
    p = 3 / (JET_EFFICIENCY * 0.97 ** 2)
    assert basis == "flow_lpm + height_m"
    assert k == pytest.approx((60 / 60000) / p ** 0.5)
    k2, _ = nozzle_emitter_k({"flow_lpm": 60, "pressure_bar": 1})
    assert k2 == pytest.approx((60 / 60000) / BAR_TO_M ** 0.5)
    assert nozzle_emitter_k({})[1].startswith("assumed")


# ── 4. DN and material ────────────────────────────────────────────────────────

@pytest.mark.parametrize("pipe,dn,mat", [
    ({"dn": 63, "material": "pe"}, 63, "PE"),
    ({"attribs": {"DN": "50", "MATERIAL": "pvc"}}, 50, "PVC"),
    ({"attribs": {"size": "Ø75"}}, 75, None),
    ({"text": "DN100 STAINLESS"}, 100, "STAINLESS"),
    ({"label": "110 mm HDPE"}, 110, "HDPE"),
    ({"layer": "PIPE-DN32-PVC"}, 32, "PVC"),
    ({}, None, None),
])
def test_parse_pipe_spec(pipe, dn, mat):
    spec = parse_pipe_spec(pipe)
    assert spec["dn"] == dn and spec["material"] == mat


def test_roughness_lookup():
    assert roughness_for("PVC") == 150.0
    assert roughness_for("HDPE PN10") == 140.0
    assert roughness_for(None) == 140.0
    assert DEFAULT_DN_MM == 50.0


# ── route ─────────────────────────────────────────────────────────────────────

def test_topology_route_with_solve():
    from api.routes.cad_exchange_routes import router
    app = FastAPI()
    app.include_router(router, prefix="/api/cad")
    client = TestClient(app)
    r = client.post("/api/cad/topology",
                    json={"pipes": PIPES, "candidates": CANDIDATES, "tolerance_m": 0.05, "solve": True})
    assert r.status_code == 200
    body = r.json()
    assert {"nodes", "links", "groups", "dangling", "solver_input"} <= set(body)
    assert body["solution"]["converged"] is True
    assert client.post("/api/cad/topology", json={"pipes": "x"}).status_code == 400
