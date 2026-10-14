# Part 4a: the Vitest pipeline — grade any spec files

Status: approved in conversation (sections 1–4) · Date: 2026-10-14 · Owner: Elvis Zefaj · Jira: AGT-44 ·
Builds on: [part 2](2026-10-14-part-2-shared-checks-design.md), [start](2026-10-14-start-command-design.md)

## 1. Goal

Grade Vitest spec files in any Node/TypeScript project with every quality check, and show the result as
one plain card. Part 4 is split: **4a** (this spec) runs and grades specs that already exist, written
by a person or by Claude; **4b** writes tests from the ticket (layers from the config, expected-values
check, Stryker, a sample service) and calls this pipeline.

## 2. Decisions already taken

| Decision | Value |
|---|---|
| How tests run | Vitest directly: the project's own `node_modules/.bin/vitest`, per-test JSON report, retries off. No npm script, no command template. |
| Which Vitest config | Optional `vitest.configs` in the team config maps spec paths to configs; none means Vitest's default. |
| Grading | The model never grades: a script builds the verdict and the card; commands relay them verbatim. |
| Never a false pass | Ruling from part 2: anything that could not run makes the verdict "not verified", never green. |
| Dependencies | None. Node ≥ 18 built-ins only. |
| Release | quality-code 0.5.0. |

## 3. Configuration

New optional block in `.claude/quality-code.json`, valid only with `adapter: "vitest"`:

```json
"vitest": {
  "configs": [{ "match": "test/integration/**", "config": "vitest.config.db.ts" }],
  "tsconfig": "tsconfig.json",
  "timeoutSeconds": 300
}
```

| Field | Rule | Default |
|---|---|---|
| `configs` | list of `{ match, config }`. `match` uses the boundary pattern syntax (prefix ending `/`, exact, `*`, `**`); `config` is a repo-relative path. First match wins. | `[]`: Vitest picks its default config |
| `tsconfig` | repo-relative path | `tsconfig.json` when it exists |
| `timeoutSeconds` | whole number 10–3600 | 300 |

Paths follow the `boundaries` rules (relative, no `..`, one line). Unknown keys are refused. The short
setup asks nothing new; `/quality-code:setup advanced` gains one card, **Which Vitest config runs which
tests**, shown only when the repo has more than one `vitest.config.*` file: it lists them and asks, per
config, the folder or pattern it runs.

## 4. The runner — `core/runners/vitest.mjs`

Implements the part 2 runner contract: `runTests({ files, testName, timeoutMs }) → { ran, tests: [{ title,
file, status, message }], error?, broken? }`.

- Files are grouped by their matching config; one `vitest run` process per group; results merged.
- Command (no shell; arguments as a list): `<root>/node_modules/.bin/vitest run <files…> --reporter=json
  --outputFile=<temp> --retry=0 [--config <c>] [-t <^escaped title$>]`, with `NO_COLOR=1` and
  `CI=1` in the environment, cwd the project root.
- Results come from the JSON report only, never the exit code. Per assertion result: `passed`,
  `failed` (first line of its first failure message), `skipped` (skipped, pending, todo). A test file
  that failed with no assertion results goes in `broken` with the first line of its message.
- `ran: false` with one plain line when: `node_modules/.bin/vitest` is missing ("Vitest is not installed
  in this project: run npm install"); the timeout is hit ("took longer than <n>s"); no report was
  written (the first non-empty line of Vitest's stderr, e.g. a config error or a database that is
  down).
- The report file lives in the OS temp folder and is always deleted. Nothing is written into the repo.

## 5. The pipeline — `core/pipeline/vitest.mjs`

`runPipeline({ specs, key, range, flakyRuns }, ctx) → { verdict, steps }`; `ctx` = `{ config, dialect,
root, runTests, typeCheck }` (the last two default to the real runner and type-check, and are injected
in tests).

| # | Step (result `check` name) | Runs when | Notes |
|---|---|---|---|
| 1 | `boundary` | always | diff mode, `range` if given |
| 2 | `honesty` | always | on `specs`, `range` if given |
| 3 | `suite-honesty` | always | `key` if given |
| 4 | `types` | always | `tsc --noEmit -p <tsconfig>` with `<root>/node_modules/.bin/tsc`; pass on exit 0; fail with the first error line; **not applicable** (status `pass`, summary "no TypeScript specs") when there is no tsconfig and no `.ts`/`.tsx`/`.mts`/`.cts` spec; `not_run` when there are TS specs but no tsconfig or no `tsc` |
| 5 | `tests` | step 4 passed | the runner on `specs`; pass when every test passed, fail when any failed, not_run when it could not run, a file never ran, or no test ran |
| 6 | `mutation` | step 5 ran | `baseline` = titles that passed in step 5 (no second run) |
| 7 | `flaky` | only with `flakyRuns` | on `specs` |

Steps 1–3 always run. When step 4 fails, steps 5 and 6 are `not_run` ("skipped: the specs do not
compile"). When step 5 is not_run, step 6 is not_run.

**Verdict** (first that applies):

1. `checks_failed` — any of boundary, honesty, suite-honesty, types, mutation, flaky is `fail`.
2. `not_verified` — any step is `not_run`.
3. `tests_red` — only the `tests` step is `fail`.
4. `green` — every step that ran is `pass` and none is `not_run`.

## 6. The card — `core/pipeline/card.mjs`

`formatCard({ verdict, steps }, { specs, key }) → string`, plain English, then one machine line
`PIPELINE_JSON:{"verdict":…,"steps":[…]}`:

```
quality-code check · 2 spec files · ticket ABC-123

Verdict: ❌ checks failed

Tests     8 passed · 0 failed · 1 to do
Checks
  ✅ boundary       no change outside the boundary
  ✅ honesty        no assertion or test removed
  ❌ assertions     1 test runs but asserts nothing: orders.spec.ts › 'cancels'
  ✅ types          compiles
  ⚠️ mutation       not run: the tests did not run

What to do: add a real expect(...) to 'cancels', or mark it it.todo if the behaviour isn't known yet.
```

Verdict lines: `✅ green`, `❌ checks failed`, `⚠️ not verified`, `🔴 tests red`. The step labels are
`boundary`, `honesty`, `assertions` (suite-honesty), `types`, `tests`, `mutation`, `flaky`. "What to do"
comes from the first step that decided the verdict:

| Step | What to do |
|---|---|
| boundary | undo the changes to `<paths>`: tests never change application code |
| honesty | restore the removed assertion or test, or name a ticket on the skip |
| assertions | add a real `expect(...)` to `<test>`, or mark it todo if the behaviour isn't known yet |
| types | fix the compile error: `<first line>` |
| mutation | an assertion can't fail: bind the real expected value in `<tests>` |
| flaky | fix the non-determinism in `<tests>`, or skip them with a ticket |
| tests (red) | `<first failing test>`: `<message>`. For a bug whose fix isn't merged yet, red is the expected result |
| not verified | `<step>` could not run: `<reason>` |

## 7. CLI and commands

- `node core/pipeline/cli.mjs <spec…> [--key KEY] [--range A...B] [--flaky N] [--json]` — loads and
  validates the config (part 1), refuses `adapter: playwright` ("the Playwright pipeline comes with
  part 3"), checks paths and values as the part 2 checks CLI does. Prints the card (or only the JSON
  with `--json`). Exit `0` green, `1` checks failed or tests red, `2` usage/config error or a crash,
  `3` not verified.
- **`/quality-code:check [spec…] [--key KEY] [--flaky N]`** (new command). With specs: run them. With
  none: run `core/branch.mjs --detect`, take the branch's files of kind `test`, and ask
  `Check these <n> spec files? 1. Yes / 2. Pick some / 3. Stop`; the key is the branch's first key
  (confirmed). Before running, post one line ("Running the checks: tests, assertions, types and
  mutation; this can take a few minutes."). Then show the card verbatim without the machine line.
  Never edit tests, never retry.
- **`/quality-code:start`** step 4 becomes:
  `1. Evaluate the ticket / 2. Check the tests on this branch / 3. Write and check tests (coming with
  part 4b) / 4. Stop`. Option 2 is offered only when the branch has test files (`counts.test > 0`) and
  `adapter` is `vitest`; it follows `/quality-code:check` with those files and the confirmed key.
  Option 3 says "Writing tests for any project comes with part 4b." and shows the card again.

## 8. Errors

| Situation | Result |
|---|---|
| No config or a wrong field | exit 2, part 1's message |
| `adapter: playwright` | exit 2, "the Playwright pipeline comes with part 3" |
| A spec path that does not exist, an option value starting with `-`, a key outside the projects | exit 2 |
| Vitest or tsc missing, timeout, database down | the step is not_run with one plain line; verdict not verified (exit 3) |
| Not a git repo | boundary and honesty not_run; verdict not verified |
| A step throws | exit 2, "check <step> crashed: <message>" |

## 9. Testing

- **Runner:** a fake `vitest` (a Node script installed as `node_modules/.bin/vitest` in a temp project)
  records its arguments and writes a Vitest-shaped report chosen by the test. Covers: pass, fail,
  skipped, todo; title escaping (`a (b) + c`) and anchoring; a broken file; no report + stderr line;
  missing binary; timeout; two configs grouped by `match`; temp report deleted. One end-to-end test
  with a real Vitest runs only when `QC_REAL_VITEST=<path to a project with vitest>` is set.
- **Type-check:** a fake `tsc` the same way: exit 0, exit 2 with an error line, missing binary, not
  applicable, TS specs without tsconfig.
- **Pipeline:** injected `runTests` / `typeCheck`, real temp git repos for the static steps: every
  verdict; step skipping after types fail; mutation baseline from step 5 without a second run; flaky
  only when asked; a throwing step.
- **Card:** exact text per verdict and per "What to do" row.
- **Commands:** `check.md` and the `start.md` change pinned by string tests as before.
- **Config:** validation of `vitest` and the schema.
- CI as today plus: no `AGT|FIC` under `core/runners` and `core/pipeline`.

## 10. Release

quality-code **0.5.0**: CHANGELOG entry (Added: `/quality-code:check`, the Vitest pipeline, `start`
option 2, the `vitest` config block and its advanced-setup card), README (capabilities row, check
command, the `vitest` block in the config table, exit codes), Getting started (checking tests).

## 11. Out of scope (4b and later)

Writing tests, test layers and a layer guide, the expected-values check, Stryker, seeding data, a
sample service, the Playwright pipeline (part 3), the run marker around writing.

## 12. Acceptance criteria

1. `/quality-code:check` on a Vitest project prints the card with the right verdict for green, red,
   checks failed and not verified cases, and the matching exit code from the CLI.
2. No path gives `green` when any step could not run.
3. The runner never writes into the project; its report file is deleted.
4. `start` offers "Check the tests on this branch" only for Vitest projects with changed test files.
5. All tests and both validations pass; no `AGT|FIC` in the new core folders.
