"""
cad_routes.py — AquaFlow Recovery, AQ-X-009

CAD layout generator API — export a fountain design as a CAD-compatible DXF drawing.

  POST /api/cad/layout    → generate the DXF + metadata (JSON, dxf inline)
  POST /api/cad/layout.dxf → download the DXF file directly

AF-CAD-010 / 012 / 016 / 017 — DXF import, recognition, templates and re-import diff
(contract: docs/CAD-IMPORT-CONTRACT.md). Import never sends hardware commands.

  POST   /api/cad/import            → multipart DXF (ASCII/binary) → normalised JSON (metres)
  POST   /api/cad/recognize         → {"import", "template"} → recognition result
  GET    /api/cad/templates         → saved mapping templates
  POST   /api/cad/templates         → save/replace a mapping template
  DELETE /api/cad/templates/{name}  → delete a mapping template
  POST   /api/cad/diff              → {"previous", "candidates"} → added/moved/removed/unchanged
"""
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse

from services.cad_layout import generate_layout
from services.cad_import import (
    CadImportError, DEFAULT_FLATTEN_TOL_M, DEFAULT_MAX_MB, diff_import, import_dxf_bytes,
)
from services import cad_recognition

router = APIRouter()


@router.post("/layout")
async def layout(payload: dict):
    """Generate the CAD layout payload (DXF text + layers + stats + DWG note)."""
    try:
        return generate_layout(payload or {})
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(400, f"invalid design: {exc}")


@router.post("/layout.dxf")
async def layout_dxf(payload: dict):
    """Return the DXF as a downloadable file."""
    try:
        result = generate_layout(payload or {})
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(400, f"invalid design: {exc}")
    return PlainTextResponse(
        result["dxf"], media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{result["filename"]}"'})


# ── AF-CAD-010 / 012 / 016 / 017 ────────────────────────────────────────────────

def _opt(form, query, key, default=None):
    value = form.get(key) if form is not None else None
    if value is None or (isinstance(value, str) and value == ""):
        value = query.get(key)
    return default if value is None or value == "" else value


def _as_bool(value, default=True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in ("0", "false", "no", "off")


def _as_float(value, default, name):
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{name} must be a number")


def _resolve_template(value):
    """A template is an inline JSON object, or the name of a saved template."""
    if value in (None, "", "null"):
        return None
    if isinstance(value, dict):
        return value
    text = str(value).strip()
    if text.startswith("{"):
        try:
            return json.loads(text)
        except ValueError:
            raise HTTPException(400, "template is not valid JSON")
    found = cad_recognition.get_template(text)
    if found is None:
        raise HTTPException(404, f"template '{text}' not found")
    return found


@router.post("/import")
async def cad_import(request: Request):
    """Normalise an uploaded DXF (multipart field `file`) into the AF-CAD contract."""
    try:
        form = await request.form()
    except Exception as exc:  # noqa: BLE001 — malformed multipart bodies
        raise HTTPException(400, f"expected multipart/form-data with a 'file' field: {exc}")
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(400, "multipart field 'file' is required")
    q = request.query_params
    max_mb = _as_float(_opt(form, q, "max_mb"), DEFAULT_MAX_MB, "max_mb")
    if max_mb <= 0:
        max_mb = DEFAULT_MAX_MB
    flatten_tol = _as_float(_opt(form, q, "flatten_tol"), DEFAULT_FLATTEN_TOL_M, "flatten_tol")
    units = _opt(form, q, "units")
    recognize = _as_bool(_opt(form, q, "recognize"), True)
    template = _resolve_template(_opt(form, q, "template"))

    cap = int(max_mb * 1024 * 1024)
    chunks, size = [], 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > cap:
            raise HTTPException(413, f"file exceeds the {max_mb:g} MB import cap")
        chunks.append(chunk)
    data = b"".join(chunks)
    filename = getattr(upload, "filename", None) or "drawing.dxf"
    try:
        return await run_in_threadpool(
            import_dxf_bytes, data, filename, units=units, max_mb=max_mb,
            flatten_tol=flatten_tol, recognize=recognize, template=template)
    except CadImportError as exc:
        raise HTTPException(exc.status, str(exc))


@router.post("/recognize")
async def cad_recognize(payload: dict):
    """Re-run recognition on an import result, optionally with a mapping template."""
    imp = (payload or {}).get("import")
    if not isinstance(imp, dict):
        raise HTTPException(400, "body must contain the import result under 'import'")
    template = _resolve_template((payload or {}).get("template"))
    radius = (payload or {}).get("tag_radius_m")
    try:
        return await run_in_threadpool(cad_recognition.recognize, imp, template, radius)
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(400, f"invalid import payload: {exc}")


@router.get("/templates")
async def cad_templates_list():
    return {"templates": cad_recognition.list_templates()}


@router.post("/templates")
async def cad_templates_save(payload: dict):
    try:
        return cad_recognition.save_template(payload or {})
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.delete("/templates/{name}")
async def cad_templates_delete(name: str):
    if not cad_recognition.delete_template(name):
        raise HTTPException(404, f"template '{name}' not found")
    return {"deleted": name}


@router.post("/diff")
async def cad_diff(payload: dict):
    """AF-CAD-017 — compare a previous design with fresh candidates before applying."""
    previous = (payload or {}).get("previous")
    candidates = (payload or {}).get("candidates")
    if not isinstance(previous, list) or not isinstance(candidates, list):
        raise HTTPException(400, "body needs 'previous' and 'candidates' lists")
    try:
        return diff_import(previous, candidates,
                           proximity_m=float((payload or {}).get("proximity_m", 0.05)))
    except (TypeError, ValueError, KeyError, IndexError) as exc:
        raise HTTPException(400, f"invalid diff payload: {exc}")
