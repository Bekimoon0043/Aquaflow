"""
Contract tests for the Engineering Package Export (AQ-X-010).

Asserts the three acceptance criteria:
  1. a full engineering package is exported (one valid ZIP of deliverables),
  2. all required documents are included (manifest complete + matching checksums),
  3. PDF and DXF formats are supported (valid cover PDF + DXF layout — the ezdxf
     AC1027 writer since AF-CAD-003; R12 stays available via cad_writer='r12').
"""
import io
import zipfile
import hashlib
import json

import pytest

from services.engineering_package import (
    build_package, build_documents, build_manifest, build_pdf, package_filename,
    REQUIRED_DOCUMENTS,
)


DESIGN = {
    "name": "Grand Plaza Fountain",
    "poolType": "rectangular", "params": {"width": 12, "length": 8},
    "fixtures": [
        {"id": "jet-1", "type": "center_jets", "label": "Jet 1", "x": 6, "y": 4},
        {"id": "rgb-1", "type": "light_rgb", "label": "Light 1", "x": 3, "y": 2},
        {"id": "pump-1", "type": "pump", "label": "Main Pump", "x": 11, "y": 7},
    ],
    "pipes": [{"from": "pump-1", "to": "jet-1"}],
    "network": {"nodes": [{"id": "r", "fixed_head": 20}, {"id": "n1"}, {"id": "s", "fixed_head": 0}],
                "pipes": [{"id": "p", "from": "r", "to": "n1", "length": 10, "diameter": 0.05},
                          {"id": "p2", "from": "n1", "to": "s", "length": 10, "diameter": 0.05}]},
}


@pytest.fixture(scope="module")
def package():
    zip_bytes, manifest = build_package(DESIGN)
    return zip_bytes, manifest, zipfile.ZipFile(io.BytesIO(zip_bytes))


# ── 1. full package ───────────────────────────────────────────────────────────

def test_package_is_valid_zip(package):
    _, _, zf = package
    assert zf.testzip() is None
    assert len(zf.namelist()) >= 7


def test_package_includes_all_generators(package):
    _, _, zf = package
    members = set(zf.namelist())
    assert {"layout.dxf", "bill_of_materials.xlsx", "pid.svg",
            "dependency_graph.json", "hydraulics.json"} <= members


def test_package_filename_sanitised():
    assert package_filename({"name": "My Pool #1"}) == "My_Pool__1_engineering_package.zip"


# ── 2. required documents ─────────────────────────────────────────────────────

def test_all_required_documents_present(package):
    _, manifest, zf = package
    members = set(zf.namelist())
    for doc in REQUIRED_DOCUMENTS:
        assert doc in members
    assert manifest["complete"] is True
    assert manifest["missing_documents"] == []


def test_manifest_lists_every_document(package):
    _, manifest, zf = package
    assert manifest["document_count"] == len(zf.namelist())
    names = {d["name"] for d in manifest["documents"]}
    assert names == set(zf.namelist())


def test_manifest_checksums_match(package):
    _, manifest, zf = package
    by_name = {d["name"]: d for d in manifest["documents"]}
    for name in zf.namelist():
        if name == "manifest.json":
            continue
        assert by_name[name]["sha256"] == hashlib.sha256(zf.read(name)).hexdigest()[:16]


def test_incomplete_manifest_reports_missing():
    # a document set missing a required doc must report incomplete
    docs = {"layout.dxf": b"x"}
    manifest = build_manifest(DESIGN, docs, [])
    assert manifest["complete"] is False
    assert "cover.pdf" in manifest["missing_documents"]


# ── 3. PDF + DXF formats ──────────────────────────────────────────────────────

def test_cover_pdf_is_valid(package):
    _, _, zf = package
    pdf = zf.read("cover.pdf")
    assert pdf.startswith(b"%PDF-1.")
    assert pdf.rstrip().endswith(b"%%EOF")
    assert b"xref" in pdf and b"trailer" in pdf
    assert b"Grand Plaza Fountain" in pdf          # project name rendered


def test_layout_dxf_is_ezdxf_writer(package):
    # AF-CAD-003: the package DXF comes from the single ezdxf writer (was R12).
    _, _, zf = package
    dxf = zf.read("layout.dxf").decode("utf-8")
    assert "AC1027" in dxf and dxf.rstrip().endswith("EOF")
    assert "AQF_NOZZLE_" in dxf and "AQUAFLOW" in dxf


def test_layout_dxf_legacy_r12_opt_in():
    docs, _ = build_documents({**DESIGN, "cad_writer": "r12"})
    dxf = docs["layout.dxf"].decode("utf-8")
    assert "AC1009" in dxf and dxf.rstrip().endswith("EOF")


def test_manifest_advertises_pdf_and_dxf(package):
    _, manifest, _ = package
    assert manifest["pdf_supported"] is True
    assert manifest["dxf_supported"] is True
    assert {"pdf", "dxf", "xlsx", "svg", "json"} <= set(manifest["formats"])


def test_bom_xlsx_and_pid_svg_well_formed(package):
    _, _, zf = package
    assert zf.read("bill_of_materials.xlsx")[:2] == b"PK"      # xlsx = zip
    assert "<svg" in zf.read("pid.svg").decode("utf-8")
    deps = json.loads(zf.read("dependency_graph.json"))
    assert "nodes" in deps and "conflicts" in deps


# ── standalone PDF writer ─────────────────────────────────────────────────────

def test_build_pdf_valid_and_escapes():
    pdf = build_pdf("Title (x)", ["a (b)", "c\\d"])
    assert pdf.startswith(b"%PDF-1.") and pdf.rstrip().endswith(b"%%EOF")
    assert b"\\(b\\)" in pdf and b"c\\\\d" in pdf


def test_empty_design_still_complete():
    zip_bytes, manifest = build_package({"name": "Empty", "fixtures": []})
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    assert manifest["complete"] is True
    assert "cover.pdf" in zf.namelist() and "layout.dxf" in zf.namelist()


def test_build_documents_reports_no_warnings_for_valid_design():
    docs, warnings = build_documents(DESIGN)
    assert warnings == []
    assert "cover.pdf" in docs and "layout.dxf" in docs
