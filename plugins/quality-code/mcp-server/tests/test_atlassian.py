"""The server reads Jira as the signed-in person: Atlassian sign-in in the connector flow, tokens sealed inside the connector tokens, read-only tools."""
import asyncio
import json
import time
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from starlette.testclient import TestClient

from quality_code_mcp import atlassian, connector, vault, web
from quality_code_mcp.catalog import plugin_root
from quality_code_mcp.server import _jira_tools, build
from test_connector import CB, CLAIMS, FORM, H, SECRET, W, csrf_of, pkce, register, start, through_entra, token
from test_entra import S

KEY = vault.key_from_env({"QUALITY_CODE_TOKEN_KEY": "k" * 40})
SITE = "https://example.atlassian.net"


class FakeAtlassian:
    """The Atlassian hosts, answering what they answer, and remembering what was asked."""

    def __init__(self):
        self.calls, self.n = [], 0

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, body))
        if url.endswith("/oauth/token"):
            self.n += 1
            assert body["client_secret"] == "asecret"
            if body["grant_type"] == "refresh_token" and body["refresh_token"] != f"rt{self.n - 1}":
                raise atlassian.AtlassianError("Atlassian answered 403")
            return {"access_token": f"at{self.n}", "refresh_token": f"rt{self.n}", "expires_in": 3600}
        if url.endswith("/oauth/token/accessible-resources"):
            return [{"id": "other", "url": "https://other.atlassian.net"}, {"id": "cloud-1", "url": SITE}]
        if "/search/jql" in url:
            return {"issues": [{"key": "AGT-1", "fields": {"summary": "S", "status": {"name": "Done"}, "issuetype": {"name": "Story"}, "assignee": {"displayName": "Ada"}}}]}
        if "/issue/" in url:
            return {"key": "AGT-1", "fields": {"summary": "S", "status": {"name": "Done"}, "issuetype": {"name": "Story"}, "assignee": None, "labels": ["x"],
                                               "description": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hello"}]}]}, "subtasks": []}}
        raise AssertionError(url)


@pytest.fixture
def fake():
    return FakeAtlassian()


@pytest.fixture
def cs(fake):
    return connector.ConnectorSettings(entra=S, secret=SECRET, rules="Rule.", rules_version="v1", vault_key=KEY,
                                       atlassian=atlassian.AtlassianSettings("aid", "asecret", site=SITE, http=fake))


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
    assert r.status_code == 303 and r.headers["location"].startswith("https://auth.atlassian.com/authorize?")
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["client_id"] == ["aid"] and q["redirect_uri"] == [H + "/connect/atlassian/callback"] and "offline_access" in q["scope"][0]
    assert "write:jira-work" in q["scope"][0]  # the commands write to Jira (create, comment, transition), each only after a preview and a yes in the chat
    return cid, verifier, q["state"][0]


def test_the_vault_opens_only_what_this_key_sealed_for_this_person():
    sealed = vault.seal(KEY, {"at": "secret"}, aad="oid-1")
    assert "secret" not in sealed and vault.unseal(KEY, sealed, aad="oid-1") == {"at": "secret"}
    assert vault.unseal(KEY, sealed, aad="oid-2") is None
    assert vault.unseal(vault.key_from_env({"QUALITY_CODE_TOKEN_KEY": "z" * 40}), sealed, aad="oid-1") is None
    assert vault.unseal(KEY, sealed[:-3] + "AAA", aad="oid-1") is None and vault.unseal(KEY, None) is None and vault.unseal(KEY, "junk") is None
    with pytest.raises(vault.VaultError):
        vault.key_from_env({"QUALITY_CODE_TOKEN_KEY": "short"})


def test_the_atlassian_sign_in_ends_with_tokens_that_hold_only_a_sealed_access_token(c, fake):
    cid, verifier, state = flow(c)
    r = c.get(f"/connect/atlassian/callback?code=acode&state={state}")
    assert r.status_code == 303 and r.headers["location"].startswith(CB)
    code = parse_qs(urlparse(r.headers["location"]).query)["code"][0]
    tok = token(c, cid, verifier, code).json()
    access = jwt.decode(tok["access_token"], SECRET, algorithms=["HS256"], audience=H)
    assert "atl" not in access["id"] and "at1" not in tok["access_token"] and "rt1" not in tok["access_token"]
    link = vault.unseal(KEY, access["atl"], aad="oid-1")
    assert link["at"] == "at1" and link["cloud"] == "cloud-1" and "rt" not in link  # the refresh token is not in the access token
    refresh = jwt.decode(tok["refresh_token"], SECRET, algorithms=["HS256"], audience=H)
    assert vault.unseal(KEY, refresh["id"]["atl"], aad="oid-1")["rt"] == "rt1"
    assert tok["expires_in"] <= 3600


def test_refreshing_the_connector_token_refreshes_atlassian_and_rotates_the_pair(c, fake):
    cid, verifier, state = flow(c)
    code = parse_qs(urlparse(c.get(f"/connect/atlassian/callback?code=acode&state={state}").headers["location"]).query)["code"][0]
    tok = token(c, cid, verifier, code).json()
    r = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": cid})
    assert r.status_code == 200, r.text
    new = r.json()
    link = vault.unseal(KEY, jwt.decode(new["access_token"], SECRET, algorithms=["HS256"], audience=H)["atl"], aad="oid-1")
    assert link["at"] == "at2"
    assert vault.unseal(KEY, jwt.decode(new["refresh_token"], SECRET, algorithms=["HS256"], audience=H)["id"]["atl"], aad="oid-1")["rt"] == "rt2"
    # the old refresh token was rotated away at Atlassian: using it again fails and asks to connect again
    again = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": tok["refresh_token"], "client_id": cid})
    assert again.status_code == 400 and again.json()["error"] == "invalid_grant"


def test_a_wrong_state_or_a_refusal_at_atlassian_gives_no_code(c):
    cid, verifier, state = flow(c)
    assert c.get("/connect/atlassian/callback?code=x&state=wrong").status_code == 400
    r = c.get(f"/connect/atlassian/callback?error=access_denied&state={state}")
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert r.headers["location"].startswith(CB) and q["error"] == ["access_denied"] and "code" not in q


def test_an_account_that_cannot_see_the_configured_site_is_refused(c, fake, cs):
    object.__setattr__(cs.atlassian, "site", "https://nope.atlassian.net")
    cid, verifier, state = flow(c)
    r = c.get(f"/connect/atlassian/callback?code=acode&state={state}")
    assert r.status_code == 400 and "cannot see" in r.text


def run_tool(monkeypatch, cs, fn, claims, **args):
    from mcp.server.auth.provider import AccessToken
    from mcp.server.auth.middleware import auth_context

    monkeypatch.setattr(auth_context, "get_access_token", lambda: AccessToken(token="t", client_id="c", scopes=[], expires_at=int(time.time()) + 60, subject="oid-1", claims=claims))
    tools = {f.__name__: f for f in _jira_tools(connector.ConnectorProvider(cs))}
    return tools[fn](**args)


def test_the_jira_tools_read_as_the_person_and_never_write(monkeypatch, cs, fake):
    sealed = vault.seal(KEY, {"at": "at9", "exp": int(time.time()) + 3000, "cloud": "cloud-1", "site": SITE}, aad="oid-1")
    out = json.loads(run_tool(monkeypatch, cs, "quality_code_jira_issue", {"atl": sealed}, key="AGT-1"))
    assert out["key"] == "AGT-1" and out["description"].strip() == "Hello" and out["labels"] == ["x"]
    assert json.loads(run_tool(monkeypatch, cs, "quality_code_jira_search", {"atl": sealed}, jql="project = AGT"))[0]["assignee"] == "Ada"
    assert {m for m, *_ in fake.calls} == {"GET"} and all(h.get("Authorization") == "Bearer at9" for _, _, h, _ in fake.calls)
    assert "ABC-123" in run_tool(monkeypatch, cs, "quality_code_jira_issue", {"atl": sealed}, key="../x")


def test_without_a_link_or_with_another_persons_link_the_tools_say_to_reconnect(monkeypatch, cs):
    assert "not connected" in run_tool(monkeypatch, cs, "quality_code_jira_issue", {}, key="AGT-1")
    theirs = vault.seal(KEY, {"at": "x", "exp": int(time.time()) + 3000, "cloud": "c"}, aad="someone-else")
    assert "not connected" in run_tool(monkeypatch, cs, "quality_code_jira_issue", {"atl": theirs}, key="AGT-1")
    old = vault.seal(KEY, {"at": "x", "exp": int(time.time()) - 5, "cloud": "c"}, aad="oid-1")
    assert "expired" in run_tool(monkeypatch, cs, "quality_code_jira_issue", {"atl": old}, key="AGT-1")


def test_the_settings_need_both_atlassian_values_and_the_key():
    base = {"QUALITY_CODE_TOKEN_SECRET": SECRET}
    assert connector.settings_from_env(S, base).atlassian is None
    with pytest.raises(connector.ConnectorConfigError):
        connector.settings_from_env(S, {**base, "QUALITY_CODE_ATLASSIAN_CLIENT_ID": "a"})
    with pytest.raises(connector.ConnectorConfigError, match="TOKEN_KEY"):
        connector.settings_from_env(S, {**base, "QUALITY_CODE_ATLASSIAN_CLIENT_ID": "a", "QUALITY_CODE_ATLASSIAN_CLIENT_SECRET": "b"})
    ok = connector.settings_from_env(S, {**base, "QUALITY_CODE_ATLASSIAN_CLIENT_ID": "a", "QUALITY_CODE_ATLASSIAN_CLIENT_SECRET": "b", "QUALITY_CODE_TOKEN_KEY": "k" * 40, "QUALITY_CODE_JIRA_SITE": SITE})
    assert ok.atlassian.site == SITE and ok.vault_key


def test_the_jira_tools_exist_only_when_atlassian_is_set(tmp_path, cs):
    on = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=cs)
    off = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=connector.ConnectorSettings(S, SECRET, "r", "v1"))
    names = lambda s: {t.name for t in asyncio.run(s.list_tools())}  # noqa: E731
    assert {"quality_code_jira_search", "quality_code_jira_issue"} <= names(on)
    assert not ({"quality_code_jira_search", "quality_code_jira_issue"} & names(off))


def test_the_jira_write_tools_act_as_the_person_and_bad_input_is_refused(monkeypatch, cs, fake):
    sealed = vault.seal(KEY, {"at": "at9", "exp": int(time.time()) + 3000, "cloud": "cloud-1", "site": SITE}, aad="oid-1")
    fake.calls.clear()
    run_tool(monkeypatch, cs, "quality_code_jira_comment", {"atl": sealed}, key="AGT-1", text="hello")
    run_tool(monkeypatch, cs, "quality_code_jira_transition", {"atl": sealed}, key="AGT-1", transition_id="451")
    assert [(m, u.rsplit("/", 2)[-1]) for m, u, *_ in fake.calls] == [("POST", "comment"), ("POST", "transitions")]
    assert all(h.get("Authorization") == "Bearer at9" for _, _, h, _ in fake.calls)
    assert "ABC-123" in run_tool(monkeypatch, cs, "quality_code_jira_comment", {"atl": sealed}, key="../x", text="t")
    assert "JSON object" in run_tool(monkeypatch, cs, "quality_code_jira_edit", {"atl": sealed}, key="AGT-1", fields_json="[1]")
    assert "not connected" in run_tool(monkeypatch, cs, "quality_code_jira_create", {}, project="AGT", issue_type="Story", summary="s")


def test_each_person_gets_a_scripts_folder_with_their_own_site_and_projects(tmp_path):
    from quality_code_mcp import jira_config

    pages = [{"values": [{"key": "AAA"}, {"key": "BBB"}], "isLast": False}, {"values": [{"key": "CCC"}], "isLast": True}]
    calls = []

    def http(method, url, headers, body):
        calls.append(url)
        return pages[len(calls) - 1]

    link = {"at": "a", "exp": int(time.time()) + 3000, "cloud": "c1", "site": SITE}
    keys = atlassian.AtlassianSettings("i", "s", http=http).project_keys(link)
    assert keys == ["AAA", "BBB", "CCC"] and "startAt=2" in calls[1]
    a = jira_config.write_person_config(tmp_path, "oid-1", SITE, keys)
    b = jira_config.write_person_config(tmp_path, "oid-2", SITE, ["ZZZ"])
    assert a != b and a.parent == tmp_path / "people"
    assert json.loads((a / ".claude" / "quality-code.json").read_text())["jira"] == {"site": SITE, "projects": ["AAA", "BBB", "CCC"]}
    assert json.loads((b / ".claude" / "quality-code.json").read_text())["jira"]["projects"] == ["ZZZ"]
    with pytest.raises(jira_config.JiraConfigError):
        jira_config.write_person_config(tmp_path, "oid-3", SITE, [])
