# Part 3: the Playwright pipeline — grade any Playwright e2e specs

Status: decided by the controller under the user's "don't ask" instruction · Date: 2026-10-14 ·
Owner: Elvis Zefaj · Jira: AGT-44 · Builds on: [part 4a](2026-10-14-part-4a-vitest-pipeline-design.md),
[part 4b](2026-10-14-part-4b-write-tests-design.md), [part 2](2026-10-14-part-2-shared-checks-design.md)

## 1. Goal

Grade Playwright spec files in any web project with the same checks and the same card as the Vitest
pipeline (4a). Part 3 is split the way part 4 was: **3a** (this spec) runs and grades Playwright specs
that already exist, written by a person or by Claude; **3b** (later) writes Playwright tests from a
ticket, with the frontend extras the warehouse plugin had (edge cases, anchor and finding tags,
design captures, network stubs, XRay rows). §12 records what 3a decides for each of those.

This generalizes the warehouse frontend's `run-pipeline.mjs` and `/playwright` command. None of its
warehouse values (feature labels, routes, Jira site and fields, the `e2e/tests/` layout, the
`warehouse` fixture) are carried over: everything a project needs comes from the team config.

## 2. Decisions

| Decision | Value |
|---|---|
| How tests run | Playwright directly: the project's own `node_modules/.bin/playwright test`, JSON reporter to a temp file, retries off, artifacts to a temp folder. No npm script, no command template. |
| One pipeline | The 4a step order is shared: one `runPipeline` picks its runner from `adapter`. Playwright has no Stryker step (Stryker does not run e2e tests). |
| Which Playwright config | Optional `playwright.configs` maps spec paths to configs, as `vitest.configs` does; none means Playwright's default. |
| Browser projects | Optional `playwright.projects` names the projects to run; none runs every project of the config. A test that ran in several projects is one result: failed if it failed in any. |
| The app | Playwright starts it (the config's `webServer`) or it must already run. A run where every test fails on a refused connection is "could not run", not red. |
| `CI` | Not set by the runner (unlike Vitest): many Playwright configs read `CI` to stop reusing a running dev server, which would break a local run. |
| Grading | Unchanged: scripts build the verdict and the card; commands relay them. `not_run` is never a pass. |
| Writing Playwright tests | Deferred to 3b. `/quality-code:write` says plainly that it writes Vitest tests only. |
| Dependencies | None. Node ≥ 18 built-ins only. |
| Release | quality-code 0.7.0, after 0.6.0 (4b). |

## 3. Configuration

New optional block in `.claude/quality-code.json`, valid only with `adapter: "playwright"`:

```json
"playwright": {
  "configs": [{ "match": "e2e/admin/**", "config": "playwright.admin.config.ts" }],
  "projects": ["chromium"],
  "tsconfig": "tsconfig.json",
  "timeoutSeconds": 600
}
```

| Field | Rule | Default |
|---|---|---|
| `configs` | list of `{ match, config }`, same rules as `vitest.configs`; first match wins | `[]`: Playwright picks its default config |
| `projects` | 1–10 project names; each one line, non-empty, not starting with `-`; no duplicates | every project of the config |
| `tsconfig` | repo-relative path | `tsconfig.json` when it exists |
| `timeoutSeconds` | whole number 10–3600, per Playwright process | 600 (e2e runs are slower than unit runs) |

Paths follow the `boundaries` rules. Unknown keys are refused. `vitest` and `playwright` blocks are
each refused under the other adapter. No setup card in 3a: the block is optional and hand-edited
(§11).

## 4. The runner — `core/runners/playwright.mjs`

Implements the runner contract: `runTests({ files, testName, timeoutMs }) → { ran, tests: [{ title,
file, status, message }], broken, error? }`.

- Files are grouped by their matching config; one `playwright test` process per group; results merged
  and kept only for the requested files.
- Command (no shell; arguments as a list): `<root>/node_modules/.bin/playwright test <file patterns…>
  --reporter=json --retries=0 --output <temp>/output [--config <c>] [--project <p>…] [-g <pattern>]`,
  cwd the project root, with `PLAYWRIGHT_JSON_OUTPUT_NAME=<temp>/report.json` and `NO_COLOR=1` in the
  environment and `FORCE_COLOR` removed.
- **File patterns.** Playwright reads each file argument as a regular expression over the file path,
  so `e2e/a.spec.ts` would also match `e2e/xa.spec.ts`. Each path is passed as
  `(?:^|/)<escaped path>$`.
- **Title pattern.** `-g` matches the test's full title (project, file, describe titles, title) with
  its tags appended (`… title @anchor @ABC-1`). The pattern is `(?:^| )<escaped title>(?: @\S+)*$`.
  Callers keep only results whose title is exactly the asked title (mutation already does).
- **Report.** Walk `suites` → nested `suites` → `specs` → `tests` (one per project). The file is
  `spec.file` resolved against `config.rootDir` (Playwright writes it relative to the test folder),
  then made relative to the project root (symlinked roots resolved). Per test: `expected` → `passed`
  (this includes a `test.fail()` that failed), `unexpected` and `flaky` → `failed`, `skipped` →
  `skipped` (skip and fixme). The message is the first line of the last result's error, without
  colour codes, or the result status (`timedOut`). Results for the same file and title path in
  several projects merge: failed wins, then passed, then skipped; with more than one project the
  message is prefixed `[<project>] `.
- **Broken files.** A load error (syntax, a missing import) stops Playwright before any test; it is in
  the report's `errors` with a `location.file`. Each such file goes in `broken` with the first line of
  the message. An error without a location and no test result (no tests found, a `webServer` that did
  not start, a failing global setup) gives `ran: false` with its first line.
- **The app is down.** No test passed and every failed message names a refused connection
  (`ERR_CONNECTION_REFUSED` / `ECONNREFUSED`): `ran: false`, `the app is not reachable: <first line>`.
- `ran: false` with one plain line when: the binary is missing ("Playwright is not installed in this
  project: run npm install"); the timeout is hit ("took longer than <n>s"); no report was written (the
  first non-empty line of stderr).
- The temp folder (report and artifacts) is always deleted. Nothing is written into the repo except
  the mutation check's temporary spec copies (4a §13, M9).

## 5. The pipeline — `core/pipeline/pipeline.mjs`

`core/pipeline/vitest.mjs` becomes `core/pipeline/pipeline.mjs`: same `runPipeline({ specs, key,
range, flakyRuns, ticket, target }, ctx)`, with the runner and the Stryker step chosen by
`ctx.config.adapter` (`ctx.runTests` / `ctx.typeCheck` / `ctx.runStryker` stay injectable).

| # | Step | Vitest | Playwright |
|---|---|---|---|
| 1 | `boundary` | as 4a | same |
| 2 | `honesty` | as 4a | same, with the Playwright dialect (moved lines forgiven; an `@anchor` / `@finding` tag needs its `@<KEY>` tag) |
| 3 | `suite-honesty` | as 4a | same; design-capture tests (title with `conformance` or `capture`) are not graded |
| 4 | `types` | `tsc --noEmit` | same, with `playwright.tsconfig` |
| 5 | `tests` | Vitest runner | Playwright runner |
| 6 | `expected` | with `--ticket` | same; the surface also reads Playwright's web-first matchers (`toHaveText`, `toContainText`, `toHaveValue`, `toHaveCount`, `toHaveURL`, `toHaveTitle`, `toHaveAttribute`, …) |
| 7 | `mutation` | strongest flip per expect | every flip of every expect in baseline-green tests (part 2 dialect); capture tests are not mutated |
| 8 | `flaky` | with `--flaky N` | same |
| 9 | `stryker` | as 4b | **no step** |

Verdict rules, step skipping and the mutation rulings of 4a §13 (I9, M8) are unchanged. Timeouts for
the runner, mutation and flaky come from `playwright.timeoutSeconds`.

## 6. The card

Unchanged in shape and text (4a §6, 4b §5–6). The header counts spec files; the tests line counts
tests, not test × project.

## 7. CLI and commands

- `core/pipeline/cli.mjs` accepts `adapter: playwright`. `--target` with Playwright is refused (exit
  2, "--target runs Stryker, which is for Vitest projects: leave it out for Playwright specs").
  Everything else as 4a/4b: same options, exit codes and errors.
- **`/quality-code:check`** works for both adapters; the run line is the same. Playwright projects
  add one sentence: the tests open the app, so the config's `webServer` starts it or it must run.
- **`/quality-code:start`** offers option 2 (check the branch tests) for both adapters, and option 3
  (write) only for Vitest. Options not offered are left out and the rest numbered in order.
- **`/quality-code:write`** on a Playwright project says `Writing Playwright tests is not available
  yet: this command writes Vitest tests only. To check the Playwright tests you already have, run
  /quality-code:check.` and stops. The old "comes with part 3" lines go.

## 8. Errors

| Situation | Result |
|---|---|
| `playwright` block under another adapter, or a wrong field | exit 2, the config error |
| `--target` on a Playwright project | exit 2 |
| Playwright or tsc missing, timeout, app down, no tests found, `webServer` did not start | the step is not_run with one plain line; verdict not verified (exit 3) |
| A spec that does not load | tests not_run, "1 file(s) never ran: <file>: <message>" |
| A step throws | exit 2, "check <step> crashed: <message>" |

## 9. Testing

- **Runner:** the fake binary of 4a learns `PLAYWRIGHT_JSON_OUTPUT_NAME` and a Playwright-shaped
  mutant report for `-g`, keeping its Vitest behaviour. Covers: statuses (expected, unexpected,
  skipped, fixme, `test.fail()`), nested describes, the `rootDir` path join, project merge and
  prefix, colour codes stripped, a broken file, an error without a location, the app down, file and
  title patterns (escaping, anchoring, tags), configs grouped by `match`, `--project`, no `CI` and no
  `FORCE_COLOR` in the child, missing binary, timeout, no report, temp folder deleted, nothing written
  in the project.
- **Real Playwright check (not in CI):** the report shape, the file patterns and the `-g` pattern
  with tags were checked once by hand against `@playwright/test` 1.48.2 and 1.64.1 (§13).
- **Pipeline:** the Playwright adapter runs the shared steps with injected runners, has no `stryker`
  step, and reaches every verdict; Vitest tests unchanged.
- **Config, CLI, expected surface, type-check:** new branches each tested.
- **Commands:** `check.md`, `start.md`, `write.md` pinned by string tests.
- CI as today (no `AGT|FIC` under `core/runners` and `core/pipeline`).

## 10. Release

quality-code **0.7.0**: CHANGELOG (Added: the Playwright pipeline, `playwright` config block,
`/quality-code:check` and `start` option 2 for Playwright projects), README (capabilities, the
`playwright` block, check for Playwright), Getting started (checking Playwright tests). Done at
release, outside this branch.

## 11. Out of scope (3b and later)

Writing Playwright tests from a ticket and everything in §12 marked 3b; an advanced-setup card for
`playwright.configs` / `projects` (the block is hand-edited until then); the standalone
`checks/cli.mjs mutation|flaky` with a real runner (the pipeline covers both, for both adapters).

## 12. Warehouse frontend logic: decisions

The parity audit lists the frontend's core logic as a gap (Playwright pipeline, edge-case probing,
anchor and finding tags, XRay, Figma capture, network stubs). Decided here:

| Warehouse frontend behaviour | Decision |
|---|---|
| `run-pipeline.mjs`: honesty → tsc → e2e → suite-honesty → mutation | **Built (3a)**, as the shared pipeline, plus `expected` and `flaky`. |
| Red test on a new acceptance criterion is a regression anchor (exit 0) | **Changed:** red is `tests_red` (exit 1) as for Vitest; the card already says red is the expected result for a bug or a feature not built yet. A script cannot tell an anchor from a broken test, so it never turns red into a pass. |
| `@anchor` / `@finding` tags must carry `@<KEY>` | **Kept** (part 2 honesty, Playwright dialect). Writing the tags is 3b. |
| Edge cases (`<KEY>-edge-<n>-…`, "Extra (not in the ticket)", red edge = finding, exit 0) | **3b.** The writing flow proposes them; the pipeline grades them like any test, and a red edge is `tests_red`. Whether the card gets an "Extra" section is decided in 3b, without a new verdict. |
| Design-conformance capture (`page.screenshot`, never a gate) | **Kept** in the checks (capture tests are not graded or mutated); writing them, and reading Figma, is 3b. The Figma connector stays read-only. |
| `page.route` stub seeding (`/seed`) | **3b**, as rules in a Playwright writing guide (every named field on a row, one row per fact unless the count matters, shapes copied from an existing stub, last-registered route wins). |
| XRay rows (`/xray`, `append-testcase`, `.xlsx`) | **Deferred, optional:** after 3b, as a CSV in XRay's import format behind a config switch. The `.xlsx` workbook and the warehouse case sheets are not carried over. |
| `--qa-only` (export, verdict `not_run`, exit 0) | **Dropped:** `not_run` exits 3 here; the XRay output, when built, needs no pipeline run. |
| `--no-mutate`, `--mutation-threshold` | **Dropped:** the bar is fixed at 100 (part 2). |
| Run log `run.md`, audit JSONL, KPI rollup | **Not decided here** (parity gap D10); unchanged by 3a. |
| `derivable` counts model scenarios on the Playwright rubric (gap D1) | **Kept** for scorer parity in 3a; 3b's gate uses the score only, so model scenarios cannot unlock writing. |
| Route from the feature label, MR diff for selectors, QA-plan scenarios merged into the draft | **3b**, from `features[].route` and the branch. |

## 13. Acceptance criteria

1. `/quality-code:check` on a Playwright project prints the card with the right verdict for green,
   red, checks failed and not verified, and the CLI exits with the matching code.
2. No path gives `green` when a step could not run; the app being down is not verified, not red.
3. The runner never writes into the project; its temp folder is deleted.
4. `start` offers "Check the tests on this branch" for Vitest and Playwright projects, and writing
   only for Vitest. `write` on a Playwright project says plainly that it is not available.
5. All tests pass (except the two known container failures); no project values in `core/`.

## 14. Rulings during the build

Decided while building 3a. Where one differs from an earlier section, this one wins.

1. **Checked against a real Playwright.** With `@playwright/test` 1.48.2 and 1.64.1 in a scratch
   project (not committed: the plugin has no npm dependencies): `spec.file` is relative to
   `config.rootDir` (the test folder); a test appears once per project, as its own spec entry; a load
   error leaves `suites` empty and puts the file in `errors[].location.file`, so one broken file stops
   every file of that run; `-g` sees the tags after the title; file arguments are unanchored regular
   expressions; `FORCE_COLOR` in the environment overrides `NO_COLOR` and puts colour codes into
   error messages.
2. **The whole CLI against a real Playwright (by hand, not in CI).** In the same scratch project
   (1.64.1, a git repo with `adapter: playwright`, `projects: ["a"]`): a spec with two passing tests
   (one title with parentheses) gave `green` with 2/2 mutants killed and `--flaky 2` green, exit 0;
   a spec calling a closed port gave `not verified` ("the app is not reachable: … ECONNREFUSED …"),
   exit 3; a spec with a missing import next to a good one gave `not verified` ("1 file(s) never
   ran"), exit 3. No `test-results/` folder and no `mut-tmp-*` file was left in the project. The
   plugin keeps no npm dependency, so this stays a manual check, like 4a ruling 4.
3. **Card text kept as 4a pinned it.** For a step that could not run, "What to do" reads `tests
   could not run: could not run: <reason>`, with the words twice. It is 4a's text, pinned by its card
   test; "card unchanged" (§6) keeps it. A later card change can drop the repeat for both adapters.
4. **Standalone `flaky` and `mutation`** in `core/checks/cli.mjs` still need a runner and still
   refuse, but the message now points at the pipeline (`node core/pipeline/cli.mjs <spec…>`, with
   `--flaky N`) instead of "coming in parts 3–4".
5. **Tags are not returned by the runner in 3a.** The JSON report has them (`spec.tags`, without the
   `@`), but nothing in 3a uses them; 3b adds them to the runner result when the card learns anchors,
   findings and edges.
