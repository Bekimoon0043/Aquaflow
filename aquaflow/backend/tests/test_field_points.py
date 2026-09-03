"""
AF-IO-002 — tests for engine/field_points.py (the quality-tagged input model).

The properties that matter:
  * a missing sample is UNKNOWN, never zero;
  * 4-20 mA under-range is FAULT with value None (broken wire ≠ empty tank);
  * 0-10 V performs NO fake broken-wire detection — 0 V is a legitimate zero;
  * staleness demotes quality but keeps the last value;
  * malformed definitions are rejected at the form, and a corrupt persisted entry
    is dropped loudly without taking the inventory down.
"""
import json

import pytest

from engine.field_points import (
    FieldPoint,
    FieldPointStore,
    PointKind,
    Quality,
    Reading,
    UNKNOWN_READING,
    CURRENT_LOOP_FAULT_MA,
)


def _ai_4_20(**over):
    base = dict(id="pressure_main", source="modbus:192.168.5.20", address="30001",
                kind="AI", signal="4-20mA", raw_min=0, raw_max=27648,
                scale=10.0 / 27648, unit="bar")
    base.update(over)
    return FieldPoint(**base)


# ── evaluation: the quality judgment ────────────────────────────────────────────
def test_missing_sample_is_unknown_not_zero():
    r = _ai_4_20().evaluate(None)
    assert r.quality == Quality.UNKNOWN
    assert r.value is None


def test_4_20ma_underrange_is_fault_with_no_value():
    p = _ai_4_20()
    # raw 0 counts = 4 mA equivalent start of span... raw BELOW raw_min maps under 4 mA.
    # With raw_min=0, raw 0 IS 4 mA (a genuine zero) — GOOD.
    good_zero = p.evaluate(0)
    assert good_zero.quality == Quality.GOOD
    assert good_zero.value == pytest.approx(0.0)
    # A cut wire reads ~0 mA. Model that via raw_min offset: ADAM-style span where
    # raw_min > 0 puts a dead loop well below raw_min.
    p2 = _ai_4_20(raw_min=5530, raw_max=27648)   # ~4 mA at 5530 counts
    r = p2.evaluate(100)                          # ≈ 0.07 mA — loop is broken
    assert r.quality == Quality.FAULT
    assert r.value is None
    assert r.raw == 100


def test_4_20ma_fault_line_is_3_5_ma():
    p = _ai_4_20(raw_min=5530, raw_max=27648)
    span = 27648 - 5530
    raw_at_3_6ma = int(5530 + span * (3.6 - 4.0) / 16.0)   # just above the line
    raw_at_3_4ma = int(5530 + span * (3.4 - 4.0) / 16.0)   # just below the line
    assert p.evaluate(raw_at_3_6ma).quality == Quality.GOOD
    assert p.evaluate(raw_at_3_4ma).quality == Quality.FAULT
    assert CURRENT_LOOP_FAULT_MA == 3.5


def test_0_10v_zero_is_honestly_good():
    # 0-10 V cannot distinguish "0 V because zero" from "0 V because cut wire".
    # No fake FAULT — a wrong diagnostic is worse than an admitted blind spot.
    p = _ai_4_20(signal="0-10V", raw_min=0, raw_max=27648)
    r = p.evaluate(0)
    assert r.quality == Quality.GOOD
    assert r.value == pytest.approx(0.0)


def test_scaling_and_int16():
    p = _ai_4_20(signal="", scale=0.1, offset=-5.0, raw_type="int16")
    assert p.evaluate(100).value == pytest.approx(5.0)
    # 0xFFFF off the wire is -1 as int16 → -0.1 - 5.0
    assert p.evaluate(0xFFFF).value == pytest.approx(-5.1)


def test_di_bool_and_invert():
    di = FieldPoint(id="estop", source="s7:192.168.5.10", address="DB1.DBX0.0",
                    kind="DI", raw_type="bool")
    assert di.evaluate(1).value is True
    assert di.evaluate(0).value is False
    inv = FieldPoint(id="door", source="s7:192.168.5.10", address="DB1.DBX0.1",
                     kind="DI", raw_type="bool", invert=True)
    assert inv.evaluate(1).value is False


def test_staleness_demotes_but_keeps_value():
    r = Reading(7.5, Quality.GOOD, ts=1000.0, raw=123)
    fresh = r.aged(now=1002.0, max_age=5.0)
    assert fresh.quality == Quality.GOOD
    stale = r.aged(now=1010.0, max_age=5.0)
    assert stale.quality == Quality.STALE
    assert stale.value == 7.5          # the operator still sees what it WAS
    assert stale.ts == 1000.0
    # UNKNOWN/FAULT never "age into" anything else.
    assert UNKNOWN_READING.aged(now=1e12).quality == Quality.UNKNOWN


# ── definition validation (fail at the form, not at poll time) ──────────────────
def test_malformed_definitions_rejected():
    with pytest.raises(ValueError):
        _ai_4_20(signal="4-20ma-ish")
    with pytest.raises(ValueError):
        _ai_4_20(binds_to="water_level")          # not a bindable input name
    with pytest.raises(ValueError):
        _ai_4_20(raw_min=27648, raw_max=0)        # inverted span with signal set
    store = FieldPointStore()
    with pytest.raises(ValueError):
        store.upsert(id="", source="x", address="0")


def test_required_defaults_false():
    # Migration is per-point: day-one behaviour must be identical to today.
    assert _ai_4_20().required is False


# ── store + persistence ─────────────────────────────────────────────────────────
def test_store_roundtrip(tmp_path):
    path = tmp_path / "field_points.json"
    store = FieldPointStore(path)
    store.upsert(id="pressure_main", source="modbus:192.168.5.20", address="30001",
                 kind="AI", signal="4-20mA", raw_min=5530, raw_max=27648,
                 scale=10.0 / 22118, unit="bar", required=True,
                 binds_to="pressure_ok")
    store.upsert(id="estop", source="s7:192.168.5.10", address="DB1.DBX0.0",
                 kind="DI", raw_type="bool", required=True,
                 binds_to="estop_chain_closed")
    store.save()

    loaded = FieldPointStore(path).load()
    assert [p.id for p in loaded.all()] == ["estop", "pressure_main"]
    p = loaded.get("pressure_main")
    assert p.kind == PointKind.AI
    assert p.required is True
    assert p.binds_to == "pressure_ok"
    assert loaded.summary()["required"] == 2
    assert loaded.by_source() == {
        "modbus:192.168.5.20": [loaded.get("pressure_main")],
        "s7:192.168.5.10": [loaded.get("estop")],
    }


def test_corrupt_entry_dropped_loudly_rest_survives(tmp_path, caplog):
    path = tmp_path / "field_points.json"
    payload = {"version": "1.0", "points": [
        {"id": "ok_point", "source": "modbus:1.2.3.4", "address": "0", "kind": "AI"},
        {"id": "bad_point", "source": "modbus:1.2.3.4", "address": "1",
         "kind": "AI", "signal": "psychic"},
    ]}
    path.write_text(json.dumps(payload), encoding="utf-8")
    with caplog.at_level("ERROR", logger="aquaflow.field_io"):
        store = FieldPointStore(path).load()
    assert store.get("ok_point") is not None
    assert store.get("bad_point") is None
    assert any("rejected" in rec.message for rec in caplog.records)


def test_upsert_replaces_and_remove(tmp_path):
    store = FieldPointStore(tmp_path / "fp.json")
    store.upsert(id="p1", source="modbus:1.2.3.4", address="0", kind="AI", scale=1.0)
    store.upsert(id="p1", source="modbus:1.2.3.4", address="0", kind="AI", scale=2.0)
    assert len(store.all()) == 1
    assert store.get("p1").scale == 2.0
    assert store.remove("p1") is True
    assert store.remove("p1") is False
