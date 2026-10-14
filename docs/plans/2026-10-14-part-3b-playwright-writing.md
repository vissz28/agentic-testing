# Part 3b implementation plan: writing Playwright tests from a ticket

Spec: [part 3b](../specs/2026-10-14-part-3b-playwright-writing-design.md) · Jira: AGT-93 (commits
carry AGT-44) · Branch: `agt-93-playwright-writing` from main after 0.7.0 · Release 0.8.0. Plugin
root: `plugins/quality-code/` (paths below are relative to it unless they start with `docs/`).

## Global constraints

- No npm dependencies in the plugin; imports are `node:*` or relative.
- Style: 2-space indent, single quotes, no semicolons. Zero-dependency Node ≥ 18.
- No `AGT`, `FIC`, `warehouse`, `teamsystem`, `Giacenza`, `Magazzino` or other project values under
  `core/` (CI greps for them; `core/guides` included).
- `not_run` is never a pass. Scripts decide; commands relay.
- Do not touch `README.md`, `docs/GETTING_STARTED.md`, `CHANGELOG.md`, versions, `examples/`,
  `.github/` or `test/parity/` (other work in flight); proposed README and CHANGELOG text goes in the
  hand-off report.
- Commits: conventional subject ending `(AGT-44)`, blank line, the `Co-Authored-By` and
  `Claude-Session` trailer lines.
- TDD for every task; `npm test` green before each commit, except the two known container failures
  ("add on a read-only ticket file" under root; "timeout kills the whole process group,
  grandchildren included" without zombie reaping).

## Task W1: `playwright.folder` and `playwright.guide`, and the e2e folder script

Files: `core/config.mjs`, `schema/quality-code.schema.json`, `test/config.test.mjs`; create
`core/e2e-folder.mjs`, `test/e2e-folder.test.mjs`; `core/cli.mjs` and `test/cli.test.mjs`.

- Config: allowed keys of `playwright` become `configs`, `projects`, `tsconfig`, `timeoutSeconds`,
  `folder`, `guide`. Extract the `vitest.layers[].folder` rule (path, ends with `/`, not inside a
  forbidden rule unless allowed) into one helper used by both blocks. `guide` as a layer's guide.
  Schema: the two properties with the shared path pattern.
- `e2eFolder(root, config)` per spec §4; export `readTestDir(root)` → `{ value, file } | null` for
  tests. Forbidden check through `rulesFor` / `violation` of `core/checks/boundary.mjs` on the
  folder path.
- `cli.mjs config e2e-folder`: one line (`<folder> (from playwright.folder | from testDir in <file> |
  default)`), then `E2E_FOLDER_JSON:{…}`; exit 0, or the error on stderr and exit 2.
- Tests per spec §10.

Commit: `feat(config): the e2e folder for writing Playwright specs (AGT-44)`.

## Task W2: the Playwright writing guide

Files: create `core/guides/playwright-writing.md`; create `test/playwright-guide.test.mjs` (or
extend `test/write-command.test.mjs`). Content per spec §6–7: shape and tags, locators, web-first
assertions with the ticket's values, waiting, isolated state, network stubs, extra probes, never.
An example spec with a neutral key (`ABC-123`).

## Task W3: `/quality-code:write` for Playwright, `start` option 3 for both adapters

Files: `commands/write.md`, `commands/start.md`, `test/write-command.test.mjs`,
`test/start-command.test.mjs`.

- `write.md`: argument hint gains `[--route PATH] [--no-extras]`; the description names both
  frameworks; each of the seven steps keeps its Vitest text and adds a **Playwright** part per spec
  §5; the "not available yet" line goes; the flag cross-check; the screen card; the plan card with
  the Extra section; the file naming and tags; the pipeline call without `--target`; the extra and
  app lines at the card.
- `start.md`: option 3 for both adapters; the card variants follow (no Playwright special case).
- String tests: every new card and rule pinned; the Vitest pins kept.

Commit (W2 and W3 together): `feat(commands): /quality-code:write writes Playwright tests (AGT-44)`.

## Task W4: pipeline

Nothing to build (spec §8). Before closing, run the pipeline CLI tests and the Playwright dialect
tests to confirm a spec in the guide's shape (describe with a tag object, tagged tests, `Extra:`
titles, `test.fixme`) passes honesty, suite honesty and the expected surface: add pinning tests to
`test/checks/honesty.test.mjs` / `test/checks/suite-honesty.test.mjs` / `test/checks/expected.test.mjs`
if a shape is not covered yet.

Commit: `test(checks): the Playwright writing shape passes the checks (AGT-44)`.

## Task W5: docs

Spec §14 rulings, updated while building. Spec and plan committed first:
`docs: part 3b spec and plan, writing Playwright tests (AGT-44)`. CHANGELOG, README, Getting started
and the version bump at release (spec §11), outside this branch.
