"""Runtime configuration for Pramaan (zero hardcoded default signing secrets)."""

from __future__ import annotations

import contextlib
import os
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PRAMAAN_", extra="ignore")

    app_name: str = "Pramaan"
    database_url: str = Field(
        default_factory=lambda: f"sqlite+aiosqlite:///{(Path(__file__).resolve().parents[2] / 'pramaan.db').resolve()}"
    )
    upload_dir: Path = Field(
        default_factory=lambda: (Path(__file__).resolve().parents[2] / "uploads").resolve()
    )
    # Generated per-process when env unset; production deployments set PRAMAAN_SECRET_KEY.
    secret_key: str = Field(default_factory=lambda: secrets.token_hex(32))
    # Optional explicit key ID for PRAMAAN_SECRET_KEY (derived deterministically from public key if unset).
    signing_key_id: str = ""
    # Comma-separated retired secrets (`secret` or `kid:secret`) kept for zero-downtime verification after rotation.
    previous_secret_keys: str = ""
    offline_only: bool = True
    max_pdf_pages: int = 100
    default_tenant_id: str = "default"
    digilocker_client_id: str = ""
    digilocker_client_secret: str = ""
    digilocker_redirect_uri: str = "http://localhost:8000/api/portals/consents/digilocker-callback"
    cors_origins: tuple[str, ...] = (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    s = Settings()
    s.upload_dir.mkdir(parents=True, exist_ok=True)
    # Atomically persist ephemeral dev secret inside upload_dir so concurrent workers never read partial bytes
    if not os.environ.get("PRAMAAN_SECRET_KEY"):
        key_file = s.upload_dir / ".pramaan_secret_key"
        tmp_file = s.upload_dir / f".pramaan_secret_key.{os.getpid()}.{secrets.token_hex(6)}.tmp"
        try:
            fd = os.open(str(tmp_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                os.write(fd, s.secret_key.encode("ascii"))
                os.fsync(fd)
            finally:
                os.close(fd)
            try:
                os.link(str(tmp_file), str(key_file))
            except FileExistsError:
                stored = key_file.read_text(encoding="ascii").strip()
                if len(stored) >= 32:
                    s.secret_key = stored
        finally:
            with contextlib.suppress(OSError):
                tmp_file.unlink(missing_ok=True)
        with contextlib.suppress(OSError):
            key_file.chmod(0o600)
    return s
