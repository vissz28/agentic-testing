"""GitHub for the shared server: the sign-in (authorize and token calls) and the read-only pull request tools, with a fake GitHub that never touches the network."""
import json
import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

from quality_code_mcp import github, vault
from quality_code_mcp.github import GitHubConfigError, GitHubError, GitHubSettings

PR_URL = "https://github.com/acme/shop/pull/7"


class FakeGitHub:
    def __init__(self, files=3, token=None):
        self.calls, self.files, self.token = [], files, {"access_token": "gho_1", "token_type": "bearer"} if token is None else token

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, body))
        if url.endswith("/login/oauth/access_token"):
            return self.token
        if url.endswith("/pulls/7"):
            return {"title": "Add cart", "state": "open", "draft": False, "merged": False, "user": {"login": "ada"}, "base": {"ref": "main"}, "head": {"ref": "cart"},
                    "body": "Adds the cart", "additions": 10, "deletions": 2, "changed_files": self.files, "html_url": PR_URL}
        if "/pulls/7/files" in url:
            page = int(parse_qs(urlparse(url).query)["page"][0])
            lo = (page - 1) * 100
            return [{"filename": f"src/f{i}.py", "status": "modified", "additions": 1, "deletions": 0, "patch": f"@@ patch {i}"} for i in range(lo, min(self.files, lo + 100))]
        if url.endswith("/user"):
            return {"login": "ada", "name": "Ada L"}
        raise AssertionError(url)


def gh(fake, url="https://github.com"):
    return GitHubSettings("cid", "csecret", url=url, http=fake)


LINK = {"at": "gho_1", "exp": int(time.time()) + 3600}


def test_the_authorize_address_asks_for_read_scopes_and_carries_the_state():
    u = gh(FakeGitHub()).authorize_url("https://qc.example.com/connect/github/callback", "st")
    assert u.startswith("https://github.com/login/oauth/authorize?") and "client_id=cid" in u and "state=st" in u and "scope=repo+read%3Auser" in u
    assert "redirect_uri=https%3A%2F%2Fqc.example.com%2Fconnect%2Fgithub%2Fcallback" in u


def test_a_non_expiring_token_has_no_exp_or_refresh_and_refreshing_it_changes_nothing():
    fake = FakeGitHub()
    link = gh(fake).link("code", "https://qc/cb")
    assert link == {"at": "gho_1"}
    m, url, headers, body = fake.calls[0]
    assert (m, url, headers["Accept"]) == ("POST", "https://github.com/login/oauth/access_token", "application/json") and body["code"] == "code" and body["client_secret"] == "csecret"
    assert gh(fake).refresh(link) == link and len(fake.calls) == 1


def test_an_expiring_token_keeps_its_refresh_token_and_rotates_it():
    fake = FakeGitHub(token={"access_token": "ghu_1", "refresh_token": "ghr_1", "expires_in": 28800})
    s = gh(fake)
    link = s.link("code", "https://qc/cb")
    assert link["at"] == "ghu_1" and link["rt"] == "ghr_1" and 28700 < link["exp"] - time.time() <= 28800
    fake.token = {"access_token": "ghu_2", "refresh_token": "ghr_2", "expires_in": 28800}
    new = s.refresh(link)
    assert new["at"] == "ghu_2" and new["rt"] == "ghr_2"
    assert fake.calls[-1][3]["grant_type"] == "refresh_token" and fake.calls[-1][3]["refresh_token"] == "ghr_1"
    fake.token = {"access_token": "ghu_3", "expires_in": 100}  # no new refresh token: keep the old one
    assert s.refresh(new)["rt"] == "ghr_2"
    with pytest.raises(GitHubError):
        s.refresh({"at": "x", "exp": 1})


def test_a_refusal_or_an_answer_without_a_token_is_an_error():
    with pytest.raises(GitHubError):
        gh(FakeGitHub(token={"error": "bad_verification_code"})).link("c", "r")
    with pytest.raises(GitHubError):
        gh(FakeGitHub(token={})).link("c", "r")


def test_a_pull_request_is_read_with_its_files_and_no_diffs_unless_asked():
    fake = FakeGitHub(files=3)
    r = gh(fake).pull(LINK, PR_URL + "/")
    assert r["title"] == "Add cart" and r["author"] == "ada" and r["base"] == "main" and r["head"] == "cart" and r["changed_files"] == 3 and not r["files_truncated"]
    assert [f["path"] for f in r["files"]] == ["src/f0.py", "src/f1.py", "src/f2.py"] and "diffs" not in r and "patch" not in json.dumps(r["files"])
    assert all(c[0] == "GET" and c[2]["Authorization"] == "Bearer gho_1" for c in fake.calls)
    assert fake.calls[0][1] == "https://api.github.com/repos/acme/shop/pulls/7"


def test_the_files_are_capped_at_200_and_said_to_be_cut():
    fake = FakeGitHub(files=450)
    r = gh(fake).pull(LINK, PR_URL)
    assert len(r["files"]) == 200 and r["files_truncated"] and r["changed_files"] == 450
    assert sum("/files" in c[1] for c in fake.calls) == 2


def test_diffs_come_only_for_the_named_files_at_most_five():
    s = gh(FakeGitHub(files=10))
    r = s.pull(LINK, PR_URL, ["src/f1.py", "src/missing.py", "src/f1.py"])
    assert r["diffs"] == [{"path": "src/f1.py", "patch": "@@ patch 1"}, {"path": "src/missing.py", "patch": None}]
    with pytest.raises(GitHubError, match="at most 5"):
        s.pull(LINK, PR_URL, [f"src/f{i}.py" for i in range(6)])


@pytest.mark.parametrize("url", ["https://gitlab.com/acme/shop/pull/7", "https://evil.example.com/acme/shop/pull/7", "http://github.com/acme/shop/pull/7",
                                 "https://github.com/acme/shop/issues/7", "https://github.com/acme/shop/pull/x", "https://github.com/acme/pull/7", "", "https://github.com/a b/shop/pull/7"])
def test_only_pull_request_addresses_on_the_github_host_are_read(url):
    fake = FakeGitHub()
    with pytest.raises(GitHubError):
        gh(fake).pull(LINK, url)
    assert fake.calls == []  # the token goes nowhere else


def test_an_expired_link_is_refused_before_any_call():
    fake = FakeGitHub()
    with pytest.raises(GitHubError, match="expired"):
        gh(fake).pull({"at": "x", "exp": int(time.time()) - 5}, PR_URL)
    assert fake.calls == []


def test_an_enterprise_server_uses_its_own_host_and_api():
    fake = FakeGitHub()
    s = gh(fake, "https://github.example.com")
    assert s.api == "https://github.example.com/api/v3" and s.authorize_url("r", "s").startswith("https://github.example.com/login/oauth/authorize?")
    s.pull(LINK, "https://github.example.com/acme/shop/pull/7")
    assert fake.calls[0][1] == "https://github.example.com/api/v3/repos/acme/shop/pulls/7"
    with pytest.raises(GitHubError):
        s.pull(LINK, PR_URL)


def test_the_environment_needs_both_values_or_neither_and_an_https_host():
    assert github.settings_from_env({}) is None
    s = github.settings_from_env({"QUALITY_CODE_GITHUB_CLIENT_ID": "i", "QUALITY_CODE_GITHUB_CLIENT_SECRET": "s"})
    assert s.url == "https://github.com" and s.api == "https://api.github.com"
    assert github.settings_from_env({"QUALITY_CODE_GITHUB_CLIENT_ID": "i", "QUALITY_CODE_GITHUB_CLIENT_SECRET": "s", "QUALITY_CODE_GITHUB_URL": "https://ghe.example.com/"}).url == "https://ghe.example.com"
    with pytest.raises(GitHubConfigError):
        github.settings_from_env({"QUALITY_CODE_GITHUB_CLIENT_ID": "i"})
    with pytest.raises(GitHubConfigError):
        github.settings_from_env({"QUALITY_CODE_GITHUB_CLIENT_SECRET": "s"})
    for bad in ("http://ghe.example.com", "https://ghe.example.com/path"):
        with pytest.raises(GitHubConfigError):
            github.settings_from_env({"QUALITY_CODE_GITHUB_CLIENT_ID": "i", "QUALITY_CODE_GITHUB_CLIENT_SECRET": "s", "QUALITY_CODE_GITHUB_URL": bad})


def test_the_user_is_read():
    assert gh(FakeGitHub()).user(LINK) == {"login": "ada", "name": "Ada L"}


# -- the tools, as the server registers them
KEY = vault.key_from_env({"QUALITY_CODE_TOKEN_KEY": "k" * 40})


class Provider:
    def __init__(self, fake):
        self.s = SimpleNamespace(github=gh(fake), vault_key=KEY)

    def open_link(self, identity, sealed):
        return vault.unseal(KEY, sealed, aad=str(identity.get("oid")))


def as_person(monkeypatch, claims):
    import mcp.server.auth.middleware.auth_context as ctx

    monkeypatch.setattr(ctx, "get_access_token", lambda: SimpleNamespace(subject="oid-1", claims=claims))


def by_name(fake):
    return {f.__name__: f for f in github.tools(Provider(fake))}


def test_the_tools_are_named_and_read_only_by_name():
    names = set(by_name(FakeGitHub()))
    assert names == {"quality_code_github_pr", "quality_code_github_user"}


def test_the_pr_tool_reads_with_the_persons_sealed_link(monkeypatch):
    fake = FakeGitHub()
    as_person(monkeypatch, {"gh": vault.seal(KEY, LINK, aad="oid-1")})
    out = json.loads(by_name(fake)["quality_code_github_pr"](PR_URL, ["src/f0.py"]))
    assert out["title"] == "Add cart" and out["diffs"][0]["patch"] == "@@ patch 0"
    assert json.loads(by_name(fake)["quality_code_github_user"]())["login"] == "ada"


def test_the_tools_say_when_github_is_not_connected_and_report_errors_as_text(monkeypatch):
    fake = FakeGitHub()
    as_person(monkeypatch, {})
    assert by_name(fake)["quality_code_github_pr"](PR_URL).startswith("error: GitHub is not connected")
    assert by_name(fake)["quality_code_github_user"]().startswith("error: GitHub is not connected")
    as_person(monkeypatch, {"gh": vault.seal(KEY, LINK, aad="someone-else")})  # sealed for another person
    assert by_name(fake)["quality_code_github_pr"](PR_URL).startswith("error: GitHub is not connected")
    as_person(monkeypatch, {"gh": vault.seal(KEY, LINK, aad="oid-1")})
    assert by_name(fake)["quality_code_github_pr"]("https://evil.example.com/a/b/pull/1").startswith("error: only pull requests on github.com")
    assert fake.calls == []
