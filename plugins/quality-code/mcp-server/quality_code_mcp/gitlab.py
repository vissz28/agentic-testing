"""GitLab (Biosphere) for the shared server: the person signs in with GitLab (OAuth 2.0) and the server reads merge requests as them, read-only.

The tokens are never stored: they are sealed (vault.py) into the connector tokens, like Atlassian's. GitLab access tokens live two hours and its refresh
tokens rotate, so a refresh of the connector token refreshes GitLab too and seals the new pair."""
from __future__ import annotations

import json
import re
import time
import urllib.parse
from dataclasses import dataclass

from .webclient import Http

KEY, SLUG, NAME = "gl", "gitlab", "GitLab"
SCOPES = "read_api read_user"
VIEW = ("at", "exp", "base")  # what the access token carries of the link (never the refresh token)
SKEW = 60  # an access token this close to its end is treated as expired
DEFAULT_API = "https://biosphere.teamsystem.com/api/v4"
MAX_DIFF = 20000  # characters of one file's diff handed back
MAX_FILES = 100
MR_URL = re.compile(r"^(?P<path>.+?)/-/merge_requests/(?P<iid>\d+)(?:[/?#].*)?$")


class GitLabError(RuntimeError):
    pass


class GitLabConfigError(ValueError):
    pass


def real_http(method: str, url: str, headers: dict, body: dict | None):
    from .webclient import real_http as call

    return call(method, url, headers, body, err=GitLabError, name="GitLab")


@dataclass(frozen=True)
class GitLabSettings:
    client_id: str
    client_secret: str
    api_url: str = DEFAULT_API
    http: Http = real_http

    @property
    def host(self) -> str:
        """The GitLab address without /api/v4: where the OAuth pages live."""
        return self.api_url[: -len("/api/v4")]

    def authorize_url(self, redirect_uri: str, state: str) -> str:
        q = {"client_id": self.client_id, "redirect_uri": redirect_uri, "response_type": "code", "state": state, "scope": SCOPES}
        return f"{self.host}/oauth/authorize?{urllib.parse.urlencode(q)}"

    def _token(self, body: dict, redirect_uri: str) -> dict:
        r = self.http("POST", f"{self.host}/oauth/token", {}, {"client_id": self.client_id, "client_secret": self.client_secret, "redirect_uri": redirect_uri, **body})
        if not isinstance(r, dict) or not r.get("access_token"):
            raise GitLabError("GitLab gave no access token")
        return r

    def _pack(self, r: dict, old_refresh: str | None = None) -> dict:
        return {"at": r["access_token"], "rt": r.get("refresh_token") or old_refresh, "exp": int(time.time()) + int(r.get("expires_in") or 7200), "base": self.api_url}

    def link(self, code: str, redirect_uri: str) -> dict:
        """After the person accepted at GitLab: the token pair and the API address to read."""
        return self._pack(self._token({"grant_type": "authorization_code", "code": code}, redirect_uri))

    def refresh(self, link: dict) -> dict:
        if not link.get("rt"):
            raise GitLabError("The GitLab link has no refresh token: sign in again")
        return self._pack(self._token({"grant_type": "refresh_token", "refresh_token": link["rt"]}, ""), link["rt"])

    # -- reads with a link (GET only)
    def _get(self, link: dict, path: str, params: dict | None = None):
        if int(link.get("exp", 0)) - SKEW < time.time():
            raise GitLabError("The GitLab access has expired: reconnect the connector")
        base = link.get("base") or self.api_url
        if base != self.api_url:
            raise GitLabError("The GitLab link is for another address: reconnect the connector")
        q = f"?{urllib.parse.urlencode(params)}" if params else ""
        return self.http("GET", f"{base}/{path}{q}", {"Authorization": f"Bearer {link['at']}"}, None)

    def parse_mr_url(self, url: str) -> tuple[str, int]:
        """(project path, merge request number) of a merge request address on this GitLab; anything else is refused."""
        u = urllib.parse.urlparse((url or "").strip())
        if f"{u.scheme}://{u.netloc}" != self.host:
            raise GitLabError(f"only merge requests on {self.host} are read")
        m = MR_URL.match(u.path.strip("/"))
        if not m:
            raise GitLabError("a merge request address looks like https://<gitlab>/<group>/<project>/-/merge_requests/<number>")
        return m["path"], int(m["iid"])

    def merge_request(self, link: dict, url: str, diff_paths: list[str] | None = None) -> dict:
        path, iid = self.parse_mr_url(url)
        pid = urllib.parse.quote(path, safe="")
        mr = self._get(link, f"projects/{pid}/merge_requests/{iid}")
        diffs = self._get(link, f"projects/{pid}/merge_requests/{iid}/diffs", {"per_page": MAX_FILES})
        diffs = diffs if isinstance(diffs, list) else []
        out = {
            "project": path, "iid": iid, "title": mr.get("title"), "state": mr.get("state"), "draft": mr.get("draft"), "author": (mr.get("author") or {}).get("username"),
            "source_branch": mr.get("source_branch"), "target_branch": mr.get("target_branch"), "description": mr.get("description") or "", "labels": mr.get("labels") or [],
            "web_url": mr.get("web_url"), "merge_status": mr.get("detailed_merge_status") or mr.get("merge_status"), "sha": mr.get("sha"),
            "files": [{"path": d.get("new_path"), "old_path": d.get("old_path") if d.get("renamed_file") else None, "new": bool(d.get("new_file")), "deleted": bool(d.get("deleted_file"))} for d in diffs],
        }
        wanted = set(diff_paths or [])
        if wanted:
            out["diffs"] = {d["new_path"]: (d.get("diff") or "")[:MAX_DIFF] for d in diffs if d.get("new_path") in wanted}
        return out

    def project(self, link: dict, path: str) -> dict:
        p = self._get(link, f"projects/{urllib.parse.quote(path.strip().strip('/'), safe='')}")
        return {"path": p.get("path_with_namespace"), "name": p.get("name"), "default_branch": p.get("default_branch"), "visibility": p.get("visibility"), "web_url": p.get("web_url"),
                "description": p.get("description") or ""}

    def user(self, link: dict) -> dict:
        u = self._get(link, "user")
        return {"username": u.get("username"), "name": u.get("name"), "email": u.get("email") or u.get("public_email")}


def settings_from_env(env: dict[str, str]) -> GitLabSettings | None:
    cid, secret = (env.get("QUALITY_CODE_GITLAB_CLIENT_ID") or "").strip(), (env.get("QUALITY_CODE_GITLAB_CLIENT_SECRET") or "").strip()
    if not cid and not secret:
        return None
    if not cid or not secret:
        raise GitLabConfigError("set both QUALITY_CODE_GITLAB_CLIENT_ID and QUALITY_CODE_GITLAB_CLIENT_SECRET, or neither")
    api = (env.get("QUALITY_CODE_GITLAB_API_URL") or "").strip().rstrip("/") or DEFAULT_API
    if not api.startswith("https://") or not api.endswith("/api/v4"):
        raise GitLabConfigError(f"QUALITY_CODE_GITLAB_API_URL must be an https address ending in /api/v4 (found {api!r})")
    return GitLabSettings(client_id=cid, client_secret=secret, api_url=api)


NOT_CONNECTED = "error: GitLab is not connected for this sign-in. Remove the Quality Code connector in Claude and add it again; you will be asked to sign in with GitLab."


def tools(provider) -> list:
    """Read-only GitLab tools that use the signed-in person's own GitLab access (sealed in their connector token; the server stores nothing)."""
    from mcp.server.auth.middleware.auth_context import get_access_token

    def link() -> dict | str:
        t = get_access_token()
        who = (t.claims or {}) if t else {}
        opened = provider.open_link({"oid": t.subject}, who.get(KEY)) if t and who.get(KEY) else None
        return opened or NOT_CONNECTED

    def run(call):
        l = link()
        if isinstance(l, str):
            return l
        try:
            return json.dumps(call(provider.s.gitlab, l), indent=2)
        except GitLabError as e:
            return f"error: {e}"

    def quality_code_gitlab_mr(url: str, diff_paths: list[str] | None = None) -> str:
        """Read one GitLab merge request as the signed-in person (read-only): title, state, branches, description, labels and the changed files. Pass `diff_paths` to get the diff of those files too."""
        return run(lambda g, l: g.merge_request(l, url, diff_paths))

    def quality_code_gitlab_project(path: str) -> str:
        """Read one GitLab project as the signed-in person (read-only): name, default branch, visibility and description. `path` is group/subgroup/project."""
        return run(lambda g, l: g.project(l, path))

    def quality_code_gitlab_user() -> str:
        """Who the signed-in person is on GitLab (read-only): username, name and email."""
        return run(lambda g, l: g.user(l))

    return [quality_code_gitlab_mr, quality_code_gitlab_project, quality_code_gitlab_user]
