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
