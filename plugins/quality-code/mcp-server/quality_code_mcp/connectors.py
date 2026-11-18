"""What the person's own Claude has to be connected to, and the exact addresses: the commands read Jira, GitLab and GitHub through the person's own connectors,
so no token is stored here and none is pasted in the chat."""
from __future__ import annotations

from typing import Iterable
from urllib.parse import urlparse

JIRA_SITE = "https://teamsystem.atlassian.net"
JIRA_MCP = "https://mcp.atlassian.com/v2/mcp"
GITLAB_API = "https://biosphere.teamsystem.com/api/v4"
GITHUB_HOST = "https://teamsystem.ghe.com"


def _clean(value: str | None, default: str) -> str:
    return ((value or "").strip() or default).rstrip("/")


def addresses(env: dict[str, str]) -> dict[str, str]:
    """The address of each service and of the connector to add for it."""
    api = _clean(env.get("QUALITY_CODE_GITLAB_API_URL"), GITLAB_API)
    host = _clean(env.get("QUALITY_CODE_GITHUB_URL"), GITHUB_HOST)
    name = urlparse(host).hostname or ""
    gh_mcp = f"https://copilot-api.{name[: -len('.ghe.com')]}.ghe.com/mcp" if name.endswith(".ghe.com") else f"{host}/mcp"
    gl_host = urlparse(api)
    return {
        "jira_site": _clean(env.get("QUALITY_CODE_JIRA_SITE"), JIRA_SITE), "jira_mcp": JIRA_MCP,
        "gitlab_host": f"{gl_host.scheme}://{gl_host.netloc}", "gitlab_mcp": f"{api}/mcp",
        "github_host": host, "github_mcp": gh_mcp,
    }


def handled(server_tools: Iterable[str]) -> dict[str, str]:
    """The services this server signs the person in to itself (their tools exist), with the tool to use: nothing to add for them."""
    names = {str(n) for n in server_tools}
    out = {}
    if any(n.startswith("quality_code_jira_") for n in names):
        out["Jira"] = "quality_code_jira_*"
    if "quality_code_gitlab_mr" in names:
        out["GitLab"] = "quality_code_gitlab_mr"
    if "quality_code_github_pr" in names:
        out["GitHub"] = "quality_code_github_pr"
    return out


def block(env: dict[str, str], server_tools: Iterable[str] = ()) -> str:
    a = addresses(env)
    own = handled(server_tools)
    lines = {
        "Jira": f"- Jira: the Atlassian connector, `{a['jira_mcp']}`, for {a['jira_site']}\n",
        "GitLab": f"- GitLab: GitLab's own MCP server, `{a['gitlab_mcp']}`, for {a['gitlab_host']}\n",
        "GitHub": f"- GitHub: `{a['github_mcp']}`, for {a['github_host']} (this GitHub address is not verified; if it does not connect, say so)\n",
    }
    todo = "".join(v for k, v in lines.items() if k not in own)
    done = "".join(f"- {k}: already signed in through Quality Code: use `{t}`, nothing to add\n" for k, t in own.items())
    return (
        "## Connect what is missing\n\n"
        "Jira, GitLab and GitHub are read as the signed-in person. Before a step that needs one, check that its tools exist. "
        + (f"Signed in through Quality Code already:\n\n{done}\n" if done else "")
        + ("If a tool is missing, stop that step and tell the person to add the connector in Claude (Settings, Connectors, or `/mcp`):\n\n" + todo + "\n" if todo else "")
        + "They sign in in the browser. Never ask for a token, key or password in the chat.\n"
    )


def tool_text(env: dict[str, str], server_tools: Iterable[str] = ()) -> str:
    a = addresses(env)
    own = handled(server_tools)
    rows = [("Jira", a["jira_site"], a["jira_mcp"]), ("GitLab", a["gitlab_host"], a["gitlab_mcp"]), ("GitHub", a["github_host"], a["github_mcp"])]
    lines = ["Service | Instance | Status", "--- | --- | ---"]
    for name, inst, mcp in rows:
        lines.append(f"{name} | {inst} | " + (f"signed in through Quality Code (tool {own[name]}), nothing to add" if name in own else f"add the connector {mcp}"))
    note = "\n\nAdd a connector in Claude (Settings, Connectors, or /mcp) and sign in in the browser. No token is ever pasted in the chat."
    return "\n".join(lines) + note + ("" if "GitHub" in own else " The GitHub address is not verified.")
