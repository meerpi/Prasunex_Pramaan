"""FastAPI Application Factory for Pramaan Institutional Academic Ledger & Compliance Platform."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError

from pramaan.api.deps import SESSION_COOKIE_NAME, is_trusted_origin
from pramaan.api.routes import (
    auth,
    canons,
    documents,
    gate,
    passport,
    portals,
    reconcile,
    submissions,
)
from pramaan.engine.nli import nli_model_status
from pramaan.engine.retriever import embedder_status
from pramaan.ledger import load_signing_key_ring
from pramaan.settings import get_settings
from pramaan.store import configure_database
from pramaan.store.repos import init_db


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    engine = configure_database()
    if engine.dialect.name == "postgresql":
        for attempt in range(1, 6):
            try:
                await init_db(engine)
                break
            except (OperationalError, OSError):
                if attempt == 5:
                    raise
                await asyncio.sleep(0.5 * attempt)
    else:
        await init_db(engine)
    yield


def create_app() -> FastAPI:
    cfg = get_settings()
    app = FastAPI(title="Pramaan API", version="0.1.0", lifespan=_lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    _CSP_POLICY = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )

    _MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
    _ALLOWED_FETCH_SITES = frozenset({"same-origin", "same-site", "none"})

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):
        if (
            request.method in _MUTATING_METHODS
            and SESSION_COOKIE_NAME in request.cookies
            and not (request.headers.get("authorization") or "").lower().startswith("bearer ")
        ):
            fetch_site = (request.headers.get("sec-fetch-site") or "").strip().lower()
            if fetch_site and fetch_site not in _ALLOWED_FETCH_SITES:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Cross-site state-changing request rejected (CSRF protection)"},
                )
            origin = (request.headers.get("origin") or "").strip()
            if origin and not is_trusted_origin(origin, request=request, cors_origins=cfg.cors_origins):
                return JSONResponse(
                    status_code=403,
                    content={"detail": f"Untrusted Origin {origin!r} rejected (CSRF protection)"},
                )
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
        response.headers.setdefault("Content-Security-Policy", _CSP_POLICY)
        return response

    @app.get("/api/health")
    async def health():
        return {
            "status": "ok",
            "app": cfg.app_name,
            "offline_only": cfg.offline_only,
            "digilocker_configured": bool(cfg.digilocker_client_id.strip()),
            "models": {
                "nli": nli_model_status(),
                "embedder": embedder_status(),
            },
        }

    @app.get("/.well-known/jwks.json", tags=["trust"])
    @app.get("/api/.well-known/jwks.json", include_in_schema=False)
    async def public_jwks():
        """RFC 7517 / RFC 8037 institutional public verification key set (Ed25519 + ECDSA P-256)."""
        jwks = (await asyncio.to_thread(load_signing_key_ring)).to_jwks()
        return JSONResponse(
            content=jwks,
            headers={"Cache-Control": "public, max-age=300"},
        )

    app.include_router(auth.router, prefix="/api")
    app.include_router(portals.router, prefix="/api")
    app.include_router(passport.router, prefix="/api")
    app.include_router(submissions.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(reconcile.router, prefix="/api")
    app.include_router(canons.router, prefix="/api")
    app.include_router(gate.router, prefix="/api")

    dist_dir = Path(__file__).resolve().parents[4] / "frontend" / "dist"
    if dist_dir.is_dir():
        assets_dir = dist_dir / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

        @app.get("/", include_in_schema=False)
        async def spa_root():
            return FileResponse(str(dist_dir / "index.html"))

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str):
            if full_path.startswith("api/") or full_path == "api":
                raise HTTPException(status_code=404, detail="API endpoint not found")
            target = (dist_dir / full_path).resolve()
            if full_path and target.is_relative_to(dist_dir.resolve()) and target.is_file():
                return FileResponse(str(target))
            return FileResponse(str(dist_dir / "index.html"))

    return app


app = create_app()
