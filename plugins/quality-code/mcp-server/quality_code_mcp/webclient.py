"""One small JSON-over-HTTPS client for the upstream sign-ins (Atlassian, GitLab). Injected as `http` in the settings so tests never touch the network."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Callable

Http = Callable[[str, str, dict, dict | None], Any]  # (method, url, headers, json body) -> parsed json


def real_http(method: str, url: str, headers: dict, body: dict | None, *, err: type[Exception] = RuntimeError, name: str = "The service"):
    if not url.startswith("https://"):
        raise err(f"{name}: only https addresses are used")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Accept": "application/json", **({"Content-Type": "application/json"} if body is not None else {}), **headers})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 - https only, checked above
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise err(f"{name} answered {e.code}") from None
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise err(f"{name} could not be reached: {e}") from None
