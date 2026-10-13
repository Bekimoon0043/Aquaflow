"""
Tests for the AutoLISP AQFEXPORT JSON ingest (AF-CAD-019).

The sample below is laid out exactly as tools/autocad/aquaflow_export.lsp writes it
(rtos mode 2 with 9 decimals, \\uXXXX escapes, raw AQUAFLOW XDATA strings).
"""
import io
import json
from pathlib import Path

import ezdxf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.cad_export import encode_metadata, export_dxf
from services.cad_lisp_import import import_aqf_json

XD = [v for _, v in encode_metadata({"kind": "fixture", "id": "noz_1", "type": "nozzle_geyser"})]

SAMPLE = """{
"format":"AQFEXPORT","version":1,
"drawing":"Plaza.dwg",
"acadver":"24.3s (LMS Tech)",
"insunits":4,
"inserts":[
{"handle":"3A0","name":"*U12","effective_name":"NOZZLE_JET_2M","layer":"NOZZLES","insertion":[1500.000000000,-2500.500000000,0.000000000],"rotation_deg":90.000000000,"scale":[1.000000000,1.000000000,1.000000000],"extrusion":[0.000000000,0.000000000,1.000000000],"attribs":{"ID":"N-01","MODEL":"JET-25","NOTE":"Font\\u00e4ne \\"A\\""},"xdata_aquaflow":[%s]},
{"handle":"3A1","name":"PUMP","effective_name":"PUMP","layer":"EQUIPMENT","insertion":[0.000000000,0.000000000,-500.000000000],"rotation_deg":0.000000000,"scale":[2.000000000,2.000000000,1.000000000],"extrusion":[0.000000000,0.000000000,1.000000000],"attribs":{},"xdata_aquaflow":[]}
]}""" % ",".join(json.dumps(c) for c in XD)


def test_sample_parses_to_contract_shape():
    r = import_aqf_json(SAMPLE)
    assert r["version"] == 1 and r["source"] == "autolisp"
    assert r["filename"] == "Plaza.dwg"
    assert r["units"] == {"insunits": 4, "name": "mm", "to_m": 0.001, "unitless": False, "suggested": None}
    assert r["entities"] == [] and len(r["inserts"]) == 2
    ins = r["inserts"][0]
    assert set(ins) >= {"handle", "block", "effective_name", "layer", "position", "rotation_deg",
                        "scale", "attribs", "xdata", "depth", "parent_handle"}
    assert ins["block"] == "*U12" and ins["effective_name"] == "NOZZLE_JET_2M"
    assert ins["position"] == pytest.approx([1.5, -2.5005, 0.0])          # mm → m
    assert ins["rotation_deg"] == 90.0
    assert ins["attribs"] == {"ID": "N-01", "MODEL": "JET-25", "NOTE": 'Fontäne "A"'}
    assert ins["xdata"] == {"AQUAFLOW": {"kind": "fixture", "id": "noz_1", "type": "nozzle_geyser"}}
    assert r["inserts"][1]["position"][2] == pytest.approx(-0.5)
    assert r["inserts"][1]["xdata"] == {}
    assert {l["name"]: l["entity_count"] for l in r["layers"]} == {"EQUIPMENT": 1, "NOZZLES": 1}
    assert r["extents"] == {"min": [0.0, -2.5005], "max": [1.5, 0.0]}


def test_bytes_and_dict_input_and_units_override():
    r = import_aqf_json(SAMPLE.encode("utf-8"), units="m")
    assert r["units"]["to_m"] == 1.0 and r["inserts"][0]["position"][0] == 1500.0
    assert import_aqf_json(json.loads(SAMPLE))["inserts"][0]["handle"] == "3A0"


def test_unitless_and_radians():
    doc = {"format": "AQFEXPORT", "insunits": 0,
           "inserts": [{"handle": "1", "name": "B", "insertion": [1, 2], "rotation": 3.141592653589793}]}
    r = import_aqf_json(doc)
    assert r["units"]["unitless"] is True and r["warnings"]
    assert r["inserts"][0]["rotation_deg"] == pytest.approx(180.0)
    assert r["inserts"][0]["position"] == [1.0, 2.0, 0.0]
    assert r["inserts"][0]["scale"] == [1.0, 1.0, 1.0]


@pytest.mark.parametrize("bad", ["not json", "[]", '{"format":"OTHER","inserts":[]}',
                                 '{"format":"AQFEXPORT"}'])
def test_rejects_non_aqfexport(bad):
    with pytest.raises(ValueError):
        import_aqf_json(bad)


def test_damaged_xdata_warns():
    doc = {"format": "AQFEXPORT", "insunits": 6,
           "inserts": [{"handle": "9", "name": "B", "insertion": [0, 0, 0], "xdata_aquaflow": ["zz"]}]}
    r = import_aqf_json(doc)
    assert r["inserts"][0]["xdata"] == {} and any("XDATA" in w for w in r["warnings"])


def test_lossless_against_exported_dxf():
    """AQFEXPORT of a drawing AquaFlow exported matches every fixture by XDATA id
    and reproduces the DXF insertion points within 1 mm."""
    design = {"fixtures": [{"id": f"n{i}", "type": "nozzle_geyser", "label": f"N{i}",
                            "x": 0.1234 * i, "y": 1.5 + 0.25 * i, "rotation": 15 * i}
                           for i in range(6)]}
    doc = ezdxf.read(io.StringIO(export_dxf(design)))
    lisp = {"format": "AQFEXPORT", "version": 1, "insunits": doc.header["$INSUNITS"], "inserts": []}
    for e in doc.modelspace().query("INSERT"):          # what AQFEXPORT would write
        lisp["inserts"].append({
            "handle": e.dxf.handle, "name": e.dxf.name, "effective_name": e.dxf.name,
            "layer": e.dxf.layer, "insertion": [round(c, 9) for c in e.dxf.insert],
            "rotation_deg": round(e.dxf.rotation, 9), "scale": [1, 1, 1],
            "attribs": {a.dxf.tag: a.dxf.text for a in e.attribs},
            "xdata_aquaflow": [t.value for t in e.get_xdata("AQUAFLOW") if t.code == 1000],
        })
    r = import_aqf_json(json.dumps(lisp))
    by_id = {i["xdata"]["AQUAFLOW"]["id"]: i for i in r["inserts"]}
    assert set(by_id) == {f["id"] for f in design["fixtures"]}
    for f in design["fixtures"]:
        ins = by_id[f["id"]]
        assert abs(ins["position"][0] - f["x"]) < 1e-3
        assert abs(ins["position"][1] + f["y"]) < 1e-3           # CAD +Y up
        assert ins["rotation_deg"] == pytest.approx(-f["rotation"])
        assert ins["attribs"]["ID"] == f["label"]


def test_lsp_tool_exists_and_writes_contract_fields():
    root = Path(__file__).resolve().parents[2] / "tools" / "autocad"
    lsp = (root / "aquaflow_export.lsp").read_text(encoding="utf-8")
    for token in ("c:AQFEXPORT", "vla-get-EffectiveName", "INSUNITS", "\"AQUAFLOW\"",
                  "effective_name", "insertion", "rotation_deg", "attribs", "xdata_aquaflow"):
        assert token in lsp
    assert lsp.count("(") == lsp.count(")")
    assert (root / "README.md").exists()


def test_import_route():
    from api.routes.cad_exchange_routes import router
    app = FastAPI()
    app.include_router(router, prefix="/api/cad")
    client = TestClient(app)
    r = client.post("/api/cad/import/aqf-json", json=json.loads(SAMPLE))
    assert r.status_code == 200 and r.json()["inserts"][0]["position"][0] == pytest.approx(1.5)
    r = client.post("/api/cad/import/aqf-json?units=m",
                    json={"data": json.loads(SAMPLE), "filename": "x.json"})
    assert r.status_code == 200 and r.json()["filename"] == "x.json"
    assert r.json()["inserts"][0]["position"][0] == pytest.approx(1500.0)
    assert client.post("/api/cad/import/aqf-json", json={"format": "nope"}).status_code == 400
