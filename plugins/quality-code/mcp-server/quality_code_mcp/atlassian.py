"""Atlassian (Jira Cloud) for the shared server: the person signs in with Atlassian (OAuth 2.0 3LO) and the server reads Jira as them, read-only.

The tokens are never stored: they are sealed (vault.py) into the connector tokens. The Atlassian access token lives an hour, like ours; a refresh of
the connector token refreshes Atlassian too and seals the new pair, because Atlassian rotates its refresh tokens."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

AUTH = "https://auth.atlassian.com"
API = "https://api.atlassian.com"
SCOPES = "read:jira-work read:jira-user offline_access"
SKEW = 60  # an access token this close to its end is treated as expired
MAX_RESULTS = 50

Http = Callable[[str, str, dict, dict | None], Any]  # (method, url, headers, json body) -> parsed json


class AtlassianError(RuntimeError):
    pass


class AtlassianConfigError(ValueError):
    pass


def real_http(method: str, url: str, headers: dict, body: dict | None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Accept": "application/json", **({"Content-Type": "application/json"} if body is not None else {}), **headers})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 - only the fixed https hosts above
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise AtlassianError(f"Atlassian answered {e.code}") from None
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise AtlassianError(f"Atlassian could not be reached: {e}") from None


@dataclass(frozen=True)
class AtlassianSettings:
    client_id: str
    client_secret: str
    site: str = ""  # https://example.atlassian.net: which of the person's sites to read; empty = their first one
    http: Http = real_http

    def authorize_url(self, redirect_uri: str, state: str) -> str:
        q = {"audience": "api.atlassian.com", "client_id": self.client_id, "scope": SCOPES, "redirect_uri": redirect_uri, "state": state, "response_type": "code", "prompt": "consent"}
        return f"{AUTH}/authorize?{urllib.parse.urlencode(q)}"

    def _token(self, body: dict) -> dict:
        r = self.http("POST", f"{AUTH}/oauth/token", {}, {"client_id": self.client_id, "client_secret": self.client_secret, **body})
        if not isinstance(r, dict) or not r.get("access_token"):
            raise AtlassianError("Atlassian gave no access token")
        return r

    def _pack(self, r: dict, cloud: str | None, site: str | None, old_refresh: str | None = None) -> dict:
        return {"at": r["access_token"], "rt": r.get("refresh_token") or old_refresh, "exp": int(time.time()) + int(r.get("expires_in", 3600)), "cloud": cloud, "site": site}

    def link(self, code: str, redirect_uri: str) -> dict:
        """After the person accepted at Atlassian: the token pair and the site to read."""
        r = self._token({"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri})
        sites = self.http("GET", f"{API}/oauth/token/accessible-resources", {"Authorization": f"Bearer {r['access_token']}"}, None)
        wanted = self.site.rstrip("/").lower()
        pick = next((s for s in sites if str(s.get("url", "")).rstrip("/").lower() == wanted), None) if wanted else (sites[0] if sites else None)
        if not pick:
            raise AtlassianError(f"This Atlassian account cannot see {self.site}" if wanted else "This Atlassian account has no Jira site")
        return self._pack(r, pick["id"], pick.get("url"))

    def refresh(self, link: dict) -> dict:
        if not link.get("rt"):
            raise AtlassianError("The Atlassian link has no refresh token: sign in again")
        r = self._token({"grant_type": "refresh_token", "refresh_token": link["rt"]})
        return self._pack(r, link.get("cloud"), link.get("site"), link["rt"])

    # -- read-only Jira calls with a link
    def _get(self, link: dict, path: str, params: dict | None = None):
        if int(link.get("exp", 0)) - SKEW < time.time():
            raise AtlassianError("The Atlassian access has expired: reconnect the connector")
        q = f"?{urllib.parse.urlencode(params)}" if params else ""
        return self.http("GET", f"{API}/ex/jira/{link['cloud']}/rest/api/3/{path}{q}", {"Authorization": f"Bearer {link['at']}"}, None)

    def search(self, link: dict, jql: str, limit: int = 20) -> list[dict]:
        r = self._get(link, "search/jql", {"jql": jql, "maxResults": max(1, min(limit, MAX_RESULTS)), "fields": "summary,status,issuetype,assignee"})
        return [brief(i) for i in r.get("issues", [])]

    def issue(self, link: dict, key: str) -> dict:
        r = self._get(link, f"issue/{urllib.parse.quote(key, safe='')}", {"fields": "summary,status,issuetype,assignee,labels,description,parent,subtasks,issuelinks", "expand": ""})
        return {**brief(r), "labels": r["fields"].get("labels") or [], "description": adf_text(r["fields"].get("description")),
                "parent": (r["fields"].get("parent") or {}).get("key"), "subtasks": [s["key"] for s in r["fields"].get("subtasks") or []]}


def brief(i: dict) -> dict:
    f = i.get("fields") or {}
    return {"key": i.get("key"), "summary": f.get("summary"), "status": (f.get("status") or {}).get("name"), "type": (f.get("issuetype") or {}).get("name"),
            "assignee": (f.get("assignee") or {}).get("displayName")}


def adf_text(node: Any) -> str:
    """Plain text of Jira's document format (what the description is), one block per line."""
    if not node:
        return ""
    if isinstance(node, str):
        return node
    if node.get("type") == "text":
        return node.get("text", "")
    if node.get("type") == "hardBreak":
        return "\n"
    inner = "".join(adf_text(c) for c in node.get("content", []))
    return inner + ("\n" if node.get("type") in {"paragraph", "heading", "listItem", "codeBlock", "blockquote", "tableRow"} else "")


def settings_from_env(env: dict[str, str]) -> AtlassianSettings | None:
    cid, secret = (env.get("QUALITY_CODE_ATLASSIAN_CLIENT_ID") or "").strip(), (env.get("QUALITY_CODE_ATLASSIAN_CLIENT_SECRET") or "").strip()
    if not cid and not secret:
        return None
    if not cid or not secret:
        raise AtlassianConfigError("set both QUALITY_CODE_ATLASSIAN_CLIENT_ID and QUALITY_CODE_ATLASSIAN_CLIENT_SECRET, or neither")
    return AtlassianSettings(client_id=cid, client_secret=secret, site=(env.get("QUALITY_CODE_JIRA_SITE") or "").strip())
