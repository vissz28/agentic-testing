"""A plain `uv run pytest` works: pytest is in uv's default group, and the `test` extra still has it for pip."""
import re
from pathlib import Path

tomllib = __import__("pytest").importorskip("tomllib")
HERE = Path(__file__).resolve().parent.parent


def test_pytest_is_in_the_default_uv_group_and_the_test_extra_and_the_lock_has_both():
    project = tomllib.loads((HERE / "pyproject.toml").read_text())
    assert any(re.match(r"pytest\b", d) for d in project["dependency-groups"]["dev"])
    assert any(re.match(r"pytest\b", d) for d in project["project"]["optional-dependencies"]["test"])
    lock = (HERE / "uv.lock").read_text()
    assert "[package.metadata.requires-dev]\ndev = [{ name = \"pytest\"" in lock
