"""The MCP server: one tool per command, one to run the plugin's scripts, one to read its guides."""
from __future__ import annotations

import argparse
import json
import sys
import asyncio
import os
import shutil
import subprocess
import threading
from pathlib import Path

from mcp.server.mcpserver import MCPServer
from mcp.server.auth.settings import AuthSettings
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from urllib.parse import urlparse

from .entra import EntraConfigError, EntraSettings, EntraTokenVerifier, settings_from_env
from .catalog import Command, list_guides, list_scripts, load_commands, plugin_root, render

TIMEOUT_S = 900
MAX_OUT = 200_000
MAX_RUNNING = 4  # script runs at once on a shared server

# What a shared (HTTP) server offers: the Jira-only commands for QA and PO, the read-only scripts they call, the guides they point to.
# Everything that needs a developer's checkout (spec, the run commands, seed, xray, qa, setup, config, kpi) stays on the local server.
REMOTE_COMMANDS = {"ticket", "ticket-eval", "tickets-eval"}
REMOTE_SCRIPTS = {"ticket.mjs", "branch.mjs"}
REMOTE_GUIDES = {"connectors", "save-place"}


def build(root: Path | None = None, *, entra: EntraSettings | None = None, verifier: EntraTokenVerifier | None = None, fixed_cwd: Path | None = None, remote: bool = False) -> MCPServer:
    """`entra` turns on Entra ID verification (HTTP). `remote` is the shared-server profile: only the Jira-only commands and read-only scripts,
    run in `fixed_cwd` (a caller cannot pick the folder), at most MAX_RUNNING at once, and an open /health."""
    root = root or plugin_root()
    commands = [c for c in load_commands(root) if not remote or c.name in REMOTE_COMMANDS]
    scripts = set(list_scripts(root)) & (REMOTE_SCRIPTS if remote else set(list_scripts(root)))
    guides = set(list_guides(root)) & (REMOTE_GUIDES if remote else set(list_guides(root)))
    if remote and not fixed_cwd:
        raise ValueError("the shared server runs its scripts in one folder: pass fixed_cwd")
    running = threading.BoundedSemaphore(MAX_RUNNING)
    extra: dict = {}
    if entra:
        extra = {
            "auth": AuthSettings(issuer_url=entra.issuer_url, resource_server_url=entra.public_url, required_scopes=None, validate_token_resource=False),
            "token_verifier": verifier or EntraTokenVerifier(entra),
        }
    server = MCPServer(
        "quality-code",
        **extra,
        instructions=(
            "Quality Code: from a Jira ticket to tests you can trust. Each quality_code_<command> tool returns that command's "
            "instructions for you to follow. Scripts do the scoring and checking: run them with quality_code_run_script, never compute a score yourself."
        ),
    )

    def command_tool(cmd: Command):
        def run(arguments: str = "") -> str:
            return render(cmd, root, arguments)

        run.__name__ = cmd.tool_name
        return run

    for cmd in commands:
        hint = f" Arguments: {cmd.argument_hint}" if cmd.argument_hint else ""
        server.add_tool(
            command_tool(cmd),
            name=cmd.tool_name,
            description=f"/quality-code:{cmd.name}: {cmd.description}{hint}. Returns the instructions to follow; pass the command's arguments as one string.",
            annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False),
        )

    def quality_code_run_script(script: str, args: list[str] | None = None, cwd: str | None = None) -> str:
        """Run one of the plugin's checked scripts (node bin/<script>) in the project folder `cwd`. Each argument is its own list item."""
        name = script if script.endswith(".mjs") else script + ".mjs"
        if name not in scripts:
            return f"error: unknown script {script!r}. Scripts: {', '.join(sorted(scripts))}"
        node = shutil.which("node")
        if not node:
            return "error: Node.js 18 or later is needed to run Quality Code's scripts, and `node` was not found."
        work = fixed_cwd or (Path(cwd).expanduser() if cwd else Path.cwd())
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

    if remote:
        # No `cwd` in the schema: a remote caller never picks the folder.
        def quality_code_run_script_remote(script: str, args: list[str] | None = None) -> str:
            """Run one of the plugin's checked read-only scripts (node bin/<script>). Each argument is its own list item."""
            return quality_code_run_script(script, args)

        server.add_tool(quality_code_run_script_remote, name="quality_code_run_script", annotations=ToolAnnotations(readOnlyHint=False, openWorldHint=True))
        server.custom_route("/health", methods=["GET"])(_health)
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

    server.add_tool(quality_code_guide, name="quality_code_guide", annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))

    for g in sorted(guides):
        server.add_resource(_guide_resource(root, g))
    return server


async def _health(request):
    from starlette.responses import JSONResponse

    return JSONResponse({"status": "ok"})


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
    node = shutil.which("node")
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
    """The JSON to paste into Claude Desktop, Cursor or `.mcp.json`, plus the Claude Code one-liner, with this install's own paths."""
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
    a = ap.parse_args(argv)
    if a.check:
        raise SystemExit(check())
    if a.print_config:
        print(client_config())
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
    host = urlparse(entra.public_url).netloc
    security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[host, "127.0.0.1:*", "localhost:*"], allowed_origins=[f"https://{host}", "http://127.0.0.1:*", "http://localhost:*"],
    )
    server = build(entra=entra, fixed_cwd=Path(project).resolve(), remote=True)
    asyncio.run(server.run_streamable_http_async(host=a.host, port=a.port, transport_security=security))


if __name__ == "__main__":
    main()
