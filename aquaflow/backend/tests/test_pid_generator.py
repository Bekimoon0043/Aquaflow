"""
Contract tests for the automatic P&ID generator (AQ-S2-007).

Asserts ISA symbols are generated automatically, output is printable (well-formed
SVG + print-ready HTML), and revisions are tracked.
"""
from xml.dom import minidom

from services.pid_generator import (
    PIDGenerator, PIDEquipment, generate_pid, generate_from_network,
    normalize_equipment_type,
)


def _model():
    return {
        "title": "T", "drawing_number": "AQ-PID-1",
        "equipment": [
            {"id": "TK", "type": "reservoir", "tag": "TK-01"},
            {"id": "P", "type": "pump", "tag": "P-01"},
            {"id": "V", "type": "control_valve", "tag": "FV-01"},
            {"id": "N", "type": "geyser", "tag": "NZ-01"},
        ],
        "lines": [{"from": "TK", "to": "P"}, {"from": "P", "to": "V"}, {"from": "V", "to": "N"}],
        "instruments": [{"id": "PT1", "type": "PT", "tag_number": "101", "attached_to": "P"}],
        "revisions": [{"rev": "0", "date": "2026-07-01", "description": "IFR"}],
    }


def test_isa_symbols_auto_selected():
    svg = generate_pid(_model()).render_svg()
    dom = minidom.parseString(svg)
    isa = [g for g in dom.getElementsByTagName("g") if g.getAttribute("data-isa") == "true"]
    symtypes = {g.getAttribute("data-symbol") for g in isa}
    assert {"reservoir", "pump", "valve", "nozzle", "instrument"} <= symtypes
    assert len(isa) == 4 + 1  # 4 equipment + 1 instrument


def test_type_aliases_normalize():
    assert normalize_equipment_type("control_valve") == "valve"
    assert normalize_equipment_type("geyser") == "nozzle"
    assert normalize_equipment_type("VFD") == "pump"
    assert normalize_equipment_type("sump") == "reservoir"


def test_output_is_well_formed_svg():
    svg = generate_pid(_model()).render_svg()
    minidom.parseString(svg)               # raises on malformed XML
    assert 'viewBox="0 0' in svg
    assert 'data-block="title"' in svg


def test_printable_html_wrapper():
    html_out = generate_pid(_model()).to_printable_html()
    assert "<svg" in html_out
    assert "@media print" in html_out
    assert "window.print()" in html_out
    assert "@page" in html_out


def test_revision_autoincrement_and_stamp():
    gen = PIDGenerator()
    gen.add_equipment(PIDEquipment(id="P", type="pump"))
    assert gen.add_revision("a").rev == "0"
    assert gen.add_revision("b").rev == "1"
    assert gen.current_revision == "1"
    svg = gen.render_svg()
    assert 'data-block="revisions"' in svg
    assert "a" in svg and "b" in svg


def test_letter_revisions_increment():
    gen = PIDGenerator()
    gen.add_revision("first", rev="A")
    assert gen.add_revision("second").rev == "B"


def test_generate_from_hydraulic_network():
    gen = generate_from_network({
        "nodes": [{"id": "PUMP_OUT", "fixed_head": 55},
                  {"id": "J1", "demand": 0.01}, {"id": "J2", "demand": 0.01}],
        "pipes": [{"id": "s", "from": "PUMP_OUT", "to": "J1"},
                  {"id": "m", "from": "J1", "to": "J2"}],
    })
    minidom.parseString(gen.render_svg())
    assert any(e.type == "pump" for e in gen.equipment)
    assert sum(1 for e in gen.equipment if e.type == "nozzle") == 2
