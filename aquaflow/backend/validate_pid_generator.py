"""
validate_pid_generator.py — AquaFlow Stage 2, Priority 7 (AQ-S2-007)

Proves the three acceptance criteria for the automatic P&ID generator:
  1. Generates ISA symbols automatically (one ISA symbol per equipment/instrument,
     chosen by type without manual drawing).
  2. Produces printable output (well-formed SVG that parses as XML + a print-ready
     HTML wrapper with @media print / window.print()).
  3. Supports revision tracking (auto-incrementing revisions, a revision-history
     table, and the current revision stamped into the title block).

Headless — parses the generated SVG as XML to check structure. No browser.
Exit code 0 = all pass.

Run:  python validate_pid_generator.py
"""
import re
import sys
from xml.dom import minidom

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.pid_generator import (
    PIDGenerator, PIDEquipment, PIDLine, PIDInstrument,
    generate_pid, generate_from_network, normalize_equipment_type,
)

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, PASS if ok else FAIL, detail))


def sample_model() -> dict:
    return {
        "title": "Fountain Manifold",
        "drawing_number": "AQ-PID-100",
        "equipment": [
            {"id": "TANK1", "type": "reservoir", "tag": "TK-01", "label": "Balance Tank"},
            {"id": "PUMP1", "type": "pump", "tag": "P-01", "label": "Main Pump"},
            {"id": "V1", "type": "control_valve", "tag": "FV-01"},
            {"id": "N1", "type": "nozzle", "tag": "NZ-01"},
            {"id": "N2", "type": "geyser", "tag": "NZ-02"},
        ],
        "lines": [
            {"from": "TANK1", "to": "PUMP1", "line_number": "L-100"},
            {"from": "PUMP1", "to": "V1", "line_number": "L-101"},
            {"from": "V1", "to": "N1", "line_number": "L-102"},
            {"from": "V1", "to": "N2", "line_number": "L-103"},
        ],
        "instruments": [
            {"id": "PT101", "type": "PT", "tag_number": "101", "attached_to": "PUMP1"},
            {"id": "FT102", "type": "FT", "tag_number": "102", "attached_to": "V1"},
        ],
        "revisions": [
            {"rev": "0", "date": "2026-07-01", "description": "Issued for review", "by": "CC"},
        ],
    }


# ── Criterion 1: ISA symbols generated automatically ───────────────────────────
def test_isa_symbols():
    gen = generate_pid(sample_model())
    svg = gen.render_svg()
    dom = minidom.parseString(svg)  # will raise if malformed

    groups = dom.getElementsByTagName("g")
    isa_syms = [g for g in groups if g.getAttribute("data-isa") == "true"]
    check("ISA: an ISA symbol emitted per equipment + instrument",
          len(isa_syms) == 5 + 2, f"count={len(isa_syms)}")

    symtypes = {g.getAttribute("data-symbol") for g in isa_syms}
    check("ISA: pump symbol auto-selected", "pump" in symtypes, f"{symtypes}")
    check("ISA: valve symbol auto-selected from 'control_valve'", "valve" in symtypes, f"{symtypes}")
    check("ISA: reservoir symbol auto-selected", "reservoir" in symtypes, f"{symtypes}")
    check("ISA: nozzle symbol auto-selected (incl. 'geyser' alias)",
          "nozzle" in symtypes, f"{symtypes}")
    check("ISA: instrument balloons rendered", "instrument" in symtypes, f"{symtypes}")

    # Instrument ISA tag letters appear as text.
    txt = svg
    check("ISA: instrument tag letters present (PT/FT)", "PT" in txt and "FT" in txt, "")
    check("ISA: alias mapping is automatic (geyser→nozzle)",
          normalize_equipment_type("geyser") == "nozzle", "")


# ── Criterion 2: printable output ──────────────────────────────────────────────
def test_printable_output():
    gen = generate_pid(sample_model())
    svg = gen.render_svg()

    # Well-formed XML (printable vector).
    try:
        minidom.parseString(svg)
        wellformed = True
    except Exception as ex:
        wellformed = False
        check("Printable: SVG is well-formed XML", False, str(ex))
    if wellformed:
        check("Printable: SVG is well-formed XML", True, "")

    check("Printable: SVG has a viewBox (scales for print)",
          'viewBox="0 0' in svg, "")
    check("Printable: has a drawing title block", 'data-block="title"' in svg, "")

    html_out = gen.to_printable_html()
    check("Printable: HTML wrapper embeds the SVG", "<svg" in html_out, "")
    check("Printable: HTML has @media print rules", "@media print" in html_out, "")
    check("Printable: HTML has a print action", "window.print()" in html_out, "")
    check("Printable: HTML sets a page size for printing", "@page" in html_out, "")


# ── Criterion 3: revision tracking ─────────────────────────────────────────────
def test_revision_tracking():
    gen = PIDGenerator(title="T", drawing_number="D")
    gen.add_equipment(PIDEquipment(id="P1", type="pump", tag="P-01"))

    r0 = gen.add_revision("Issued for construction", by="CC")
    check("Revisions: first revision defaults to 0", r0.rev == "0", f"rev={r0.rev}")
    r1 = gen.add_revision("Added bypass valve", by="CC")
    check("Revisions: revision id auto-increments", r1.rev == "1", f"rev={r1.rev}")
    r2 = gen.add_revision("Resized pump", by="DS")
    check("Revisions: current revision tracks the latest",
          gen.current_revision == "2", f"cur={gen.current_revision}")

    svg = gen.render_svg()
    check("Revisions: revision-history table rendered",
          'data-block="revisions"' in svg, "")
    check("Revisions: all revision descriptions appear in the table",
          all(x in svg for x in ("Issued for construction", "Added bypass valve", "Resized pump")), "")
    check("Revisions: current rev stamped in the title block", ">2<" in svg, "")

    # Letter-based revisions increment A→B→C.
    gen2 = PIDGenerator()
    gen2.add_revision("first", rev="A")
    b = gen2.add_revision("second")
    check("Revisions: letter revisions increment (A→B)", b.rev == "B", f"rev={b.rev}")


# ── Bonus: generate straight from a hydraulic network ──────────────────────────
def test_generate_from_network():
    network = {
        "title": "Recirc Loop",
        "nodes": [
            {"id": "PUMP_OUT", "fixed_head": 55},
            {"id": "J1", "demand": 0.01},
            {"id": "J2", "demand": 0.01},
        ],
        "pipes": [
            {"id": "supply", "from": "PUMP_OUT", "to": "J1"},
            {"id": "m1", "from": "J1", "to": "J2"},
        ],
        "revisions": [{"description": "Auto-generated from hydraulic model"}],
    }
    gen = generate_from_network(network)
    svg = gen.render_svg()
    minidom.parseString(svg)
    check("Network→P&ID: fixed-head node became a pump symbol",
          any(e.type == "pump" for e in gen.equipment), f"{[e.type for e in gen.equipment]}")
    check("Network→P&ID: demand nodes became nozzles",
          sum(1 for e in gen.equipment if e.type == "nozzle") == 2, "")
    check("Network→P&ID: auto revision recorded", gen.current_revision == "0", f"{gen.current_revision}")


def main() -> int:
    for fn in (test_isa_symbols, test_printable_output, test_revision_tracking,
               test_generate_from_network):
        fn()

    print("\n" + "=" * 72)
    print("AQ-S2-007 Automatic P&ID Generator — Verification")
    print("=" * 72)
    passed = 0
    for name, status, detail in results:
        mark = "[PASS]" if status == PASS else "[FAIL]"
        line = f"{mark} {name}"
        if status == FAIL and detail:
            line += f"  --> {detail}"
        print(line)
        if status == PASS:
            passed += 1
    total = len(results)
    print("-" * 72)
    print(f"{passed}/{total} checks passed")
    print("=" * 72)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
