# Part 4b implementation plan: writing Vitest tests from a ticket

Spec: [part 4b](../specs/2026-10-14-part-4b-write-tests-design.md) · Jira: AGT-44 · Branch:
`agt-44-write-tests` from main after 0.5.0 · Release 0.6.0. Plugin root: `plugins/quality-code/`
(paths below are relative to it unless they start with `examples/` or `docs/`).

## Global constraints

- No npm dependencies in the plugin; imports are `node:*` or relative. The sample service has its own
  `package.json` and is never imported by `core/`.
- Style: 2-space indent, single quotes, no semicolons. Zero-dependency Node ≥ 18.
- No `AGT`, `FIC`, `warehouse`, `teamsystem` or other project values under `core/`.
- Child processes: `spawn` with an argument list, never a shell; detached, process-group kill on
  timeout, finish at once, temp files in `os.tmpdir()` always deleted (copy the pattern of
  `core/runners/vitest.mjs`).
- `not_run` is never a pass; "not applicable" is a `pass` with `data.applicable: false` and a summary
  starting `not applicable:`.
- Results use `result(check, status, summary, findings, data)` from `core/checks/result.mjs`.
- Commits: conventional subject ending `(AGT-44)`, blank line, `Co-Authored-By: Claude Opus 5.5
  <noreply@anthropic.com>` on its own line.
- TDD for every task; `npm test` green before each commit.

## Task B1: `vitest.layers` and `vitest.stryker` in the config

Files: `core/config.mjs`, `schema/quality-code.schema.json`, `test/config.test.mjs` (and the schema
test). Allowed keys of `vitest` become `configs`, `tsconfig`, `timeoutSeconds`, `layers`, `stryker`.
Rules per spec §3, including: a layer folder that `matches()` (from `core/checks/boundary.mjs`) a
forbidden rule of the effective boundaries is refused with `vitest.layers[i].folder "<f>" is inside
the forbidden "<rule>"`. Export `layersOf(config)` → the configured layers or the default
`[{ name: 'unit', folder: 'test/' }]`, and `strykerThreshold(config)` → number (default 60). Test every
branch (non-array, 0 and 6 entries, bad name, duplicate name, folder without `/`, `..`, guide not
`.md`, threshold −1/101/1.5, layer inside `src/`).
Commit: `feat(config): test layers and the Stryker bar in the vitest block (AGT-44)`.

## Task B2: the `expected` check

Files: create `core/checks/expected.mjs`, `test/checks/expected.test.mjs`; modify
`core/checks/cli.mjs` (+ its test) to add `expected --ticket @file --key KEY <spec…>`.
Exports: `tokensFrom(ticketText)` (numbers normalized, quoted strings 2–80 chars, from
`extractExpectedChunks` of `core/criteria.mjs` with the config's language vocab — read how
`core/score.mjs` gets it), `surface(specSrc, key, dialect)` (the argument text of the matcher calls
listed in spec §4, only inside the key block, found with the dialect's block finder used by
`suite-honesty`), and `run({ specs, key, ticket }, ctx)`. Number matching: `normNum` equivalence
(`1.234,5` = `1234.5` = `1234.50`; `−5` = `-5`). Tests per spec §11.
Commit: `feat(checks): expected values from the ticket must be asserted (AGT-44)`.

## Task B3: the Stryker runner

Files: create `core/runners/stryker.mjs`, `test/runners/stryker.test.mjs` (use
`test/runners/fake-bin.mjs`; extend it only if needed for a Stryker report path flag).
`runStryker(root, { target, timeoutMs })` per spec §5; report parsing in an exported
`parseStrykerReport(json)` → `{ killed, survived, timeout, noCoverage, score }` (score rounded to one
decimal; `null` when there are no mutants). Tests: score, zero mutants, missing binary
(`{ ran: false, error: 'Stryker is not installed' }`), timeout, no report (first stderr line),
temp dir removed.
Commit: `feat(pipeline): Stryker runner over the project's own Stryker (AGT-44)`.

## Task B4: the run marker commands

Files: `core/checks/cli.mjs` (+ test), `core/checks/boundary.mjs` (stale marker rule).
Depends on B2 (same CLI file): do after B2.
`run start --key KEY` / `run stop` / `run status` per spec §7; the hook ignores a marker whose
`startedAt` is older than 12 hours. Key must match the configured projects (`core/checks/keys.mjs`).
Commit: `feat(checks): run start, stop and status for test-writing runs (AGT-44)`.

## Task B5: pipeline, card and CLI integration

Depends on B1–B3 and 4a. Files: `core/pipeline/vitest.mjs`, `core/pipeline/card.mjs`,
`core/pipeline/cli.mjs` and their tests.
`runPipeline` gains `ticket`, `target`; steps and gating per spec §5–6; `ctx.runStryker` injectable;
card labels and What-to-do rows for `expected` and `stryker`; the stryker line only when applicable.
CLI: `--ticket @file` (file must exist and parse), `--target path` (must exist, must not be one of the
specs). Tests for each new verdict path and CLI refusal.
Commit: `feat(pipeline): expected values and Stryker in the pipeline (AGT-44)`.

## Task B6: `/quality-code:write`, the writing guide, `start` option 3

Files: create `commands/write.md`, `core/guides/vitest-writing.md`, `test/write-command.test.mjs`;
modify `commands/start.md`, `test/start-command.test.mjs`.
`write.md` per spec §8, same structure and tone as `start.md` / `check.md`, pinned by string tests:
the gate reuses ticket-eval's steps by reference (`${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md`
steps 1–5), the target card, the plan card, `run start` before writing and `run stop` on every exit,
the file naming rule, the pipeline call with `--ticket` and `--target`, the 2-rewrite cap, the Bug
line, "Never edit application code", "never weaken or delete a test". The guide: generic Vitest
conventions (arrange/act/assert, one behaviour per `it`, real expected values from the ticket, no
snapshot for values, mock only I/O boundaries, deterministic time and random, no `.only`, `it.todo`
for unknown behaviour). `start.md` option 3 becomes `Write and check tests` and follows `write.md`.
Commit: `feat(commands): /quality-code:write writes tests from a ticket (AGT-44)`.

## Task B7: Test folders card in advanced setup

Files: `core/setup.mjs` (`detect().specFolders`: the distinct top-level-two-segment folders holding
`*.spec.*`/`*.test.*` files outside `node_modules`, sorted, max 10), `commands/setup.md` (A4, after
the Vitest configs card), `test/setup.test.mjs`, `test/setup-command.test.mjs`.
Commit: `feat(setup): test folders card in advanced setup (AGT-44)`.

## Task B8: the sample service and the e2e test

Files: create `examples/sample-service/**` per spec §9 (pricing module with one real bug matching
the bug ticket; specs for both tickets written as `/quality-code:write` would); `test/e2e/sample.test.mjs`
(skipped unless `QC_E2E=1`); CI job in `.github/workflows/*` (read the existing workflow first) that
runs `npm ci` in the sample and `QC_E2E=1 npm test` in the plugin. Verify locally: `npm ci` in the
sample, then `QC_E2E=1 npm test`. Sample tickets use the key prefix `DEMO`; no real customer data.
Commit: `feat(examples): a sample service that proves the pipeline end to end (AGT-44)`.

## Task B9: docs and release 0.6.0

Files: `CHANGELOG.md` (0.6.0), `README.md`, `docs/GETTING_STARTED.md`, `plugin.json` and
`marketplace.json` version, CI grep covers `core/guides`, spec §14 rulings record.
Commit: `docs: part 4b docs and release 0.6.0 (AGT-44)`.
