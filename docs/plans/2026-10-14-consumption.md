# `/quality-code:consumption` implementation plan

Spec: [consumption](../specs/2026-10-14-consumption-design.md) · Jira: AGT-44. Plugin root:
`plugins/quality-code/` (paths below are relative to it unless they start with `docs/`).

## Global constraints

- No npm dependencies; imports are `node:*` or relative. 2-space indent, single quotes, no semicolons.
- No `AGT`, `FIC`, `warehouse`, `teamsystem` or other project values under `core/`.
- Read-only and offline: the scripts only read files under the Claude config dir and the project
  config. No prompt, answer, argument or tool text leaves `transcripts.mjs`.
- Prices come from the `claude-api` skill, never from memory; unknown models are never priced.
- Fixtures are synthetic (`test/consumption/fixtures/`, `__CWD__` replaced at test time); no real
  transcript is committed. No `U` followed by five digits under `test/`.
- Commits: conventional subject ending `(AGT-44)`, blank line, `Co-Authored-By` and `Claude-Session`.

## Task C1: prices

`core/consumption/prices.mjs`: `AS_OF`, `SOURCE`, `PRICES` (input, output, cacheWrite5m = 1.25x
input, cacheWrite1h = 2x input, cacheRead; Claude Haiku 5.5 has a `long` rate above 100K prompt
tokens), `baseModel`, `priceFor`, `costOf`, `loadPrices(file)` (plain-message errors).
Tests: `test/consumption/prices.test.mjs`.

## Task C2: transcripts

`core/consumption/transcripts.mjs`: `configDir`, `slugFor`, `findProjectDirs(root, dir)` (slug,
then `cwd` fallback; returns the places looked at), `loadSessions(dir)`, `classifyUser(line)`,
`attribute(sessions, { keySource })` → `{ runs, events }`. Dedupe by `requestId`, then
`message.id`; subagents by `meta.toolUseId`, else start time.
Tests: `test/consumption/transcripts.test.mjs` on the fixtures (dedupe, boundaries, card answers,
subagents, synthetic lines, ticket keys, slug and `cwd` fallback).

## Task C3: report and card

`core/consumption/report.mjs`: `parsePeriod`, `buildReport` (runs by start day; other usage by its
own time; groups by command, ticket, day or model), `fmtTokens`, `fmtCost`, `formatCard`.
Tests: `test/consumption/report.test.mjs` (totals, other line, unknown model, period filter, each
grouping, the card lines, no runs).

## Task C4: CLI

`core/consumption/cli.mjs` with `main(argv, env, cwd, { now, stdout, stderr })`. Exit 0, 2, 3.
Tests: `test/consumption/cli.test.mjs` (defaults, `--json`, config keys, usage errors, exit 3,
`cwd` fallback, `--prices`, no text leaked, run as a script).

## Task C5: command

`commands/consumption.md` (frontmatter with `allowed-tools` limited to the script; run, card,
`1. By ticket / 2. By day / 3. By model / 4. Stop`). Pinned by `test/consumption-command.test.mjs`.

## Task C6: verify

`npm test` (all green but the two known container failures), the CI grep on `core/`,
`claude plugin validate plugins/quality-code`, and a smoke run against the real transcripts of
this repo. README, CHANGELOG and the version are left to the release.
