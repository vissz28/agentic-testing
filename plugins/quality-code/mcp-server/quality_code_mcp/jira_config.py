"""The shared server's Jira setup, from its environment: there is no person to run /quality-code:setup, so the server writes the config the scripts read."""
from __future__ import annotations

import json
import re
from pathlib import Path

SITE = re.compile(r"^https://[^/\s]+$")
KEY = re.compile(r"^[A-Z][A-Z0-9_]*$")
CONFIG_REL = Path(".claude") / "quality-code.json"


class JiraConfigError(ValueError):
    pass


def settings_from_env(env: dict[str, str]) -> tuple[str, list[str]] | None:
    """(site, project keys) from QUALITY_CODE_JIRA_SITE and QUALITY_CODE_JIRA_PROJECTS (comma-separated); None when neither is set."""
    site = (env.get("QUALITY_CODE_JIRA_SITE") or "").strip().rstrip("/")
    projects = [p.strip() for p in (env.get("QUALITY_CODE_JIRA_PROJECTS") or "").split(",") if p.strip()]
    if not site and not projects:
        return None
    if not site or not projects:
        raise JiraConfigError("set both QUALITY_CODE_JIRA_SITE (https://example.atlassian.net) and QUALITY_CODE_JIRA_PROJECTS (ABC,DEF), or neither")
    if not SITE.match(site):
        raise JiraConfigError(f"QUALITY_CODE_JIRA_SITE must be an https address with no path, like https://example.atlassian.net (found {site!r})")
    for p in projects:
        if not KEY.match(p):
            raise JiraConfigError(f"QUALITY_CODE_JIRA_PROJECTS: {p!r} must be upper-case letters, digits and _, like ABC")
    return site, projects


def write_config(project: Path, env: dict[str, str]) -> Path | None:
    """Write <project>/.claude/quality-code.json for the Jira-only scripts when the Jira variables are set. The variables win on every start."""
    s = settings_from_env(env)
    if not s:
        return None
    site, projects = s
    path = project / CONFIG_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 2, "frontend": "playwright", "jira": {"site": site, "projects": projects}}, indent=2) + "\n", encoding="utf-8")
    return path
