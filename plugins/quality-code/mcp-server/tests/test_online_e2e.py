"""The online server for real: the HTTP server in its own process, a mock Entra tenant serving the signing keys,
and a real MCP client that signs in with a bearer token."""
import asyncio
import base64
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

TENANT, CLIENT = "33333333-3333-3333-3333-333333333333", "44444444-4444-4444-4444-444444444444"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def b64(n: int) -> str:
    return base64.urlsafe_b64encode(n.to_bytes((n.bit_length() + 7) // 8, "big")).rstrip(b"=").decode()


def jwks():
    pub = KEY.public_key().public_numbers()
    return {"keys": [{"kty": "RSA", "kid": "k1", "use": "sig", "alg": "RS256", "n": b64(pub.n), "e": b64(pub.e)}]}


@pytest.fixture(scope="module")
def tenant():
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps(jwks()).encode()
            self.send_response(200 if self.path.endswith("/discovery/v2.0/keys") else 404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


@pytest.fixture(scope="module")
def server(tenant, tmp_path_factory):
    port, project = free_port(), tmp_path_factory.mktemp("project")
    env = {**os.environ, "QUALITY_CODE_ENTRA_TENANT_ID": TENANT, "QUALITY_CODE_ENTRA_CLIENT_ID": CLIENT, "QUALITY_CODE_ENTRA_AUTHORITY": tenant,
           "QUALITY_CODE_PUBLIC_URL": f"http://127.0.0.1:{port}", "QUALITY_CODE_PROJECT_DIR": str(project)}
    p = subprocess.Popen([sys.executable, "-m", "quality_code_mcp", "--transport", "http", "--port", str(port)], env=env, cwd=Path(__file__).parents[1],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if urllib.request.urlopen(url + "/health", timeout=1).status == 200:
                break
        except Exception:
            time.sleep(0.2)
    else:
        p.kill()
        pytest.fail("the server did not start")
    yield url
    p.terminate()
    p.wait(timeout=10)


def token(tenant, **over):
    c = {"iss": f"{tenant}/{TENANT}/v2.0", "aud": f"api://{CLIENT}", "tid": TENANT, "exp": int(time.time()) + 600, "scp": "access_as_user", "oid": "u1"}
    c.update(over)
    return jwt.encode(c, KEY, algorithm="RS256", headers={"kid": "k1"})


def session(url, bearer):
    async def go():
        async with streamable_http_client(url + "/mcp", http_client=create_mcp_http_client(headers={"Authorization": f"Bearer {bearer}"})) as (r, w):
            async with ClientSession(r, w) as s:
                await s.initialize()
                tools = {t.name for t in (await s.list_tools()).tools}
                out = (await s.call_tool("quality_code_run_script", {"script": "ticket", "args": ["config", "check"]})).content[0].text
                return tools, out

    return asyncio.run(go())


def test_signed_in_client_gets_the_jira_only_tools_and_runs_a_script(server, tenant):
    tools, out = session(server, token(tenant))
    assert tools == {"quality_code_ticket", "quality_code_ticket_eval", "quality_code_tickets_eval", "quality_code_run_script", "quality_code_guide"}
    assert "[exit code" in out


def test_unsigned_or_foreign_tokens_never_connect(server, tenant):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = jwt.encode({"iss": f"{tenant}/{TENANT}/v2.0", "aud": CLIENT, "tid": TENANT, "exp": int(time.time()) + 600}, other, algorithm="RS256", headers={"kid": "k1"})
    for bad in (forged, token(tenant, aud="api://other"), token(tenant, exp=int(time.time()) - 5)):
        with pytest.raises(BaseException):
            session(server, bad)
    assert urllib.request.urlopen(server + "/health").status == 200
