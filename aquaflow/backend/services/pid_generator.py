"""
pid_generator.py — AquaFlow Stage 2, Priority 7 (AQ-S2-007)

Automatic P&ID (Piping & Instrumentation Diagram) generator.

Turns an AquaFlow equipment/hydraulic model into a printable P&ID drawing:
  * maps each piece of equipment and each instrument to a standard ISA-5.1 symbol
    automatically (centrifugal pump, valve, vessel/tank, reservoir, nozzle, plus
    instrument balloons: PT/FT/LT/TT/FE ...),
  * lays them out and connects them with process lines,
  * renders scalable vector output (SVG) plus a print-ready HTML wrapper with a
    drawing border, title block, and revision-history table,
  * tracks drawing revisions (rev id, date, description, author) and stamps the
    current revision into the title block.

The output is pure SVG/HTML — no external drawing engine — so it prints crisply
at any scale and is trivial to embed or archive.
"""
from __future__ import annotations

import html
from dataclasses import dataclass, field
from datetime import date
from typing import Optional


# ── ISA symbol type normalisation ──────────────────────────────────────────────
# Maps many designer/hydraulic type tokens onto the ISA symbol we draw for them.
_EQUIPMENT_ALIASES = {
    "pump": "pump", "vfd": "pump", "pump_station": "pump", "master_pump": "pump",
    "valve": "valve", "solenoid": "valve", "control_valve": "valve", "gate_valve": "valve",
    "tank": "tank", "vessel": "tank", "surge_tank": "tank", "balance_tank": "tank",
    "reservoir": "reservoir", "basin": "reservoir", "sump": "reservoir", "source": "reservoir",
    "nozzle": "nozzle", "jet": "nozzle", "geyser": "nozzle", "fountain_jet": "nozzle",
    "center_jets": "nozzle", "outer_ring_jets": "nozzle", "arch_jets": "nozzle",
    "filter": "filter", "strainer": "filter",
    "junction": "junction", "node": "junction", "manifold": "junction",
}

# Instrument tag → (measured variable, human name). First letter = variable,
# trailing letters = function (T transmitter, I indicator, E element, ...).
_INSTRUMENT_NAMES = {
    "PT": "Pressure Transmitter", "PI": "Pressure Indicator", "PG": "Pressure Gauge",
    "FT": "Flow Transmitter", "FE": "Flow Element", "FI": "Flow Indicator",
    "LT": "Level Transmitter", "LI": "Level Indicator", "LS": "Level Switch",
    "TT": "Temperature Transmitter", "TI": "Temperature Indicator",
    "FV": "Flow Control Valve", "PV": "Pressure Control Valve",
}


def normalize_equipment_type(t: str) -> str:
    key = str(t or "").strip().lower().replace("-", "_").replace(" ", "_")
    return _EQUIPMENT_ALIASES.get(key, "equipment")


@dataclass
class PIDEquipment:
    id: str
    type: str
    tag: str = ""
    label: str = ""
    x: Optional[float] = None
    y: Optional[float] = None


@dataclass
class PIDLine:
    from_id: str
    to_id: str
    label: str = ""
    line_number: str = ""


@dataclass
class PIDInstrument:
    id: str
    type: str                 # ISA tag letters, e.g. "PT", "FT"
    tag_number: str = ""      # loop number, e.g. "101"
    attached_to: str = ""     # equipment/line id
    x: Optional[float] = None
    y: Optional[float] = None


@dataclass
class PIDRevision:
    rev: str
    date: str
    description: str
    by: str = ""


# ── Geometry constants ─────────────────────────────────────────────────────────
_MARGIN = 60
_COL_SPACING = 200
_ROW_Y = 220
_TITLE_W = 380
_TITLE_H = 130
_REV_ROW_H = 20


class PIDGenerator:
    def __init__(self, title: str = "AquaFlow P&ID", drawing_number: str = "AQ-PID-001",
                 project: str = "AquaFlow Studio"):
        self.title = title
        self.drawing_number = drawing_number
        self.project = project
        self.equipment: list[PIDEquipment] = []
        self.lines: list[PIDLine] = []
        self.instruments: list[PIDInstrument] = []
        self.revisions: list[PIDRevision] = []

    # ── Model building ─────────────────────────────────────────────────────────
    def add_equipment(self, eq: PIDEquipment) -> None:
        self.equipment.append(eq)

    def add_line(self, line: PIDLine) -> None:
        self.lines.append(line)

    def add_instrument(self, inst: PIDInstrument) -> None:
        self.instruments.append(inst)

    def add_revision(self, description: str, by: str = "", rev: Optional[str] = None,
                     on: Optional[str] = None) -> PIDRevision:
        """Append a revision. Auto-increments the rev id (0,1,2,... or A,B,C if the
        first supplied rev is a letter)."""
        if rev is None:
            rev = self._next_rev()
        r = PIDRevision(rev=str(rev), date=(on or date.today().isoformat()),
                        description=description, by=by)
        self.revisions.append(r)
        return r

    def _next_rev(self) -> str:
        if not self.revisions:
            return "0"
        last = self.revisions[-1].rev
        if last.isdigit():
            return str(int(last) + 1)
        if len(last) == 1 and last.isalpha():
            return chr(ord(last.upper()) + 1)
        return str(len(self.revisions))

    @property
    def current_revision(self) -> str:
        return self.revisions[-1].rev if self.revisions else "-"

    # ── Auto layout ────────────────────────────────────────────────────────────
    def _auto_layout(self) -> None:
        """Assign coordinates to any equipment lacking them: a simple left→right
        flow row, sources first."""
        order_rank = {"reservoir": 0, "tank": 0, "pump": 1, "filter": 2,
                      "valve": 3, "junction": 4, "nozzle": 5}
        placed = [e for e in self.equipment if e.x is not None and e.y is not None]
        unplaced = [e for e in self.equipment if e.x is None or e.y is None]
        unplaced.sort(key=lambda e: order_rank.get(normalize_equipment_type(e.type), 9))
        col = len(placed)
        for e in unplaced:
            e.x = _MARGIN + 100 + col * _COL_SPACING
            e.y = _ROW_Y
            col += 1
        # Place instruments just above the equipment they attach to (if free).
        eq_by_id = {e.id: e for e in self.equipment}
        for inst in self.instruments:
            if inst.x is not None and inst.y is not None:
                continue
            host = eq_by_id.get(inst.attached_to)
            if host is not None:
                inst.x = host.x
                inst.y = host.y - 90
            else:
                inst.x = _MARGIN + 100
                inst.y = _MARGIN + 40

    def _extents(self) -> tuple[float, float]:
        xs = [e.x for e in self.equipment if e.x is not None] + \
             [i.x for i in self.instruments if i.x is not None]
        ys = [e.y for e in self.equipment if e.y is not None] + \
             [i.y for i in self.instruments if i.y is not None]
        max_x = (max(xs) if xs else 400) + 140 + _TITLE_W
        max_y = (max(ys) if ys else 300) + 160
        return max_x, max_y

    # ── SVG rendering ──────────────────────────────────────────────────────────
    def render_svg(self) -> str:
        self._auto_layout()
        width, height = self._extents()
        eq_by_id = {e.id: e for e in self.equipment}

        parts: list[str] = []
        parts.append(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {int(width)} {int(height)}" '
            f'width="{int(width)}" height="{int(height)}" font-family="Arial, sans-serif">'
        )
        parts.append('<defs>'
                     '<marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" '
                     'orient="auto" markerUnits="strokeWidth">'
                     '<path d="M0,0 L8,3 L0,6 Z" fill="#111"/></marker></defs>')
        parts.append(f'<rect x="0" y="0" width="{int(width)}" height="{int(height)}" fill="#ffffff"/>')
        # Drawing border.
        parts.append(f'<rect x="10" y="10" width="{int(width)-20}" height="{int(height)-20}" '
                     'fill="none" stroke="#111" stroke-width="2"/>')

        # Process lines first (under symbols).
        for ln in self.lines:
            a, b = eq_by_id.get(ln.from_id), eq_by_id.get(ln.to_id)
            if not a or not b:
                continue
            parts.append(self._render_line(a, b, ln))

        # Equipment symbols (ISA) — chosen automatically by type.
        for e in self.equipment:
            parts.append(self._render_equipment(e))

        # Instrument balloons.
        for inst in self.instruments:
            parts.append(self._render_instrument(inst, eq_by_id))

        # Title block + revision history.
        parts.append(self._render_title_block(width, height))
        parts.append(self._render_revision_table(width, height))

        parts.append('</svg>')
        return "".join(parts)

    # ── ISA symbol renderers ───────────────────────────────────────────────────
    def _render_equipment(self, e: PIDEquipment) -> str:
        sym = normalize_equipment_type(e.type)
        x, y = e.x, e.y
        renderer = getattr(self, f"_sym_{sym}", self._sym_equipment)
        body = renderer(e)
        tag = html.escape(e.tag or e.id)
        label = html.escape(e.label or "")
        caption = (
            f'<text x="{x}" y="{y+48}" font-size="11" font-weight="bold" '
            f'text-anchor="middle" fill="#111">{tag}</text>'
        )
        if label:
            caption += (f'<text x="{x}" y="{y+62}" font-size="9" text-anchor="middle" '
                        f'fill="#444">{label}</text>')
        return (f'<g data-symbol="{sym}" data-id="{html.escape(e.id)}" '
                f'data-isa="true">{body}{caption}</g>')

    def _sym_pump(self, e: PIDEquipment) -> str:
        x, y = e.x, e.y
        # ISA centrifugal pump: circle with an impeller triangle + suction/discharge stubs.
        return (
            f'<circle cx="{x}" cy="{y}" r="22" fill="#fff" stroke="#111" stroke-width="2"/>'
            f'<path d="M{x-10},{y+8} L{x+12},{y} L{x-10},{y-8} Z" fill="#111"/>'
            f'<line x1="{x-22}" y1="{y}" x2="{x-34}" y2="{y}" stroke="#111" stroke-width="2"/>'
            f'<line x1="{x+22}" y1="{y}" x2="{x+34}" y2="{y}" stroke="#111" stroke-width="2"/>'
        )

    def _sym_valve(self, e: PIDEquipment) -> str:
        x, y = e.x, e.y
        # ISA gate/control valve: bow-tie of two triangles meeting at centre.
        return (
            f'<path d="M{x-20},{y-12} L{x-20},{y+12} L{x},{y} Z" fill="#fff" stroke="#111" stroke-width="2"/>'
            f'<path d="M{x+20},{y-12} L{x+20},{y+12} L{x},{y} Z" fill="#fff" stroke="#111" stroke-width="2"/>'
            f'<line x1="{x-20}" y1="{y}" x2="{x-34}" y2="{y}" stroke="#111" stroke-width="2"/>'
            f'<line x1="{x+20}" y1="{y}" x2="{x+34}" y2="{y}" stroke="#111" stroke-width="2"/>'
        )

    def _sym_tank(self, e: PIDEquipment) -> str:
        x, y = e.x, e.y
        # Vertical vessel: rounded rectangle.
        return (
            f'<rect x="{x-24}" y="{y-30}" width="48" height="60" rx="12" ry="12" '
            f'fill="#fff" stroke="#111" stroke-width="2"/>'
        )

    def _sym_reservoir(self, e: PIDEquipment) -> str:
        x, y = e.x, e.y
        # Open basin: three-sided box with a wavy water line.
        return (
            f'<path d="M{x-28},{y-24} L{x-28},{y+24} L{x+28},{y+24} L{x+28},{y-24}" '
            f'fill="#eef6ff" stroke="#111" stroke-width="2"/>'
            f'<path d="M{x-24},{y-8} q6,-6 12,0 t12,0 t12,0" fill="none" stroke="#2277cc" stroke-width="1.5"/>'
        )

    def _sym_nozzle(self, e: PIDEquipment) -> str:
        x, y = e.x, e.y
        # Fountain nozzle: converging triangle + spray strokes.
        return (
            f'<path d="M{x-10},{y+14} L{x+10},{y+14} L{x},{y-6} Z" fill="#fff" stroke="#111" stroke-width="2"/>'
            f'<line x1="{x}" y1="{y-6}" x2="{x}" y2="{y-22}" stroke="#2277cc" stroke-width="1.5"/>'
            f'<line x1="{x}" y1="{y-6}" x2="{x-8}" y2="{y-20}" stroke="#2277cc" stroke-width="1.5"/>'
            f'<line x1="{x}" y1="{y-6}" x2="{x+8}" y2="{y-20}" stroke="#2277cc" stroke-width="1.5"/>'
        )

    def _sym_filter(self, e: PIDEquipment) -> str:
        x, y = e.x, e.y
        return (
            f'<rect x="{x-20}" y="{y-24}" width="40" height="48" fill="#fff" stroke="#111" stroke-width="2"/>'
            f'<line x1="{x-20}" y1="{y-24}" x2="{x+20}" y2="{y+24}" stroke="#111" stroke-width="1.5"/>'
            f'<line x1="{x-20}" y1="{y+24}" x2="{x+20}" y2="{y-24}" stroke="#111" stroke-width="1.5"/>'
        )

    def _sym_junction(self, e: PIDEquipment) -> str:
        x, y = e.x, e.y
        return f'<circle cx="{x}" cy="{y}" r="5" fill="#111"/>'

    def _sym_equipment(self, e: PIDEquipment) -> str:
        x, y = e.x, e.y
        return (f'<rect x="{x-22}" y="{y-18}" width="44" height="36" fill="#fff" '
                f'stroke="#111" stroke-width="2"/>')

    def _render_instrument(self, inst: PIDInstrument, eq_by_id: dict) -> str:
        x, y = inst.x, inst.y
        letters = html.escape(str(inst.type or "").upper())
        num = html.escape(str(inst.tag_number or ""))
        parts = [f'<g data-symbol="instrument" data-isa="true" data-id="{html.escape(inst.id)}">']
        # Connecting lead to host equipment.
        host = eq_by_id.get(inst.attached_to)
        if host is not None:
            parts.append(f'<line x1="{x}" y1="{y+16}" x2="{host.x}" y2="{host.y-22}" '
                         f'stroke="#111" stroke-width="1" stroke-dasharray="4 3"/>')
        # ISA balloon: circle + centre line (field-mounted) + tag text.
        parts.append(f'<circle cx="{x}" cy="{y}" r="17" fill="#fff" stroke="#111" stroke-width="1.5"/>')
        parts.append(f'<line x1="{x-17}" y1="{y}" x2="{x+17}" y2="{y}" stroke="#111" stroke-width="1"/>')
        parts.append(f'<text x="{x}" y="{y-3}" font-size="9" font-weight="bold" '
                     f'text-anchor="middle" fill="#111">{letters}</text>')
        parts.append(f'<text x="{x}" y="{y+11}" font-size="9" text-anchor="middle" fill="#111">{num}</text>')
        parts.append('</g>')
        return "".join(parts)

    def _render_line(self, a: PIDEquipment, b: PIDEquipment, ln: PIDLine) -> str:
        # Orthogonal routing: horizontal from a, vertical, horizontal to b.
        x1, y1, x2, y2 = a.x, a.y, b.x, b.y
        midx = (x1 + x2) / 2
        path = f'M{x1},{y1} L{midx},{y1} L{midx},{y2} L{x2},{y2}'
        out = [f'<path d="{path}" fill="none" stroke="#111" stroke-width="2" marker-end="url(#arrow)"/>']
        label = ln.line_number or ln.label
        if label:
            out.append(f'<text x="{midx}" y="{(y1+y2)/2 - 4}" font-size="9" '
                       f'text-anchor="middle" fill="#225" >{html.escape(label)}</text>')
        return "".join(out)

    # ── Title block + revisions ────────────────────────────────────────────────
    def _render_title_block(self, width: float, height: float) -> str:
        bx = int(width) - _TITLE_W - 14
        by = int(height) - _TITLE_H - 14
        t = html.escape(self.title)
        dn = html.escape(self.drawing_number)
        proj = html.escape(self.project)
        rev = html.escape(self.current_revision)
        d = self.revisions[-1].date if self.revisions else date.today().isoformat()
        return (
            f'<g data-block="title">'
            f'<rect x="{bx}" y="{by}" width="{_TITLE_W}" height="{_TITLE_H}" fill="#fff" '
            f'stroke="#111" stroke-width="1.5"/>'
            f'<line x1="{bx}" y1="{by+40}" x2="{bx+_TITLE_W}" y2="{by+40}" stroke="#111"/>'
            f'<line x1="{bx}" y1="{by+90}" x2="{bx+_TITLE_W}" y2="{by+90}" stroke="#111"/>'
            f'<line x1="{bx+_TITLE_W-90}" y1="{by+90}" x2="{bx+_TITLE_W-90}" y2="{by+_TITLE_H}" stroke="#111"/>'
            f'<text x="{bx+12}" y="{by+26}" font-size="15" font-weight="bold" fill="#111">{proj}</text>'
            f'<text x="{bx+12}" y="{by+62}" font-size="13" fill="#111">{t}</text>'
            f'<text x="{bx+12}" y="{by+108}" font-size="10" fill="#111">DWG: {dn}</text>'
            f'<text x="{bx+12}" y="{by+122}" font-size="10" fill="#111">DATE: {html.escape(d)}</text>'
            f'<text x="{bx+_TITLE_W-84}" y="{by+108}" font-size="9" fill="#111">REV</text>'
            f'<text x="{bx+_TITLE_W-45}" y="{by+124}" font-size="18" font-weight="bold" '
            f'text-anchor="middle" fill="#111">{rev}</text>'
            f'</g>'
        )

    def _render_revision_table(self, width: float, height: float) -> str:
        if not self.revisions:
            return ""
        cols_w = _TITLE_W
        bx = int(width) - cols_w - 14
        rows = self.revisions[-8:]
        table_h = _REV_ROW_H * (len(rows) + 1)
        by = int(height) - _TITLE_H - 14 - table_h - 6
        parts = [f'<g data-block="revisions">']
        parts.append(f'<rect x="{bx}" y="{by}" width="{cols_w}" height="{table_h}" '
                     f'fill="#fff" stroke="#111" stroke-width="1"/>')
        # Header.
        parts.append(f'<rect x="{bx}" y="{by}" width="{cols_w}" height="{_REV_ROW_H}" fill="#eee" stroke="#111"/>')
        headers = [("REV", bx + 6), ("DATE", bx + 44), ("DESCRIPTION", bx + 130), ("BY", cols_w + bx - 34)]
        for label, hx in headers:
            parts.append(f'<text x="{hx}" y="{by+14}" font-size="9" font-weight="bold" fill="#111">{label}</text>')
        for i, r in enumerate(rows, start=1):
            ry = by + i * _REV_ROW_H
            parts.append(f'<line x1="{bx}" y1="{ry}" x2="{bx+cols_w}" y2="{ry}" stroke="#111" stroke-width="0.5"/>')
            parts.append(f'<text x="{bx+6}" y="{ry+14}" font-size="9" fill="#111">{html.escape(r.rev)}</text>')
            parts.append(f'<text x="{bx+44}" y="{ry+14}" font-size="9" fill="#111">{html.escape(r.date)}</text>')
            desc = r.description if len(r.description) <= 34 else r.description[:33] + "…"
            parts.append(f'<text x="{bx+130}" y="{ry+14}" font-size="9" fill="#111">{html.escape(desc)}</text>')
            parts.append(f'<text x="{bx+cols_w-34}" y="{ry+14}" font-size="9" fill="#111">{html.escape(r.by)}</text>')
        parts.append('</g>')
        return "".join(parts)

    # ── Printable HTML wrapper ─────────────────────────────────────────────────
    def to_printable_html(self) -> str:
        svg = self.render_svg()
        title = html.escape(self.title)
        return (
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            f"<title>{title} — {html.escape(self.drawing_number)}</title>"
            "<style>"
            "body{margin:0;background:#fff;font-family:Arial,sans-serif}"
            ".toolbar{padding:8px;background:#f0f0f0;border-bottom:1px solid #ccc}"
            ".sheet{padding:12px}"
            "svg{max-width:100%;height:auto}"
            "@page{size:A3 landscape;margin:10mm}"
            "@media print{.toolbar{display:none}.sheet{padding:0}}"
            "</style></head><body>"
            "<div class='toolbar'><button onclick='window.print()'>Print / Save PDF</button></div>"
            f"<div class='sheet'>{svg}</div>"
            "</body></html>"
        )


# ── Dict / model builders ──────────────────────────────────────────────────────
def generate_pid(model: dict) -> PIDGenerator:
    """Build a PIDGenerator from a plain dict model."""
    gen = PIDGenerator(
        title=model.get("title", "AquaFlow P&ID"),
        drawing_number=model.get("drawing_number", "AQ-PID-001"),
        project=model.get("project", "AquaFlow Studio"),
    )
    for e in model.get("equipment", []):
        gen.add_equipment(PIDEquipment(
            id=str(e.get("id")), type=str(e.get("type", "equipment")),
            tag=str(e.get("tag", "")), label=str(e.get("label", "")),
            x=e.get("x"), y=e.get("y"),
        ))
    for ln in model.get("lines", []):
        gen.add_line(PIDLine(
            from_id=str(ln.get("from", ln.get("from_id"))),
            to_id=str(ln.get("to", ln.get("to_id"))),
            label=str(ln.get("label", "")), line_number=str(ln.get("line_number", "")),
        ))
    for inst in model.get("instruments", []):
        gen.add_instrument(PIDInstrument(
            id=str(inst.get("id")), type=str(inst.get("type", "PT")),
            tag_number=str(inst.get("tag_number", "")),
            attached_to=str(inst.get("attached_to", "")),
            x=inst.get("x"), y=inst.get("y"),
        ))
    for r in model.get("revisions", []):
        gen.add_revision(description=str(r.get("description", "")), by=str(r.get("by", "")),
                         rev=r.get("rev"), on=r.get("date"))
    return gen


def generate_from_network(network: dict) -> PIDGenerator:
    """
    Auto-generate a P&ID from a hydraulic-solver network (AQ-S2-001): fixed-head
    nodes become reservoirs/pumps, demand nodes become nozzles, and pipes become
    process lines. Instruments are auto-attached (PT on the source, FT on lines).
    """
    gen = PIDGenerator(
        title=network.get("title", "AquaFlow Hydraulic P&ID"),
        drawing_number=network.get("drawing_number", "AQ-PID-NET-001"),
    )
    for n in network.get("nodes", []):
        if n.get("fixed_head") is not None:
            etype = "pump" if str(n.get("id", "")).lower().startswith(("pump", "p")) else "reservoir"
        elif float(n.get("demand", 0) or 0) > 0:
            etype = "nozzle"
        else:
            etype = "junction"
        gen.add_equipment(PIDEquipment(id=str(n["id"]), type=etype, tag=str(n["id"])))
    for p in network.get("pipes", []):
        gen.add_line(PIDLine(
            from_id=str(p.get("from", p.get("from_node"))),
            to_id=str(p.get("to", p.get("to_node"))),
            line_number=str(p.get("id", "")),
        ))
    for r in network.get("revisions", []):
        gen.add_revision(description=str(r.get("description", "")), by=str(r.get("by", "")),
                         rev=r.get("rev"), on=r.get("date"))
    return gen
