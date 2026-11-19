"""One small JSON-over-HTTPS client for the upstream sign-ins (Atlassian, GitLab). Injected as `http` in the settings so tests never touch the network."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

Http = Callable[[str, str, dict, dict | None], Any]  # (method, url, headers, json body) -> parsed json


class SafeRedirects(urllib.request.HTTPRedirectHandler):
    """A redirect to http is refused; one to another host goes without the Authorization header (the token is for the host it was sent to)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = urllib.parse.urlsplit(req.full_url), urllib.parse.urlsplit(urllib.parse.urljoin(req.full_url, newurl))
        if new.scheme != "https":
            raise urllib.error.HTTPError(req.full_url, code, f"redirect to {new.scheme or 'no'} scheme refused", headers, fp)
        out = super().redirect_request(req, fp, code, msg, headers, newurl)
        if out is not None and (new.hostname, new.port) != (old.hostname, old.port):
            for h in [h for h in out.headers if h.lower() == "authorization"]:
                del out.headers[h]
            out.unredirected_hdrs.pop("Authorization", None)
        return out


_opener = urllib.request.build_opener(SafeRedirects)


def real_http(method: str, url: str, headers: dict, body: dict | None, *, err: type[Exception] = RuntimeError, name: str = "The service"):
    if not url.startswith("https://"):
        raise err(f"{name}: only https addresses are used")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Accept": "application/json", **({"Content-Type": "application/json"} if body is not None else {}), **headers})
    try:
        with _opener.open(req, timeout=20) as r:  # noqa: S310 - https only, checked above and on every redirect
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise err(f"{name} answered {e.code}") from None
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise err(f"{name} could not be reached: {e}") from None
