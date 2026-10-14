# Changelog

What changed in each version of the `quality-code` plugin, newest first, and what you have to do
when you update. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
plugin uses [semantic versioning](https://semver.org/) (before 1.0, a minor version can break
things, and says so here).

Update with `/plugin update quality-code@quality-code`.

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
