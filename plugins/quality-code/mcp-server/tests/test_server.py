import asyncio
import json
import sys
from pathlib import Path

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from quality_code_mcp.catalog import load_commands, parse_command, plugin_root, render
from quality_code_mcp.server import build

ROOT = plugin_root()


def text(result):
    return result.content[0].text


def test_parse_command_reads_frontmatter_and_body():
    c = parse_command("ticket-eval", "---\ndescription: Score it\nargument-hint: <KEY>\nallowed-tools: Bash(x)\n---\n\nBody $ARGUMENTS\n")
    assert (c.description, c.argument_hint, c.tool_name) == ("Score it", "<KEY>", "quality_code_ticket_eval")
    assert c.body.strip() == "Body $ARGUMENTS"


def test_render_fills_root_and_arguments():
    c = parse_command("x", "---\ndescription: d\n---\nRun ${CLAUDE_PLUGIN_ROOT}/bin/a.mjs for $ARGUMENTS")
    out = render(c, Path("/p"), "ABC-1")
    assert "Run /p/bin/a.mjs for ABC-1" in out
    assert "quality_code_run_script" in out


def test_every_command_is_a_tool():
    tools = {t.name for t in asyncio.run(build(ROOT).list_tools())}
    for c in load_commands(ROOT):
        assert c.tool_name in tools, c.name
    assert {"quality_code_run_script", "quality_code_guide"} <= tools
    assert len(load_commands(ROOT)) >= 14


def test_command_tool_returns_instructions():
    r = asyncio.run(build(ROOT).call_tool("quality_code_ticket_eval", {"arguments": "ABC-7 --ci"}))
    assert "ABC-7 --ci" in text(r)
    assert "${CLAUDE_PLUGIN_ROOT}" not in text(r)


def test_run_script_runs_only_plugin_scripts(tmp_path):
    s = build(ROOT)
    bad = asyncio.run(s.call_tool("quality_code_run_script", {"script": "../package.json"}))
    assert "unknown script" in text(bad)
    hidden = asyncio.run(s.call_tool("quality_code_run_script", {"script": "mcp-launch"}))
    assert "unknown script" in text(hidden)
    ok = asyncio.run(s.call_tool("quality_code_run_script", {"script": "ticket", "args": ["config", "check"], "cwd": str(tmp_path)}))
    assert "[exit code" in text(ok)


def test_guide_tool_and_resources():
    s = build(ROOT)
    assert "save-place" in text(asyncio.run(s.call_tool("quality_code_guide", {})))
    assert "Where files and logs go" in text(asyncio.run(s.call_tool("quality_code_guide", {"name": "save-place"})))
    assert "error" in text(asyncio.run(s.call_tool("quality_code_guide", {"name": "../x"})))
    uris = {str(r.uri) for r in asyncio.run(s.list_resources())}
    assert "quality-code://guides/save-place" in uris


def test_over_stdio():
    async def go():
        params = StdioServerParameters(command=sys.executable, args=["-m", "quality_code_mcp"], cwd=str(Path(__file__).parents[1]))
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as session:
                await session.initialize()
                names = {t.name for t in (await session.list_tools()).tools}
                assert "quality_code_spec" in names
                res = await session.call_tool("quality_code_seed", {"arguments": "ABC-1"})
                return res.content[0].text

    assert "ABC-1" in asyncio.run(go())


def test_check_and_print_config(capsys):
    from quality_code_mcp.server import check, client_config

    assert check() == 0
    assert "tools" in capsys.readouterr().out
    cfg = client_config()
    j = json.loads(cfg.split("\n\n")[0])
    assert j["mcpServers"]["quality-code"]["env"]["QUALITY_CODE_PLUGIN_ROOT"] == str(ROOT)
    assert "claude mcp add quality-code" in cfg
