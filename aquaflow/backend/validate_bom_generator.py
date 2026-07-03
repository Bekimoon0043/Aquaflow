"""
validate_bom_generator.py — AquaFlow Stage 2, Priority 9 (AQ-S2-009)

Proves the three acceptance criteria for the automatic BOM generator:
  1. Quantities are generated automatically (identical items counted, pipe runs
     summed by diameter/material).
  2. Supplier references are supported (manufacturer / part number / supplier /
     unit cost pulled from the parts catalog; costs rolled up).
  3. Excel export is supported (a real .xlsx workbook that opens and reads back
     with the correct cell values).

The .xlsx is validated two ways: structurally (unzip + parse sheet XML) and, when
available, by reading it back with openpyxl — an independent Excel library — as
the strongest proof the file is genuinely valid Excel. No server. Exit 0 = pass.

Run:  python validate_bom_generator.py
"""
import io
import sys
import zipfile
from xml.dom import minidom

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.bom_generator import BOMGenerator, generate_bom, generate_from_network, build_xlsx

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, PASS if ok else FAIL, detail))


def sample_model() -> dict:
    return {
        "project": "Plaza Fountain",
        "currency": "USD",
        "equipment": [
            {"type": "pump", "label": "Main Pump", "part_number": "pump", "quantity": 1},
            {"type": "pump", "label": "Backup Pump", "part_number": "pump", "quantity": 1},
        ],
        "nozzles": [
            {"model": "AF-GEYSER-25"}, {"model": "AF-GEYSER-25"}, {"model": "AF-GEYSER-25"},
            {"model": "AF-CROWN-15"}, {"model": "AF-CROWN-15"},
        ],
        "pipes": [
            {"diameter": 0.1, "length": 12.0, "material": "PVC"},
            {"diameter": 0.1, "length": 8.0, "material": "PVC"},   # same DN → summed
            {"diameter": 0.05, "length": 20.0, "material": "PVC"},
        ],
        "valves": [
            {"type": "control_valve", "size": "DN100", "quantity": 2},
        ],
        "instruments": [
            {"type": "PT", "quantity": 1}, {"type": "FT", "quantity": 1},
        ],
    }


# ── Criterion 1: automatic quantities ──────────────────────────────────────────
def test_auto_quantities():
    gen = BOMGenerator().generate(sample_model())
    rows = {(l.category, l.part_number): l for l in gen.lines}

    pump = next(l for l in gen.lines if l.category == "pump")
    check("Qty: two identical pumps counted as quantity 2", pump.quantity == 2, f"qty={pump.quantity}")

    geyser = next(l for l in gen.lines if "GEYSER" in l.part_number)
    crown = next(l for l in gen.lines if "CROWN" in l.part_number)
    check("Qty: nozzles grouped by model (3 geyser, 2 crown)",
          geyser.quantity == 3 and crown.quantity == 2,
          f"geyser={geyser.quantity} crown={crown.quantity}")

    dn100 = next(l for l in gen.lines if l.category == "pipe" and "DN100" in l.description)
    check("Qty: same-diameter pipe runs summed (12+8=20 m)", abs(dn100.quantity - 20.0) < 1e-9,
          f"len={dn100.quantity}")
    dn50 = next(l for l in gen.lines if l.category == "pipe" and "DN50" in l.description)
    check("Qty: distinct diameter kept separate (DN50 = 20 m)", abs(dn50.quantity - 20.0) < 1e-9,
          f"len={dn50.quantity}")

    valve = next(l for l in gen.lines if l.category == "valve")
    check("Qty: valves counted (2)", valve.quantity == 2, f"qty={valve.quantity}")


# ── Criterion 2: supplier references ───────────────────────────────────────────
def test_supplier_references():
    gen = BOMGenerator().generate(sample_model())
    pump = next(l for l in gen.lines if l.category == "pump")
    check("Supplier: pump line carries manufacturer + supplier + part number",
          pump.manufacturer == "Grundfos" and pump.supplier == "Grundfos Distribution"
          and pump.part_number == "pump", f"{pump.to_dict()}")
    check("Supplier: pump has a unit cost from the catalog", pump.unit_cost == 1850.0,
          f"unit_cost={pump.unit_cost}")
    check("Supplier: total cost = quantity * unit cost", pump.total_cost == 2 * 1850.0,
          f"total={pump.total_cost}")

    dn100 = next(l for l in gen.lines if l.category == "pipe" and "DN100" in l.description)
    check("Supplier: pipe line resolves catalog supplier reference",
          dn100.supplier == "GF Piping Systems" and dn100.unit_cost == 15.8, f"{dn100.to_dict()}")

    geyser = next(l for l in gen.lines if "GEYSER" in l.part_number)
    check("Supplier: nozzle supplier reference resolved", geyser.supplier == "AquaFlow Parts"
          and geyser.unit_cost == 95.0, f"{geyser.to_dict()}")

    total = gen.total_cost()
    hand = (2 * 1850.0) + (3 * 95.0) + (2 * 62.0) + (20.0 * 15.8) + (20.0 * 6.4) \
        + (2 * 420.0) + (1 * 240.0) + (1 * 1100.0)
    check("Supplier: grand total matches independent hand calc",
          abs(total - round(hand, 2)) < 1e-6, f"total={total} hand={round(hand,2)}")


# ── Criterion 3: Excel export ──────────────────────────────────────────────────
def test_excel_export():
    gen = BOMGenerator().generate(sample_model())
    xlsx = gen.to_xlsx_bytes()

    check("Excel: produces non-trivial bytes", isinstance(xlsx, bytes) and len(xlsx) > 500,
          f"len={len(xlsx)}")

    # Structural: it is a zip with the required OOXML parts.
    zf = zipfile.ZipFile(io.BytesIO(xlsx))
    names = set(zf.namelist())
    required = {"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
                "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"}
    check("Excel: valid OOXML package (required parts present)", required <= names,
          f"missing={required - names}")
    # Sheet XML parses and contains a header + the pump total.
    sheet = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
    minidom.parseString(sheet)
    check("Excel: sheet contains BOM headers", "Part Number" in sheet and "Supplier" in sheet, "")

    # Independent proof: read back with openpyxl if present.
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(xlsx))
        ws = wb.active
        header = [c.value for c in ws[1]]
        check("Excel: openpyxl reads it back as a valid workbook",
              header[0] == "Item" and "Supplier" in header, f"header={header}")
        # The last row is the TOTAL row; find it.
        total_row = [r for r in ws.iter_rows(values_only=True) if r[2] == "TOTAL"]
        check("Excel: TOTAL row present and numeric via openpyxl",
              bool(total_row) and isinstance(total_row[0][9], (int, float)),
              f"total_row={total_row[0] if total_row else None}")
        # A pump quantity cell reads back as the number 2.
        cells = [r for r in ws.iter_rows(values_only=True) if r[1] == "pump"]
        check("Excel: pump quantity reads back as numeric 2 via openpyxl",
              bool(cells) and cells[0][3] == 2, f"pump_row={cells[0] if cells else None}")
    except ImportError:
        check("Excel: openpyxl reader not installed (structural check only)", True,
              "openpyxl absent — skipped read-back")


# ── Bonus: generate from a hydraulic network + dict API ────────────────────────
def test_network_and_dict_api():
    out = generate_from_network({
        "nodes": [{"id": "PUMP_OUT", "fixed_head": 55},
                  {"id": "J1", "demand": 0.01, "nozzle_model": "AF-GEYSER-25"},
                  {"id": "J2", "demand": 0.01, "nozzle_model": "AF-GEYSER-25"}],
        "pipes": [{"id": "s", "from": "PUMP_OUT", "to": "J1", "diameter": 0.1, "length": 10, "material": "PVC"},
                  {"id": "m", "from": "J1", "to": "J2", "diameter": 0.1, "length": 5, "material": "PVC"}],
    })
    check("Network BOM: dict API returns lines + summary",
          "lines" in out and "summary" in out and out["summary"]["line_count"] >= 2, f"{out['summary']}")
    pipe_lines = [l for l in out["lines"] if l["category"] == "pipe"]
    check("Network BOM: pipe runs summed from network (15 m DN100)",
          any(abs(l["quantity"] - 15.0) < 1e-6 for l in pipe_lines), f"{pipe_lines}")


def main() -> int:
    for fn in (test_auto_quantities, test_supplier_references, test_excel_export,
               test_network_and_dict_api):
        fn()

    print("\n" + "=" * 72)
    print("AQ-S2-009 Automatic BOM Generator — Verification")
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
