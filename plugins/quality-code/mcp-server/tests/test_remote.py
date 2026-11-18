import asyncio
import re
import time
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from quality_code_mcp.catalog import plugin_root
from quality_code_mcp.server import REMOTE_COMMANDS, build
from test_entra import S, token, verifier

ROOT = plugin_root()


def names(s):
    return {t.name for t in asyncio.run(s.list_tools())}


def text(r):
    return r.content[0].text


def test_remote_offers_every_command_but_only_the_jira_only_ones_run_here(tmp_path):
    from quality_code_mcp.catalog import load_commands

    s = build(ROOT, remote=True, fixed_cwd=tmp_path)
    n = names(s)
    assert n == {c.tool_name for c in load_commands(ROOT)} | {"quality_code_run_script", "quality_code_guide", "quality_code_connectors"}
    assert "quality_code_spec" in n and "quality_code_check" in n and "quality_code_ticket" in n
    tools = {t.name: t for t in asyncio.run(s.list_tools())}
    assert tools["quality_code_spec"].description.startswith("Quality Code: Needs your repo")
    assert not tools["quality_code_ticket"].description.startswith("Quality Code: Needs your repo")
    # every tool starts with the product name, has a titled name, and tells the model to say "Using Quality Code"
    assert all(t.description.startswith("Quality Code") and t.title.startswith("Quality Code") and 'say "Using Quality Code"' in t.description for t in tools.values())
    assert "NOTE: this command needs your repo" in text(asyncio.run(s.call_tool("quality_code_spec", {"arguments": "ABC-1"})))
    assert "NOTE: this command needs your repo" not in text(asyncio.run(s.call_tool("quality_code_ticket", {"arguments": "ABC-1"})))


def test_remote_script_tool_has_no_folder_and_a_short_allowlist(tmp_path):
    s = build(ROOT, remote=True, fixed_cwd=tmp_path)
    tool = next(t for t in asyncio.run(s.list_tools()) if t.name == "quality_code_run_script")
    assert "cwd" not in tool.input_schema["properties"]
    for bad in ("pipeline", "setup", "kpi", "consumption", "xray"):
        assert "unknown script" in text(asyncio.run(s.call_tool("quality_code_run_script", {"script": bad})))
    # a folder sent anyway is not used: the script runs in the fixed one
    r = text(asyncio.run(s.call_tool("quality_code_run_script", {"script": "ticket", "args": ["config", "check"]})))
    assert "[exit code" in r


def test_remote_guides_are_limited(tmp_path):
    s = build(ROOT, remote=True, fixed_cwd=tmp_path)
    assert text(asyncio.run(s.call_tool("quality_code_guide", {}))) == "Guides: connectors, save-place, ticket-eval, tickets-eval"
    assert "unknown" not in text(asyncio.run(s.call_tool("quality_code_guide", {"name": "save-place"})))
    assert "error" in text(asyncio.run(s.call_tool("quality_code_guide", {"name": "run"})))


def test_remote_needs_a_fixed_folder():
    with pytest.raises(ValueError):
        build(ROOT, remote=True)


def test_busy_when_too_many_scripts_run(tmp_path, monkeypatch):
    import quality_code_mcp.server as srv

    monkeypatch.setattr(srv, "MAX_RUNNING", 0)
    s = build(ROOT, remote=True, fixed_cwd=tmp_path)
    assert "busy" in text(asyncio.run(s.call_tool("quality_code_run_script", {"script": "ticket", "args": ["config", "check"]})))


def test_health_is_open_and_mcp_is_not(tmp_path):
    app = build(ROOT, entra=S, verifier=verifier(), remote=True, fixed_cwd=tmp_path).streamable_http_app(host="qc-mcp.example.com")
    with TestClient(app, base_url="https://qc-mcp.example.com") as c:
        h = c.get("/health")
        m = c.post("/mcp", json={})
    body = h.json()
    assert h.status_code == 200 and body["status"] == "ok" and re.fullmatch(r"\d+\.\d+\.\d+", body["version"]) and body["connector"] is False
    assert m.status_code == 401


def test_whoami_says_who_is_signed_in_from_the_token_claims():
    import json

    from mcp.server.auth.middleware.auth_context import auth_context_var
    from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
    from mcp.server.auth.provider import AccessToken

    from quality_code_mcp.server import quality_code_whoami

    assert json.loads(quality_code_whoami()) == {"signed_in": False}
    t = AccessToken(token="x", client_id="c", scopes=[], claims={"name": "Ada Lovelace", "upn": "ada@teamsystem.com", "jira_email": "ada.l@teamsystem.com", "gitlab_username": "ada.l", "rules": "abc123"})
    reset = auth_context_var.set(AuthenticatedUser(t))
    try:
        got = json.loads(quality_code_whoami())
    finally:
        auth_context_var.reset(reset)
    assert got == {"signed_in": True, "name": "Ada Lovelace", "email": "ada@teamsystem.com", "jira_email": "ada.l@teamsystem.com", "gitlab_username": "ada.l", "rules_version": "abc123", "via": "claude connector"}


def test_remote_runs_the_help_script_and_its_command_is_not_marked_as_needing_a_repo(tmp_path):
    s = build(ROOT, remote=True, fixed_cwd=tmp_path)
    assert {"ticket", "help"} <= REMOTE_COMMANDS
    tools = {t.name: t for t in asyncio.run(s.list_tools())}
    assert not tools["quality_code_help"].description.startswith("Needs your repo")
    assert "unknown script" not in text(asyncio.run(s.call_tool("quality_code_run_script", {"script": "help"})))
