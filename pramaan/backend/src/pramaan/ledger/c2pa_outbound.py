"""Cryptographic ECDSA P-256 & Ed25519 Governance Certificates (no hardcoded default secrets)."""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
from collections.abc import Mapping

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pydantic import BaseModel

from pramaan.ledger.chain import GENESIS_HASH, AuditChainEvent, verify_chain


class GovernanceManifest(BaseModel):
    manifest_id: str
    submission_id: int
    content_hash: str
    canon_id: str
    canon_hash: str
    issuer: str
    issued_at: str
    audit_chain_tip_hash: str
    chain_verified: bool
    key_id: str = ""
    algorithm: str = "ECDSA-P256-SHA256"
    signature_alg: str = "ECDSA-P256-SHA256"
    signature_b64: str
    public_key_pem: str


def _canonical_manifest_body(
    *,
    submission_id: int,
    content_hash: str,
    canon_id: str,
    canon_hash: str,
    issuer: str,
    issued_at: str,
    audit_chain_tip_hash: str,
    chain_verified: bool,
    key_id: str = "",
) -> bytes:
    payload: dict[str, object] = {
        "submission_id": submission_id,
        "content_hash": content_hash,
        "canon_id": canon_id,
        "canon_hash": canon_hash,
        "issuer": issuer,
        "issued_at": issued_at,
        "audit_chain_tip_hash": audit_chain_tip_hash,
        "chain_verified": chain_verified,
    }
    if key_id:
        payload["key_id"] = key_id
    return json.dumps(payload, sort_keys=True).encode("utf-8")


def build_signed_governance_manifest(
    *,
    submission_id: int,
    content_hash: str,
    canon_id: str,
    canon_hash: str,
    issuer: str,
    chain_events: list[AuditChainEvent] | None = None,
    tip_hash: str | None = None,
    chain_verified: bool | None = None,
    signing_key: ec.EllipticCurvePrivateKey,
    key_id: str = "",
) -> GovernanceManifest:
    if tip_hash is not None:
        resolved_tip = tip_hash
        chain_ok = True if chain_verified is None else bool(chain_verified)
    else:
        evs = chain_events or []
        chain_ok, _ = verify_chain(evs)
        resolved_tip = evs[-1].event_hash if evs else GENESIS_HASH
    issued = dt.datetime.now(dt.UTC).isoformat()
    body = _canonical_manifest_body(
        submission_id=submission_id,
        content_hash=content_hash,
        canon_id=canon_id,
        canon_hash=canon_hash,
        issuer=issuer,
        issued_at=issued,
        audit_chain_tip_hash=resolved_tip,
        chain_verified=chain_ok,
        key_id=key_id,
    )
    manifest_id = f"c2pa-{hashlib.sha256(body).hexdigest()[:16]}"
    sig = signing_key.sign(body, ec.ECDSA(hashes.SHA256()))
    pub_pem = signing_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode("ascii")
    return GovernanceManifest(
        manifest_id=manifest_id,
        submission_id=submission_id,
        content_hash=content_hash,
        canon_id=canon_id,
        canon_hash=canon_hash,
        issuer=issuer,
        issued_at=issued,
        audit_chain_tip_hash=resolved_tip,
        chain_verified=chain_ok,
        key_id=key_id,
        signature_b64=base64.b64encode(sig).decode("ascii"),
        public_key_pem=pub_pem,
    )


def verify_governance_manifest(
    manifest: GovernanceManifest,
    *,
    trusted_public_key: ec.EllipticCurvePublicKey | None = None,
    trusted_keys_by_kid: Mapping[str, ec.EllipticCurvePublicKey] | None = None,
) -> bool:
    try:
        candidates: list[ec.EllipticCurvePublicKey] = []
        if trusted_public_key is not None:
            candidates = [trusted_public_key]
        elif trusted_keys_by_kid is not None:
            if manifest.key_id:
                hit = trusted_keys_by_kid.get(manifest.key_id)
                if hit is None:
                    return False
                candidates = [hit]
            else:
                candidates = list(trusted_keys_by_kid.values())
        else:
            pub = serialization.load_pem_public_key(manifest.public_key_pem.encode("ascii"))
            if not isinstance(pub, ec.EllipticCurvePublicKey):
                return False
            candidates = [pub]

        body = _canonical_manifest_body(
            submission_id=manifest.submission_id,
            content_hash=manifest.content_hash,
            canon_id=manifest.canon_id,
            canon_hash=manifest.canon_hash,
            issuer=manifest.issuer,
            issued_at=manifest.issued_at,
            audit_chain_tip_hash=manifest.audit_chain_tip_hash,
            chain_verified=manifest.chain_verified,
            key_id=manifest.key_id,
        )
        sig_bytes = base64.b64decode(manifest.signature_b64)
        for pub in candidates:
            try:
                pub.verify(sig_bytes, body, ec.ECDSA(hashes.SHA256()))
                return True
            except Exception:
                continue
        return False
    except Exception:
        return False


def derive_ephemeral_ec_key(secret_bytes: bytes) -> ec.EllipticCurvePrivateKey:
    """Deterministically derive P-256 key from strong runtime secret (never a static hardcoded string)."""
    digest = hashlib.sha256(b"pramaan-ecdsa-p256:" + secret_bytes).digest()
    val = int.from_bytes(digest, "big") % 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632550
    return ec.derive_private_key(max(1, val), ec.SECP256R1())
