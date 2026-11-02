"""Session-owned invoice folders. The comparison policy is fixed when a project is created."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .storage import request_session_id

router = APIRouter(prefix="/projects")


class NewProject(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    comparison_mode: Literal["master_list", "totals_only"]


def require_project(store, project_id, session_id):
    project = store.get_project(project_id, session_id=session_id)
    if project is None:
        raise HTTPException(404, "Invoice group not found")
    return project


def describe(store, project, sid):
    return {
        **project,
        "has_master_list": store.latest_master_list(session_id=sid, project_id=project["id"])
        is not None,
        **store.project_totals(project["id"], session_id=sid),
    }


@router.get("")
def list_projects(request: Request):
    store, sid = request.app.state.store, request_session_id(request)
    return [describe(store, p, sid) for p in store.list_projects(session_id=sid)]


@router.post("", status_code=201)
def create_project(payload: NewProject, request: Request):
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Enter a group name")
    store, sid = request.app.state.store, request_session_id(request)
    project = store.create_project(name, payload.comparison_mode, session_id=sid)
    return describe(store, project, sid)


@router.get("/{project_id}")
def get_project(project_id: str, request: Request):
    store, sid = request.app.state.store, request_session_id(request)
    return describe(store, require_project(store, project_id, sid), sid)
