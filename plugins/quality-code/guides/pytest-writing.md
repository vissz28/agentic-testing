# Writing pytest tests from a ticket

The generic rules `/quality-code:spec` always follows on a Python backend. A layer's own `guide` (set
in `pytest.layers`) adds the team's conventions on top of these and wins where they differ.

## Shape

- One spec file per layer, named `test_<topic>.py` (or `<topic>_test.py`) in the layer's folder
  (`tests/` by default).
- **One class per ticket**: `class Test<Topic>:` at the top level of the file, whose docstring's first
  line is `<KEY> <summary>`. The docstring is the ticket's block: pytest has no titles and a class name
  cannot hold the `-` of a key, so the checks find the block by its docstring's first line (the class
  name when there is no docstring). Every test of the ticket goes inside that class.
- One test method per scenario of the ticket: `def test_<scenario>(self):`, the scenario in plain
  snake_case words. The checks read the function name as the test's title.
- **One behaviour per test.** If a test needs "and" in its name, it is two tests.
- **Arrange, act, assert**, in that order, separated by a blank line. Arrange builds the input; act
  calls the code once; assert checks the result.

```python
import pytest

from app.pricing import line_total


class TestLineTotals:
    """ABC-123 Line totals round to the cent"""

    def test_rounds_a_total_of_10_005_up_to_10_01(self):
        line = {"unit_price": "3.335", "quantity": 3}

        total = line_total(line)

        assert total == pytest.approx(10.01)
```

## Expected values

- **Use the real expected values from the ticket**, written as the ticket writes them: the numbers and
  quoted texts from its Then / Expected lines go inside an `assert`. The pipeline checks that every one
  of them is asserted.
- Plain `assert`, the actual value on the left and the expected one on the right:
  `assert order.total == 53.50`, not `assert 53.50 == order.total`. The value check reads the right
  side as the expected value and the call arguments on the left as inputs.
- An assert's message (`assert x == 80, "the total"`) is no assertion: the value must be in the
  expression.
- Floats: `pytest.approx(13.5)` on the right, or `Decimal("13.50")` when the code works in decimals.
- An expected error: `with pytest.raises(ValueError, match="quantity must be 1 or more"):` around the
  one call that raises, with the ticket's message in `match` (it is a regular expression: escape
  `.`, `(`, `?` and the like, or use `re.escape`).
- Never invent an expected value, and never compute it by calling the code under test.
- No snapshot for values (`syrupy`, `snapshottest`): a snapshot records whatever the code returns.
  Assert the value itself.
- Prefer the exact comparison: `assert total == 42` over `assert total > 0`, `assert order == {…}`
  over `assert order`, `assert error == "…"` over `assert error`.
- A behaviour the ticket does not pin down is a test marked `@pytest.mark.xfail(reason="ABC-123 not
  pinned down yet", strict=True)` with the assertion it will have, never a guess.

## Parametrize

- `@pytest.mark.parametrize` only for cases of one scenario that differ in values alone, each with the
  ticket's values: `@pytest.mark.parametrize("quantity, total", [(1, 4.50), (3, 13.50)])`.
- Give the cases ids (`ids=["one", "three"]`) when the values do not say what the case is.
- Two scenarios of the ticket are two tests, not two cases of one.

## Fixtures

- Build the test's own input in the test. A fixture is for setup several tests share and that is not
  the point of the test (a database session, a client, a temp folder): `tmp_path`, `monkeypatch` and the
  project's own fixtures in `conftest.py`.
- Never add or change a `conftest.py` another team owns, nor the project's pytest configuration.
- Never put an assertion in a fixture: the checks count the assertions in the test.

## Mocks

- **Mock only I/O boundaries**: the network, the database, the file system, the clock, a message
  queue, a third-party SDK. Use `monkeypatch.setattr` or `unittest.mock.patch` on that boundary only.
- **The integration layer uses the real database.** When the project starts databases in containers
  (`testcontainers` in its dependencies, a fixture that starts a `PostgresContainer` or the like), the
  tests of its integration layer use that fixture (`postgres_url`, `redis_url` and so on from the
  `conftest.py` setup writes, or the team's own) and never mock the database: arrange the rows the
  test needs, and assert what the code reads or writes there. Unit tests keep mocking it.
- Never mock the code under test or a pure helper it calls: the test must run the real logic.
- `monkeypatch` undoes itself after each test; a `patch` is a `with` block or a decorator, never a
  `start()` without its `stop()`.

## Determinism

- **Time:** pass the time in, or freeze it at the boundary (`monkeypatch` the module's clock, or
  `freezegun` when the project has it) at a fixed `datetime(2026, 1, 15, 10, 0, tzinfo=timezone.utc)`.
  Never depend on today's date or the machine's time zone.
- **Random:** pass a seeded `random.Random(42)` or a fixed value; no real random ids in an assertion.
- No order between tests: each test arranges its own data. No module-level mutable state.
- No real network, no `time.sleep`.

## Never

- `@pytest.mark.skip`, `@pytest.mark.skipif` or `pytest.skip()` without a ticket key in its reason.
- A test with no `assert` (and no `pytest.raises`), or an assert that cannot fail: `assert True`,
  `assert x == x`, or asserting the input you just built.
- A test outside its ticket's class, or a second class for the same ticket.
- A change to application code, config or another team's test to make a test pass.
