"""The upstream client never hands a token to another host or over plain http when it follows a redirect. No network: the redirect handler is called directly, with the absolute address urllib gives it."""
import io
import urllib.error
import urllib.request
from email.message import Message

import pytest

from quality_code_mcp.webclient import SafeRedirects


def follow(newurl, url="https://api.atlassian.com/ex/jira/c/rest/api/3/issue/A-1"):
    req = urllib.request.Request(url, headers={"Authorization": "Bearer secret", "Accept": "application/json"})
    return SafeRedirects().redirect_request(req, io.BytesIO(), 302, "Found", Message(), newurl)


def test_a_redirect_on_the_same_host_keeps_the_token():
    out = follow("https://api.atlassian.com/ex/jira/c/rest/api/3/issue/A-2")
    assert out.full_url.endswith("/issue/A-2") and out.get_header("Authorization") == "Bearer secret"


def test_a_redirect_to_another_host_drops_the_token():
    out = follow("https://elsewhere.example/x")
    assert out.full_url == "https://elsewhere.example/x"
    assert out.get_header("Authorization") is None and not any(k.lower() == "authorization" for k, _ in out.header_items())
    assert out.get_header("Accept") == "application/json"


def test_a_redirect_down_to_http_is_refused():
    for target in ("http://api.atlassian.com/ex/jira/c/rest/api/3/issue/A-1", "http://elsewhere.example/x"):
        with pytest.raises(urllib.error.HTTPError):
            follow(target)
