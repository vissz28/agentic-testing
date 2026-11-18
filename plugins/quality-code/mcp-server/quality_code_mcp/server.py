"""The MCP server: one tool per command, one to run the plugin's scripts, one to read its guides."""
from __future__ import annotations

import argparse
import json
import sys
import asyncio
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path

from mcp.server.mcpserver import MCPServer
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions
from mcp.types import Icon
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from urllib.parse import urlparse

from . import agents, connectors, github, gitlab, jira_config, web
from .entra import EntraConfigError, EntraSettings, EntraTokenVerifier, settings_from_env
from . import connector as connector_mod
from .catalog import Command, list_guides, list_scripts, load_commands, plugin_root, render, server_tool_names

TIMEOUT_S = 900
MAX_OUT = 200_000
MAX_RUNNING = 4  # script runs at once on a shared server

# Shared (HTTP) server: only the Jira-only QA/PO commands, the read-only scripts they call and their guides.
# Anything that needs a checkout (spec, run commands, seed, xray, qa, setup, config, kpi) stays local.
REMOTE_COMMANDS = {"ticket", "help"}
REMOTE_SCRIPTS = {"ticket.mjs", "branch.mjs", "help.mjs"}
NEEDS_REPO_NOTICE = ("NOTE: this command needs your repo and scripts that the shared Quality Code server does not run (it runs only the read-only ticket, branch and help scripts, in one fixed folder). "
                     "Use the instructions as a guide, but run the command itself in Claude Code with the Quality Code plugin, or with the local server (quality-code-mcp over stdio). Do not call quality_code_run_script for the other scripts here.")
REMOTE_GUIDES = {"connectors", "save-place", "ticket-eval", "tickets-eval"}


def _newest_first(dirs) -> list[Path]:
    """Version folders (v20.11.0, 9.0.0) newest first: a text sort would put v9 before v20."""
    def key(d: Path):
        nums = [int(x) for x in re.findall(r"\d+", d.name)[:3]]
        return nums + [0] * (3 - len(nums))
    return sorted(dirs, key=key, reverse=True)


def find_node() -> str | None:
    """A Node.js 18+ `node`: PATH first, then the usual per-user and system install dirs."""
    found = shutil.which("node")
    if found:
        return found
    home = Path.home()
    names = ("node.exe",) if os.name == "nt" else ("node",)
    dirs: list[Path] = []
    if os.name == "nt":
        for var in ("ProgramFiles", "ProgramFiles(x86)"):
            if os.environ.get(var):
                dirs.append(Path(os.environ[var]) / "nodejs")
        local = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local")
        dirs += [local / "Programs" / "nodejs", local / "Volta" / "bin", home / ".volta" / "bin", home / "scoop" / "apps" / "nodejs" / "current"]
        if os.environ.get("NVM_SYMLINK"):
            dirs.append(Path(os.environ["NVM_SYMLINK"]))
        roots = [Path(p) for p in (os.environ.get("NVM_HOME"), Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming") / "nvm", "C:\\nvm", "C:\\nvm4w\\nvm") if p]
        users = Path(os.environ.get("SystemDrive", "C:") + "\\Users")
        if users.is_dir():
            for u in sorted(users.iterdir()):
                dirs += [u / "AppData" / "Local" / "Programs" / "nodejs", u / ".volta" / "bin", u / "scoop" / "apps" / "nodejs" / "current"]
                roots.append(u / "AppData" / "Roaming" / "nvm")
        for r in roots:
            if r.is_dir():
                dirs += _newest_first(d for d in r.iterdir() if d.is_dir())
    else:
        dirs = [Path("/usr/local/bin"), Path("/opt/homebrew/bin"), home / ".volta" / "bin", home / ".local" / "share" / "fnm" / "aliases" / "default" / "bin"]
        nvm = Path(os.environ.get("NVM_DIR") or home / ".nvm")
        default = nvm / "alias" / "default"  # the version `nvm use` picks in a new shell: try it first
        if default.is_file():
            want = default.read_text().strip().lstrip("v")
            dirs += [d / "bin" for d in (nvm / "versions" / "node").glob("v*") if want and d.name.lstrip("v").startswith(want)]
        dirs += [d / "bin" for d in _newest_first((nvm / "versions" / "node").glob("v*"))]
        dirs += [d / "installation" / "bin" for d in _newest_first((home / ".local" / "share" / "fnm" / "node-versions").glob("v*"))]
    for d in dirs:
        for n in names:
            if (d / n).is_file():
                return str(d / n)
    return None


def build(root: Path | None = None, *, entra: EntraSettings | None = None, verifier: EntraTokenVerifier | None = None, fixed_cwd: Path | None = None, remote: bool = False, web_settings: web.WebSettings | None = None, connector: connector_mod.ConnectorSettings | None = None) -> MCPServer:
    """`remote` is the shared profile: Jira-only tools, scripts locked to `fixed_cwd`, MAX_RUNNING cap, open /health."""
    root = root or plugin_root()
    commands = load_commands(root)
    scripts = set(list_scripts(root)) & (REMOTE_SCRIPTS if remote else set(list_scripts(root)))
    guides = set(list_guides(root)) & (REMOTE_GUIDES if remote else set(list_guides(root)))
    if remote and not fixed_cwd:
        raise ValueError("the shared server runs its scripts in one folder: pass fixed_cwd")
    running = threading.BoundedSemaphore(MAX_RUNNING)
    extra: dict = {}
    provider = None
    if entra and connector and web_settings:
        # Claude's connector sign-in: this server issues the tokens (Entra checks who the person is); Entra's own tokens still work on /mcp.
        provider = connector_mod.ConnectorProvider(connector, verifier or EntraTokenVerifier(entra))
        extra = {
            "auth": AuthSettings(issuer_url=connector.url, resource_server_url=connector.url, required_scopes=None, validate_token_resource=False,
                                 client_registration_options=ClientRegistrationOptions(enabled=True)),
            "auth_server_provider": provider,
        }
    elif entra:
        extra = {
            "auth": AuthSettings(issuer_url=entra.issuer_url, resource_server_url=entra.public_url, required_scopes=None, validate_token_resource=False),
            "token_verifier": verifier or EntraTokenVerifier(entra),
        }
    if entra:
        extra["icons"] = [Icon(src=f"{entra.public_url.rstrip('/')}/static/quality-code.png", mime_type="image/png", sizes=["512x512"])]  # what Claude shows for the connector
    server = MCPServer(
        "quality-code",
        **extra,
        instructions=(
            "Quality Code: from a Jira ticket to tests you can trust. Each quality_code_<command> tool returns that command's "
            "instructions for you to follow. Scripts do the scoring and checking: run them with quality_code_run_script, never compute a score yourself."
        ),
    )

    def needs_repo(cmd: Command) -> bool:
        """On the shared server only the Jira-only commands can run their scripts; the others need the person's repo."""
        return remote and cmd.name not in REMOTE_COMMANDS

    offered: set[str] = set()  # the sign-in tools this server really has; filled below, read when a command is called

    def command_tool(cmd: Command):
        def run(arguments: str = "") -> str:
            body = render(cmd, root, arguments, server_tools=server_tool_names(offered), connectors=connectors.block(os.environ, offered) if remote else "")
            return f"{NEEDS_REPO_NOTICE}\n\n{body}" if needs_repo(cmd) else body

        run.__name__ = cmd.tool_name
        return run

    for cmd in commands:
        hint = f" Arguments: {cmd.argument_hint}" if cmd.argument_hint else ""
        lead = "Needs your repo: here it returns the instructions only, and its scripts run in Claude Code with the plugin or in the local server. " if needs_repo(cmd) else ""
        server.add_tool(
            command_tool(cmd),
            name=cmd.tool_name,
            description=f"{lead}/quality-code:{cmd.name}: {cmd.description}{hint}. Returns the instructions to follow; pass the command's arguments as one string.",
            annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False),
        )

    def quality_code_run_script(script: str, args: list[str] | None = None, cwd: str | None = None) -> str:
        """Run one of the plugin's checked scripts (node bin/<script>) in the project folder `cwd`. Each argument is its own list item."""
        return run_script(script, args, fixed_cwd or (Path(cwd).expanduser() if cwd else Path.cwd()))

    def run_script(script: str, args: list[str] | None, work: Path) -> str:
        name = script if script.endswith(".mjs") else script + ".mjs"
        if name not in scripts:
            return f"error: unknown script {script!r}. Scripts: {', '.join(sorted(scripts))}"
        node = find_node()
        if not node:
            return "error: Node.js 18 or later is needed to run Quality Code's scripts, and `node` was not found."
        if not work.is_dir():
            return f"error: {work} is not a folder."
        env = {**os.environ, "CLAUDE_PLUGIN_ROOT": str(root), "CLAUDE_PROJECT_DIR": str(work.resolve())}
        if not running.acquire(blocking=False):
            return f"error: busy: {MAX_RUNNING} scripts are running already. Try again in a moment."
        try:
            p = subprocess.run([node, str(root / "bin" / name), *(args or [])], cwd=work, env=env, capture_output=True, text=True, timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return f"error: {name} did not finish in {TIMEOUT_S} seconds."
        finally:
            running.release()
        out = (p.stdout + p.stderr)[:MAX_OUT]
        return f"{out}\n[exit code {p.returncode}]"

    def person_folder() -> Path | None:
        """With the Atlassian sign-in, the scripts run in a folder whose config is the person's own Jira site and visible projects (nothing fixed on the server); else None (the shared folder)."""
        from mcp.server.auth.middleware.auth_context import get_access_token

        if not (provider and provider.s.atlassian and fixed_cwd):
            return None
        t = get_access_token()
        who = (t.claims or {}) if t else {}
        link = provider.open_link({"oid": t.subject}, who.get("atl")) if t and who.get("atl") else None
        if not link:
            return None
        try:
            return jira_config.write_person_config(fixed_cwd, t.subject, link.get("site") or "", provider.s.atlassian.project_keys(link))
        except Exception:  # no site, no visible project, Atlassian down: fall back to the shared folder
            return None

    if remote:
        # No `cwd` in the schema: a remote caller never picks the folder.
        def quality_code_run_script_remote(script: str, args: list[str] | None = None) -> str:
            """Run one of the plugin's checked read-only scripts (node bin/<script>). Each argument is its own list item."""
            return run_script(script, args, person_folder() or fixed_cwd)

        server.add_tool(quality_code_run_script_remote, name="quality_code_run_script", annotations=ToolAnnotations(readOnlyHint=False, openWorldHint=True))
        server.custom_route("/health", methods=["GET"])(_health(root, provider is not None))
        if entra:
            server.add_tool(quality_code_whoami, name="quality_code_whoami", annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
        if provider:
            for fn, writes in _upstream_tools(provider):
                server.add_tool(fn, name=fn.__name__, annotations=ToolAnnotations(readOnlyHint=not writes, destructiveHint=False, openWorldHint=True))
                offered.add(fn.__name__)
        if entra:
            web.register(server, web_settings, entra, provider=provider)  # the sign-in view at /; /mcp still needs a bearer token
    else:
        server.add_tool(quality_code_run_script, name="quality_code_run_script", annotations=ToolAnnotations(readOnlyHint=False, openWorldHint=True))

    def quality_code_guide(name: str = "") -> str:
        """Read one of the plugin's guides by name (the commands point to them). With no name, lists them."""
        if not name:
            return "Guides: " + ", ".join(sorted(guides))
        key = name.removesuffix(".md")
        if key not in guides:
            return f"error: no guide {name!r}. Guides: {', '.join(sorted(guides))}"
        return render_guide(root, key)

    if remote:
        def quality_code_connectors() -> str:
            """The connectors the person's own Claude needs for Jira, GitLab and GitHub, with the exact addresses. Read-only; nothing is stored."""
            return connectors.tool_text(dict(os.environ))

        server.add_tool(quality_code_connectors, name="quality_code_connectors", annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))

    server.add_tool(quality_code_guide, name="quality_code_guide", annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))

    for g in sorted(guides):
        server.add_resource(_guide_resource(root, g))
    return server


def _upstream_tools(provider) -> list:
    """(tool, writes) for every service the person signs in to: Jira (Atlassian), GitLab merge requests, GitHub pull requests."""
    s = provider.s
    out = [(fn, fn.__name__ in JIRA_WRITE_TOOLS) for fn in _jira_tools(provider)] if s.atlassian else []
    for client, mod in ((s.gitlab, gitlab), (s.github, github)):
        if client:
            out += [(fn, False) for fn in mod.tools(provider)]
    return out


JIRA_WRITE_TOOLS = {"quality_code_jira_create", "quality_code_jira_comment", "quality_code_jira_transition", "quality_code_jira_edit", "quality_code_jira_link_issues"}


def _jira_tools(provider) -> list:
    """Jira tools that use the signed-in person's own Atlassian access (sealed in their connector token; the server stores nothing).
    The reads are read-only; the writes change Jira as that person and are for after the command's preview and a yes."""
    from mcp.server.auth.middleware.auth_context import get_access_token
    from . import atlassian as atl

    keyed = re.compile(r"[A-Z][A-Z0-9_]*-\d+")

    def link() -> dict | str:
        t = get_access_token()
        who = (t.claims or {}) if t else {}
        opened = provider.open_link({"oid": t.subject}, who.get("atl")) if t and who.get("atl") else None
        return opened or "error: Atlassian is not connected for this sign-in. Remove the Quality Code connector in Claude and add it again; you will be asked to sign in with Atlassian."

    def call(fn, *keys: str):
        """Run fn(client, link) as the person: JSON on success, `error: ...` text on a bad key, no link or an Atlassian error."""
        for k in keys:
            if not keyed.fullmatch(k.strip()):
                return "error: a Jira key looks like ABC-123"
        l = link()
        if isinstance(l, str):
            return l
        try:
            return json.dumps(fn(provider.s.atlassian, l), indent=2)
        except (atl.AtlassianError, ValueError) as e:
            return f"error: {e}"

    def fields_of(text: str) -> dict:
        try:
            v = json.loads(text) if text.strip() else {}
        except ValueError:
            raise ValueError("fields_json must be a JSON object")
        if not isinstance(v, dict):
            raise ValueError("fields_json must be a JSON object")
        return v

    def quality_code_jira_search(jql: str, limit: int = 20) -> str:
        """Search Jira with JQL as the signed-in person (read-only): key, summary, status, type and assignee of up to `limit` issues (at most 50)."""
        return call(lambda c, l: c.search(l, jql, limit))

    def quality_code_jira_issue(key: str, full: bool = False) -> str:
        """Read one Jira issue as the signed-in person (read-only): summary, status, type, assignee, labels, description as text, parent and subtasks. With full: also components, attachments (names only), issue links and the last comments."""
        return call(lambda c, l: c.issue(l, key.strip(), full), key)

    def quality_code_jira_links(key: str) -> str:
        """The web links (remote links) of a Jira issue, such as merge requests and Figma (read-only)."""
        return call(lambda c, l: c.remote_links(l, key.strip()), key)

    def quality_code_jira_projects(query: str = "", limit: int = 20) -> str:
        """The Jira projects the signed-in person can see, filtered by `query` (read-only)."""
        return call(lambda c, l: c.projects(l, query, limit))

    def quality_code_jira_transitions(key: str) -> str:
        """The status changes available now on a Jira issue: id, name and target status (read-only)."""
        return call(lambda c, l: c.transitions(l, key.strip()), key)

    def quality_code_jira_createmeta(project: str, issue_type: str = "") -> str:
        """The issue types of a Jira project; with `issue_type`, that type's fields (id, name, required, allowed values) (read-only)."""
        return call(lambda c, l: c.create_meta(l, project.strip(), issue_type.strip()))

    def quality_code_jira_create(project: str, issue_type: str, summary: str, description: str = "", fields_json: str = "") -> str:
        """CREATES a Jira issue as the signed-in person. Call only after the person saw the preview and said yes. fields_json: extra fields as a JSON object (labels, components, parent, custom fields)."""
        return call(lambda c, l: c.create(l, project.strip(), issue_type.strip(), summary, description, fields_of(fields_json)))

    def quality_code_jira_comment(key: str, text: str) -> str:
        """ADDS a comment to a Jira issue as the signed-in person. Call only after the person saw the preview and said yes."""
        return call(lambda c, l: c.comment(l, key.strip(), text), key)

    def quality_code_jira_transition(key: str, transition_id: str) -> str:
        """CHANGES the status of a Jira issue as the signed-in person (ids from quality_code_jira_transitions). Call only after the person saw the preview and said yes."""
        return call(lambda c, l: c.transition(l, key.strip(), transition_id.strip()), key)

    def quality_code_jira_edit(key: str, fields_json: str) -> str:
        """EDITS fields of a Jira issue as the signed-in person; fields_json is a JSON object of field id to value. Call only after the person saw the preview and said yes."""
        return call(lambda c, l: c.edit(l, key.strip(), fields_of(fields_json)), key)

    def quality_code_jira_link_issues(link_type: str, inward: str, outward: str) -> str:
        """LINKS two Jira issues (for example link type Test, or Defect) as the signed-in person. Call only after the person saw the preview and said yes."""
        return call(lambda c, l: c.link_issues(l, link_type.strip(), inward.strip(), outward.strip()), inward, outward)

    return [quality_code_jira_search, quality_code_jira_issue, quality_code_jira_links, quality_code_jira_projects, quality_code_jira_transitions,
            quality_code_jira_createmeta, quality_code_jira_create, quality_code_jira_comment, quality_code_jira_transition, quality_code_jira_edit,
            quality_code_jira_link_issues]


def quality_code_whoami() -> str:
    """Who is signed in on this connection: name, Microsoft email, and the Jira email and GitLab username the person confirmed when they accepted the rules. Read-only; nothing is stored."""
    from mcp.server.auth.middleware.auth_context import get_access_token

    t = get_access_token()
    if not t:
        return json.dumps({"signed_in": False})
    c = t.claims or {}
    who = {
        "signed_in": bool(t), "name": c.get("name"), "email": c.get("upn"), "jira_email": c.get("jira_email") or c.get("upn"), "gitlab_username": c.get("gitlab_username"),
        "rules_version": c.get("rules"), "via": "claude connector" if c.get("rules") else "microsoft token",
    }
    return json.dumps({k: v for k, v in who.items() if v not in (None, "")}, indent=2)


def _version(root: Path) -> str:
    """The release that runs: the installed package (the image), else the plugin manifest (a checkout)."""
    from importlib.metadata import PackageNotFoundError, version

    try:
        return version("quality-code-mcp")
    except PackageNotFoundError:
        return agents._version(root)


def _health(root: Path, connector: bool):
    """Open /health: the release and whether Claude's connector sign-in is on (the token secret reached the server). Nothing secret."""
    body = {"status": "ok", "version": _version(root), "connector": connector}

    async def health(request):
        from starlette.responses import JSONResponse

        return JSONResponse(body)

    return health


def render_guide(root: Path, key: str) -> str:
    return (root / "guides" / f"{key}.md").read_text(encoding="utf-8").replace("${CLAUDE_PLUGIN_ROOT}", str(root))


def _guide_resource(root: Path, key: str):
    from mcp.server.mcpserver.resources import FunctionResource

    return FunctionResource(uri=f"quality-code://guides/{key}", name=f"guide-{key}", description=f"Quality Code guide: {key}", mime_type="text/markdown", fn=lambda: render_guide(root, key))


def check() -> int:
    """0 when the local server can run: the plugin is found, Node is there, and every command is a tool."""
    problems = []
    try:
        root = plugin_root()
        n = len(asyncio.run(build(root).list_tools()))
        print(f"ok: plugin {root}; {n} tools")
    except SystemExit as e:
        problems.append(str(e))
    node = find_node()
    if node:
        major = subprocess.run([node, "-p", "process.versions.node.split('.')[0]"], capture_output=True, text=True).stdout.strip()
        if major.isdigit() and int(major) < 18:
            problems.append(f"Node.js {major} is too old: Quality Code's scripts need 18 or later.")
        else:
            print(f"ok: node {node} (v{major})")
    else:
        problems.append("Node.js 18 or later is needed to run Quality Code's scripts, and `node` was not found.")
    for p in problems:
        print("problem:", p)
    return 1 if problems else 0


def client_config() -> str:
    """Config for Claude Desktop, Cursor or `.mcp.json`, plus the Claude Code one-liner, with this install's paths."""
    cmd = shutil.which("quality-code-mcp") or str(Path(sys.argv[0]).resolve())
    env = {"QUALITY_CODE_PLUGIN_ROOT": str(plugin_root())}
    cfg = json.dumps({"mcpServers": {"quality-code": {"command": cmd, "args": [], "env": env}}}, indent=2)
    return f"{cfg}\n\n# Claude Code:\nclaude mcp add quality-code --env QUALITY_CODE_PLUGIN_ROOT={env['QUALITY_CODE_PLUGIN_ROOT']} -- {cmd}"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="quality-code-mcp", description="Quality Code MCP server")
    ap.add_argument("--transport", choices=["stdio", "http"], default="stdio", help="stdio (local, no sign-in) or http (needs Entra ID)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--check", action="store_true", help="check Python, Node and the tools, then exit")
    ap.add_argument("--print-config", action="store_true", help="print the config to paste into an MCP client, then exit")
    ap.add_argument("--init", choices=["copilot", "codex", "cursor", "gemini"], help="plugin-style files for that agent (local stdio server), then exit; add --write to write them")
    ap.add_argument("--dir", default=".", help="with --init: the folder to write into (default: here)")
    ap.add_argument("--write", action="store_true", help="with --init: write the files (never replaces an existing one)")
    a = ap.parse_args(argv)
    if a.check:
        raise SystemExit(check())
    if a.print_config:
        print(client_config())
        return
    if a.init:
        from .agents import report
        print(report(a.init, Path(a.dir).resolve(), write=a.write))
        return
    if a.transport == "stdio":
        build().run("stdio")
        return
    try:
        entra = settings_from_env()
    except EntraConfigError as e:
        raise SystemExit(f"quality-code-mcp: {e}")
    project = os.environ.get("QUALITY_CODE_PROJECT_DIR")
    if not project or not Path(project).is_dir():
        raise SystemExit("quality-code-mcp: over http the scripts run in one folder only. Set QUALITY_CODE_PROJECT_DIR to the project folder.")
    try:
        jira_config.write_config(Path(project).resolve(), dict(os.environ))
    except (jira_config.JiraConfigError, OSError) as e:
        raise SystemExit(f"quality-code-mcp: {e}")
    host = urlparse(entra.public_url).netloc
    security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[host, "127.0.0.1:*", "localhost:*"], allowed_origins=[f"https://{host}", "http://127.0.0.1:*", "http://localhost:*"],
    )
    try:
        connector = connector_mod.settings_from_env(entra, dict(os.environ))
    except (connector_mod.ConnectorConfigError, OSError) as e:
        raise SystemExit(f"quality-code-mcp: {e}")
    web_settings = web.settings_from_env(entra, dict(os.environ))
    server = build(entra=entra, fixed_cwd=Path(project).resolve(), remote=True, web_settings=web_settings, connector=connector)
    import uvicorn

    app = web.add_browser_redirect(server.streamable_http_app(host=a.host, transport_security=security), web_settings)
    asyncio.run(uvicorn.Server(uvicorn.Config(app, host=a.host, port=a.port, log_level=server.settings.log_level.lower())).serve())


if __name__ == "__main__":
    main()
