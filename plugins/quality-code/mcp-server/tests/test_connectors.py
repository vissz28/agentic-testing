import asyncio
import json
from pathlib import Path

from quality_code_mcp import connector, connectors
from quality_code_mcp.catalog import Command, plugin_root, render
from quality_code_mcp.server import build
from test_connector import SECRET, W
from test_entra import S

CMD = Command(name="ticket", description="", argument_hint="", body="Read it.\n")
ROOT = Path("/plugin")


def test_the_block_names_all_three_addresses():
    b = connectors.block({})
    assert "https://mcp.atlassian.com/v2/mcp" in b and "https://teamsystem.atlassian.net" in b
    assert "https://biosphere.teamsystem.com/api/v4/mcp" in b and "https://biosphere.teamsystem.com" in b
    assert "https://copilot-api.teamsystem.ghe.com/mcp" in b and "https://teamsystem.ghe.com" in b
    assert "not verified" in b and "Never ask for a token" in b


def test_the_environment_overrides_the_defaults():
    a = connectors.addresses({"QUALITY_CODE_JIRA_SITE": "https://x.atlassian.net/", "QUALITY_CODE_GITLAB_API_URL": "https://git.example.com/api/v4", "QUALITY_CODE_GITHUB_URL": "https://git.example.org/"})
    assert a["jira_site"] == "https://x.atlassian.net"
    assert a["gitlab_host"] == "https://git.example.com" and a["gitlab_mcp"] == "https://git.example.com/api/v4/mcp"
    assert a["github_host"] == "https://git.example.org" and a["github_mcp"] == "https://git.example.org/mcp"


def test_a_ghe_com_host_derives_the_copilot_api_address():
    assert connectors.addresses({"QUALITY_CODE_GITHUB_URL": "https://acme.ghe.com"})["github_mcp"] == "https://copilot-api.acme.ghe.com/mcp"


def test_a_service_the_server_signs_in_to_needs_no_connector():
    none = connectors.block({})
    assert "already signed in" not in none and "copilot-api.teamsystem.ghe.com" in none
    gh = connectors.block({}, {"quality_code_github_pr"})
    assert "GitHub: already signed in through Quality Code" in gh and "copilot-api" not in gh
    assert "atlassian.com" in gh and "biosphere" in gh  # the others still need theirs
    text = connectors.tool_text({}, {"quality_code_github_pr", "quality_code_jira_issue"})
    assert "GitHub | https://teamsystem.ghe.com | signed in through Quality Code" in text and "Jira | https://teamsystem.atlassian.net | signed in" in text
    assert "GitLab | https://biosphere.teamsystem.com | add the connector" in text and "not verified" not in text
    assert "not verified" in connectors.tool_text({})


def test_render_is_unchanged_without_the_block_and_adds_it_with_it():
    assert render(CMD, ROOT, "X-1", connectors="") == render(CMD, ROOT, "X-1")
    out = render(CMD, ROOT, "X-1", connectors=connectors.block({}))
    assert "Connect what is missing" in out and out.rstrip().endswith("Read it.")


def test_the_remote_profile_has_the_tool_and_nothing_asks_for_a_secret(tmp_path):
    s = build(plugin_root(), entra=S, remote=True, fixed_cwd=tmp_path, web_settings=W, connector=connector.ConnectorSettings(S, SECRET, "r", "v1"))
    assert "quality_code_connectors" in {t.name for t in asyncio.run(s.list_tools())}
    text = connectors.tool_text({}) + connectors.block({})
    assert "password" not in text.lower().replace("never ask for a token, key or password", "") and "paste" not in text.replace("No token is ever pasted", "")
    local = build(plugin_root())
    assert "quality_code_connectors" not in {t.name for t in asyncio.run(local.list_tools())}


def test_the_plugin_has_no_github_connector_and_gitlab_defaults_to_biosphere():
    base = plugin_root()
    assert "github" not in json.loads((base / ".mcp.json").read_text())["mcpServers"]  # GitHub signs in through the server
    uc = json.loads((base / ".claude-plugin" / "plugin.json").read_text())["userConfig"]
    assert "github_mcp_url" not in uc
    assert uc["gitlab_api_url"]["default"] == "https://biosphere.teamsystem.com/api/v4"
