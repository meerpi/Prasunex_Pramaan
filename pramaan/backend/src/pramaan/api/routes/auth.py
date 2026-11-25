"""Hardened Authentication, First-Run Institution Setup & Admin Account Management Routes."""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from pramaan.api.deps import (
    SESSION_COOKIE_NAME,
    AdminUser,
    CurrentUser,
    SessionDep,
    SlidingWindowRateLimiter,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from pramaan.domain import Role
from pramaan.settings import get_settings
from pramaan.store import repos, set_tenant_context

router = APIRouter(prefix="/auth", tags=["auth"])

_SLUG_RE = re.compile(r"[^a-z0-9\-]+")
_SETUP_LOCK = asyncio.Lock()
_AUTH_RATE_MAX_ATTEMPTS = 30
_AUTH_RATE_LIMITER = SlidingWindowRateLimiter(
    window_s=60.0,
    detail="Too many authentication attempts. Please wait a minute and try again.",
)
# Valid scrypt digest layout used to equalize login timing when a username does not exist.
_DUMMY_PASSWORD_HASH = f"scrypt${'00' * 16}${'00' * 64}"


def reset_auth_rate_limiter() -> None:
    _AUTH_RATE_LIMITER.reset()


def _check_auth_rate_limit(request: Request, action: str, identity: str = "") -> None:
    client_host = (request.client.host if request.client else "unknown") or "unknown"
    norm_id = identity.strip().lower()[:80]
    checks: list[tuple[str, int]] = [(f"{action}:ip:{client_host}", _AUTH_RATE_MAX_ATTEMPTS)]
    if norm_id:
        checks.append((f"{action}:user:{norm_id}", _AUTH_RATE_MAX_ATTEMPTS))
    _AUTH_RATE_LIMITER.check_many(checks)


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    is_https = request.url.scheme == "https" or forwarded_proto == "https"
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=is_https,
        max_age=12 * 3600,
        path="/",
    )


def _normalize_tenant(raw: str | None) -> str:
    cfg = get_settings()
    if not raw or not raw.strip():
        return cfg.default_tenant_id
    slug = _SLUG_RE.sub("-", raw.strip().lower()).strip("-")[:64]
    return slug or cfg.default_tenant_id


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)
    institution_code: str = Field(default="", max_length=64)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    institution_code: str = Field(default="", max_length=64)


class SetupAdminRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    institution_code: str = Field(default="", max_length=64)


class AdminCreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    display_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    role: Role
    linked_prn: str = Field(default="", max_length=40)
    linked_faculty_id: str = Field(default="", max_length=40)


class AdminUpdateUserLinksRequest(BaseModel):
    role: Role | None = None
    linked_prn: str | None = Field(default=None, max_length=40)
    linked_faculty_id: str | None = Field(default=None, max_length=40)


class AuthUserDto(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    tenant_id: str
    linked_prn: str
    linked_faculty_id: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUserDto


def _user_dto(u) -> AuthUserDto:
    return AuthUserDto(
        id=u.id,
        username=u.username,
        display_name=u.display_name,
        role=u.role,
        tenant_id=u.tenant_id,
        linked_prn=u.linked_prn,
        linked_faculty_id=u.linked_faculty_id,
    )


@router.get("/setup-status")
async def setup_status(session: SessionDep):
    total = await repos.count_users(session)
    cfg = get_settings()
    return {
        "initialized": total > 0,
        "digilocker_configured": bool(cfg.digilocker_client_id.strip()),
    }


@router.post("/setup-admin", response_model=AuthTokenResponse, status_code=201)
async def setup_first_admin(
    req: SetupAdminRequest,
    request: Request,
    response: Response,
    session: SessionDep,
) -> AuthTokenResponse:
    """One-time institutional bootstrap: creates the first Registrar/Admin only when zero users exist."""
    async with _SETUP_LOCK:
        bind = session.get_bind()
        if bind is not None and bind.dialect.name == "postgresql":
            await session.execute(text("SELECT pg_advisory_xact_lock(hashtext('pramaan:setup_admin'))"))
        if await repos.count_users(session) > 0:
            raise HTTPException(
                status_code=409,
                detail="Institution already initialized; sign in as an administrator to manage accounts.",
            )
        uname = req.username.strip().lower()
        tid = _normalize_tenant(req.institution_code)
        await set_tenant_context(session, tid)
        pw_hash = await asyncio.to_thread(hash_password, req.password)
        try:
            user = await repos.create_user(
                session,
                username=uname,
                display_name=req.display_name.strip(),
                role=Role.ADMIN.value,
                password_hash=pw_hash,
                tenant_id=tid,
            )
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Institution already initialized; sign in as an administrator to manage accounts.",
            ) from exc
    token = await asyncio.to_thread(create_access_token, user)
    _set_session_cookie(response, request, token)
    return AuthTokenResponse(access_token=token, user=_user_dto(user))


@router.post("/login", response_model=AuthTokenResponse)
async def login(
    req: LoginRequest,
    request: Request,
    response: Response,
    session: SessionDep,
) -> AuthTokenResponse:
    uname = req.username.strip().lower()
    _check_auth_rate_limit(request, "login", uname)
    tid = _normalize_tenant(req.institution_code) if req.institution_code.strip() else None
    if tid is not None:
        await set_tenant_context(session, tid)
    matches = await repos.get_users_by_username(session, uname, tenant_id=tid)
    if len(matches) > 1:
        raise HTTPException(
            status_code=400,
            detail="Multiple institutions share this username; specify your institution_code to sign in.",
        )
    user = matches[0] if matches else None
    if not user:
        await asyncio.to_thread(verify_password, req.password, _DUMMY_PASSWORD_HASH)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not await asyncio.to_thread(verify_password, req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    await set_tenant_context(session, user.tenant_id)
    token = await asyncio.to_thread(create_access_token, user)
    _set_session_cookie(response, request, token)
    return AuthTokenResponse(access_token=token, user=_user_dto(user))


@router.post("/register", response_model=AuthTokenResponse, status_code=201)
async def register(
    req: RegisterRequest,
    request: Request,
    response: Response,
    session: SessionDep,
) -> AuthTokenResponse:
    """Self-service registration is locked to least-privilege `student` role."""
    uname = req.username.strip().lower()
    _check_auth_rate_limit(request, "register", uname)
    tid = _normalize_tenant(req.institution_code)
    if not req.institution_code.strip():
        # Attach to the active single-institution tenant if initialized with a custom slug.
        existing_tenants = await repos.list_distinct_tenants(session, limit=2)
        if len(existing_tenants) == 1:
            tid = existing_tenants[0]
    await set_tenant_context(session, tid)
    if await repos.get_users_by_username(session, uname, tenant_id=tid):
        raise HTTPException(status_code=409, detail="Username already exists")
    pw_hash = await asyncio.to_thread(hash_password, req.password)
    try:
        user = await repos.create_user(
            session,
            username=uname,
            display_name=req.display_name.strip(),
            role=Role.STUDENT.value,
            password_hash=pw_hash,
            tenant_id=tid,
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Username already exists") from exc
    token = await asyncio.to_thread(create_access_token, user)
    _set_session_cookie(response, request, token)
    return AuthTokenResponse(access_token=token, user=_user_dto(user))


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"logged_out": True}


@router.get("/session")
async def auth_session(request: Request, session: SessionDep):
    """Non-401 session probe for browser startup using HttpOnly cookie or Bearer header."""
    try:
        user = await get_current_user(
            request,
            session,
            request.headers.get("authorization"),
            request.cookies.get(SESSION_COOKIE_NAME),
        )
        return {"authenticated": True, "user": _user_dto(user).model_dump()}
    except HTTPException:
        return {"authenticated": False, "user": None}


@router.get("/me", response_model=AuthUserDto)
async def me(user: CurrentUser) -> AuthUserDto:
    return _user_dto(user)


@router.get("/users", response_model=list[AuthUserDto])
async def list_tenant_users(session: SessionDep, user: AdminUser) -> list[AuthUserDto]:
    rows = await repos.list_users(session, tenant_id=user.tenant_id)
    return [_user_dto(r) for r in rows]


@router.post("/users", response_model=AuthUserDto, status_code=201)
async def admin_create_user(
    req: AdminCreateUserRequest,
    session: SessionDep,
    admin: AdminUser,
) -> AuthUserDto:
    uname = req.username.strip().lower()
    if await repos.get_users_by_username(session, uname, tenant_id=admin.tenant_id):
        raise HTTPException(status_code=409, detail="Username already exists")
    pw_hash = await asyncio.to_thread(hash_password, req.password)
    try:
        created = await repos.create_user(
            session,
            username=uname,
            display_name=req.display_name.strip(),
            role=req.role.value,
            password_hash=pw_hash,
            linked_prn=req.linked_prn.strip(),
            linked_faculty_id=req.linked_faculty_id.strip(),
            tenant_id=admin.tenant_id,
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Username already exists") from exc
    return _user_dto(created)


@router.patch("/users/{user_id}", response_model=AuthUserDto)
async def admin_update_user_links(
    user_id: int,
    req: AdminUpdateUserLinksRequest,
    session: SessionDep,
    admin: AdminUser,
) -> AuthUserDto:
    target = await repos.get_user_by_id(session, user_id)
    if not target or target.tenant_id != admin.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    if req.role is not None:
        target.role = req.role.value
    if req.linked_prn is not None:
        target.linked_prn = req.linked_prn.strip()
    if req.linked_faculty_id is not None:
        target.linked_faculty_id = req.linked_faculty_id.strip()
    await session.commit()
    return _user_dto(target)
