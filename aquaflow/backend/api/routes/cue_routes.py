"""
cue_routes.py — AquaFlow Recovery, AQ-X-004

Cue stack management and scene recall API. Multiple named cue stacks are held by the
manager; each supports adding cues (scenes + fade times), GO/GO-TO/BACK/RELEASE, and
sampling the live crossfaded output.

  POST /api/cues/stacks                     → create a cue stack
  GET  /api/cues/stacks                     → list cue stacks
  GET  /api/cues/stacks/{id}                → stack status
  POST /api/cues/stacks/{id}/cues           → add a cue {name, values, number?, fade_in?}
  POST /api/cues/stacks/{id}/go             → advance to the next cue
  POST /api/cues/stacks/{id}/go-to          → jump to a cue number
  POST /api/cues/stacks/{id}/back           → step back one cue
  POST /api/cues/stacks/{id}/release        → fade out + release
  GET  /api/cues/stacks/{id}/output         → current crossfaded output
"""
import time

from fastapi import APIRouter, HTTPException

from services.cue_engine import get_cue_manager, make_scene

router = APIRouter()


def _stack(stack_id: str):
    s = get_cue_manager().get(stack_id)
    if s is None:
        raise HTTPException(404, f"cue stack '{stack_id}' not found")
    return s


@router.post("/stacks")
async def create_stack(payload: dict):
    name = payload.get("name", "Cue Stack")
    stack = get_cue_manager().create(name, id=payload.get("id"))
    return stack.status()


@router.get("/stacks")
async def list_stacks():
    mgr = get_cue_manager()
    return {"stacks": [mgr.get(sid).status() for sid in mgr.list_stacks()]}


@router.get("/stacks/{stack_id}")
async def stack_status(stack_id: str):
    return _stack(stack_id).status()


@router.delete("/stacks/{stack_id}")
async def delete_stack(stack_id: str):
    return {"deleted": get_cue_manager().delete(stack_id)}


@router.post("/stacks/{stack_id}/cues")
async def add_cue(stack_id: str, payload: dict):
    stack = _stack(stack_id)
    scene = make_scene(payload.get("name", "Scene"), payload.get("values", {}))
    cue = stack.add_cue(scene, number=payload.get("number"),
                        label=payload.get("label", ""),
                        fade_in=float(payload.get("fade_in", 3.0)),
                        follow=payload.get("follow"),
                        notes=payload.get("notes", ""))
    return cue.to_dict()


@router.post("/stacks/{stack_id}/go")
async def go(stack_id: str):
    cue = _stack(stack_id).go()
    return {"current_cue": cue.number if cue else None, "status": _stack(stack_id).status()}


@router.post("/stacks/{stack_id}/go-to")
async def go_to(stack_id: str, payload: dict):
    number = payload.get("number")
    if number is None:
        raise HTTPException(400, "number required")
    cue = _stack(stack_id).go_to(float(number))
    if cue is None:
        raise HTTPException(404, f"no cue numbered {number}")
    return {"current_cue": cue.number, "status": _stack(stack_id).status()}


@router.post("/stacks/{stack_id}/back")
async def back(stack_id: str):
    cue = _stack(stack_id).back()
    return {"current_cue": cue.number if cue else None, "status": _stack(stack_id).status()}


@router.post("/stacks/{stack_id}/release")
async def release(stack_id: str, payload: dict = None):
    fade = float((payload or {}).get("fade", 0.0))
    _stack(stack_id).release(fade=fade)
    return {"status": _stack(stack_id).status()}


@router.get("/stacks/{stack_id}/output")
async def output(stack_id: str):
    stack = _stack(stack_id)
    now = time.monotonic()
    return {"output": stack.output_at(now), "transitioning": stack.is_transitioning(now)}
