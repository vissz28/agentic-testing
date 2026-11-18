"""The shared server's Jira setup, from its environment: there is no person to run /quality-code:setup, so the server hands the scripts a config in their environment (no file is written)."""
from __future__ import annotations

import json
import re

SITE = re.compile(r"^https://[^/\s]+$")
KEY = re.compile(r"^[A-Z][A-Z0-9_]*$")
DEFAULT_SITE = "https://teamsystem.atlassian.net"
ANY_PROJECT = "*"  # no project list: any key counts, the person's own Jira access decides what they see


class JiraConfigError(ValueError):
    pass


def settings_from_env(env: dict[str, str]) -> tuple[str, list[str]]:
    """(site, project keys) from QUALITY_CODE_JIRA_SITE and QUALITY_CODE_JIRA_PROJECTS (comma-separated, or *); with neither set, TeamSystem's Jira and any project."""
    site = (env.get("QUALITY_CODE_JIRA_SITE") or "").strip().rstrip("/")
    projects = [p.strip() for p in (env.get("QUALITY_CODE_JIRA_PROJECTS") or "").split(",") if p.strip()]
    if not site and not projects:
        return DEFAULT_SITE, [ANY_PROJECT]  # nothing set: no setup run is needed
    if not site or not projects:
        raise JiraConfigError("set both QUALITY_CODE_JIRA_SITE (https://example.atlassian.net) and QUALITY_CODE_JIRA_PROJECTS (ABC,DEF), or neither")
    if not SITE.match(site):
        raise JiraConfigError(f"QUALITY_CODE_JIRA_SITE must be an https address with no path, like https://example.atlassian.net (found {site!r})")
    for p in projects:
        if p != ANY_PROJECT and not KEY.match(p):
            raise JiraConfigError(f"QUALITY_CODE_JIRA_PROJECTS: {p!r} must be upper-case letters, digits and _, like ABC")
    return site, projects


def config_json(site: str, projects: list[str]) -> str:
    """The config the scripts read, as one JSON string for QUALITY_CODE_CONFIG_JSON: nothing is written to disk."""
    site = site.rstrip("/")
    projects = [p for p in projects if p == ANY_PROJECT or KEY.match(p)]
    if not SITE.match(site) or not projects:
        raise JiraConfigError("this Atlassian account has no Jira site or no visible project")
    return json.dumps({"version": 2, "frontend": "playwright", "jira": {"site": site, "projects": projects}})


def default_config_json(env: dict[str, str]) -> str:
    """The server's own default (QUALITY_CODE_JIRA_SITE/PROJECTS, else TeamSystem's Jira and any project), used when the person has no Atlassian sign-in."""
    return config_json(*settings_from_env(env))
