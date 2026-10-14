# Part 4b: writing Vitest tests from a ticket

Status: decided by the controller under the user's "don't ask" instruction · Date: 2026-10-14 ·
Owner: Elvis Zefaj · Jira: AGT-44 · Builds on: [part 4a](2026-10-14-part-4a-vitest-pipeline-design.md),
[part 2](2026-10-14-part-2-shared-checks-design.md), [part 1](2026-10-12-part-1-core-config-design.md)

## 1. Goal

From a ticket that passed the readiness gate, Claude writes Vitest specs in the team's test folders,
then the 4a pipeline grades them with two more checks: the ticket's **expected values** are asserted,
and (when the project has it) **Stryker** shows the tests catch real code changes. A small sample
service in this repo proves the whole path with a real Vitest. This generalizes the warehouse
backend's `/spec` (live database, three fixed layers, Prisma, Docker) to any Node/TypeScript project:
none of those warehouse specifics are carried over.

## 2. Decisions

| Decision | Value |
|---|---|
| Entry points | New `/quality-code:write <KEY>`; `start` option 3 runs it (no longer "coming with part 4b"). |
| Gate | The part 1 readiness gate runs first (same scripts as `ticket-eval`). Below 70: the refuse flow of `ticket-eval`, never a test. |
| Where tests go | `vitest.layers` in the config; default one layer `{ "name": "unit", "folder": "test/" }`. |
| Who decides "good" | Scripts. Claude writes; the pipeline grades. Claude never says a test is good. |
| Expected values | A new `expected` check: concrete values from the ticket's Then / Expected text must appear inside an `expect(...)` in the ticket's block. Values not in the ticket are never required. |
| Stryker | Optional. Runs only when `node_modules/.bin/stryker` exists and a target file is known; otherwise the step is "not applicable" (a pass that says so), never blocking. |
| Boundary | The run marker is on while Claude writes; the hook denies writes outside the test folders; the diff check is the one that counts. |
| Retries | Fixable fails get at most 2 rewrites, tests only; then the card is shown as it is. |
| Release | quality-code 0.6.0, after 0.5.0 (4a). |

## 3. Configuration

`vitest` gains two optional fields:

```json
"vitest": {
  "layers": [
    { "name": "unit", "folder": "test/unit/", "guide": "docs/testing/unit.md" },
    { "name": "integration", "folder": "test/integration/" }
  ],
  "stryker": { "threshold": 60 }
}
```

| Field | Rule | Default |
|---|---|---|
| `layers` | 1–5 entries; `name` matches `^[a-z][a-z0-9-]{0,30}$`, unique; `folder` a repo-relative path ending `/`; `guide` an optional repo-relative `.md` path | `[{ "name": "unit", "folder": "test/" }]` |
| `stryker.threshold` | whole number 0–100 | 60 |

A layer folder must not be inside a forbidden boundary (validation error naming the rule). The plugin
ships a generic guide (`core/guides/vitest-writing.md`) that is always read; a layer's `guide` is the
team's own conventions on top of it. Advanced setup A4 gains one card, **Test folders**, proposing
the layers from the folders that already hold specs (`detect().specFolders`).

## 4. The `expected` check — `core/checks/expected.mjs`

`run({ specs, key, ticket }, ctx) → result('expected', …)`, also available as
`core/checks/cli.mjs expected --ticket @file --key KEY <spec…>`.

- **Tokens** come from `extractExpectedChunks` (part 1 `criteria.mjs`) on the sanitized ticket:
  numbers (normalized: `1.234,5` and `1234.5` agree, a leading `−` is a minus) and quoted strings of
  2–80 characters. Words are not tokens (too loose).
- **Grounding:** a token is kept only if it appears in the ticket text itself (never invented).
- **Surface:** the arguments of every `expect(...)`, `.toBe(...)`, `.toEqual(...)`,
  `.toStrictEqual(...)`, `.toContain(...)`, `.toMatchObject(...)`, `.toHaveProperty(...)`,
  `.toThrow(...)` call inside the ticket's block (the key block from the part 2 dialect), across
  all the specs.
- `pass` when every grounded token appears in the surface; `fail` naming each missing token and the
  Then it came from; `pass` with summary `no concrete expected values in the ticket` when there are no
  tokens (the gate already proved the criteria exist); `not_run` when the ticket file is missing or
  unreadable, or no spec has the key block.

## 5. Stryker step — `core/runners/stryker.mjs`

`runStryker(root, { target, specs, timeoutMs }) → { ran, score?, killed?, survived?, error? }`.

- Command (no shell): `<root>/node_modules/.bin/stryker run <tmp>/stryker.config.mjs --mutate <target>
  --testRunner vitest --reporters json --tempDirName <tmp>/stryker-tmp --concurrency 2`. Stryker has
  no command-line option for the JSON report file, so `<tmp>/stryker.config.mjs` loads the project's
  own Stryker config (if any, by Stryker's own file names) and sets only `jsonReporter.fileName` to
  `<tmp>/mutation.json` (found by the sample service's end-to-end run). cwd root, `NO_COLOR=1 CI=1`, same process-group kill and temp clean-up as the
  Vitest runner. Score = killed / (killed + survived + timeout + no coverage), from the JSON report.
- Pipeline step 8 `stryker`, after `mutation`, only when the tests step passed or is red, and
  `target` is given:
  - binary missing → `pass`, summary `not applicable: Stryker is not installed`, `data.applicable:
    false`;
  - no target → `pass`, `not applicable: no target file`;
  - ran → `pass` when score ≥ threshold, else `fail` (`<score>% of code changes caught, the bar is
    <threshold>%`); couldn't run → `not_run`.
- The card shows the step only when it was applicable. Labels and "What to do": `stryker` → `the
  tests miss changes in <target>: assert the values the code computes`.

## 6. Pipeline and CLI changes (on top of 4a)

- `runPipeline` takes `ticket` (path) and `target` (repo-relative file). Steps: boundary, honesty,
  suite-honesty, types, tests, **expected** (runs when `ticket` is given; after suite-honesty),
  mutation, flaky (optional), **stryker**. Verdict rules unchanged: `expected` and `stryker` fails
  are `checks_failed`.
- `core/pipeline/cli.mjs` gains `--ticket @file` and `--target <path>` (path must exist and must not be
  a spec). `--target` without `--ticket` is allowed.
- Card: label `expected`, What to do `assert the ticket's expected value <token> (from "<then>")`.

## 7. Run marker — `core/checks/cli.mjs run start|stop|status`

- `run start --key KEY` writes `.claude/quality-code/run.active` with `{ key, startedAt, base }`
  (`base` = `git rev-parse HEAD`), refuses when one is active (`a run for <key> is active: finish it or
  run 'run stop'`). `run stop` deletes it (idempotent). `status` prints it.
- The marker is git-ignored already (part 2). A marker older than 12 hours is ignored by the hook and
  removed by `run start`.

## 8. `/quality-code:write <KEY> [--layer NAME] [--target PATH]`

Rules: plain English; the script grades; never edit application code; never weaken or delete a test
to make a check pass; end the turn after each card; tokens and keys never in chat.

1. **Check.** `config check`; adapter must be `vitest` (else "the Playwright pipeline comes with part
   3"). Connectors as `start` does (Jira required).
2. **Ticket and gate.** The `ticket-eval` steps 1–5 (read, save, sanitize, score). Refused: its refuse
   card and flow, then stop. Passed: go on with `<ticketsDir>/<KEY>/ticket.json`.
3. **Target.** From the ticket, the branch diff (`branch.mjs --detect`, kind `source`) and a search of
   the code, propose the source file the behaviour lives in. Card: `Which code does this ticket change?
   1. <path> 2. <path> 3. Another file 4. Stop` (paths are allowed here: a developer is the reader).
   One clear candidate still gets the card.
4. **Plan.** Read the generic guide and the layer guides. Card: the scenarios from the ticket, one line
   each, with the layer each goes in, and `1. Write these tests 2. Change the layers 3. Stop`.
5. **Write.** `run start --key KEY`. Write the specs in the layer folders: one file per layer,
   `<target basename>.<key lowercased>.spec.ts` (or `.js` when the project has no tsconfig), all tests
   inside one `describe('<KEY> <summary>', …)` block, one `it` per scenario, real expected values from
   the ticket. Import the target directly; mock only the boundary the guide says to mock.
6. **Check.** One line ("Running the checks …"), then the pipeline CLI with every spec, `--key`,
   `--ticket @…/ticket.json`, `--target`. Fixable verdicts (`expected`, `assertions`, `mutation`,
   `stryker`, `types` in a spec) → rewrite the tests only, re-run; at most 2 rewrites. `boundary`,
   `honesty` → undo that change once. Then `run stop` (also on every stop or error path).
7. **Card.** Show the last card verbatim, without the machine line. For a **Bug**, a red test that
   asserts the ticket's expected value is the expected result: add `This is the bug the ticket
   describes; it should go green when the fix is merged.`

`start` option 3 becomes `Write and check tests` and follows `write.md` with the confirmed key.

## 9. Sample service — `examples/sample-service/`

A DB-less TypeScript service (an order-pricing module: line totals, discounts, VAT rounding) with
`package.json` (devDependencies pinned: `vitest`, `typescript`, `@stryker-mutator/core`,
`@stryker-mutator/vitest-runner`), `tsconfig.json`, `vitest.config.ts`, `.claude/quality-code.json`
(adapter vitest, projects `DEMO`, layers unit), two sample tickets under `tickets/` (a story and a
bug, already sanitized), and specs written by the flow for them. It is the plugin's end-to-end proof:

- `test/e2e/sample.test.mjs` runs only when `QC_E2E=1`: `npm ci` is the caller's job; it runs the
  pipeline CLI on the sample specs and expects `green` for the story and `tests_red` for the bug (the
  bug is real in the sample code); then on a deliberately hollow copy and expects `checks_failed`.
- CI gets a job that runs `npm ci` in the sample and `QC_E2E=1 npm test` in the plugin.
- The sample never ships with the plugin's runtime (`core/` does not import it).

## 10. Errors

| Situation | Result |
|---|---|
| Refused ticket | the refuse flow; no run marker, no file written |
| A run is already active | `write` says so and offers `1. Stop the other run and start this one 2. Stop` |
| Stryker missing | not applicable, never blocking |
| Target file deleted while writing | pipeline exit 2 (`--target` must exist) |
| Claude hits the boundary hook | the write is denied with the reason; Claude writes in a layer folder instead |

## 11. Testing

- `expected`: tokens (numbers in both decimal styles, negatives, quoted strings), grounding (an invented
  token in the spec is not required; a ticket value missing in the spec fails), block scoping (a value
  only outside the key block fails), no tokens, no block, missing ticket. CLI wiring.
- Stryker runner: fake binary (as in 4a) writing a Stryker-shaped report: score, below the bar, missing
  binary, no target, timeout, report missing.
- Pipeline: the two new steps in order, applicability, verdicts.
- `run start|stop|status`: write, refuse when active, stale marker, idempotent stop.
- Config: `layers`, `stryker`, layer inside a forbidden folder.
- Commands: `write.md` and the `start.md` change pinned by string tests.
- Setup: `detect().specFolders` and the Test folders card.
- e2e on the sample service (opt-in, CI job).

## 12. Release

quality-code **0.6.0**: CHANGELOG (Added: `/quality-code:write`, `expected` check, Stryker step,
`vitest.layers` and `vitest.stryker`, the Test folders card, `run start|stop`, the sample service),
README (writing tests, the config fields), Getting started (writing tests for a ticket).

## 13. Acceptance criteria

1. `/quality-code:write` on a passed ticket writes specs only in the layer folders and shows the card.
2. A spec that does not assert the ticket's expected value fails `expected`.
3. The sample service gives `green` for its story, `tests_red` for its bug, `checks_failed` for a
   hollow spec, with a real Vitest.
4. No project values in `core/`; all tests and validations pass.
