"""Async SQLAlchemy (SQLite WAL + PostgreSQL asyncpg with Row-Level Security) database engine."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from pramaan.settings import get_settings

_ENGINE: AsyncEngine | None = None
_SESSION_FACTORY: async_sessionmaker[AsyncSession] | None = None
_ACTIVE_DB_URL: str | None = None


def configure_database(database_url: str | None = None) -> AsyncEngine:
    global _ENGINE, _SESSION_FACTORY, _ACTIVE_DB_URL
    url = database_url or get_settings().database_url
    if _ENGINE is not None and url == _ACTIVE_DB_URL:
        return _ENGINE

    if url.startswith("postgresql"):
        engine = create_async_engine(
            url,
            echo=False,
            future=True,
            pool_size=10,
            max_overflow=10,
            pool_pre_ping=True,
            pool_recycle=1800,
        )
    else:
        engine = create_async_engine(url, echo=False, future=True)

    if url.startswith("sqlite"):

        @event.listens_for(engine.sync_engine, "connect")
        def _set_sqlite_pragmas(dbapi_conn, _conn_record) -> None:
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL;")
            cur.execute("PRAGMA busy_timeout=5000;")
            cur.execute("PRAGMA foreign_keys=ON;")
            cur.close()

    _ENGINE = engine
    _ACTIVE_DB_URL = url
    _SESSION_FACTORY = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return engine


async def set_tenant_context(session: AsyncSession, tenant_id: str | None = None) -> str:
    """Bind PostgreSQL Row-Level Security session variable `app.current_tenant`."""
    tid = (tenant_id or get_settings().default_tenant_id).strip() or "default"
    bind = session.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        await session.execute(
            text("SELECT set_config('app.current_tenant', :tid, true)"),
            {"tid": tid},
        )
    return tid


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    if _SESSION_FACTORY is None:
        configure_database()
    assert _SESSION_FACTORY is not None
    return _SESSION_FACTORY


@asynccontextmanager
async def async_session(tenant_id: str | None = None) -> AsyncIterator[AsyncSession]:
    factory = get_session_factory()
    async with factory() as session:
        if tenant_id is not None:
            await set_tenant_context(session, tenant_id)
        yield session
