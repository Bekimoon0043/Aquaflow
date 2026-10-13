"""
AF-NEXT-012 — Fixture data trust.

Every nozzle / pump / valve / light record and every engineering result or BOM line
carries (or cites) a provenance block: source, model, units, revision, confidence.
Generic estimates are never presented as manufacturer specifications.
"""
import asyncio
import csv
import io
import json

import pytest

from services import equipment_provenance as ep
from services.equipment_registry import EquipmentRegistry, validate_model


# ── helpers ──────────────────────────────────────────────────────────────────

def _measured_nozzle(mid="site-jet-dn25"):
    return {
        "id": mid, "kind": "nozzle", "label": "Site jet DN25",
        "provenance": {"source": "user_measured", "model": "Site jet DN25",
                       "date": "2026-10-01", "revision": "run-1",
                       "document": {"title": "Pump-house test sheet"},
                       "notes": "measured with calibrated gauge"},
        "data": {"nozzle_type": "jet", "pressure_flow_points": [
            {"pressure": 0.5, "flow": 40.0, "jet_height": 3.0},
            {"pressure": 1.0, "flow": 57.0, "jet_height": 6.0},
            {"pressure": 2.0, "flow": 80.0, "jet_height": 11.0}]},
    }


def _measured_pump(mid="site-pump-1"):
    return {
        "id": mid, "kind": "pump", "label": "Site pump 1 (measured)",
        "provenance": {"source": "user_measured", "model": "Site pump 1",
                       "date": "2026-10-02", "revision": "run-3"},
        "data": {"flows": [0.0, 0.01, 0.02, 0.03], "heads": [30.0, 28.0, 23.0, 15.0]},
    }


@pytest.fixture
def registry(tmp_path, monkeypatch):
    """Isolated registry (empty bundled dir + temp user dir) wired as the singleton."""
    bundled = tmp_path / "bundled"
    bundled.mkdir()
    monkeypatch.setenv("AQUAFLOW_DATA_DIR", str(tmp_path / "userdata"))
    reg = EquipmentRegistry(bundled_dir=bundled)
    import services.equipment_registry as er
    monkeypatch.setattr(er, "_registry", reg)
    return reg


# ── provenance schema ────────────────────────────────────────────────────────

def test_missing_provenance_is_generic_low_confidence():
    p = ep.normalize_provenance(None, kind="nozzle", model="X")
    assert p["source"] == "generic_estimate"
    assert p["confidence"] == "low"
    assert p["label"] == "Generic estimate — verify with supplier datasheet"
    assert p["units"]["pressure"] == "bar"


def test_incomplete_datasheet_claim_is_downgraded_not_trusted():
    p = ep.normalize_provenance({"source": "manufacturer_datasheet", "manufacturer": "Acme",
                                 "model": "J-1", "confidence": "high"}, kind="nozzle")
    assert p["source"] == "generic_estimate"
    assert p["confidence"] == "low"
    assert p["downgraded_from"] == "manufacturer_datasheet"
    assert "document" in p["downgrade_reason"] and "licence" in p["downgrade_reason"]


def test_complete_datasheet_is_kept():
    raw = {"source": "manufacturer_datasheet", "manufacturer": "Acme", "model": "J-1",
           "document": {"title": "J-1 datasheet", "url": "https://example.invalid/j1.pdf"},
           "revision": "B", "date": "2026-01-01", "licence": "Used with written permission"}
    p = ep.normalize_provenance(raw, kind="nozzle")
    assert p["source"] == "manufacturer_datasheet" and p["confidence"] == "high"
    c = ep.cite(p, "J-1")
    assert c["data_source"] == "manufacturer_datasheet"
    assert c["revision"] == "B" and c["document"] == "J-1 datasheet"


def test_generic_can_never_claim_medium_or_high_confidence():
    assert ep.validate_provenance({"source": "generic_estimate", "confidence": "high"})
    p = ep.normalize_provenance({"source": "generic_estimate", "confidence": "high"})
    assert p["confidence"] == "low"


# ── verified-model registry ──────────────────────────────────────────────────

def test_registry_ships_empty_and_skips_example_files():
    reg = EquipmentRegistry()                      # real bundled dir
    bundled = [m for m in reg.list() if m["origin"] == "bundled"]
    assert bundled == []                           # no fabricated manufacturer data shipped
    assert (reg.bundled_dir / "nozzle.example.json").exists()


def test_registry_add_measured_nozzle_round_trips(registry):
    m = registry.add(_measured_nozzle())
    assert m["provenance"]["source"] == "user_measured"
    assert registry.get("nozzle", "site-jet-dn25")["data"]["pressure_flow_points"][1]["flow"] == 57.0
    with pytest.raises(ValueError):
        registry.add(_measured_nozzle())           # duplicate refused without replace
    assert registry.delete("nozzle", "site-jet-dn25") is True
    assert registry.list("nozzle") == []


def test_registry_refuses_untrustworthy_nozzle_records(registry):
    rec = _measured_nozzle()
    rec["provenance"] = {"source": "generic_estimate"}
    with pytest.raises(ValueError, match="verified set only accepts"):
        registry.add(rec)
    rec = _measured_nozzle()
    del rec["provenance"]["date"]
    with pytest.raises(ValueError, match="date"):
        registry.add(rec)
    rec = _measured_nozzle()
    rec["data"]["pressure_flow_points"] = [{"pressure": 1, "flow": 10}]
    assert any("at least 2" in e for e in validate_model(rec))


def test_registry_validates_pump_valve_light_data():
    base = {"label": "x", "provenance": {"source": "user_measured", "model": "x", "date": "2026-10-01"}}
    assert validate_model({**base, "kind": "pump", "data": {"flows": [0, 1], "heads": [3, 2]}})
    assert validate_model({**base, "kind": "valve", "data": {"kv": 0}})
    assert validate_model({**base, "kind": "light", "data": {"power_w": 10, "dmx_channels": 2.5}})
    assert not validate_model({**base, "kind": "light", "data": {"power_w": 36, "dmx_channels": 4}})


# ── nozzle database ──────────────────────────────────────────────────────────

def test_default_nozzle_catalogs_are_labelled_generic(registry):
    from services.nozzle_database import NozzleDatabase
    db = NozzleDatabase()
    assert db.list_models()
    for m in db.list_models():
        assert m.provenance["source"] == "generic_estimate", m.id
        assert m.to_dict()["verified"] is False
    q = db.query("OASE-FOAM-30", pressure=1.0)
    assert q["citation"]["data_source"] == "generic_estimate"
    assert q["citation"]["units"]["flow"] == "L/min"
    assert q["citation"]["revision"]


def test_measured_nozzle_is_loaded_and_cited(registry):
    from services.nozzle_database import NozzleDatabase
    registry.add(_measured_nozzle())
    db = NozzleDatabase()
    q = db.query("site-jet-dn25", pressure=1.0)
    assert abs(q["flow"] - 57.0) < 1e-6
    assert q["citation"]["data_source"] == "user_measured"
    assert q["citation"]["revision"] == "run-1"


# ── pump curves ──────────────────────────────────────────────────────────────

def test_builtin_pump_curve_sets_are_generic():
    from services.pump_curve import analyze
    r = analyze({"pump": {"model": "fountain-medium"}, "system": {"static_head": 5, "k": 2000}})
    assert r["pump"]["provenance"]["source"] == "generic_estimate"
    assert r["operating_point"]["equipment"]["equipment_model"] == "fountain-medium"
    assert r["operating_point"]["equipment"]["units"]["flow"] == "m3/s"
    assert r["data_provenance"]["generic_items"] == 1


def test_measured_pump_curve_drives_operating_point(registry):
    from services.pump_curve import analyze
    registry.add(_measured_pump())
    r = analyze({"pump": {"model": "site-pump-1"}, "system": {"static_head": 5, "k": 20000}})
    assert r["operating_point"]["converged"]
    assert r["operating_point"]["equipment"]["data_source"] == "user_measured"
    assert r["operating_point"]["equipment"]["revision"] == "run-3"
    assert r["data_provenance"]["all_verified"] is True


# ── valves ───────────────────────────────────────────────────────────────────

def test_valve_manual_kv_is_cited_generic():
    from services.valve_authority import analyze
    r = analyze({"kv": 40, "flow_m3h": 20, "dp_rest_bar": 0.5})
    assert r["equipment"]["data_source"] == "generic_estimate"
    assert r["equipment"]["units"]["kv"] == "m3/h/sqrt(bar)"


def test_valve_model_from_registry_supplies_kv_and_citation(registry):
    from services.valve_authority import analyze
    registry.add({"id": "site-cv-dn80", "kind": "valve", "label": "Site CV DN80",
                  "provenance": {"source": "user_measured", "model": "Site CV DN80",
                                 "date": "2026-10-03"},
                  "data": {"kv": 40, "size": "DN80"}})
    r = analyze({"valve_model": "site-cv-dn80", "flow_m3h": 20, "dp_rest_bar": 0.5})
    assert r["equipment"]["data_source"] == "user_measured"
    assert abs(r["dp_valve_bar"] - 0.25) < 1e-6          # (20/40)^2
    with pytest.raises(KeyError):
        analyze({"valve_model": "missing", "flow_m3h": 20, "dp_rest_bar": 0.5})


# ── BOM ──────────────────────────────────────────────────────────────────────

def _bom_model():
    return {
        "project": "P",
        "equipment": [{"type": "pump", "part_number": "pump", "quantity": 1},
                      {"type": "light_par_rgbw", "label": "PAR",
                       "provenance": {"source": "manufacturer_datasheet", "manufacturer": "Acme"}}],
        "nozzles": [{"model": "AF-GEYSER-25"}],
        "pipes": [{"diameter": 0.1, "length": 12.0, "material": "PVC"}],
        "valves": [{"type": "control_valve", "size": "DN100"}],
    }


def test_every_bom_line_cites_model_source_units_revision():
    from services.bom_generator import generate_bom
    bom = generate_bom(_bom_model())
    assert bom["lines"]
    for line in bom["lines"]:
        assert line["equipment_model"], line
        assert line["data_source"] in ep.SOURCES
        assert line["units_basis"] or line["category"] not in ("pipe", "nozzle"), line
        assert line["data_revision"], line
    light = next(l for l in bom["lines"] if l["category"] == "light_par_rgbw")
    # An incomplete "datasheet" claim never reaches the BOM as a datasheet.
    assert light["data_source"] == "generic_estimate"
    assert bom["summary"]["data_provenance"]["generic_items"] == len(bom["lines"])
    assert "verify with supplier datasheets" in bom["summary"]["data_provenance"]["warning"]


def test_bom_csv_and_xlsx_exports_carry_provenance_columns():
    import openpyxl
    from services.bom_generator import BOMGenerator
    gen = BOMGenerator().generate(_bom_model())
    rows = list(csv.reader(io.StringIO(gen.to_csv())))
    header = rows[0]
    for col in ("Equipment Model", "Data Source", "Confidence", "Units Basis",
                "Data Revision", "Source Document"):
        assert col in header
    src = header.index("Data Source")
    assert rows[1][src] == "Generic estimate — verify with supplier datasheet"
    wb = openpyxl.load_workbook(io.BytesIO(gen.to_xlsx_bytes()))
    xhead = [c.value for c in wb.active[1]]
    assert xhead[-6:] == ["Equipment Model", "Data Source", "Confidence", "Units Basis",
                          "Data Revision", "Source Document"]


def test_bom_line_uses_verified_registry_model(registry):
    from services.bom_generator import generate_bom
    registry.add(_measured_pump())
    bom = generate_bom({"equipment": [{"type": "pump", "part_number": "SP1",
                                       "equipment_model_id": "site-pump-1"}]})
    line = bom["lines"][0]
    assert line["data_source"] == "user_measured" and line["data_revision"] == "run-3"


def test_bom_from_network_export_keeps_citations():
    from api.routes import bom_routes
    net = {"nodes": [{"id": "R", "fixed_head": 30}, {"id": "N", "demand": 0.001}],
           "pipes": [{"id": "P", "from": "R", "to": "N", "diameter": 0.05, "length": 5}]}
    resp = asyncio.run(bom_routes.from_network(net, format="csv"))
    text = resp.body.decode("utf-8")
    assert "Data Source" in text.splitlines()[0]
    assert "Generic estimate" in text


# ── hydraulics / pipe sizing ─────────────────────────────────────────────────

def _network():
    return {"nodes": [{"id": "R", "fixed_head": 20, "model": "fountain-small"},
                      {"id": "J"},
                      {"id": "N1", "emitter_k": 0.0005, "elevation": 0, "model": "AF-GEYSER-25"}],
            "pipes": [{"id": "P1", "from": "R", "to": "J", "length": 10, "diameter": 0.08},
                      {"id": "P2", "from": "J", "to": "N1", "length": 5, "diameter": 0.05}]}


def test_hydraulic_solver_results_cite_nozzle_pump_and_pipes():
    from services.hydraulic_solver import solve_network
    r = solve_network(_network())
    nodes = {n["id"]: n for n in r["nodes"]}
    assert nodes["N1"]["equipment"]["equipment_model"] == "AF-GEYSER-25"
    assert nodes["N1"]["equipment"]["units"]["jet_height"] == "m"
    assert nodes["R"]["equipment"]["equipment_model"] == "fountain-small"
    assert "equipment" not in nodes["J"]
    for p in r["pipes"]:
        assert p["equipment"]["data_source"] == "generic_estimate"
        assert p["equipment"]["revision"]
    assert r["data_provenance"]["items"] == 4


def test_pipe_sizing_results_cite_basis():
    from services.pipe_sizing import size_pipes, size_network
    r = size_pipes({"pipes": [{"id": "P1", "flow_m3s": 0.01, "diameter": 0.1}]})
    assert r["pipes"][0]["equipment"]["units"]["velocity"] == "m/s"
    assert r["summary"]["data_provenance"]["items"] == 1
    r2 = size_network(_network())
    assert all("equipment" in p for p in r2["pipes"])


def test_hydraulic_preview_route_cites_each_nozzle(monkeypatch):
    from api.routes import hydraulics_routes

    class Service:
        def _solve_pool_hydraulics(self, nozzles, params, volume, **_kw):
            return {"converged": True, "nozzle_physics": {"n1": {"jetHeightM": 2.0},
                                                          "n2": {"jetHeightM": 1.0}}}

    monkeypatch.setattr(hydraulics_routes, "get_geometry_service", lambda: Service())
    verified = {"source": "user_measured", "model": "Jet A", "date": "2026-10-01", "revision": "r2"}
    out = asyncio.run(hydraulics_routes.preview_physics({"nozzles": [
        {"id": "n1", "type": "nozzle_straight_dn25", "engineering": {}},
        {"id": "n2", "type": "nozzle_x", "provenance": verified, "engineering": {}},
    ]}))
    assert out["nozzle_physics"]["n1"]["equipment"]["data_source"] == "generic_estimate"
    assert out["nozzle_physics"]["n1"]["equipment"]["equipment_model"] == "nozzle_straight_dn25"
    assert out["nozzle_physics"]["n2"]["equipment"]["data_source"] == "user_measured"
    assert out["nozzle_physics"]["n2"]["equipment"]["revision"] == "r2"
    assert out["data_provenance"]["generic_items"] == 1


# ── equipment API ────────────────────────────────────────────────────────────

def test_equipment_routes_add_list_delete_nozzle(registry):
    from fastapi import HTTPException
    from api.routes import equipment_routes as r
    added = asyncio.run(r.add_model(_measured_nozzle(), replace=False))
    assert added["model"]["id"] == "site-jet-dn25"
    listed = asyncio.run(r.list_models(kind="nozzle"))
    assert listed["count"] == 1
    from services.nozzle_database import get_nozzle_database
    assert get_nozzle_database().get("site-jet-dn25") is not None   # reloaded
    bad = _measured_nozzle("bad")
    bad["provenance"] = {"source": "manufacturer_datasheet", "model": "x"}
    with pytest.raises(HTTPException):
        asyncio.run(r.add_model(bad, replace=False))
    asyncio.run(r.delete_model("nozzle", "site-jet-dn25"))
    assert asyncio.run(r.list_models(kind="nozzle"))["count"] == 0
    from services.nozzle_database import reload_nozzle_database
    reload_nozzle_database()
