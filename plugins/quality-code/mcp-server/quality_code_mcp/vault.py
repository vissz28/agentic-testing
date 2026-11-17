"""Seals a person's Atlassian tokens so they can ride inside the connector tokens: nothing is stored on the server.

AES-256-GCM with a key derived from QUALITY_CODE_TOKEN_KEY. The sealed text is opaque to Claude; only this server can open it. Rotating the key
ends every Atlassian link at once (people sign in again)."""
from __future__ import annotations

import base64
import hashlib
import json
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MIN_KEY = 32
PREFIX = "v1."


class VaultError(ValueError):
    pass


def key_from_env(env: dict[str, str]) -> bytes | None:
    raw = (env.get("QUALITY_CODE_TOKEN_KEY") or "").strip()
    if not raw:
        return None
    if len(raw) < MIN_KEY:
        raise VaultError(f"QUALITY_CODE_TOKEN_KEY must be at least {MIN_KEY} characters (use 32 random bytes, for example openssl rand -base64 32).")
    return hashlib.sha256(b"quality-code/vault/" + raw.encode()).digest()


def seal(key: bytes, data: dict, aad: str = "") -> str:
    nonce = os.urandom(12)
    blob = AESGCM(key).encrypt(nonce, json.dumps(data, separators=(",", ":")).encode(), aad.encode())
    return PREFIX + base64.urlsafe_b64encode(nonce + blob).rstrip(b"=").decode()


def unseal(key: bytes, sealed: str | None, aad: str = "") -> dict | None:
    """The data, or None when the text is missing, altered, for another person (aad) or sealed with another key."""
    if not sealed or not sealed.startswith(PREFIX):
        return None
    try:
        raw = base64.urlsafe_b64decode(sealed[len(PREFIX):] + "=" * (-len(sealed[len(PREFIX):]) % 4))
        return json.loads(AESGCM(key).decrypt(raw[:12], raw[12:], aad.encode()))
    except (InvalidTag, ValueError):
        return None
