import asyncio

import pytest

from quality_code_mcp import direct
from quality_code_mcp.catalog import load_commands, plugin_root
from quality_code_mcp.server import build

ROOT = plugin_root()
CMDS = load_commands(ROOT)


@pytest.mark.parametrize("text,name,args", [
    ("Quality Code ticket PFO-4178", "ticket", "PFO-4178"),
    ("Using Quality Code: ticket AGT-1 --eval", "ticket", "AGT-1 --eval"),
    ("quality code direct spec ABC-123 --layer unit", "spec", "ABC-123 --layer unit"),
    ("Quality-Code  /quality-code:check --branch", "check", "--branch"),
    ("Quality Code transcript goal plan.txt", "transcript-goal", "plan.txt"),
    ("Using Quality Code PFO-4178", "ticket", "PFO-4178"),
    ("Quality Code", "help", ""),
    ("Using Quality Code direct", "help", ""),
])
def test_the_keyword_routes_to_the_named_command(text, name, args):
    cmd, rest = direct.route(text, CMDS)
    assert cmd and cmd.name == name and rest == args


@pytest.mark.parametrize("text,name,args", [
    ("Using quality code evaluate ticket PFO-111", "ticket", "PFO-111 --eval"),
    ("Using Quality Code is PFO-5 ready for tests?", "ticket", "PFO-5 --eval"),
    ("Using Quality Code score the tickets of PFO", "ticket", "PFO --eval"),
    ("Using quality code write tests for PFO-4178", "spec", "PFO-4178"),
    ("Quality Code generate the tests for ABC-9", "spec", "ABC-9"),
    ("Using Quality Code write test cases for ABC-9", "xray", "ABC-9"),
    ("Using Quality Code check the tests on my branch", "check", ""),
    ("Using Quality Code run the manual tests of EXE-12", "qa", "EXE-12"),
    ("Using Quality Code turn this sprint planning transcript into tasks", "transcript-goal", ""),
    ("Using Quality Code show me AGT-214", "ticket", "AGT-214"),
    ("Using Quality Code what can you do", "help", ""),
])
def test_a_plain_request_is_understood_and_keeps_its_ticket(text, name, args):
    cmd, rest = direct.route(text, CMDS)
    assert cmd and cmd.name == name and rest == args, (cmd and cmd.name, rest)


def test_an_unclear_request_lists_what_it_could_be_and_what_we_offer():
    assert direct.route("Using Quality Code tests", CMDS)[0] is None
    assert direct.route("Using Quality Code do the thing", CMDS)[0] is None
    both = direct.candidates("Using Quality Code write tests and check the suite for ABC-1", CMDS)
    assert {"spec", "check"} <= {c.name for c in both}
    assert direct.route("Using Quality Code write tests and check the suite for ABC-1", CMDS)[0] is None
    m = direct.menu(CMDS, both)
    assert "could be one of these" in m and "Everything we offer" in m and "Using Quality Code evaluate ticket" in m
    assert "Here is what we offer" in direct.menu(CMDS)


def test_an_unknown_request_gets_the_menu_not_a_guess():
    cmd, rest = direct.route("Quality Code make me a sandwich", CMDS)
    assert cmd is None and rest == "make me a sandwich"
    m = direct.menu(CMDS)
    assert "Quality Code ticket" in m and "Quality Code spec" in m and "not sure" in m


def test_the_direct_tool_returns_the_commands_own_instructions(tmp_path):
    s = build(ROOT, remote=True, fixed_cwd=tmp_path)
    out = asyncio.run(s.call_tool("quality_code_direct", {"request": "Using Quality Code ticket PFO-4178"}))
    text = "".join(getattr(b, "text", "") for b in out.content)
    assert text.startswith("Using Quality Code: understood as Quality Code ticket PFO-4178") and "Arguments: PFO-4178" in text and "## Steps" in text
    menu = asyncio.run(s.call_tool("quality_code_direct", {"request": "Quality Code ???"}))
    assert "not sure" in "".join(getattr(b, "text", "") for b in menu.content)


def test_a_command_that_needs_a_repo_tells_how_to_find_or_add_one(tmp_path):
    s = build(ROOT, remote=True, fixed_cwd=tmp_path)
    out = asyncio.run(s.call_tool("quality_code_direct", {"request": "Using Quality Code write tests for PFO-4178"}))
    text = "".join(getattr(b, "text", "") for b in out.content)
    assert "understood as Quality Code spec PFO-4178" in text and "NOTE: this command needs your repo" in text
    assert "find the repo" in text and "git rev-parse --show-toplevel" in text and "specify one and put it in their Claude environment" in text
    ticket = asyncio.run(s.call_tool("quality_code_direct", {"request": "Using Quality Code evaluate ticket PFO-111"}))
    assert "needs your repo" not in "".join(getattr(b, "text", "") for b in ticket.content)
