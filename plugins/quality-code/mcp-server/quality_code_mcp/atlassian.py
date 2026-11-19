"""Atlassian (Jira Cloud) for the shared server: the person signs in with Atlassian (OAuth 2.0 3LO) and the server reads Jira as them, read-only.

The tokens are never stored: they are sealed (vault.py) into the connector tokens. The Atlassian access token lives an hour, like ours; a refresh of
the connector token refreshes Atlassian too and seals the new pair, because Atlassian rotates its refresh tokens."""
from __future__ import annotations

import re
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any

AUTH = "https://auth.atlassian.com"
API = "https://api.atlassian.com"
KEY, SLUG, NAME = "atl", "atlassian", "Atlassian"
SCOPES = "read:jira-work write:jira-work read:jira-user offline_access"
VIEW = ("at", "exp", "cloud", "site")  # what the access token carries of the link (never the refresh token)
SKEW = 60  # an access token this close to its end is treated as expired
MAX_RESULTS = 50
PROJECT_PAGES = 100  # 5000 projects; more than that and the config says any project, so it stays small enough for the scripts' environment

from .jira_config import ANY_PROJECT
from .webclient import Http


class AtlassianError(RuntimeError):
    pass


class AtlassianConfigError(ValueError):
    pass


def real_http(method: str, url: str, headers: dict, body: dict | None):
    from .webclient import real_http as call

    return call(method, url, headers, body, err=AtlassianError, name="Atlassian")


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

    # -- Jira calls with a link: reads, and the few writes the commands make (each only after the person confirmed a preview in the chat)
    def _call(self, method: str, link: dict, path: str, params: dict | None = None, body: dict | None = None):
        if int(link.get("exp", 0)) - SKEW < time.time():
            raise AtlassianError("The Atlassian access has expired: reconnect the connector")
        q = f"?{urllib.parse.urlencode(params, doseq=True)}" if params else ""
        return self.http(method, f"{API}/ex/jira/{link['cloud']}/rest/api/3/{path}{q}", {"Authorization": f"Bearer {link['at']}"}, body)

    def _get(self, link: dict, path: str, params: dict | None = None):
        return self._call("GET", link, path, params)

    def search(self, link: dict, jql: str, limit: int = 20) -> list[dict]:
        r = self._get(link, "search/jql", {"jql": jql, "maxResults": max(1, min(limit, MAX_RESULTS)), "fields": "summary,status,issuetype,assignee,issuelinks,attachment,parent"})
        return [brief(i) for i in r.get("issues", [])]

    def issue(self, link: dict, key: str, full: bool = False) -> dict:
        fields = "summary,status,issuetype,assignee,labels,description,parent,subtasks,issuelinks,components,attachment,comment" if full else "summary,status,issuetype,assignee,labels,description,parent,subtasks"
        r = self._get(link, f"issue/{urllib.parse.quote(key, safe='')}", {"fields": fields})
        f = r["fields"]
        out = {**brief(r), "labels": f.get("labels") or [], "description": adf_text(f.get("description")), "parent": (f.get("parent") or {}).get("key"),
               "subtasks": [s["key"] for s in f.get("subtasks") or []]}
        if full:
            out.update({"components": [c.get("name") for c in f.get("components") or []],
                        "attachments": [{"name": a.get("filename"), "type": a.get("mimeType"), "size": a.get("size")} for a in f.get("attachment") or []],
                        "links": [link_brief(x) for x in f.get("issuelinks") or []],
                        "comments": [{"author": (c.get("author") or {}).get("displayName"), "created": c.get("created"), "text": adf_text(c.get("body"))} for c in (f.get("comment") or {}).get("comments", [])[-20:]]})
        return out

    def search_detail(self, link: dict, jql: str, limit: int, excerpt: int = 400) -> list[dict]:
        r = self._get(link, "search/jql", {"jql": jql, "maxResults": max(1, min(limit, MAX_RESULTS)), "fields": "summary,status,issuetype,assignee,description,parent"})
        out = []
        for i in r.get("issues", []):
            f = i.get("fields") or {}
            out.append({**brief(i), "parent": (f.get("parent") or {}).get("key"), "description": adf_text(f.get("description")).strip()[:excerpt]})
        return out

    def tree(self, link: dict, key: str, query: str = "", limit: int = 30) -> dict:
        """The ticket and what it points to, so a command can use the criteria that live elsewhere: its parent or epic, subtasks, linked issues, the keys and ranges its
        description names (a range like `PFO-4052 to PFO-4093` is expanded), and, with `query`, the children of its epic whose title has those words. Read-only, one level deep."""
        root = self.issue(link, key, True)
        text = root["description"] + "\n" + "\n".join(c.get("text") or "" for c in root.get("comments", []))
        mentioned = [k for k in dict.fromkeys(KEY_RE.findall(text)) if k != key]
        related = {"parent": [root["parent"]] if root.get("parent") else [], "subtasks": root.get("subtasks", []),
                   "linked": [x["key"] for x in root.get("links", []) if x.get("key")]}
        spans = [(proj.upper(), *sorted((int(a), int(b)))) for proj, a, b in RANGE_RE.findall(root["description"])]
        # `UTF-8` or `SHA-256` look like keys: a key or range in the text counts only when its project is real, or one bad key fails the whole search.
        known = {project_of(k) for k in [key, *(k for group in related.values() for k in group)]}
        unsure = sorted(({project_of(k) for k in mentioned} | {p for p, _, _ in spans}) - known)
        if unsure:
            known |= self.existing_projects(link, unsure)
        related["mentioned"] = [k for k in mentioned if project_of(k) in known]
        ranges = [f"(project = {p} AND key >= {p}-{lo} AND key <= {p}-{hi})" for p, lo, hi in spans if p in known and 0 < hi - lo <= RANGE_MAX]
        keys = list(dict.fromkeys(k for group in related.values() for k in group))
        out: dict[str, Any] = {"issue": {k: root[k] for k in ("key", "summary", "status", "type", "assignee")}, "referenced": {}, "range": [], "epic_children": [], "remote_links": []}
        if keys:
            found = {i["key"]: i for i in self.search_detail(link, f"key in ({','.join(keys[:limit])})", limit)}
            out["referenced"] = {name: [found[k] for k in group if k in found] for name, group in related.items() if group}
        if ranges:
            out["range"] = self.search_detail(link, f"({' OR '.join(ranges)}) ORDER BY key", limit, 200)
        epic = root["parent"] if root.get("parent") else (key if root["type"] == "Epic" else None)
        if epic and (query or root["type"] == "Epic"):
            words = " AND ".join(f'summary ~ "{w}"' for w in re.findall(r"\w+", query)[:6])
            out["epic_children"] = self.search_detail(link, f"parent = {epic}" + (f" AND {words}" if words else "") + " ORDER BY key", limit, 200)
        try:
            out["remote_links"] = self.remote_links(link, key)
        except AtlassianError:
            pass
        return out

    def remote_links(self, link: dict, key: str) -> list[dict]:
        r = self._get(link, f"issue/{urllib.parse.quote(key, safe='')}/remotelink")
        return [{"title": (x.get("object") or {}).get("title"), "url": (x.get("object") or {}).get("url")} for x in r] if isinstance(r, list) else []

    def projects(self, link: dict, query: str = "", limit: int = 20) -> list[dict]:
        r = self._get(link, "project/search", {"query": query, "maxResults": max(1, min(limit, MAX_RESULTS))})
        return [{"key": p.get("key"), "name": p.get("name")} for p in r.get("values", [])]

    def existing_projects(self, link: dict, keys: list[str]) -> set[str]:
        """Which of these keys are projects the person can see (Jira takes up to 50 at once); none when Jira cannot tell."""
        found: set[str] = set()
        for i in range(0, len(keys), MAX_RESULTS):
            try:
                r = self._get(link, "project/search", {"keys": keys[i:i + MAX_RESULTS], "maxResults": MAX_RESULTS})
            except AtlassianError:
                continue
            found |= {str(p.get("key")).upper() for p in (r.get("values", []) if isinstance(r, dict) else []) if p.get("key")}
        return found

    def project_keys(self, link: dict) -> list[str]:
        """The keys of every project the person can see (every page), for the scripts' per-person config. Past PROJECT_PAGES pages, any project (`*`): never a list cut short."""
        keys: list[str] = []
        for _ in range(PROJECT_PAGES):
            r = self._get(link, "project/search", {"startAt": len(keys), "maxResults": MAX_RESULTS})
            page = [p.get("key") for p in r.get("values", []) if p.get("key")]
            keys += page
            if r.get("isLast", True) or not page:
                return keys
        return [ANY_PROJECT]

    def transitions(self, link: dict, key: str) -> list[dict]:
        r = self._get(link, f"issue/{urllib.parse.quote(key, safe='')}/transitions")
        return [{"id": t.get("id"), "name": t.get("name"), "to": (t.get("to") or {}).get("name")} for t in r.get("transitions", [])]

    def create_meta(self, link: dict, project: str, issue_type: str = "") -> Any:
        r = self._get(link, f"issue/createmeta/{urllib.parse.quote(project, safe='')}/issuetypes", {"maxResults": 50})
        types = [{"id": t.get("id"), "name": t.get("name"), "subtask": t.get("subtask")} for t in r.get("issueTypes", r.get("values", []))]
        if not issue_type:
            return types
        t = next((x for x in types if x["name"].lower() == issue_type.lower() or x["id"] == issue_type), None)
        if not t:
            raise AtlassianError(f"no issue type {issue_type!r} in {project}: {', '.join(x['name'] for x in types)}")
        f = self._get(link, f"issue/createmeta/{urllib.parse.quote(project, safe='')}/issuetypes/{t['id']}", {"maxResults": 100})
        return [{"id": x.get("fieldId") or x.get("key"), "name": x.get("name"), "required": x.get("required"), "allowed": [v.get("name") or v.get("value") for v in (x.get("allowedValues") or [])][:20]}
                for x in f.get("fields", f.get("values", []))]

    def create(self, link: dict, project: str, issue_type: str, summary: str, description: str = "", fields: dict | None = None) -> dict:
        body = {"fields": {"project": {"key": project}, "issuetype": {"name": issue_type}, "summary": summary, **({"description": to_adf(description)} if description else {}), **(fields or {})}}
        r = self._call("POST", link, "issue", None, body)
        return {"key": r.get("key"), "url": f"{link.get('site', '').rstrip('/')}/browse/{r.get('key')}"}

    def comment(self, link: dict, key: str, text: str) -> dict:
        r = self._call("POST", link, f"issue/{urllib.parse.quote(key, safe='')}/comment", None, {"body": to_adf(text)})
        return {"id": r.get("id"), "key": key}

    def transition(self, link: dict, key: str, transition_id: str) -> dict:
        self._call("POST", link, f"issue/{urllib.parse.quote(key, safe='')}/transitions", None, {"transition": {"id": str(transition_id)}})
        return {"key": key, "transition": str(transition_id)}

    def edit(self, link: dict, key: str, fields: dict) -> dict:
        self._call("PUT", link, f"issue/{urllib.parse.quote(key, safe='')}", None, {"fields": fields})
        return {"key": key, "edited": sorted(fields)}

    def link_issues(self, link: dict, link_type: str, inward: str, outward: str) -> dict:
        self._call("POST", link, "issueLink", None, {"type": {"name": link_type}, "inwardIssue": {"key": inward}, "outwardIssue": {"key": outward}})
        return {"linked": [inward, outward], "type": link_type}


def link_brief(x: dict) -> dict:
    other = x.get("outwardIssue") or x.get("inwardIssue") or {}
    f = other.get("fields") or {}
    return {"type": (x.get("type") or {}).get("name"), "direction": "outward" if x.get("outwardIssue") else "inward", "key": other.get("key"), "summary": f.get("summary"), "status": (f.get("status") or {}).get("name")}


def to_adf(text: str) -> dict:
    """Plain text as Jira's document format: one paragraph per line."""
    lines = (text or "").split("\n")
    return {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": ln}] if ln else []} for ln in lines]}


def brief(i: dict) -> dict:
    f = i.get("fields") or {}
    return {"key": i.get("key"), "summary": f.get("summary"), "status": (f.get("status") or {}).get("name"), "type": (f.get("issuetype") or {}).get("name"),
            "assignee": (f.get("assignee") or {}).get("displayName")}


def adf_text(node: Any) -> str:
    """Plain text of Jira's document format (what the description is), one block per line. Links stay: a smart link or a link mark keeps its address."""
    if not node:
        return ""
    if isinstance(node, str):
        return node
    kind = node.get("type")
    attrs = node.get("attrs") or {}
    if kind == "text":
        text = node.get("text", "")
        href = next((((m.get("attrs") or {}).get("href")) for m in node.get("marks") or [] if m.get("type") == "link"), None)
        return f"{text} ({href})" if href and href not in text else text
    if kind in {"inlineCard", "blockCard", "embedCard"}:
        return attrs.get("url") or (attrs.get("data") or {}).get("url") or ""
    if kind == "mention":
        return attrs.get("text") or ""
    if kind == "hardBreak":
        return "\n"
    inner = "".join(adf_text(c) for c in node.get("content", []))
    return inner + ("\n" if kind in {"paragraph", "heading", "listItem", "codeBlock", "blockquote", "tableRow"} else "")


KEY_RE = re.compile(r"\b[A-Z][A-Z0-9_]*-\d+\b")
RANGE_RE = re.compile(r"\b([A-Z][A-Z0-9_]*)-(\d+)(?:\)|/\S*)?\s*(?:to|until|through|-|\u2013|\u2014|\.\.\.?)\s*(?:https?://\S+/browse/)?(?:[A-Z][A-Z0-9_]*-)?(\d+)\b", re.I)
RANGE_MAX = 200


def project_of(key: str) -> str:
    return key.rsplit("-", 1)[0].upper()


def settings_from_env(env: dict[str, str]) -> AtlassianSettings | None:
    cid, secret = (env.get("QUALITY_CODE_ATLASSIAN_CLIENT_ID") or "").strip(), (env.get("QUALITY_CODE_ATLASSIAN_CLIENT_SECRET") or "").strip()
    if not cid and not secret:
        return None
    if not cid or not secret:
        raise AtlassianConfigError("set both QUALITY_CODE_ATLASSIAN_CLIENT_ID and QUALITY_CODE_ATLASSIAN_CLIENT_SECRET, or neither")
    return AtlassianSettings(client_id=cid, client_secret=secret, site=(env.get("QUALITY_CODE_JIRA_SITE") or "").strip())
