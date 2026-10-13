"""
AF-NEXT-010 (= AF-CAD-013) acceptance — multi-basin data model + CAD round trip.

A third-party drawing (millimetres) with TWO basins and an island in the first one, nozzle
and light blocks in both basins, goes through the real routes:

    import → confirm fixtures (design built exactly like the frontend's applyCadImport)
    → edit one item (move N-02, change the controller address of L-01)
    → export DXF (POST /api/cad/export.dxf, services/cad_export.py)
    → re-import (POST /api/cad/import) → diff (POST /api/cad/diff)

and must keep: both basin boundaries (≤ 1 mm), the island attached to its basin, every
fixture id (AQUAFLOW XDATA), layer and coordinate (≤ 1 mm), the edited controller address,
no duplicates and no unexplained movement. A drawing without $INSUNITS must not be taken
as metres silently (unit confirmation is required).

The responses are saved for the frontend vitest (src/engineering/__tests__/afNext010MultiBasin.test.js):
  * cad_multibasin_import_response.json    — first import (recognize=true)
  * cad_multibasin_design.json             — the confirmed + edited design that was exported
  * cad_multibasin_reimport_response.json  — import of the exported DXF
"""
from __future__ import annotations

import io
import json
import math
import re
from pathlib import Path

import ezdxf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.cad_routes import router as cad_router
from api.routes.cad_exchange_routes import router as cad_exchange_router
from api.routes.hydraulics_routes import router as hydraulics_router
from services import geometry_service as gs
from services.basin_model import basin_to_geometry, geometry_to_basin, migrate_project, normalize_basins
from services.cad_export import read_entity_metadata
from tests import cad_fixtures as F

FIXTURE_DIR = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "engineering"
               / "__tests__" / "fixtures")
MM = 1e-3

# Drawing (millimetres, CAD +Y up)
BASIN_A = [(0, 0), (20000, 0), (20000, 10000), (0, 10000)]
ISLAND_A = [(8000, 3000), (12000, 3000), (12000, 7000), (8000, 7000)]
BASIN_B = [(26000, 0), (36000, 0), (36000, 8000), (26000, 8000)]
JETS = {"N-01": (3000, 2000), "N-02": (5000, 2000), "N-03": (15000, 8000),
        "N-11": (29000, 4000), "N-12": (33000, 4000)}
LIGHTS = {"L-01": (2000, 9000), "L-11": (35000, 7000)}
MOVE = (0.5, 0.25)          # plan-frame metres applied to N-02


def drawing(insunits: int = 4):
    doc = ezdxf.new("R2013")
    doc.header["$INSUNITS"] = insunits
    for name, color in (("F-BASIN-WATER", 5), ("F-ISLAND", 3), ("F-NOZZLES", 4), ("F-LIGHTS", 2)):
        doc.layers.add(name, color=color)
    msp = doc.modelspace()
    msp.add_lwpolyline(BASIN_A, close=True, dxfattribs={"layer": "F-BASIN-WATER"})
    msp.add_lwpolyline(ISLAND_A, close=True, dxfattribs={"layer": "F-ISLAND"})
    msp.add_lwpolyline(BASIN_B, close=True, dxfattribs={"layer": "F-BASIN-WATER"})
    jet = doc.blocks.new("NOZZLE_JET_DN25")
    jet.add_circle((0, 0), 50, dxfattribs={"layer": "0"})
    jet.add_attdef("ID", (0, 80), dxfattribs={"height": 100})
    for tag, (x, y) in JETS.items():
        msp.add_blockref("NOZZLE_JET_DN25", (x, y), dxfattribs={"layer": "F-NOZZLES"}).add_auto_attribs({"ID": tag})
    spot = doc.blocks.new("LED_SPOT_RGB")
    spot.add_circle((0, 0), 80, dxfattribs={"layer": "0"})
    spot.add_attdef("ID", (0, 120), dxfattribs={"height": 100})
    for tag, (x, y) in LIGHTS.items():
        msp.add_blockref("LED_SPOT_RGB", (x, y), dxfattribs={"layer": "F-LIGHTS"}).add_auto_attribs({"ID": tag})
    return doc


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(cad_router, prefix="/api/cad")
    app.include_router(cad_exchange_router, prefix="/api/cad")
    app.include_router(hydraulics_router, prefix="/api/hydraulics")
    return TestClient(app)


def _import(client, data: bytes, name="two_basins.dxf", **form):
    r = client.post("/api/cad/import", files={"file": (name, io.BytesIO(data), "application/dxf")},
                    data={k: str(v) for k, v in form.items()})
    assert r.status_code == 200, r.text
    return r.json()


def _save(name: str, payload: dict) -> None:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    if isinstance(payload.get("stats"), dict) and "parse_ms" in payload["stats"]:
        payload = {**payload, "stats": {**payload["stats"], "parse_ms": 0}}
    (FIXTURE_DIR / name).write_text(json.dumps(payload, indent=1, sort_keys=True), encoding="utf-8")


def _plan(p):
    return {"x": float(p[0]), "y": -float(p[1]) + 0.0}       # CAD +Y up → plan (frontend default frame)


def confirm_design(resp: dict) -> dict:
    """The frontend's applyCadImport on default choices, in Python (same ids and frame)."""
    outlines = {o["handle"]: o for o in resp["closed_outlines"]}
    roles = {b["source_handle"]: b["role"] for b in resp["recognition"]["basins"]}
    basin_handles = sorted((h for h, r in roles.items() if r == "basin"),
                           key=lambda h: -outlines[h]["area_m2"])
    basins = []
    for i, h in enumerate(basin_handles):
        o = outlines[h]
        holes = [[_plan(p) for p in outlines[ih]["points"]] for ih, r in roles.items()
                 if r == "island" and outlines[ih]["parent_handle"] == h]
        basins.append({"id": f"basin-{h}", "name": f"Basin {i + 1}", "type": "freeform", "closed": True,
                       "outer": [_plan(p) for p in o["points"]], "holes": holes, "depthZones": [],
                       "floorLevel": -0.8, "wallHeight": 0.8})
    fixtures = []
    for c in resp["recognition"]["candidates"]:
        ftype = "light_rgb" if c["type"] == "light" else "nozzle_geyser"
        fid = "cad-" + re.sub(r"[^a-z\d-]", "-", str(c["source_handle"]), flags=re.I)
        fixtures.append({"id": fid, "type": ftype, "label": c["tag"], "x": c["position"][0],
                         "y": -c["position"][1] + 0.0, "rotation": 0, "cadLayer": c["layer"],
                         "cadHandle": c["source_handle"],
                         "engineering": {"plcChannel": None, "mappingStatus": "commissioning-required"}})
    primary = basin_to_geometry(basins[0])
    return {"name": "Two basin plaza", "pool_type": "freeform", "params": {"width": 20, "length": 10, "depth": 0.8},
            "geometry": primary, "basins": basins, "fixtures": fixtures, "depth_zones": []}


@pytest.fixture(scope="module")
def client():
    return _client()


@pytest.fixture(scope="module")
def first(client):
    resp = _import(client, F.to_bytes(drawing()))
    _save("cad_multibasin_import_response.json", resp)
    return resp


@pytest.fixture(scope="module")
def design(first):
    d = confirm_design(first)
    by_label = {f["label"]: f for f in d["fixtures"]}
    original = json.loads(json.dumps(d))
    # Edit one item each: move N-02, commission controller addresses on L-01 / N-11.
    by_label["N-02"]["x"] += MOVE[0]
    by_label["N-02"]["y"] += MOVE[1]
    by_label["L-01"]["engineering"].update({"dmxAddress": 205, "mappingStatus": "commissioned"})
    by_label["N-11"]["engineering"].update({"plcChannel": 12, "icanGroup": 2, "icanChannel": 7})
    d["_original"] = original
    return d


@pytest.fixture(scope="module")
def exported(client, design):
    body = {k: v for k, v in design.items() if not k.startswith("_")}
    r = client.post("/api/cad/export.dxf", json=body)
    assert r.status_code == 200, r.text
    return r.text


@pytest.fixture(scope="module")
def second(client, design, exported):
    resp = _import(client, exported.encode("utf-8"), name="two_basins_roundtrip.dxf")
    _save("cad_multibasin_design.json", {k: v for k, v in design.items() if not k.startswith("_")})
    _save("cad_multibasin_reimport_response.json", resp)
    return resp


def _close(a, b, tol=1 * MM):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def _same_ring(cad_pts, plan_pts, tol=1 * MM):
    exp = [(p["x"], -p["y"]) for p in plan_pts]
    got = [tuple(p) for p in cad_pts]
    return len(got) == len(exp) and all(any(_close(g, e, tol) for g in got) for e in exp)


# ── 1. import ───────────────────────────────────────────────────────────────────

def test_import_reports_two_basins_and_the_island_under_its_parent(first):
    rec = first["recognition"]["basins"]
    assert sorted(b["role"] for b in rec) == ["basin", "basin", "island"]
    outlines = {o["handle"]: o for o in first["closed_outlines"]}
    island = next(b for b in rec if b["role"] == "island")
    parent = outlines[island["source_handle"]]["parent_handle"]
    assert _close(outlines[parent]["points"][2], (20.0, 10.0))      # basin A, not B
    assert {c["tag"] for c in first["recognition"]["candidates"]} == set(JETS) | set(LIGHTS)


def test_confirmed_design_has_two_basins_island_in_a(design):
    assert [len(b["holes"]) for b in design["basins"]] == [1, 0]
    assert design["geometry"]["points"] == design["basins"][0]["outer"]
    assert len({f["id"] for f in design["fixtures"]}) == len(design["fixtures"]) == 7


# ── 2. export → re-import ───────────────────────────────────────────────────────

def test_export_writes_every_basin_with_ids_levels_and_islands(exported, design):
    doc = ezdxf.read(io.StringIO(exported))
    pools = doc.modelspace().query('LWPOLYLINE[layer=="POOL_OUTLINE"]')
    metas = [read_entity_metadata(e) for e in pools]
    assert [m["id"] for m in metas] == [b["id"] for b in design["basins"]]
    assert all(m["kind"] == "pool" and m["floorLevel"] == -0.8 and m["wallHeight"] == 0.8 for m in metas)
    islands = [read_entity_metadata(e) for e in doc.modelspace().query('LWPOLYLINE[layer=="POOL_ISLANDS"]')]
    assert islands == [{"kind": "island", "id": f"{design['basins'][0]['id']}-island-1", "basinId": design["basins"][0]["id"]}]


def test_reimport_keeps_basin_boundaries_ids_and_island_parent(second, design):
    pools = [o for o in second["closed_outlines"] if (o.get("xdata") or {}).get("AQUAFLOW", {}).get("kind") == "pool"]
    assert len(pools) == 2
    by_id = {o["xdata"]["AQUAFLOW"]["id"]: o for o in pools}
    for b in design["basins"]:
        assert _same_ring(by_id[b["id"]]["points"], b["outer"]), b["id"]
    island = next(o for o in second["closed_outlines"] if (o.get("xdata") or {}).get("AQUAFLOW", {}).get("kind") == "island")
    assert island["parent_handle"] == by_id[design["basins"][0]["id"]]["handle"]
    assert _same_ring(island["points"], design["basins"][0]["holes"][0])
    roles = sorted(b["role"] for b in second["recognition"]["basins"])
    assert roles == ["basin", "basin", "island"]


def test_reimport_keeps_fixture_ids_layers_coordinates_and_addresses(second, design):
    cands = second["recognition"]["candidates"]
    ids = [c["aquaflow_id"] for c in cands]
    assert len(ids) == len(set(ids)) == len(design["fixtures"])               # no duplicates
    by_id = {c["aquaflow_id"]: c for c in cands}
    for f in design["fixtures"]:
        c = by_id[f["id"]]
        assert _close(c["position"], (f["x"], -f["y"])), f["label"]           # ≤ 1 mm
        assert c["layer"] == ("LIGHTS" if f["type"].startswith("light") else "NOZZLES")
    light = next(f for f in design["fixtures"] if f["label"] == "L-01")
    assert by_id[light["id"]]["attribs"]["CHANNEL"] == "205"                  # edited address written
    # Recognition never assigns hardware addresses: the frontend keeps them by id match.
    assert all(not c["fields"].get("dmx_address") or c["field_provenance"].get("dmx_address") for c in cands)


def test_diff_shows_only_the_explained_move(client, second, design):
    cands = [{"id": c["id"], "type": c["type"], "position": c["position"], "aquaflow_id": c["aquaflow_id"],
              "source_handle": c["source_handle"]} for c in second["recognition"]["candidates"]]
    cat = lambda t: "light" if t.startswith("light") else "nozzle"
    prev = lambda fx: [{"id": f["id"], "type": cat(f["type"]), "position": [f["x"], -f["y"]], "aquaflow_id": f["id"]} for f in fx]
    same = client.post("/api/cad/diff", json={"previous": prev(design["fixtures"]), "candidates": cands}).json()
    assert same["added"] == [] and same["removed"] == [] and same["moved"] == []
    assert len(same["unchanged"]) == 7 and {u["match"] for u in same["unchanged"]} == {"aquaflow_id"}
    before = client.post("/api/cad/diff", json={"previous": prev(design["_original"]["fixtures"]), "candidates": cands}).json()
    assert [m["id"] for m in before["moved"]] == [next(f["id"] for f in design["fixtures"] if f["label"] == "N-02")]
    assert math.isclose(before["moved"][0]["distance_m"], math.hypot(*MOVE), abs_tol=1 * MM)


def test_unknown_units_require_confirmation(client):
    resp = _import(client, F.to_bytes(drawing(insunits=0)), name="no_units.dxf")
    assert resp["units"]["unitless"] is True and resp["units"]["suggested"]
    assert any("unit" in w.lower() for w in resp["warnings"])
    confirmed = _import(client, F.to_bytes(drawing(insunits=0)), name="no_units.dxf", units="mm")
    assert confirmed["units"].get("override") == "mm"
    assert _close(confirmed["extents"]["max"], (36.0, 10.0))


# ── 3. data model + hydraulics ──────────────────────────────────────────────────

LEGACY = {"pool_type": "freeform", "params": {"depth": 1.1},
          "geometry": {"type": "freeform", "closed": True, "floorLevel": -1.2, "wallHeight": 1.3,
                       "points": [{"x": 0, "y": 0}, {"x": 8, "y": 0}, {"x": 8, "y": 6}, {"x": 0, "y": 6}],
                       "holes": [[{"x": 3, "y": 2}, {"x": 5, "y": 2}, {"x": 5, "y": 4}]]}}


def test_legacy_geometry_migrates_losslessly_and_basins_only_projects_get_geometry():
    m = migrate_project(LEGACY)
    assert m["geometry"] == LEGACY["geometry"]                                 # untouched
    assert len(m["basins"]) == 1 and basin_to_geometry(m["basins"][0]) == LEGACY["geometry"]
    only = {"basins": m["basins"] + [geometry_to_basin({"type": "circle", "center": {"x": 20, "y": 3}, "radius": 2}, id="b2")]}
    m2 = migrate_project(only)
    assert m2["geometry"] == LEGACY["geometry"] and len(m2["basins"]) == 2
    nb = normalize_basins(m2)
    assert nb[1]["type"] == "circle" and len(nb[1]["points"]) == 64


def test_geometry_service_accepts_both_shapes(tmp_path, monkeypatch, design):
    monkeypatch.setattr(gs, "GEOMETRY_DIR", tmp_path)
    svc = gs.GeometryService()
    legacy_id = svc.save_project(json.loads(json.dumps({**LEGACY, "name": "legacy"})))["id"]
    multi_id = svc.save_project({k: v for k, v in json.loads(json.dumps(design)).items() if not k.startswith("_")})["id"]
    assert len(svc.load_project(legacy_id)["basins"]) == 1
    exp = svc.export_for_hydraulics(multi_id)
    assert len(exp["basins"]) == 2
    a, b = (x["id"] for x in design["basins"])
    nb = exp["hydraulics"]["nozzle_basin"]
    labels = {f["id"]: f["label"] for f in design["fixtures"]}
    assert {labels[k] for k, v in nb.items() if v == a} == {"N-01", "N-02", "N-03"}
    assert {labels[k] for k, v in nb.items() if v == b} == {"N-11", "N-12"}
    # water surface excludes the island: 20×10 − 4×4 + 10×8
    assert exp["hydraulics"]["surface_area_m2"] == pytest.approx(200 - 16 + 80, abs=0.01)


def test_hydraulics_one_manifold_per_basin_and_preview_route(client, design):
    nozzles = [f for f in design["fixtures"] if f["type"].startswith("nozzle")]
    res = gs.GeometryService()._solve_pool_hydraulics(nozzles, {}, 0.0, basins=normalize_basins(design))
    ids = {n["id"] for n in res["hydraulic_solution"]["nodes"]}
    assert {f"MANIFOLD_{b['id']}" for b in design["basins"]} <= ids and "MANIFOLD" not in ids
    assert [b["nozzle_count"] for b in res["basins"]] == [3, 2] and res["warnings"] == []
    single = gs.GeometryService()._solve_pool_hydraulics(nozzles, {}, 0.0)
    assert "MANIFOLD" in {n["id"] for n in single["hydraulic_solution"]["nodes"]} and "basins" not in single
    r = client.post("/api/hydraulics/preview-physics", json={
        "nozzles": nozzles, "params": {}, "volume_litres": 1000,
        "basins": [{"id": b["id"], "outer": b["outer"], "holes": b["holes"]} for b in design["basins"]]})
    assert r.status_code == 200 and len(r.json()["basins"]) == 2
