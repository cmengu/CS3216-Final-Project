"""Authentication and administrator-only approved-account management."""

import time
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .accounts import public_user
from .auth import (
    COOKIE_NAME,
    TOKEN_TTL_SECONDS,
    create_session_token,
    extract_request_claims,
    session_cookie_options,
)

router = APIRouter()


class SignIn(BaseModel):
    username: str | None = Field(default=None, max_length=80)
    email: str | None = Field(default=None, max_length=80)
    password: str = Field(max_length=128)


class Setup(SignIn):
    token: str = Field(min_length=32, max_length=256)


class CreateAccount(BaseModel):
    username: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=15, max_length=128)
    role: Literal["admin", "member"] = "member"


class UpdateAccount(BaseModel):
    active: bool | None = None
    role: Literal["admin", "member"] | None = None
    password: str | None = Field(default=None, min_length=15, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=15, max_length=128)


def require_user(request, admin=False):
    claims = extract_request_claims(request)
    if claims is None:
        raise HTTPException(401, "Sign in to continue.")
    if admin and claims["role"] != "admin":
        raise HTTPException(403, "Only an administrator can manage approved accounts.")
    return claims


def user_response(claims):
    return {
        "email": claims["username"],
        "id": claims.get("user_id", claims.get("id")),
        "role": claims["role"],
    }


def login_response(request, user):
    sid, expires = request.app.state.accounts.create_session(user, TOKEN_TTL_SECONDS)
    token = create_session_token(user["username"], sid, expires_at=expires)
    response = JSONResponse({"ok": True, "session_id": token, "user": user_response(user)})
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        path="/",
        max_age=TOKEN_TTL_SECONDS,
        **session_cookie_options(request),
    )
    return response


def clear_cookie(request, response):
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, **session_cookie_options(request))
    return response


@router.get("/auth/setup-status")
def setup_status(request: Request):
    return {"setup_required": not request.app.state.accounts.has_accounts()}


@router.post("/auth/setup")
def setup_admin(body: Setup, request: Request):
    ip = request.client.host if request.client else "unknown"
    request.app.state.limits.take("admin-setup", ip, maximum=5, seconds=3600)
    try:
        user = request.app.state.accounts.setup(
            body.token, body.username or body.email, body.password
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return login_response(request, user)


@router.post("/auth/sign-in")
def sign_in(body: SignIn, request: Request):
    ip = request.client.host if request.client else "unknown"
    username = (body.username or body.email or "").strip().lower()
    request.app.state.limits.take("login-account-ip", f"{username}:{ip}", maximum=8, seconds=600)
    user = request.app.state.accounts.authenticate(username, body.password)
    if user is None:
        raise HTTPException(401, "Invalid username or password.")
    return login_response(request, user)


@router.get("/auth/me")
def me(request: Request):
    claims = require_user(request)
    token = create_session_token(claims["username"], claims["session_id"], expires_at=claims["exp"])
    return {"ok": True, "authenticated": True, "session_id": token, "user": user_response(claims)}


@router.post("/auth/sign-out")
def sign_out(request: Request):
    claims = extract_request_claims(request)
    if claims:
        request.app.state.accounts.end_session(claims["session_id"])
        request.app.state.store.revoke_session(
            claims["session_id"], max(claims["exp"], int(time.time()) + TOKEN_TTL_SECONDS)
        )
    return clear_cookie(request, JSONResponse({"ok": True}))


@router.put("/auth/password")
def change_password(body: PasswordChange, request: Request):
    claims = require_user(request)
    request.app.state.limits.take("change-password", claims["user_id"], maximum=5, seconds=600)
    try:
        request.app.state.accounts.change_password(
            claims["user_id"], body.current_password, body.new_password
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return clear_cookie(request, JSONResponse({"ok": True}))


@router.get("/admin/accounts")
def list_accounts(request: Request):
    require_user(request, admin=True)
    return request.app.state.accounts.list_users()


@router.post("/admin/accounts", status_code=201)
def create_account(body: CreateAccount, request: Request):
    claims = require_user(request, admin=True)
    request.app.state.limits.take("manage-accounts", claims["user_id"], maximum=30, seconds=3600)
    try:
        return public_user(
            request.app.state.accounts.create_user(
                body.username,
                body.password,
                body.role,
                actor=claims["user_id"],
                actor_session=claims["session_id"],
            )
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.patch("/admin/accounts/{user_id}")
def update_account(user_id: str, body: UpdateAccount, request: Request):
    claims = require_user(request, admin=True)
    request.app.state.limits.take("manage-accounts", claims["user_id"], maximum=30, seconds=3600)
    if not body.model_fields_set:
        raise HTTPException(422, "Choose an account change.")
    try:
        return request.app.state.accounts.update_user(
            user_id,
            actor=claims["user_id"],
            actor_session=claims["session_id"],
            **body.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
