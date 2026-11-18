"""Reads the plugin's commands, guides and scripts in place, so the plugin stays the single source."""
from __future__ import annotations

import os
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

# Not runnable by a client: the connector launcher starts third-party servers.
HIDDEN_SCRIPTS = {"mcp-launch.mjs"}


def plugin_root() -> Path:
    """QUALITY_CODE_PLUGIN_ROOT, else the plugin folder this server sits in."""
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
                v = v.strip()
                if len(v) > 1 and v[0] == v[-1] == "'":  # a YAML single-quoted value (Copilot needs strict YAML)
                    v = v[1:-1].replace("''", "'")
                meta[k.strip()] = v
    return Command(name, meta.get("description", ""), meta.get("argument-hint", ""), text[m.end():] if m else text)


def load_commands(root: Path) -> list[Command]:
    return [parse_command(p.stem, p.read_text(encoding="utf-8")) for p in sorted((root / "commands").glob("*.md"))]


def list_guides(root: Path) -> list[str]:
    d = root / "guides"
    return sorted(p.stem for p in d.glob("*.md")) if d.is_dir() else []


def list_scripts(root: Path) -> list[str]:
    d = root / "bin"
    return sorted(p.name for p in d.glob("*.mjs") if p.name not in HIDDEN_SCRIPTS) if d.is_dir() else []


# What each tool of this server replaces, so a command uses it instead of the client's own connector operation.
SERVER_TOOL_MAP: dict[str, str] = {
    "quality_code_jira_issue": "getJiraIssue",
    "quality_code_jira_search": "searchJiraIssuesUsingJql",
    "quality_code_jira_links": "getJiraIssueRemoteIssueLinks",
    "quality_code_jira_projects": "getVisibleJiraProjects",
    "quality_code_jira_transitions": "getTransitionsForJiraIssue",
    "quality_code_jira_createmeta": "getJiraProjectIssueTypesMetadata and getJiraIssueTypeMetaWithFields",
    "quality_code_jira_create": "createJiraIssue",
    "quality_code_jira_comment": "addCommentToJiraIssue",
    "quality_code_jira_transition": "transitionJiraIssue",
    "quality_code_jira_edit": "editJiraIssue",
    "quality_code_jira_link_issues": "createIssueLink",
    "quality_code_gitlab_mr": "the GitLab merge request operations",
    "quality_code_github_pr": "the GitHub pull request operations",
}
JIRA_WRITE_TOOLS = ("quality_code_jira_create", "quality_code_jira_comment", "quality_code_jira_transition", "quality_code_jira_edit", "quality_code_jira_link_issues")


def server_tool_names(tool_names: Iterable[str]) -> frozenset[str]:
    """Only the names of this server's tools that replace a client operation; anything else is ignored."""
    return frozenset(n for n in tool_names if n in SERVER_TOOL_MAP)


SLASH = re.compile(r"/quality-code:([a-z][a-z-]*)")


NO_SLASH = False  # the shared (remote) server sets it: it has no slash commands; the plugin's own server keeps them


def deslash(text: str) -> str:
    """On the shared server `/quality-code:ticket` reads `Quality Code ticket` (said after the keyword, in the chat)."""
    if not NO_SLASH:
        return text
    return SLASH.sub(lambda m: f"Quality Code {m.group(1)}", text)


def render(cmd: Command, root: Path, arguments: str = "", server_tools: set[str] | frozenset[str] = frozenset(), connectors: str = "") -> str:
    """The command as a prompt for the calling model: the plugin folder and arguments filled in, plus how this server replaces Claude Code's tools."""
    body = cmd.body.replace("${CLAUDE_PLUGIN_ROOT}", str(root)).replace("$ARGUMENTS", arguments)
    body = re.sub(r"\$\{user_config\.([a-z_]+)\}", lambda m: os.environ.get("QUALITY_CODE_" + m.group(1).upper(), ""), body)
    note = (
        f"# {deslash(f'/quality-code:{cmd.name}')}\n\n"
        f"Arguments: {arguments or '(none)'}\n\n"
        "Follow the instructions below. Where they say to run `node \"<plugin>/bin/<script>.mjs\" <args>`, call the tool "
        "`quality_code_run_script` with the script name and each argument as its own list item (no shell). "
        "Where they point to a guide file, call `quality_code_guide` with its name. "
        "Jira, GitLab, Figma and file tools are the ones your own client offers.\n\n---\n\n"
    )
    if NO_SLASH:
        note = note[: -len("---\n\n")] + (
            "Follow EVERY step of this command and of the guides it points to, to its end, not only the first one, and keep every step on this server: "
            "each script through `quality_code_run_script`, each guide through `quality_code_guide`, and each next command (a `Next:` line, "
            "or a choice the person makes) through `quality_code_direct` with `Quality Code <command> <arguments>`. "
            "When the person answers a card with a number or a word, carry on with the next step of the same command.\n"
            "This server keeps no file: no ticket copy, no audit log, no saved run. Hold them in the chat. A script that changes the ticket prints it on a `TICKET_JSON:` line: "
            "keep that line, and pass its JSON back as `--in '<json>'` wherever the steps say `--in @<ticketsDir>/<KEY>/ticket.json` (and `ticket.mjs sanitize` needs no `--out`; `attach` takes the text itself in place of `@attached.txt`). "
            "Never write a ticket, raw, attached or audit file.\n\n---\n\n"
        )
    present = [n for n in SERVER_TOOL_MAP if n in server_tools]
    if present:
        lines = "".join(f"- `{n}` instead of {SERVER_TOOL_MAP[n]}\n" for n in present)
        extra = "This server offers its own tools: use them instead of your client's connector operations.\n" + lines
        if any(n in JIRA_WRITE_TOOLS for n in present):
            extra += "A Jira write tool changes Jira: show a preview and wait for a clear yes in the chat before calling it.\n"
        if any(n.startswith("quality_code_jira_") for n in present):
            extra += "getAccessibleAtlassianResources and a cloudId are not needed: the server already knows the site.\n"
        note = note[: -len("---\n\n")] + extra + "\n---\n\n"
    if connectors:
        note = note[: -len("---\n\n")] + connectors.rstrip("\n") + "\n\n---\n\n"
    return deslash(note + body)
