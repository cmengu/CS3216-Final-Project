"""Authentication and administrator-only approved-account management."""

import time
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from . import security_mail
from .auth import (
    COOKIE_NAME,
    TOKEN_TTL_SECONDS,
    create_session_token,
    extract_request_claims,
    session_cookie_options,
)
from .mfa import masked_email

router = APIRouter()


class SignIn(BaseModel):
    username: str | None = Field(default=None, max_length=254)
    email: str | None = Field(default=None, max_length=254)
    password: str = Field(max_length=128)


class CompleteSetup(BaseModel):
    setup_grant: str = Field(min_length=32, max_length=128)
    username: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=15, max_length=128)


class CreateAccount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)


class ClaimInvitation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=32, max_length=128)


class EnrollmentComplete(CompleteSetup):
    model_config = ConfigDict(extra="forbid")


class UpdateAccount(BaseModel):
    active: bool | None = None
    role: Literal["admin", "member"] | None = None
    password: str | None = Field(default=None, min_length=15, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=15, max_length=128)


class CompletePasswordReset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reset_grant: str = Field(min_length=32, max_length=128)
    new_password: str = Field(min_length=15, max_length=128)


class VerifyFactor(BaseModel):
    challenge_id: str = Field(min_length=32, max_length=128)
    code: str = Field(min_length=1, max_length=128)


class ResendFactor(BaseModel):
    challenge_id: str = Field(min_length=32, max_length=128)


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


def login_response(request, user, *, mfa_verified=False, recovery_codes=None):
    sid, expires = request.app.state.accounts.create_session(
        user, TOKEN_TTL_SECONDS, mfa_verified=mfa_verified
    )
    token = create_session_token(user["username"], sid, expires_at=expires)
    response = JSONResponse(
        {
            "ok": True,
            "session_id": token,
            "user": user_response(user),
            **({"recovery_codes": recovery_codes} if recovery_codes else {}),
        }
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        path="/",
        max_age=TOKEN_TTL_SECONDS,
        **session_cookie_options(request),
    )
    return response


def begin_sign_in(request, user):
    if request.app.state.accounts.mfa.needs_verification(user):
        return clear_cookie(request, JSONResponse(request.app.state.accounts.mfa.begin(user)))
    return login_response(request, user)


def clear_cookie(request, response):
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, **session_cookie_options(request))
    return response


@router.get("/auth/setup-status")
def setup_status(request: Request):
    needed = not request.app.state.accounts.has_accounts()
    try:
        destination = masked_email(request.app.state.accounts.mfa.admin_email()) if needed else None
    except HTTPException:
        destination = None
    return {
        "setup_required": needed,
        "setup_destination": destination,
        "email_delivery_configured": security_mail.configured(),
    }


@router.post("/auth/setup")
def retired_setup():
    raise HTTPException(410, "Start administrator setup by verifying the configured email address.")


@router.post("/auth/setup/start")
def start_administrator_setup(request: Request):
    return clear_cookie(
        request, JSONResponse(request.app.state.accounts.administrator_setup.start())
    )


@router.post("/auth/setup/resend")
def resend_administrator_setup(body: ResendFactor, request: Request):
    return request.app.state.accounts.administrator_setup.resend(body.challenge_id)


@router.post("/auth/setup/verify")
def verify_administrator_setup(body: VerifyFactor, request: Request):
    return request.app.state.accounts.administrator_setup.verify(
        body.challenge_id, body.code.strip()
    )


@router.post("/auth/setup/complete")
def complete_administrator_setup(body: CompleteSetup, request: Request):
    try:
        user = request.app.state.accounts.administrator_setup.complete(
            body.setup_grant, body.username, body.password
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return login_response(request, user, mfa_verified=True)


@router.post("/auth/sign-in")
def sign_in(body: SignIn, request: Request):
    ip = request.client.host if request.client else "unknown"
    username = request.app.state.accounts.resolve_login_name(body.username or body.email or "")
    request.app.state.limits.take("login-account-ip", f"{username}:{ip}", maximum=8, seconds=600)
    user = request.app.state.accounts.authenticate(username, body.password)
    if user is None:
        raise HTTPException(401, "Invalid username/email or password.")
    return begin_sign_in(request, user)


@router.post("/auth/mfa/verify")
def verify_second_factor(body: VerifyFactor, request: Request):
    user_id = request.app.state.accounts.mfa.challenge_user(body.challenge_id)
    if user_id:
        request.app.state.limits.take("mfa-account", user_id, maximum=15, seconds=600)
    user, codes = request.app.state.accounts.mfa.verify(body.challenge_id, body.code.strip())
    return login_response(request, user, mfa_verified=True, recovery_codes=codes)


@router.get("/auth/mfa/status")
def factor_status(request: Request):
    claims = require_user(request)
    accounts = request.app.state.accounts
    with accounts.connect() as db:
        factor = accounts.mfa.factor(db, claims["user_id"])
        return {
            "enabled": factor is not None and bool(factor["verified"]),
            "email": factor["email"] if factor else None,
        }


@router.post("/auth/mfa/resend")
def resend_second_factor(body: ResendFactor, request: Request):
    return request.app.state.accounts.mfa.resend(body.challenge_id)


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
        enrollment = request.app.state.accounts.enrollment
        approval = enrollment.approve(
            body.email, actor=claims["user_id"], actor_session=claims["session_id"]
        )
        delivery = enrollment.invitations.send(
            approval["id"], actor=claims["user_id"], actor_session=claims["session_id"]
        )
        return {**approval, **delivery}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/admin/account-approvals")
def list_approvals(request: Request):
    require_user(request, admin=True)
    return request.app.state.accounts.enrollment.list_approvals()


@router.delete("/admin/account-approvals/{approval_id}")
def revoke_approval(approval_id: str, request: Request):
    claims = require_user(request, admin=True)
    return request.app.state.accounts.enrollment.revoke(
        approval_id, actor=claims["user_id"], actor_session=claims["session_id"]
    )


@router.post("/admin/account-approvals/{approval_id}/send")
def send_invitation(approval_id: str, request: Request):
    claims = require_user(request, admin=True)
    request.app.state.limits.take("manage-accounts", claims["user_id"], maximum=30, seconds=3600)
    return request.app.state.accounts.enrollment.invitations.send(
        approval_id, actor=claims["user_id"], actor_session=claims["session_id"]
    )


@router.post("/auth/enroll/invitation")
def claim_invitation(body: ClaimInvitation, request: Request):
    return request.app.state.accounts.enrollment.invitations.claim(body.token)


@router.post("/auth/enroll/start")
def start_enrollment(body: CreateAccount, request: Request):
    try:
        return clear_cookie(
            request, JSONResponse(request.app.state.accounts.enrollment.start(body.email))
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/auth/enroll/resend")
def resend_enrollment(body: ResendFactor, request: Request):
    return request.app.state.accounts.enrollment.resend(body.challenge_id)


@router.post("/auth/enroll/verify")
def verify_enrollment(body: VerifyFactor, request: Request):
    return request.app.state.accounts.enrollment.verify(body.challenge_id, body.code.strip())


@router.post("/auth/enroll/complete")
def complete_enrollment(body: EnrollmentComplete, request: Request):
    try:
        user = request.app.state.accounts.enrollment.complete(
            body.setup_grant, body.username, body.password
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return login_response(request, user, mfa_verified=True)


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


@router.post("/auth/password-reset/start")
def start_password_reset(body: CreateAccount, request: Request):
    try:
        return request.app.state.accounts.password_reset.start(body.email)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/auth/password-reset/resend")
def resend_password_reset(body: ResendFactor, request: Request):
    return request.app.state.accounts.password_reset.resend(body.challenge_id)


@router.post("/auth/password-reset/verify")
def verify_password_reset(body: VerifyFactor, request: Request):
    return request.app.state.accounts.password_reset.verify(body.challenge_id, body.code.strip())


@router.post("/auth/password-reset/complete")
def complete_password_reset(body: CompletePasswordReset, request: Request):
    try:
        result = request.app.state.accounts.password_reset.complete(
            body.reset_grant, body.new_password
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return clear_cookie(request, JSONResponse(result))
