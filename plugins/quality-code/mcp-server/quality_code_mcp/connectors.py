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


def block(env: dict[str, str], server_tools: Iterable[str] = ()) -> str:
    a = addresses(env)
    own = any(str(n).startswith("quality_code_jira_") or n in ("quality_code_gitlab_mr", "quality_code_github_pr") for n in server_tools)
    return (
        "## Connect what is missing\n\n"
        "Jira, GitLab and GitHub are read through the person's own connectors, signed in as themselves. Before a step that needs one, check that its tools exist. "
        "If they do not, stop that step and tell the person to add the connector in Claude (Settings, Connectors, or `/mcp`):\n\n"
        f"- Jira: the Atlassian connector, `{a['jira_mcp']}`, for {a['jira_site']}\n"
        f"- GitLab: GitLab's own MCP server, `{a['gitlab_mcp']}`, for {a['gitlab_host']}\n"
        f"- GitHub: `{a['github_mcp']}`, for {a['github_host']} (this GitHub address is not verified; if it does not connect, say so)\n\n"
        "They sign in in the browser. Never ask for a token, key or password in the chat.\n"
        + ("A tool of this server that replaces a connector can be used instead of adding it.\n" if own else "")
    )


def tool_text(env: dict[str, str]) -> str:
    a = addresses(env)
    rows = [("Jira", a["jira_site"], a["jira_mcp"]), ("GitLab", a["gitlab_host"], a["gitlab_mcp"]), ("GitHub", a["github_host"], a["github_mcp"])]
    lines = ["Service | Instance | Connector to add", "--- | --- | ---", *(" | ".join(r) for r in rows)]
    return "\n".join(lines) + "\n\nAdd it in Claude (Settings, Connectors, or /mcp) and sign in in the browser. No token is ever pasted in the chat. The GitHub address is not verified."
