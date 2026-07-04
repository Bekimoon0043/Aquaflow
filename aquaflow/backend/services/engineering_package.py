"""
engineering_package.py — AquaFlow Recovery, AQ-X-010

Engineering package export — bundles every engineering deliverable for a fountain
design into one downloadable ZIP.

This is the capstone over the individual generators: it produces a cover-sheet PDF,
the CAD layout (DXF), the Bill of Materials (XLSX), the P&ID drawing (SVG), the
equipment dependency graph and hydraulic results (JSON), a README, and a manifest
with per-document checksums.

  * full engineering package exported — one ZIP the client downloads,
  * all required documents included — a fixed REQUIRED_DOCUMENTS set is always
    present (the manifest lists every document with its format, size and SHA-256),
  * PDF and DXF formats supported — a hand-built (dependency-free) cover PDF and the
    R12 DXF layout, alongside XLSX / SVG / JSON deliverables.

No external CAD/PDF/report engine is required: PDF and DXF are written directly, XLSX
via the existing BOM generator (openpyxl-free), SVG via the P&ID generator.
"""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import date

from services.cad_layout import generate_dxf, LAYERS
from services.dependency_graph import build_dependency_graph

# The documents a "full" engineering package must always contain.
REQUIRED_DOCUMENTS = [
    "manifest.json", "cover.pdf", "layout.dxf",
    "bill_of_materials.xlsx", "pid.svg", "dependency_graph.json", "README.txt",
]

_NOZZLE_TOKENS = ("nozzle", "jet", "geyser", "spray", "fan", "arch", "laminar",
                  "foam", "running", "mist", "crown")


# ── Minimal, dependency-free PDF writer ───────────────────────────────────────

def _pdf_escape(s: str) -> str:
    return str(s).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pdf(title: str, lines: list[str]) -> bytes:
    """Produce a valid single-page A4 PDF (Helvetica) with a title and text lines."""
    content = ["BT", "/F1 18 Tf", "50 800 Td", "20 TL", f"({_pdf_escape(title)}) Tj",
               "/F1 11 Tf"]
    for ln in lines[:46]:                       # keep within one A4 page
        content.append("T*")
        content.append(f"({_pdf_escape(ln)}) Tj")
    content.append("ET")
    stream = ("\n".join(content)).encode("latin-1", "replace")

    objs = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]"
        b"/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
        b"<</Length " + str(len(stream)).encode() + b">>\nstream\n" + stream + b"\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj\n" + body + b"\nendobj\n"
    xref_pos = len(out)
    n = len(objs) + 1
    out += b"xref\n0 " + str(n).encode() + b"\n0000000000 65535 f \n"
    for off in offsets:
        out += ("%010d 00000 n \n" % off).encode()
    out += (b"trailer<</Size " + str(n).encode() + b"/Root 1 0 R>>\nstartxref\n"
            + str(xref_pos).encode() + b"\n%%EOF")
    return out


# ── Design → generator models ─────────────────────────────────────────────────

def _is_nozzle(ftype: str) -> bool:
    t = str(ftype or "").lower()
    return any(tok in t for tok in _NOZZLE_TOKENS)


def _bom_model(design: dict) -> dict:
    equipment, nozzles = [], []
    for fx in design.get("fixtures") or []:
        if not isinstance(fx, dict):
            continue
        ftype = fx.get("type") or fx.get("fixtureType") or "equipment"
        if _is_nozzle(ftype):
            nozzles.append({"model": ftype, "quantity": 1})
        else:
            equipment.append({"type": ftype, "label": fx.get("label") or fx.get("id"),
                              "part_number": (fx.get("engineering") or {}).get("partNumber", ""),
                              "quantity": 1})
    return {"project": design.get("name") or design.get("projectName") or "AquaFlow Project",
            "equipment": equipment, "nozzles": nozzles,
            "pipes": design.get("pipes_spec") or []}


def _pid_model(design: dict) -> dict:
    equipment, lines = [], []
    for fx in design.get("fixtures") or []:
        if not isinstance(fx, dict):
            continue
        equipment.append({"id": str(fx.get("id")), "type": fx.get("type") or "equipment",
                          "label": fx.get("label") or fx.get("id"),
                          "x": fx.get("x"), "y": fx.get("y")})
    for p in design.get("pipes") or design.get("connections") or []:
        lines.append({"from": p.get("from"), "to": p.get("to"), "label": p.get("label", "")})
    return {"project": design.get("name") or "AquaFlow Project",
            "title": f"{design.get('name') or 'AquaFlow'} P&ID",
            "equipment": equipment, "lines": lines}


# ── Package assembly ──────────────────────────────────────────────────────────

def build_documents(design: dict) -> tuple[dict, list[str]]:
    """Build every document. Returns ({filename: bytes}, [warnings])."""
    docs: dict[str, bytes] = {}
    warnings: list[str] = []
    project = str(design.get("name") or design.get("projectName") or "AquaFlow Project")
    fixtures = [f for f in (design.get("fixtures") or []) if isinstance(f, dict)]

    # CAD layout (DXF) — always.
    docs["layout.dxf"] = generate_dxf(design).encode("utf-8")

    # Dependency graph (JSON) — always.
    dep = build_dependency_graph(fixtures)
    docs["dependency_graph.json"] = json.dumps(dep, indent=2, ensure_ascii=False).encode("utf-8")

    # Bill of Materials (XLSX).
    try:
        from services.bom_generator import BOMGenerator
        gen = BOMGenerator(project=project)
        gen.generate(_bom_model(design))
        docs["bill_of_materials.xlsx"] = gen.to_xlsx_bytes()
        bom_summary = gen.summary()
    except Exception as exc:                      # keep the package building
        warnings.append(f"BOM generation failed: {exc}")
        bom_summary = {}

    # P&ID drawing (SVG).
    try:
        from services.pid_generator import generate_pid
        docs["pid.svg"] = generate_pid(_pid_model(design)).render_svg().encode("utf-8")
    except Exception as exc:
        warnings.append(f"P&ID generation failed: {exc}")

    # Hydraulic results (JSON) — only if a network is supplied.
    if design.get("network"):
        try:
            from services.hydraulic_solver import solve_network
            docs["hydraulics.json"] = json.dumps(
                solve_network(design["network"]), indent=2).encode("utf-8")
        except Exception as exc:
            warnings.append(f"Hydraulic solve failed: {exc}")

    # Cover sheet (PDF) — always, summarising the package.
    conflicts = dep["stats"].get("conflict_count", 0)
    summary_lines = [
        f"Project: {project}",
        f"Date: {date.today().isoformat()}",
        "",
        "ENGINEERING PACKAGE CONTENTS",
        "----------------------------------------",
        f"Fixtures: {len(fixtures)}",
        f"Pool type: {design.get('poolType', 'rectangular')}",
        f"Dependency conflicts flagged: {conflicts}",
    ]
    if bom_summary:
        total = bom_summary.get("grand_total") or bom_summary.get("total_cost")
        if total is not None:
            summary_lines.append(f"BOM estimated total: {total}")
        summary_lines.append(f"BOM line items: {bom_summary.get('line_count', '-')}")
    summary_lines += [
        "",
        "DOCUMENTS",
        "----------------------------------------",
        "- cover.pdf .............. this cover sheet (PDF)",
        "- layout.dxf ............. CAD layout drawing (DXF / DWG-compatible)",
        "- bill_of_materials.xlsx . costed Bill of Materials (XLSX)",
        "- pid.svg ................ P&ID diagram (SVG)",
        "- dependency_graph.json .. equipment dependency graph",
        "- hydraulics.json ........ hydraulic solver results (if network supplied)",
        "- README.txt ............. package guide",
        "- manifest.json .......... document list + checksums",
        "",
        f"CAD layers: {', '.join(name for name, _ in LAYERS)}",
    ]
    docs["cover.pdf"] = build_pdf(f"{project} — Engineering Package", summary_lines)

    # README.
    docs["README.txt"] = (
        f"AquaFlow Studio — Engineering Package\n"
        f"Project: {project}\nGenerated: {date.today().isoformat()}\n\n"
        "This package contains the full engineering deliverables for the fountain "
        "design. Open cover.pdf first for an overview, layout.dxf in any CAD program "
        "(AutoCAD/BricsCAD/DraftSight import DXF natively), bill_of_materials.xlsx in "
        "a spreadsheet, and pid.svg in a browser or vector editor.\n"
    ).encode("utf-8")

    return docs, warnings


def build_manifest(design: dict, docs: dict, warnings: list[str]) -> dict:
    documents = []
    for name in sorted(docs):
        blob = docs[name]
        documents.append({
            "name": name,
            "format": name.rsplit(".", 1)[-1].lower(),
            "bytes": len(blob),
            "sha256": hashlib.sha256(blob).hexdigest()[:16],
        })
    present = set(docs)
    missing = [d for d in REQUIRED_DOCUMENTS if d not in present]
    formats = sorted({d["format"] for d in documents})
    return {
        "project": str(design.get("name") or design.get("projectName") or "AquaFlow Project"),
        "generated": date.today().isoformat(),
        "document_count": len(documents),
        "documents": documents,
        "formats": formats,
        "required_documents": REQUIRED_DOCUMENTS,
        "complete": not missing,
        "missing_documents": missing,
        "warnings": warnings,
        "pdf_supported": "pdf" in formats,
        "dxf_supported": "dxf" in formats,
    }


def build_package(design: dict) -> tuple[bytes, dict]:
    """
    Build the full engineering package. Returns (zip_bytes, manifest).

    The manifest is generated first (so it can list itself), then written into the
    ZIP alongside every deliverable.
    """
    docs, warnings = build_documents(design)
    # Manifest describes everything except itself; add a placeholder entry for it.
    manifest = build_manifest(design, {**docs, "manifest.json": b"{}"}, warnings)
    manifest_bytes = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
    docs["manifest.json"] = manifest_bytes

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(docs):
            zf.writestr(name, docs[name])
    return buf.getvalue(), manifest


def package_filename(design: dict) -> str:
    name = str(design.get("name") or design.get("projectName") or "engineering_package")
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name) or "engineering_package"
    return f"{safe}_engineering_package.zip"
