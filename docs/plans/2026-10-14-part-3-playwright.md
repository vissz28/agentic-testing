# Part 3 implementation plan: the Playwright pipeline

Spec: [part 3](../specs/2026-10-14-part-3-playwright-design.md) · Jira: AGT-44 · Branch: from main
after 0.6.0 · Release 0.7.0. Plugin root: `plugins/quality-code/` (paths below are relative to it
unless they start with `docs/`).

## Global constraints

- No npm dependencies in the plugin; imports are `node:*` or relative.
- Style: 2-space indent, single quotes, no semicolons. Zero-dependency Node ≥ 18.
- No `AGT`, `FIC`, `warehouse`, `teamsystem`, `Giacenza`, `Magazzino` or other project values under
  `core/` (CI greps for them).
- Child processes: `spawn` with an argument list, never a shell; detached, process-group kill on
  timeout, finish once, temp files in `os.tmpdir()` always deleted (the pattern of
  `core/runners/vitest.mjs`).
- `not_run` is never a pass; "not applicable" is a `pass` with `data.applicable: false`.
- Do not touch `examples/`, `test/e2e/`, `.github/workflows/`, `README.md`, `docs/GETTING_STARTED.md`
  (other work in flight); proposed README text goes in the hand-off report.
- Commits: conventional subject ending `(AGT-44)`, blank line, the `Co-Authored-By` and
  `Claude-Session` trailer lines.
- TDD for every task; `npm test` green before each commit, except the two known container failures
  ("add on a read-only ticket file" under root; "timeout kills the whole process group,
  grandchildren included" without zombie reaping).

## Task P1: the `playwright` config block

Files: `core/config.mjs`, `schema/quality-code.schema.json`, `test/config.test.mjs`, the schema test.
`FIELDS` gains `playwright`. Rules per spec §3: only with `adapter: "playwright"`; allowed keys
`configs`, `projects`, `tsconfig`, `timeoutSeconds`; `configs` validated as `vitest.configs` (share a
helper); `projects` 1–10 one-line non-empty names not starting with `-`, no duplicates. Export
`adapterOptions(config)` (the block of the configured adapter, or `{}`) and
`timeoutSecondsOf(config)` (the block's `timeoutSeconds`, else 600 for Playwright and 300 for Vitest).
Tests: each branch (wrong adapter, not an object, unknown key, bad `configs` entry, `projects` empty,
11 entries, duplicate, `-x`, two lines, timeout 9/3601/1.5, a valid block), the two helpers.
Commit (with P2–P4): `feat(pipeline): the Playwright pipeline (AGT-44)`.

## Task P2: the Playwright runner

Files: create `core/runners/playwright.mjs`, `test/runners/playwright.test.mjs`; extend
`test/runners/fake-bin.mjs` (report path from `PLAYWRIGHT_JSON_OUTPUT_NAME` when no flag gives one;
`-g` with `mutantReport` writes a Playwright-shaped report for the file pattern in `argv[1]`; the
child's `CI`, `FORCE_COLOR` and report path are recorded in `.fake-<name>.env`), keeping every
Vitest behaviour (its tests must stay green unchanged).
Exports: `filePattern(path)`, `titlePattern(title)`, `configFor(file, config)` (as Vitest's, over
`playwright.configs`), `parseReport(json, root)` → `{ tests, broken, error? }`,
`runPlaywright(root, files, { config, projects, testName, timeoutMs })`, `playwrightRunner(root,
config)`. Behaviour and tests per spec §4 and §9.

## Task P3: one pipeline for both adapters

Files: `git mv core/pipeline/vitest.mjs core/pipeline/pipeline.mjs`; `core/pipeline/types.mjs`
(tsconfig and timeout from `adapterOptions` / `timeoutSecondsOf`); `core/pipeline/cli.mjs`;
`core/checks/expected.mjs` and the dialects (`expected.matchers` on the Playwright dialect);
tests in `test/pipeline/*`, `test/checks/expected.test.mjs`.
`runPipeline` picks `{ runner, stryker }` from an adapter table; Playwright has no `stryker` step.
Timeouts from `timeoutSecondsOf`. Tests: a Playwright pipeline with injected runners reaches green,
tests red, checks failed and not verified, and has no `stryker` step; the type-check reads
`playwright.tsconfig`; the expected surface reads `toHaveText('…')` for Playwright only.

## Task P4: the CLI accepts Playwright

Files: `core/pipeline/cli.mjs`, `test/pipeline/cli.test.mjs`. Remove the part 3 refusal; refuse
`--target` for Playwright (spec §7). End-to-end tests through the CLI with fake `playwright` and
`tsc`: green (mutant killed), red, a broken file (not verified), Playwright missing (not verified),
`--target` refused. Commit P1–P4 together or one by one, each with `feat(pipeline): …`.

## Task P5: commands

Files: `commands/check.md`, `commands/start.md`, `commands/write.md` and their string tests.
`check.md`: both adapters, the Playwright sentence about the app, no "comes with part 3". `start.md`
step 4: option 2 for both adapters, option 3 only for Vitest, options not offered are left out and
the rest numbered. `write.md` step 1: the plain "not available yet" line for Playwright.
Commit: `feat(commands): check Playwright specs from check and start (AGT-44)`.

## Task P6: docs

The spec's §14 rulings record (updated while building), spec and plan committed first:
`docs: part 3 spec and plan, the Playwright pipeline (AGT-44)`. CHANGELOG, README, Getting started
and the version bump happen at release (spec §10), outside this branch.
