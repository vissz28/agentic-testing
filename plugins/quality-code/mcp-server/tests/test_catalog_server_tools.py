from pathlib import Path

from quality_code_mcp.catalog import Command, render, server_tool_names

CMD = Command(name="ticket", description="", argument_hint="", body="Use getJiraIssue.\n")
ROOT = Path("/plugin")


def test_empty_set_is_unchanged():
    assert render(CMD, ROOT, "X-1", frozenset()) == render(CMD, ROOT, "X-1")
    assert "server offers" not in render(CMD, ROOT, "X-1")


def test_note_names_exactly_the_present_tools():
    out = render(CMD, ROOT, "", {"quality_code_jira_issue", "quality_code_jira_search"})
    assert "`quality_code_jira_issue` instead of getJiraIssue" in out
    assert "`quality_code_jira_search` instead of searchJiraIssuesUsingJql" in out
    assert "quality_code_jira_create" not in out
    assert "preview" not in out
    assert "cloudId" in out


def test_write_preview_only_with_a_write_tool():
    out = render(CMD, ROOT, "", {"quality_code_jira_comment"})
    assert "preview" in out and "clear yes" in out


def test_unknown_names_ignored():
    assert server_tool_names(["quality_code_jira_issue", "quality_code_run_script", "x"]) == frozenset({"quality_code_jira_issue"})
    assert render(CMD, ROOT, "", server_tool_names(["x"])) == render(CMD, ROOT)


def test_the_shared_server_offers_no_slash_command(tmp_path):
    import asyncio

    from quality_code_mcp import catalog
    from quality_code_mcp.server import build, render_guide
    from test_connector import SECRET, W
    from test_entra import S
    from quality_code_mcp import connector

    try:
        s = build(catalog.plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=connector.ConnectorSettings(S, SECRET, "r", "v1"))
        tools = asyncio.run(s.list_tools())
        assert not [t.name for t in tools if "/quality-code:" in (t.description or "")]
        text = asyncio.run(s.call_tool("quality_code_direct", {"request": "Quality Code ticket PFO-1 --eval"}))
        assert "/quality-code:" not in str(text) and "Quality Code ticket" in str(text)
        assert "/quality-code:" not in render_guide(catalog.plugin_root(), "ticket-eval")
        assert "Follow EVERY step" in str(text) and "quality_code_direct" in str(text) and "TICKET_JSON" in str(text)
    finally:
        build(catalog.plugin_root())  # back to the plugin's own profile
    assert "/quality-code:" in render_guide(catalog.plugin_root(), "ticket-eval")
    assert "Follow EVERY step" not in catalog.render(catalog.load_commands(catalog.plugin_root())[0], catalog.plugin_root())
