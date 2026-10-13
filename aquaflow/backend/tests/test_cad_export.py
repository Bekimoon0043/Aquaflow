"""
Tests for the ezdxf DXF writer (AF-CAD-020) and writer convergence (AF-CAD-003).

Round trip: export a design, re-read it with ezdxf, and check blocks, attributes,
AQUAFLOW XDATA, layers and positions (within 1 mm) against the design — in the CAD
+Y-up frame (cad = (x, -y) of the plan, see services/cad_export.py).
"""
import io
import json
import zipfile

import ezdxf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.cad_export import (
    AQF_LAYERS, XDATA_APPID, block_name_for, component_category, decode_metadata,
    encode_metadata, export_dxf, export_layout, read_entity_metadata,
)
from services.cad_layout import generate_layout, LAYERS
from services.engineering_package import build_documents

MM = 1e-3

DESIGN = {
    "name": "Round Trip Fountain",
    "pool_type": "freeform",
    "params": {"width": 12, "length": 8, "depth": 0.9},
    "geometry": {
        "type": "polygon",
        "points": [{"x": 0, "y": 0}, {"x": 12, "y": 0}, {"x": 12, "y": 8}, {"x": 0, "y": 8}],
        "holes": [[{"x": 5, "y": 3}, {"x": 7, "y": 3}, {"x": 7, "y": 5}, {"x": 5, "y": 5}]],
    },
    "fixtures": [
        {"id": "noz-1", "type": "nozzle_geyser", "label": "Geyser 1", "x": 2.5, "y": 1.25,
         "z": 0.15, "rotation": 30, "engineering": {"model": "JET-25", "jetHeightM": 3.2}},
        {"id": "noz-2", "type": "nozzle_geyser", "label": "Geyser 2", "x": 9.5004, "y": 6.7503,
         "engineering": {"model": "JET-25", "jetHeightM": 3.2}, "dmxAddress": 17},
        {"id": "led-1", "type": "light_rgb", "label": "Ünder LED", "x": 3, "y": 2, "dmxAddress": 101},
        {"id": "pump-1", "type": "pump", "label": "Main pump", "x": 11, "y": 7.5},
        {"id": "valve-1", "type": "valve", "label": "V1", "x": 10, "y": 7},
    ],
    "manualPipes": [
        {"id": "pipe-a", "points": [{"x": 11, "y": 7.5}, {"x": 10, "y": 7}, {"x": 9.5004, "y": 6.7503}],
         "diameterMm": 63, "pipeType": "supply", "label": "Main"},
    ],
    "depth_zones": [{"id": "deep", "zone": "deep", "label": "Deep", "depth": 1.5,
                     "points": [{"x": 1, "y": 1}, {"x": 4, "y": 1}, {"x": 4, "y": 3}]}],
    "measurements": [{"x1": 0, "y1": 9, "x2": 12, "y2": 9}],
    "site_surfaces": [{"id": "lawn", "type": "grass", "label": "Lawn",
                       "points": [{"x": -4, "y": -4}, {"x": -1, "y": -4}, {"x": -1, "y": -1}, {"x": -4, "y": -1}]},
                      {"id": "path", "type": "paving",
                       "points": [{"x": 13, "y": 0}, {"x": 15, "y": 0}, {"x": 15, "y": 8}]}],
    "layers": [{"key": "nozzles", "label": "NOZZLES", "visible": True},
               {"key": "trees", "label": "Trees", "color": "#228b22", "visible": False, "locked": True}],
}


def _read(text):
    return ezdxf.read(io.StringIO(text))


@pytest.fixture(scope="module")
def doc():
    return _read(export_dxf(DESIGN))


@pytest.fixture(scope="module")
def inserts(doc):
    out = {}
    for ins in doc.modelspace().query("INSERT"):
        meta = read_entity_metadata(ins)
        out[meta["id"]] = (ins, meta)
    return out


# ── document basics ───────────────────────────────────────────────────────────

def test_version_units_and_appid(doc):
    assert doc.dxfversion >= "AC1027"
    assert doc.header["$INSUNITS"] == 6
    assert XDATA_APPID in doc.appids
    auditor = doc.audit()
    assert not auditor.has_errors


def test_layer_set_and_colours(doc):
    for name, aci in AQF_LAYERS:
        assert name in doc.layers
        assert doc.layers.get(name).color == aci


def test_user_layer_exported(doc):
    assert "TREES" in doc.layers
    trees = doc.layers.get("TREES")
    assert trees.is_off() and trees.is_locked()
    assert trees.rgb == (0x22, 0x8B, 0x22)
    assert "NOZZLES" in doc.layers               # built-in key did not become a user layer


# ── blocks, attributes, XDATA ─────────────────────────────────────────────────

def test_one_block_per_component_type_and_model(doc):
    names = sorted(b.name for b in doc.blocks if b.name.startswith("AQF_"))
    assert names == ["AQF_LIGHT_RGB", "AQF_NOZZLE_JET-25", "AQF_PUMP_GENERIC", "AQF_VALVE_GENERIC"]
    for name in names:
        tags = [a.dxf.tag for a in doc.blocks.get(name).query("ATTDEF")]
        assert tags == ["ID", "MODEL", "HEIGHT", "CHANNEL"]


def test_both_geysers_share_one_block(inserts):
    assert inserts["noz-1"][0].dxf.name == inserts["noz-2"][0].dxf.name == "AQF_NOZZLE_JET-25"


def test_every_fixture_is_an_insert_with_xdata(inserts):
    assert set(inserts) == {f["id"] for f in DESIGN["fixtures"]}
    for f in DESIGN["fixtures"]:
        _, meta = inserts[f["id"]]
        assert meta["kind"] == "fixture" and meta["type"] == f["type"]
        assert meta["label"] == f["label"]


def test_attribs_carry_id_model_height_channel(inserts):
    ins, _ = inserts["noz-1"]
    att = {a.dxf.tag: a.dxf.text for a in ins.attribs}
    assert att == {"ID": "Geyser 1", "MODEL": "JET-25", "HEIGHT": "3.2", "CHANNEL": ""}
    att2 = {a.dxf.tag: a.dxf.text for a in inserts["led-1"][0].attribs}
    assert att2["CHANNEL"] == "101" and att2["MODEL"] == "light_rgb"


def test_positions_within_1mm_in_cad_frame(inserts):
    for f in DESIGN["fixtures"]:
        ins, _ = inserts[f["id"]]
        x, y, z = ins.dxf.insert
        assert abs(x - f["x"]) < MM
        assert abs(y - (-f["y"])) < MM                # plan y-down → CAD +Y up
        assert abs(z - f.get("z", 0)) < MM


def test_rotation_mirrors_with_y(inserts):
    ins, meta = inserts["noz-1"]
    assert abs(ins.dxf.rotation - (-30)) < 1e-9
    assert meta["rotation"] == 30                 # plan rotation kept verbatim in XDATA


def test_fixture_layers(inserts):
    assert inserts["noz-1"][0].dxf.layer == "NOZZLES"
    assert inserts["led-1"][0].dxf.layer == "LIGHTS"
    assert inserts["pump-1"][0].dxf.layer == "EQUIPMENT"


# ── geometry ──────────────────────────────────────────────────────────────────

def test_basin_outline_and_hole(doc):
    msp = doc.modelspace()
    pool = msp.query('LWPOLYLINE[layer=="POOL_OUTLINE"]')
    assert len(pool) == 1 and pool[0].closed
    pts = [(round(x, 6), round(y, 6)) for x, y in pool[0].get_points("xy")]
    assert pts == [(0, 0), (12, 0), (12, -8), (0, -8)]
    meta = read_entity_metadata(pool[0])
    assert meta == {"kind": "pool", "depth": 0.9}
    holes = msp.query('LWPOLYLINE[layer=="POOL_ISLANDS"]')
    assert len(holes) == 1 and holes[0].closed
    assert (5, -3) in [(round(x, 6), round(y, 6)) for x, y in holes[0].get_points("xy")]


def test_pipes_depth_zones_measurements(doc):
    msp = doc.modelspace()
    pipe = msp.query('LWPOLYLINE[layer=="PIPEWORK"]')[0]
    meta = read_entity_metadata(pipe)
    assert meta["kind"] == "pipe" and meta["id"] == "pipe-a" and meta["diameterMm"] == 63
    pts = list(pipe.get_points("xy"))
    assert abs(pts[-1][0] - 9.5004) < MM and abs(pts[-1][1] + 6.7503) < MM
    dz = msp.query('LWPOLYLINE[layer=="DEPTH_ZONES"]')[0]
    assert read_entity_metadata(dz)["zone"] == "deep"
    line = msp.query('LINE[layer=="MEASUREMENTS"]')[0]
    assert abs(line.dxf.start.y + 9) < MM and abs(line.dxf.end.x - 12) < MM


def test_land_surfaces_are_pattern_hatches(doc):
    hatches = doc.modelspace().query('HATCH[layer=="LANDSCAPE"]')
    assert len(hatches) == 2
    by_id = {read_entity_metadata(h)["id"]: h for h in hatches}
    assert by_id["lawn"].dxf.pattern_name == "GRASS"
    assert by_id["path"].dxf.pattern_name == "AR-HBONE"
    assert read_entity_metadata(by_id["lawn"])["type"] == "grass"


def test_overall_dimensions(doc):
    dims = doc.modelspace().query('DIMENSION[layer=="DIMENSIONS"]')
    assert len(dims) == 2
    measured = sorted(round(d.get_measurement(), 3) for d in dims)
    # Overall extents include the land surfaces (x −4 … 15, y 1 … −9.x).
    assert measured[-1] == pytest.approx(19.0, abs=0.01)


# ── XDATA format agreement with the browser writer ────────────────────────────

def test_xdata_encoding_matches_frontend_algorithm():
    # cadExchange.js: hex(utf8(JSON.stringify(data))) split into 240-char 1000 groups.
    data = {"kind": "fixture", "id": "n-1", "label": "Fontäne " + "x" * 200}
    tags = encode_metadata(data)
    expected_hex = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode().hex()
    assert all(code == 1000 and len(v) <= 240 for code, v in tags)
    assert "".join(v for _, v in tags) == expected_hex
    assert decode_metadata(v for _, v in tags) == data


def test_decode_rejects_damaged_metadata():
    assert decode_metadata(["zz"]) is None
    assert decode_metadata(["abc"]) is None
    assert decode_metadata([b"[1,2]".hex()]) is None


def test_block_naming():
    assert block_name_for({"type": "nozzle_geyser", "engineering": {"model": "JET 25/a"}}) == "AQF_NOZZLE_JET_25_A"
    assert block_name_for({"type": "nozzle_running"}) == "AQF_NOZZLE_RUNNING"
    assert block_name_for({"type": "laser_show"}) == "AQF_LASER_SHOW"
    assert component_category("flame_unit") == "FIRE"


def test_duplicate_fixture_ids_rejected():
    with pytest.raises(ValueError):
        export_dxf({"fixtures": [{"id": "a", "x": 0, "y": 0}, {"id": "a", "x": 1, "y": 1}]})


# ── backend design shape + shapes defaults ────────────────────────────────────

def test_backend_design_shape_and_connection_pipes():
    d = {"name": "B", "poolType": "rectangular", "params": {"width": 10, "length": 6},
         "fixtures": [{"id": "j", "type": "center_jets", "x": 5, "y": 3},
                      {"id": "p", "type": "pump", "x": 9, "y": 5}],
         "pipes": [{"from": "p", "to": "j"}]}
    doc = _read(export_dxf(d))
    msp = doc.modelspace()
    pool = msp.query('LWPOLYLINE[layer=="POOL_OUTLINE"]')[0]
    assert [(round(x, 6), round(y, 6)) for x, y in pool.get_points("xy")] == [(0, 0), (10, 0), (10, -6), (0, -6)]
    pipe = msp.query('LWPOLYLINE[layer=="PIPEWORK"]')[0]
    assert [tuple(round(c, 6) for c in p) for p in pipe.get_points("xy")] == [(9, -5), (5, -3)]


@pytest.mark.parametrize("design,kind", [
    ({"pool_type": "circular", "params": {"radius": 4}}, "CIRCLE"),
    ({"poolType": "circular", "geometry": {"center": [5, 5], "radius": 5}}, "CIRCLE"),
    ({"pool_type": "elliptical", "params": {"width": 10, "length": 6}}, "ELLIPSE"),
    ({"geometry": {"type": "ellipse", "center": {"x": 1, "y": 2}, "rx": 2, "ry": 5}}, "ELLIPSE"),
])
def test_curved_basins(design, kind):
    doc = _read(export_dxf(design))
    e = doc.modelspace().query(f'{kind}[layer=="POOL_OUTLINE"]')[0]
    assert read_entity_metadata(e)["kind"] == "pool"
    if design.get("geometry", {}).get("center") == [5, 5]:
        assert abs(e.dxf.center.y + 5) < MM and abs(e.dxf.radius - 5) < MM


def test_empty_design_is_valid():
    doc = _read(export_dxf({}))
    assert not doc.audit().has_errors


# ── AF-CAD-003: one writer behind every entry point ───────────────────────────

def _summary(text):
    d = _read(text)
    msp = d.modelspace()
    ents = []
    for e in msp:
        if e.dxftype() == "DIMENSION":
            ents.append(("DIMENSION", e.dxf.layer, round(e.get_measurement(), 6)))
            continue
        meta = read_entity_metadata(e)
        pos = None
        if e.dxftype() == "INSERT":
            pos = tuple(round(c, 6) for c in e.dxf.insert)
        elif e.dxftype() == "LWPOLYLINE":
            pos = tuple(tuple(round(c, 6) for c in p) for p in e.get_points("xy"))
        ents.append((e.dxftype(), e.dxf.layer, json.dumps(meta, sort_keys=True), pos))
    layers = sorted((l.dxf.name, l.color) for l in d.layers)
    blocks = sorted(b.name for b in d.blocks if b.name.startswith("AQF_"))
    return d.dxfversion, layers, blocks, ents


def test_golden_all_entry_points_produce_the_same_drawing():
    direct = _summary(export_dxf(DESIGN))
    layout = _summary(generate_layout(DESIGN)["dxf"])
    docs, warnings = build_documents(DESIGN)
    package = _summary(docs["layout.dxf"].decode("utf-8"))
    assert direct == layout == package
    assert warnings == []


def test_generate_layout_reports_writer_and_legacy_option():
    new = generate_layout(DESIGN)
    assert new["writer"] == "ezdxf" and new["dxf_version"] == "AC1027"
    assert "AQF_NOZZLE_JET-25" in new["blocks"] and "TREES" in new["layers"]
    legacy = generate_layout(DESIGN, writer="r12")
    assert legacy["writer"] == "r12" and "AC1009" in legacy["dxf"]
    assert generate_layout({**DESIGN, "cad_writer": "r12"})["dxf_version"] == "AC1009"
    assert [n for n, _ in LAYERS] == [n for n, _ in AQF_LAYERS]


def test_export_layout_stats():
    out = export_layout(DESIGN)
    assert out["insert_count"] == len(DESIGN["fixtures"])


# ── route ─────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    from api.routes.cad_exchange_routes import router
    app = FastAPI()
    app.include_router(router, prefix="/api/cad")
    return TestClient(app)


def test_export_route(client):
    r = client.post("/api/cad/export.dxf", json=DESIGN)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/dxf")
    assert 'filename="Round_Trip_Fountain.dxf"' in r.headers["content-disposition"]
    assert _summary(r.text) == _summary(export_dxf(DESIGN))
    r2 = client.post("/api/cad/export.dxf", json={"design": DESIGN})
    assert r2.status_code == 200


def test_export_route_rejects_duplicate_ids(client):
    r = client.post("/api/cad/export.dxf",
                    json={"fixtures": [{"id": "a", "x": 0, "y": 0}, {"id": "a", "x": 1, "y": 1}]})
    assert r.status_code == 400


# ── AF-CAD-020 (5): re-import through the backend importer is exact ───────────

def test_reimport_through_cad_import_is_exact():
    cad_import = pytest.importorskip("services.cad_import")
    r = cad_import.import_dxf_bytes(export_dxf(DESIGN).encode("utf-8"), "rt.dxf", recognize=True)
    by_id = {i["xdata"]["AQUAFLOW"]["id"]: i for i in r["inserts"] if i["xdata"].get("AQUAFLOW")}
    assert set(by_id) == {f["id"] for f in DESIGN["fixtures"]}
    for f in DESIGN["fixtures"]:
        x, y, z = by_id[f["id"]]["position"]
        assert abs(x - f["x"]) < MM and abs(y + f["y"]) < MM and abs(z - f.get("z", 0)) < MM
    cands = {c.get("aquaflow_id"): c for c in r["recognition"]["candidates"]}
    assert {"noz-1", "noz-2", "led-1", "pump-1", "valve-1"} <= set(cands)
