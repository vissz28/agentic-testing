# A Bug ticket leaves a regression test behind

Read this in `/quality-code:spec` when the ticket's `issuetype` is **Bug**. A fixed bug must not come back: the test you write is the proof, and it stays in the suite.

## What to read

From `ticket.json`: the **steps to reproduce**, the **expected** result and the **actual** (wrong) result. If the steps or the expected result are missing, say so on the plan card and write the test from what is there; never invent a value.

## What to write

- **One test that reproduces the bug**: it does the steps and asserts the expected result. It must **fail before the fix** (it sees the actual, wrong result) and **pass after** it. A test that passes on the buggy code proves nothing: rewrite it.
- **The project's conventions first** (naming, folder, helpers, the file that tests the target: step 5's `test-home`). Add to that file; do not make a new file per bug.
- **Tag it `@regression`** and put the **ticket key in the test name**, so it is found from the ticket and back:
  - Playwright: `test('ABC-123 saved filter survives a reload', { tag: ['@regression', '@ABC-123'] }, …)`, the tag list on the `test(` line.
  - Vitest, Jest, Mocha: `it('ABC-123 @regression rounds a half cent up', …)`.
  - pytest: `@pytest.mark.regression` and `test_abc_123_…`; JUnit: `@Tag("regression")` and the key in `@DisplayName`; Go: `TestABC123_…` with `// @regression` on the line above; .NET: `[Trait("Category", "regression")]`.
- Never touch application code to make the test fail or pass.

## Proof: fails before, passes after

The card shows it with `pipeline.mjs --regression-before red|green`:

1. **The fix is not on the branch** (the usual first run): run the checks as normal. The test is red on the bug. Remember `red`.
2. **The fix is on the branch** (a later run of the same spec): add `--regression-before red`. The card then says `Regression proof: failed before the fix, passes now.` when it is green.
3. The test passed without the fix: run with `--regression-before green`; the card says `No proof` and you rewrite the test.

The script decides the proof line. Never write it yourself. When the person says the fix is already on the branch and the test was never seen red, do not claim a proof: say that the fail-before half was not observed.

## Run the suite later

`/quality-code:routine --regression` runs every spec that carries `@regression`.
