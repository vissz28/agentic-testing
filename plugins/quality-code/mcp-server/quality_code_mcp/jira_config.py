"""The shared server's Jira setup, from its environment: there is no person to run /quality-code:setup, so the server writes the config the scripts read."""
from __future__ import annotations

import json
import re
from pathlib import Path

SITE = re.compile(r"^https://[^/\s]+$")
KEY = re.compile(r"^[A-Z][A-Z0-9_]*$")
CONFIG_REL = Path(".claude") / "quality-code.json"
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


def write_person_config(base: Path, oid: str, site: str, projects: list[str]) -> Path:
    """The scripts' working folder for one signed-in person: <base>/people/<hash of oid>/ with a config built from THEIR Jira site and visible projects."""
    import hashlib

    site = site.rstrip("/")
    projects = [p for p in projects if KEY.match(p)]
    if not SITE.match(site) or not projects:
        raise JiraConfigError("this Atlassian account has no Jira site or no visible project")
    folder = base / "people" / hashlib.sha256(oid.encode()).hexdigest()[:20]
    path = folder / CONFIG_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 2, "frontend": "playwright", "jira": {"site": site, "projects": projects}}, indent=2) + "\n", encoding="utf-8")
    return folder


def write_config(project: Path, env: dict[str, str]) -> Path:
    """Write <project>/.claude/quality-code.json for the Jira-only scripts when the Jira variables are set. The variables win on every start."""
    site, projects = settings_from_env(env)
    path = project / CONFIG_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 2, "frontend": "playwright", "jira": {"site": site, "projects": projects}}, indent=2) + "\n", encoding="utf-8")
    return path
