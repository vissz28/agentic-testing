"""Sign-in for Claude's connector: this server is the authorization server, Microsoft Entra ID checks who the person is.

Claude registers itself (dynamic client registration), sends the person to /authorize, and our page takes them to Entra. Back from Entra the
person reads the TeamSystem rules and confirms a few non-secret details; only then does Claude get a code, and then a token. Nothing about the
person is stored: client registrations, codes and tokens are signed with QUALITY_CODE_TOKEN_SECRET, and the details ride in the token's claims.

The one thing kept in memory is the set of codes already used (a code works once). A restart inside the 5 minutes a code lives can only make an
unfinished sign-in start again."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import re
import secrets
import time
import urllib.parse
from dataclasses import dataclass
from html import escape
from pathlib import Path
from typing import Any

import jwt
from mcp.server.auth.provider import (
    AccessToken, AuthorizationCode, AuthorizationParams, AuthorizeError, RefreshToken, RegistrationError, TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from . import atlassian as atl_mod, github as gh_mod, gitlab as gl_mod, vault
from .entra import EntraSettings, EntraTokenVerifier

CONNECT_COOKIE = "qc_connect"
LINK_COOKIE = "qc_link"
STATIC = Path(__file__).parent / "static"
ACCESS_TTL, REFRESH_TTL, CODE_TTL, TX_TTL, CONSENT_TTL = 3600, 30 * 86400, 300, 600, 900
MIN_SECRET = 32
# Where Claude may be sent back to. claude.ai today; Anthropic has said the host may become claude.com. Loopback is for Claude Code on a laptop.
CLAUDE_CALLBACKS = ("https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback")
LOOPBACK = re.compile(r"^http://(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}(/[A-Za-z0-9._~/-]*)?$")
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$")
GITLAB_USER = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class ConnectorConfigError(ValueError):
    pass


def redirect_allowed(uri: str) -> bool:
    return uri in CLAUDE_CALLBACKS or bool(LOOPBACK.match(uri))


def load_rules(path: Path | None = None) -> tuple[str, str]:
    """The rules text and its version (a short hash: changing the text asks everybody again)."""
    text = (path or STATIC / "rules.md").read_text(encoding="utf-8").strip()
    return text, hashlib.sha256(text.encode()).hexdigest()[:12]


@dataclass(frozen=True)
class ConnectorSettings:
    entra: EntraSettings
    secret: str
    rules: str
    rules_version: str
    atlassian: atl_mod.AtlassianSettings | None = None  # set with QUALITY_CODE_ATLASSIAN_CLIENT_ID/SECRET: the person also signs in with Atlassian and the server reads Jira as them
    vault_key: bytes | None = None  # seals their upstream tokens into the connector tokens (QUALITY_CODE_TOKEN_KEY)
    gitlab: Any = None  # GitLab (Biosphere) sign-in, set with QUALITY_CODE_GITLAB_CLIENT_ID/SECRET: the server reads merge requests as them
    github: Any = None  # GitHub sign-in, set with QUALITY_CODE_GITHUB_CLIENT_ID/SECRET: the server reads pull requests as them

    @property
    def upstreams(self) -> list:
        """The services the person signs in to after Microsoft, in order: (identity key, route name, client)."""
        return [(m.KEY, m.SLUG, c) for m, c in ((atl_mod, self.atlassian), (gl_mod, self.gitlab), (gh_mod, self.github)) if c]

    def upstream_redirect(self, slug: str) -> str:
        return f"{self.url}/connect/{slug}/callback"

    @property
    def atlassian_redirect(self) -> str:
        return self.upstream_redirect("atlassian")

    @property
    def url(self) -> str:
        return self.entra.public_url.rstrip("/")

    @property
    def secure(self) -> bool:
        return self.url.startswith("https://")


def settings_from_env(entra: EntraSettings, env: dict[str, str]) -> ConnectorSettings | None:
    """None when QUALITY_CODE_TOKEN_SECRET is not set: the connector sign-in is then off and /mcp takes Entra tokens as before."""
    secret = (env.get("QUALITY_CODE_TOKEN_SECRET") or "").strip()
    if not secret:
        return None
    if len(secret) < MIN_SECRET:
        raise ConnectorConfigError(f"QUALITY_CODE_TOKEN_SECRET must be at least {MIN_SECRET} characters (use 32 random bytes, for example openssl rand -base64 32).")
    file = (env.get("QUALITY_CODE_RULES_FILE") or "").strip()
    rules, version = load_rules(Path(file) if file else None)
    try:
        key, atl, gl, gh = vault.key_from_env(env), atl_mod.settings_from_env(env), gl_mod.settings_from_env(env), gh_mod.settings_from_env(env)
    except (vault.VaultError, atl_mod.AtlassianConfigError, ValueError) as e:
        raise ConnectorConfigError(str(e)) from None
    if (atl or gl or gh) and not key:
        raise ConnectorConfigError("the Atlassian, GitLab and GitHub sign-ins need QUALITY_CODE_TOKEN_KEY too (32 random bytes, for example openssl rand -base64 32): it seals their tokens.")
    return ConnectorSettings(entra=entra, secret=secret, rules=rules, rules_version=version, atlassian=atl, gitlab=gl, github=gh, vault_key=key if (atl or gl or gh) else None)


class ConnectorCode(AuthorizationCode):
    identity: dict[str, Any] = {}


class ConnectorRefresh(RefreshToken):
    identity: dict[str, Any] = {}


class ConnectorProvider:
    """The OAuthAuthorizationServerProvider of the MCP SDK, over signed tokens."""

    def __init__(self, s: ConnectorSettings, entra_verifier: EntraTokenVerifier | None = None):
        self.s = s
        self.entra_verifier = entra_verifier
        self._used: dict[str, float] = {}

    # -- signing
    def sign(self, typ: str, payload: dict, ttl: int | None) -> str:
        now = int(time.time())
        claims = {**payload, "typ": typ, "iss": self.s.url, "aud": self.s.url, "iat": now, "jti": secrets.token_urlsafe(16)}
        if ttl is not None:
            claims["exp"] = now + ttl
        return jwt.encode(claims, self.s.secret, algorithm="HS256")

    def read(self, token: str | None, typ: str) -> dict | None:
        if not token:
            return None
        try:
            claims = jwt.decode(token, self.s.secret, algorithms=["HS256"], audience=self.s.url, issuer=self.s.url)
        except jwt.PyJWTError:
            return None
        return claims if claims.get("typ") == typ else None

    def _client_secret(self, client_id: str) -> str:
        return hmac.new(self.s.secret.encode(), client_id.encode(), hashlib.sha256).hexdigest()

    # -- registration (the client id is a signed copy of what the client registered, so a restart forgets nothing)
    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        uris = [str(u) for u in (client_info.redirect_uris or [])]
        if not uris or not all(redirect_allowed(u) for u in uris):
            raise RegistrationError(error="invalid_redirect_uri", error_description="This server only signs in Claude. Its redirect addresses are not allowed here.")
        client_id = self.sign("client", {"ru": uris, "name": (client_info.client_name or "")[:100], "pub": client_info.token_endpoint_auth_method == "none"}, None)
        client_info.client_id = client_id
        if client_info.token_endpoint_auth_method != "none":
            client_info.client_secret = self._client_secret(client_id)

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        c = self.read(client_id, "client")
        if not c:
            return None
        public = bool(c.get("pub"))
        return OAuthClientInformationFull.model_validate({
            "client_id": client_id, "client_secret": None if public else self._client_secret(client_id), "redirect_uris": c["ru"], "client_name": c.get("name") or None,
            "token_endpoint_auth_method": "none" if public else "client_secret_post", "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
        })

    # -- authorize: the person goes through our page (Entra, then the rules) before a code exists
    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        uri = str(params.redirect_uri)
        if not redirect_allowed(uri):
            raise AuthorizeError(error="invalid_request", error_description="redirect address not allowed")
        tx = self.sign("tx", {"cid": client.client_id, "ru": uri, "rue": params.redirect_uri_provided_explicitly, "st": params.state, "cc": params.code_challenge,
                              "res": params.resource, "sc": params.scopes or []}, TX_TTL)
        return f"{self.s.url}/connect/start?tx={urllib.parse.quote(tx)}"

    def make_code(self, tx: dict, identity: dict) -> str:
        return self.sign("code", {"cid": tx["cid"], "ru": tx["ru"], "rue": tx["rue"], "cc": tx["cc"], "res": tx.get("res"), "sc": tx.get("sc", []), "id": identity}, CODE_TTL)

    async def load_authorization_code(self, client: OAuthClientInformationFull, authorization_code: str) -> ConnectorCode | None:
        c = self.read(authorization_code, "code")
        if not c or c["cid"] != client.client_id or c["jti"] in self._used:
            return None
        return ConnectorCode(code=authorization_code, scopes=c.get("sc", []), expires_at=c["exp"], client_id=c["cid"], code_challenge=c["cc"], redirect_uri=c["ru"],
                             redirect_uri_provided_explicitly=bool(c["rue"]), resource=c.get("res"), subject=c["id"].get("oid"), identity=c["id"])

    def seal_link(self, identity: dict, link: dict) -> str:
        return vault.seal(self.s.vault_key, link, aad=str(identity.get("oid")))

    def open_link(self, identity: dict, sealed: str | None) -> dict | None:
        return vault.unseal(self.s.vault_key, sealed, aad=str(identity.get("oid"))) if self.s.vault_key else None

    def _tokens(self, client_id: str, identity: dict, scopes: list[str], resource: str | None) -> OAuthToken:
        ups = {k: m for k, m in ((u[0], u[2]) for u in self.s.upstreams)}
        ident = {k: v for k, v in identity.items() if k not in ups}  # the access token never carries a refresh token
        extra, ttl = {}, ACCESS_TTL
        for key, slug, client in self.s.upstreams:
            link = self.open_link(identity, identity.get(key))
            if link:
                mod = {"atl": atl_mod, "gl": gl_mod, "gh": gh_mod}[key]
                extra[key] = self.seal_link(identity, {k: link.get(k) for k in mod.VIEW})
                ttl = max(60, min(ttl, int(link["exp"] - time.time()) - atl_mod.SKEW)) if link.get("exp") else ttl
        access = self.sign("access", {"cid": client_id, "sub": identity.get("oid"), "id": ident, "sc": scopes, "res": resource, **extra}, ttl)
        refresh = self.sign("refresh", {"cid": client_id, "sub": identity.get("oid"), "id": identity, "sc": scopes, "res": resource}, REFRESH_TTL)
        return OAuthToken(access_token=access, expires_in=ttl, scope=" ".join(scopes) or None, refresh_token=refresh)

    async def exchange_authorization_code(self, client: OAuthClientInformationFull, authorization_code: ConnectorCode) -> OAuthToken:
        claims = self.read(authorization_code.code, "code")
        if not claims or claims["jti"] in self._used:
            raise TokenError(error="invalid_grant", error_description="the code was used or has expired")
        now = time.time()
        self._used = {j: t for j, t in self._used.items() if t > now}  # forget codes that have expired anyway
        self._used[claims["jti"]] = claims["exp"] + 5
        identity = authorization_code.identity
        for key, slug, up in self.s.upstreams:
            link = self.open_link(identity, identity.get(key))
            if link and not link.get("at") and link.get("rt"):
                try:
                    link = await asyncio.to_thread(up.refresh, link)
                except RuntimeError:
                    raise TokenError(error="invalid_grant", error_description=f"{slug.title()} access ended: connect the connector again") from None
                identity = {**identity, key: self.seal_link(identity, link)}
        return self._tokens(client.client_id, identity, authorization_code.scopes, authorization_code.resource)

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str) -> ConnectorRefresh | None:
        c = self.read(refresh_token, "refresh")
        if not c or c["cid"] != client.client_id:
            return None
        return ConnectorRefresh(token=refresh_token, client_id=c["cid"], scopes=c.get("sc", []), expires_at=c["exp"], resource=c.get("res"), subject=c.get("sub"), identity=c["id"])

    async def exchange_refresh_token(self, client: OAuthClientInformationFull, refresh_token: ConnectorRefresh, scopes: list[str]) -> OAuthToken:
        identity = refresh_token.identity
        for key, slug, up in self.s.upstreams:
            link = self.open_link(identity, identity.get(key))
            if not link:
                raise TokenError(error="invalid_grant", error_description=f"{slug.title()} is not connected: connect the connector again")
            if link.get("exp") and not link.get("rt"):
                continue  # a service whose access token does not expire (no refresh)
            try:
                link = await asyncio.to_thread(up.refresh, link)
            except RuntimeError:
                raise TokenError(error="invalid_grant", error_description=f"{slug.title()} access ended: connect the connector again") from None
            identity = {**identity, key: self.seal_link(identity, link)}
        return self._tokens(client.client_id, identity, scopes or refresh_token.scopes, refresh_token.resource)

    # -- the bearer check of /mcp: our tokens first, Entra's own tokens as before
    async def load_access_token(self, token: str) -> AccessToken | None:
        c = self.read(token, "access")
        if c:
            i = c.get("id", {})
            return AccessToken(token=token, client_id=c["cid"], scopes=c.get("sc", []), expires_at=c["exp"], resource=self.s.url, subject=c.get("sub"),
                               claims={"atl": c.get("atl"), "gl": c.get("gl"), "gh": c.get("gh"), "iss": self.s.url, "tid": self.s.entra.tenant_id, "upn": i.get("email"), "name": i.get("name"), "jira_email": i.get("jira_email"),
                                       "gitlab_username": i.get("gitlab_username"), "rules": i.get("rules")})
        return await self.entra_verifier.verify_token(token) if self.entra_verifier else None

    async def verify_token(self, token: str) -> AccessToken | None:
        return await self.load_access_token(token)

    async def revoke_token(self, token: Any) -> None:  # signed tokens are not stored: rotate QUALITY_CODE_TOKEN_SECRET to end every session
        return None


# ---------------------------------------------------------------- the page

def consent_page(s: ConnectorSettings, who: dict, csrf: str, error: str | None = None, values: dict | None = None) -> str:
    from .web import _page  # the same look as the sign-in view

    values = values or {}
    jira = values.get("jira_email", who.get("email") or "")
    gitlab = values.get("gitlab_username", "")
    paragraphs = "".join(f"<p>{escape(p)}</p>" for p in s.rules.split("\n\n") if p.strip())
    err = f'<div class="err">{escape(error)}</div>' if error else ""
    body = ('<section><span class="eyebrow">Connect to Claude</span><h1>One more step <em>before Claude connects.</em></h1>'
            '<p class="lead">You are signed in with Microsoft. Read the rules, check your details, and accept to finish.</p></section>'
            f'<aside class="card"><div class="me"><div class="av">{escape("".join(p[0] for p in (who.get("name") or "?").split()[:2]).upper())}</div>'
            f'<div><b>{escape(who.get("name") or "")}</b><small>{escape(who.get("email") or "")}</small></div><span class="ok">Signed in</span></div>'
            f'{err}<div><p class="lbl">TeamSystem rules</p><div class="rules" tabindex="0">{paragraphs}</div></div>'
            '<form method="post" action="/connect/accept" class="form">'
            f'<input type="hidden" name="csrf" value="{escape(csrf, quote=True)}">'
            f'<label class="lbl" for="je">Jira email</label><input id="je" name="jira_email" type="email" maxlength="320" required value="{escape(jira, quote=True)}">'
            f'<label class="lbl" for="gu">GitLab username (optional)</label><input id="gu" name="gitlab_username" maxlength="64" value="{escape(gitlab, quote=True)}">'
            '<p class="sub">These are not secrets. Never type a password or a key here.</p>'
            '<label class="chk"><input type="checkbox" name="agree" value="yes" required> I have read and accept the rules.</label>'
            '<button class="btn primary" name="action" value="accept" type="submit">Accept and connect</button>'
            '<button class="btn quiet" name="action" value="cancel" type="submit" formnovalidate>Cancel</button></form></aside>')
    return _page("Quality Code · Connect to Claude", body)


CONSENT_CSS = (".rules{max-height:180px;overflow:auto;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--code);font-size:13px;line-height:1.5}"
               ".rules p{margin:0 0 8px}.form{display:flex;flex-direction:column;gap:8px}.form input[type=email],.form input:not([type]){padding:11px 12px;border-radius:10px;"
               "border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit}.chk{display:flex;gap:8px;align-items:flex-start;font-size:14px}")


# ---------------------------------------------------------------- routes

def parse_form(body: bytes) -> dict[str, str]:
    return {k: v[0] for k, v in urllib.parse.parse_qs(body.decode("utf-8", "replace"), keep_blank_values=True).items()}


def register_routes(server, provider: ConnectorProvider, w, entra: EntraSettings) -> dict:
    pending: dict[str, tuple[float, dict]] = {}  # ref -> (expires, identity so far) of the sign-ins in progress
    """Add /connect/start, /connect/consent and /connect/accept. Returns the hooks web.py calls: `start(tx)` for the Entra redirect, `after_identity(flow, claims)` back from it."""
    from starlette.responses import HTMLResponse, RedirectResponse
    from . import web

    s = provider.s

    def html(page: str, status: int = 200):
        return HTMLResponse(page.replace("</style>", CONSENT_CSS + "</style>", 1), status_code=status,
                            headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin"})

    def set_cookie(resp, value: str):
        resp.set_cookie(CONNECT_COOKIE, value, max_age=CONSENT_TTL, httponly=True, secure=s.secure, samesite="lax", path="/")

    def after_identity(flow: dict, claims: dict):
        tx = provider.read(flow.get("tx"), "tx")
        if not tx:
            return None
        who = {"oid": claims.get("oid"), "name": claims.get("name"), "email": claims.get("preferred_username") or claims.get("email")}
        resp = RedirectResponse("/connect/consent", status_code=303)
        resp.delete_cookie(web.FLOW_COOKIE, path="/")
        set_cookie(resp, provider.sign("connect", {"tx": flow["tx"], "who": who, "csrf": secrets.token_urlsafe(24)}, CONSENT_TTL))
        return resp

    def session(request):
        c = provider.read(request.cookies.get(CONNECT_COOKIE), "connect")
        tx = provider.read(c["tx"], "tx") if c else None
        return (c, tx) if c and tx else (None, None)

    @server.custom_route("/connect/start", methods=["GET"])
    async def start(request):
        tx = request.query_params.get("tx", "")
        if not provider.read(tx, "tx"):
            return html(web.login_page(configured=True, error="The connection request expired. Add the connector in Claude again."), 400)
        return web.entra_redirect(w, entra, {"tx": tx})

    @server.custom_route("/connect/consent", methods=["GET"])
    async def consent(request):
        c, tx = session(request)
        if not c:
            return html(web.login_page(configured=True, error="The connection request expired. Add the connector in Claude again."), 400)
        return html(consent_page(s, c["who"], c["csrf"]))

    @server.custom_route("/connect/accept", methods=["POST"])
    async def accept(request):
        c, tx = session(request)
        if not c:
            return html(web.login_page(configured=True, error="The connection request expired. Add the connector in Claude again."), 400)
        form = parse_form(await request.body())
        if not secrets.compare_digest(form.get("csrf", ""), c["csrf"]):
            return html(web.login_page(configured=True, error="The form could not be checked. Add the connector in Claude again."), 400)

        def back(params: dict):
            q = {k: v for k, v in {**params, "state": tx.get("st")}.items() if v}
            resp = RedirectResponse(f"{tx['ru']}{'&' if '?' in tx['ru'] else '?'}{urllib.parse.urlencode(q)}", status_code=303)
            resp.delete_cookie(CONNECT_COOKIE, path="/")
            return resp

        if form.get("action") != "accept":
            return back({"error": "access_denied", "error_description": "The person did not accept the rules."})
        jira, gitlab = form.get("jira_email", "").strip(), form.get("gitlab_username", "").strip()
        problem = ("Accept the rules to continue." if form.get("agree") != "yes" else "Enter a valid Jira email." if not EMAIL.match(jira)
                   else "The GitLab username may have letters, digits, dots, dashes and underscores only." if gitlab and not GITLAB_USER.match(gitlab) else None)
        if problem:
            return html(consent_page(s, c["who"], c["csrf"], problem, {"jira_email": jira, "gitlab_username": gitlab}), 400)
        identity = {**c["who"], "jira_email": jira, "gitlab_username": gitlab or None, "rules": s.rules_version}
        return proceed(c["tx"], tx, identity)

    def proceed(tx_token: str, tx: dict, identity: dict):
        """The next service the person has not signed in to yet (Atlassian, GitLab, GitHub), else the code back to Claude."""
        for key, slug, client in s.upstreams:
            if key not in identity:
                state = secrets.token_urlsafe(24)
                resp = RedirectResponse(client.authorize_url(s.upstream_redirect(slug), state), status_code=303)
                ref = secrets.token_urlsafe(16)
                now = time.time()
                for r in [r for r, (t, _) in pending.items() if t < now]:
                    pending.pop(r)  # forget sign-ins nobody finished
                pending[ref] = (now + CONSENT_TTL, identity)  # the sealed links stay here, not in the cookie: a browser drops a cookie over 4 KB and the chain was lost
                resp.set_cookie(LINK_COOKIE, provider.sign("link_state", {"tx": tx_token, "ref": ref, "state": state, "k": key}, CONSENT_TTL), max_age=CONSENT_TTL, httponly=True,
                                secure=s.secure, samesite="lax", path="/")
                resp.delete_cookie(CONNECT_COOKIE, path="/")
                return resp
        resp = RedirectResponse(f"{tx['ru']}{'&' if '?' in tx['ru'] else '?'}{urllib.parse.urlencode({k: v for k, v in {'code': provider.make_code(tx, identity), 'state': tx.get('st')}.items() if v})}", status_code=303)
        resp.delete_cookie(CONNECT_COOKIE, path="/")
        resp.delete_cookie(LINK_COOKIE, path="/")
        return resp

    def make_callback(key: str, slug: str, client):
        async def callback(request):
            c = provider.read(request.cookies.get(LINK_COOKIE), "link_state")
            tx = provider.read(c["tx"], "tx") if c else None
            q = request.query_params
            held = pending.get(c["ref"]) if c else None
            ident = held[1] if held and held[0] > time.time() else None
            if c and tx and ident and c.get("k") != key:
                # A stale tab or a back button: the cookie says another service is next. Do not dead-end, go on with the service that is still missing.
                return proceed(c["tx"], tx, ident)
            if not (c and tx and ident) or not secrets.compare_digest(q.get("state", ""), c["state"]):
                return html(web.login_page(configured=True, error=f"The {slug.title()} sign-in expired. Add the connector in Claude again."), 400)
            if q.get("error") or not q.get("code"):
                qs = {k: v for k, v in {"error": "access_denied", "error_description": f"{slug.title()} was not connected.", "state": tx.get("st")}.items() if v}
                resp = RedirectResponse(f"{tx['ru']}{'&' if '?' in tx['ru'] else '?'}{urllib.parse.urlencode(qs)}", status_code=303)
                resp.delete_cookie(LINK_COOKIE, path="/")
                return resp
            try:
                link = await asyncio.to_thread(client.link, q["code"], s.upstream_redirect(slug))
            except RuntimeError as e:
                return html(web.login_page(configured=True, error=f"{e}. Add the connector in Claude again."), 400)
            pending.pop(c["ref"], None)
            return proceed(c["tx"], tx, {**ident, key: provider.seal_link(ident, link)})

        return callback

    for key, slug, client in s.upstreams:
        server.custom_route(f"/connect/{slug}/callback", methods=["GET"])(make_callback(key, slug, client))

    return {"after_identity": after_identity}
