"""
validate_engineering_package.py — AQ-X-010 verification

Builds the full engineering package for a design and verifies:
  1. a full package is exported (one valid ZIP of deliverables),
  2. all required documents are included (manifest complete, checksums match),
  3. PDF and DXF formats are supported (valid cover PDF + ezdxf AC1027 DXF layout).

Run:  python backend/validate_engineering_package.py   (from the aquaflow/ dir)
"""
import os
import sys
import io
import zipfile
import hashlib
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.engineering_package import (
    build_package, build_pdf, build_documents, build_manifest, REQUIRED_DOCUMENTS,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


design = {
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

zip_bytes, manifest = build_package(design)
zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
members = set(zf.namelist())

print("== 1. full engineering package exported ==")
check("package is a valid ZIP", zf.testzip() is None)
check("package has multiple documents", len(members) >= 7, str(len(members)))
check("layout, BOM, P&ID, deps, hydraulics all present",
      {"layout.dxf", "bill_of_materials.xlsx", "pid.svg", "dependency_graph.json",
       "hydraulics.json"} <= members)

print("== 2. all required documents included ==")
for doc in REQUIRED_DOCUMENTS:
    check(f"{doc} present", doc in members)
check("manifest reports complete", manifest["complete"] is True, str(manifest["missing_documents"]))
check("manifest lists every document", manifest["document_count"] == len(members),
      f'{manifest["document_count"]} vs {len(members)}')
# Checksums in the manifest match the packaged bytes.
by_name = {d["name"]: d for d in manifest["documents"]}
ok_sums = all(
    d == "manifest.json" or by_name[d]["sha256"] == hashlib.sha256(zf.read(d)).hexdigest()[:16]
    for d in members if d in by_name
)
check("manifest checksums match packaged bytes", ok_sums)

print("== 3. PDF and DXF formats supported ==")
pdf = zf.read("cover.pdf")
check("cover.pdf is a valid PDF (header + EOF)",
      pdf.startswith(b"%PDF-1.") and pdf.rstrip().endswith(b"%%EOF"))
check("cover.pdf has an xref + trailer", b"xref" in pdf and b"trailer" in pdf)
check("cover.pdf carries the project name",
      b"Grand Plaza Fountain" in pdf)
dxf = zf.read("layout.dxf").decode("utf-8")
check("layout.dxf is the ezdxf AC1027 layout (AF-CAD-003)",
      "AC1027" in dxf and dxf.rstrip().endswith("EOF"))
check("manifest advertises PDF + DXF support",
      manifest["pdf_supported"] and manifest["dxf_supported"])
check("formats include pdf, dxf, xlsx, svg, json",
      {"pdf", "dxf", "xlsx", "svg", "json"} <= set(manifest["formats"]), str(manifest["formats"]))

print("== 3b. document files are well-formed ==")
xlsx = zf.read("bill_of_materials.xlsx")
check("BOM xlsx is a valid ZIP/xlsx (PK header)", xlsx[:2] == b"PK")
svg = zf.read("pid.svg").decode("utf-8")
check("P&ID is SVG", "<svg" in svg)
deps = json.loads(zf.read("dependency_graph.json"))
check("dependency graph JSON parses", "nodes" in deps and "conflicts" in deps)

print("== 4. standalone PDF writer ==")
p = build_pdf("Test (Doc)", ["line one", "second (with parens)", "back\\slash"])
check("build_pdf emits a valid PDF", p.startswith(b"%PDF-1.") and p.rstrip().endswith(b"%%EOF"))
check("build_pdf escapes special chars", b"\\(with parens\\)" in p and b"back\\\\slash" in p)

print("== 5. graceful with an empty design ==")
zb2, man2 = build_package({"name": "Empty", "fixtures": []})
zf2 = zipfile.ZipFile(io.BytesIO(zb2))
check("empty design still produces a complete package", man2["complete"] is True,
      str(man2["missing_documents"]))
check("empty package still has PDF + DXF", "cover.pdf" in zf2.namelist() and "layout.dxf" in zf2.namelist())

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
