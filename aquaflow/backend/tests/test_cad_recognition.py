"""
Contract tests for fountain-component recognition (AF-CAD-012), the tag ↔ schedule
join (AF-CAD-016), mapping templates and the /api/cad/recognize + /templates routes.
Contract: docs/CAD-IMPORT-CONTRACT.md. Fixtures: tests/cad_fixtures.py.
"""
import math

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.cad_routes import router as cad_router
from services import cad_recognition as R
from services.cad_import import import_dxf_bytes
from tests import cad_fixtures as F


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AQUAFLOW_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture(scope="module")
def site():
    return import_dxf_bytes(F.to_bytes(F.site_m()), "site.dxf")


@pytest.fixture(scope="module")
def spanish():
    return import_dxf_bytes(F.to_bytes(F.spanish_site()), "es.dxf")


CAND_KEYS = {"id", "source_handle", "type", "confidence", "reasons", "position", "z", "rotation_deg",
             "block", "layer", "attribs", "tag", "fields", "field_provenance", "aquaflow_id"}


def test_recognition_shape(site):
    rec = site["recognition"]
    assert set(rec) >= {"candidates", "basins", "pipes", "land", "groups", "template_used"}
    for c in rec["candidates"]:
        assert CAND_KEYS <= set(c)
        assert c["type"] in R.TYPES
        assert 0 <= c["confidence"] <= 1 and c["reasons"]
        assert set(R.BASE_FIELDS) <= set(c["fields"])
    assert [c["id"] for c in rec["candidates"]] == [f"cand_{i}" for i in range(len(rec["candidates"]))]


def test_xdata_is_the_strongest_signal(site):
    c = next(c for c in site["recognition"]["candidates"] if c["aquaflow_id"] == "noz_1")
    assert c["type"] == "nozzle" and c["confidence"] >= 0.95
    assert c["reasons"][0].startswith("AQUAFLOW XDATA")
    assert c["tag"] == "N-01" and c["field_provenance"]["tag"] == "attribute ID"
    assert c["fields"]["model"] == "JET-25" and c["field_provenance"]["model"] == "attribute MODEL"


def test_schedule_join_fills_fields_with_provenance(site):
    c = next(c for c in site["recognition"]["candidates"] if c["aquaflow_id"] == "noz_1")
    assert c["fields"]["flow_lpm"] == 40.0 and c["fields"]["height_m"] == 2.0
    assert c["field_provenance"]["flow_lpm"].startswith("schedule row N-01")


def test_hardware_address_only_verbatim(site, spanish):
    c = next(c for c in site["recognition"]["candidates"] if c["aquaflow_id"] == "noz_1")
    assert c["fields"]["dmx_address"] == "17"
    assert "verbatim" in c["field_provenance"]["dmx_address"]
    for rec in (site["recognition"], spanish["recognition"]):
        for other in rec["candidates"]:
            if other is not c and "DMX" not in other["attribs"]:
                assert other["fields"]["dmx_address"] is None
                assert other["fields"].get("channel") is None


def test_nested_ring_container_yields_its_nozzles(site):
    cands = site["recognition"]["candidates"]
    assert not any(c["block"] == "RING4" for c in cands)
    nested = [c for c in cands if "/" in c["source_handle"]]
    assert len(nested) == 12 and all(c["type"] == "nozzle" for c in nested)
    pts = {tuple(c["position"]) for c in nested}
    assert (19.0, 5.0) in pts and (10.0, 6.0) in pts and (29.0, 5.0) in pts
    group = next(g for g in site["recognition"]["groups"] if g["key"] == "block:NOZZLE_JET")
    assert group["count"] == 13 and group["type"] == "nozzle"


def test_dynamic_blocks_recognised_by_effective_name(site):
    by_block = {c["block"]: c for c in site["recognition"]["candidates"]}
    assert by_block["LED_SPOT"]["type"] == "light"
    assert by_block["PUMP_SUB_5HP"]["type"] == "pump"


def test_site_basin_and_land(site):
    basins = site["recognition"]["basins"]
    pool = next(b for b in basins if b["layer"] == "POOL" and b["area_m2"] == pytest.approx(480.0))
    assert pool["role"] == "basin" and pool["confidence"] >= 0.8
    assert site["recognition"]["land"][0]["material"] == "grass"


# ── third-party Spanish drawing ─────────────────────────────────────────────────
def test_spanish_layers_and_plain_circles(spanish):
    cands = spanish["recognition"]["candidates"]
    boq = [c for c in cands if c["layer"] == "BOQUILLAS"]
    assert len(boq) == 8 and all(c["type"] == "nozzle" for c in boq)
    assert all(any("ring" in r for r in c["reasons"]) for c in boq)
    plain = [c for c in cands if c["layer"] == "0"]
    assert len(plain) == 5 and all(c["type"] == "nozzle" for c in plain)
    assert all(c["confidence"] < min(b["confidence"] for b in boq) for c in plain)
    assert all(any("line" in r for r in c["reasons"]) for c in plain)
    pump = next(c for c in cands if c["block"] == "BOMBA_SUMERGIBLE")
    assert pump["type"] == "pump"


def test_spanish_tag_and_schedule_join(spanish):
    cands = spanish["recognition"]["candidates"]
    b1 = next(c for c in cands if c["tag"] == "B1")
    assert b1["fields"]["model"] == "CHORRO-20"
    assert b1["fields"]["flow_lpm"] == pytest.approx(60.0)        # 3.6 m³/h
    assert "schedule row B1" in b1["field_provenance"]["flow_lpm"]
    assert math.hypot(b1["position"][0] - 16.0, b1["position"][1] - 4.0) < 1e-6
    b2 = next(c for c in cands if c["tag"] == "B2")
    assert b2["fields"]["flow_lpm"] == pytest.approx(100.0)
    # schedule cells are never used as symbol tags
    assert not any(c["tag"] == "B3" for c in cands)


def test_l_basin_and_island_roles(spanish):
    basins = spanish["recognition"]["basins"]
    basin = next(b for b in basins if b["role"] == "basin")
    island = next(b for b in basins if b["role"] == "island")
    assert basin["layer"] == "VASO" and basin["area_m2"] == pytest.approx(224.0)
    assert basin["holes"] == [island["points"]]
    assert island["layer"] == "ISLA" and island["confidence"] >= 0.8


def test_pipes_dn_and_material(spanish):
    pipes = {p["layer"]: p for p in spanish["recognition"]["pipes"]}
    assert pipes["TUBERIA PVC DN50"]["dn"] == 50 and pipes["TUBERIA PVC DN50"]["material"] == "PVC"
    assert pipes["TUBERIA"]["dn"] == 63 and pipes["TUBERIA"]["material"] == "HDPE"
    assert "text" in pipes["TUBERIA"]["provenance"]["dn"]


def test_land_from_layer_name(spanish):
    land = spanish["recognition"]["land"]
    assert len(land) == 1 and land[0]["material"] == "grass" and "CESPED" in land[0]["reason"]


# ── keyword engine ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("name,expected", [
    ("NOZZLE_JET_2M", "nozzle"), ("Boquilla-01", "nozzle"), ("DÜSE", "nozzle"), ("Duese 3", "nozzle"),
    ("BUSE_GEYSER", "nozzle"), ("UGELLO", "nozzle"), ("TOBERA", "nozzle"), ("喷头", "nozzle"),
    ("PUMP-5HP", "pump"), ("BOMBA", "pump"), ("Pumpe", "pump"), ("POMPE", "pump"), ("مضخة", "pump"),
    ("LED01", "light"), ("LUZ RGB", "light"), ("Leuchte", "light"), ("VÁLVULA", "valve"),
    ("Magnetventil", "valve"), ("SOLENOID", "valve"), ("LASER", "laser"), ("FIRE_FX", "fire"),
    ("MIST", "mist"), ("FOG-RING", "mist"), ("Brouillard", "mist"), ("MIST_NOZZLE", "mist"),
    ("A-WALL", None), ("FILLED", None), ("BULLET", None),
])
def test_keyword_classifier(name, expected):
    got = R.classify_name(name)
    assert (got[0] if got else None) == expected


def test_parse_number_units():
    assert R.parse_number("3.6 m3/h", "flow_lpm") == pytest.approx(60.0)
    assert R.parse_number("2,5", "height_m") == pytest.approx(2.5)
    assert R.parse_number("10", "flow_lpm", "Q (GPM)") == pytest.approx(37.854, abs=1e-3)
    assert R.parse_number("1500 mm", "height_m") == pytest.approx(1.5)
    assert R.parse_number("n/a", "flow_lpm") is None


def test_geometry_signature_ignores_random_circles():
    circles = [{"center": [0, 0], "radius": 0.05}, {"center": [3.1, 7.2], "radius": 0.05},
               {"center": [9.4, 1.3], "radius": 0.05}, {"center": [4.4, 2.0], "radius": 0.05}]
    assert R.geometry_signatures(circles) == {}


# ── templates ───────────────────────────────────────────────────────────────────
def _plain_block_import():
    import ezdxf
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 6
    blk = doc.blocks.new("XQ-77")
    blk.add_circle((0, 0), 0.1)
    msp = doc.modelspace()
    for k in range(3):
        msp.add_blockref("XQ-77", (k, 0), dxfattribs={"layer": "A-EQPM"})
    ins = msp.add_blockref("XQ-77", (5, 0), dxfattribs={"layer": "A-EQPM"})
    ins.add_attrib("KIND", "VALVE", (5, 0.2))
    return import_dxf_bytes(F.to_bytes(doc), "plain.dxf", recognize=False)


def test_template_rules_override_and_provenance(data_dir):
    imp = _plain_block_import()
    assert R.recognize(imp)["candidates"] == [] or all(
        c["type"] == "valve" for c in R.recognize(imp)["candidates"])
    t = R.save_template({"name": "Client X", "rules": [
        {"match": "block", "pattern": "^XQ-", "type": "light", "fields": {"model": "XQ LED"}}]})
    assert (data_dir / "cad_templates.json").exists()
    rec = R.recognize(imp, "Client X")
    assert rec["template_used"] == "Client X"
    assert len(rec["candidates"]) == 4
    assert all(c["type"] == "light" for c in rec["candidates"])
    assert all(c["fields"]["model"] == "XQ LED" for c in rec["candidates"])
    assert all(c["field_provenance"]["model"] == "template Client X" for c in rec["candidates"])
    assert t["name"] == "Client X"


def test_attribute_type_signal_without_template():
    imp = _plain_block_import()
    cands = R.recognize(imp)["candidates"]
    assert len(cands) == 1 and cands[0]["type"] == "valve" and "attribute KIND=VALVE" in cands[0]["reasons"]


def test_template_ignore_rule():
    imp = _plain_block_import()
    rec = R.recognize(imp, {"name": "ign", "rules": [{"match": "layer", "pattern": "EQPM", "type": "ignore"}]})
    assert rec["candidates"] == []


def test_templates_cannot_assign_hardware_addresses():
    with pytest.raises(ValueError):
        R.validate_template({"name": "bad", "rules": [
            {"match": "layer", "pattern": "X", "type": "light", "fields": {"dmx_address": 1}}]})
    with pytest.raises(ValueError):
        R.validate_template({"name": "bad", "rules": [{"match": "layer", "pattern": "(", "type": "light"}]})
    with pytest.raises(ValueError):
        R.validate_template({"name": "../evil", "rules": [{"match": "layer", "pattern": "x", "type": "light"}]})


def test_template_crud_roundtrip():
    assert R.list_templates() == []
    R.save_template({"name": "A", "rules": [{"match": "layer", "pattern": "x", "type": "pump"}]})
    R.save_template({"name": "B", "rules": [{"match": "attrib", "attrib": "TYPE", "pattern": "x", "type": "valve"}]})
    assert [t["name"] for t in R.list_templates()] == ["A", "B"]
    assert R.delete_template("A") is True and R.delete_template("A") is False
    assert [t["name"] for t in R.list_templates()] == ["B"]


# ── routes ──────────────────────────────────────────────────────────────────────
@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(cad_router, prefix="/api/cad")
    return TestClient(app)


def test_template_routes(client):
    assert client.get("/api/cad/templates").json() == {"templates": []}
    body = {"name": "Std", "rules": [{"match": "block", "pattern": "^XQ-", "type": "light"}]}
    res = client.post("/api/cad/templates", json=body)
    assert res.status_code == 200 and res.json()["name"] == "Std"
    assert [t["name"] for t in client.get("/api/cad/templates").json()["templates"]] == ["Std"]
    bad = {"name": "Bad", "rules": [{"match": "block", "pattern": "x", "type": "light",
                                     "fields": {"channel": 4}}]}
    assert client.post("/api/cad/templates", json=bad).status_code == 400
    assert client.delete("/api/cad/templates/Std").status_code == 200
    assert client.delete("/api/cad/templates/Std").status_code == 404


def test_recognize_route_with_named_and_inline_template(client):
    imp = _plain_block_import()
    client.post("/api/cad/templates", json={"name": "Std", "rules": [
        {"match": "block", "pattern": "^XQ-", "type": "light"}]})
    res = client.post("/api/cad/recognize", json={"import": imp, "template": "Std"})
    assert res.status_code == 200 and len(res.json()["candidates"]) == 4
    inline = {"name": "Inline", "rules": [{"match": "block", "pattern": "^XQ-", "type": "pump"}]}
    res = client.post("/api/cad/recognize", json={"import": imp, "template": inline})
    assert {c["type"] for c in res.json()["candidates"]} == {"pump"}
    assert client.post("/api/cad/recognize", json={"template": None}).status_code == 400


def test_import_route_with_template_name(client):
    client.post("/api/cad/templates", json={"name": "Std", "rules": [
        {"match": "layer", "pattern": "^BOQUILLAS$", "type": "mist"}]})
    res = client.post("/api/cad/import", files={"file": ("es.dxf", F.to_bytes(F.spanish_site()))},
                      data={"template": "Std"})
    assert res.status_code == 200
    rec = res.json()["recognition"]
    assert rec["template_used"] == "Std"
    assert {c["type"] for c in rec["candidates"] if c["layer"] == "BOQUILLAS"} == {"mist"}
