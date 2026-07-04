"""
collab_routes.py — AquaFlow Stage 3, Priority 10 (AQ-S3-010)

Cloud Collaboration System API: open a shared show document, join as a user, apply
field-level edits with 3-way merge, resolve conflicts, browse version history, and
revert.
"""
from fastapi import APIRouter, HTTPException

from services.collaboration import get_hub

router = APIRouter()


def _doc(doc_id: str):
    d = get_hub().get(doc_id)
    if d is None:
        raise HTTPException(404, f"Document '{doc_id}' not found — open it first.")
    return d


@router.post("/open")
async def open_doc(payload: dict):
    """Open (or create) a collaborative document."""
    doc_id = payload.get("doc_id")
    if not doc_id:
        raise HTTPException(400, "doc_id required")
    d = get_hub().open(str(doc_id), payload.get("initial"))
    return d.snapshot()


@router.post("/join")
async def join(payload: dict):
    d = _doc(payload.get("doc_id"))
    d.join(str(payload.get("user_id")), payload.get("name", ""), payload.get("cursor"))
    return {"users": d.active_users(), "version": d.version}


@router.post("/leave")
async def leave(payload: dict):
    d = _doc(payload.get("doc_id"))
    d.leave(str(payload.get("user_id")))
    return {"users": d.active_users()}


@router.post("/cursor")
async def cursor(payload: dict):
    d = _doc(payload.get("doc_id"))
    d.set_cursor(str(payload.get("user_id")), payload.get("cursor"))
    return {"users": d.active_users()}


@router.post("/edit")
async def edit(payload: dict):
    """Apply a field-level patch made against base_version (3-way merge)."""
    d = _doc(payload.get("doc_id"))
    return d.apply_edit(str(payload.get("user_id")), int(payload.get("base_version", d.version)),
                        payload.get("changes", {}), payload.get("message", ""))


@router.post("/resolve")
async def resolve(payload: dict):
    d = _doc(payload.get("doc_id"))
    return d.resolve_conflicts(str(payload.get("user_id")), payload.get("resolutions", {}),
                               payload.get("message", "resolve"))


@router.post("/revert")
async def revert(payload: dict):
    d = _doc(payload.get("doc_id"))
    return d.revert(str(payload.get("user_id")), int(payload.get("version", 0)))


@router.get("/doc/{doc_id}")
async def get_doc(doc_id: str):
    return _doc(doc_id).snapshot()


@router.get("/history/{doc_id}")
async def history(doc_id: str):
    return {"history": _doc(doc_id).history_list()}


@router.get("/users/{doc_id}")
async def users(doc_id: str):
    return {"users": _doc(doc_id).active_users()}
