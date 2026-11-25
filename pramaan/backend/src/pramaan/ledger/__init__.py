"""Tamper-evident Merkle QR passport, SHA-256 chain, friction analytics, and C2PA manifests."""

from pramaan.ledger.c2pa_outbound import (
    GovernanceManifest,
    build_signed_governance_manifest,
    derive_ephemeral_ec_key,
    verify_governance_manifest,
)
from pramaan.ledger.chain import GENESIS_HASH, AuditChainEvent, compute_event_hash, verify_chain
from pramaan.ledger.digilocker_vpc import (
    DigiLockerPkceChallenge,
    DigiLockerVerificationReceipt,
    compute_pkce_s256_challenge,
    create_digilocker_pkce_challenge,
    verify_digilocker_pkce_callback,
)
from pramaan.ledger.friction import compute_rule_friction, krippendorff_alpha
from pramaan.ledger.keyring import (
    KeyVersion,
    SigningKeyRing,
    b64u_decode,
    b64u_encode,
    derive_deterministic_kid,
    get_cached_signing_key_ring,
    load_signing_key_ring,
    reload_signing_key_ring_on_miss,
    reset_signing_key_ring_cache,
    rotate_signing_key,
)
from pramaan.ledger.merkle import (
    InclusionStep,
    SaltedLeaf,
    SaltedMerkleTree,
    SignedTreeHead,
    compute_merkle_root,
    hash_leaf_from_salt_hex,
    hash_salted_leaf,
    prove_inclusion,
    verify_inclusion,
    verify_tree_head,
)
from pramaan.ledger.qr_passport import (
    MintedQrPassport,
    VerifiedQrPassport,
    base45_decode,
    base45_encode,
    cross_verify_resume_against_claims,
    decode_qr_image_bytes,
    export_sd_jwt_vc,
    extract_qr_from_pdf_bytes,
    mint_selective_passport,
    render_qr_png_bytes,
    verify_sd_jwt_passport,
    verify_selective_passport,
)


def verify_selective_passport_with_ring(
    payload: str,
    *,
    settings=None,
    erp=None,
) -> VerifiedQrPassport:
    """Verify a QR/SD-JWT passport against the active key ring, reloading once if an unknown kid appears."""
    ring = load_signing_key_ring(settings=settings, erp=erp)
    res = verify_selective_passport(payload, trusted_keys_by_kid=ring.ed25519_public_keys())
    if not res.valid and res.key_id and res.key_id not in ring.ed25519_public_keys():
        reloaded = reload_signing_key_ring_on_miss(settings=settings, erp=erp)
        if reloaded is not None and res.key_id in reloaded.ed25519_public_keys():
            res = verify_selective_passport(payload, trusted_keys_by_kid=reloaded.ed25519_public_keys())
    return res


__all__ = [
    "AuditChainEvent",
    "DigiLockerPkceChallenge",
    "DigiLockerVerificationReceipt",
    "GENESIS_HASH",
    "GovernanceManifest",
    "InclusionStep",
    "KeyVersion",
    "MintedQrPassport",
    "SaltedLeaf",
    "SaltedMerkleTree",
    "SignedTreeHead",
    "SigningKeyRing",
    "VerifiedQrPassport",
    "b64u_decode",
    "b64u_encode",
    "base45_decode",
    "base45_encode",
    "build_signed_governance_manifest",
    "compute_event_hash",
    "compute_merkle_root",
    "compute_pkce_s256_challenge",
    "compute_rule_friction",
    "create_digilocker_pkce_challenge",
    "cross_verify_resume_against_claims",
    "decode_qr_image_bytes",
    "derive_deterministic_kid",
    "derive_ephemeral_ec_key",
    "export_sd_jwt_vc",
    "extract_qr_from_pdf_bytes",
    "get_cached_signing_key_ring",
    "hash_leaf_from_salt_hex",
    "hash_salted_leaf",
    "krippendorff_alpha",
    "load_signing_key_ring",
    "mint_selective_passport",
    "prove_inclusion",
    "reload_signing_key_ring_on_miss",
    "render_qr_png_bytes",
    "reset_signing_key_ring_cache",
    "rotate_signing_key",
    "verify_chain",
    "verify_digilocker_pkce_callback",
    "verify_governance_manifest",
    "verify_inclusion",
    "verify_sd_jwt_passport",
    "verify_selective_passport",
    "verify_selective_passport_with_ring",
    "verify_tree_head",
]

