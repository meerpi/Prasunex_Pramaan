"""Trial 7 & S7: CBOR + zlib + Base45 Selective-Disclosure QR Passport Minter & Offline Verifier."""

from __future__ import annotations

import base64
import io
import re
import secrets
import zlib
from collections.abc import Mapping
from dataclasses import dataclass

import cbor2
import cv2
import numpy as np
import qrcode
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from pramaan.ledger.keyring import b64u_decode, b64u_encode
from pramaan.ledger.merkle import (
    InclusionStep,
    SaltedMerkleTree,
    SignedTreeHead,
    hash_leaf_from_salt_hex,
    verify_inclusion,
    verify_tree_head,
)

BASE45_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"
_B45_DECODE = {ch: i for i, ch in enumerate(BASE45_ALPHABET)}


def base45_encode(data: bytes) -> str:
    out: list[str] = []
    for i in range(0, len(data), 2):
        if i + 1 < len(data):
            x = (data[i] << 8) + data[i + 1]
            c, rem = divmod(x, 45 * 45)
            d, e = divmod(rem, 45)
            out.append(BASE45_ALPHABET[e] + BASE45_ALPHABET[d] + BASE45_ALPHABET[c])
        else:
            d, e = divmod(data[i], 45)
            out.append(BASE45_ALPHABET[e] + BASE45_ALPHABET[d])
    return "".join(out)


def base45_decode(s: str) -> bytes:
    buf = bytearray()
    i = 0
    while i < len(s):
        if i + 2 < len(s):
            e, d, c = _B45_DECODE[s[i]], _B45_DECODE[s[i + 1]], _B45_DECODE[s[i + 2]]
            x = e + 45 * d + 45 * 45 * c
            buf.append(x >> 8)
            buf.append(x & 0xFF)
            i += 3
        elif i + 1 < len(s):
            e, d = _B45_DECODE[s[i]], _B45_DECODE[s[i + 1]]
            buf.append(e + 45 * d)
            i += 2
        else:
            raise ValueError("Invalid Base45 length")
    return bytes(buf)


@dataclass(frozen=True, slots=True)
class MintedQrPassport:
    passport_id: str
    holder_prn: str
    disclosed_claims: dict[str, str]
    hidden_claims: list[str]
    root_hash_hex: str
    base45_payload: str
    payload_bytes_len: int
    qr_version: int
    qr_png_b64: str
    issued_at: str
    key_id: str = ""


@dataclass(frozen=True, slots=True)
class VerifiedQrPassport:
    valid: bool
    reason: str
    passport_id: str
    holder_prn: str
    root_hash_hex: str
    disclosed_claims: dict[str, str]
    signature_ok: bool
    merkle_proofs_ok: bool
    issued_at: str = ""
    key_id: str = ""


MAX_DECOMPRESSED_BYTES = 65_536


def _build_qr_png_and_version(b45_payload: str) -> tuple[bytes, int]:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=8, border=4)
    qr.add_data(b45_payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#171614", back_color="#FFFFFF")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue(), int(qr.version)


def render_qr_png_bytes(b45_payload: str) -> bytes:
    """Render a high-contrast Pramaan QR code PNG for a verified Base45/SD-JWT payload."""
    png_bytes, _ = _build_qr_png_and_version(b45_payload)
    return png_bytes


def mint_selective_passport(
    *,
    passport_id: str,
    holder_prn: str,
    all_claims: dict[str, str],
    disclose_keys: list[str],
    signing_key: Ed25519PrivateKey,
    key_id: str = "",
) -> MintedQrPassport:
    """Mint a salted RFC 9162 Merkle QR passport revealing ONLY `disclose_keys`."""
    tree = SaltedMerkleTree(all_claims)
    sth: SignedTreeHead = tree.sign_tree_head(signing_key, context=f"{passport_id}|{holder_prn}")

    disclosed_bundle: list[dict[str, object]] = []
    disclosed_map: dict[str, str] = {}
    for key in sorted(disclose_keys):
        if key not in all_claims:
            continue
        leaf, steps = tree.inclusion_proof(key)
        disclosed_map[key] = leaf.claim_value
        disclosed_bundle.append(
            {
                "k": leaf.claim_key,
                "v": leaf.claim_value,
                "s": bytes.fromhex(leaf.salt_hex),
                "p": [[st.sibling_hash, 1 if st.sibling_is_right else 0] for st in steps],
            }
        )

    compact_doc: dict[str, object] = {
        "pid": passport_id,
        "prn": holder_prn,
        "r": bytes.fromhex(sth.root_hash_hex),
        "ts": sth.tree_size,
        "at": sth.issued_at,
        "sig": base64.b64decode(sth.signature_b64),
        "pk": base64.b64decode(sth.public_key_b64),
        "c": disclosed_bundle,
    }
    if key_id.strip():
        compact_doc["kid"] = key_id.strip()
    compressed = zlib.compress(cbor2.dumps(compact_doc), level=9)
    b45 = "PR1:" + base45_encode(compressed)

    png_bytes, qr_ver = _build_qr_png_and_version(b45)
    png_b64 = base64.b64encode(png_bytes).decode("ascii")

    hidden = [k for k in sorted(all_claims.keys()) if k not in disclosed_map]
    return MintedQrPassport(
        passport_id=passport_id,
        holder_prn=holder_prn,
        disclosed_claims=disclosed_map,
        hidden_claims=hidden,
        root_hash_hex=sth.root_hash_hex,
        base45_payload=b45,
        payload_bytes_len=len(b45.encode("ascii")),
        qr_version=qr_ver,
        qr_png_b64=png_b64,
        issued_at=sth.issued_at,
        key_id=key_id.strip(),
    )


def verify_selective_passport(
    b45_payload: str,
    *,
    trusted_public_key: Ed25519PublicKey | None = None,
    trusted_keys_by_kid: Mapping[str, Ed25519PublicKey] | None = None,
    allow_untrusted_embedded_key: bool = False,
) -> VerifiedQrPassport:
    """Verify Base45+zlib+CBOR passport OR RFC 9901 SD-JWT offline using Ed25519 key or versioned key ring."""
    raw = b45_payload.strip()
    if raw.startswith("eyJ") and "~" in raw:
        return verify_sd_jwt_passport(
            raw,
            trusted_public_key=trusted_public_key,
            trusted_keys_by_kid=trusted_keys_by_kid,
            allow_untrusted_embedded_key=allow_untrusted_embedded_key,
        )
    if trusted_public_key is None and not trusted_keys_by_kid and not allow_untrusted_embedded_key:
        return VerifiedQrPassport(
            valid=False,
            reason="Trusted issuer Ed25519 public key is required for verification",
            passport_id="",
            holder_prn="",
            root_hash_hex="",
            disclosed_claims={},
            signature_ok=False,
            merkle_proofs_ok=False,
        )
    if raw.startswith("PR1:"):
        raw = raw[4:]
    try:
        compressed = base45_decode(raw)
        dec = zlib.decompressobj()
        decompressed = dec.decompress(compressed, MAX_DECOMPRESSED_BYTES + 1)
        if len(decompressed) > MAX_DECOMPRESSED_BYTES or dec.unconsumed_tail:
            raise ValueError("Decompressed passport exceeds 64 KB safety limit")
        doc = cbor2.loads(decompressed)
        if not isinstance(doc, dict):
            raise ValueError("Decoded passport payload must be a CBOR map")
        pid = str(doc.get("pid") or "")
        prn = str(doc.get("prn") or "")
        payload_kid = str(doc.get("kid") or "").strip()
        if not pid or not prn:
            raise ValueError("Missing passport_id or holder_prn")
        root_bytes: bytes = bytes(doc["r"])
        sth = SignedTreeHead(
            tree_size=int(doc["ts"]),
            root_hash_hex=root_bytes.hex(),
            issued_at=str(doc["at"]),
            signature_b64=base64.b64encode(bytes(doc["sig"])).decode("ascii"),
            public_key_b64=base64.b64encode(bytes(doc["pk"])).decode("ascii"),
        )
    except Exception as exc:
        return VerifiedQrPassport(
            valid=False,
            reason=f"Malformed CBOR/Base45 passport payload: {exc}",
            passport_id="",
            holder_prn="",
            root_hash_hex="",
            disclosed_claims={},
            signature_ok=False,
            merkle_proofs_ok=False,
        )

    matched_kid = payload_kid
    sig_ok = False
    if trusted_public_key is not None:
        sig_ok = verify_tree_head(sth, public_key=trusted_public_key, context=f"{pid}|{prn}")
    elif trusted_keys_by_kid:
        if payload_kid:
            candidate = trusted_keys_by_kid.get(payload_kid)
            if candidate is None:
                return VerifiedQrPassport(
                    valid=False,
                    reason=f"Unknown or untrusted signing key ID ({payload_kid})",
                    passport_id=pid,
                    holder_prn=prn,
                    root_hash_hex=sth.root_hash_hex,
                    disclosed_claims={},
                    signature_ok=False,
                    merkle_proofs_ok=False,
                    issued_at=sth.issued_at,
                    key_id=payload_kid,
                )
            sig_ok = verify_tree_head(sth, public_key=candidate, context=f"{pid}|{prn}")
        else:
            # Legacy QR payloads minted without `kid`: match against active & retired trusted keys
            for cand_kid, cand_pub in trusted_keys_by_kid.items():
                if verify_tree_head(sth, public_key=cand_pub, context=f"{pid}|{prn}"):
                    sig_ok = True
                    matched_kid = cand_kid
                    break
    else:
        sig_ok = verify_tree_head(sth, public_key=None, context=f"{pid}|{prn}")

    if not sig_ok:
        return VerifiedQrPassport(
            valid=False,
            reason="Ed25519 university Signed Tree Head signature verification failed",
            passport_id=pid,
            holder_prn=prn,
            root_hash_hex=sth.root_hash_hex,
            disclosed_claims={},
            signature_ok=False,
            merkle_proofs_ok=False,
            issued_at=sth.issued_at,
            key_id=matched_kid,
        )

    disclosed: dict[str, str] = {}
    all_proofs_ok = True
    try:
        raw_claims = doc.get("c") or []
        if not isinstance(raw_claims, list):
            raise TypeError("Passport claims entry must be a list")
        for item in raw_claims:
            k = str(item["k"])
            v = str(item["v"])
            salt_b = bytes(item["s"])
            steps = [
                InclusionStep(sibling_hash=bytes(st[0]), sibling_is_right=bool(st[1]))
                for st in item["p"]
            ]
            lh = hash_leaf_from_salt_hex(k, v, salt_b.hex())
            if not verify_inclusion(lh, steps, root_bytes):
                all_proofs_ok = False
                break
            disclosed[k] = v
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        return VerifiedQrPassport(
            valid=False,
            reason=f"Malformed disclosed claim proof structure: {exc}",
            passport_id=pid,
            holder_prn=prn,
            root_hash_hex=sth.root_hash_hex,
            disclosed_claims={},
            signature_ok=sig_ok,
            merkle_proofs_ok=False,
            issued_at=sth.issued_at,
            key_id=matched_kid,
        )

    return VerifiedQrPassport(
        valid=sig_ok and all_proofs_ok and bool(disclosed),
        reason="Cryptographically verified offline (Ed25519 + RFC 9162 salted Merkle proof)"
        if (sig_ok and all_proofs_ok and disclosed)
        else "Merkle inclusion proof failed for one or more claims",
        passport_id=pid,
        holder_prn=prn,
        root_hash_hex=sth.root_hash_hex,
        disclosed_claims=disclosed,
        signature_ok=sig_ok,
        merkle_proofs_ok=all_proofs_ok,
        issued_at=sth.issued_at,
        key_id=matched_kid,
    )


def export_sd_jwt_vc(
    minted: MintedQrPassport,
    signing_key: Ed25519PrivateKey,
    *,
    key_id: str = "",
) -> dict[str, object]:
    """Export an RFC 9901 SD-JWT + W3C VC 2.0 JSON-LD aligned credential envelope."""
    import hashlib
    import json

    disclosures: list[str] = []
    sd_digests: list[str] = []
    for k, v in sorted(minted.disclosed_claims.items()):
        salt = b64u_encode(secrets.token_bytes(16))
        disc_b64 = b64u_encode(json.dumps([salt, k, v], separators=(",", ":")).encode("utf-8"))
        disclosures.append(disc_b64)
        sd_digests.append(b64u_encode(hashlib.sha256(disc_b64.encode("ascii")).digest()))

    effective_kid = (key_id or minted.key_id).strip()
    pub_b64u = b64u_encode(signing_key.public_key().public_bytes_raw())
    header_obj: dict[str, str] = {"alg": "EdDSA", "typ": "vc+sd-jwt"}
    if effective_kid:
        header_obj["kid"] = effective_kid
    header = b64u_encode(json.dumps(header_obj, separators=(",", ":")).encode())
    payload = b64u_encode(
        json.dumps(
            {
                "iss": "https://pramaan.edu.in/issuer",
                "sub": f"urn:pramaan:prn:{minted.holder_prn}",
                "jti": minted.passport_id,
                "iat": minted.issued_at,
                "vct": "https://pramaan.edu.in/credentials/academic-passport/v1",
                "merkle_root": minted.root_hash_hex,
                "_sd_alg": "sha-256",
                "_sd": sorted(sd_digests),
                "cnf": {
                    "jwk": {
                        "kty": "OKP",
                        "crv": "Ed25519",
                        "x": pub_b64u,
                        **({"kid": effective_kid} if effective_kid else {}),
                    }
                },
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    )
    sig = b64u_encode(signing_key.sign(f"{header}.{payload}".encode("ascii")))
    proof_obj: dict[str, str] = {
        "type": "DataIntegrityProof",
        "cryptosuite": "eddsa-rdfc-2022",
        "proofPurpose": "assertionMethod",
        "proofValue": sig,
    }
    if effective_kid:
        proof_obj["verificationMethod"] = f"did:web:pramaan.edu.in#{effective_kid}"
    return {
        "sd_jwt": "~".join([f"{header}.{payload}.{sig}", *disclosures, ""]),
        "w3c_vc_2_0": {
            "@context": ["https://www.w3.org/ns/credentials/v2"],
            "type": ["VerifiableCredential", "PramaanAcademicPassport"],
            "id": f"urn:uuid:{minted.passport_id}",
            "issuer": "did:web:pramaan.edu.in",
            "validFrom": minted.issued_at,
            "credentialSubject": {
                "id": f"urn:pramaan:prn:{minted.holder_prn}",
                **minted.disclosed_claims,
            },
            "proof": proof_obj,
        },
    }


def verify_sd_jwt_passport(
    sd_jwt_token: str,
    *,
    trusted_public_key: Ed25519PublicKey | None = None,
    trusted_keys_by_kid: Mapping[str, Ed25519PublicKey] | None = None,
    allow_untrusted_embedded_key: bool = False,
) -> VerifiedQrPassport:
    """Verify an RFC 9901 SD-JWT (`<issuer-jwt>~<d1>~<d2>~`) offline with Ed25519 key or versioned key ring."""
    import hashlib
    import json

    try:
        parts = [p for p in sd_jwt_token.strip().split("~") if p]
        if not parts:
            raise ValueError("Empty SD-JWT envelope")
        jwt_part = parts[0]
        disclosure_parts = parts[1:]
        jwt_segments = jwt_part.split(".")
        if len(jwt_segments) != 3:
            raise ValueError("SD-JWT issuer token must have 3 JWS segments")
        header_b64, payload_b64, sig_b64 = jwt_segments
        sig_bytes = b64u_decode(sig_b64)
        header = json.loads(b64u_decode(header_b64).decode("utf-8"))
        header_kid = str(header.get("kid") or "").strip() if isinstance(header, dict) else ""
        payload = json.loads(b64u_decode(payload_b64).decode("utf-8"))
        pid = str(payload.get("jti") or "")
        sub = str(payload.get("sub") or "")
        prn = sub.removeprefix("urn:pramaan:prn:")
        root_hex = str(payload.get("merkle_root") or "")
        issued_at = str(payload.get("iat") or "")
        raw_sd = payload.get("_sd")
        sd_set = {str(x) for x in raw_sd} if isinstance(raw_sd, list) else set()

        candidates: list[tuple[str, Ed25519PublicKey]] = []
        if trusted_public_key is not None:
            candidates = [(header_kid, trusted_public_key)]
        elif trusted_keys_by_kid:
            if header_kid:
                hit = trusted_keys_by_kid.get(header_kid)
                if hit is None:
                    return VerifiedQrPassport(
                        valid=False,
                        reason=f"Unknown or untrusted SD-JWT signing key ID ({header_kid})",
                        passport_id=pid,
                        holder_prn=prn,
                        root_hash_hex=root_hex,
                        disclosed_claims={},
                        signature_ok=False,
                        merkle_proofs_ok=False,
                        issued_at=issued_at,
                        key_id=header_kid,
                    )
                candidates = [(header_kid, hit)]
            else:
                candidates = list(trusted_keys_by_kid.items())
        else:
            if not allow_untrusted_embedded_key:
                raise ValueError("Trusted issuer Ed25519 public key is required")
            x_b64u = str(((payload.get("cnf") or {}).get("jwk") or {}).get("x") or "")
            if not x_b64u:
                raise ValueError("Missing trusted Ed25519 public key and cnf.jwk.x")
            candidates = [(header_kid, Ed25519PublicKey.from_public_bytes(b64u_decode(x_b64u)))]
    except Exception as exc:
        return VerifiedQrPassport(
            valid=False,
            reason=f"Malformed RFC 9901 SD-JWT payload: {exc}",
            passport_id="",
            holder_prn="",
            root_hash_hex="",
            disclosed_claims={},
            signature_ok=False,
            merkle_proofs_ok=False,
        )

    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    sig_ok = False
    matched_kid = header_kid
    for cand_kid, cand_pub in candidates:
        try:
            cand_pub.verify(sig_bytes, signing_input)
            sig_ok = True
            matched_kid = cand_kid or header_kid
            break
        except Exception:
            continue

    if not sig_ok:
        return VerifiedQrPassport(
            valid=False,
            reason="Ed25519 SD-JWT issuer signature verification failed",
            passport_id=pid,
            holder_prn=prn,
            root_hash_hex=root_hex,
            disclosed_claims={},
            signature_ok=False,
            merkle_proofs_ok=False,
            issued_at=issued_at,
            key_id=matched_kid,
        )

    disclosed: dict[str, str] = {}
    all_digests_ok = bool(sd_set) and bool(disclosure_parts)
    try:
        for disc_b64 in disclosure_parts:
            digest_b64u = b64u_encode(hashlib.sha256(disc_b64.encode("ascii")).digest())
            if not sd_set or digest_b64u not in sd_set:
                all_digests_ok = False
                break
            arr = json.loads(b64u_decode(disc_b64).decode("utf-8"))
            if not isinstance(arr, list) or len(arr) != 3:
                raise ValueError("Disclosure must be a 3-element [salt, claim_name, claim_value] array")
            disclosed[str(arr[1])] = str(arr[2])
    except Exception as exc:
        return VerifiedQrPassport(
            valid=False,
            reason=f"Invalid SD-JWT disclosure array: {exc}",
            passport_id=pid,
            holder_prn=prn,
            root_hash_hex=root_hex,
            disclosed_claims={},
            signature_ok=sig_ok,
            merkle_proofs_ok=False,
            issued_at=issued_at,
            key_id=matched_kid,
        )

    valid = sig_ok and all_digests_ok and bool(disclosed)
    return VerifiedQrPassport(
        valid=valid,
        reason="Cryptographically verified RFC 9901 SD-JWT (EdDSA + SHA-256 _sd disclosure digests)"
        if valid
        else "SD-JWT disclosure digest mismatch against signed _sd array",
        passport_id=pid,
        holder_prn=prn,
        root_hash_hex=root_hex,
        disclosed_claims=disclosed if valid else {},
        signature_ok=sig_ok,
        merkle_proofs_ok=all_digests_ok,
        issued_at=issued_at,
        key_id=matched_kid,
    )


_MAX_QR_IMAGE_DIM = 4096
_MAX_QR_IMAGE_PIXELS = 16_777_216


def decode_qr_image_bytes(png_bytes: bytes) -> str:
    """Decode QR code image with pixel-dimension bomb guard + OpenCV QRCodeDetectorAruco/QRCodeDetector."""
    from PIL import Image

    try:
        with Image.open(io.BytesIO(png_bytes)) as pil_img:
            width, height = pil_img.size
    except Exception as exc:
        raise ValueError("Invalid image bytes for QR decoding") from exc

    if width <= 0 or height <= 0 or width > _MAX_QR_IMAGE_DIM or height > _MAX_QR_IMAGE_DIM or width * height > _MAX_QR_IMAGE_PIXELS:
        raise ValueError(
            f"QR image dimensions ({width}x{height}) exceed safety limit ({_MAX_QR_IMAGE_DIM}x{_MAX_QR_IMAGE_DIM})"
        )

    arr = np.frombuffer(png_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image bytes for QR decoding")
    detectors = (cv2.QRCodeDetectorAruco(), cv2.QRCodeDetector())
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    padded_otsu = cv2.copyMakeBorder(otsu, 32, 32, 32, 32, cv2.BORDER_CONSTANT, value=255)
    candidates: list[np.ndarray] = [img, otsu, padded_otsu]
    # Only upscale smaller captures to avoid unnecessary multi-hundred-MB buffers
    if max(width, height) <= 1200:
        candidates.append(cv2.resize(padded_otsu, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC))
        candidates.append(cv2.resize(padded_otsu, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_NEAREST))
    for det in detectors:
        for cand in candidates:
            txt, _, _ = det.detectAndDecode(cand)
            if txt:
                return txt
    raise ValueError("No readable Pramaan QR code found in image")


def _is_pramaan_token(text: str) -> bool:
    s = text.strip()
    return s.startswith("PR1:") or (s.startswith("eyJ") and "~" in s)


def _qr_square_priority(item: tuple[str, bytes]) -> float:
    from PIL import Image

    try:
        with Image.open(io.BytesIO(item[1])) as im:
            w, h = im.size
            if w <= 0 or h <= 0:
                return 99.0
            return abs(w / h - 1.0)
    except Exception:
        return 99.0


def extract_qr_from_pdf_bytes(
    pdf_bytes: bytes,
    embedded_images: list[tuple[str, bytes]] | None = None,
) -> str | None:
    """Fast-path extraction of an embedded Pramaan QR pass from a Resume PDF (square embedded images -> 3x Page 1 crop)."""
    for _name, img_bytes in sorted(embedded_images or (), key=_qr_square_priority):
        try:
            decoded = decode_qr_image_bytes(img_bytes)
            if _is_pramaan_token(decoded):
                return decoded.strip()
        except ValueError:
            continue

    # Fallback: render Page 1 at 3x so dense multi-claim QR badges decode reliably
    try:
        from PIL import Image

        from pramaan.parsers.pdf import render_page_png

        page_png = render_page_png(pdf_bytes, 0, scale=3.0)
        with Image.open(io.BytesIO(page_png)) as pil_page:
            w, h = pil_page.size
            crop_box = (int(w * 0.50), 0, w, int(h * 0.45))
            crop_buf = io.BytesIO()
            pil_page.crop(crop_box).save(crop_buf, format="PNG")
            crop_png = crop_buf.getvalue()
        for candidate_png in (crop_png, page_png):
            try:
                decoded = decode_qr_image_bytes(candidate_png)
                if _is_pramaan_token(decoded):
                    return decoded.strip()
            except ValueError:
                continue
    except Exception:
        return None
    return None


_RESUME_CGPA_PATTERNS = (
    re.compile(r"(?<![A-Za-z])(?:c?gpa)\s*(?:of|:|=|is|-)?\s*(\d+(?:\.\d+)?)(?:\s*/\s*10(?:\.0+)?)?\b", re.IGNORECASE),
    re.compile(r"\b(\d+(?:\.\d+)?)\s*/\s*10(?:\.0+)?\s*(?:cgpa|gpa)\b", re.IGNORECASE),
    re.compile(r"\b(\d+(?:\.\d+)?)\s+(?:cgpa|gpa)\b", re.IGNORECASE),
)
_RESUME_CGPA_NON_CGPA_CONTEXT_RE = re.compile(
    r"\b(?:sgpa|semester\s*\d+|sem\s*\d+|class\s+(?:x|10|xii|12)|10th|12th|hsc|ssc|hackathon|rated|rating|score)\b",
    re.IGNORECASE,
)
_RESUME_LABEL_BACKLOGS_RE = re.compile(
    r"\b(?:active\s+)?(?:backlogs?|arrears?)\s*(?:count)?\s*[:=\-]\s*(\d+|none|nil|zero)\b",
    re.IGNORECASE,
)
_RESUME_ZERO_BACKLOGS_RE = re.compile(
    r"\b(?:zero|no|0)\s+(?:active\s+)?(?:backlogs?|arrears?)\b",
    re.IGNORECASE,
)
_RESUME_NUM_BACKLOGS_RE = re.compile(
    r"\b(\d+)\s+(?:active\s+)?(?:backlogs?|arrears?)\b",
    re.IGNORECASE,
)
_RESUME_PAST_BACKLOGS_PREFIX_RE = re.compile(
    r"\b(?:cleared|resolved|passed|previously|had)\s*$",
    re.IGNORECASE,
)
_RESUME_BATCH_RE = re.compile(
    r"\b(?:batch|class\s+of|graduating|expected\s+graduation|cohort)\s*(?:of|:|-)?\s*(20\d{2})\b",
    re.IGNORECASE,
)
_NAME_HONORIFICS = frozenset({"dr", "mr", "ms", "mrs", "prof", "shri", "smt", "kumari"})


def cross_verify_resume_against_claims(
    visible_text: str,
    claims: dict[str, str],
    *,
    eligibility: dict[str, float | int | None] | None = None,
) -> dict[str, object]:
    """Deterministically cross-verify visible resume text against signed/ERP claims and optional drive eligibility."""
    checks: list[dict[str, str]] = []
    text_low = visible_text.lower()

    # 1. Holder identity check (whole-word >=2 tokens so surname collisions or substrings cannot spoof a pass swap)
    if claims.get("full_name"):
        holder = claims["full_name"].strip()
        tokens = [
            tok
            for tok in re.findall(r"[^\W\d_]{2,}", holder.lower())
            if tok not in _NAME_HONORIFICS
        ]
        matched = [t for t in tokens if re.search(rf"(?<!\w){re.escape(t)}(?!\w)", text_low)]
        min_required = min(2, len(tokens))
        if tokens:
            if len(matched) >= min_required:
                checks.append(
                    {
                        "field": "full_name",
                        "resume_value": "Name matched in resume",
                        "verified_value": holder,
                        "status": "match",
                        "detail": f"Resume references verified holder {holder}.",
                    }
                )
            else:
                checks.append(
                    {
                        "field": "full_name",
                        "resume_value": "Holder name mismatch" if matched else "Holder name absent",
                        "verified_value": holder,
                        "status": "mismatch",
                        "detail": (
                            f"Resume matches only {len(matched)}/{len(tokens)} token(s) of credential holder {holder!r} (possible swapped pass)."
                            if matched
                            else f"Resume text does not mention credential holder {holder!r} (possible swapped pass)."
                        ),
                    }
                )

    # 2. CGPA parity check (+/- 0.02 tolerance; ignores SGPA, Class X/XII, and non-CGPA ratings)
    if claims.get("cgpa"):
        try:
            expected_cgpa = float(claims["cgpa"])
        except ValueError:
            expected_cgpa = -1.0
        if 0.0 <= expected_cgpa <= 10.0:
            found_vals: list[float] = []
            seen_spans: set[tuple[int, int]] = set()
            for pat in _RESUME_CGPA_PATTERNS:
                for m in pat.finditer(visible_text):
                    span = (m.start(1), m.end(1))
                    if span in seen_spans:
                        continue
                    raw_prefix = visible_text[max(0, m.start() - 32) : m.start()]
                    prefix = re.split(r"[\n;]|(?:\.\s+)", raw_prefix)[-1]
                    if _RESUME_CGPA_NON_CGPA_CONTEXT_RE.search(prefix):
                        continue
                    val = float(m.group(1))
                    if 0.0 <= val <= 10.0:
                        seen_spans.add(span)
                        found_vals.append(val)
            if not found_vals:
                checks.append(
                    {
                        "field": "cgpa",
                        "resume_value": "Not stated in resume",
                        "verified_value": f"{expected_cgpa:.2f}",
                        "status": "not_mentioned",
                        "detail": f"No CGPA stated in visible resume text; verified credential attests {expected_cgpa:.2f}.",
                    }
                )
            else:
                mismatch = next((v for v in found_vals if abs(v - expected_cgpa) > 0.02), None)
                if mismatch is not None:
                    checks.append(
                        {
                            "field": "cgpa",
                            "resume_value": f"{mismatch:.2f}",
                            "verified_value": f"{expected_cgpa:.2f}",
                            "status": "mismatch",
                            "detail": f"Resume states CGPA {mismatch:.2f}, contradicting verified record {expected_cgpa:.2f}.",
                        }
                    )
                else:
                    checks.append(
                        {
                            "field": "cgpa",
                            "resume_value": f"{found_vals[0]:.2f}",
                            "verified_value": f"{expected_cgpa:.2f}",
                            "status": "match",
                            "detail": f"Resume CGPA {found_vals[0]:.2f} matches verified record {expected_cgpa:.2f}.",
                        }
                    )

    # 3. Active backlogs parity check (handles label syntax `Active Backlogs: 0` & ignores past cleared backlogs)
    if claims.get("active_backlogs") is not None and str(claims.get("active_backlogs")).strip() != "":
        try:
            exp_bl = int(claims["active_backlogs"])
        except ValueError:
            exp_bl = -1
        if exp_bl >= 0:
            obs_bl: int | None = None
            m_lbl = _RESUME_LABEL_BACKLOGS_RE.search(visible_text)
            if m_lbl:
                raw_tok = m_lbl.group(1).strip().lower()
                obs_bl = 0 if raw_tok in ("none", "nil", "zero") else int(raw_tok)
            else:
                for m_num in _RESUME_NUM_BACKLOGS_RE.finditer(visible_text):
                    prefix = visible_text[max(0, m_num.start() - 24) : m_num.start()]
                    if _RESUME_PAST_BACKLOGS_PREFIX_RE.search(prefix):
                        continue
                    obs_bl = int(m_num.group(1))
                    break
                if obs_bl is None and _RESUME_ZERO_BACKLOGS_RE.search(visible_text):
                    obs_bl = 0
            if obs_bl is not None:
                status = "match" if obs_bl == exp_bl else "mismatch"
                checks.append(
                    {
                        "field": "active_backlogs",
                        "resume_value": str(obs_bl),
                        "verified_value": str(exp_bl),
                        "status": status,
                        "detail": (
                            f"Resume backlog count ({obs_bl}) matches verified record ({exp_bl})."
                            if status == "match"
                            else f"Resume claims {obs_bl} active backlogs, contradicting verified record ({exp_bl})."
                        ),
                    }
                )

    # 4. Batch year parity check
    if claims.get("batch_year"):
        try:
            exp_yr = int(claims["batch_year"])
        except ValueError:
            exp_yr = 0
        m_yr = _RESUME_BATCH_RE.search(visible_text)
        if exp_yr > 0 and m_yr:
            obs_yr = int(m_yr.group(1))
            status = "match" if obs_yr == exp_yr else "mismatch"
            checks.append(
                {
                    "field": "batch_year",
                    "resume_value": str(obs_yr),
                    "verified_value": str(exp_yr),
                    "status": status,
                    "detail": (
                        f"Batch year {obs_yr} matches verified record."
                        if status == "match"
                        else f"Resume states Batch {obs_yr}, contradicting verified Batch {exp_yr}."
                    ),
                }
            )

    # 5. Optional Drive Eligibility evaluation (strictly against verified signed claims)
    elig_checks: list[dict[str, str]] = []
    if eligibility:
        min_cgpa = eligibility.get("min_cgpa")
        if min_cgpa is not None:
            if claims.get("cgpa"):
                v_cgpa = float(claims["cgpa"])
                ok = v_cgpa + 1e-6 >= float(min_cgpa)
                elig_checks.append(
                    {
                        "criterion": "Minimum CGPA",
                        "required": f">= {float(min_cgpa):.2f}",
                        "verified_value": f"{v_cgpa:.2f}",
                        "status": "passed" if ok else "failed",
                        "detail": f"Verified CGPA {v_cgpa:.2f} {'meets' if ok else 'is below'} cutoff {float(min_cgpa):.2f}.",
                    }
                )
            else:
                elig_checks.append(
                    {
                        "criterion": "Minimum CGPA",
                        "required": f">= {float(min_cgpa):.2f}",
                        "verified_value": "Undisclosed",
                        "status": "undisclosed",
                        "detail": "CGPA was not disclosed on the candidate's verified pass.",
                    }
                )

        max_bl = eligibility.get("max_backlogs")
        if max_bl is not None:
            if claims.get("active_backlogs") is not None and str(claims.get("active_backlogs")).strip() != "":
                v_bl = int(claims["active_backlogs"])
                ok = v_bl <= int(max_bl)
                elig_checks.append(
                    {
                        "criterion": "Maximum Active Backlogs",
                        "required": f"<= {int(max_bl)}",
                        "verified_value": str(v_bl),
                        "status": "passed" if ok else "failed",
                        "detail": f"Verified active backlogs ({v_bl}) {'within' if ok else 'exceeds'} limit ({int(max_bl)}).",
                    }
                )
            else:
                elig_checks.append(
                    {
                        "criterion": "Maximum Active Backlogs",
                        "required": f"<= {int(max_bl)}",
                        "verified_value": "Undisclosed",
                        "status": "undisclosed",
                        "detail": "Active backlogs were not disclosed on the candidate's verified pass.",
                    }
                )

        req_batch = eligibility.get("required_batch_year")
        if req_batch is not None:
            if claims.get("batch_year"):
                v_yr = int(claims["batch_year"])
                ok = v_yr == int(req_batch)
                elig_checks.append(
                    {
                        "criterion": "Required Batch Year",
                        "required": str(int(req_batch)),
                        "verified_value": str(v_yr),
                        "status": "passed" if ok else "failed",
                        "detail": f"Verified Batch {v_yr} {'matches' if ok else 'does not match'} required Batch {int(req_batch)}.",
                    }
                )
            else:
                elig_checks.append(
                    {
                        "criterion": "Required Batch Year",
                        "required": str(int(req_batch)),
                        "verified_value": "Undisclosed",
                        "status": "undisclosed",
                        "detail": "Batch year was not disclosed on the candidate's verified pass.",
                    }
                )

    has_mismatch = any(c["status"] == "mismatch" for c in checks)
    elig_active = bool(elig_checks)
    if not elig_active:
        elig_passed: bool | None = None
    elif any(e["status"] == "failed" for e in elig_checks):
        elig_passed = False
    elif any(e["status"] == "undisclosed" for e in elig_checks):
        elig_passed = None
    else:
        elig_passed = True

    return {
        "checks": checks,
        "has_mismatch": has_mismatch,
        "eligibility": {
            "active": elig_active,
            "passed": elig_passed,
            "checks": elig_checks,
        },
    }

