"""The MCP server: one tool per command, one to run the plugin's scripts, one to read its guides."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from .catalog import Command, list_guides, list_scripts, load_commands, plugin_root, render

TIMEOUT_S = 900
MAX_OUT = 200_000


def build(root: Path | None = None) -> MCPServer:
    root = root or plugin_root()
    commands = load_commands(root)
    scripts = set(list_scripts(root))
    guides = set(list_guides(root))
    server = MCPServer(
        "quality-code",
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
        work = Path(cwd).expanduser() if cwd else Path.cwd()
        if not work.is_dir():
            return f"error: {work} is not a folder."
        env = {**os.environ, "CLAUDE_PLUGIN_ROOT": str(root), "CLAUDE_PROJECT_DIR": str(work.resolve())}
        try:
            p = subprocess.run([node, str(root / "bin" / name), *(args or [])], cwd=work, env=env, capture_output=True, text=True, timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return f"error: {name} did not finish in {TIMEOUT_S} seconds."
        out = (p.stdout + p.stderr)[:MAX_OUT]
        return f"{out}\n[exit code {p.returncode}]"

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


def render_guide(root: Path, key: str) -> str:
    return (root / "guides" / f"{key}.md").read_text(encoding="utf-8").replace("${CLAUDE_PLUGIN_ROOT}", str(root))


def _guide_resource(root: Path, key: str):
    from mcp.server.mcpserver.resources import FunctionResource

    return FunctionResource(uri=f"quality-code://guides/{key}", name=f"guide-{key}", description=f"Quality Code guide: {key}", mime_type="text/markdown", fn=lambda: render_guide(root, key))


def main() -> None:
    build().run("stdio")


if __name__ == "__main__":
    main()
