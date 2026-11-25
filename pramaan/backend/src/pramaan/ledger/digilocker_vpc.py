"""DigiLocker Verified Parental Consent (VPC) OAuth 2.0 + RFC 7636 PKCE Bridge.

Implements DPDP Act 2023 Section 9 & DPDP Rules 2025 Rule 10 verifiable guardian
consent using OAuth 2.0 Authorization Code flow with S256 PKCE code challenges
and HMAC-SHA256 signed state tokens.

Requires `PRAMAAN_DIGILOCKER_CLIENT_ID` for production MeriPehchaan OAuth 2.0
verification. Local PKCE round-trip without client credentials is disabled by
default unless explicitly opted in (`allow_sandbox=True`) in offline unit tests.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import secrets
import urllib.parse
from dataclasses import dataclass

import httpx

from pramaan.ledger.keyring import b64u_decode, b64u_encode

DIGILOCKER_AUTHORIZE_ENDPOINT = "https://digilocker.meripehchaan.gov.in/public/oauth2/1/authorize"
DIGILOCKER_TOKEN_ENDPOINT = "https://digilocker.meripehchaan.gov.in/public/oauth2/1/token"


def compute_pkce_s256_challenge(code_verifier: str) -> str:
    """Compute RFC 7636 S256 `code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`."""
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return b64u_encode(digest)


@dataclass(frozen=True, slots=True)
class DigiLockerPkceChallenge:
    consent_id: str
    student_prn: str
    guardian_username: str
    state: str
    code_verifier: str
    code_challenge: str
    code_challenge_method: str
    authorize_url: str
    mode: str
    issued_at: str


@dataclass(frozen=True, slots=True)
class DigiLockerVerificationReceipt:
    verified: bool
    consent_id: str
    student_prn: str
    guardian_username: str
    tx_id: str
    verified_at: str
    mode: str
    code_challenge_s256: str
    issuer: str


def create_digilocker_pkce_challenge(
    *,
    consent_id: str,
    student_prn: str,
    guardian_username: str,
    secret_key: str,
    client_id: str = "",
    redirect_uri: str = "http://localhost:8000/api/portals/consents/digilocker-callback",
    allow_sandbox: bool = False,
) -> DigiLockerPkceChallenge:
    """Create an OAuth 2.0 + S256 PKCE challenge and HMAC-signed state token."""
    clean_client_id = client_id.strip()
    if not clean_client_id and not allow_sandbox:
        raise ValueError("DigiLocker OAuth client_id is not configured (set PRAMAAN_DIGILOCKER_CLIENT_ID)")
    code_verifier = b64u_encode(secrets.token_bytes(32))
    code_challenge = compute_pkce_s256_challenge(code_verifier)
    issued_at = dt.datetime.now(dt.UTC).isoformat()
    mode = "live_digilocker_oauth2" if clean_client_id else "sandbox_pkce_local"

    state_body = b64u_encode(
        json.dumps(
            {
                "cid": consent_id,
                "prn": student_prn,
                "g": guardian_username,
                "cc": code_challenge,
                "m": mode,
                "at": issued_at,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    sig = b64u_encode(
        hmac.new(
            hashlib.sha256(f"digilocker-vpc:{secret_key}".encode()).digest(),
            state_body.encode("ascii"),
            hashlib.sha256,
        ).digest()
    )
    state = f"{state_body}.{sig}"

    effective_client_id = clean_client_id or "pramaan-sandbox-meripehchaan"
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": effective_client_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "scope": "openid profile digilocker.parental_consent",
        }
    )
    return DigiLockerPkceChallenge(
        consent_id=consent_id,
        student_prn=student_prn,
        guardian_username=guardian_username,
        state=state,
        code_verifier=code_verifier,
        code_challenge=code_challenge,
        code_challenge_method="S256",
        authorize_url=f"{DIGILOCKER_AUTHORIZE_ENDPOINT}?{query}",
        mode=mode,
        issued_at=issued_at,
    )


def verify_digilocker_pkce_callback(
    *,
    state: str,
    code_verifier: str,
    secret_key: str,
    max_age_seconds: int = 600,
    authorization_code: str | None = None,
    client_id: str = "",
    client_secret: str = "",
    redirect_uri: str = "http://localhost:8000/api/portals/consents/digilocker-callback",
    allow_sandbox: bool = False,
) -> DigiLockerVerificationReceipt:
    """Verify HMAC-signed OAuth state, expiry TTL, RFC 7636 S256 PKCE match, and live token exchange."""
    if "." not in state:
        raise ValueError("Malformed DigiLocker OAuth state parameter")
    state_body, provided_sig = state.split(".", 1)
    expected_sig = b64u_encode(
        hmac.new(
            hashlib.sha256(f"digilocker-vpc:{secret_key}".encode()).digest(),
            state_body.encode("ascii"),
            hashlib.sha256,
        ).digest()
    )
    if not hmac.compare_digest(provided_sig, expected_sig):
        raise ValueError("DigiLocker OAuth state HMAC signature verification failed")

    payload = json.loads(b64u_decode(state_body).decode("utf-8"))
    issued_raw = str(payload.get("at") or "")
    try:
        issued_dt = dt.datetime.fromisoformat(issued_raw)
        if issued_dt.tzinfo is None:
            issued_dt = issued_dt.replace(tzinfo=dt.UTC)
    except ValueError as exc:
        raise ValueError("Malformed DigiLocker OAuth state timestamp") from exc
    age_s = (dt.datetime.now(dt.UTC) - issued_dt).total_seconds()
    if age_s > max_age_seconds or age_s < -30:
        raise ValueError("DigiLocker OAuth state expired")

    expected_challenge = str(payload.get("cc") or "")
    recomputed_challenge = compute_pkce_s256_challenge(code_verifier)
    if not expected_challenge or not hmac.compare_digest(expected_challenge, recomputed_challenge):
        raise ValueError("RFC 7636 PKCE S256 code_verifier does not match state code_challenge")

    consent_id = str(payload["cid"])
    student_prn = str(payload["prn"])
    guardian_username = str(payload["g"])
    mode = str(payload.get("m") or "live_digilocker_oauth2")
    if mode != "live_digilocker_oauth2" and not allow_sandbox:
        raise ValueError("Sandbox DigiLocker verification is disabled")
    if mode == "live_digilocker_oauth2":
        if not client_id.strip():
            raise ValueError("DigiLocker OAuth client_id is not configured")
        if not authorization_code:
            raise ValueError("Live DigiLocker OAuth2 verification requires authorization code")
        token_form = {
            "grant_type": "authorization_code",
            "code": authorization_code,
            "redirect_uri": redirect_uri,
            "client_id": client_id.strip(),
            "code_verifier": code_verifier,
        }
        if client_secret.strip():
            token_form["client_secret"] = client_secret.strip()
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(DIGILOCKER_TOKEN_ENDPOINT, data=token_form)
                resp.raise_for_status()
        except Exception as exc:
            raise ValueError(f"DigiLocker token exchange failed: {exc}") from exc

    verified_at = dt.datetime.now(dt.UTC).isoformat()
    tx_digest = hashlib.sha256(
        f"{consent_id}|{student_prn}|{guardian_username}|{recomputed_challenge}|{verified_at}".encode()
    ).hexdigest()[:12].upper()

    return DigiLockerVerificationReceipt(
        verified=True,
        consent_id=consent_id,
        student_prn=student_prn,
        guardian_username=guardian_username,
        tx_id=f"DL-VPC-{tx_digest}",
        verified_at=verified_at,
        mode=mode,
        code_challenge_s256=recomputed_challenge,
        issuer="did:gov:in:digilocker:meripehchaan" if mode == "live_digilocker_oauth2" else "urn:pramaan:digilocker-pkce-sandbox",
    )
