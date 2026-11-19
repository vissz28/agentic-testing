"""The server reads GitLab (Biosphere) merge requests as the signed-in person: GitLab sign-in in the connector flow, sealed tokens, read-only tools."""
import asyncio
import json
import time
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from starlette.testclient import TestClient

from quality_code_mcp import atlassian, connector, gitlab, vault, web
from quality_code_mcp.catalog import plugin_root
from quality_code_mcp.server import build
from test_connector import CB, CLAIMS, FORM, H, SECRET, W, csrf_of, pkce, register, start, through_entra, token
from test_entra import S

KEY = vault.key_from_env({"QUALITY_CODE_TOKEN_KEY": "k" * 40})
HOST = "https://biosphere.teamsystem.com"
API = HOST + "/api/v4"
MR = f"{HOST}/team/sub/app/-/merge_requests/7"


class FakeGitLab:
    """The GitLab host, answering what it answers, and remembering what was asked."""

    def __init__(self):
        self.calls, self.n = [], 0

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, body))
        if url == f"{HOST}/oauth/token":
            self.n += 1
            assert body["client_secret"] == "gsecret" and body["client_id"] == "gid"
            if body["grant_type"] == "refresh_token" and body["refresh_token"] != f"rt{self.n - 1}":
                raise gitlab.GitLabError("GitLab answered 400")
            return {"access_token": f"at{self.n}", "refresh_token": f"rt{self.n}", "expires_in": 7200}
        if url == f"{API}/user":
            return {"username": "ada", "name": "Ada", "email": "ada@teamsystem.com"}
        if url.endswith("/projects/team%2Fsub%2Fapp"):
            return {"path_with_namespace": "team/sub/app", "name": "app", "default_branch": "main", "visibility": "private", "web_url": f"{HOST}/team/sub/app"}
        if url.endswith("/merge_requests/7"):
            return {"title": "Add it", "state": "opened", "author": {"username": "ada"}, "source_branch": "feat", "target_branch": "main", "description": "Because", "labels": ["x"], "sha": "abc"}
        if "/merge_requests/7/diffs" in url:
            return [{"new_path": "a.py", "old_path": "a.py", "diff": "+1"}, {"new_path": "b.py", "old_path": "c.py", "renamed_file": True, "diff": "+2"}]
        raise AssertionError(url)


class FakeAtl:
    def __call__(self, method, url, headers, body):
        if url.endswith("/oauth/token"):
            return {"access_token": "atl1", "refresh_token": "atlr1", "expires_in": 3600}
        return [{"id": "cloud-1", "url": "https://example.atlassian.net"}]


@pytest.fixture
def fake():
    return FakeGitLab()


@pytest.fixture
def gs(fake):
    return gitlab.GitLabSettings("gid", "gsecret", http=fake)


@pytest.fixture
def cs(gs):
    return connector.ConnectorSettings(entra=S, secret=SECRET, rules="Rule.", rules_version="v1", vault_key=KEY, gitlab=gs)


@pytest.fixture
def c(tmp_path, monkeypatch, cs):
    monkeypatch.setattr(web, "redeem_code", lambda w, code, verifier: "id-token")
    monkeypatch.setattr(web, "check_id_token", lambda w, tok, nonce, key: CLAIMS)
    s = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=cs)
    with TestClient(s.streamable_http_app(host="qc-mcp.example.com"), base_url=H, follow_redirects=False) as t:
        yield t


def flow(c):
    cid = register(c).json()["client_id"]
    verifier, challenge = pkce()
    through_entra(c, start(c, cid, challenge))
    r = c.post("/connect/accept", data={**FORM, "csrf": csrf_of(c)})
    assert r.status_code == 303 and r.headers["location"].startswith(f"{HOST}/oauth/authorize?")
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["client_id"] == ["gid"] and q["redirect_uri"] == [H + "/connect/gitlab/callback"] and q["response_type"] == ["code"]
    assert q["scope"] == ["read_api read_user"]  # read-only: no write_repository, no api
    return cid, verifier, q["state"][0]


def test_the_gitlab_sign_in_ends_with_tokens_that_hold_only_a_sealed_access_token(c, fake):
    cid, verifier, state = flow(c)
    r = c.get(f"/connect/gitlab/callback?code=gcode&state={state}")
    assert r.status_code == 303 and r.headers["location"].startswith(CB)
    code = parse_qs(urlparse(r.headers["location"]).query)["code"][0]
    tok = token(c, cid, verifier, code).json()
    access = jwt.decode(tok["access_token"], SECRET, algorithms=["HS256"], audience=H)
    assert "gl" not in access["id"] and "at1" not in tok["access_token"] and "rt1" not in tok["access_token"]
    link = vault.unseal(KEY, access["gl"], aad="oid-1")
    assert link["at"] == "at1" and link["base"] == API and "rt" not in link
    refresh = jwt.decode(tok["refresh_token"], SECRET, algorithms=["HS256"], audience=H)
    assert vault.unseal(KEY, refresh["id"]["gl"], aad="oid-1")["rt"] == "rt1"
    exchange = [b for m, u, h, b in fake.calls if b and b["grant_type"] == "authorization_code"][0]
    assert exchange["code"] == "gcode" and exchange["redirect_uri"] == H + "/connect/gitlab/callback"
    assert tok["expires_in"] <= 7200


def test_refreshing_the_connector_token_refreshes_gitlab_and_rotates_the_pair(c, fake):
    cid, verifier, state = flow(c)
    code = parse_qs(urlparse(c.get(f"/connect/gitlab/callback?code=gcode&state={state}").headers["location"]).query)["code"][0]
    tok = token(c, cid, verifier, code).json()
    r = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": cid})
    assert r.status_code == 200, r.text
    new = r.json()
    assert vault.unseal(KEY, jwt.decode(new["access_token"], SECRET, algorithms=["HS256"], audience=H)["gl"], aad="oid-1")["at"] == "at2"
    assert vault.unseal(KEY, jwt.decode(new["refresh_token"], SECRET, algorithms=["HS256"], audience=H)["id"]["gl"], aad="oid-1")["rt"] == "rt2"
    again = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": cid})
    assert again.status_code == 400 and again.json()["error"] == "invalid_grant"


def test_the_refreshed_pair_names_claudes_client_so_the_next_refresh_works_too(c, fake):
    cid, verifier, state = flow(c)
    code = parse_qs(urlparse(c.get(f"/connect/gitlab/callback?code=gcode&state={state}").headers["location"]).query)["code"][0]
    rt = token(c, cid, verifier, code).json()["refresh_token"]
    for n in (2, 3):
        r = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": rt, "client_id": cid})
        assert r.status_code == 200, r.text
        rt = r.json()["refresh_token"]
        assert jwt.decode(rt, SECRET, algorithms=["HS256"], audience=H)["cid"] == cid  # not GitLab's own client id
        assert vault.unseal(KEY, jwt.decode(rt, SECRET, algorithms=["HS256"], audience=H)["id"]["gl"], aad="oid-1")["rt"] == f"rt{n}"


def test_refresh_keeps_the_old_refresh_token_when_gitlab_sends_none_and_needs_one_to_start(gs):
    gs2 = gitlab.GitLabSettings("gid", "gsecret", http=lambda m, u, h, b: {"access_token": "n"})
    new = gs2.refresh({"at": "o", "rt": "keep", "exp": 1, "base": API})
    assert new["rt"] == "keep" and new["at"] == "n" and new["exp"] > time.time() + 7000
    with pytest.raises(gitlab.GitLabError, match="no refresh token"):
        gs.refresh({"at": "o", "exp": 1, "base": API})
    with pytest.raises(gitlab.GitLabError, match="no access token"):
        gitlab.GitLabSettings("gid", "gsecret", http=lambda m, u, h, b: {}).link("c", "https://x/cb")


def test_a_wrong_state_or_a_refusal_at_gitlab_gives_no_code(c):
    cid, verifier, state = flow(c)
    assert c.get("/connect/gitlab/callback?code=x&state=wrong").status_code == 400
    r = c.get(f"/connect/gitlab/callback?error=access_denied&state={state}")
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert r.headers["location"].startswith(CB) and q["error"] == ["access_denied"] and "code" not in q


def test_the_chain_goes_microsoft_then_atlassian_then_gitlab_then_the_code(tmp_path, monkeypatch, fake, gs):
    cs = connector.ConnectorSettings(entra=S, secret=SECRET, rules="Rule.", rules_version="v1", vault_key=KEY, gitlab=gs,
                                     atlassian=atlassian.AtlassianSettings("aid", "asecret", site="https://example.atlassian.net", http=FakeAtl()))
    monkeypatch.setattr(web, "redeem_code", lambda w, code, verifier: "id-token")
    monkeypatch.setattr(web, "check_id_token", lambda w, tok, nonce, key: CLAIMS)
    s = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=cs)
    with TestClient(s.streamable_http_app(host="qc-mcp.example.com"), base_url=H, follow_redirects=False) as c:
        cid = register(c).json()["client_id"]
        verifier, challenge = pkce()
        through_entra(c, start(c, cid, challenge))
        r = c.post("/connect/accept", data={**FORM, "csrf": csrf_of(c)})
        assert r.headers["location"].startswith("https://auth.atlassian.com/authorize?")
        r = c.get(f"/connect/atlassian/callback?code=a&state={parse_qs(urlparse(r.headers['location']).query)['state'][0]}")
        assert r.headers["location"].startswith(f"{HOST}/oauth/authorize?")
        r = c.get(f"/connect/gitlab/callback?code=g&state={parse_qs(urlparse(r.headers['location']).query)['state'][0]}")
        assert r.headers["location"].startswith(CB)
        code = parse_qs(urlparse(r.headers["location"]).query)["code"][0]
        access = jwt.decode(token(c, cid, verifier, code).json()["access_token"], SECRET, algorithms=["HS256"], audience=H)
        assert vault.unseal(KEY, access["atl"], aad="oid-1")["at"] == "atl1" and vault.unseal(KEY, access["gl"], aad="oid-1")["at"] == "at1"


def run_tool(monkeypatch, cs, fn, claims, **args):
    from mcp.server.auth.middleware import auth_context
    from mcp.server.auth.provider import AccessToken

    monkeypatch.setattr(auth_context, "get_access_token", lambda: AccessToken(token="t", client_id="c", scopes=[], expires_at=int(time.time()) + 60, subject="oid-1", claims=claims))
    tools = {f.__name__: f for f in gitlab.tools(connector.ConnectorProvider(cs))}
    return tools[fn](**args)


def sealed(exp=3000, aad="oid-1", base=API):
    return vault.seal(KEY, {"at": "at9", "exp": int(time.time()) + exp, "base": base}, aad=aad)


def test_the_tools_read_as_the_person_and_only_with_get(monkeypatch, cs, fake):
    claims = {"gl": sealed()}
    mr = json.loads(run_tool(monkeypatch, cs, "quality_code_gitlab_mr", claims, url=MR))
    assert mr["title"] == "Add it" and mr["project"] == "team/sub/app" and mr["iid"] == 7 and mr["author"] == "ada" and "diffs" not in mr
    assert [f["path"] for f in mr["files"]] == ["a.py", "b.py"] and mr["files"][1]["old_path"] == "c.py"
    with_diff = json.loads(run_tool(monkeypatch, cs, "quality_code_gitlab_mr", claims, url=MR, diff_paths=["b.py"]))
    assert with_diff["diffs"] == {"b.py": "+2"}
    assert json.loads(run_tool(monkeypatch, cs, "quality_code_gitlab_project", claims, path="team/sub/app"))["default_branch"] == "main"
    assert json.loads(run_tool(monkeypatch, cs, "quality_code_gitlab_user", claims))["username"] == "ada"
    assert {m for m, *_ in fake.calls} == {"GET"} and all(h.get("Authorization") == "Bearer at9" for _, _, h, _ in fake.calls)


def test_only_merge_requests_on_this_gitlab_are_read(monkeypatch, cs, fake):
    claims = {"gl": sealed()}
    for bad in ("https://evil.example.com/team/app/-/merge_requests/7", f"{HOST}/team/app/-/issues/7", f"{HOST}/team/app", "http://biosphere.teamsystem.com/a/b/-/merge_requests/1",
                f"{HOST}.evil.com/a/b/-/merge_requests/1", "not a url"):
        assert run_tool(monkeypatch, cs, "quality_code_gitlab_mr", claims, url=bad).startswith("error:"), bad
    assert fake.calls == []  # nothing was sent to GitLab for them


def test_without_a_link_with_another_persons_link_or_an_expired_one_the_tools_say_so(monkeypatch, cs):
    assert "not connected" in run_tool(monkeypatch, cs, "quality_code_gitlab_user", {})
    assert "not connected" in run_tool(monkeypatch, cs, "quality_code_gitlab_user", {"gl": sealed(aad="someone-else")})
    assert "expired" in run_tool(monkeypatch, cs, "quality_code_gitlab_user", {"gl": sealed(exp=-5)})
    assert "another address" in run_tool(monkeypatch, cs, "quality_code_gitlab_user", {"gl": sealed(base="https://other.example.com/api/v4")})


def test_the_settings_need_both_values_and_a_good_api_address():
    assert gitlab.settings_from_env({}) is None
    with pytest.raises(gitlab.GitLabConfigError):
        gitlab.settings_from_env({"QUALITY_CODE_GITLAB_CLIENT_ID": "a"})
    ok = gitlab.settings_from_env({"QUALITY_CODE_GITLAB_CLIENT_ID": "a", "QUALITY_CODE_GITLAB_CLIENT_SECRET": "b"})
    assert ok.api_url == API and ok.host == HOST
    own = gitlab.settings_from_env({"QUALITY_CODE_GITLAB_CLIENT_ID": "a", "QUALITY_CODE_GITLAB_CLIENT_SECRET": "b", "QUALITY_CODE_GITLAB_API_URL": "https://git.example.com/api/v4/"})
    assert own.host == "https://git.example.com"
    for bad in ("http://git.example.com/api/v4", "https://git.example.com", "https://git.example.com/api/v3"):
        with pytest.raises(gitlab.GitLabConfigError):
            gitlab.settings_from_env({"QUALITY_CODE_GITLAB_CLIENT_ID": "a", "QUALITY_CODE_GITLAB_CLIENT_SECRET": "b", "QUALITY_CODE_GITLAB_API_URL": bad})
    base = {"QUALITY_CODE_TOKEN_SECRET": SECRET, "QUALITY_CODE_GITLAB_CLIENT_ID": "a", "QUALITY_CODE_GITLAB_CLIENT_SECRET": "b"}
    with pytest.raises(connector.ConnectorConfigError, match="TOKEN_KEY"):
        connector.settings_from_env(S, base)
    assert connector.settings_from_env(S, {**base, "QUALITY_CODE_TOKEN_KEY": "k" * 40}).gitlab.client_id == "a"


def test_the_gitlab_tools_exist_only_when_gitlab_is_set(tmp_path, cs):
    on = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=cs)
    off = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=connector.ConnectorSettings(S, SECRET, "r", "v1"))
    names = lambda s: {t.name for t in asyncio.run(s.list_tools())}  # noqa: E731
    mine = {"quality_code_gitlab_mr", "quality_code_gitlab_project", "quality_code_gitlab_user"}
    assert mine <= names(on) and not (mine & names(off))
    tools = {t.name: t for t in asyncio.run(on.list_tools())}
    assert all(tools[n].annotations.read_only_hint for n in mine)


class BigAtl(FakeAtl):
    """Atlassian's real access tokens are long: the sign-in cookie must still fit a browser's 4 KB limit."""

    def __call__(self, method, url, headers, body):
        r = super().__call__(method, url, headers, body)
        if isinstance(r, dict) and r.get("access_token"):
            r = {**r, "access_token": r["access_token"] + "x" * 2500}
        return r


def chain(tmp_path, monkeypatch, atl_http):
    gs = gitlab.GitLabSettings("gid", "gsecret", http=FakeGitLab())
    cs = connector.ConnectorSettings(entra=S, secret=SECRET, rules="Rule.", rules_version="v1", vault_key=KEY, gitlab=gs,
                                     atlassian=atlassian.AtlassianSettings("aid", "asecret", site="https://example.atlassian.net", http=atl_http))
    monkeypatch.setattr(web, "redeem_code", lambda w, code, verifier: "id-token")
    monkeypatch.setattr(web, "check_id_token", lambda w, tok, nonce, key: CLAIMS)
    return build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=cs)


def test_a_long_atlassian_token_does_not_overflow_the_cookie_of_the_next_sign_in(tmp_path, monkeypatch):
    s = chain(tmp_path, monkeypatch, BigAtl())
    with TestClient(s.streamable_http_app(host="qc-mcp.example.com"), base_url=H, follow_redirects=False) as c:
        cid = register(c).json()["client_id"]
        verifier, challenge = pkce()
        through_entra(c, start(c, cid, challenge))
        r = c.post("/connect/accept", data={**FORM, "csrf": csrf_of(c)})
        r = c.get(f"/connect/atlassian/callback?code=a&state={parse_qs(urlparse(r.headers['location']).query)['state'][0]}")
        assert r.headers["location"].startswith(f"{HOST}/oauth/authorize?")
        cookie = r.headers["set-cookie"]
        assert len(cookie) < 4000, len(cookie)


def test_a_stale_tab_goes_on_with_the_missing_service_instead_of_a_dead_end(tmp_path, monkeypatch):
    s = chain(tmp_path, monkeypatch, FakeAtl())
    with TestClient(s.streamable_http_app(host="qc-mcp.example.com"), base_url=H, follow_redirects=False) as c:
        cid = register(c).json()["client_id"]
        verifier, challenge = pkce()
        through_entra(c, start(c, cid, challenge))
        r = c.post("/connect/accept", data={**FORM, "csrf": csrf_of(c)})
        assert r.headers["location"].startswith("https://auth.atlassian.com/authorize?")
        r = c.get("/connect/gitlab/callback?code=g&state=old")  # a gitlab page from another tab, while Atlassian is the step in progress
        assert r.status_code == 303 and r.headers["location"].startswith("https://auth.atlassian.com/authorize?")
