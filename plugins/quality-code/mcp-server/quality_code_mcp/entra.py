"""Microsoft Entra ID verification for the HTTP transport: only a valid access token for this server gets in."""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any, Callable

import jwt
from mcp.server.auth.provider import AccessToken

AUTHORITY = "https://login.microsoftonline.com"


class EntraConfigError(ValueError):
    pass


@dataclass(frozen=True)
class EntraSettings:
    tenant_id: str
    client_id: str  # the app registration of this server (its Application (client) ID)
    public_url: str  # where clients reach this server, for example https://qc-mcp.example.com
    required_scope: str | None = None  # a delegated scope (scp) or an app role (roles) the token must carry

    @property
    def issuers(self) -> list[str]:
        # v2.0 tokens and v1.0 tokens carry different issuers.
        return [f"{AUTHORITY}/{self.tenant_id}/v2.0", f"https://sts.windows.net/{self.tenant_id}/"]

    @property
    def audiences(self) -> list[str]:
        # An app can ask for api://<client id> or the bare client id.
        return [self.client_id, f"api://{self.client_id}"]

    @property
    def jwks_uri(self) -> str:
        return f"{AUTHORITY}/{self.tenant_id}/discovery/v2.0/keys"

    @property
    def issuer_url(self) -> str:
        return f"{AUTHORITY}/{self.tenant_id}/v2.0"


def settings_from_env(env: dict[str, str] | None = None) -> EntraSettings:
    env = os.environ if env is None else env
    need = {"QUALITY_CODE_ENTRA_TENANT_ID": "tenant_id", "QUALITY_CODE_ENTRA_CLIENT_ID": "client_id", "QUALITY_CODE_PUBLIC_URL": "public_url"}
    missing = [k for k in need if not env.get(k)]
    if missing:
        raise EntraConfigError("Entra ID needs " + ", ".join(missing) + " (the tenant, the app registration's client ID, and the public address of this server).")
    got = {v: env[k].strip() for k, v in need.items()}
    if not got["public_url"].startswith(("https://", "http://localhost", "http://127.0.0.1")):
        raise EntraConfigError("QUALITY_CODE_PUBLIC_URL must be an https:// address (http only for localhost).")
    return EntraSettings(**got, required_scope=(env.get("QUALITY_CODE_ENTRA_REQUIRED_SCOPE") or "").strip() or None)


class EntraTokenVerifier:
    """Checks a bearer token: signature (the tenant's published keys), issuer, tenant, audience, expiry, and the required scope or role."""

    def __init__(self, settings: EntraSettings, signing_key: Callable[[str], Any] | None = None):
        self.s = settings
        # signing_key(token) -> key. By default the tenant's published keys, fetched and cached by PyJWT.
        if signing_key is None:
            client = jwt.PyJWKClient(settings.jwks_uri, cache_keys=True)
            signing_key = lambda t: client.get_signing_key_from_jwt(t).key  # noqa: E731
        self._signing_key = signing_key

    def _verify(self, token: str) -> AccessToken | None:
        try:
            key = self._signing_key(token)
            claims = jwt.decode(
                token, key, algorithms=["RS256"], audience=self.s.audiences, issuer=self.s.issuers,
                options={"require": ["exp", "iss", "aud"]},
            )
        except jwt.PyJWTError:
            return None
        if claims.get("tid") != self.s.tenant_id:
            return None
        scopes = str(claims.get("scp", "")).split() + list(claims.get("roles", []))
        if self.s.required_scope and self.s.required_scope not in scopes:
            return None
        aud = claims["aud"]
        aud = aud if isinstance(aud, str) else next(a for a in aud if a in self.s.audiences)
        return AccessToken(
            token=token, client_id=str(claims.get("azp") or claims.get("appid") or ""), scopes=scopes,
            expires_at=int(claims["exp"]), resource=aud, subject=claims.get("oid") or claims.get("sub"),
            claims={"iss": claims["iss"], "tid": claims["tid"], "upn": claims.get("preferred_username") or claims.get("upn")},
        )

    async def verify_token(self, token: str) -> AccessToken | None:
        # The key fetch is a blocking HTTP call the first time: keep it off the event loop.
        return await asyncio.to_thread(self._verify, token)
