# Part 2: shared checks

Status: draft for review · Date: 2026-10-14 · Owner: Elvis Zefaj · Related: AGT-28 · Builds on:
[part 1](2026-10-12-part-1-core-config-design.md)

## 1. Goal

Move the deterministic checks that grade generated tests out of the two warehouse repos and into the
`quality-code` plugin, one merged version per check, driven by the project config instead of
hard-coded warehouse values. At the end of part 2 the checks exist as tested building blocks with a
CLI; the pipelines that call them come in part 4 (Vitest) and part 3 (Playwright).

Scope was agreed as: any Node/TypeScript + Vitest backend is the target of this round (parts 2 and 4);
part 2 is shared with the Playwright adapter, so both dialects are covered here.

| # | Part | Delivers |
|---|---|---|
| 1 | Core + config | built (v0.2.0) |
| **2** | **Shared checks** (this spec) | boundary, honesty, suite-honesty, flaky and mutation checks in the plugin |
| 4 | Vitest adapter | conductor, Vitest runner, layers from config, `expected-check`, Stryker, a DB-less sample service |
| 3 | Playwright adapter | conductor, Playwright runner, XRay |
| 5 | Rollout | first teams, warehouse included, switched to the plugin |

## 2. Decisions already taken

| Decision | Value |
|---|---|
| Approach | A: config-declared values, the warehouse scripts split into small plugin modules, a common check result shape borrowed from a generic check contract. |
| Order | Part 2, then part 4, then part 3. |
| Quality bars | Fixed for every team, as the 70-point gate is. Teams describe their repo; they cannot relax a check. |
| Proof | Parity with both warehouse copies of every check, plus a sample service in part 4. |
| Dependencies | None, as in part 1. Node 18+, `node --test`. |
| Warehouse | Unchanged by part 2. Both repos keep their own harness until part 5. |

## 3. What moves, and what does not

| Check | Today (FE / BE) | Kind | Part 2 delivers |
|---|---|---|---|
| `boundary-guard` | FE: `PreToolUse` hook, always on; BE: diff of changed paths after a run | static (paths) | whole check, both modes |
| `honesty-check` | both, diff of a spec against HEAD or a range | static (git diff) | whole check |
| `suite-honesty` | both, a test with no assertion; BE scopes to the ticket anchor | static (source) | whole check |
| `flaky-check` | both, N re-runs classified per test | needs a run | classification and the loop; runner injected |
| `mutate-generated` → `assertion-mutation` | both, strict mutants on the generated assertions | needs a run | planning, the mutant loop, the score and the gate; runner injected |

Not in part 2: `run-pipeline` (the conductor), the result card and run log, the real Vitest and
Playwright runners, `expected-check`, Stryker, `kpi`, `path-check` (it checks the warehouse's own
docs; the plugin has its own tests), a user-facing `check` command, and one unified set of mutation
operators.

## 4. Configuration

All new fields are optional and written by setup. The config stays `version: 1`.

### 4.1 New fields in `.claude/quality-code.json`

| Field | Type | Rule / default | Replaces today's |
|---|---|---|---|
| `boundaries.forbidden` | list of `{ path, why? }`, ≥1 when present | `path`: repo-relative, no `..`, no leading `/`; a prefix ending in `/` (`src/`), an exact file (`.env`), or a glob with `*` (one segment) and `**` (any depth). `why`: one line shown when a write is refused; default text below. Absent: the adapter defaults in 4.3. | the `src/`, `prisma/`, `dapr/`, `.gitlab-ci.yml`, `.env` lists in both `boundary-guard`s |
| `boundaries.allow` | list of path patterns, same syntax | exceptions inside a forbidden path, for example `src/**/*.spec.ts`. Default `[]`. | BE `--mocked` / `allowSrcSpecs` |

Unknown keys inside `boundaries` are refused, as everywhere in the config. The default `why`:
"application code: a test run writes tests, it never changes the code under test."

### 4.2 Existing field now used

`jira.trackingProjects` (part 1 reserved it for this). A `.skip` is a tracked quarantine, and is
allowed, when the same line names a key `<P>-<digits>` with `<P>` in `jira.projects` or
`jira.trackingProjects`. Replaces the hard-coded `(?:AGT|FIC)-\d+`. The ticket-anchor key (`--key`)
is checked against the same project list.

### 4.3 Fixed in the plugin

| Value | Fixed at |
|---|---|
| Always forbidden, whatever the config | `dist/`, `node_modules/`, `.git/`, `.claude/quality-code.json` |
| Adapter defaults when `boundaries` is absent | `src/`, `.env`, `.env.*`, and the CI file setup would detect (`.gitlab-ci.yml`, `.github/workflows/`) when it exists |
| Mutation bar | 100%: any surviving mutant fails the check |
| Honesty violations | an `expect(` line removed; a test or group declaration removed; a skip added with no tracked key. Removing an already skipped or todo test is allowed. |
| Hollow test | a plain test that runs and contains no `expect(` (todo, skip and dialect "not graded" tests excluded) |
| Flaky runs | 5 by default, `--runs N` per call; retries always off |
| Stale run marker | a `run.active` older than 6 hours is ignored |

### 4.4 Setup

One new card after "Templates", in the advanced setup only (the short setup asks just the connectors,
the project and the Jira project, and uses the defaults): **Paths a test run must never change**. It lists the candidates that
exist in the repo (`src/`, `prisma/`, `migrations/`, `dapr/`, `.env` and `.env.*`, the CI file) with
`1. Keep this list / 2. Add a path / 3. Remove a path`, and, for Vitest, one question: "Do specs live
next to the code (`src/**/*.spec.ts`)?" whose yes adds that pattern to `allow`. Re-running setup on a
part 1 config proposes these defaults; nothing is written before the usual `1. Write it`.
The `.gitignore` lines setup writes include `mut-tmp-*` (the temporary specs of a mutation run).

## 5. Components

```
plugins/quality-code/
  core/checks/
    cli.mjs              entry point for every check
    result.mjs           the result shape and exit codes
    dialects/
      vitest.mjs         syntax table + mutation operators
      playwright.mjs
    git.mjs              changed paths and spec diffs (HEAD or a range)
    boundary.mjs         pure rules, hook mode, diff mode
    honesty.mjs
    suite-honesty.mjs
    flaky.mjs
    mutation.mjs
  hooks/hooks.json       PreToolUse on Write|Edit|NotebookEdit → cli.mjs boundary --hook
```

Each module exports pure functions plus a `run(input, ctx)`; only `cli.mjs`, `git.mjs` and the hook
path touch the process, the disk or git. `ctx` = `{ config, dialect, root }`, with `root` from
`$CLAUDE_PROJECT_DIR` (falling back to the git top level), as in part 1.

### 5.1 Dialect

| Entry | `vitest` | `playwright` |
|---|---|---|
| test declarations | `it(`, `test(` | `test(` |
| group declarations | `describe(` | `test.describe(` |
| "not yet" marker, allowed and not graded | `it.todo`, `test.todo` | `test.fixme` |
| skip forms | `.skip(`, `describe.skip` | `test.skip(`, `test.describe.skip` |
| other tests not graded | none | `capture` tests |
| mutation operators | flip `.not`; bump a number literal; corrupt a string literal; `thorough` adds more of each | flip `.not`; corrupt a string literal |
| temp spec name | `mut-tmp-<pid>-<id>.spec.ts` beside the spec | same |

The dialect is chosen by `adapter`. Operators stay per dialect so parity is exact; unifying them is
a later decision.

### 5.2 Ticket-anchor scoping

`suite-honesty` and `assertion-mutation` accept `--key <KEY>` for both dialects: only the top-level
group whose title starts with `<KEY>` is graded, so older tests in the same file are not judged.
Without `--key` the whole file is graded (today's FE behaviour). A key whose block is missing is
`not_run` with the finding "no `<KEY>` block in the spec".

### 5.3 Runner contract (provided by parts 3–4)

```js
runTests({ files, testName, timeoutMs }) => Promise<{
  ran: boolean,          // false: could not run (build, database, config); never a code failure
  tests: [{ title, file, status: 'passed' | 'failed' | 'skipped', message }],
  error                  // when ran is false: one line saying why
}>
```

- `flaky` calls it `runs` times. Per test: `real` (failed every run it ran in), `flaky` (passed and
  failed), `green`. Overall: `flaky` first, then `real`, then `green`; no run executed → `not_run`
  ("could not run"); runs executed but no test seen → `not_run` ("no tests ran").
- `assertion-mutation` takes the green tests from a baseline run, or from `--baseline <json>` passed
  by the caller. For each mutant it writes a temp spec beside the original, runs only that test, and
  records `killed` (the test failed) or `survived` (still green). Temp files are removed on exit, on
  SIGINT and SIGTERM, and swept at start, so an interrupted run leaves the original byte-identical.
- Part 2 ships no real runner. Its tests use a fake runner.

### 5.4 Result shape

```js
{
  check: 'boundary' | 'honesty' | 'suite-honesty' | 'flaky' | 'mutation',
  status: 'pass' | 'fail' | 'not_run',
  summary: '1 assertion removed in orders.spec.ts',   // one plain-language line for a result card
  findings: [{ file, line, test, kind, detail }],     // line and test when known
  data: {}                                            // per check: see below
}
```

| Check | `data` |
|---|---|
| boundary | `{ mode: 'hook' \| 'diff', paths }` |
| honesty | `{ removedAssertions, removedTests, newSkips }` |
| suite-honesty | `{ tests, withAssertion, hollow, todo, skipped, percent }` |
| flaky | `{ runs, executed, tests: [{ title, pass, fail, verdict }] }` |
| mutation | `{ killed, survived, total, score, survivors }`; `score` is `null` when nothing was eligible, and the status is then `pass` |

`not_run` is never reported as a pass; the conductor decides what it means for the verdict.

## 6. CLI contract

```
node core/checks/cli.mjs boundary [--range A...B] [--json]
node core/checks/cli.mjs boundary --hook                  # reads the hook payload on stdin
node core/checks/cli.mjs honesty <spec...> [--range A...B] [--json]
node core/checks/cli.mjs suite-honesty <spec...> [--key KEY] [--json]
node core/checks/cli.mjs flaky <spec...> [--test NAME] [--runs N] [--timeout S] [--json]   # needs a runner (parts 3–4)
node core/checks/cli.mjs mutation <spec> [--key KEY] [--baseline FILE] [--max N] [--json]  # needs a runner (parts 3–4)
```

- Exit codes: `0` pass, `1` fail, `2` usage or config error, `3` not run.
- `--json` prints only the result; otherwise a short human report, then `CHECK_JSON:<result>` on
  the last line, as part 1's `TICKET_EVAL_JSON:` line.
- The config is loaded and validated first with part 1's `config.mjs`; a bad config names the field
  and exits 2.
- In part 2, `flaky` and `mutation` from the CLI exit 2 with "needs the test runner from the
  Vitest or Playwright adapter (coming in parts 3–4)". Their logic is reachable from code and tests.

### 6.1 Boundary hook

`hooks/hooks.json` wires `PreToolUse` on `Write|Edit|NotebookEdit` to `cli.mjs boundary --hook`.

- **No active run → allow, silently.** A run is active when `.claude/quality-code/run.active`
  exists and is younger than 6 hours. The conductor (parts 3–4) writes it at start and removes it
  at the end. Outside a run, people use Claude on their code as usual.
- During a run, a write to a forbidden path is denied with its `why`, and logged as one line in
  `.claude/quality-code/boundary.jsonl` (`ts`, `path`, `decision`, `why`). Setup adds
  `.claude/quality-code/*.jsonl` and `run.active` to the repo's `.gitignore` line it already
  writes.
- A failed log write never decides whether the tool runs.
- The hook covers the file tools only, as today. The diff mode, run by the conductor after writing,
  is the check that counts: it catches a shell write the hook cannot see.
- No config in the repo → allow (the plugin is installed but the repo is not set up).

## 7. Errors

| Situation | Result |
|---|---|
| No config, or a field is wrong | exit 2, part 1's message naming the field, "Run /quality-code:setup." |
| Not a git repo, or the range does not resolve (honesty, boundary diff) | `not_run`, "cannot read the git diff: <reason>" |
| A spec path that does not exist | exit 2, the path named |
| `--key` with a key outside `jira.projects` ∪ `trackingProjects` | exit 2, the allowed projects named |
| Runner reports `ran: false` | `not_run` with the runner's one-line `error` |
| A temp mutant file cannot be written | `not_run`; the original spec is never touched |

## 8. Testing

- **Unit tests** (`node --test`). Every self-test case from both warehouse copies of each check,
  as a named test against the merged module: FE cases with the Playwright dialect, BE cases with the
  Vitest dialect. New cases for: `forbidden` / `allow` globs; the always-forbidden paths; the tracked
  skip from `jira.projects` ∪ `trackingProjects`; `--key` on Playwright; the hook allowing without a
  marker, denying with one, ignoring a stale one, allowing when there is no config; result shape
  and exit codes for every check.
- **Fake runner.** `flaky` and `mutation` end to end: green, real failure, flaky, could not run, no
  tests ran, killed, survived, nothing eligible, interrupt cleanup (the original spec byte-identical
  after SIGINT mid-run), and a stale temp file swept at start.
- **Parity.** `scripts/capture-parity.mjs` gains a `checks` mode. It loads the old check scripts
  from the refs it already uses (`origin/agentic-testing-fe`, `origin/agt-34-remove-audit-logs`)
  with `git show`, without touching either checkout, and records their output on fixtures:
  - specs: the generated specs in both repos (`e2e/tests/**`; `test/{unit,integration,range}/**`
    and the ticket-anchored `src/**/*.spec.ts`);
  - diffs: spec-touching commits from both repos' history, plus the self-test diffs;
  - pure-function inputs: `classify` / `overall` tallies, `planMutants` / `applyMutant` on the
    fixture specs, `isForbidden` / `violation` on every path in the fixture diffs.

  Fixtures are redacted with the warehouse pattern before they are saved. `test/parity/checks/`
  replays them through the merged modules with the warehouse configs (which gain `boundaries`
  matching today's lists) and requires identical results, apart from §9.
- **Guards.** The "no project values in `core/`" test also covers `core/checks/`: no `FIC`, `AGT`,
  `warehouse`, `customfield_`, and no path literal outside the dialect and adapter defaults. The
  no-customer-id test covers the new fixtures.

## 9. Deliberate differences from today (the only allowed parity breaks)

1. FE `suite-honesty` and `assertion-mutation` accept `--key`; without it the behaviour is today's.
2. `assertion-mutation` returns `fail` itself when a mutant survives (bar 100%). Today the script
   only reports and the pipeline applies the bar; the verdict is the same.
3. The boundary hook does nothing outside an active run. Today the FE hook blocks every Claude write
   to `src/` in that repo.
4. A tracked skip may name a key from any configured project, not only `AGT` or `FIC`. With the
   warehouse configs (`projects: ["FIC"]`, `trackingProjects: ["AGT"]`) the result is unchanged.
5. The hook's audit file moves from `.claude/audit/boundary.jsonl` to
   `.claude/quality-code/boundary.jsonl`, git-ignored.
6. Results use one shape (§5.4) instead of each script's own `*_JSON` line; parity compares the
   verdicts and findings, not the printed text.
7. `--key` naming a block that is not in the spec is `not_run` (§5.2) for both stacks. Today's backend
   graded the whole file instead.
8. The frontend's `HARNESS_BOUNDARY_OVERRIDE=1` is gone: the hook only acts during a run, and removing
   `.claude/quality-code/run.active` lifts it.
9. The runner contract (§5.3) carries an optional `broken: [{ file, message }]`; a green flaky run with
   a file that never ran is `not_run`, as the backend's error verdict was.
10. The dialect also carries each stack's honesty, suite-honesty and mutation rules (§5.1 lists the
    syntax only), so both warehouse copies keep their exact verdicts.
11. `--key` matches the whole key (not a substring) and, with several specs, files without the block
    are skipped; `not_run` only when no file has it.
12. A path equal to a forbidden folder (bare `src`) is forbidden for both stacks (the old backend guard
    allowed it).
13. assertion-mutation: when no mutant survives but some mutants ran no test, the result is `not_run`
    ("<killed> of <total> mutants killed; <n> ran no test"), never pass.
14. flaky: green requires every run to have executed (else `not_run`, "only N of M runs executed");
    `runs` must be a whole number of at least 1.
15. A check that crashes makes `core/checks/cli.mjs` exit 2 with "check <name> crashed: ..." on stderr.
16. `dist/`, `node_modules/`, `.git/` and the config file are always forbidden, for both stacks (the old
    frontend guard did not know the first two).
17. suite-honesty: when no test can be graded (no file has one, or all are capture tests) the result is
    `not_run` ("no test to grade"), not a pass.
18. honesty: an untracked spec is read as all added lines (git diff against `/dev/null`), so a new spec
    with a bare skip fails. Applies to the working-tree diff, not to a `--range`.
19. assertion-mutation: a baseline with no passing test (also an empty `--baseline` list) is `not_run`
    ("baseline had no passing test").
20. suite-honesty: every modifier except `skip` and the dialect's not-yet marker (`.only`, `.concurrent`,
    `.fails`) is graded as a plain test: honest when it asserts, hollow when it does not.
21. boundary: diff mode runs without rename detection, so a file moved out of a forbidden folder lists
    its old path; and a `--range` that starts with `-` is refused inside the git helpers, not only in
    the CLI.

## 10. Rollout

- `quality-code` **v0.4.0**: `core/checks/`, the hook, the setup card, the config fields.
- **Compatibility risk:** a config written by v0.4.0 setup with `boundaries` is refused by a v0.2.0
  plugin ("unknown field"). The README and the setup card tell teams to update the plugin before
  re-running setup; `/plugin update` covers it.
- **README:** the capability row for the checks moves to "available (building blocks)", the roadmap
  row for part 2 to available, the config table gains `boundaries`, the Developing section documents
  `core/checks/cli.mjs`.
- **Warehouse:** nothing changes in the warehouse repos; their own harness stays as it is. (The
  `warehouse-*` plugins were removed from the marketplace on 2026-10-14.)

## 11. Out of scope for part 2

The conductor and result card, the real runners, `expected-check`, Stryker, `kpi`, `path-check`, a
`/quality-code:check` command, unified mutation operators, a Bash matcher for the boundary hook,
stacks other than Vitest and Playwright.

## 12. Acceptance criteria

1. `node core/checks/cli.mjs honesty`, `suite-honesty` and `boundary` run in a repo set up with
   part 1 and give the results in §5.4, with the exit codes in §6.
2. With the warehouse configs, every parity fixture gives the same verdict and findings as the
   original warehouse script, apart from §9.
3. `flaky` and `mutation` pass every fake-runner case in §8, including interrupt cleanup.
4. With the plugin installed and no active run, Claude can edit `src/` as usual; with
   `run.active` present, a write to a forbidden path is denied with its `why` and logged.
5. Setup proposes the boundary card, writes `boundaries` only after `1. Write it`, and a part 1
   config without `boundaries` still validates and uses the adapter defaults.
6. CI is green: unit tests, parity, the no-project-values and no-customer-id guards,
   `claude plugin validate`.
7. Neither warehouse repo changed.
