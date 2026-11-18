import json

import pytest

from quality_code_mcp import jira_config as jc


def test_without_the_jira_variables_the_default_config_is_teamsystem_jira_and_any_project(tmp_path):
    p = jc.write_config(tmp_path, {})
    assert json.loads(p.read_text())["jira"] == {"site": "https://teamsystem.atlassian.net", "projects": ["*"]}


def test_a_star_means_any_project(tmp_path):
    p = jc.write_config(tmp_path, {"QUALITY_CODE_JIRA_SITE": "https://example.atlassian.net", "QUALITY_CODE_JIRA_PROJECTS": "*"})
    assert json.loads(p.read_text())["jira"]["projects"] == ["*"]


def test_the_variables_write_the_config_the_scripts_read(tmp_path):
    p = jc.write_config(tmp_path, {"QUALITY_CODE_JIRA_SITE": "https://example.atlassian.net/", "QUALITY_CODE_JIRA_PROJECTS": "AGT, ABC"})
    assert p == tmp_path / ".claude" / "quality-code.json"
    assert json.loads(p.read_text()) == {"version": 2, "frontend": "playwright", "jira": {"site": "https://example.atlassian.net", "projects": ["AGT", "ABC"]}}


@pytest.mark.parametrize("env", [
    {"QUALITY_CODE_JIRA_SITE": "https://example.atlassian.net"},
    {"QUALITY_CODE_JIRA_PROJECTS": "AGT"},
    {"QUALITY_CODE_JIRA_SITE": "http://example.atlassian.net", "QUALITY_CODE_JIRA_PROJECTS": "AGT"},
    {"QUALITY_CODE_JIRA_SITE": "https://example.atlassian.net/jira", "QUALITY_CODE_JIRA_PROJECTS": "AGT"},
    {"QUALITY_CODE_JIRA_SITE": "https://example.atlassian.net", "QUALITY_CODE_JIRA_PROJECTS": "agt"},
])
def test_a_half_set_or_malformed_setting_is_refused(tmp_path, env):
    with pytest.raises(jc.JiraConfigError):
        jc.write_config(tmp_path, env)
    assert not (tmp_path / ".claude").exists()
