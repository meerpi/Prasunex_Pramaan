"""Salted RFC 9162 (Certificate Transparency) Binary Merkle Tree & Ed25519 Signed Tree Heads.

Per Trial 7 & DPDP Rules 2025:
- Domain separation: `0x00` leaves, `0x01` interior nodes (immune to CVE-2012-2459)
- Per-leaf 128-bit cryptographic salt prevents offline rainbow brute-forcing of discrete
  CGPA / grade / salary fields even against adversaries holding the published root.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import secrets
from collections.abc import Sequence
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

LEAF_PREFIX = b"\x00"
NODE_PREFIX = b"\x01"


@dataclass(frozen=True, slots=True)
class SaltedLeaf:
    claim_key: str
    claim_value: str
    salt_hex: str
    leaf_bytes: bytes
    leaf_hash: bytes


def hash_salted_leaf(claim_key: str, claim_value: str, *, salt_bytes: bytes | None = None) -> SaltedLeaf:
    salt = salt_bytes if salt_bytes is not None else secrets.token_bytes(16)
    payload = json.dumps({"k": claim_key, "v": claim_value}, sort_keys=True, separators=(",", ":")).encode("utf-8")
    raw_leaf = salt + payload
    digest = hashlib.sha256(LEAF_PREFIX + raw_leaf).digest()
    return SaltedLeaf(
        claim_key=claim_key,
        claim_value=claim_value,
        salt_hex=salt.hex(),
        leaf_bytes=raw_leaf,
        leaf_hash=digest,
    )


def hash_leaf_from_salt_hex(claim_key: str, claim_value: str, salt_hex: str) -> bytes:
    return hash_salted_leaf(claim_key, claim_value, salt_bytes=bytes.fromhex(salt_hex)).leaf_hash


def hash_children(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(NODE_PREFIX + left + right).digest()


def _largest_power_of_two_less_than(n: int) -> int:
    return 1 << ((n - 1).bit_length() - 1)


def compute_merkle_root(leaf_hashes: Sequence[bytes]) -> bytes:
    n = len(leaf_hashes)
    if n == 0:
        return hashlib.sha256(b"").digest()
    if n == 1:
        return leaf_hashes[0]
    k = _largest_power_of_two_less_than(n)
    return hash_children(compute_merkle_root(leaf_hashes[:k]), compute_merkle_root(leaf_hashes[k:]))


@dataclass(frozen=True, slots=True)
class InclusionStep:
    sibling_hash: bytes
    sibling_is_right: bool


def prove_inclusion(leaf_hashes: Sequence[bytes], index: int) -> list[InclusionStep]:
    n = len(leaf_hashes)
    if not (0 <= index < n):
        raise IndexError(f"Leaf index {index} out of range for tree size {n}")
    if n == 1:
        return []
    k = _largest_power_of_two_less_than(n)
    if index < k:
        proof = prove_inclusion(leaf_hashes[:k], index)
        proof.append(InclusionStep(sibling_hash=compute_merkle_root(leaf_hashes[k:]), sibling_is_right=True))
        return proof
    proof = prove_inclusion(leaf_hashes[k:], index - k)
    proof.append(InclusionStep(sibling_hash=compute_merkle_root(leaf_hashes[:k]), sibling_is_right=False))
    return proof


def verify_inclusion(leaf_hash: bytes, proof: Sequence[InclusionStep], expected_root: bytes) -> bool:
    cur = leaf_hash
    for step in proof:
        if step.sibling_is_right:
            cur = hash_children(cur, step.sibling_hash)
        else:
            cur = hash_children(step.sibling_hash, cur)
    return cur == expected_root


@dataclass(frozen=True, slots=True)
class SignedTreeHead:
    tree_size: int
    root_hash_hex: str
    issued_at: str
    signature_b64: str
    public_key_b64: str


class SaltedMerkleTree:
    """Immutable salted RFC 9162 Merkle tree for selective-disclosure credentials."""

    def __init__(self, claims: dict[str, str], *, fixed_salts: dict[str, bytes] | None = None) -> None:
        self.leaves: list[SaltedLeaf] = [
            hash_salted_leaf(k, claims[k], salt_bytes=(fixed_salts or {}).get(k))
            for k in sorted(claims.keys())
        ]
        self.leaf_hashes: list[bytes] = [lf.leaf_hash for lf in self.leaves]
        self.root: bytes = compute_merkle_root(self.leaf_hashes)

    def inclusion_proof(self, claim_key: str) -> tuple[SaltedLeaf, list[InclusionStep]]:
        for idx, lf in enumerate(self.leaves):
            if lf.claim_key == claim_key:
                return lf, prove_inclusion(self.leaf_hashes, idx)
        raise KeyError(f"Claim key {claim_key!r} not in Merkle tree")

    def sign_tree_head(self, private_key: Ed25519PrivateKey, *, context: str = "") -> SignedTreeHead:
        issued = dt.datetime.now(dt.UTC).isoformat()
        root_hex = self.root.hex()
        prefix = f"{context}|" if context else ""
        msg = f"{prefix}{len(self.leaves)}|{root_hex}|{issued}".encode()
        sig = private_key.sign(msg)
        pub_raw = private_key.public_key().public_bytes_raw()
        return SignedTreeHead(
            tree_size=len(self.leaves),
            root_hash_hex=root_hex,
            issued_at=issued,
            signature_b64=base64.b64encode(sig).decode("ascii"),
            public_key_b64=base64.b64encode(pub_raw).decode("ascii"),
        )


def verify_tree_head(
    sth: SignedTreeHead,
    public_key: Ed25519PublicKey | None = None,
    *,
    context: str = "",
) -> bool:
    try:
        pub = public_key or Ed25519PublicKey.from_public_bytes(base64.b64decode(sth.public_key_b64))
        prefix = f"{context}|" if context else ""
        msg = f"{prefix}{sth.tree_size}|{sth.root_hash_hex}|{sth.issued_at}".encode()
        pub.verify(base64.b64decode(sth.signature_b64), msg)
        return True
    except Exception:
        return False
