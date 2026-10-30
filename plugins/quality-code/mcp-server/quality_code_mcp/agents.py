"""Plugin-style files for other coding agents (GitHub Copilot, OpenAI Codex, Cursor, Gemini CLI), written from the plugin's own commands.

Each file is a thin wrapper: it calls the local MCP server's tool for that command and follows what the tool returns, so the instructions,
the plugin folder and the scripts stay the one source in the plugin. Local only: the server runs over stdio on this machine.
Nothing is written unless `write` is set, and an existing file is never replaced."""
from __future__ import annotations

import json
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

from .catalog import Command, load_commands, plugin_root

TOOLS = ("copilot", "codex", "cursor", "gemini")

# Commands that need Claude Code itself: routine schedules with Claude's scheduler, check-update updates through Claude's plugin manager.
CLAUDE_ONLY = {"routine", "check-update"}

SERVER = "quality-code"
PREFIX = "quality-code-"


@dataclass(frozen=True)
class Planned:
    path: str  # relative to the target folder
    content: str


def _server() -> dict:
    env = {"QUALITY_CODE_PLUGIN_ROOT": str(plugin_root())}
    script = shutil.which("quality-code-mcp")
    if not script and Path(sys.argv[0]).name == "quality-code-mcp":
        script = str(Path(sys.argv[0]).resolve())
    if script:
        return {"command": script, "args": [], "env": env}
    return {"command": sys.executable, "args": ["-m", "quality_code_mcp"], "env": env}  # not installed as a command: run it as a module


def _commands(root: Path) -> list[Command]:
    return [c for c in load_commands(root) if c.name not in CLAUDE_ONLY]


def _body(c: Command, where: str) -> str:
    """The wrapper text: which tool to call, with what, and the rule to follow what it returns."""
    hint = f" Arguments: {c.argument_hint}." if c.argument_hint else ""
    return (
        f"Run Quality Code's `{c.name}` command: {c.description}{hint}\n\n"
        f"1. Call the MCP tool `{c.tool_name}` of the `{SERVER}` server. Pass what the user typed after the command as `arguments` (empty when nothing).\n"
        f"2. The tool returns the command's instructions with this machine's paths filled in. Follow them exactly, step by step, in {where}.\n"
        "3. Scripts run only through the `quality_code_run_script` tool, exactly as the instructions write them.\n"
    )


def _oneline(text: str) -> str:
    return " ".join(text.split())


def _q(text: str) -> str:
    """A double-quoted YAML or TOML string."""
    return json.dumps(_oneline(text), ensure_ascii=False)


def copilot(root: Path) -> list[Planned]:
    """VS Code: the MCP server in .vscode/mcp.json and one prompt file per command (run it with /quality-code-<name> in agent mode)."""
    cfg = {"servers": {SERVER: {"type": "stdio", **_server()}}}
    out = [Planned(".vscode/mcp.json", json.dumps(cfg, indent=2) + "\n")]
    for c in _commands(root):
        hint = c.argument_hint or "arguments"
        text = (f"---\nmode: agent\ndescription: {_q('Quality Code ' + c.name + ': ' + c.description)}\n---\n\n"
                + _body(c, "this chat").replace("what the user typed after the command", "${input:arguments:" + hint.replace("}", "") + "}"))
        out.append(Planned(f".github/prompts/{PREFIX}{c.name}.prompt.md", text))
    return out


def codex(root: Path) -> list[Planned]:
    """Codex: one skill per command in .agents/skills/. The MCP server goes in ~/.codex/config.toml (printed, never written for you)."""
    out = []
    for c in _commands(root):
        text = f"---\nname: {PREFIX}{c.name}\ndescription: {_q(c.description)}\n---\n\n" + _body(c, "this session")
        out.append(Planned(f".agents/skills/{PREFIX}{c.name}/SKILL.md", text))
    return out


def codex_toml() -> str:
    s = _server()
    return (f"[mcp_servers.{SERVER}]\ncommand = {json.dumps(s['command'])}\nargs = []\n\n"
            f"[mcp_servers.{SERVER}.env]\nQUALITY_CODE_PLUGIN_ROOT = {json.dumps(s['env']['QUALITY_CODE_PLUGIN_ROOT'])}\n")


def cursor(root: Path) -> list[Planned]:
    """Cursor: the MCP server in .cursor/mcp.json and one command file each (type /quality-code-<name> in chat)."""
    out = [Planned(".cursor/mcp.json", json.dumps({"mcpServers": {SERVER: _server()}}, indent=2) + "\n")]
    for c in _commands(root):
        out.append(Planned(f".cursor/commands/{PREFIX}{c.name}.md", f"# Quality Code: {c.name}\n\n" + _body(c, "this chat")))
    return out


def gemini(root: Path) -> list[Planned]:
    """Gemini CLI: an extension folder, quality-code-gemini/, with the MCP server and one command each (/quality-code:<name>)."""
    manifest = {"name": SERVER, "version": _version(root), "description": "Quality Code: from a Jira ticket to tests you can trust.", "mcpServers": {SERVER: _server()}}
    out = [Planned("quality-code-gemini/gemini-extension.json", json.dumps(manifest, indent=2) + "\n")]
    for c in _commands(root):
        prompt = _body(c, "this session").replace("what the user typed after the command", "`{{args}}`")
        out.append(Planned(f"quality-code-gemini/commands/{SERVER}/{c.name}.toml", f"description = {_q(c.description)}\nprompt = {json.dumps(prompt, ensure_ascii=False)}\n"))
    return out


def _version(root: Path) -> str:
    try:
        return json.loads((root / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")).get("version", "0.0.0")
    except (OSError, ValueError):
        return "0.0.0"


PLANS = {"copilot": copilot, "codex": codex, "cursor": cursor, "gemini": gemini}

NEXT = {
    "copilot": "Open the folder in VS Code, start the quality-code server from .vscode/mcp.json, and in Copilot agent mode type /quality-code-spec (or any /quality-code-<command>).",
    "codex": "Add the TOML below to ~/.codex/config.toml, restart Codex, then call a skill, for example $quality-code-spec.",
    "cursor": "Reload Cursor, enable the quality-code server under Settings, MCP, then type /quality-code-spec (or any /quality-code-<command>) in chat.",
    "gemini": "Run `gemini extensions link <folder>/quality-code-gemini` (or copy that folder to ~/.gemini/extensions/), restart Gemini CLI, then type /quality-code:spec.",
}


def init(tool: str, target: Path, *, write: bool, root: Path | None = None) -> tuple[list[str], list[str]]:
    """Plans the files of `tool` under `target`; with `write`, writes those that do not exist yet. Returns (written or planned, skipped)."""
    if tool not in PLANS:
        raise ValueError(f"unknown tool {tool!r}: one of {', '.join(TOOLS)}")
    done, skipped = [], []
    for f in PLANS[tool](root or plugin_root()):
        dest = target / f.path
        if dest.exists():
            skipped.append(f.path)
            continue
        if write:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(f.content, encoding="utf-8")
        done.append(f.path)
    return done, skipped


def report(tool: str, target: Path, *, write: bool) -> str:
    done, skipped = init(tool, target, write=write)
    lines = [f"quality-code for {tool}: {len(done)} file{'s' if len(done) != 1 else ''} {'written' if write else 'to write (add --write)'} in {target}"]
    lines += [f"  {p}" for p in done[:6]] + ([f"  ... and {len(done) - 6} more"] if len(done) > 6 else [])
    if skipped:
        lines.append(f"kept {len(skipped)} existing file{'s' if len(skipped) != 1 else ''}, not replaced (first: {skipped[0]})")
    lines.append("Local only: the server runs on this machine over stdio. Not available here: " + ", ".join(sorted(CLAUDE_ONLY)) + " (they need Claude Code).")
    lines.append("")
    lines.append(NEXT[tool])
    if tool == "codex":
        lines += ["", codex_toml().rstrip()]
    return "\n".join(lines)
