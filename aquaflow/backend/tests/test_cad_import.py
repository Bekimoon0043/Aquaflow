"""
Contract tests for the backend ezdxf import service (AF-CAD-010, AF-CAD-016 schedules,
AF-CAD-017 diff) and the /api/cad/import route. Contract: docs/CAD-IMPORT-CONTRACT.md.

All fixture drawings are generated with ezdxf in tests/cad_fixtures.py.
"""
import io
import math

import ezdxf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.cad_routes import router as cad_router
from services.cad_import import (
    CadImportError, closed_outlines, decode_xdata, diff_import, import_dxf_bytes,
    reconstruct_text_grids, suggest_unit,
)
from tests import cad_fixtures as F


@pytest.fixture(scope="module")
def site():
    return import_dxf_bytes(F.to_bytes(F.site_m()), "site.dxf", recognize=False)


def _inserts(result, **match):
    return [i for i in result["inserts"] if all(i.get(k) == v for k, v in match.items())]


def _close(a, b, tol=1e-6):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


# ── envelope / units ────────────────────────────────────────────────────────────
def test_envelope_matches_contract(site):
    for key in ("version", "filename", "dxf_version", "units", "extents", "layers", "entities",
                "inserts", "closed_outlines", "tables", "xrefs", "warnings", "stats"):
        assert key in site
    assert site["version"] == 1
    assert site["dxf_version"] == "AC1032"
    assert site["units"] == {"insunits": 6, "name": "m", "to_m": 1.0, "unitless": False, "suggested": None}
    assert "recognition" not in site
    assert {e["kind"] for e in site["entities"]} <= {"polyline", "circle", "text", "hatch", "point"}
    assert site["stats"]["entities"] == len(site["entities"])
    assert site["stats"]["inserts"] == len(site["inserts"])
    assert isinstance(site["stats"]["parse_ms"], int)
    layers = {l["name"]: l for l in site["layers"]}
    assert layers["NOZZLES"]["color"] == 1 and layers["NOZZLES"]["entity_count"] > 0
    assert {"off", "frozen"} <= set(layers["POOL"])


def test_millimetre_drawing_is_converted_to_metres():
    r = import_dxf_bytes(F.to_bytes(F.basin_mm()), "mm.dxf")
    assert r["units"]["name"] == "mm" and r["units"]["to_m"] == 0.001
    assert r["extents"] == {"min": [0.0, 0.0], "max": [10.0, 5.0]}
    outline = r["closed_outlines"][0]
    assert outline["area_m2"] == pytest.approx(50.0)
    circle = next(e for e in r["entities"] if e["kind"] == "circle")
    assert circle["center"] == [5.0, 2.5] and circle["radius"] == pytest.approx(0.05)


def test_unitless_drawing_gets_a_suggested_unit():
    r = import_dxf_bytes(F.to_bytes(F.unitless()), "u.dxf", recognize=False)
    u = r["units"]
    assert u["unitless"] is True and u["insunits"] == 0 and u["suggested"] == "mm"
    assert r["extents"]["max"] == [25.0, 12.0]
    assert any("unitless" in w for w in r["warnings"])
    # explicit override wins
    r2 = import_dxf_bytes(F.to_bytes(F.unitless()), "u.dxf", units="cm", recognize=False)
    assert r2["units"]["name"] == "cm" and r2["extents"]["max"] == [250.0, 120.0]


def test_suggest_unit_heuristic():
    assert suggest_unit(25) == "m"
    assert suggest_unit(25000) == "mm"
    assert suggest_unit(0) is None
    assert suggest_unit(1e9) is None


def test_bad_units_override_rejected():
    with pytest.raises(CadImportError):
        import_dxf_bytes(F.to_bytes(F.basin_mm()), "mm.dxf", units="parsec")


# ── readers ─────────────────────────────────────────────────────────────────────
def test_binary_dxf_reads_like_ascii():
    doc = F.site_m()
    asc = import_dxf_bytes(F.to_bytes(doc, "asc"), "a.dxf", recognize=False)
    binr = import_dxf_bytes(F.to_bytes(doc, "bin"), "b.dxf", recognize=False)
    assert F.to_bytes(doc, "bin").startswith(b"AutoCAD Binary DXF")
    assert binr["stats"]["entities"] == asc["stats"]["entities"]
    assert [i["position"] for i in binr["inserts"]] == [i["position"] for i in asc["inserts"]]


def test_damaged_file_uses_recover_mode():
    text = F.to_bytes(F.basin_mm()).decode()
    # drop the HEADER section terminator → strict reader fails, recover still loads
    damaged = text.replace("$INSUNITS", "$INSUNITS", 1)
    lines = damaged.split("\n")
    idx = lines.index("ENDSEC")
    del lines[idx - 1: idx + 1]
    r = import_dxf_bytes("\n".join(lines).encode(), "bad.dxf", recognize=False)
    assert any("recover" in w for w in r["warnings"])
    assert any(o["area_m2"] > 0 for o in r["closed_outlines"]) or r["stats"]["entities"] >= 0


def test_dwg_and_garbage_are_rejected():
    with pytest.raises(CadImportError) as exc:
        import_dxf_bytes(b"AC1032" + b"\0" * 100, "x.dwg")
    assert exc.value.status == 415
    with pytest.raises(CadImportError):
        import_dxf_bytes(b"this is not a drawing at all", "x.dxf")
    with pytest.raises(CadImportError):
        import_dxf_bytes(b"", "x.dxf")


def test_size_cap_is_configurable():
    data = F.to_bytes(F.basin_mm())
    with pytest.raises(CadImportError) as exc:
        import_dxf_bytes(data, "x.dxf", max_mb=len(data) / 1048576 / 2)
    assert exc.value.status == 413
    assert import_dxf_bytes(data, "x.dxf", max_mb=100)["units"]["name"] == "mm"


# ── block expansion ─────────────────────────────────────────────────────────────
def test_nested_rotated_block_positions(site):
    ring = _inserts(site, block="RING4", rotation_deg=90.0)[0]
    children = [i for i in site["inserts"] if i["parent_handle"] == ring["handle"]]
    assert len(children) == 4 and all(c["depth"] == 1 for c in children)
    got = sorted(tuple(c["position"][:2]) for c in children)
    assert got == sorted([(10.0, 6.0), (9.0, 5.0), (10.0, 4.0), (11.0, 5.0)])
    assert all(c["block_path"] == [ring["handle"]] for c in children)
    assert all(c["instance_id"].startswith(ring["handle"] + "/") for c in children)
    assert len({c["instance_id"] for c in site["inserts"]}) == len(site["inserts"])


def test_mirrored_by_scale_and_by_extrusion(site):
    rings = [i for i in site["inserts"] if i["block"] == "RING4" and i["mirrored"]]
    assert len(rings) == 2
    for ring, cx in zip(sorted(rings, key=lambda r: r["position"][0]), (20.0, 30.0)):
        assert ring["position"][:2] == [cx, 5.0]
        assert ring["scale"][0] == -1.0 and ring["rotation_deg"] == 0.0
        kids = sorted(tuple(c["position"][:2]) for c in site["inserts"] if c["parent_handle"] == ring["handle"])
        # block point (1,0) lands at cx-1 when mirrored
        assert (cx - 1.0, 5.0) in kids and (cx + 1.0, 5.0) in kids
    # entities of mirrored blocks: circles at the mirrored centres
    centres = {tuple(e["center"]) for e in site["entities"] if e["kind"] == "circle"}
    assert (29.0, 5.0) in centres and (19.0, 5.0) in centres


def test_layer0_and_byblock_inheritance(site):
    circles = [e for e in site["entities"] if e["kind"] == "circle" and len(e["block_path"]) == 2]
    assert circles and all(c["layer"] == "NOZZLES" for c in circles)
    assert all(c["color"] == 1 for c in circles)  # BYBLOCK → insert BYLAYER → NOZZLES colour 1


def test_attribs_and_aquaflow_xdata(site):
    n1 = next(i for i in site["inserts"] if i["attribs"].get("ID") == "N-01")
    assert n1["attribs"] == {"ID": "N-01", "MODEL": "JET-25", "DMX": "17"}
    assert n1["xdata"] == {"AQUAFLOW": {"kind": "fixture", "id": "noz_1", "type": "nozzle"}}
    assert n1["rotation_deg"] == pytest.approx(30.0)
    att_texts = [e for e in site["entities"] if e.get("source") == "ATTRIB"]
    assert {t["text"] for t in att_texts} >= {"N-01", "JET-25"}
    assert all(t["owner_handle"] == n1["handle"] for t in att_texts)


def test_decode_xdata_formats():
    assert decode_xdata([(1001, "AQUAFLOW")] + F.aquaflow_xdata({"id": "a", "type": "light"})) == \
        {"id": "a", "type": "light"}
    assert decode_xdata([(1000, "id=x"), (1000, "type=pump")]) == {"id": "x", "type": "pump"}
    assert decode_xdata([(1000, '{"id": "j"}')]) == {"id": "j"}


def test_dynamic_block_effective_names(site):
    names = {i["block"]: i["effective_name"] for i in site["inserts"] if i["block"].startswith("*U")}
    assert sorted(names.values()) == ["LED_SPOT", "PUMP_SUB_5HP"]


def test_xrefs_listed_and_warned(site):
    assert site["xrefs"] == ["SURVEY"]
    assert any("SURVEY" in w for w in site["warnings"])


# ── curves, hatch, text, point ──────────────────────────────────────────────────
def test_curves_flattened_within_tolerance(site):
    by_src = {}
    for e in site["entities"]:
        if e["kind"] == "polyline" and e["layer"] == "POOL":
            by_src.setdefault(e["source"], []).append(e)
    arc = by_src["ARC"][0]
    assert not arc["closed"]
    for x, y in arc["points"]:
        assert abs(math.hypot(x - 2, y - 10) - 1.0) <= 0.01 + 1e-9
    assert arc["points"][0] == pytest.approx([3.0, 10.0]) and arc["points"][-1] == pytest.approx([1.0, 10.0])
    # bulge 1 between (5,10) and (7,10) = half circle of radius 1 about (6,10)
    bulge = next(e for e in by_src["LWPOLYLINE"] if not e["closed"])
    assert len(bulge["points"]) > 3
    for x, y in bulge["points"]:
        assert abs(math.hypot(x - 6, y - 10) - 1.0) <= 0.011
    assert len(by_src["SPLINE"][0]["points"]) > 4
    ell = by_src["ELLIPSE"][0]
    assert ell["closed"]
    xs = [p[0] for p in ell["points"]]
    ys = [p[1] for p in ell["points"]]
    assert max(xs) - min(xs) == pytest.approx(2.0, abs=0.02)
    assert max(ys) - min(ys) == pytest.approx(1.0, abs=0.02)


def test_finer_tolerance_gives_more_points():
    coarse = import_dxf_bytes(F.to_bytes(F.site_m()), "s.dxf", flatten_tol=0.05, recognize=False)
    fine = import_dxf_bytes(F.to_bytes(F.site_m()), "s.dxf", flatten_tol=0.001, recognize=False)
    n = lambda r: len(next(e for e in r["entities"] if e.get("source") == "ARC")["points"])
    assert n(fine) > n(coarse)


def test_hatch_text_point(site):
    hatch = next(e for e in site["entities"] if e["kind"] == "hatch")
    assert hatch["pattern"] == "GRASS" and hatch["layer"] == "LAND"
    xs = [p[0] for p in hatch["loops"][0]]
    assert len(hatch["loops"]) == 1 and min(xs) == 0 and max(xs) == 10
    rot = next(e for e in site["entities"] if e["kind"] == "text" and e["text"] == "ROTATED")
    assert rot["rotation_deg"] == pytest.approx(45.0) and rot["height"] == pytest.approx(0.3)
    assert rot["position"] == [1.0, 1.0]
    mtext = next(e for e in site["entities"] if e.get("source") == "MTEXT")
    assert mtext["text"] == "Line A\nLine B"
    pt = next(e for e in site["entities"] if e["kind"] == "point")
    assert pt["position"] == [7.0, 7.0]


# ── outlines ─────────────────────────────────────────────────────────────────────
def test_l_shaped_basin_with_island_hole():
    r = import_dxf_bytes(F.to_bytes(F.spanish_site()), "es.dxf", recognize=False)
    basin = next(o for o in r["closed_outlines"] if o["layer"] == "VASO")
    island = next(o for o in r["closed_outlines"] if o["layer"] == "ISLA")
    assert basin["area_m2"] == pytest.approx(224.0)
    assert basin["holes"] == [island["points"]] and basin["hole_handles"] == [island["handle"]]
    assert island["parent_handle"] == basin["handle"] and island["area_m2"] == pytest.approx(9.0)


def test_small_symbols_never_become_holes():
    ents = [
        {"kind": "polyline", "closed": True, "handle": "A", "layer": "P",
         "points": [[0, 0], [10, 0], [10, 10], [0, 10]]},
        {"kind": "polyline", "closed": True, "handle": "B", "layer": "P",
         "points": [[1, 1], [1.1, 1], [1.1, 1.1], [1, 1.1]]},
    ]
    out = closed_outlines(ents)
    assert next(o for o in out if o["handle"] == "A")["holes"] == []


# ── schedules (AF-CAD-016) ──────────────────────────────────────────────────────
def test_text_grid_schedule(site):
    grid = next(t for t in site["tables"] if t["source"] == "text_grid")
    assert grid["layer"] == "SCHED"
    assert grid["rows"] == [["TAG", "MODEL", "FLOW (L/MIN)", "HEIGHT (M)"],
                            ["N-01", "JET-25", "40", "2.0"],
                            ["N-02", "JET-30", "55", "3.5"],
                            ["L-01", "RGB-9", "", ""]]


def test_scattered_labels_are_not_a_table():
    texts = [{"text": f"N-{k}", "x0": k * 3.0, "x1": k * 3.0 + 0.5, "y": k * 2.0, "h": 0.2,
              "layer": "T", "handle": str(k), "source": "TEXT", "multiline": False} for k in range(8)]
    assert reconstruct_text_grids(texts) == []


def test_acad_table_is_read():
    text = F.to_bytes(F.basin_mm()).decode()
    rows = [["TAG", "MODEL", "FLOW"], ["N-01", "JET-25", "40"], ["P-01", "PUMP-5", ""]]
    data = F.with_acad_table(text, rows).encode()
    r = import_dxf_bytes(data, "t.dxf", recognize=False)
    table = next(t for t in r["tables"] if t["source"] == "acad_table")
    assert table["rows"] == rows and table["handle"] == "ABCD1" and table["layer"] == "SCHED"
    assert table["position"] == [50.0 * 0.001, 30.0 * 0.001]


# ── diff (AF-CAD-017) ───────────────────────────────────────────────────────────
def test_diff_match_order_and_buckets():
    previous = [
        {"id": "noz_1", "type": "nozzle", "position": [0, 0], "aquaflow_id": "noz_1"},
        {"id": "noz_2", "type": "nozzle", "position": [5, 5], "source_handle": "2F"},
        {"id": "noz_3", "type": "nozzle", "position": [9, 9]},
        {"id": "light_1", "type": "light", "position": [20, 20]},
    ]
    candidates = [
        {"id": "cand_0", "type": "nozzle", "position": [1, 0], "aquaflow_id": "noz_1", "source_handle": "AA"},
        {"id": "cand_1", "type": "nozzle", "position": [5, 5], "source_handle": "2F"},
        {"id": "cand_2", "type": "nozzle", "position": [9.03, 9]},
        {"id": "cand_3", "type": "pump", "position": [30, 0]},
    ]
    d = diff_import(previous, candidates)
    moved = {m["id"]: m for m in d["moved"]}
    assert moved["noz_1"]["match"] == "aquaflow_id" and moved["noz_1"]["distance_m"] == pytest.approx(1.0)
    assert moved["noz_1"]["from"] == [0.0, 0.0] and moved["noz_1"]["to"] == [1.0, 0.0]
    assert moved["noz_3"]["match"] == "proximity" and moved["noz_3"]["distance_m"] == pytest.approx(0.03)
    assert [u["id"] for u in d["unchanged"]] == ["noz_2"] and d["unchanged"][0]["match"] == "source_handle"
    assert [r["id"] for r in d["removed"]] == ["light_1"]
    assert [a["id"] for a in d["added"]] == ["cand_3"]


def test_diff_proximity_respects_type_and_radius():
    d = diff_import([{"id": "a", "type": "nozzle", "position": [0, 0]}],
                    [{"id": "c", "type": "light", "position": [0, 0]},
                     {"id": "d", "type": "nozzle", "position": [0.2, 0]}])
    assert [r["id"] for r in d["removed"]] == ["a"] and len(d["added"]) == 2


def test_diff_refuses_duplicate_xdata_ids():
    d = diff_import([{"id": "x", "type": "nozzle", "position": [0, 0], "aquaflow_id": "x"}],
                    [{"id": "c0", "type": "nozzle", "position": [3, 3], "aquaflow_id": "x"},
                     {"id": "c1", "type": "nozzle", "position": [4, 4], "aquaflow_id": "x"}])
    assert d["warnings"] and [r["id"] for r in d["removed"]] == ["x"]


# ── route ────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def client():
    app = FastAPI()
    app.include_router(cad_router, prefix="/api/cad")
    return TestClient(app)


def test_import_route_multipart(client):
    data = F.to_bytes(F.spanish_site())
    res = client.post("/api/cad/import", files={"file": ("es.dxf", data, "application/dxf")})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["filename"] == "es.dxf" and body["units"]["name"] == "m"
    assert body["recognition"]["candidates"]
    # options via form fields and query
    res = client.post("/api/cad/import?recognize=false", files={"file": ("u.dxf", F.to_bytes(F.unitless()))},
                      data={"units": "mm", "flatten_tol": "0.005"})
    assert res.status_code == 200
    assert "recognition" not in res.json() and res.json()["units"]["name"] == "mm"


def test_import_route_errors(client):
    assert client.post("/api/cad/import", data={"units": "m"}).status_code == 400
    res = client.post("/api/cad/import", files={"file": ("x.dwg", b"AC1032" + b"\0" * 64)})
    assert res.status_code == 415
    big = F.to_bytes(F.site_m())
    res = client.post("/api/cad/import", files={"file": ("b.dxf", big)},
                      data={"max_mb": str(len(big) / 1048576 / 4)})
    assert res.status_code == 413
    res = client.post("/api/cad/import", files={"file": ("b.dxf", big)}, data={"template": "no-such"})
    assert res.status_code == 404


def test_diff_route(client):
    res = client.post("/api/cad/diff", json={"previous": [{"id": "a", "type": "nozzle", "position": [0, 0]}],
                                             "candidates": [{"id": "c", "type": "nozzle", "position": [0, 0]}]})
    assert res.status_code == 200 and res.json()["unchanged"][0]["id"] == "a"
    assert client.post("/api/cad/diff", json={"previous": "x"}).status_code == 400


def test_existing_layout_route_untouched(client):
    res = client.post("/api/cad/layout", json={})
    assert res.status_code in (200, 400)


# ── round trip with the ezdxf writer (AF-CAD-020 → AF-CAD-010/012/017) ──────────
def test_cad_export_roundtrip_has_one_island_and_no_depth_zone_hole():
    from services.cad_export import export_dxf
    from tests.test_cad_export import DESIGN
    r = import_dxf_bytes(export_dxf(DESIGN).encode("utf-8"), "rt.dxf")
    pool = next(o for o in r["closed_outlines"] if o["layer"] == "POOL_OUTLINE")
    assert len(pool["holes"]) == 1 and pool["excluded"] is None
    depth = next(o for o in r["closed_outlines"] if o["layer"] == "DEPTH_ZONES")
    assert depth["excluded"] and depth["parent_handle"] is None
    basins = r["recognition"]["basins"]
    assert [b["role"] for b in basins].count("basin") == 1
    assert [b["role"] for b in basins].count("island") == 1
    assert next(b for b in basins if b["role"] == "basin")["hole_handles"] == pool["hole_handles"]
    assert not any(b["layer"] == "DEPTH_ZONES" for b in basins)
    # every fixture matched by XDATA, positions within 1 mm (CAD frame = (x, -y) of plan)
    cands = {c["aquaflow_id"]: c for c in r["recognition"]["candidates"]}
    for fx in DESIGN["fixtures"]:
        c = cands[fx["id"]]
        assert math.hypot(c["position"][0] - fx["x"], c["position"][1] + fx["y"]) <= 1e-3
    previous = [{"id": fx["id"], "type": cands[fx["id"]]["type"], "aquaflow_id": fx["id"],
                 "position": [fx["x"], -fx["y"]]} for fx in DESIGN["fixtures"]]
    d = diff_import(previous, r["recognition"]["candidates"])
    assert len(d["unchanged"]) == len(DESIGN["fixtures"]) and not (d["added"] or d["moved"] or d["removed"])


@pytest.mark.parametrize("layer,xdata,excluded", [
    ("DEPTH_ZONES", None, True), ("DIMENSIONS", None, True), ("MEASUREMENTS", None, True),
    ("A-ANNO-TEXT", None, True), ("COTAS", None, True), ("Tiefenzone", None, True),
    ("POOL", None, False), ("VASO", None, False), ("POOL_ISLANDS", None, False),
    ("DEPTH_ZONES", {"AQUAFLOW": {"kind": "pool"}}, False),
    ("POOL_OUTLINE", {"AQUAFLOW": {"kind": "depth"}}, True),
    ("POOL_OUTLINE", {"AQUAFLOW": {"kind": "land"}}, True),
])
def test_outline_exclusion_rules(layer, xdata, excluded):
    from services.cad_import import outline_exclusion
    assert bool(outline_exclusion(layer, xdata)) is excluded


def test_depth_zone_layer_never_punches_a_hole():
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 6
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (10, 0), (10, 10), (0, 10)], close=True, dxfattribs={"layer": "POOL"})
    msp.add_lwpolyline([(1, 1), (4, 1), (4, 4), (1, 4)], close=True, dxfattribs={"layer": "DEPTH ZONE"})
    msp.add_lwpolyline([(6, 6), (8, 6), (8, 8), (6, 8)], close=True, dxfattribs={"layer": "ISLAND"})
    msp.add_lwpolyline([(-1, -1), (11, -1), (11, -2), (-1, -2)], close=True, dxfattribs={"layer": "DIM"})
    r = import_dxf_bytes(F.to_bytes(doc), "dz.dxf")
    pool = next(o for o in r["closed_outlines"] if o["layer"] == "POOL")
    assert len(pool["holes"]) == 1
    roles = {b["layer"]: b["role"] for b in r["recognition"]["basins"]}
    assert roles == {"POOL": "basin", "ISLAND": "island"}
