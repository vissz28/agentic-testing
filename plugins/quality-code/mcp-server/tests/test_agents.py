import json
import subprocess
import sys
from pathlib import Path

import pytest

from quality_code_mcp.agents import CLAUDE_ONLY, TOOLS, codex_toml, init, report
from quality_code_mcp.catalog import load_commands, plugin_root

ROOT = plugin_root()
WRAPPED = [c for c in load_commands(ROOT) if c.name not in CLAUDE_ONLY]


def files(tool, tmp_path, write=True):
    done, skipped = init(tool, tmp_path, write=write)
    return done, skipped


def test_nothing_is_written_without_write(tmp_path):
    done, _ = files("cursor", tmp_path, write=False)
    assert done and not any(tmp_path.iterdir())


def test_every_tool_wraps_every_command_except_the_claude_only_ones(tmp_path):
    assert {"routine", "check-update"} == CLAUDE_ONLY
    per_command = {"copilot": ".github/prompts/", "codex": ".agents/skills/", "cursor": ".cursor/commands/", "gemini": "quality-code-gemini/commands/"}
    for tool in TOOLS:
        done, _ = files(tool, tmp_path / tool)
        wrapped = [p for p in done if p.startswith(per_command[tool])]
        assert len(wrapped) == len(WRAPPED), tool
        assert not any("routine" in p or "check-update" in p for p in done), tool


def test_a_wrapper_calls_the_tool_of_its_command_and_nothing_else(tmp_path):
    files("copilot", tmp_path)
    text = (tmp_path / ".github/prompts/quality-code-spec.prompt.md").read_text()
    assert text.startswith("---\nmode: agent\n")
    assert "`quality_code_spec`" in text and "quality_code_run_script" in text
    assert "${input:arguments:" in text


def test_server_config_is_local_stdio_with_this_plugins_paths(tmp_path):
    files("copilot", tmp_path / "c")
    files("cursor", tmp_path / "u")
    vs = json.loads((tmp_path / "c/.vscode/mcp.json").read_text())["servers"]["quality-code"]
    cu = json.loads((tmp_path / "u/.cursor/mcp.json").read_text())["mcpServers"]["quality-code"]
    assert vs["type"] == "stdio" and "url" not in vs
    for s in (vs, cu):
        assert s["env"]["QUALITY_CODE_PLUGIN_ROOT"] == str(ROOT)
        assert s["command"].endswith("quality-code-mcp") or s["args"] == ["-m", "quality_code_mcp"]


def test_codex_skills_have_name_and_description_and_the_toml_is_printed_not_written(tmp_path):
    done, _ = files("codex", tmp_path)
    assert not any(p.endswith(".toml") for p in done)
    skill = (tmp_path / ".agents/skills/quality-code-ticket/SKILL.md").read_text()
    assert skill.startswith("---\nname: quality-code-ticket\ndescription: ")
    toml = codex_toml()
    assert "[mcp_servers.quality-code]" in toml and "QUALITY_CODE_PLUGIN_ROOT" in toml
    assert toml.rstrip() in report("codex", tmp_path / "x", write=False)


def test_gemini_extension_manifest_and_toml_commands_parse(tmp_path):
    files("gemini", tmp_path)
    ext = tmp_path / "quality-code-gemini"
    manifest = json.loads((ext / "gemini-extension.json").read_text())
    assert manifest["name"] == "quality-code" and "quality-code" in manifest["mcpServers"]
    assert manifest["version"] == json.loads((ROOT / ".claude-plugin/plugin.json").read_text())["version"]
    try:
        import tomllib
    except ImportError:  # Python 3.10
        pytest.skip("tomllib needs Python 3.11")
    t = tomllib.loads((ext / "commands/quality-code/ticket.toml").read_text())
    assert t["description"] and "`{{args}}`" in t["prompt"] and "quality_code_ticket" in t["prompt"]


def test_an_existing_file_is_kept_not_replaced(tmp_path):
    (tmp_path / ".cursor").mkdir()
    (tmp_path / ".cursor/mcp.json").write_text("{\"mine\": true}")
    done, skipped = files("cursor", tmp_path)
    assert skipped == [".cursor/mcp.json"] and ".cursor/mcp.json" not in done
    assert json.loads((tmp_path / ".cursor/mcp.json").read_text()) == {"mine": True}


def test_cli_init_dry_run_and_write(tmp_path):
    base = [sys.executable, "-m", "quality_code_mcp", "--init", "cursor", "--dir", str(tmp_path)]
    dry = subprocess.run(base, capture_output=True, text=True)
    assert dry.returncode == 0 and "add --write" in dry.stdout and not any(tmp_path.iterdir())
    done = subprocess.run(base + ["--write"], capture_output=True, text=True)
    assert done.returncode == 0 and (tmp_path / ".cursor/commands/quality-code-spec.md").is_file()
    assert "Local only" in done.stdout
