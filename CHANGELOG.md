# Changelog

What changed in each version of the `quality-code` plugin, newest first, and what you have to do
when you update. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
plugin uses [semantic versioning](https://semver.org/) (before 1.0, a minor version can break
things, and says so here).

Update with `/plugin update quality-code@quality-code`.

## [Unreleased]

### Added

- **XRay test cases for QA.** With an `xray` block in the config (Playwright and fullstack), `write`
  adds one XRay test case per Playwright test it writes, and `/quality-code:xray <KEY>` writes the
  cases alone, with no test. `core/xray.mjs` appends them to one CSV (`xray.csv`), numbered per
  ticket and never twice, and writes each ticket's `case.csv`, plus a styled `case.xlsx` when the
  project has `exceljs`, for import into Xray. `xray.headers` matches your import mapping's column
  names. The same rows the old in-repo harness wrote: its CSV is read as it is.
- `check --evals`: a fixture with `requirement` also checks that each of its tests has an XRay case
  linked to that ticket (with an `xray` block).

### Upgrading

- Nothing to do. To get XRay test cases, add an `xray` block (README, "XRay test cases").

## [0.12.0] - 2026-10-16

### Added

- **Fullstack projects: one plugin for frontend and backend.** `"adapter": "fullstack"` runs Vitest
  and Playwright in one repo: the e2e folder's specs under Playwright, every other spec under Vitest,
  in one check run with one verdict (the card names both runners; the expected-values check reads both
  sides together). A ticket is frontend, backend or fullstack from its title prefix or labels
  (`[FE]`, `[BE]`, `[FS]` by default, `sides` in the config), scored with its side's rubric (a
  fullstack or unmarked ticket with both; the lower decides) and written with its side's tests.
  ticket-eval asks the side of an unmarked ticket once; `cli.mjs side` saves it with the ticket.
  `/quality-code:setup` offers fullstack when a repo has both runners.
- `/quality-code:ticket`: find tickets by key, number, words or filters (`assignee:me`, `status:`,
  `label:`, `epic:`), show one in short, and suggest what its author could add. Read-only on Jira.
- **Frozen evals**: `/quality-code:check --evals` (`core/evals.mjs`) checks chosen tickets' committed
  specs against `.claude/quality-code/evals/<KEY>/expected.json` (and a frozen ticket in
  `input.json`). Reads the old backend and frontend fixtures as they are.
- **Quality Program numbers on `/quality-code:kpi`**: traceability, completeness, suite honesty,
  gate integrity, adoption, coverage and the mean mutation kill rate, each against its target.
- The card lists each test (the ticket's, then the extras) with a red one's reason; a red run on a
  ticket Jira calls finished says the bug is still there; with a key, a developer log is written to
  `<ticketsDir>/<KEY>/run.md` and linked from the card.
- `branch.mjs --merged <KEY>`: a merged ticket's change, from its merge commit (or the commits that
  name it), used by `write` when the branch shows no change.
- `write`: each planned scenario says what it checks; `--ask` offers "No, I'll type the right result"
  (added to the ticket, never only to a test); `--dry-run` and `--ci`; a closing card with "That's not
  what I see in the app", which never weakens a test. Every command reads `sì`, `ok`, `va bene`,
  `stop`, `basta`, and answers in the user's (or the ticket's) language.
- `--expected @file` on the pipeline: the values the writer says its tests pin, grounded in the
  ticket; `write` saves them in `<ticketsDir>/<KEY>/expected.json` and `/check` reuses them.
- `seed.guide` (the team's seeding rules) and `qaPlans` (a folder of `<feature label>.md` QA plans
  `write` reads as extra rules) in the config.
- `/quality-code:setup` finds a Playwright config up to two folders down; the e2e folder comes from a
  configured config's `testDir`.
- `cli.mjs risk-comment --in @ticket.json`, and `jira-posted <KEY> risk`.

### Changed

- **The expected-values check is closer to the old backend one.** A negated matcher or a
  commented-out `expect` asserts nothing; a field the Then names (`unit_cost`) must be read in a
  Vitest assertion; a bug test that asserts the reported wrong result is named as such;
  `toBeCloseTo`, the comparisons and `toHaveLength` pin values too.
- **The ticket key scopes a check.** Another ticket's test in the same file no longer decides the
  verdict, a namesake in another block never kills a mutant, and the flaky check keeps same-named
  tests in different groups apart and names a flaky test's first failure.
- `/quality-code:check` passes the ticket, the pinned values and the target `write` saved, so the
  expected-values and Stryker steps run there too.
- The audit log keeps each step's numbers (mutation, Stryker, honesty, expected values) and the
  run's flags, so the Quality Program numbers can be rebuilt.
- `gitlab_api_url` defaults to `https://gitlab.com/api/v4`, not one team's GitLab.
- Rollout configs: the frontend's features use the app's routes and carry their QA-plan search
  words, its Playwright and seed guides are set; the backend's layers read the old layers guide, with
  the seed builders, a `test/repro/` layer, the QA-plan folder and a reason on every boundary. The
  switch guide moves the old guides into `.claude/quality-code/guides/`.

- **Every way past a refused ticket now leaves a trace on Jira**, each after a preview and a yes.
  Option 2: when the filled-in ticket passes, the preview of what goes to Jira comes straight away
  (no more "also add what you typed?" card). Option 3: once the tests are written, `write` shows a
  risk note (the score against the bar, the 🔴 mark, what is still missing) and posts it on a yes; a
  re-run updates the same note. `/quality-code:kpi` counts risk notes on its Jira line.

### Fixed

- **The plugin's Bug template can pass the gate.** It had no Acceptance criteria section, so a Bug
  filled in completely scored 55 (Vitest) or 40 (Playwright) and was always refused. It now has one,
  with a Gherkin and a plain-language example.
- **A red Bug test ends as 🔴 tests red, not ⚠️ not verified.** `write` passes `--target`, so
  Stryker ran on the red spec, could not start (its first run must be all green) and decided the
  verdict. Stryker is now "not applicable" when the tests are red. The DEMO-2 end-to-end test passes
  `--target` too, so it catches this.
- **The switch guide keeps the old scripts CI runs.** It deleted all of `.claude/harness/`, which
  breaks the `test-quality` and `e2e-anchors` jobs in both warehouse repos. `honesty-check.mjs`,
  `suite-honesty.mjs` and `anchor-report.mjs` now stay.
- **On Playwright, only red tests get `@anchor` / `@finding`.** `write` tagged every test, and a
  merge gate that skips those tags (the warehouse frontend's `e2e-frontend`) then never ran any of
  them. Tests are now written untagged; after the last run, only the red ones get their tag.
- **The type check grades the specs, and only the specs.** It ran `tsc` on the whole project, so one
  error anywhere failed every run, and a spec the tsconfig's `include` leaves out was never checked
  (both warehouse repos leave their specs out). `tsc` now runs on the project's tsconfig plus the
  specs; only an error in a spec fails, and a tsconfig `tsc` cannot read is "not verified". The
  rollout configs set `vitest.tsconfig: tsconfig.db.json` (backend) and `playwright.tsconfig:
  e2e/tsconfig.json` (frontend).
- **Playwright finds browsers installed into `node_modules`.** A project whose npm script sets
  `PLAYWRIGHT_BROWSERS_PATH=0` keeps its browsers there, and every test failed with "Executable
  doesn't exist". The runner now sets it when `node_modules/playwright-core/.local-browsers` exists.
  The frontend rollout config gets its `playwright` block: `e2e/playwright.config.ts`, specs in
  `e2e/tests/`, project `chromium`.
- **A test run may edit `.env.example`.** The `.env.*` rule (the default, and in both rollout configs)
  also matched `.env.example`, while its own message said to edit `.env.example`. A pattern with `*`
  now never forbids `.env.example`, `.env.sample` or `.env.template`; a rule that names one exactly
  still does.

## [0.11.0] - 2026-10-15

### Changed

- **`/quality-code:write` runs straight through.** It finds the target from your branch's diff and
  the ticket and says `Target: <path>` instead of asking; it asks only when no changed file matches
  the ticket or two match equally well. The plan is shown as information and writing goes on. A
  target chosen once is remembered for the ticket. `--ask` brings back both cards.
- **Steps already settled are not asked again.** `start` uses the ticket key from the branch name
  without a card, and when every connector is ✅, `start`, `write` and `seed` show one line instead
  of the connectors card. An optional connector that is not ✅ is noted on that line and never stops
  them; fix it with `/quality-code:setup`, which still shows the card.

## [0.10.1] - 2026-10-15

### Fixed

- **"Continue anyway" (refuse option 3) now continues.** From `/quality-code:ticket-eval` or
  `/quality-code:start`, picking it goes straight on to writing the tests for that ticket, marked
  🔴 [RISK / NOT RECOMMENDED] with the ticket's score, without running the gate again. Before, it
  only printed the warning and stopped. It still needs something to check in the ticket, and `--ci`
  never takes it.

## [0.10.0] - 2026-10-15

### Changed

- **The connectors card asks in the chat, and saves for you, everything that is not secret:** your
  Jira email, your GitLab address (checked to be a GitLab) and your GitLab username or email. Only
  tokens still go through `/plugin`, where they are hidden and kept in the keychain. A token pasted
  in the chat is never used or saved; the card asks you to revoke it.
- **Each connector line shows who is signed in:** `Jira <email> on <site>`, `GitLab <username> on
  <host>`, and the Figma account. Jira and GitLab warn when the account is not the one you set, and
  Jira warns when the account cannot see the project's site.

### Added

- `jira_email` in the plugin settings; `gitlab_username` also accepts an email.
- `core/connector-settings.mjs`, which saves those values where Claude Code keeps plugin options.

### Upgrade

After `/plugin update`, run `/quality-code:start` or `/quality-code:setup` and pick "Fix one first"
for any connector that is not ✅: the card asks what it needs.

## [0.9.0] - 2026-10-15

### Changed

- **GitLab browser sign-in works like Jira:** `/mcp`, choose `gitlab`, sign in. The `gitlab`
  connector is now GitLab's own MCP server at `<gitlab_api_url>/mcp`, which registers itself when
  you sign in: no application to create, no ID to set. Your GitLab admin must have its MCP server
  switched on (GitLab 19.5 or later, any tier); until then, use the token way.
- The connectors card shows who is signed in to GitLab (`<username> on <host>`) and warns when the
  account is not the `gitlab_username` you set.

### Added

- `gitlab_username` in the plugin settings, for both GitLab ways.

### Removed

- `gitlab_oauth_client_id`: browser sign-in no longer needs a GitLab application.

### Upgrade

After `/plugin update`, set `gitlab_username` from the `/plugin` menu (quality-code, configure), then
`/mcp`. If you signed in with the old `gitlab` connector, sign in again: it is a new connector.

## [0.8.1] - 2026-10-15

### Fixed

- **The Stryker step works on real projects.** Before, Stryker's first test run failed in every
  project, so the step was always "not run" and the verdict "not verified". Stryker now runs only the
  specs being checked (a red bug spec elsewhere no longer stops it), and its sandbox lives inside the
  project, where Vitest can find the tests. The sandbox is a `.stryker-tmp-qc-…` folder created for
  the run and always removed, also after a timeout or a crash.

## [0.8.0] - 2026-10-14

### Added

- **`/quality-code:write` for Playwright projects** (and `/quality-code:start` option 3). From a
  ticket that passes the gate it writes one e2e spec for the screen the ticket changes, then runs the
  same pipeline as `/quality-code:check`. The screen comes from `--route`, else from the configured
  feature whose label is on the ticket, else a card. Tests from the ticket carry `@anchor` and the
  key; up to 3 extra probes (`Extra: …`, `@finding`) try cases the ticket did not state;
  `--no-extras` leaves them out. Guide: `core/guides/playwright-writing.md`.
- `playwright.folder` (where new specs go; default: your config's `testDir` when it is a plain
  string, else `e2e/`) and `playwright.guide`; `core/cli.mjs config e2e-folder` shows the folder.
- **`/quality-code:seed <KEY> [--path <spec>]`**: only the test data a ticket needs, as calls to your
  own seed builders (Vitest) or route stubs copied from your existing stubs (Playwright). It never
  invents a builder, a shape or a value and never writes to a database. Optional `seed` block
  (`builders`, `dataset`, `stubsFrom`); guide `core/guides/seed-data.md`.
- **`/quality-code:kpi`**: tickets gated, refused then filled in then passed, Jira comments posted,
  forced runs, pipeline verdicts and deciding steps, boundary blocks.
- **A local audit log**, `.claude/quality-code/audit/<kind>.jsonl` (gate, pipeline, jira, override):
  keys and numbers only, git-ignored (setup adds the line and the folder ignores itself).
  `--no-audit` or `QC_NO_AUDIT=1` turns it off.
- `core/pipeline/cli.mjs --incomplete-ticket <score>` (0–69): the card opens with
  `🔴 [RISK / NOT RECOMMENDED] Ticket incomplete (<score>/70)`; the verdict is unchanged.

### Changed

- **Refuse option 3 ("continue anyway") leads to writing again**, for developers, with every result
  card marked as above and the override recorded (as the warehouse plugins did).
- `ticket-eval` records a posted Jira comment or fill-in push with `cli.mjs jira-posted`.

### Upgrade

Update the plugin before adding `playwright.folder`, `playwright.guide` or a `seed` block: 0.7.x
refuses them. Re-run `/quality-code:setup` once (or add `.claude/quality-code/audit/` to
`.gitignore`); the audit folder also ignores itself.

## [0.7.0] - 2026-10-14

### Added

- **Playwright projects in `/quality-code:check`** (and `/quality-code:start` option 2). The same
  pipeline, card, verdicts and exit codes as Vitest: boundary, honesty, assertions, types, tests,
  expected, mutation, flaky. No Stryker step for end-to-end tests; `--target` is refused.
- The Playwright runner uses the project's own `node_modules/.bin/playwright test` with the JSON
  report, retries off, and its output in a temp folder, so nothing lands in the repo. A test run in
  several browser projects is one result. When every failing test hit a refused connection, the
  verdict is `not verified` ("the app is not reachable"), never red.
- **The `playwright` block** in `.claude/quality-code.json`: `configs`, `projects`, `tsconfig`,
  `timeoutSeconds` (default 600).
- The `expected` check also reads Playwright's web-first matchers (`toHaveText`, `toHaveURL`,
  `toHaveCount`, …) in Playwright specs.

### Changed

- `/quality-code:write` says plainly that writing Playwright tests is not available yet (part 3b).
- `core/pipeline/vitest.mjs` is now `core/pipeline/pipeline.mjs`.

### Upgrade

Update the plugin before adding a `playwright` block: 0.6.x refuses it.

## [0.6.0] - 2026-10-14

### Added

- **`/quality-code:write <KEY> [--layer NAME] [--target PATH]`** writes Vitest tests from a ticket.
  The readiness gate runs first: a refused ticket never gets a test. Then it asks which code the
  ticket changes and which scenarios go in which test folder, writes the specs only in the test
  folders (one `describe('<KEY> …')` block, one `it` per scenario, the ticket's real values), runs the
  pipeline and shows the card. It rewrites the tests at most twice, never the application code. For
  a Bug, a red test that asserts the ticket's expected value is the expected result.
  `/quality-code:start` option 3 is now "Write and check tests".
- **The `expected` check**: the numbers and quoted texts in the ticket's Then / Expected lines and
  criteria must appear in an assertion inside the ticket's block. `1.234,5`, `1,234.5` and `1234.50`
  are the same number. Values the ticket does not state are never required.
- **Stryker in the pipeline**, after mutation, when you give `--target <file>` and the project has
  `node_modules/.bin/stryker`: the share of code changes the tests catch must reach
  `vitest.stryker.threshold` (default 60). Without Stryker or a target it is "not applicable", never
  blocking.
- **Pipeline options** `--ticket @file` (turns on `expected`) and `--target <path>`.
- **`vitest.layers`** (the test folders a writing run may use; default `unit` in `test/`) and
  **`vitest.stryker.threshold`** in `.claude/quality-code.json`, and a **Test folders** card in
  `/quality-code:setup advanced` that proposes them from the folders that already hold specs.
- **`core/checks/cli.mjs run start --key KEY | run stop | run status`**: the marker that turns the
  boundary hook on while tests are written.
- **`/quality-code:consumption`**: AI usage and estimated cost of the plugin's runs in this project,
  from Claude Code's local transcripts (read-only, local, no prompt text). Groups by command, ticket,
  day or model; API list prices dated on the card, `--prices` for your own.
- **`examples/sample-service`**: a small pricing service with a story and a bug ticket that proves
  the pipeline end to end with a real Vitest and Stryker (green, tests red, checks failed), run in CI.

### Changed

- A run marker is stale after **12 hours** (was 6), read from its start time.
- `ticket-eval` refuse option 3 ("continue anyway") no longer leads to test writing: a refused
  ticket stops there.

### Upgrade

Update the plugin before re-running setup: 0.5.x refuses a config with `vitest.layers` or
`vitest.stryker`. Nothing else to do; existing configs keep working.

## [0.5.0] - 2026-10-14

### Added

- **`/quality-code:check`** runs and grades Vitest spec files in any Node/TypeScript project and
  prints one plain card. Give it spec paths, or none to take the test files your branch changed
  (deleted ones are left out). `--key` names the ticket, `--flaky N` also runs the tests N times.
- **The Vitest pipeline** (`core/pipeline/cli.mjs`), always in this order: boundary, honesty,
  assertions (suite-honesty), types (`tsc --noEmit`), tests, mutation, and flaky when asked. The
  verdict is one of `green`, `checks failed`, `not verified` and `tests red`; a script decides it,
  never the model. Anything that could not run makes the verdict `not verified`, never green. That
  includes a spec whose assertions mutation cannot check (snapshot-only, chai-style or custom
  matchers). A spec with failing tests and no passing one skips mutation, so a bug reproduction
  gives `tests red`. Exit codes: `0` green, `1` checks failed or tests red, `2` usage or config error
  (or a crash), `3` not verified.
- **Option 2 in `/quality-code:start`**, "Check the tests on this branch", offered for Vitest
  projects when the branch has a test file that is not deleted. The branch run reads everything
  committed on the branch for removed assertions and tests.
- **The `vitest` block** in `.claude/quality-code.json`: `configs` (which Vitest config runs which
  specs), `tsconfig` and `timeoutSeconds` (10 to 3600, default 300), and a card in
  `/quality-code:setup advanced` that asks about it when the repo has several `vitest.config.*` files.
- Vitest runs the project's own `node_modules/.bin/vitest`, with the per-test JSON report and
  retries off. The plugin still has no dependencies.

### Changed

- The boundary check inside the pipeline applies only while a test-writing run is active. With
  `/quality-code:check` on your own work it reports "not applicable", so your own code changes never
  fail it.

### Upgrade

Update the plugin before re-running setup: 0.4.x refuses a config with a `vitest` block.

### Good to know

- The checks write nothing into your repo, with two exceptions: Vitest's own cache in
  `node_modules/.vite`, and the mutation check's temporary spec copies next to the spec, which it
  deletes when it ends.
- Playwright projects get the same command with part 3; today it says so and stops.

## [0.4.0] - 2026-10-14

### Added

- Five deterministic checks for generated tests, one version for Vitest and Playwright, driven by
  the config: `boundary` (no writes to application code, environment or CI files during a test
  run), `honesty` (no removed assertion or test, no skip without a ticket), `suite-honesty` (every
  test that runs asserts something), `flaky` and `assertion-mutation` (every generated assertion can
  fail; any survivor fails the check). Run by hand with `core/checks/cli.mjs`; the test-writing
  pipeline uses them from part 4.
- `boundaries` in `.claude/quality-code.json`, and a card in `/quality-code:setup advanced` that
  proposes them from your repo (the short setup uses the defaults).
- A boundary hook that only acts while a test-writing run is active; outside a run Claude edits your
  code as usual.

### Upgrade

Update the plugin before re-running setup: a config with `boundaries` is refused by 0.3.x or older. Re-run
`/quality-code:setup advanced` to get the boundaries card and the new `.gitignore` lines; without
it the checks use the defaults.

### Good to know

- A spec with no test in it is `not run`, not a pass.
- A file renamed out of a forbidden folder is caught (the old path is named).
- A new, untracked spec is read by `honesty` like any other.

## [0.3.3] - 2026-10-14

### Changed

- Setup only configures: it no longer checks a ticket at the end. Checking tickets is what
  `/quality-code:start` and `/quality-code:ticket-eval` do; the first ticket checked there also finds
  the project's acceptance-criteria field.

## [0.3.2] - 2026-10-14

### Changed

- **Setup is short.** It asks only for the connectors, where the project lives (folder, stack, GitLab
  project from the `origin` remote) and the Jira project. Everything else has a default.
- **The acceptance-criteria field is found when a ticket is checked**, by its name, the first time a
  ticket of that project is checked by `/quality-code:start` or `/quality-code:ticket-eval`. It is
  remembered on your machine in `.claude/quality-code/jira-fields.json` (git-ignored). A field named
  in the config still wins.
- In the config, `languages` (default English and Italian), `features` (default none) and
  `jira.acceptanceCriteriaField` are now optional.

### Added

- `/quality-code:setup advanced`: the questions the short setup leaves out (projects to track,
  feature labels, routes, QA plans, Confluence spaces, title prefixes, languages, redaction,
  templates).

### Upgrade

Nothing to do: existing configs keep working as they are.

## [0.3.1] - 2026-10-14

### Added

- GitLab and Figma can each be reached in two ways: **sign in in the browser** (connectors `gitlab`
  and `figma`) or **a token** (`gitlab-token` with a `read_api` personal access token,
  `figma-token` with a Figma access token). One way is enough. The connectors card in `setup` and
  `start` checks both and shows the steps for each.
- Figma browser sign-in uses Figma's own connector (`https://mcp.figma.com/mcp`).

### Changed

- GitLab now runs through a pinned, read-only connector (`@zereight/mcp-gitlab` 2.2.5) against your
  GitLab's normal API. The old `gitlab_mcp_url` setting is gone: TeamSystem's GitLab has no MCP
  endpoint, so it never connected. New settings: `gitlab_api_url` (default TeamSystem's GitLab),
  `gitlab_oauth_client_id` (browser sign-in) and `gitlab_token` (secret).
- The Figma token connector is pinned (`figma-developer-mcp` 0.13.2).

### Removed

- The marketplace no longer carries the `warehouse-frontend` and `warehouse-backend` plugins:
  `quality-code` is the one plugin for every team. Teams that used them install `quality-code`
  instead.

### Upgrade

- After `/plugin update`, set either `gitlab_oauth_client_id` or `gitlab_token` from the `/plugin`
  menu (quality-code, configure) if you want GitLab, then `/mcp`. For Figma, sign in with `/mcp`, or
  keep using your `figma_api_key` (now the `figma-token` connector).

## [0.3.0] - 2026-10-14

**Breaking: the plugin is renamed from `agentic-testing` to `quality-code`.** The old names are no
longer read.

### Changed

- Plugin and marketplace: `agentic-testing` → `quality-code`. Install with
  `/plugin install quality-code@quality-code`.
- Commands: `/agentic-testing:setup`, `:start`, `:ticket-eval` → `/quality-code:setup`, `:start`,
  `:ticket-eval`.
- Team config: `.claude/agentic-testing.json` → `.claude/quality-code.json`.
- Local ticket copies: `.claude/agentic-testing/tickets` → `.claude/quality-code/tickets`.
- JSON schema: `schema/agentic-testing.schema.json` → `schema/quality-code.schema.json`.
- The line added above a fill-in pushed to Jira now reads
  `_Added during the quality-code readiness check._` (teams that set `messages.jiraFillMark` keep
  their own text).

### Not changed

- The marketplace address is still `vissz28/agentic-testing`.
- Scores, the 70-point bar, the rubrics and every other behaviour are the same as in 0.2.1.

### Upgrade

Once per person:

```
/plugin uninstall agentic-testing@agentic-testing
/plugin marketplace remove agentic-testing
/plugin marketplace add vissz28/agentic-testing
/plugin install quality-code@quality-code
```

Then, in each repo that was set up:

1. Run `/quality-code:setup`. It writes `.claude/quality-code.json`; commit it.
2. Delete `.claude/agentic-testing.json`, the `.claude/agentic-testing/` folder and its
   `.gitignore` line.
3. In the repo's `.claude/settings.json`, rename the `agentic-testing` marketplace key and the
   `enabledPlugins` entry to `quality-code` (the README's Install section shows the new block).

## [0.2.1] - 2026-10-14

### Added

- `/agentic-testing:start`, the daily command: checks the connectors, shows the repo card (branch,
  base branch, files changed, committed and not), takes the ticket key from the branch name (or the
  merge request title, or the commit subjects), and evaluates that ticket. The changes never affect
  the score. Running the full pipeline from it comes with the Vitest adapter.
- Connectors check, the first step of both `start` and `setup`: Jira (required), GitLab and Figma
  (optional, never blocking; Figma only for Playwright repos), with the fix for each. Keys are set
  in the plugin settings, never typed in the chat.
- `core/branch.mjs`: reads local git only (no network, no writes), redacts paths and commit
  subjects, strips credentials from the remote URL, and works in a project inside a subfolder of a
  larger repo. Base branch: the open merge request's target, else `origin/HEAD`, else `develop`,
  `main` or `master`.

### Documentation

- README rewritten for every team: quick start, supported projects, capabilities, roles. The
  warehouse-only pages moved out of the README.

## [0.2.0] - 2026-10-12

First release of the reusable plugin (then called `agentic-testing`), for any Jira project and any
repo with Playwright or Vitest.

### Added

- `/agentic-testing:setup`: detects the stack, asks about Jira (site, projects, criteria field,
  feature labels, title prefixes, Confluence spaces, languages, redaction, templates) one numbered
  card at a time, writes `.claude/agentic-testing.json` only after you confirm, and proves the setup
  on one recent ticket.
- `/agentic-testing:ticket-eval <KEY>`: the readiness gate. A script scores the ticket out of 100;
  70 passes, for every team. Acceptance criteria count as Gherkin or as at least 150 characters of
  plain language; vague results ("works correctly") lose points.
- On a refused ticket: a Jira comment listing what to add (preview first), a guided fill-in where
  the script decides whether each answer counts, and an optional push of the filled-in parts to
  Jira (append only, preview first). `--ci` comments and fails without asking.
- Redaction of customer ids, e-mails, UUIDs and your own patterns before anything is scored.
- English and Italian ticket keywords.
- A parity suite proving the same results as the original warehouse scripts on 116 real tickets.
