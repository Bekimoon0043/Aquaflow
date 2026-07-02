"""
phase9_routes.py — AquaFlow Phase 9
Pool geometry project API routes.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

phase9_router = APIRouter(tags=["Phase9"])


@phase9_router.post("/geometry/projects")
async def save_geometry_project(body: dict):
    from services.geometry_service import get_geometry_service
    result = get_geometry_service().save_project(body)
    return result


@phase9_router.get("/geometry/projects")
async def list_geometry_projects():
    from services.geometry_service import get_geometry_service
    return {"projects": get_geometry_service().list_projects()}


@phase9_router.get("/geometry/projects/{project_id}")
async def load_geometry_project(project_id: str):
    from services.geometry_service import get_geometry_service
    project = get_geometry_service().load_project(project_id)
    if not project:
        raise HTTPException(404, f"Project {project_id} not found")
    return project


@phase9_router.delete("/geometry/projects/{project_id}")
async def delete_geometry_project(project_id: str):
    from services.geometry_service import get_geometry_service
    ok = get_geometry_service().delete_project(project_id)
    return {"ok": ok}


@phase9_router.get("/geometry/projects/{project_id}/export")
async def export_for_hydraulics(project_id: str):
    from services.geometry_service import get_geometry_service
    result = get_geometry_service().export_for_hydraulics(project_id)
    if not result:
        raise HTTPException(404, f"Project {project_id} not found")
    return result
