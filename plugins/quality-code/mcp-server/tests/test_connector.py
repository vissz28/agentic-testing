"""Claude's connector sign-in: registration, Entra, the rules page, the code, the tokens and /mcp."""
import base64
import dataclasses
import hashlib
import time
from urllib.parse import parse_qs, quote, urlencode, urlparse

import jwt
import pytest
from starlette.testclient import TestClient

from quality_code_mcp import connector, web
from quality_code_mcp.catalog import plugin_root
from quality_code_mcp.server import build
from test_entra import S

H = "https://qc-mcp.example.com"
SECRET = "s" * 40
CB = "https://claude.ai/api/mcp/auth_callback"
RULES = "Rule one.\n\nRule two."
CS = connector.ConnectorSettings(entra=S, secret=SECRET, rules=RULES, rules_version="v1")
W = web.WebSettings(entra=S, client_secret="shh", session_key="k" * 32)
CLAIMS = {"oid": "oid-1", "name": "Ada Lovelace", "preferred_username": "ada@teamsystem.com", "tid": S.tenant_id}


def pkce():
    verifier = "v" * 50
    return verifier, base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


@pytest.fixture
def c(tmp_path, monkeypatch):
    monkeypatch.setattr(web, "redeem_code", lambda w, code, verifier: "id-token")
    monkeypatch.setattr(web, "check_id_token", lambda w, tok, nonce, key: CLAIMS)
    s = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=CS)
    with TestClient(s.streamable_http_app(host="qc-mcp.example.com"), base_url=H, follow_redirects=False) as t:
        yield t


def register(c, uris=(CB,), method="none"):
    return c.post("/register", json={"redirect_uris": list(uris), "client_name": "Claude", "token_endpoint_auth_method": method,
                                     "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"]})


def start(c, client_id, challenge, state="st1"):
    q = urlencode({"client_id": client_id, "redirect_uri": CB, "response_type": "code", "code_challenge": challenge, "code_challenge_method": "S256", "state": state})
    r = c.get(f"/authorize?{q}")
    assert r.status_code == 302, r.text
    return r.headers["location"]


def through_entra(c, start_url):
    r = c.get(start_url.replace(H, ""))
    assert r.status_code == 303 and "oauth2/v2.0/authorize" in r.headers["location"]
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    r = c.get(f"/auth/callback?code=abc&state={state}")
    assert r.status_code == 303 and r.headers["location"] == "/connect/consent", r.headers
    return r


def csrf_of(c):
    html = c.get("/connect/consent").text
    return html.split('name="csrf" value="')[1].split('"')[0]


FORM = {"jira_email": "ada@teamsystem.com", "gitlab_username": "ada.l", "agree": "yes", "action": "accept"}


def full_flow(c):
    cid = register(c).json()["client_id"]
    verifier, challenge = pkce()
    through_entra(c, start(c, cid, challenge))
    r = c.post("/connect/accept", data={**FORM, "csrf": csrf_of(c)})
    assert r.status_code == 303, r.text
    loc = urlparse(r.headers["location"])
    assert f"{loc.scheme}://{loc.netloc}{loc.path}" == CB
    q = parse_qs(loc.query)
    assert q["state"] == ["st1"]
    return cid, verifier, q["code"][0]


def token(c, cid, verifier, code):
    return c.post("/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": CB, "client_id": cid, "code_verifier": verifier})


def test_registration_only_takes_claude_and_loopback_addresses(c):
    assert register(c).status_code == 201
    assert register(c, ("https://claude.com/api/mcp/auth_callback",)).status_code == 201
    assert register(c, ("http://localhost:33418/callback",)).status_code == 201
    for bad in ("https://evil.example.com/cb", "https://claude.ai.evil.com/api/mcp/auth_callback", "http://claude.ai/api/mcp/auth_callback", "http://localhost.evil.com:1/cb"):
        r = register(c, (bad,))
        assert r.status_code == 400 and r.json()["error"] == "invalid_redirect_uri", bad
    assert register(c, (CB, "https://evil.example.com/cb")).status_code == 400


def test_the_client_id_survives_a_restart_because_it_is_signed(c):
    cid = register(c).json()["client_id"]
    again = connector.ConnectorProvider(CS)
    import asyncio
    got = asyncio.run(again.get_client(cid))
    assert got and [str(u) for u in got.redirect_uris] == [CB]
    assert asyncio.run(again.get_client(cid + "x")) is None
    assert asyncio.run(connector.ConnectorProvider(connector.ConnectorSettings(S, "o" * 40, RULES, "v1")).get_client(cid)) is None


def test_the_whole_flow_ends_with_a_token_that_names_the_person(c):
    cid, verifier, code = full_flow(c)
    r = token(c, cid, verifier, code)
    assert r.status_code == 200, r.text
    tok = r.json()
    claims = jwt.decode(tok["access_token"], SECRET, algorithms=["HS256"], audience=H)
    assert claims["id"] == {"oid": "oid-1", "name": "Ada Lovelace", "email": "ada@teamsystem.com", "jira_email": "ada@teamsystem.com", "gitlab_username": "ada.l", "rules": "v1"}
    assert tok["refresh_token"] and tok["expires_in"] == 3600
    # /mcp accepts it; without a token it still says 401
    assert c.post("/mcp", json={}).status_code == 401
    init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}
    r = c.post("/mcp", json=init, headers={"Authorization": f"Bearer {tok['access_token']}", "Accept": "application/json, text/event-stream"})
    assert r.status_code == 200 and "quality-code" in r.text


def test_a_code_works_once_and_needs_the_right_pkce_verifier(c):
    cid, verifier, code = full_flow(c)
    assert token(c, cid, "w" * 50, code).status_code == 400
    assert token(c, cid, verifier, code).status_code == 200
    assert token(c, cid, verifier, code).status_code == 400


def test_the_refresh_token_gives_a_new_access_token_for_the_same_person(c):
    cid, verifier, code = full_flow(c)
    tok = token(c, cid, verifier, code).json()
    r = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": cid})
    assert r.status_code == 200, r.text
    assert jwt.decode(r.json()["access_token"], SECRET, algorithms=["HS256"], audience=H)["id"]["oid"] == "oid-1"


def test_cancel_sends_access_denied_back_to_claude_and_no_code(c):
    cid = register(c).json()["client_id"]
    _, challenge = pkce()
    through_entra(c, start(c, cid, challenge))
    r = c.post("/connect/accept", data={"csrf": csrf_of(c), "action": "cancel"})
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert r.headers["location"].startswith(CB) and q["error"] == ["access_denied"] and "code" not in q and q["state"] == ["st1"]


def test_the_form_needs_the_csrf_the_rules_and_valid_details(c):
    cid = register(c).json()["client_id"]
    _, challenge = pkce()
    through_entra(c, start(c, cid, challenge))
    good = csrf_of(c)
    assert c.post("/connect/accept", data={**FORM, "csrf": "wrong"}).status_code == 400
    assert c.post("/connect/accept", data={**FORM, "csrf": good, "agree": ""}).status_code == 400
    assert "valid Jira email" in c.post("/connect/accept", data={**FORM, "csrf": good, "jira_email": "nope"}).text
    assert "GitLab username" in c.post("/connect/accept", data={**FORM, "csrf": good, "gitlab_username": "a b;c"}).text
    assert c.post("/connect/accept", data={**FORM, "csrf": good}).status_code == 303  # still possible after the mistakes


def test_the_page_shows_the_rules_and_the_name_from_entra_and_escapes_them(tmp_path, monkeypatch):
    monkeypatch.setattr(web, "redeem_code", lambda w, code, verifier: "id-token")
    monkeypatch.setattr(web, "check_id_token", lambda w, tok, nonce, key: {**CLAIMS, "name": "<script>x</script>"})
    s = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=CS)
    with TestClient(s.streamable_http_app(host="qc-mcp.example.com"), base_url=H, follow_redirects=False) as t:
        cid = register(t).json()["client_id"]
        through_entra(t, start(t, cid, pkce()[1]))
        html = t.get("/connect/consent").text
    assert "Rule one." in html and "Rule two." in html and "ada@teamsystem.com" in html
    assert "<script>x</script>" not in html and "&lt;script&gt;" in html


def test_without_a_connect_request_the_pages_say_it_expired(c):
    assert c.get("/connect/consent").status_code == 400
    assert c.get("/connect/start?tx=forged").status_code == 400
    assert c.post("/connect/accept", data={**FORM, "csrf": "x"}).status_code == 400


def test_a_token_signed_with_another_key_or_expired_is_refused(c):
    old = jwt.encode({"typ": "access", "iss": H, "aud": H, "cid": "x", "exp": int(time.time()) - 5, "id": {}}, SECRET, algorithm="HS256")
    forged = jwt.encode({"typ": "access", "iss": H, "aud": H, "cid": "x", "exp": int(time.time()) + 60, "id": {}}, "z" * 40, algorithm="HS256")
    for t in (old, forged, "garbage"):
        assert c.post("/mcp", json={}, headers={"Authorization": f"Bearer {t}"}).status_code == 401


def test_the_secret_must_be_long_enough_and_the_rules_change_the_version(tmp_path):
    assert connector.settings_from_env(S, {}) is None
    with pytest.raises(connector.ConnectorConfigError):
        connector.settings_from_env(S, {"QUALITY_CODE_TOKEN_SECRET": "short"})
    f = tmp_path / "r.md"
    f.write_text("one")
    a = connector.settings_from_env(S, {"QUALITY_CODE_TOKEN_SECRET": SECRET, "QUALITY_CODE_RULES_FILE": str(f)})
    f.write_text("two")
    b = connector.settings_from_env(S, {"QUALITY_CODE_TOKEN_SECRET": SECRET, "QUALITY_CODE_RULES_FILE": str(f)})
    assert a.rules == "one" and a.rules_version != b.rules_version


def test_the_site_login_still_goes_home_and_the_old_entra_path_stays(c):
    r = c.get("/login")
    assert r.status_code == 303 and "oauth2/v2.0/authorize" in r.headers["location"]


def test_the_metadata_names_this_server_as_the_authorization_server(c):
    meta = c.get("/.well-known/oauth-authorization-server").json()
    assert meta["issuer"] == H and meta["registration_endpoint"] == H + "/register" and meta["authorization_endpoint"] == H + "/authorize" and meta["token_endpoint"] == H + "/token"
    assert "S256" in meta["code_challenge_methods_supported"]
    prm = c.get("/.well-known/oauth-protected-resource").json()
    assert prm["authorization_servers"] == [H + "/"] or prm["authorization_servers"] == [H]


def test_health_says_the_connector_is_on(c):
    h = c.get("/health").json()
    assert h["status"] == "ok" and h["connector"] is True and h["version"]


def server(tmp_path, monkeypatch, cs=CS, claims=CLAIMS):
    monkeypatch.setattr(web, "redeem_code", lambda w, code, verifier: "id-token")
    monkeypatch.setattr(web, "check_id_token", lambda w, tok, nonce, key: claims)
    s = build(plugin_root(), entra=cs.entra, remote=True, fixed_cwd=tmp_path, web_settings=dataclasses.replace(W, entra=cs.entra), connector=cs)
    return TestClient(s.streamable_http_app(host="qc-mcp.example.com"), base_url=H, follow_redirects=False)


ROLE = dataclasses.replace(S, required_scope="QualityCode.Use")


def test_the_required_role_is_checked_on_the_connector_sign_in(tmp_path, monkeypatch):
    cs = dataclasses.replace(CS, entra=ROLE)
    with server(tmp_path, monkeypatch, cs) as t:  # signed in with Microsoft, but without the app role
        cid = register(t).json()["client_id"]
        r = t.get(start(t, cid, pkce()[1]).replace(H, ""))
        state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
        r = t.get(f"/auth/callback?code=abc&state={state}")
        assert r.status_code == 403 and "QualityCode.Use" in r.text and "qc_connect=" not in r.headers.get("set-cookie", "")
        assert t.get("/connect/consent").status_code == 400
    with server(tmp_path, monkeypatch, cs, {**CLAIMS, "roles": ["QualityCode.Use"]}) as t:
        cid, verifier, code = full_flow(t)
        assert token(t, cid, verifier, code).status_code == 200


def refresh(c, cid, rt):
    return c.post("/token", data={"grant_type": "refresh_token", "refresh_token": rt, "client_id": cid})


def test_a_refresh_after_the_rules_changed_asks_to_connect_again(tmp_path, monkeypatch):
    with server(tmp_path, monkeypatch) as t:
        cid, verifier, code = full_flow(t)
        rt = token(t, cid, verifier, code).json()["refresh_token"]
    with server(tmp_path, monkeypatch, dataclasses.replace(CS, rules_version="v2")) as t:
        r = refresh(t, cid, rt)
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant" and "rules" in r.json()["error_description"]


def test_a_refresh_after_a_role_became_required_asks_to_connect_again(tmp_path, monkeypatch):
    with server(tmp_path, monkeypatch) as t:
        cid, verifier, code = full_flow(t)
        rt = token(t, cid, verifier, code).json()["refresh_token"]
    with server(tmp_path, monkeypatch, dataclasses.replace(CS, entra=ROLE)) as t:
        r = refresh(t, cid, rt)
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant" and "QualityCode.Use" in r.json()["error_description"]


def test_the_refresh_chain_ends_a_fixed_time_after_the_microsoft_sign_in(c, monkeypatch):
    cid, verifier, code = full_flow(c)
    first = token(c, cid, verifier, code).json()["refresh_token"]
    since = jwt.decode(first, SECRET, algorithms=["HS256"], audience=H)["since"]
    real = time.time
    monkeypatch.setattr(connector.time, "time", lambda: real() + connector.SESSION_MAX - 3600)  # near the end: the chain still works, but not past its end
    r = refresh(c, cid, first)
    assert r.status_code == 200, r.text
    new = jwt.decode(r.json()["refresh_token"], SECRET, algorithms=["HS256"], audience=H, options={"verify_exp": False, "verify_iat": False})
    assert new["since"] == since and new["exp"] <= since + connector.SESSION_MAX
    monkeypatch.setattr(connector.time, "time", lambda: real() + connector.SESSION_MAX + 60)
    r = refresh(c, cid, first)
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"


def test_an_upstream_callback_on_another_replica_says_so_instead_of_expired(tmp_path, monkeypatch):
    from test_atlassian import KEY, SITE, FakeAtlassian
    from quality_code_mcp import atlassian

    cs = dataclasses.replace(CS, vault_key=KEY, atlassian=atlassian.AtlassianSettings("aid", "asecret", site=SITE, http=FakeAtlassian()))
    with server(tmp_path, monkeypatch, cs) as a, server(tmp_path, monkeypatch, cs) as b:  # two replicas (or one restarted) with the same settings
        cid = register(a).json()["client_id"]
        through_entra(a, start(a, cid, pkce()[1]))
        r = a.post("/connect/accept", data={**FORM, "csrf": csrf_of(a)})
        state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
        b.cookies.update(a.cookies)
        r = b.get(f"/connect/atlassian/callback?code=acode&state={state}")
    assert r.status_code == 409 and "another copy of the server" in r.text and "expired" not in r.text
