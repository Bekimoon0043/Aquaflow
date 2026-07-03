"""
Contract tests for the nozzle performance database (AQ-S2-005).

Asserts K factors are stored/derived, pressure-flow interpolation is correct and
self-consistent (forward/inverse round-trip), and manufacturer catalogs load and
query correctly.
"""
import math

from services.nozzle_database import NozzleModel, NozzleDatabase


def test_stores_and_applies_k_factor():
    db = NozzleDatabase(load_defaults=False)
    db.add_model(NozzleModel(id="N1", manufacturer="Acme", model="J10", k_factor=10.0))
    m = db.get("N1")
    assert m.k_factor == 10.0
    assert m.effective_k() == 10.0
    assert abs(m.flow_at_pressure(4.0) - 20.0) < 1e-9      # Q = K sqrt(P)
    assert abs(m.pressure_at_flow(30.0) - 9.0) < 1e-9      # P = (Q/K)^2


def test_derives_k_from_catalog_points():
    m = NozzleModel(id="N2", manufacturer="Acme", model="Fit",
                    pressure_flow_points=[{"pressure": 1, "flow": 12},
                                          {"pressure": 4, "flow": 24},
                                          {"pressure": 9, "flow": 36}])
    assert abs(m.effective_k() - 12.0) < 1e-6


def test_interpolation_exact_on_ideal_curve():
    m = NozzleModel(id="N3", manufacturer="Acme", model="I",
                    pressure_flow_points=[{"pressure": 1, "flow": 10},
                                          {"pressure": 4, "flow": 20},
                                          {"pressure": 9, "flow": 30}])
    assert abs(m.flow_at_pressure(4.0) - 20.0) < 1e-9
    assert abs(m.flow_at_pressure(2.25) - 15.0) < 1e-9      # sqrt-domain exact


def test_forward_inverse_roundtrip():
    m = NozzleModel(id="N4", manufacturer="Acme", model="R",
                    pressure_flow_points=[{"pressure": 1, "flow": 10},
                                          {"pressure": 4, "flow": 25}])
    q = m.flow_at_pressure(2.25)
    assert abs(q - 17.5) < 1e-9
    assert abs(m.pressure_at_flow(q) - 2.25) < 1e-6


def test_monotonic_increasing():
    m = NozzleModel(id="N5", manufacturer="Acme", model="M",
                    pressure_flow_points=[{"pressure": 1, "flow": 10},
                                          {"pressure": 4, "flow": 20},
                                          {"pressure": 9, "flow": 30}])
    qs = [m.flow_at_pressure(p) for p in (1, 2, 3, 5, 8)]
    assert all(a < b for a, b in zip(qs, qs[1:]))


def test_jet_height_interpolation():
    m = NozzleModel(id="N6", manufacturer="Acme", model="H",
                    pressure_flow_points=[{"pressure": 1, "flow": 20, "jet_height": 2.0},
                                          {"pressure": 4, "flow": 40, "jet_height": 5.0}])
    assert abs(m.jet_height_at_pressure(2.25) - 3.5) < 1e-9


def test_manufacturer_catalogs():
    db = NozzleDatabase(load_defaults=False)
    n = db.load_catalog({"manufacturer": "Acme",
                         "nozzles": [{"id": "A1", "model": "J1", "k_factor": 10},
                                     {"id": "A2", "model": "J2", "k_factor": 20}]})
    db.load_catalog({"manufacturer": "Globe", "nozzles": [{"id": "G1", "model": "F1", "k_factor": 15}]})
    assert n == 2
    assert db.manufacturers() == ["Acme", "Globe"]
    assert [m.id for m in db.list_models("Acme")] == ["A1", "A2"]
    assert abs(db.query("A2", pressure=4.0)["flow"] - 40.0) < 1e-9


def test_load_catalogs_wrapper_and_default_seed():
    db = NozzleDatabase(load_defaults=False)
    loaded = db.load_catalogs({"catalogs": [
        {"manufacturer": "X", "nozzles": [{"id": "x1", "model": "m", "k_factor": 5}]},
        {"manufacturer": "Y", "nozzles": [{"id": "y1", "model": "m", "k_factor": 6}]},
    ]})
    assert loaded == 2
    # Default seed file on disk loads at least the documented models.
    seeded = NozzleDatabase()
    assert seeded.get("AF-GEYSER-25") is not None
    assert abs(seeded.query("AF-GEYSER-25", pressure=4.0)["flow"] - 84.0) < 1e-6


def test_missing_model_raises():
    import pytest
    with pytest.raises(KeyError):
        NozzleDatabase(load_defaults=False).query("nope", pressure=1.0)
