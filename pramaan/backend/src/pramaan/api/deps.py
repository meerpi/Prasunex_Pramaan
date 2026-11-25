"""FastAPI dependencies, database session injection, and hardened authentication helpers."""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from collections.abc import Collection, Sequence
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse

import jwt
from fastapi import Cookie, Depends, Header, HTTPException, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from pramaan.domain import Role
from pramaan.erp import set_erp_lookup_scope, set_erp_tenant
from pramaan.ledger import (
    SigningKeyRing,
    get_cached_signing_key_ring,
    load_signing_key_ring,
    reload_signing_key_ring_on_miss,
)
from pramaan.settings import Settings, get_settings
from pramaan.store import UserRow, async_session, repos, set_tenant_context

SESSION_COOKIE_NAME = "pramaan_session"
_TRUSTED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "testserver"})


class SlidingWindowRateLimiter:
    """Bounded in-memory sliding-window rate limiter shared across auth & public endpoints."""

    def __init__(
        self,
        *,
        window_s: float = 60.0,
        detail: str = "Too many requests. Please wait a minute and try again.",
    ) -> None:
        self._window_s = window_s
        self._detail = detail
        self._buckets: dict[str, deque[float]] = defaultdict(deque)

    def reset(self) -> None:
        self._buckets.clear()

    def check_many(self, checks: Sequence[tuple[str, int]]) -> None:
        now = time.monotonic()
        cutoff = now - self._window_s
        if len(self._buckets) > 1000:
            for stale_k in [k for k, dq in self._buckets.items() if not dq or dq[-1] <= cutoff]:
                self._buckets.pop(stale_k, None)
        active: list[deque[float]] = []
        for key, max_attempts in checks:
            bucket = self._buckets[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= max_attempts:
                raise HTTPException(status_code=429, detail=self._detail)
            active.append(bucket)
        for bucket in active:
            bucket.append(now)

    def check(self, key: str, *, max_attempts: int) -> None:
        self.check_many(((key, max_attempts),))


async def read_bounded_upload(
    upload: UploadFile,
    *,
    max_bytes: int,
    chunk_bytes: int = 64 * 1024,
    allowed_exts: Collection[str] | None = None,
    default_filename: str = "upload.bin",
    require_pdf_magic: bool = False,
    pdf_magic_prefix: bytes = b"%PDF",
    allow_empty: bool = False,
    size_error_detail: str | None = None,
    ext_error_status: int = 422,
    ext_error_detail: str | None = None,
    pdf_error_status: int = 422,
    pdf_error_detail: str | None = None,
    empty_error_detail: str | None = None,
) -> tuple[str, bytes]:
    """Stream an UploadFile with strict byte-size, extension, emptiness, and optional PDF header bounds."""
    filename = Path(upload.filename or default_filename).name
    ext = Path(filename).suffix.lower()
    if allowed_exts is not None and ext not in allowed_exts:
        raise HTTPException(
            status_code=ext_error_status,
            detail=ext_error_detail or f"Unsupported file type {ext!r} for {filename!r}",
        )
    buf = bytearray()
    while chunk := await upload.read(chunk_bytes):
        if len(buf) + len(chunk) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=size_error_detail or f"{filename!r} exceeds upload size limit",
            )
        buf.extend(chunk)
    raw = bytes(buf)
    if not allow_empty and not raw:
        raise HTTPException(status_code=400, detail=empty_error_detail or f"{filename!r} is empty")
    if require_pdf_magic and not raw.startswith(pdf_magic_prefix):
        raise HTTPException(
            status_code=pdf_error_status,
            detail=pdf_error_detail or f"{filename!r} does not have a valid PDF header",
        )
    return filename, raw


def is_trusted_origin(
    origin: str | None,
    *,
    request: Request | None = None,
    cors_origins: Sequence[str] | None = None,
) -> bool:
    """Validate Origin header against CORS whitelist, request Host, or loopback hosts."""
    if not origin:
        return True
    allowed = cors_origins if cors_origins is not None else get_settings().cors_origins
    if origin in allowed:
        return True
    try:
        parsed = urlparse(origin)
        if request is not None:
            req_host = (request.headers.get("host") or request.url.netloc or "").lower()
            orig_netloc = (parsed.netloc or "").lower()
            if req_host and orig_netloc == req_host:
                return True
        return (parsed.hostname or "").lower() in _TRUSTED_HOSTS
    except Exception:
        return False


def hash_password(password: str) -> str:
    """Salted scrypt password KDF (`scrypt$salt_hex$digest_hex`)."""
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash.startswith("scrypt$"):
        return False
    parts = stored_hash.split("$")
    if len(parts) != 3:
        return False
    try:
        salt = bytes.fromhex(parts[1])
        expected = bytes.fromhex(parts[2])
    except ValueError:
        return False
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return hmac.compare_digest(dk, expected)


def create_access_token(user: UserRow, settings: Settings | None = None) -> str:
    cfg = settings or get_settings()
    ring = load_signing_key_ring(settings=cfg)
    now = dt.datetime.now(dt.UTC)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "tenant_id": user.tenant_id,
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(hours=12)).timestamp()),
    }
    return jwt.encode(
        payload,
        ring.active.jwt_key,
        algorithm="HS256",
        headers={"kid": ring.active.kid},
    )


def _decode_access_token_with_ring(token: str, ring: SigningKeyRing) -> dict[str, object]:
    jwt_keys = ring.jwt_keys_by_kid()
    header_kid = ""
    try:
        header = jwt.get_unverified_header(token)
        header_kid = str(header.get("kid") or "").strip()
    except Exception:
        header_kid = ""

    candidate_keys: list[str] = []
    if header_kid and header_kid in jwt_keys:
        candidate_keys.append(jwt_keys[header_kid])
    for k_secret in jwt_keys.values():
        if k_secret not in candidate_keys:
            candidate_keys.append(k_secret)

    last_exc: Exception | None = None
    for secret in candidate_keys:
        try:
            return jwt.decode(token, secret, algorithms=["HS256"])
        except Exception as exc:
            last_exc = exc
    raise last_exc or jwt.InvalidTokenError("Token signature verification failed")


def _decode_access_token(token: str, settings: Settings | None = None) -> dict[str, object]:
    cfg = settings or get_settings()
    ring = load_signing_key_ring(settings=cfg)
    return _decode_access_token_with_ring(token, ring)


async def _decode_request_token(
    token: str,
    *,
    request: Request | None = None,
    settings: Settings | None = None,
) -> dict[str, object]:
    """Decode JWT at most once per request (cached on `request.state`) without blocking the event loop on cold keyring loads."""
    if request is not None and getattr(request.state, "_jwt_token", None) == token:
        cached_err = getattr(request.state, "_jwt_error", None)
        if cached_err is not None:
            raise cached_err
        return request.state._jwt_payload

    cfg = settings or get_settings()
    ring = get_cached_signing_key_ring(settings=cfg)
    used_cache = ring is not None
    if ring is None:
        ring = await asyncio.to_thread(load_signing_key_ring, settings=cfg)
    try:
        payload = _decode_access_token_with_ring(token, ring)
    except Exception as exc:
        reloaded = (
            await asyncio.to_thread(reload_signing_key_ring_on_miss, settings=cfg)
            if used_cache
            else None
        )
        if reloaded is not None:
            try:
                payload = _decode_access_token_with_ring(token, reloaded)
            except Exception as retry_exc:
                if request is not None:
                    request.state._jwt_token = token
                    request.state._jwt_error = retry_exc
                    request.state._jwt_payload = None
                raise
        else:
            if request is not None:
                request.state._jwt_token = token
                request.state._jwt_error = exc
                request.state._jwt_payload = None
            raise
    if request is not None:
        request.state._jwt_token = token
        request.state._jwt_error = None
        request.state._jwt_payload = payload
    return payload


def _extract_raw_token(authorization: str | None, session_cookie: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        tok = authorization.split(" ", 1)[1].strip()
        if tok:
            return tok
    if session_cookie and session_cookie.strip():
        return session_cookie.strip()
    return None


async def _extract_tenant_from_auth(
    request: Request | None,
    authorization: str | None,
    session_cookie: str | None = None,
) -> str:
    cfg = get_settings()
    token = _extract_raw_token(authorization, session_cookie)
    if token:
        try:
            payload = await _decode_request_token(token, request=request, settings=cfg)
            tid = str(payload.get("tenant_id") or "").strip()
            if tid:
                return tid
        except Exception:
            pass
    return cfg.default_tenant_id


def _erp_scope_for_user(user: UserRow) -> str:
    if user.role in (Role.TEACHER.value, Role.ADMIN.value):
        return "full"
    if user.role == Role.STUDENT.value:
        prn = (user.linked_prn or "").strip()
        return f"prn:{prn}" if prn else "none"
    return "none"


async def get_db_session(
    request: Request,
    authorization: str | None = Header(default=None),
    pramaan_session: str | None = Cookie(default=None),
):
    tid = await _extract_tenant_from_auth(request, authorization, pramaan_session)
    set_erp_tenant(tid)
    set_erp_lookup_scope("none")
    async with async_session(tenant_id=tid) as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


async def get_current_user(
    request: Request,
    session: SessionDep,
    authorization: str | None = Header(default=None),
    pramaan_session: str | None = Cookie(default=None),
) -> UserRow:
    token = _extract_raw_token(authorization, pramaan_session)
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")
    cfg = get_settings()
    try:
        payload = await _decode_request_token(token, request=request, settings=cfg)
        uid = int(str(payload["sub"]))
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc
    user = await repos.get_user_by_id(session, uid)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    await set_tenant_context(session, user.tenant_id)
    set_erp_tenant(user.tenant_id)
    set_erp_lookup_scope(_erp_scope_for_user(user))
    return user


CurrentUser = Annotated[UserRow, Depends(get_current_user)]


def require_roles(*roles: Role):
    allowed = {r.value for r in roles}

    async def _guard(user: CurrentUser) -> UserRow:
        if user.role not in allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Role {user.role!r} lacks permission; requires {sorted(allowed)}",
            )
        return user

    return _guard


AdminUser = Annotated[UserRow, Depends(require_roles(Role.ADMIN))]
TeacherOrAdminUser = Annotated[UserRow, Depends(require_roles(Role.TEACHER, Role.ADMIN))]
ParentOrAdminUser = Annotated[UserRow, Depends(require_roles(Role.PARENT, Role.ADMIN))]
RecruiterOrAdminUser = Annotated[UserRow, Depends(require_roles(Role.RECRUITER, Role.ADMIN))]
AuthorUser = Annotated[UserRow, Depends(require_roles(Role.STUDENT, Role.TEACHER, Role.ADMIN))]
RevocationsViewerUser = Annotated[UserRow, Depends(require_roles(Role.ADMIN, Role.TEACHER, Role.RECRUITER))]
