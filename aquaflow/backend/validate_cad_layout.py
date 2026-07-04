"""
validate_cad_layout.py — AQ-X-009 verification

Generates a DXF from a fountain design, parses it back, and checks:
  1. DXF/DWG export — a well-formed AutoCAD R12 DXF (sections + EOF, DWG-import note),
  2. layout accurate to design — fixture circles centred on the exact coordinates and
     the pool boundary matching the pool parameters,
  3. layer structure correct — a full LAYER table and every entity on the right layer.

Run:  python backend/validate_cad_layout.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.cad_layout import generate_dxf, generate_layout, LAYERS

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def parse_dxf(text: str) -> dict:
    """Minimal DXF reader → {version, insunits, layers:{name:aci}, entities:[...]}."""
    lines = text.split("\n")
    pairs = [(int(lines[i]), lines[i + 1]) for i in range(0, len(lines) - 1, 2)]
    version = insunits = None
    layers, entities = {}, []
    section = None
    cur = None
    in_layer = False
    pending_header = None
    for code, val in pairs:
        if code == 9:                       # header variable name
            pending_header = val
            continue
        if code == 2 and val in ("HEADER", "TABLES", "ENTITIES"):
            section = val
        if section == "HEADER" and code == 1 and pending_header == "$ACADVER":
            version = val
        if section == "HEADER" and code == 70 and pending_header == "$INSUNITS":
            insunits = int(val)
        if section == "TABLES":
            if code == 0 and val == "LAYER":
                in_layer = True
                cur = {}
            elif in_layer and code == 2:
                cur["name"] = val
            elif in_layer and code == 62:
                layers[cur["name"]] = int(val)
                in_layer = False
        if section == "ENTITIES":
            if code == 0:
                if cur and cur.get("_e"):
                    entities.append(cur)
                cur = {"_e": val} if val in ("CIRCLE", "LINE", "TEXT", "POINT") else None
            elif cur is not None:
                if code == 8: cur["layer"] = val
                elif code == 10: cur["x"] = float(val)
                elif code == 20: cur["y"] = float(val)
                elif code == 11: cur["x2"] = float(val)
                elif code == 21: cur["y2"] = float(val)
                elif code == 40: cur["r"] = float(val)
                elif code == 1: cur["text"] = val
    if cur and cur.get("_e"):
        entities.append(cur)
    return {"version": version, "insunits": insunits, "layers": layers, "entities": entities}


design = {
    "name": "Test Fountain",
    "poolType": "rectangular",
    "params": {"width": 12, "length": 8},
    "fixtures": [
        {"id": "jet-1", "type": "center_jets", "label": "Jet 1", "x": 6, "y": 4},
        {"id": "rgb-1", "type": "light_rgb", "label": "Light 1", "x": 3, "y": 2},
        {"id": "pump-1", "type": "pump", "label": "Pump", "x": 11, "y": 7},
    ],
    "pipes": [{"from": "pump-1", "to": "jet-1"}],
}

dxf = generate_dxf(design)
p = parse_dxf(dxf)


def entity_for(kind, layer=None, near=None):
    for e in p["entities"]:
        if e["_e"] != kind:
            continue
        if layer and e.get("layer") != layer:
            continue
        if near and not (abs(e.get("x", 1e9) - near[0]) < 1e-3 and abs(e.get("y", 1e9) - near[1]) < 1e-3):
            continue
        return e
    return None


print("== 1. DXF/DWG export ==")
check("DXF starts with a SECTION", dxf.startswith("0\nSECTION"))
check("DXF ends with EOF", dxf.rstrip().endswith("EOF"))
check("AutoCAD R12 version (AC1009)", p["version"] == "AC1009", str(p["version"]))
check("has HEADER, TABLES, ENTITIES + EOF",
      all(s in dxf for s in ("HEADER", "TABLES", "ENTITIES")) and "EOF" in dxf)
layout = generate_layout(design)
check("layout payload advertises DWG compatibility", layout["dwg"]["supported"] is True)
check("filename is .dxf", layout["filename"].endswith(".dxf"), layout["filename"])

print("== 2. layout accurate to design ==")
check("units are metres (INSUNITS=6)", p["insunits"] == 6, str(p["insunits"]))
jet = entity_for("CIRCLE", near=(6, 4))
check("jet-1 circle centred exactly on (6, 4)", jet is not None)
rgb = entity_for("CIRCLE", near=(3, 2))
check("rgb-1 circle centred exactly on (3, 2)", rgb is not None)
pump = entity_for("CIRCLE", near=(11, 7))
check("pump-1 circle centred exactly on (11, 7)", pump is not None)
# Pool rectangle corners appear as LINE endpoints (0,0)-(12,8).
corners = {(round(e["x"]), round(e["y"])) for e in p["entities"]
           if e["_e"] == "LINE" and e.get("layer") == "POOL_OUTLINE"}
check("pool outline spans (0,0)…(12,8)",
      {(0, 0), (12, 0), (12, 8), (0, 8)} <= corners, str(sorted(corners)))
pipe = entity_for("LINE", layer="PIPEWORK", near=(11, 7))
check("pipe drawn from pump-1 to jet-1 on PIPEWORK",
      pipe is not None and abs(pipe["x2"] - 6) < 1e-3 and abs(pipe["y2"] - 4) < 1e-3)

print("== 3. layer structure correct ==")
for name, aci in LAYERS:
    check(f"layer {name} present with colour {aci}", p["layers"].get(name) == aci)
check("jet-1 on NOZZLES layer", jet["layer"] == "NOZZLES", jet["layer"])
check("rgb-1 on LIGHTS layer", rgb["layer"] == "LIGHTS", rgb["layer"])
check("pump-1 on EQUIPMENT layer", pump["layer"] == "EQUIPMENT", pump["layer"])
check("labels on ANNOTATIONS layer",
      any(e["_e"] == "TEXT" and e.get("layer") == "ANNOTATIONS" for e in p["entities"]))
check("dimension text on MEASUREMENTS layer",
      any(e["_e"] == "TEXT" and e.get("layer") == "MEASUREMENTS" for e in p["entities"]))

print("== 4. circular pool ==")
circ = generate_dxf({"poolType": "circular", "params": {"radius": 5},
                     "geometry": {"center": [5, 5], "radius": 5}, "fixtures": []})
pc = parse_dxf(circ)
pool_circle = next((e for e in pc["entities"]
                    if e["_e"] == "CIRCLE" and e.get("layer") == "POOL_OUTLINE"), None)
check("circular pool → CIRCLE on POOL_OUTLINE at (5,5) r5",
      pool_circle and abs(pool_circle["x"] - 5) < 1e-3 and abs(pool_circle["r"] - 5) < 1e-3)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
