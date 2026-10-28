import asyncio
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from starlette.testclient import TestClient

from quality_code_mcp.catalog import plugin_root
from quality_code_mcp.entra import EntraConfigError, EntraSettings, EntraTokenVerifier, settings_from_env
from quality_code_mcp.server import build

TENANT, CLIENT = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
S = EntraSettings(TENANT, CLIENT, "https://qc-mcp.example.com")
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def token(key=KEY, **over):
    c = {"iss": f"https://login.microsoftonline.com/{TENANT}/v2.0", "aud": f"api://{CLIENT}", "tid": TENANT, "exp": int(time.time()) + 600,
         "scp": "access_as_user", "azp": "client-app", "oid": "user-1", "preferred_username": "e.zefaj@teamsystem.com"}
    c.update(over)
    return jwt.encode({k: v for k, v in c.items() if v is not None}, key, algorithm="RS256", headers={"kid": "k1"})


def verifier(settings=S):
    return EntraTokenVerifier(settings, signing_key=lambda t: KEY.public_key())


def check(t, settings=S):
    return asyncio.run(verifier(settings).verify_token(t))


def test_valid_token_is_accepted_with_who_and_scopes():
    a = check(token())
    assert a and a.subject == "user-1" and a.scopes == ["access_as_user"] and a.client_id == "client-app"
    assert a.claims["upn"] == "e.zefaj@teamsystem.com"


def test_bare_client_id_audience_and_v1_issuer_are_accepted():
    assert check(token(aud=CLIENT))
    assert check(token(iss=f"https://sts.windows.net/{TENANT}/"))


@pytest.mark.parametrize("over", [
    {"aud": "api://someone-else"},
    {"iss": "https://login.microsoftonline.com/other-tenant/v2.0"},
    {"tid": "other-tenant"},
    {"exp": int(time.time()) - 10},
    {"exp": None},
])
def test_wrong_claims_are_refused(over):
    assert check(token(**over)) is None


def test_token_signed_by_another_key_is_refused():
    assert check(token(key=OTHER)) is None


def test_garbage_and_unsigned_tokens_are_refused():
    assert check("not a token") is None
    assert check(jwt.encode({"aud": CLIENT}, None, algorithm="none")) is None


def test_required_scope_or_role():
    s = EntraSettings(TENANT, CLIENT, S.public_url, required_scope="QualityCode.Use")
    assert check(token(), s) is None
    assert check(token(scp="QualityCode.Use"), s)
    assert check(token(scp=None, roles=["QualityCode.Use"]), s)


def test_settings_from_env():
    ok = {"QUALITY_CODE_ENTRA_TENANT_ID": TENANT, "QUALITY_CODE_ENTRA_CLIENT_ID": CLIENT, "QUALITY_CODE_PUBLIC_URL": "https://x.example.com", "QUALITY_CODE_ENTRA_REQUIRED_SCOPE": " s "}
    assert settings_from_env(ok).required_scope == "s"
    with pytest.raises(EntraConfigError, match="QUALITY_CODE_ENTRA_TENANT_ID"):
        settings_from_env({k: v for k, v in ok.items() if k != "QUALITY_CODE_ENTRA_TENANT_ID"})
    with pytest.raises(EntraConfigError, match="https"):
        settings_from_env({**ok, "QUALITY_CODE_PUBLIC_URL": "http://evil.example.com"})


def test_http_endpoint_refuses_without_a_valid_token():
    app = build(plugin_root(), entra=S, verifier=verifier()).streamable_http_app(host="qc-mcp.example.com")
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}
    hdr = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    with TestClient(app, base_url="https://qc-mcp.example.com") as c:
        none = c.post("/mcp", json=init, headers=hdr)
        bad = c.post("/mcp", json=init, headers={**hdr, "Authorization": "Bearer " + token(key=OTHER)})
        good = c.post("/mcp", json=init, headers={**hdr, "Authorization": "Bearer " + token()})
    assert none.status_code == 401 and "www-authenticate" in none.headers
    assert bad.status_code == 401
    assert good.status_code == 200 and "quality-code" in good.text
