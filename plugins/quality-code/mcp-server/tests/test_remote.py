import asyncio
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


def test_remote_offers_only_the_jira_only_commands(tmp_path):
    n = names(build(ROOT, remote=True, fixed_cwd=tmp_path))
    assert n == {"quality_code_" + c.replace("-", "_") for c in REMOTE_COMMANDS} | {"quality_code_run_script", "quality_code_guide"}
    assert "quality_code_spec" not in n and "quality_code_run_backend" not in n


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
    assert text(asyncio.run(s.call_tool("quality_code_guide", {}))) == "Guides: connectors, save-place"
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
    assert h.status_code == 200 and h.json() == {"status": "ok"}
    assert m.status_code == 401
