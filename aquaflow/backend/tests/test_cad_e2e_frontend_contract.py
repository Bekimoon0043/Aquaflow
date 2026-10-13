"""
AF-CAD end-to-end frontend contract test.

Builds a realistic third-party fountain drawing with ezdxf (millimetres, project-style
layer names, attributed blocks, a nested ring block, a pump → valve → nozzle pipe run,
an island, a depth-zone outline that must stay reference-only, a lawn hatch and a tag
schedule), runs it through the real routes with TestClient and checks the response
against docs/CAD-IMPORT-CONTRACT.md.

The responses are saved under
``frontend/src/engineering/__tests__/fixtures/`` so the frontend vitest
(``cadE2EFrontendContract.test.js``) runs the dialog's preview/apply logic on REAL backend
output instead of a hand-written mock:

  * cad_import_response.json           — POST /api/cad/import (mm drawing, recognize=true)
  * cad_import_unitless_response.json  — the same drawing with $INSUNITS = 0
  * cad_topology_response.json         — POST /api/cad/topology on the recognition result
"""
from __future__ import annotations

import io
import json
import math
from pathlib import Path

import ezdxf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.cad_routes import router as cad_router
from api.routes.cad_exchange_routes import router as cad_exchange_router
from tests import cad_fixtures as F

FIXTURE_DIR = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "engineering"
               / "__tests__" / "fixtures")

# Drawing geometry (millimetres, CAD +Y up)
BASIN = [(0, 0), (24000, 0), (24000, 12000), (0, 12000)]
ISLAND = [(10000, 4000), (14000, 4000), (14000, 8000), (10000, 8000)]
DEPTH_ZONE = [(1000, 1000), (8000, 1000), (8000, 3500), (1000, 3500)]
JETS = [(3000 + 1000 * k, 2000) for k in range(5)]          # N-01 … N-05 on the main run
RING_AT = (18000, 6000)                                      # nested ring of 4 jets, r = 1.5 m
LIGHTS = [(1000, 11000), (23000, 11000)]
PUMP_AT = (26000, 2000)                                      # plant room, outside the basin
VALVE_AT = (22000, 2000)


def fountain_doc(insunits: int = 4):
    doc = ezdxf.new("R2013")
    doc.header["$INSUNITS"] = insunits
    for name, color in (("F-BASIN-WATER", 5), ("F-ISLAND", 3), ("F-DEPTH-ZONE", 150),
                        ("F-NOZZLES", 4), ("F-LIGHTS", 2), ("F-EQUIP", 8),
                        ("F-PIPE PVC DN50", 30), ("L-LAWN", 82), ("A-TEXT", 7), ("A-SCHED", 7)):
        doc.layers.add(name, color=color)
    msp = doc.modelspace()

    msp.add_lwpolyline(BASIN, close=True, dxfattribs={"layer": "F-BASIN-WATER"})
    msp.add_lwpolyline(ISLAND, close=True, dxfattribs={"layer": "F-ISLAND"})
    msp.add_lwpolyline(DEPTH_ZONE, close=True, dxfattribs={"layer": "F-DEPTH-ZONE"})

    jet = doc.blocks.new("NOZZLE_JET_DN25")
    jet.add_circle((0, 0), 50, dxfattribs={"layer": "0"})
    jet.add_attdef("ID", (0, 80), dxfattribs={"height": 100})
    jet.add_attdef("MODEL", (0, 200), dxfattribs={"height": 100})
    for k, (x, y) in enumerate(JETS):
        ref = msp.add_blockref("NOZZLE_JET_DN25", (x, y), dxfattribs={"layer": "F-NOZZLES"})
        ref.add_auto_attribs({"ID": f"N-0{k + 1}", "MODEL": "JET-25"})

    plain = doc.blocks.new("JET_RING_HEAD")
    plain.add_circle((0, 0), 40, dxfattribs={"layer": "0"})
    ring = doc.blocks.new("RING4")
    for a in range(4):
        ang = a * math.pi / 2
        ring.add_blockref("JET_RING_HEAD", (1500 * math.cos(ang), 1500 * math.sin(ang)),
                          dxfattribs={"layer": "0"})
    msp.add_blockref("RING4", RING_AT, dxfattribs={"layer": "F-NOZZLES"})

    spot = doc.blocks.new("LED_SPOT_RGB")
    spot.add_circle((0, 0), 80, dxfattribs={"layer": "0"})
    for x, y in LIGHTS:
        msp.add_blockref("LED_SPOT_RGB", (x, y), dxfattribs={"layer": "F-LIGHTS", "rotation": 45})

    pump = doc.blocks.new("PUMP_SUBMERSIBLE")
    pump.add_lwpolyline([(-300, -300), (300, -300), (300, 300), (-300, 300)], close=True)
    msp.add_blockref("PUMP_SUBMERSIBLE", PUMP_AT, dxfattribs={"layer": "F-EQUIP"})
    valve = doc.blocks.new("VALVE_SOLENOID")
    valve.add_lwpolyline([(-100, -100), (100, 100), (100, -100), (-100, 100)], close=True)
    msp.add_blockref("VALVE_SOLENOID", VALVE_AT, dxfattribs={"layer": "F-EQUIP"})

    # pump → valve → jets (jets sit on the run's interior), plus a capped stub (dangling end)
    msp.add_lwpolyline([PUMP_AT, VALVE_AT], dxfattribs={"layer": "F-PIPE PVC DN50"})
    msp.add_lwpolyline([VALVE_AT, (2000, 2000)], dxfattribs={"layer": "F-PIPE PVC DN50"})
    msp.add_lwpolyline([VALVE_AT, (22000, 9000)], dxfattribs={"layer": "F-PIPE PVC DN50"})

    h = msp.add_hatch(color=3, dxfattribs={"layer": "L-LAWN"})
    h.set_pattern_fill("GRASS", scale=10)
    h.paths.add_polyline_path([(-6000, -6000), (30000, -6000), (30000, -2000), (-6000, -2000)],
                              is_closed=True)
    msp.add_text("CENTRAL PLAZA FOUNTAIN", height=400,
                 dxfattribs={"layer": "A-TEXT"}).set_placement((0, 13000))
    return doc


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(cad_router, prefix="/api/cad")
    app.include_router(cad_exchange_router, prefix="/api/cad")
    return TestClient(app)


def _post_import(client, data: bytes, name="central_plaza.dxf", **form):
    return client.post("/api/cad/import", files={"file": (name, io.BytesIO(data), "application/dxf")},
                       data={k: str(v) for k, v in form.items()})


def _save(name: str, payload: dict) -> None:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    if isinstance(payload.get("stats"), dict) and "parse_ms" in payload["stats"]:
        payload = {**payload, "stats": {**payload["stats"], "parse_ms": 0}}   # stable fixture
    (FIXTURE_DIR / name).write_text(json.dumps(payload, indent=1, sort_keys=True), encoding="utf-8")


@pytest.fixture(scope="module")
def client():
    return _client()


@pytest.fixture(scope="module")
def imported(client):
    r = _post_import(client, F.to_bytes(fountain_doc()))
    assert r.status_code == 200, r.text
    return r.json()


def _close(a, b, tol=1e-6):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def test_import_envelope_units_and_extents(imported):
    for key in ("version", "filename", "dxf_version", "units", "extents", "layers", "entities",
                "inserts", "closed_outlines", "tables", "xrefs", "warnings", "stats", "recognition"):
        assert key in imported
    assert imported["units"]["name"] == "mm" and imported["units"]["to_m"] == pytest.approx(0.001)
    assert imported["units"]["unitless"] is False
    assert imported["extents"]["max"][0] == pytest.approx(30.0)


def test_closed_outlines_holes_parent_and_exclusion(imported):
    by_layer = {o["layer"]: o for o in imported["closed_outlines"]}
    basin, island, zone = by_layer["F-BASIN-WATER"], by_layer["F-ISLAND"], by_layer["F-DEPTH-ZONE"]
    assert basin["area_m2"] == pytest.approx(288.0)
    assert basin["excluded"] is None
    # holes are point arrays (metres) with matching hole_handles / parent_handle
    assert island["handle"] in basin["hole_handles"]
    assert len(basin["holes"]) == len(basin["hole_handles"]) == 1
    assert _close(sorted(map(tuple, basin["holes"][0]))[0], (10.0, 4.0))
    assert island["parent_handle"] == basin["handle"]
    # depth zone: listed, excluded, never a hole
    assert isinstance(zone["excluded"], str) and zone["excluded"]
    assert zone["handle"] not in basin["hole_handles"]


def test_nested_inserts_carry_instance_ids_used_by_recognition(imported):
    nested = [i for i in imported["inserts"] if i.get("block_path")]
    assert len(nested) == 4
    ids = {i["instance_id"] for i in nested}
    assert len(ids) == 4 and all("/" in i for i in ids)
    for ins in imported["inserts"]:
        if not ins.get("block_path"):
            assert ins["instance_id"] == ins["handle"]
    rec = imported["recognition"]
    handles = {c["source_handle"] for c in rec["candidates"]}
    assert ids <= handles, "recognition must use instance_id as source_handle for nested inserts"


def test_recognition_types_basin_island_pipes_land(imported):
    rec = imported["recognition"]
    by_type = {}
    for c in rec["candidates"]:
        by_type.setdefault(c["type"], []).append(c)
        for k in ("model", "flow_lpm", "height_m", "dmx_address", "pump_id"):
            assert k in c["fields"]
        assert c["group"] in {g["key"] for g in rec["groups"]}
    assert len(by_type.get("nozzle", [])) == 9
    assert len(by_type.get("light", [])) == 2
    assert len(by_type.get("pump", [])) == 1 and len(by_type.get("valve", [])) == 1
    tags = sorted(c["tag"] for c in by_type["nozzle"] if c.get("tag"))
    assert tags[:5] == ["N-01", "N-02", "N-03", "N-04", "N-05"]
    roles = {b["layer"]: b["role"] for b in rec["basins"]}
    assert roles == {"F-BASIN-WATER": "basin", "F-ISLAND": "island"}
    assert len(rec["pipes"]) == 3 and all(p["dn"] == 50 for p in rec["pipes"])
    assert [l["material"] for l in rec["land"]] == ["grass"]


def test_topology_groups_and_dangling(client, imported):
    rec = imported["recognition"]
    r = client.post("/api/cad/topology", json={"pipes": rec["pipes"], "candidates": rec["candidates"],
                                               "tolerance_m": 0.05})
    assert r.status_code == 200, r.text
    topo = r.json()
    assert len(topo["groups"]) == 1
    g = topo["groups"][0]
    assert g["confirmed"] is False
    ids = {c["type"]: [] for c in rec["candidates"]}
    for c in rec["candidates"]:
        ids[c["type"]].append(c["id"])
    assert g["pump"] in ids["pump"] and g["valves"] == ids["valve"]
    assert len(g["nozzles"]) == 5          # the five piped jets; the ring is unattached
    assert any(_close(d, (22.0, 9.0), 1e-3) for d in topo["dangling"])
    _save("cad_topology_response.json", topo)


def test_templates_recognize_and_diff_shapes(client, imported, tmp_path, monkeypatch):
    monkeypatch.setenv("AQUAFLOW_DATA_DIR", str(tmp_path))
    r = client.get("/api/cad/templates")
    assert r.status_code == 200 and isinstance(r.json()["templates"], list)
    tpl = {"name": "Plaza std", "rules": [{"match": "block", "pattern": "^LED_SPOT_RGB$", "type": "light"}]}
    assert client.post("/api/cad/templates", json=tpl).status_code == 200
    assert any(t["name"] == "Plaza std" for t in client.get("/api/cad/templates").json()["templates"])
    body = {k: v for k, v in imported.items() if k != "recognition"}
    r = client.post("/api/cad/recognize", json={"import": body, "template": "Plaza std"})
    assert r.status_code == 200 and r.json()["template_used"] == "Plaza std"
    assert client.delete("/api/cad/templates/Plaza std").json() == {"deleted": "Plaza std"}

    cands = imported["recognition"]["candidates"]
    jet = next(c for c in cands if c.get("tag") == "N-01")
    ringjet = next(c for c in cands if "/" in str(c["source_handle"]))
    previous = [
        {"id": "keep-1", "type": "nozzle", "position": [jet["position"][0] + 0.2, jet["position"][1]],
         "source_handle": jet["source_handle"]},
        {"id": "keep-ring", "type": "nozzle", "position": ringjet["position"],
         "source_handle": ringjet["source_handle"]},
    ]
    r = client.post("/api/cad/diff", json={"previous": previous, "candidates": cands})
    assert r.status_code == 200
    d = r.json()
    assert set(d) >= {"added", "moved", "removed", "unchanged", "warnings"}
    assert d["moved"][0]["candidate_id"] == jet["id"] and d["moved"][0]["match"] == "source_handle"
    assert d["unchanged"][0]["candidate_id"] == ringjet["id"]


def test_aqf_json_route_and_import_route_rejects_json(client):
    doc = {"format": "AQFEXPORT", "version": 1, "drawing": "plaza.dwg", "insunits": 4,
           "inserts": [{"handle": "1A", "name": "NOZZLE_JET_DN25", "layer": "F-NOZZLES",
                        "insertion": [3000, 2000, 0], "rotation_deg": 0, "scale": [1, 1, 1],
                        "attribs": {"ID": "N-01"}}]}
    r = client.post("/api/cad/import/aqf-json", json={"data": doc, "filename": "plaza.json"})
    assert r.status_code == 200
    assert r.json()["inserts"][0]["position"][:2] == [3.0, 2.0]
    # The multipart DXF route does not read the LISP JSON — the frontend routes .json to aqf-json.
    r = _post_import(client, json.dumps(doc).encode(), name="plaza.json")
    assert r.status_code == 400


def test_save_frontend_fixtures(client, imported):
    _save("cad_import_response.json", imported)
    r = _post_import(client, F.to_bytes(fountain_doc(insunits=0)), name="central_plaza_unitless.dxf")
    assert r.status_code == 200
    unitless = r.json()
    # backend applies the suggested unit itself: coordinates are already metres
    assert unitless["units"]["unitless"] is True and unitless["units"]["suggested"] == "mm"
    assert unitless["units"]["name"] == "mm"
    assert unitless["extents"]["max"][0] == pytest.approx(30.0)
    _save("cad_import_unitless_response.json", unitless)


def test_backend_writer_round_trips_through_the_importer(client):
    """AF-CAD-003: the designer's export (backend writer) re-imports with islands, land and ids."""
    design = {
        "name": "Plaza", "pool_type": "freeform", "params": {"depth": 0.9},
        "geometry": {"type": "freeform", "closed": True,
                     "points": [{"x": 0, "y": 0}, {"x": 24, "y": 0}, {"x": 24, "y": -12}, {"x": 0, "y": -12}],
                     "holes": [[{"x": 10, "y": -4}, {"x": 14, "y": -4}, {"x": 14, "y": -8}, {"x": 10, "y": -8}]]},
        "fixtures": [{"id": "noz_1", "type": "nozzle_geyser", "x": 3, "y": -2, "rotation": 30, "label": "N-01"}],
        "site_surfaces": [{"id": "lawn", "type": "grass", "points": [{"x": -6, "y": 2}, {"x": 30, "y": 2},
                                                                     {"x": 30, "y": 6}, {"x": -6, "y": 6}]}],
        "manualPipes": [{"id": "p1", "points": [{"x": 26, "y": -2}, {"x": 3, "y": -2}], "diameterMm": 50}],
    }
    r = client.post("/api/cad/export.dxf", json=design)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/dxf")
    back = _post_import(client, r.content, name="plaza_export.dxf").json()
    layers = {l["name"] for l in back["layers"]}
    assert {"POOL_OUTLINE", "POOL_ISLANDS", "NOZZLES", "PIPEWORK", "LANDSCAPE"} <= layers
    rec = back["recognition"]
    assert sorted(b["role"] for b in rec["basins"]) == ["basin", "island"]
    noz = [c for c in rec["candidates"] if c.get("aquaflow_id") == "noz_1"]
    assert len(noz) == 1 and _close(noz[0]["position"], (3.0, 2.0), 1e-3)   # CAD = (x, -y)
    assert [l["material"] for l in rec["land"]] == ["grass"]


def test_browser_writer_solid_land_hatch_is_recognised_by_xdata(client):
    """The browser fallback writes land as a SOLID hatch on LANDSCAPE with kind=land XDATA."""
    doc = ezdxf.new("R2000")
    doc.header["$INSUNITS"] = 6
    doc.appids.add("AQUAFLOW")
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (10, 0), (10, 5), (0, 5)], close=True, dxfattribs={"layer": "POOL_OUTLINE"})
    h = msp.add_hatch(color=256, dxfattribs={"layer": "LANDSCAPE"})
    h.paths.add_polyline_path([(12, 0), (20, 0), (20, 5)], is_closed=True)
    h.set_xdata("AQUAFLOW", F.aquaflow_xdata({"kind": "land", "id": "s1", "type": "paving", "label": "Plaza"}))
    rec = _post_import(client, F.to_bytes(doc)).json()["recognition"]
    assert [(l["material"], l["reason"]) for l in rec["land"]] == [("paving", "AQUAFLOW XDATA kind=land")]
