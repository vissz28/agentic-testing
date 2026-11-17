"""GitHub for the shared server: the person signs in with GitHub (an OAuth app) and the server reads pull requests as them, read-only.

The tokens are never stored: they are sealed (vault.py) into the connector tokens. GitHub tokens either do not expire (the default for an OAuth app:
the link then has no `exp` and no refresh token) or expire and come with a refresh token (when the app expires user tokens)."""
from __future__ import annotations

import json
import re
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any

from .webclient import Http

KEY, SLUG, NAME = "gh", "github", "GitHub"
SCOPES = "repo read:user"
VIEW = ("at", "exp")  # what the access token carries of the link (never the refresh token)
SKEW = 60  # an access token this close to its end is treated as expired
MAX_FILES = 200
PAGE = 100
MAX_DIFFS = 5
DEFAULT_URL = "https://github.com"
HOST = re.compile(r"^https://[^/\s]+$")
NOT_CONNECTED = "error: GitHub is not connected for this sign-in. Remove the Quality Code connector in Claude and add it again; you will be asked to sign in with GitHub."


class GitHubError(RuntimeError):
    pass


class GitHubConfigError(ValueError):
    pass


def real_http(method: str, url: str, headers: dict, body: dict | None):
    from .webclient import real_http as call

    return call(method, url, headers, body, err=GitHubError, name="GitHub")


@dataclass(frozen=True)
class GitHubSettings:
    client_id: str
    client_secret: str
    url: str = DEFAULT_URL  # the GitHub host; an Enterprise Server is https://github.example.com (its API is <url>/api/v3)
    http: Http = real_http

    @property
    def host(self) -> str:
        return urllib.parse.urlparse(self.url).netloc.lower()

    @property
    def api(self) -> str:
        return "https://api.github.com" if self.host == "github.com" else f"{self.url.rstrip('/')}/api/v3"

    def authorize_url(self, redirect_uri: str, state: str) -> str:
        q = {"client_id": self.client_id, "redirect_uri": redirect_uri, "scope": SCOPES, "state": state}
        return f"{self.url.rstrip('/')}/login/oauth/authorize?{urllib.parse.urlencode(q)}"

    def _token(self, body: dict) -> dict:
        r = self.http("POST", f"{self.url.rstrip('/')}/login/oauth/access_token", {"Accept": "application/json"}, {"client_id": self.client_id, "client_secret": self.client_secret, **body})
        if not isinstance(r, dict) or r.get("error") or not r.get("access_token"):
            raise GitHubError("GitHub gave no access token")
        return r

    def _pack(self, r: dict, old_refresh: str | None = None) -> dict:
        out: dict[str, Any] = {"at": r["access_token"]}
        rt = r.get("refresh_token") or old_refresh
        if r.get("expires_in"):  # an expiring token; a non-expiring one has neither exp nor refresh token
            out["exp"] = int(time.time()) + int(r["expires_in"])
            out["rt"] = rt
        return out

    def link(self, code: str, redirect_uri: str) -> dict:
        """After the person accepted at GitHub: the token (and its refresh token when it expires)."""
        return self._pack(self._token({"code": code, "redirect_uri": redirect_uri}))

    def refresh(self, link: dict) -> dict:
        if not link.get("exp") and not link.get("rt"):
            return link  # a token that does not expire has nothing to refresh
        if not link.get("rt"):
            raise GitHubError("The GitHub link has no refresh token: sign in again")
        r = self._token({"grant_type": "refresh_token", "refresh_token": link["rt"]})
        return self._pack(r, link["rt"])

    # -- reads with a link (never a write)
    def _get(self, link: dict, path: str, params: dict | None = None):
        if link.get("exp") and int(link["exp"]) - SKEW < time.time():
            raise GitHubError("The GitHub access has expired: reconnect the connector")
        q = f"?{urllib.parse.urlencode(params)}" if params else ""
        return self.http("GET", f"{self.api}/{path}{q}", {"Authorization": f"Bearer {link['at']}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}, None)

    def parse_pr(self, url: str) -> tuple[str, str, int]:
        """(owner, repo, number) of https://<host>/<owner>/<repo>/pull/<n>; any other host or shape is refused, so the person's token goes nowhere else."""
        u = urllib.parse.urlparse((url or "").strip())
        parts = [p for p in u.path.split("/") if p]
        if u.scheme != "https" or u.netloc.lower() != self.host:
            raise GitHubError(f"only pull requests on {self.host} are read")
        if len(parts) < 4 or parts[2] != "pull" or not parts[3].isdigit():
            raise GitHubError(f"a pull request address looks like https://{self.host}/owner/repo/pull/123")
        owner, repo = parts[0], parts[1]
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", owner) or not re.fullmatch(r"[A-Za-z0-9_.-]+", repo):
            raise GitHubError("that owner or repository name is not valid")
        return owner, repo, int(parts[3])

    def pull(self, link: dict, url: str, diff_paths: list[str] | None = None) -> dict:
        owner, repo, n = self.parse_pr(url)
        wanted = list(dict.fromkeys(diff_paths or []))
        if len(wanted) > MAX_DIFFS:
            raise GitHubError(f"ask for at most {MAX_DIFFS} diffs at a time")
        base = f"repos/{urllib.parse.quote(owner, safe='')}/{urllib.parse.quote(repo, safe='')}/pulls/{n}"
        pr = self._get(link, base)
        files: list[dict] = []
        for page in range(1, MAX_FILES // PAGE + 1):
            chunk = self._get(link, f"{base}/files", {"per_page": PAGE, "page": page})
            files.extend(chunk if isinstance(chunk, list) else [])
            if not isinstance(chunk, list) or len(chunk) < PAGE:
                break
        files = files[:MAX_FILES]
        total = int(pr.get("changed_files") or len(files))
        out = {
            "title": pr.get("title"), "state": pr.get("state"), "draft": bool(pr.get("draft")), "merged": bool(pr.get("merged")),
            "author": (pr.get("user") or {}).get("login"), "base": (pr.get("base") or {}).get("ref"), "head": (pr.get("head") or {}).get("ref"),
            "description": pr.get("body") or "", "additions": pr.get("additions"), "deletions": pr.get("deletions"), "changed_files": total,
            "url": pr.get("html_url") or url,
            "files": [{"path": f.get("filename"), "status": f.get("status"), "additions": f.get("additions"), "deletions": f.get("deletions")} for f in files],
            "files_truncated": total > len(files),
        }
        if wanted:
            by_path = {f.get("filename"): f for f in files}
            out["diffs"] = [{"path": p, "patch": (by_path[p].get("patch") or "") if p in by_path else None} for p in wanted]
        return out

    def user(self, link: dict) -> dict:
        r = self._get(link, "user")
        return {"login": r.get("login"), "name": r.get("name")}


def settings_from_env(env: dict[str, str]) -> GitHubSettings | None:
    cid, secret = (env.get("QUALITY_CODE_GITHUB_CLIENT_ID") or "").strip(), (env.get("QUALITY_CODE_GITHUB_CLIENT_SECRET") or "").strip()
    if not cid and not secret:
        return None
    if not cid or not secret:
        raise GitHubConfigError("set both QUALITY_CODE_GITHUB_CLIENT_ID and QUALITY_CODE_GITHUB_CLIENT_SECRET, or neither")
    url = (env.get("QUALITY_CODE_GITHUB_URL") or "").strip().rstrip("/") or DEFAULT_URL
    if not HOST.match(url):
        raise GitHubConfigError(f"QUALITY_CODE_GITHUB_URL must be an https address with no path, like https://github.example.com (found {url!r})")
    return GitHubSettings(client_id=cid, client_secret=secret, url=url)


def tools(provider) -> list:
    """Read-only GitHub tools that use the signed-in person's own GitHub access (sealed in their connector token; the server stores nothing)."""
    from mcp.server.auth.middleware.auth_context import get_access_token

    def link() -> dict | str:
        t = get_access_token()
        who = (t.claims or {}) if t else {}
        opened = provider.open_link({"oid": t.subject}, who.get(KEY)) if t and who.get(KEY) else None
        return opened or NOT_CONNECTED

    def quality_code_github_pr(url: str, diff_paths: list[str] | None = None) -> str:
        """Read one GitHub pull request as the signed-in person (read-only): title, state, author, branches, description and the changed files (up to 200). Give `diff_paths` (at most 5 file paths from that list) to also get those files' diffs."""
        l = link()
        if isinstance(l, str):
            return l
        try:
            return json.dumps(provider.s.github.pull(l, url, diff_paths), indent=2)
        except GitHubError as e:
            return f"error: {e}"

    def quality_code_github_user() -> str:
        """Who the signed-in person is on GitHub (login and name), read-only."""
        l = link()
        if isinstance(l, str):
            return l
        try:
            return json.dumps(provider.s.github.user(l), indent=2)
        except GitHubError as e:
            return f"error: {e}"

    return [quality_code_github_pr, quality_code_github_user]
