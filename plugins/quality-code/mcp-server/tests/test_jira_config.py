import json

import pytest

from quality_code_mcp import jira_config as jc


def jira(env):
    return json.loads(jc.default_config_json(env))["jira"]


def test_without_the_jira_variables_the_default_config_is_teamsystem_jira_and_any_project():
    assert jira({}) == {"site": "https://teamsystem.atlassian.net", "projects": ["*"]}


def test_a_star_means_any_project():
    assert jira({"QUALITY_CODE_JIRA_SITE": "https://example.atlassian.net", "QUALITY_CODE_JIRA_PROJECTS": "*"})["projects"] == ["*"]


def test_the_variables_make_the_config_the_scripts_read():
    got = json.loads(jc.default_config_json({"QUALITY_CODE_JIRA_SITE": "https://example.atlassian.net/", "QUALITY_CODE_JIRA_PROJECTS": "AGT, ABC"}))
    assert got == {"version": 2, "frontend": "playwright", "jira": {"site": "https://example.atlassian.net", "projects": ["AGT", "ABC"]}}


def test_no_file_is_written(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    jc.default_config_json({})
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("env", [
    {"QUALITY_CODE_JIRA_SITE": "https://example.atlassian.net"},
    {"QUALITY_CODE_JIRA_PROJECTS": "AGT"},
    {"QUALITY_CODE_JIRA_SITE": "http://example.atlassian.net", "QUALITY_CODE_JIRA_PROJECTS": "AGT"},
    {"QUALITY_CODE_JIRA_SITE": "https://example.atlassian.net/jira", "QUALITY_CODE_JIRA_PROJECTS": "AGT"},
    {"QUALITY_CODE_JIRA_SITE": "https://example.atlassian.net", "QUALITY_CODE_JIRA_PROJECTS": "agt"},
])
def test_a_half_set_or_malformed_setting_is_refused(env):
    with pytest.raises(jc.JiraConfigError):
        jc.default_config_json(env)
