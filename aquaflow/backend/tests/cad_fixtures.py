"""
Programmatic DXF fixtures for the AF-CAD-010/012/016/017 import + recognition tests.

Every drawing is built with ezdxf so the corpus needs no binary files in the repo:
  * site_m()        — metres; nested + rotated + mirrored (scale and OCS extrusion)
                      blocks with ATTRIBs, AQUAFLOW XDATA, two dynamic-block-style
                      anonymous inserts, arcs / bulges / splines / ellipse, hatch,
                      rotated text, an XREF and a TEXT-grid schedule.
  * basin_mm()      — the same 10 × 5 m basin drawn in millimetres.
  * unitless()      — $INSUNITS = 0, 25 000 × 12 000 drawing units (→ mm).
  * spanish_site()  — third-party style: Spanish layer names, plain circles for
                      nozzles, an L-shaped basin with an island, PVC pipe, lawn hatch,
                      tags + a schedule in m³/h.
  * with_acad_table(text) — injects a raw ACAD_TABLE entity (ezdxf cannot author one).
"""
from __future__ import annotations

import binascii
import io
import json
import math
import os
import tempfile

import ezdxf


def to_bytes(doc, fmt: str = "asc") -> bytes:
    if fmt == "bin":
        fd, path = tempfile.mkstemp(suffix=".dxf")
        os.close(fd)
        try:
            doc.saveas(path, fmt="bin")
            with open(path, "rb") as fh:
                return fh.read()
        finally:
            os.unlink(path)
    s = io.StringIO()
    doc.write(s)
    return s.getvalue().encode("utf-8")


def aquaflow_xdata(meta: dict) -> list:
    hexed = binascii.hexlify(json.dumps(meta).encode("utf-8")).decode("ascii")
    return [(1000, hexed[i:i + 240]) for i in range(0, len(hexed), 240)]


def _nozzle_block(doc, name="NOZZLE_JET"):
    blk = doc.blocks.new(name)
    blk.add_circle((0, 0), 0.05, dxfattribs={"layer": "0", "color": 0})
    blk.add_line((-0.05, 0), (0.05, 0), dxfattribs={"layer": "0"})
    return blk


def site_m():
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 6
    doc.appids.add("AQUAFLOW")
    doc.appids.add("AcDbBlockRepBTag")
    doc.layers.add("NOZZLES", color=1)
    doc.layers.add("POOL", color=5)
    doc.layers.add("LAND", color=3)
    doc.layers.add("TEXT", color=7)
    doc.layers.add("SCHED", color=7)
    msp = doc.modelspace()

    _nozzle_block(doc)
    ring = doc.blocks.new("RING4")
    for x, y in ((1, 0), (0, 1), (-1, 0), (0, -1)):
        ring.add_blockref("NOZZLE_JET", (x, y), dxfattribs={"layer": "0"})

    # basin
    msp.add_lwpolyline([(0, 0), (40, 0), (40, 12), (0, 12)], close=True, dxfattribs={"layer": "POOL"})

    # rotated nested ring
    r1 = msp.add_blockref("RING4", (10, 5), dxfattribs={"layer": "NOZZLES", "rotation": 90})
    # mirrored by negative x-scale
    r2 = msp.add_blockref("RING4", (20, 5), dxfattribs={"layer": "NOZZLES", "xscale": -1})
    # mirrored by OCS extrusion (0,0,-1): OCS x = -WCS x
    r3 = msp.add_blockref("RING4", (-30, 5), dxfattribs={"layer": "NOZZLES", "extrusion": (0, 0, -1)})

    # attributed single nozzle with AQUAFLOW XDATA
    n1 = msp.add_blockref("NOZZLE_JET", (5, 2), dxfattribs={"layer": "NOZZLES", "rotation": 30})
    n1.add_attrib("ID", "N-01", (5, 2.3))
    n1.add_attrib("MODEL", "JET-25", (5, 2.6))
    n1.add_attrib("DMX", "17", (5, 2.9))
    n1.set_xdata("AQUAFLOW", aquaflow_xdata({"kind": "fixture", "id": "noz_1", "type": "nozzle"}))

    # dynamic block style (1): anonymous *U block linked by AcDbBlockRepBTag XDATA
    dyn = doc.blocks.new("LED_SPOT")
    dyn.add_circle((0, 0), 0.08)
    anon = doc.blocks.new_anonymous_block("U")
    anon.add_circle((0, 0), 0.08)
    anon.block_record.set_xdata("AcDbBlockRepBTag", [(1070, 1), (1005, dyn.block_record.dxf.handle)])
    msp.add_blockref(anon.name, (30, 6), dxfattribs={"layer": "LIGHTS"})

    # dynamic block style (2): INSERT → XDICT → AcDbBlockRepresentation → AcDbRepData → record
    pump_def = doc.blocks.new("PUMP_SUB_5HP")
    pump_def.add_lwpolyline([(-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3)], close=True)
    anon2 = doc.blocks.new_anonymous_block("U")
    anon2.add_lwpolyline([(-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3)], close=True)
    p = msp.add_blockref(anon2.name, (35, 10), dxfattribs={"layer": "EQUIP"})
    xdict = p.new_extension_dict()
    rep = xdict.add_dictionary("AcDbBlockRepresentation")
    xr = rep.add_xrecord("AcDbRepData")
    xr.reset([(70, 1), (340, pump_def.block_record.dxf.handle)])

    # curves
    msp.add_arc((2, 10), 1.0, 0, 180, dxfattribs={"layer": "POOL"})
    msp.add_lwpolyline([(5, 10, 0, 0, 1.0), (7, 10)], format="xyseb", dxfattribs={"layer": "POOL"})
    msp.add_spline([(10, 10), (11, 11), (12, 10), (13, 11)], dxfattribs={"layer": "POOL"})
    msp.add_ellipse((16, 10), major_axis=(1, 0), ratio=0.5, dxfattribs={"layer": "POOL"})

    # hatch
    h = msp.add_hatch(color=3, dxfattribs={"layer": "LAND"})
    h.set_pattern_fill("GRASS", scale=0.1)
    h.paths.add_polyline_path([(0, -5), (10, -5), (10, -2), (0, -2)], is_closed=True)

    msp.add_text("ROTATED", height=0.3, rotation=45, dxfattribs={"layer": "TEXT"}).set_placement((1, 1))
    msp.add_mtext("Line A\\PLine B", dxfattribs={"layer": "TEXT", "char_height": 0.25, "insert": (3, 3)})
    msp.add_point((7, 7), dxfattribs={"layer": "0"})

    # XREF (unresolved)
    doc.add_xref_def("survey.dxf", "SURVEY")

    # text-grid schedule (left aligned, 0.25 m text, 0.5 m row pitch)
    rows = [["TAG", "MODEL", "FLOW (L/MIN)", "HEIGHT (M)"],
            ["N-01", "JET-25", "40", "2.0"],
            ["N-02", "JET-30", "55", "3.5"],
            ["L-01", "RGB-9", "", ""]]
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            if val:
                msp.add_text(val, height=0.25, dxfattribs={"layer": "SCHED"}).set_placement(
                    (60 + ci * 3.0, 20 - ri * 0.5))
    return doc


def basin_mm():
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (10000, 0), (10000, 5000), (0, 5000)], close=True,
                       dxfattribs={"layer": "POOL"})
    msp.add_circle((5000, 2500), 50, dxfattribs={"layer": "NOZZLES"})
    return doc


def unitless():
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 0
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (25000, 0), (25000, 12000), (0, 12000)], close=True,
                       dxfattribs={"layer": "A-0"})
    return doc


def spanish_site():
    """Third-party style drawing: no AquaFlow blocks, Spanish layers, plain circles."""
    doc = ezdxf.new("R2013")
    doc.header["$INSUNITS"] = 6
    for name in ("VASO", "ISLA", "BOQUILLAS", "BOMBAS", "TUBERIA PVC DN50", "CESPED",
                 "TEXTOS", "TABLA"):
        doc.layers.add(name)
    msp = doc.modelspace()
    # L-shaped basin with an island
    msp.add_lwpolyline([(0, 0), (20, 0), (20, 8), (8, 8), (8, 16), (0, 16)], close=True,
                       dxfattribs={"layer": "VASO"})
    msp.add_lwpolyline([(2, 10), (5, 10), (5, 13), (2, 13)], close=True, dxfattribs={"layer": "ISLA"})
    # ring of 8 nozzles on the keyword layer
    for k in range(8):
        a = 2 * math.pi * k / 8
        msp.add_circle((14 + 2 * math.cos(a), 4 + 2 * math.sin(a)), 0.04, dxfattribs={"layer": "BOQUILLAS"})
    # a line of 5 plain circles on layer 0 — only the geometry signature identifies them
    for k in range(5):
        msp.add_circle((1.5 + k * 1.0, 3.0), 0.03, dxfattribs={"layer": "0"})
    # tag texts next to two nozzles
    msp.add_text("B1", height=0.2, dxfattribs={"layer": "TEXTOS"}).set_placement((16.2, 4.2))
    msp.add_text("B2", height=0.2, dxfattribs={"layer": "TEXTOS"}).set_placement((14.2, 6.2))
    # pump block
    bomba = doc.blocks.new("BOMBA_SUMERGIBLE")
    bomba.add_circle((0, 0), 0.25)
    bomba.add_text("M", height=0.2).set_placement((0, 0))
    msp.add_blockref("BOMBA_SUMERGIBLE", (18, 1), dxfattribs={"layer": "BOMBAS"})
    # pipe with DN/material in the layer name, and a labelled pipe on a generic layer
    msp.add_lwpolyline([(18, 1), (14, 1), (14, 4)], dxfattribs={"layer": "TUBERIA PVC DN50"})
    msp.add_lwpolyline([(18, 1), (18, 6)], dxfattribs={"layer": "TUBERIA"})
    msp.add_text("PEAD DN63", height=0.15, dxfattribs={"layer": "TEXTOS"}).set_placement((18.2, 3.5))
    # lawn hatch on a Spanish layer with a generic pattern
    h = msp.add_hatch(color=3, dxfattribs={"layer": "CESPED"})
    h.set_pattern_fill("ANSI31", scale=0.5)
    h.paths.add_polyline_path([(22, 0), (30, 0), (30, 16), (22, 16)], is_closed=True)
    # schedule (text grid) with flow in m3/h
    rows = [["TABLA DE BOQUILLAS", "", ""],
            ["MARCA", "MODELO", "CAUDAL (m3/h)"],
            ["B1", "CHORRO-20", "3.6"],
            ["B2", "CHORRO-30", "6"],
            ["B3", "CHORRO-30", "6"]]
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            if val:
                msp.add_text(val, height=0.2, dxfattribs={"layer": "TABLA"}).set_placement(
                    (40 + ci * 4.0, 15 - ri * 0.4))
    return doc


def with_acad_table(text: str, rows: list, insert=(50.0, 30.0), layer="SCHED", handle="ABCD1") -> str:
    """Inject a minimal R2004-style ACAD_TABLE into the ENTITIES section of DXF text."""
    tags = ["0", "ACAD_TABLE", "5", handle, "100", "AcDbEntity", "8", layer,
            "100", "AcDbBlockReference", "10", str(insert[0]), "20", str(insert[1]), "30", "0.0",
            "100", "AcDbTable", "280", "0", "91", str(len(rows)), "92", str(len(rows[0]))]
    for row in rows:
        for cell in row:
            tags += ["171", "1", "1", cell]
    i = text.index("ENTITIES")
    j = text.index("\n  0\nENDSEC", i)
    return text[:j + 1] + "\n".join(tags) + "\n" + text[j + 1:]
