"""The browser view of the shared server: sign in with Microsoft Entra ID, then see how to connect to /mcp.

Authorization-code flow with PKCE for the web app registration. The MCP endpoint itself is still protected by bearer tokens (entra.py);
this view only signs a person in and shows them the address and the commands to connect their client."""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html import escape
from pathlib import Path
from typing import Any, Callable

import jwt

from .entra import EntraSettings

SESSION_COOKIE, FLOW_COOKIE = "qc_session", "qc_flow"
SESSION_TTL, FLOW_TTL = 8 * 3600, 600
STATIC = Path(__file__).parent / "static"
LOGO_SVG = (
    '<svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#005075"/><stop offset="1" stop-color="#0090D1"/></linearGradient></defs>'
    '<rect x="16" y="16" width="480" height="480" rx="112" fill="url(#g)"/>'
    '<g fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round" stroke-linejoin="round">'
    '<polyline points="164,148 84,256 164,364"/><polyline points="348,148 428,256 348,364"/></g>'
    '<polyline points="190,262 236,310 324,206" fill="none" stroke="#00C3EA" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)


@dataclass(frozen=True)
class WebSettings:
    entra: EntraSettings
    client_secret: str  # the web app registration's client secret: the server redeems the sign-in code with it
    session_key: str  # signs the cookies

    @property
    def redirect_uri(self) -> str:
        return self.entra.public_url.rstrip("/") + "/auth/callback"

    @property
    def mcp_url(self) -> str:
        return self.entra.public_url.rstrip("/") + "/mcp"

    @property
    def secure(self) -> bool:
        return self.entra.public_url.startswith("https://")


def settings_from_env(entra: EntraSettings, env: dict[str, str]) -> WebSettings | None:
    """None when no client secret is set: the view then says sign-in is not set up, and /mcp works as before."""
    secret = (env.get("QUALITY_CODE_ENTRA_CLIENT_SECRET") or "").strip()
    if not secret:
        return None
    key = (env.get("QUALITY_CODE_SESSION_SECRET") or "").strip() or secrets.token_urlsafe(32)  # a random key signs users out on restart
    return WebSettings(entra=entra, client_secret=secret, session_key=key)


def _sign(w: WebSettings, payload: dict, ttl: int) -> str:
    return jwt.encode({**payload, "exp": int(time.time()) + ttl}, w.session_key, algorithm="HS256")


def _read(w: WebSettings, token: str | None) -> dict | None:
    if not token:
        return None
    try:
        return jwt.decode(token, w.session_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def redeem_code(w: WebSettings, code: str, verifier: str) -> str:
    """Trade the sign-in code for the ID token at Microsoft (blocking: callers run it off the event loop)."""
    body = urllib.parse.urlencode({
        "client_id": w.entra.client_id, "client_secret": w.client_secret, "grant_type": "authorization_code", "code": code,
        "redirect_uri": w.redirect_uri, "code_verifier": verifier, "scope": "openid profile email",
    }).encode()
    req = urllib.request.Request(f"{w.entra.authority}/{w.entra.tenant_id}/oauth2/v2.0/token", data=body, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 - the authority is checked to be https in settings_from_env
        return json.load(r)["id_token"]


def check_id_token(w: WebSettings, id_token: str, nonce: str, signing_key: Callable[[str], Any]) -> dict:
    claims = jwt.decode(id_token, signing_key(id_token), algorithms=["RS256"], audience=w.entra.client_id, issuer=w.entra.issuers,
                        options={"require": ["exp", "iss", "aud"]})
    if claims.get("tid") != w.entra.tenant_id or claims.get("nonce") != nonce:
        raise jwt.InvalidTokenError("tenant or nonce does not match")
    return claims


# ---------------------------------------------------------------- pages

CSS = """
:root{--bg:#F4F9FC;--ink:#10212E;--muted:#587184;--line:#D5E6F0;--card:#fff;--deep:#005075;--blue:#0090D1;--cyan:#00C3EA;--soft:#E5F4FB;--ok:#0E9F6E;--code:#EEF6FB;--g1:#005075}
@media(prefers-color-scheme:dark){:root{--bg:#07131C;--ink:#E8F3FA;--muted:#8FA9BB;--line:#183247;--card:#0C1E2C;--soft:#0F2A3B;--code:#0A2132;--g1:#3DB8F0}}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(600px 400px at 85% -5%,rgba(0,195,234,.22),transparent 70%),radial-gradient(700px 500px at -10% 105%,rgba(0,144,209,.18),transparent 70%),radial-gradient(circle,rgba(0,80,117,.14) 1px,transparent 1.4px) 0 0/22px 22px;mask-image:linear-gradient(#000 40%,transparent 100%)}
.top{position:relative;display:flex;justify-content:space-between;align-items:center;padding:22px clamp(18px,4vw,48px)}
.mark{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;font-size:18px}.mark svg{width:34px;height:34px}
.ts{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px}.ts img{height:26px;width:26px;border-radius:7px}
main{position:relative;display:grid;gap:clamp(28px,5vw,72px);align-items:center;max-width:1120px;margin:0 auto;padding:clamp(8px,3vw,40px) clamp(18px,4vw,48px) 56px}
@media(min-width:900px){main{grid-template-columns:1.1fr .9fr;min-height:calc(100vh - 160px)}}
.eyebrow{display:inline-flex;gap:8px;align-items:center;padding:6px 12px;border-radius:999px;background:var(--soft);color:var(--deep);font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
@media(prefers-color-scheme:dark){.eyebrow{color:var(--cyan)}}
h1{font-size:clamp(34px,5vw,56px);line-height:1.04;letter-spacing:-.03em;margin:18px 0 16px}
h1 em{font-style:normal;background:linear-gradient(90deg,var(--g1),var(--blue) 55%,var(--cyan));-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{font-size:18px;line-height:1.55;color:var(--muted);max-width:32em;margin:0 0 34px}
.flow{display:flex;align-items:center;gap:0;flex-wrap:wrap}
.node{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:14px;background:var(--card);border:1px solid var(--line);box-shadow:0 6px 20px rgba(0,80,117,.08);font-weight:600;font-size:14px;opacity:0;animation:pop .6s ease forwards}
.node i{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-style:normal;font-size:14px;color:#fff;background:linear-gradient(135deg,var(--deep),var(--blue))}
.node:nth-child(3) i{background:linear-gradient(135deg,var(--blue),var(--cyan))}.node:nth-child(5) i{background:linear-gradient(135deg,var(--cyan),#2DD4A0)}
.node:nth-child(1){animation-delay:.1s}.node:nth-child(3){animation-delay:.5s}.node:nth-child(5){animation-delay:.9s}
.link{width:34px;height:2px;margin:0 4px;background:repeating-linear-gradient(90deg,var(--blue) 0 6px,transparent 6px 10px);background-size:20px 2px;animation:dash 1s linear infinite}
@keyframes dash{to{background-position:20px 0}}@keyframes pop{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:none}}
.facts{display:flex;gap:26px;flex-wrap:wrap;margin-top:34px;color:var(--muted);font-size:13px}.facts b{display:block;color:var(--ink);font-size:20px;letter-spacing:-.02em}
.card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:clamp(22px,3.2vw,36px);box-shadow:0 30px 70px -30px rgba(0,80,117,.35),0 2px 0 rgba(255,255,255,.6) inset;display:flex;flex-direction:column;gap:22px;animation:rise .7s ease both}
@keyframes rise{from{opacity:0;transform:translateY(16px)}}
.card h2{margin:0;font-size:26px;letter-spacing:-.02em}.sub{margin:6px 0 0;color:var(--muted);font-size:14px;line-height:1.5}
.btn{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;padding:14px 16px;border-radius:12px;border:1px solid var(--line);font:inherit;font-size:15px;font-weight:600;color:var(--ink);background:var(--card);cursor:pointer;text-decoration:none;transition:transform .15s,box-shadow .15s,border-color .15s}
.btn:hover{transform:translateY(-1px);border-color:var(--blue);box-shadow:0 10px 26px -10px rgba(0,144,209,.5)}
.btn.primary{color:#fff;border:0;background:linear-gradient(135deg,var(--deep),var(--blue));box-shadow:0 12px 28px -10px rgba(0,144,209,.7)}
.btn.quiet{font-size:13px;color:var(--muted);padding:10px}
.err{padding:12px 14px;border-radius:12px;font-size:13px;background:#FEF0EF;border:1px solid #F9C9C5;color:#B42318}
.hint{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;color:var(--muted);line-height:1.5}.hint svg{flex:none;width:16px;height:16px;margin-top:1px;color:var(--blue)}
.me{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:var(--soft)}
.av{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--deep),var(--cyan))}
.me small{display:block;color:var(--muted);font-size:12.5px}
.ok{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--ok)}.ok:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px rgba(14,159,110,.18)}
.lbl{font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:600;margin:0 0 8px}
.field{display:flex;gap:8px;align-items:center;padding:6px 6px 6px 14px;border-radius:12px;background:var(--code);border:1px solid var(--line)}
.field code{flex:1;overflow:auto;white-space:nowrap;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}.field pre{margin:0;flex:1;overflow:auto;font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;padding:8px 0}
.copy{border:0;border-radius:9px;padding:9px 13px;font:600 12px inherit;color:#fff;background:var(--deep);cursor:pointer}.copy:hover{background:var(--blue)}
.tabs{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}.tab{padding:7px 12px;border-radius:9px;border:1px solid var(--line);background:none;color:var(--muted);font:600 13px inherit;cursor:pointer}
.tab[aria-selected=true]{background:var(--soft);border-color:var(--blue);color:var(--ink)}
.pane{display:none}.pane.on{display:block}
.foot{text-align:center;font-size:12px;color:var(--muted);margin:0}
@media(prefers-reduced-motion:reduce){*{animation:none!important}.node{opacity:1}}
"""

MS_ICON = ('<svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#F25022"/>'
           '<rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>')
LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'


def _page(title: str, body: str, script: str = "") -> str:
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{escape(title)}</title><link rel="icon" href="data:image/svg+xml;utf8,{escape(LOGO_SVG)}"><style>{CSS}</style></head>'
            f'<body><header class="top"><div class="mark">{LOGO_SVG}Quality Code</div>'
            '<div class="ts"><img src="/static/teamsystem.png" alt="">TeamSystem</div></header>'
            f'<main>{body}</main><script>{script}</script></body></html>')


def _story() -> str:
    return ('<section><span class="eyebrow">Jira · Xray · MCP</span>'
            '<h1>Tests you can trust, <em>straight from the ticket.</em></h1>'
            '<p class="lead">Quality Code reads your Jira ticket, tells you what it is missing, and helps QA and product turn it into test cases. All from the AI assistant you already use.</p>'
            '<div class="flow"><div class="node"><i>1</i>Ticket</div><span class="link"></span><div class="node"><i>2</i>Checks</div><span class="link"></span><div class="node"><i>✓</i>Tests</div></div>'
            '<div class="facts"><span><b>70</b>point readiness gate</span><span><b>0</b>writes without your yes</span><span><b>3</b>environments</span></div></section>')


def login_page(*, configured: bool, error: str | None = None) -> str:
    action = (f'<a class="btn primary" href="/login">{MS_ICON}Sign in with Microsoft</a>' if configured
              else '<div class="err">Sign-in is not set up on this server yet. Ask the owner to set <b>QUALITY_CODE_ENTRA_CLIENT_SECRET</b>.</div>')
    err = f'<div class="err">{escape(error)}</div>' if error else ""
    card = (f'<aside class="card"><div><h2>Welcome back</h2><p class="sub">Sign in with your TeamSystem account to get the address and commands that connect your assistant.</p></div>'
            f'{err}{action}<div class="hint">{LOCK}<span>You sign in at Microsoft. We never see your password, and this page only reads your name and email.</span></div></aside>')
    return _page("Quality Code · Sign in", _story() + card)


def home_page(w: WebSettings, user: dict) -> str:
    who = user.get("name") or user.get("email") or "you"
    initials = escape("".join(p[0] for p in who.split()[:2]).upper())
    cc = f"claude mcp add --transport http quality-code {w.mcp_url}"
    cp = f"/mcp add   (name quality-code, type HTTP, URL {w.mcp_url})"
    js = json.dumps({"mcpServers": {"quality-code": {"type": "http", "url": w.mcp_url}}}, indent=2)

    def field(text: str) -> str:
        return f'<div class="field"><code>{escape(text)}</code><button class="copy" data-copy="{escape(text, quote=True)}">Copy</button></div>'

    card = (f'<aside class="card"><div class="me"><div class="av">{initials}</div><div><b>{escape(who)}</b><small>{escape(user.get("email") or "")}</small></div>'
            '<span class="ok">Signed in</span></div>'
            f'<div><h2>Connect to Quality Code</h2><p class="sub">Add the server once. Your assistant opens Microsoft to confirm, and you are already signed in.</p></div>'
            f'<div><p class="lbl">MCP address</p>{field(w.mcp_url)}</div>'
            '<div><p class="lbl">Add it to your assistant</p><div class="tabs" role="tablist">'
            '<button class="tab" role="tab" aria-selected="true" data-tab="a">Claude Code</button>'
            '<button class="tab" role="tab" aria-selected="false" data-tab="b">Copilot CLI</button>'
            '<button class="tab" role="tab" aria-selected="false" data-tab="c">Cursor &amp; others</button></div>'
            f'<div class="pane on" id="a">{field(cc)}<p class="sub">Then type <b>/mcp</b> in Claude Code and choose <b>Authenticate</b>.</p></div>'
            f'<div class="pane" id="b">{field(cp)}<p class="sub">Start <b>copilot</b>, type this command, and fill in the three values. Sign in with Microsoft when asked.</p></div>'
            f'<div class="pane" id="c"><div class="field"><pre>{escape(js)}</pre><button class="copy" data-copy="{escape(js, quote=True)}">Copy</button></div>'
            '<p class="sub">Paste it into the client’s MCP settings (<b>.mcp.json</b> or <b>mcp.json</b>).</p></div></div>'
            '<a class="btn quiet" href="/logout">Sign out</a></aside>')
    script = ("document.querySelectorAll('.copy').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied';"
              "setTimeout(()=>b.textContent='Copy',1400)}catch(e){b.textContent='Select + copy'}});"
              "document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',x===t));"
              "document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id===t.dataset.tab))});")
    return _page("Quality Code · Connect", _story() + card, script)


# ---------------------------------------------------------------- routes

def register(server, w: WebSettings | None, entra: EntraSettings, *, exchange: Callable[[str, str], str] | None = None,
             signing_key: Callable[[str], Any] | None = None) -> None:
    """Add /, /login, /auth/callback, /logout and /static/teamsystem.png to the server. All are open (no bearer token): the page is for people."""
    from starlette.responses import HTMLResponse, RedirectResponse, Response
    import asyncio

    if w and signing_key is None:
        client = jwt.PyJWKClient(entra.jwks_uri, cache_keys=True)
        signing_key = lambda t: client.get_signing_key_from_jwt(t).key  # noqa: E731
    exchange = exchange or (lambda code, verifier: redeem_code(w, code, verifier)) if w else None

    def html(page: str, status: int = 200) -> HTMLResponse:
        return HTMLResponse(page, status_code=status, headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin"})

    def cookie(resp, name: str, value: str, ttl: int):
        resp.set_cookie(name, value, max_age=ttl, httponly=True, secure=bool(w and w.secure), samesite="lax", path="/")

    @server.custom_route("/", methods=["GET"])
    async def index(request):
        user = _read(w, request.cookies.get(SESSION_COOKIE)) if w else None
        if w and user and user.get("kind") == "session":
            return html(home_page(w, user))
        return html(login_page(configured=bool(w), error=request.query_params.get("error")))

    @server.custom_route("/login", methods=["GET"])
    async def login(request):
        if not w:
            return RedirectResponse("/", status_code=303)
        state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
        q = urllib.parse.urlencode({
            "client_id": entra.client_id, "response_type": "code", "redirect_uri": w.redirect_uri, "response_mode": "query",
            "scope": "openid profile email", "state": state, "nonce": nonce, "code_challenge": _b64(hashlib.sha256(verifier.encode()).digest()),
            "code_challenge_method": "S256", "prompt": "select_account",
        })
        resp = RedirectResponse(f"{entra.authority}/{entra.tenant_id}/oauth2/v2.0/authorize?{q}", status_code=303)
        cookie(resp, FLOW_COOKIE, _sign(w, {"kind": "flow", "state": state, "nonce": nonce, "verifier": verifier}, FLOW_TTL), FLOW_TTL)
        return resp

    @server.custom_route("/auth/callback", methods=["GET"])
    async def callback(request):
        def back(msg: str):
            r = RedirectResponse("/?" + urllib.parse.urlencode({"error": msg}), status_code=303)
            r.delete_cookie(FLOW_COOKIE, path="/")
            return r

        if not w:
            return RedirectResponse("/", status_code=303)
        q = request.query_params
        if q.get("error"):
            return back("Microsoft sign-in was cancelled or refused.")
        flow = _read(w, request.cookies.get(FLOW_COOKIE))
        if not flow or flow.get("kind") != "flow" or not q.get("code") or not secrets.compare_digest(str(q.get("state", "")), flow["state"]):
            return back("The sign-in expired. Please try again.")
        try:
            id_token = await asyncio.to_thread(exchange, q["code"], flow["verifier"])
            claims = await asyncio.to_thread(check_id_token, w, id_token, flow["nonce"], signing_key)
        except Exception:  # noqa: BLE001 - any failure is a failed sign-in; the reason is not shown to the browser
            return back("Sign-in failed. Please try again.")
        resp = RedirectResponse("/", status_code=303)
        resp.delete_cookie(FLOW_COOKIE, path="/")
        cookie(resp, SESSION_COOKIE, _sign(w, {"kind": "session", "name": claims.get("name"), "email": claims.get("preferred_username") or claims.get("email"),
                                               "oid": claims.get("oid")}, SESSION_TTL), SESSION_TTL)
        return resp

    @server.custom_route("/logout", methods=["GET"])
    async def logout(request):
        resp = RedirectResponse("/", status_code=303)
        resp.delete_cookie(SESSION_COOKIE, path="/")
        return resp

    @server.custom_route("/static/teamsystem.png", methods=["GET"])
    async def logo(request):
        return Response((STATIC / "teamsystem.png").read_bytes(), media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})
