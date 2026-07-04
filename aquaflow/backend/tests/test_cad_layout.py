"""
Contract tests for the CAD Layout Generator (AQ-X-009).

Asserts the three acceptance criteria by generating a DXF and parsing it back:
  1. DXF/DWG export supported (well-formed R12 DXF + DWG-import payload),
  2. layout accurate to design (fixtures on exact coordinates, pool boundary right),
  3. layer structure correct (full LAYER table, entities on the right layers).
"""
import pytest

from services.cad_layout import (
    generate_dxf, generate_layout, fixture_layer, LAYERS, LAYER_NAMES,
)


def parse_dxf(text: str) -> dict:
    lines = text.split("\n")
    pairs = [(int(lines[i]), lines[i + 1]) for i in range(0, len(lines) - 1, 2)]
    version = insunits = None
    layers, entities = {}, []
    section = cur = None
    in_layer = False
    pending = None
    for code, val in pairs:
        if code == 9:
            pending = val
            continue
        if code == 2 and val in ("HEADER", "TABLES", "ENTITIES"):
            section = val
        if section == "HEADER" and code == 1 and pending == "$ACADVER":
            version = val
        if section == "HEADER" and code == 70 and pending == "$INSUNITS":
            insunits = int(val)
        if section == "TABLES":
            if code == 0 and val == "LAYER":
                in_layer, cur = True, {}
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
                key = {8: "layer", 10: "x", 20: "y", 11: "x2", 21: "y2", 40: "r", 1: "text"}.get(code)
                if key:
                    cur[key] = val if key in ("layer", "text") else float(val)
    if cur and cur.get("_e"):
        entities.append(cur)
    return {"version": version, "insunits": insunits, "layers": layers, "entities": entities}


DESIGN = {
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


@pytest.fixture(scope="module")
def parsed():
    return parse_dxf(generate_dxf(DESIGN))


def _circle_near(parsed, x, y):
    for e in parsed["entities"]:
        if e["_e"] == "CIRCLE" and abs(e["x"] - x) < 1e-3 and abs(e["y"] - y) < 1e-3:
            return e
    return None


# ── 1. DXF/DWG export ─────────────────────────────────────────────────────────

def test_dxf_is_well_formed(parsed):
    dxf = generate_dxf(DESIGN)
    assert dxf.startswith("0\nSECTION")
    assert dxf.rstrip().endswith("EOF")
    assert parsed["version"] == "AC1009"        # AutoCAD R12
    for section in ("HEADER", "TABLES", "ENTITIES"):
        assert section in dxf


def test_layout_payload_supports_dwg():
    layout = generate_layout(DESIGN)
    assert layout["format"] == "dxf"
    assert layout["filename"].endswith(".dxf")
    assert layout["dwg"]["supported"] is True
    assert layout["units"] == "meters"
    assert set(layout["layers"]) == LAYER_NAMES
    assert layout["stats"]["fixture_count"] == 3


def test_filename_is_sanitised():
    layout = generate_layout({"name": "My Pool / Fountain #1!", "fixtures": []})
    assert layout["filename"] == "My_Pool___Fountain__1_.dxf"


# ── 2. accuracy ───────────────────────────────────────────────────────────────

def test_units_are_meters(parsed):
    assert parsed["insunits"] == 6


def test_fixtures_on_exact_coordinates(parsed):
    assert _circle_near(parsed, 6, 4) is not None
    assert _circle_near(parsed, 3, 2) is not None
    assert _circle_near(parsed, 11, 7) is not None


def test_pool_boundary_matches_params(parsed):
    corners = {(round(e["x"]), round(e["y"])) for e in parsed["entities"]
               if e["_e"] == "LINE" and e["layer"] == "POOL_OUTLINE"}
    assert {(0, 0), (12, 0), (12, 8), (0, 8)} <= corners


def test_pipe_connects_fixtures(parsed):
    pipe = next((e for e in parsed["entities"]
                 if e["_e"] == "LINE" and e["layer"] == "PIPEWORK"), None)
    assert pipe is not None
    assert abs(pipe["x"] - 11) < 1e-3 and abs(pipe["x2"] - 6) < 1e-3


def test_circular_pool_emits_circle():
    p = parse_dxf(generate_dxf({"poolType": "circular",
                                "geometry": {"center": [5, 5], "radius": 5}, "fixtures": []}))
    pc = next(e for e in p["entities"] if e["_e"] == "CIRCLE" and e["layer"] == "POOL_OUTLINE")
    assert abs(pc["x"] - 5) < 1e-3 and abs(pc["r"] - 5) < 1e-3


# ── 3. layer structure ────────────────────────────────────────────────────────

def test_layer_table_complete(parsed):
    for name, aci in LAYERS:
        assert parsed["layers"].get(name) == aci


def test_fixtures_assigned_to_correct_layers(parsed):
    assert _circle_near(parsed, 6, 4)["layer"] == "NOZZLES"
    assert _circle_near(parsed, 3, 2)["layer"] == "LIGHTS"
    assert _circle_near(parsed, 11, 7)["layer"] == "EQUIPMENT"


@pytest.mark.parametrize("ftype,layer", [
    ("center_jets", "NOZZLES"), ("nozzle_geyser", "NOZZLES"), ("crown_jet", "NOZZLES"),
    ("light_rgb", "LIGHTS"), ("underwater_led", "LIGHTS"), ("spot", "LIGHTS"),
    ("pump", "EQUIPMENT"), ("valve", "EQUIPMENT"), ("flame_unit", "EQUIPMENT"),
])
def test_fixture_layer_mapping(ftype, layer):
    assert fixture_layer(ftype) == layer


def test_labels_and_dimensions_on_their_layers(parsed):
    assert any(e["_e"] == "TEXT" and e["layer"] == "ANNOTATIONS" for e in parsed["entities"])
    assert any(e["_e"] == "TEXT" and e["layer"] == "MEASUREMENTS" for e in parsed["entities"])


def test_empty_design_still_valid_dxf():
    dxf = generate_dxf({"fixtures": []})
    p = parse_dxf(dxf)
    assert p["version"] == "AC1009"
    assert len(p["layers"]) == len(LAYERS)
