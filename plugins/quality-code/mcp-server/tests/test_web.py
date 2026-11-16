import time
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from starlette.testclient import TestClient

from quality_code_mcp import web
from quality_code_mcp.catalog import plugin_root
from quality_code_mcp.server import build
from test_entra import S

W = web.WebSettings(entra=S, client_secret="shh", session_key="k" * 32)
H = "https://qc-mcp.example.com"


def client(w=W, tmp=None):
    s = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp, web_settings=w)
    return TestClient(s.streamable_http_app(host="qc-mcp.example.com"), base_url=H, follow_redirects=False)


def test_login_page_is_open_and_shows_microsoft(tmp_path):
    with client(tmp=tmp_path) as c:
        r = c.get("/")
    assert r.status_code == 200 and "Sign in with Microsoft" in r.text and "Quality Code" in r.text


def test_not_configured_says_so_and_login_goes_home(tmp_path):
    with client(w=None, tmp=tmp_path) as c:
        assert "QUALITY_CODE_ENTRA_CLIENT_SECRET" in c.get("/").text
        assert c.get("/login").headers["location"] == "/"


def test_login_redirects_to_microsoft_with_pkce_and_a_flow_cookie(tmp_path):
    with client(tmp=tmp_path) as c:
        r = c.get("/login")
    loc = urlparse(r.headers["location"])
    q = parse_qs(loc.query)
    assert loc.path.endswith(f"/{S.tenant_id}/oauth2/v2.0/authorize")
    assert q["client_id"] == [S.client_id] and q["code_challenge_method"] == ["S256"] and q["redirect_uri"] == [H + "/auth/callback"]
    assert "qc_flow=" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"]


def test_callback_without_a_flow_or_with_a_wrong_state_goes_back_with_an_error(tmp_path):
    with client(tmp=tmp_path) as c:
        assert "error=" in c.get("/auth/callback?code=x&state=y").headers["location"]
        flow = web._sign(W, {"kind": "flow", "state": "right", "nonce": "n", "verifier": "v"}, 60)
        c.cookies.set("qc_flow", flow)
        assert "error=" in c.get("/auth/callback?code=x&state=wrong").headers["location"]


def test_session_cookie_shows_the_connect_view_and_logout_clears_it(tmp_path):
    with client(tmp=tmp_path) as c:
        c.cookies.set("qc_session", web._sign(W, {"kind": "session", "name": "Ada Lovelace", "email": "ada@teamsystem.com"}, 60))
        h = c.get("/").text
        assert "Ada Lovelace" in h and H + "/mcp" in h and "claude mcp add" in h
        assert c.get("/logout").status_code == 303
        c.cookies.clear()
        assert "Sign in with Microsoft" in c.get("/").text


def test_a_forged_or_flow_cookie_is_not_a_session(tmp_path):
    with client(tmp=tmp_path) as c:
        c.cookies.set("qc_session", jwt.encode({"kind": "session", "name": "x", "exp": int(time.time()) + 60}, "wrong-key" * 4, algorithm="HS256"))
        assert "Sign in with Microsoft" in c.get("/").text
        c.cookies.set("qc_session", web._sign(W, {"kind": "flow"}, 60))
        assert "Sign in with Microsoft" in c.get("/").text


def test_id_token_needs_signature_tenant_nonce_and_audience():
    from cryptography.hazmat.primitives.asymmetric import rsa

    pair = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key = lambda t: pair.public_key()  # noqa: E731
    base = {"iss": S.issuers[0], "aud": S.client_id, "tid": S.tenant_id, "nonce": "n", "exp": int(time.time()) + 60, "name": "A"}
    enc = lambda c, k=pair: jwt.encode(c, k, algorithm="RS256")  # noqa: E731
    assert web.check_id_token(W, enc(base), "n", key)["name"] == "A"
    for bad in (enc(base, other), enc({**base, "tid": "other"}), enc({**base, "aud": "someone-else"}), enc({**base, "exp": int(time.time()) - 5})):
        with pytest.raises(jwt.PyJWTError):
            web.check_id_token(W, bad, "n", key)
    with pytest.raises(jwt.PyJWTError):
        web.check_id_token(W, enc(base), "wrong-nonce", key)


def test_logo_is_served(tmp_path):
    with client(tmp=tmp_path) as c:
        r = c.get("/static/teamsystem.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"


def test_the_connect_view_explains_the_claude_web_connector(tmp_path):
    with client(tmp=tmp_path) as c:
        c.cookies.set("qc_session", web._sign(W, {"kind": "session", "name": "Ada Lovelace", "email": "ada@teamsystem.com"}, 60))
        h = c.get("/").text
    assert "Claude (web &amp; Desktop)" in h and "Add custom connector" in h and "Register automatically" in h and "Sign in now" in h


def test_the_icon_is_served_for_claude_and_the_browser_and_named_in_the_server_info(tmp_path):
    with client(tmp=tmp_path) as c:
        for path in ("/static/quality-code.png", "/favicon.ico", "/favicon.png"):
            r = c.get(path)
            assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content[:4] == b"\x89PNG", path
        c.cookies.set("qc_session", web._sign(W, {"kind": "session", "name": "Ada", "email": "a@teamsystem.com"}, 60))
        assert "/plugin install quality-code@teamsystem" in c.get("/").text and "/plugin marketplace add vissz28/agentic-testing" in c.get("/").text
    s = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W)
    assert [i.src for i in s.icons] == [H + "/static/quality-code.png"]


def browser_client(tmp):
    s = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp, web_settings=W)
    app = web.add_browser_redirect(s.streamable_http_app(host="qc-mcp.example.com"), W)
    return TestClient(app, base_url=H, follow_redirects=False)


HTML = {"Accept": "text/html,application/xhtml+xml"}


def test_a_browser_on_the_mcp_address_goes_to_the_sign_in_or_the_home_page(tmp_path):
    with browser_client(tmp_path) as c:
        assert (c.get("/mcp", headers=HTML).status_code, c.get("/mcp", headers=HTML).headers["location"]) == (303, "/login")
        c.cookies.set("qc_session", web._sign(W, {"kind": "session", "name": "Ada", "email": "a@teamsystem.com"}, 60))
        r = c.get("/mcp", headers=HTML)
        assert r.status_code == 303 and r.headers["location"] == "/"


def test_mcp_clients_still_get_401_and_the_web_session_is_not_a_credential(tmp_path):
    with browser_client(tmp_path) as c:
        c.cookies.set("qc_session", web._sign(W, {"kind": "session", "name": "Ada", "email": "a@teamsystem.com"}, 60))
        assert c.post("/mcp", json={}, headers=HTML).status_code == 401  # only a GET is redirected
        assert c.post("/mcp", json={}).status_code == 401  # the cookie does not open /mcp
        assert c.get("/mcp", headers={"Accept": "text/event-stream"}).status_code == 401
        assert c.get("/mcp").status_code == 401
