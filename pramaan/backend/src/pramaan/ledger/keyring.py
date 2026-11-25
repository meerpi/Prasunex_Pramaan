"""Versioned Cryptographic Signing Key Ring & RFC 7517 / RFC 8037 JWKS Publication.

Supports zero-downtime key rotation across:
- Ed25519 (EdDSA / OKP JWK) for offline Merkle QR passports and RFC 9901 SD-JWTs
- ECDSA P-256 (ES256 / EC JWK) for signed governance publication seals
- HMAC-SHA256 (HS256) for session JWTs (never published in JWKS)

Active signing keys may come from either the persisted `signing_keys` registry (created via
admin key rotation) or `PRAMAAN_SECRET_KEY`. Retired keys from `signing_keys`,
`PRAMAAN_SECRET_KEY` (post-rotation), and `PRAMAAN_PREVIOUS_SECRET_KEYS` remain trusted for
verification so previously issued student passes and seals never break on rotation.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import re
import secrets
import threading
import time
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from pramaan.erp import ERPDataPort, StoredSigningKey, default_erp_oracle
from pramaan.ledger.c2pa_outbound import derive_ephemeral_ec_key
from pramaan.settings import Settings, get_settings

_SAFE_KID_RE = re.compile(r"[^A-Za-z0-9._-]+")
_RING_CACHE_TTL_S = 5.0
_RING_FORCE_RELOAD_COOLDOWN_S = 0.5
_RING_CACHE_LOCK = threading.Lock()
_RING_CACHE: dict[tuple[str, str, str, str, int], tuple[float, SigningKeyRing]] = {}
_LAST_FORCE_RELOAD: dict[tuple[str, str, str, str, int], float] = {}


def b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def b64u_decode(token: str) -> bytes:
    pad = "=" * ((4 - (len(token) % 4)) % 4)
    return base64.urlsafe_b64decode(token + pad)


def reset_signing_key_ring_cache() -> None:
    """Clear the in-process TTL cache for signing key rings (called on rotation or test DB swaps)."""
    with _RING_CACHE_LOCK:
        _RING_CACHE.clear()
        _LAST_FORCE_RELOAD.clear()


def _ring_cache_key(cfg: Settings, store: ERPDataPort) -> tuple[str, str, str, str, int]:
    return (
        cfg.secret_key,
        cfg.signing_key_id,
        cfg.previous_secret_keys,
        store.database_url,
        getattr(store, "_instance_id", id(store)),
    )


def _derive_ed25519(secret_material: str) -> Ed25519PrivateKey:
    seed = hashlib.sha256(f"ed25519:{secret_material}".encode()).digest()
    return Ed25519PrivateKey.from_private_bytes(seed)


def _derive_ec_p256(secret_material: str) -> ec.EllipticCurvePrivateKey:
    seed = hashlib.sha256(f"ecdsa:{secret_material}".encode()).digest()
    return derive_ephemeral_ec_key(seed)


def _derive_jwt_key(secret_material: str) -> str:
    return hashlib.sha256(f"jwt:{secret_material}".encode()).hexdigest()


def derive_deterministic_kid(secret_material: str) -> str:
    """Deterministic `kid` derived from the Ed25519 public key thumbprint so restarts preserve key IDs."""
    pub_raw = _derive_ed25519(secret_material).public_key().public_bytes_raw()
    return f"pramaan-k-{hashlib.sha256(pub_raw).hexdigest()[:10]}"


def _sanitize_kid(raw: str) -> str:
    cleaned = _SAFE_KID_RE.sub("-", raw.strip()).strip("-")[:64]
    return cleaned


@dataclass(frozen=True, slots=True)
class KeyVersion:
    kid: str
    status: str  # "active" | "retired"
    source: str  # "database" | "env_primary" | "env_previous"
    created_at: str
    retired_at: str
    jwt_key: str
    ed25519_private: Ed25519PrivateKey
    ec_p256_private: ec.EllipticCurvePrivateKey

    @property
    def ec_kid(self) -> str:
        return f"{self.kid}-es256"

    @property
    def ed25519_public(self) -> Ed25519PublicKey:
        return self.ed25519_private.public_key()

    @property
    def ec_p256_public(self) -> ec.EllipticCurvePublicKey:
        return self.ec_p256_private.public_key()

    def ed25519_jwk(self) -> dict[str, str]:
        return {
            "kty": "OKP",
            "crv": "Ed25519",
            "alg": "EdDSA",
            "use": "sig",
            "kid": self.kid,
            "x": b64u_encode(self.ed25519_public.public_bytes_raw()),
            "status": self.status,
        }

    def ec_p256_jwk(self) -> dict[str, str]:
        nums = self.ec_p256_public.public_numbers()
        return {
            "kty": "EC",
            "crv": "P-256",
            "alg": "ES256",
            "use": "sig",
            "kid": self.ec_kid,
            "x": b64u_encode(nums.x.to_bytes(32, "big")),
            "y": b64u_encode(nums.y.to_bytes(32, "big")),
            "status": self.status,
        }

    def public_metadata(self) -> dict[str, str]:
        ed_raw = self.ed25519_public.public_bytes_raw()
        return {
            "kid": self.kid,
            "ec_kid": self.ec_kid,
            "status": self.status,
            "source": self.source,
            "created_at": self.created_at,
            "retired_at": self.retired_at,
            "ed25519_thumbprint": hashlib.sha256(ed_raw).hexdigest()[:16],
        }


def _build_key_version(
    *,
    kid: str,
    secret_material: str,
    status: str,
    source: str,
    created_at: str = "",
    retired_at: str = "",
) -> KeyVersion:
    return KeyVersion(
        kid=kid,
        status=status,
        source=source,
        created_at=created_at,
        retired_at=retired_at,
        jwt_key=_derive_jwt_key(secret_material),
        ed25519_private=_derive_ed25519(secret_material),
        ec_p256_private=_derive_ec_p256(secret_material),
    )


def _parse_previous_env_keys(raw: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for chunk in (raw or "").split(","):
        item = chunk.strip()
        if not item:
            continue
        if ":" in item:
            maybe_kid, maybe_secret = item.split(":", 1)
            clean_kid = _sanitize_kid(maybe_kid)
            clean_secret = maybe_secret.strip()
            if clean_kid and len(clean_secret) >= 8:
                out.append((clean_kid, clean_secret))
                continue
        if len(item) >= 8:
            out.append((derive_deterministic_kid(item), item))
    return out


class SigningKeyRing:
    """Resolved active + retired key versions for signing, verification, and JWKS publishing."""

    def __init__(self, keys: list[KeyVersion]) -> None:
        if not keys:
            raise ValueError("SigningKeyRing requires at least one key version")
        active_list = [k for k in keys if k.status == "active"]
        self.active: KeyVersion = active_list[0] if active_list else keys[0]
        self.all_keys: tuple[KeyVersion, ...] = tuple(keys)

    def ed25519_public_keys(self) -> dict[str, Ed25519PublicKey]:
        return {k.kid: k.ed25519_public for k in self.all_keys}

    def ec_p256_public_keys(self) -> dict[str, ec.EllipticCurvePublicKey]:
        out: dict[str, ec.EllipticCurvePublicKey] = {}
        for k in self.all_keys:
            out[k.ec_kid] = k.ec_p256_public
            out[k.kid] = k.ec_p256_public
        return out

    def jwt_keys_by_kid(self) -> dict[str, str]:
        return {k.kid: k.jwt_key for k in self.all_keys}

    def to_jwks(self) -> dict[str, list[dict[str, str]]]:
        """RFC 7517 JSON Web Key Set containing ONLY public asymmetric verification keys."""
        jwk_list: list[dict[str, str]] = []
        for k in self.all_keys:
            jwk_list.append(k.ed25519_jwk())
            jwk_list.append(k.ec_p256_jwk())
        return {"keys": jwk_list}

    def public_summary(self) -> dict[str, object]:
        return {
            "active_kid": self.active.kid,
            "jwks_url": "/.well-known/jwks.json",
            "keys": [k.public_metadata() for k in self.all_keys],
        }


def get_cached_signing_key_ring(
    *,
    settings: Settings | None = None,
    erp: ERPDataPort | None = None,
) -> SigningKeyRing | None:
    """Return a warm cached `SigningKeyRing` without touching the database, or None on miss."""
    cfg = settings or get_settings()
    store = erp or default_erp_oracle()
    cache_key = _ring_cache_key(cfg, store)
    now = time.monotonic()
    with _RING_CACHE_LOCK:
        hit = _RING_CACHE.get(cache_key)
        if hit is not None and hit[0] > now:
            return hit[1]
    return None


def load_signing_key_ring(
    *,
    settings: Settings | None = None,
    erp: ERPDataPort | None = None,
    force_reload: bool = False,
) -> SigningKeyRing:
    cfg = settings or get_settings()
    store = erp or default_erp_oracle()
    cache_key = _ring_cache_key(cfg, store)
    now = time.monotonic()
    if not force_reload:
        with _RING_CACHE_LOCK:
            hit = _RING_CACHE.get(cache_key)
            if hit is not None and hit[0] > now:
                return hit[1]

    persisted = store.list_signing_keys()

    keys: list[KeyVersion] = []
    seen_kids: set[str] = set()
    has_db_active = any(row.status == "active" for row in persisted)

    for row in persisted:
        if row.kid in seen_kids:
            continue
        seen_kids.add(row.kid)
        keys.append(
            _build_key_version(
                kid=row.kid,
                secret_material=row.secret_material,
                status="active" if row.status == "active" else "retired",
                source="database",
                created_at=row.created_at,
                retired_at=row.retired_at,
            )
        )

    env_kid = _sanitize_kid(cfg.signing_key_id) or derive_deterministic_kid(cfg.secret_key)
    if env_kid not in seen_kids:
        seen_kids.add(env_kid)
        keys.append(
            _build_key_version(
                kid=env_kid,
                secret_material=cfg.secret_key,
                status="retired" if has_db_active else "active",
                source="env_primary",
                created_at="",
                retired_at="",
            )
        )

    for prev_kid, prev_secret in _parse_previous_env_keys(cfg.previous_secret_keys):
        if prev_kid in seen_kids:
            continue
        seen_kids.add(prev_kid)
        keys.append(
            _build_key_version(
                kid=prev_kid,
                secret_material=prev_secret,
                status="retired",
                source="env_previous",
                created_at="",
                retired_at="",
            )
        )

    # Order active key first, followed by retired keys in newest-first order
    active_keys = [k for k in keys if k.status == "active"]
    retired_keys = sorted(
        (k for k in keys if k.status != "active"),
        key=lambda k: k.created_at,
        reverse=True,
    )
    ring = SigningKeyRing(active_keys + retired_keys)
    with _RING_CACHE_LOCK:
        if len(_RING_CACHE) >= 32:
            _RING_CACHE.clear()
        _RING_CACHE[cache_key] = (time.monotonic() + _RING_CACHE_TTL_S, ring)
    return ring


def reload_signing_key_ring_on_miss(
    *,
    settings: Settings | None = None,
    erp: ERPDataPort | None = None,
    cooldown_s: float = _RING_FORCE_RELOAD_COOLDOWN_S,
) -> SigningKeyRing | None:
    """Force-reload the signing key ring after an unknown-kid failure, bounded by a short cooldown."""
    cfg = settings or get_settings()
    store = erp or default_erp_oracle()
    cache_key = _ring_cache_key(cfg, store)
    now = time.monotonic()
    with _RING_CACHE_LOCK:
        last = _LAST_FORCE_RELOAD.get(cache_key, 0.0)
        if now - last < cooldown_s:
            return None
        _LAST_FORCE_RELOAD[cache_key] = now
    return load_signing_key_ring(settings=cfg, erp=store, force_reload=True)


def rotate_signing_key(
    *,
    custom_kid: str = "",
    settings: Settings | None = None,
    erp: ERPDataPort | None = None,
) -> SigningKeyRing:
    """Generate and persist a fresh active key version atomically while keeping all prior keys retired."""
    cfg = settings or get_settings()
    store = erp or default_erp_oracle()
    now_iso = dt.datetime.now(dt.UTC).isoformat()
    date_tag = dt.datetime.now(dt.UTC).strftime("%Y%m%d")
    if custom_kid.strip():
        new_kid = _sanitize_kid(custom_kid)
        if len(new_kid) < 2:
            raise ValueError("Signing key ID must be at least 2 alphanumeric/hyphen characters")
    else:
        new_kid = f"pramaan-{date_tag}-{secrets.token_hex(3)}"

    env_kid = _sanitize_kid(cfg.signing_key_id) or derive_deterministic_kid(cfg.secret_key)
    prev_env_kids = {k for k, _ in _parse_previous_env_keys(cfg.previous_secret_keys)}
    if new_kid == env_kid or new_kid in prev_env_kids:
        raise ValueError(f"Signing key ID {new_kid!r} already exists; choose a new unique key ID")

    # Atomically seed the primary env key as retired (ON CONFLICT DO NOTHING) and activate the fresh key in one tx.
    seed_env_key = StoredSigningKey(
        kid=env_kid,
        secret_material=cfg.secret_key,
        status="retired",
        created_at=now_iso,
        retired_at=now_iso,
    )
    new_key = StoredSigningKey(
        kid=new_kid,
        secret_material=secrets.token_hex(32),
        status="active",
        created_at=now_iso,
        retired_at="",
    )
    store.rotate_signing_keys_atomic(new_key, seed_retired_key=seed_env_key)
    reset_signing_key_ring_cache()
    return load_signing_key_ring(settings=cfg, erp=store)
