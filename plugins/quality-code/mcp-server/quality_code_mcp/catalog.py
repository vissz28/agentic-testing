"""Reads the plugin's commands, guides and scripts from its folder. Nothing is copied: the plugin stays the one source."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

# Scripts that must not be run by a client: the connector launcher starts third-party servers.
HIDDEN_SCRIPTS = {"mcp-launch.mjs"}


def plugin_root() -> Path:
    """QUALITY_CODE_PLUGIN_ROOT, else the plugin this server sits in (plugins/quality-code/mcp-server/..)."""
    env = os.environ.get("QUALITY_CODE_PLUGIN_ROOT")
    root = Path(env) if env else Path(__file__).resolve().parents[2]
    if not (root / "commands").is_dir():
        raise SystemExit(f"quality-code-mcp: no commands/ folder in {root}. Set QUALITY_CODE_PLUGIN_ROOT to the quality-code plugin folder.")
    return root.resolve()


@dataclass(frozen=True)
class Command:
    name: str  # "ticket-eval"
    description: str
    argument_hint: str
    body: str  # the prompt, frontmatter removed

    @property
    def tool_name(self) -> str:
        return "quality_code_" + self.name.replace("-", "_")


_FRONT = re.compile(r"\A---\n(.*?)\n---\n?", re.S)


def parse_command(name: str, text: str) -> Command:
    m = _FRONT.match(text)
    meta: dict[str, str] = {}
    if m:
        for line in m.group(1).splitlines():
            k, sep, v = line.partition(":")
            if sep and not line.startswith(" "):
                meta[k.strip()] = v.strip()
    return Command(name, meta.get("description", ""), meta.get("argument-hint", ""), text[m.end():] if m else text)


def load_commands(root: Path) -> list[Command]:
    return [parse_command(p.stem, p.read_text(encoding="utf-8")) for p in sorted((root / "commands").glob("*.md"))]


def list_guides(root: Path) -> list[str]:
    d = root / "guides"
    return sorted(p.stem for p in d.glob("*.md")) if d.is_dir() else []


def list_scripts(root: Path) -> list[str]:
    d = root / "bin"
    return sorted(p.name for p in d.glob("*.mjs") if p.name not in HIDDEN_SCRIPTS) if d.is_dir() else []


def render(cmd: Command, root: Path, arguments: str = "") -> str:
    """The command as a prompt for the calling model: the plugin folder and arguments filled in, plus how this server replaces Claude Code's tools."""
    body = cmd.body.replace("${CLAUDE_PLUGIN_ROOT}", str(root)).replace("$ARGUMENTS", arguments)
    body = re.sub(r"\$\{user_config\.([a-z_]+)\}", lambda m: os.environ.get("QUALITY_CODE_" + m.group(1).upper(), ""), body)
    note = (
        f"# /quality-code:{cmd.name}\n\n"
        f"Arguments: {arguments or '(none)'}\n\n"
        "Follow the instructions below. Where they say to run `node \"<plugin>/bin/<script>.mjs\" <args>`, call the tool "
        "`quality_code_run_script` with the script name and each argument as its own list item (no shell). "
        "Where they point to a guide file, call `quality_code_guide` with its name. "
        "Jira, GitLab, Figma and file tools are the ones your own client offers.\n\n---\n\n"
    )
    return note + body
