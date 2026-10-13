"""
bom_generator.py — AquaFlow Stage 2, Priority 9 (AQ-S2-009)

Automatic Bill of Materials (BOM) generator.

Rolls an AquaFlow design (equipment, pipes, nozzles, valves, fittings,
instruments — or a whole hydraulic network) up into a costed bill of materials:

  * quantities are generated automatically — identical items are counted and pipe
    runs are summed by diameter/material,
  * each line is enriched with supplier references (manufacturer, part number,
    supplier, unit cost) from a parts catalog + the nozzle database,
  * the BOM exports to a real .xlsx workbook (self-contained writer, no external
    dependency) as well as CSV / JSON.

Currency and units are carried through untouched; costs are unit_cost * quantity.

AF-NEXT-012 — every line cites its equipment model, data source
(manufacturer_datasheet / user_measured / generic_estimate), confidence, units and
data revision, and the CSV/XLSX exports carry those columns. Supplier references and
prices in data/parts_catalog.json are illustrative placeholders (generic estimates).
"""
from __future__ import annotations

import csv
import io
import json
import zipfile
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape

from services.equipment_provenance import (
    cite, normalize_provenance, summarize, units_text,
)

DATA_DIR = Path(__file__).parent.parent / "data"
PARTS_CATALOG_FILE = DATA_DIR / "parts_catalog.json"


@dataclass
class BOMLine:
    item: int
    category: str
    description: str
    quantity: float
    unit: str = "ea"
    manufacturer: str = ""
    part_number: str = ""
    supplier: str = ""
    unit_cost: float = 0.0
    currency: str = "USD"
    notes: str = ""
    # AF-NEXT-012 citation: equipment_model, data_source, confidence, units, revision.
    citation: dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.citation:
            self.citation = cite(None, equipment_model=self.part_number or self.description,
                                 kind=_kind_for(self.category))

    @classmethod
    def from_dict(cls, d: dict) -> "BOMLine":
        cit = d.get("citation") or {}
        if not cit and d.get("data_source"):
            cit = {"equipment_model": d.get("equipment_model", ""),
                   "manufacturer": d.get("manufacturer", ""),
                   "data_source": d.get("data_source"),
                   "source_label": d.get("source_label", ""),
                   "confidence": d.get("confidence", "low"),
                   "units": d.get("units_basis_map") or {},
                   "revision": d.get("data_revision", ""),
                   "document": d.get("source_document", "")}
        return cls(item=d["item"], category=d["category"], description=d["description"],
                   quantity=d["quantity"], unit=d.get("unit", "ea"),
                   manufacturer=d.get("manufacturer", ""), part_number=d.get("part_number", ""),
                   supplier=d.get("supplier", ""), unit_cost=d.get("unit_cost", 0.0),
                   currency=d.get("currency", "USD"), notes=d.get("notes", ""), citation=cit)

    @property
    def total_cost(self) -> float:
        return round(self.quantity * self.unit_cost, 2)

    def to_dict(self) -> dict:
        d = {
            "item": self.item,
            "category": self.category,
            "description": self.description,
            "quantity": round(self.quantity, 4),
            "unit": self.unit,
            "manufacturer": self.manufacturer,
            "part_number": self.part_number,
            "supplier": self.supplier,
            "unit_cost": round(self.unit_cost, 2),
            "currency": self.currency,
            "total_cost": self.total_cost,
            "notes": self.notes,
            "equipment_model": self.citation.get("equipment_model", ""),
            "data_source": self.citation.get("data_source", "generic_estimate"),
            "source_label": self.citation.get("source_label", ""),
            "confidence": self.citation.get("confidence", "low"),
            "units_basis": units_text(self.citation.get("units")),
            "units_basis_map": dict(self.citation.get("units") or {}),
            "data_revision": self.citation.get("revision", ""),
            "source_document": self.citation.get("document", ""),
            "citation": dict(self.citation),
        }
        return d


def _kind_for(category: str) -> str:
    c = str(category or "").lower()
    for k in ("nozzle", "pump", "valve", "light", "pipe"):
        if k in c:
            return k
    return "equipment"


class BOMGenerator:
    COLUMNS = ["Item", "Category", "Description", "Qty", "Unit", "Manufacturer",
               "Part Number", "Supplier", "Unit Cost", "Total Cost", "Notes",
               # AF-NEXT-012 provenance columns (appended — earlier indexes unchanged)
               "Equipment Model", "Data Source", "Confidence", "Units Basis",
               "Data Revision", "Source Document"]

    def __init__(self, project: str = "AquaFlow Studio",
                 catalog: Optional[dict] = None, currency: str = "USD"):
        self.project = project
        self.currency = currency
        self.catalog = catalog if catalog is not None else self._load_catalog()
        self.lines: list[BOMLine] = []

    # ── Catalog / supplier references ──────────────────────────────────────────
    @staticmethod
    def _load_catalog() -> dict:
        if PARTS_CATALOG_FILE.exists():
            try:
                return json.loads(PARTS_CATALOG_FILE.read_text())
            except Exception:
                return {}
        return {}

    def _lookup(self, *keys) -> dict:
        """Return the first matching catalog entry for any of the given keys."""
        parts = self.catalog.get("parts", self.catalog) if isinstance(self.catalog, dict) else {}
        for k in keys:
            if k and k in parts:
                return parts[k]
        return {}

    # ── Generation ─────────────────────────────────────────────────────────────
    def generate(self, model: dict) -> "BOMGenerator":
        """Aggregate a design model into costed BOM lines."""
        self.lines = []

        # 1) Equipment — count identical (category, part) combinations.
        eq_groups: dict[tuple, dict] = {}
        for e in model.get("equipment", []):
            cat = str(e.get("type", "equipment"))
            part = str(e.get("part_number") or e.get("model") or "")
            key = (cat, part)
            g = eq_groups.setdefault(key, {"qty": 0, "sample": e})
            g["qty"] += float(e.get("quantity", 1) or 1)

        # 2) Nozzles — count by model, enrich from the nozzle database.
        noz_groups: dict[str, float] = {}
        noz_samples: dict[str, dict] = {}
        for n in model.get("nozzles", []):
            model_id = str(n.get("model") or n.get("id") or "nozzle")
            noz_groups[model_id] = noz_groups.get(model_id, 0.0) + float(n.get("quantity", 1) or 1)
            noz_samples.setdefault(model_id, n)

        # 3) Pipes — sum length by (diameter, material).
        pipe_groups: dict[tuple, float] = {}
        for p in model.get("pipes", []):
            d_mm = self._diameter_mm(p)
            material = str(p.get("material", "PVC"))
            key = (d_mm, material)
            pipe_groups[key] = pipe_groups.get(key, 0.0) + float(p.get("length", 0) or 0)

        # 4) Valves / fittings / instruments — count by type+size / tag.
        misc_groups: dict[tuple, dict] = {}
        for coll, cat in (("valves", "valve"), ("fittings", "fitting"),
                          ("instruments", "instrument")):
            for it in model.get(coll, []):
                typ = str(it.get("type", cat))
                size = str(it.get("size", it.get("diameter", "")))
                part = str(it.get("part_number") or it.get("model") or "")
                key = (cat, typ, size, part)
                g = misc_groups.setdefault(key, {"qty": 0, "sample": it})
                g["qty"] += float(it.get("quantity", 1) or 1)

        # ── Emit lines ──────────────────────────────────────────────────────────
        item = 0
        for (cat, part), g in sorted(eq_groups.items()):
            item += 1
            ref = self._lookup(part, f"{cat}:{part}", cat)
            line = self._line(item, cat, g["sample"], g["qty"], "ea", ref, part)
            line.citation = self._citation(g["sample"], kind=_kind_for(cat),
                                           model=part or str(g["sample"].get("type") or cat))
            self.lines.append(line)

        for model_id, qty in sorted(noz_groups.items()):
            item += 1
            noz = self._nozzle_info(model_id)
            ref = self._lookup(model_id, f"nozzle:{model_id}")
            desc = noz.get("description") or f"Nozzle {model_id}"
            sample = noz_samples.get(model_id) or {}
            citation = noz.get("citation") or self._citation(sample, kind="nozzle", model=model_id)
            self.lines.append(BOMLine(
                item=item, category="nozzle", description=desc, quantity=qty, unit="ea",
                manufacturer=ref.get("manufacturer", noz.get("manufacturer", "")),
                part_number=ref.get("part_number", model_id),
                supplier=ref.get("supplier", ""),
                unit_cost=float(ref.get("unit_cost", 0.0)), currency=self.currency,
                notes=noz.get("notes", ""), citation=citation,
            ))

        for (d_mm, material), length in sorted(pipe_groups.items()):
            item += 1
            key = f"pipe:{material}:DN{int(d_mm)}"
            ref = self._lookup(key, f"pipe:DN{int(d_mm)}")
            self.lines.append(BOMLine(
                item=item, category="pipe",
                description=f"{material} pipe DN{int(d_mm)}",
                quantity=round(length, 3), unit="m",
                manufacturer=ref.get("manufacturer", ""),
                part_number=ref.get("part_number", key),
                supplier=ref.get("supplier", ""),
                unit_cost=float(ref.get("unit_cost", 0.0)), currency=self.currency,
                notes=ref.get("notes", ""),
                citation=cite(None, equipment_model=f"{material} pipe DN{int(d_mm)}", kind="pipe",
                              units={"length": "m", "nominal_size": "DN (mm)"}),
            ))

        for (cat, typ, size, part), g in sorted(misc_groups.items()):
            item += 1
            ref = self._lookup(part, f"{cat}:{typ}:{size}", f"{cat}:{typ}", typ)
            desc = f"{typ}" + (f" {size}" if size else "")
            self.lines.append(BOMLine(
                item=item, category=cat, description=desc, quantity=g["qty"], unit="ea",
                manufacturer=ref.get("manufacturer", ""),
                part_number=ref.get("part_number", part),
                supplier=ref.get("supplier", ""),
                unit_cost=float(ref.get("unit_cost", 0.0)), currency=self.currency,
                notes=ref.get("notes", ""),
                citation=self._citation(g["sample"], kind=_kind_for(cat), model=part or desc),
            ))

        return self

    @staticmethod
    def _citation(sample: dict, kind: str, model: str) -> dict:
        """Citation for a design item. A verified registry model named by
        ``equipment_model_id`` wins; then a provenance block carried by the item
        (normalised — incomplete trust claims downgrade to generic); else generic."""
        sample = sample if isinstance(sample, dict) else {}
        reg_id = sample.get("equipment_model_id")
        if reg_id and kind in ("nozzle", "pump", "valve", "light"):
            try:
                from services.equipment_registry import get_equipment_registry
                rec = get_equipment_registry().get(kind, str(reg_id))
                if rec is not None:
                    return cite(rec["provenance"], equipment_model=rec["id"], kind=kind)
            except Exception:
                pass
        prov = normalize_provenance(sample.get("provenance"), kind=kind, model=model)
        return cite(prov, equipment_model=model, kind=kind)

    def _line(self, item, cat, sample, qty, unit, ref, part) -> BOMLine:
        return BOMLine(
            item=item, category=cat,
            description=str(sample.get("label") or ref.get("description") or f"{cat} {part}".strip()),
            quantity=qty, unit=unit,
            manufacturer=str(sample.get("manufacturer") or ref.get("manufacturer", "")),
            part_number=str(part or ref.get("part_number", "")),
            supplier=ref.get("supplier", ""),
            unit_cost=float(ref.get("unit_cost", 0.0)), currency=self.currency,
            notes=ref.get("notes", ""),
        )

    @staticmethod
    def _diameter_mm(pipe: dict) -> int:
        d = pipe.get("diameter_mm")
        if d is None:
            d_m = pipe.get("diameter")
            d = float(d_m) * 1000.0 if d_m is not None else 0.0
        return int(round(float(d)))

    def _nozzle_info(self, model_id: str) -> dict:
        try:
            from services.nozzle_database import get_nozzle_database
            m = get_nozzle_database().get(model_id)
            if m is not None:
                return {"manufacturer": m.manufacturer,
                        "description": f"{m.manufacturer} {m.model}".strip(),
                        "notes": m.notes,
                        "citation": m.citation()}
        except Exception:
            pass
        return {}

    # ── Totals ──────────────────────────────────────────────────────────────────
    def total_cost(self) -> float:
        return round(sum(l.total_cost for l in self.lines), 2)

    def summary(self) -> dict:
        by_cat: dict[str, float] = {}
        for l in self.lines:
            by_cat[l.category] = round(by_cat.get(l.category, 0.0) + l.total_cost, 2)
        return {
            "line_count": len(self.lines),
            "total_quantity_items": round(sum(l.quantity for l in self.lines if l.unit == "ea"), 3),
            "total_cost": self.total_cost(),
            "currency": self.currency,
            "cost_by_category": by_cat,
            "data_provenance": summarize([l.citation for l in self.lines]),
        }

    # ── Exports ─────────────────────────────────────────────────────────────────
    def to_rows(self) -> list[dict]:
        return [l.to_dict() for l in self.lines]

    def _matrix(self) -> tuple[list[str], list[list]]:
        rows = []
        for l in self.lines:
            c = l.citation
            rows.append([l.item, l.category, l.description, round(l.quantity, 4), l.unit,
                         l.manufacturer, l.part_number, l.supplier,
                         round(l.unit_cost, 2), l.total_cost, l.notes,
                         c.get("equipment_model", ""), c.get("source_label") or c.get("data_source", ""),
                         c.get("confidence", ""), units_text(c.get("units")),
                         c.get("revision", ""), c.get("document", "")])
        # Total row.
        rows.append(["", "", "TOTAL", "", "", "", "", "", "", self.total_cost(), "",
                     "", "", "", "", "", ""])
        return self.COLUMNS, rows

    def to_csv(self) -> str:
        header, rows = self._matrix()
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(header)
        w.writerows(rows)
        return buf.getvalue()

    def to_xlsx_bytes(self) -> bytes:
        header, rows = self._matrix()
        return build_xlsx(sheet_name="BOM", header=header, rows=rows)


# ── Self-contained minimal XLSX writer (no external dependency) ────────────────
def _col_ref(idx: int) -> str:
    """0-based column index → spreadsheet column letters (A, B, ..., Z, AA...)."""
    s = ""
    idx += 1
    while idx > 0:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def _cell_xml(col: int, row: int, value) -> str:
    ref = f"{_col_ref(col)}{row}"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"><v>{value}</v></c>'
    text = escape(str(value))
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


def build_xlsx(sheet_name: str, header: list[str], rows: list[list]) -> bytes:
    """Build a minimal but valid .xlsx workbook (single sheet) as bytes."""
    all_rows = [header] + rows
    sheet_rows = []
    for r_i, row in enumerate(all_rows, start=1):
        cells = "".join(_cell_xml(c_i, r_i, val) for c_i, val in enumerate(row))
        sheet_rows.append(f'<row r="{r_i}">{cells}</row>')
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{escape(sheet_name)}" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '</Relationships>'
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        z.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    return buf.getvalue()


# ── Dict / network convenience APIs ────────────────────────────────────────────
def generate_bom(model: dict) -> dict:
    gen = BOMGenerator(project=model.get("project", "AquaFlow Studio"),
                       currency=model.get("currency", "USD"))
    gen.generate(model)
    return {
        "project": gen.project,
        "generated": date.today().isoformat(),
        "columns": gen.COLUMNS,
        "lines": gen.to_rows(),
        "summary": gen.summary(),
    }


def generate_from_network(network: dict) -> dict:
    """Build a BOM from a hydraulic-solver network: pipes → pipe runs by diameter,
    fixed-head nodes → pumps, demand nodes → nozzles."""
    model = {"project": network.get("project", "AquaFlow Studio"),
             "equipment": [], "pipes": [], "nozzles": []}
    for n in network.get("nodes", []):
        if n.get("fixed_head") is not None:
            model["equipment"].append({"type": "pump", "label": str(n.get("id")),
                                       "part_number": n.get("part_number", ""), "quantity": 1})
        elif float(n.get("demand", 0) or 0) > 0:
            model["nozzles"].append({"model": n.get("nozzle_model", "nozzle"), "quantity": 1})
    for p in network.get("pipes", []):
        model["pipes"].append({"diameter": p.get("diameter"), "length": p.get("length", 0),
                               "material": p.get("material", "PVC")})
    return generate_bom(model)
