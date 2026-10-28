# Changelog

What changed in each version of the `quality-code` plugin, newest first, and what you have to do
when you update. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
plugin uses [semantic versioning](https://semver.org/) (before 1.0, a minor version can break
things, and says so here).

Update with `/plugin update quality-code@teamsystem`.

## [Unreleased]

## [0.20.0] - 2026-10-28

### Added

- **The MCP server verifies callers with Microsoft Entra ID** (AGT-136). `quality-code-mcp --transport http`
  serves over streamable HTTP and accepts only a valid Entra access token: signature, issuer, tenant,
  audience, expiry and, when set, a required scope or app role. It refuses to start without the tenant,
  client ID and public address. Over HTTP the scripts run only in `QUALITY_CODE_PROJECT_DIR`. Stdio (local,
  one person) is unchanged. Setup steps are in the server's README.

## [0.19.0] - 2026-10-28

### Added

- **A Python MCP server that exposes every command as a tool** (AGT-135), in `plugins/quality-code/mcp-server/`,
  for clients that do not run the Claude Code plugin (Claude Desktop, Cursor, your own agent). One tool
  per command (`quality_code_spec`, `quality_code_ticket_eval`, …) that returns the command's
  instructions with your arguments filled in; `quality_code_run_script` runs the plugin's checked
  scripts with no shell; `quality_code_guide` and `quality-code://guides/<name>` give the guides. New
  commands appear on their own. Nothing changes for Claude Code users. See its README to run it.

## [0.18.0] - 2026-10-27

### Added

- **Follow the project's own test flow, or use Quality Code's** (AGT-134). `testFlow` in the config is
  `project` (new tests use the project's file naming, folders and the style of its nearest specs) or
  `quality-code` (the ticket key in the file name, the configured test folders). The default is
  `project` when the project already has tests, else `quality-code`. Options: a card in
  `/quality-code:setup` (and "Test flow" in its change list), item 6 of `/quality-code:config`, and
  `--flow project|quality-code` on `/quality-code:spec` for one run. `ticket.mjs config flow` says
  which flow is in force and why; `setup.mjs --detect` reports `conventions` (the naming pattern, the
  folders, tests next to the code).

### Changed

- `/quality-code:config`: Test flow is item 6, so Files and logs is item 7 and the accounts and tokens
  move down by one (8 to 14).

## [0.17.3] - 2026-10-27

### Changed

- The README's "What's new" matches 0.17 (where files go, setup order, `spec` only), and the rollout
  spec names the current commands and records the owner's decisions (AGT-80, AGT-85, AGT-86). No
  change to the plugin's behavior.

## [0.17.2] - 2026-10-27

### Changed

- The merge-request links decision is confirmed by the owner (AGT-87): the Jira dev panel is not
  fetched. No change to the plugin's behavior.

## [0.17.1] - 2026-10-27

### Changed

- The rollout spec (§8) records where each open decision stands (AGT-87): three built, the merge-request
  proposal and the pilot teams waiting for the owner. No change to the plugin's behavior.

## [0.17.0] - 2026-10-27

### Added

- **You choose where files and logs go** (AGT-133). After the first command of a project that saves
  files (ticket copies, run logs, Xray files, the audit log), a card asks once: in the project repo
  (git-ignored, as before), on this machine outside the repo, or only in this chat (nothing kept: a
  temp folder for the run, no audit log). The pick is yours, kept on your computer per project, and
  moves the files already saved. `/quality-code:config` shows it as item 6 and changes it there; the
  accounts and tokens items move down by one (7 to 13). A setup with no repo offers this machine or
  the chat.

### Changed

- `ticket.mjs config check` prints a second line, `tickets folder: <path> (files kept …)`, and the
  commands take the tickets folder from it, so a personal setup and a folder outside the repo work
  without guessing the path.

## [0.16.2] - 2026-10-26

### Added

- **The project can live in a subfolder** (AGT-108). In a repo whose app is in a folder (`web/`) while Claude Code
  starts at the top, `"root": "web"` in the config at the top
  makes every script, runner and the boundary hook work in that folder; paths in the config, in cards
  and in arguments are relative to it. Setup proposes the folder when the top has no `package.json`
  (one with a test tool first), and `setup.mjs --detect --root <folder>` picks another. During a run
  the hook still keeps the config and Claude's settings at the top off limits. A `root` outside the
  repo (`..`, absolute) fails the config check.

### Removed

- **`/quality-code:start` and `/quality-code:write` are gone: `/quality-code:spec` is the one command.**
  `/quality-code:spec` takes the ticket of your branch; `/quality-code:spec <KEY>` takes any ticket.

## [0.16.1] - 2026-10-26

### Changed

- **Setup asks "Where" first** (AGT-131). `Where will you use Quality Code?` (`1. In a repo
  (developers)` / `2. No repo, Jira only (QA, PO)`) is the first card, before any connector. Then the
  connectors one at a time; with no repo the source code card is skipped (Jira, then Figma).

## [0.16.0] - 2026-10-26

### Added

- **Backend tests for every stack** (AGT-128): the registry of backend runners (`vitest`, `pytest`,
  `junit`, `go`, `dotnet`) behind `adapter`, and `backend` on a fullstack project. Each has its own
  config block (`layers`, `timeoutSeconds`, `command`), test file names, writing guide and rubric (the
  backend one); Stryker and `tsc` stay Vitest's and show `not applicable` elsewhere, and compiled
  stacks mutate the spec in place, always restored. Setup detects each stack.
  - **Python (pytest):** runs `python -m pytest` (the project's `.venv` first) with a JUnit XML report;
    one class per ticket with the key in its docstring; `assert` statements are mutated.
  - **Java and Kotlin (JUnit 5/4):** Maven or Gradle (wrapper first), surefire and Gradle reports;
    `@DisplayName("<KEY> …")` on the class; JUnit, AssertJ, Hamcrest and kotest assertions.
  - **Go (`go test -json`):** `// <KEY> …` above the test function, one `t.Run` per scenario; testify
    and `if got != want { t.Errorf }` comparisons.
  - **C# (.NET: xUnit, NUnit, MSTest):** `dotnet test` with a TRX report; `// <KEY> …` above the
    class; xUnit, NUnit, MSTest and FluentAssertions assertions.
  - CI runs each stack for real (`e2e-python`, `e2e-java`, `e2e-go`, `e2e-dotnet`). Seeding stays
    Vitest and Playwright only.
  - With Jest or Mocha (`runners.unit`) the backend stays a JavaScript one: config refuses
    `runners.unit` beside a pytest, JUnit, Go or .NET backend, which runs its own tests.
- **A repo with no test runner gets Vitest, Playwright or both** (AGT-109). Setup no longer stops at
  "This stack is not supported yet" when a repo with a `package.json` has no runner. A backend or a
  library gets Vitest (`vitest` with your package manager, and a `vitest.config`); a frontend gets
  Playwright, as before; a frontend with its server (Express, NestJS, Fastify, Koa, Hono…) gets both
  and becomes fullstack, its Vitest config leaving `e2e/` to Playwright. The config resolves imports
  through the tsconfig's `baseUrl` or `paths` (`src/…`, `@app/…`) as `tsc` does, and NestJS needs no
  extra compiler: Vitest 5 emits the decorator metadata its injection reads. Vitest 5 needs Node 22.12
  or newer and, beside a frontend, Vite 6.4 or newer: setup says so instead of a failed install. On
  `Not now` (or such a problem) nothing is installed, but the config is still written, so the ticket
  checks work; `/quality-code:spec` and the `run-*` commands then stop before running a test and say
  how to add the runner (`ticket.mjs config check --runner`).
- **Setup adds Playwright to a frontend that has none.** On a frontend with no test runner (React,
  Vue, Angular, Svelte, Vite and the like), with Vitest unit tests only, or with Playwright but no
  config, setup no longer stops or settles for Vitest:
  one card shows what it installs (`@playwright/test` with your package manager, and Chromium), the
  files it writes and the command and address the app starts at, read from your dev script. It writes
  `playwright.config.<ts|js>` and `e2e/smoke.spec.<ts|js>`, never over a file that is there. For an
  app behind a sign-in, a setup project signs in once (`e2e/auth.setup`, from the app's own sign-in
  screen; the test user comes from `.env.e2e`, which git ignores, never from the chat) and every test
  starts signed in. Then the smoke test proves the app opens past its sign-in page
  (`setup.mjs --smoke`). Until a ticket's tests are in the e2e folder, `/quality-code:spec` runs it
  first and stops when it fails, so a setup that does not work is never reported as a bug in the app.
  A repo that already runs Vitest or Jest becomes fullstack, and `setup.mjs --unit-overlap` asks the
  team's own runner which files it runs: Vitest's and Jest's default patterns also take
  `e2e/*.spec.ts`, where they fail on Playwright's `test()`, so setup offers to keep `e2e/` out of them
  and checks again.
- **Criteria drafted from the description's screenshots** (AGT-121). The connector cannot open the
  images, so when the fill-in drafts acceptance criteria it asks you to paste up to 3 of them (or
  their paths), or `skip`. What a screen shows goes into the draft for the author to confirm, never
  personal data. Screenshots never count in the score: criteria only in a screenshot are still a
  refuse until a draft is confirmed.
- **A ticket's `.docx` analysis is read and scored, and its screenshots are fetched** (AGT-117). A new
  read-only connector, `jira-files`, downloads what the Atlassian connector cannot: set `jira_email`
  and an Atlassian API token as `jira_api_token` in `/plugin`. `ticket-eval` then adds the text of up
  to 3 attached Word files to the description (redacted, and scored like it), and the fill-in gets
  the screenshots without asking. Without the token, it asks for the `.docx` paths on your computer
  (`ticket.mjs docx <path>` reads them, with no new dependency) and for the screenshots to be pasted.
  Other files (PDF, spreadsheets, `.zip`) are not read: the flags name them.
- **`/quality-code:qa`, manual test runs for QA.** Lists the Xray test executions assigned to you,
  reads the run's tests and steps from the Xray API, an Xray export attached to the message (CSV), or
  the Jira page in the browser (Claude in Chrome), runs them in the app one at a time, and proposes
  OK, KO or Not verified. You give each verdict. A KO becomes a defect drafted in the style of your
  last one: under the story's epic, in its active sprint, assigned to its developer, and linked to the
  run and the test. Retests of open defects draft the `Retest` comment. At the end it can move the run
  and the story to their KO or Done status. Every Jira write waits for a preview and a yes, and
  `--dry-run` sends nothing. Without an Xray API key, the command lists the run statuses for you to
  set in Xray by hand. Works with the personal setup, with no repo.
- **Xray API for `/quality-code:qa`.** Set an Xray Cloud API key in `/plugin` (`xray_client_id` and
  `xray_client_secret`, kept in the keychain), and `xray_api_url` for a regional Xray. qa then reads
  the tests, steps and run statuses from Xray, adds each defect to its test run, and sets the run
  statuses after a yes. A new `xray` connector (`bin/xray-api.mjs`, started by the launcher only
  when the key is set) sends the key only to an Xray Cloud address. If the API fails, qa falls back
  to the export, then the browser.
- **`/quality-code:config`.** Shows the project config (repo or personal) and your plugin settings
  on one card, and changes one at a time. The scripts that already check setup's values do the
  writes (`setup.mjs --write`, `connector-settings.mjs`, now with `--xray-save`). The card also shows
  whether the GitLab token, Figma key, Xray API key and GitHub sign-in are set. It reads this from the
  connectors, never from the token, and gives the steps to set one in `/plugin`, which keeps it in
  the keychain; tokens are never asked for in the chat.
- **node --test, Node's own runner, with the generic checks** (AGT-119). A repo whose script runs
  `node --test` gets `"runners": { "unit": "node" }`; the tests are written with `node:test` and
  `node:assert/strict` and named `.test.js`, as Node's own run finds them. The pipeline runs Node with
  the plugin's reporter and the loading flags of the team's script (`--import tsx`, `--env-file`), reads
  each test with its describe path, and says why a file did not load. Mutation flips `assert.*` both
  ways (`strictEqual` and `notStrictEqual`) and the value the second argument pins. A test skipped by its
  options (`{ skip: true }`, also Vitest's) counts as skipped, and honesty flags it.
- **Jest, Mocha and Cypress, with the generic checks.** A repo that tests with another runner keeps
  it: setup names it in the config (`"runners": { "unit": "jest" }`, `"mocha"`, or `"runners": {
  "e2e": "cypress" }`), `/quality-code:spec` writes the tests in it, like the specs already there, and
  the pipeline runs it through the same checks, reading its specs as the syntax all these runners share
  (`describe`/`it`, `expect`, Chai, Cypress's `.should`, `xit`/`fit`). Mutation never negates a retried
  Cypress `.should` (it would pass while the screen loads): it breaks the value or asks for an
  impossible count. The card says `Jest (generic checks)`. Vitest and Playwright keep the specialized
  checks; Stryker stays Vitest's. Cypress's screenshots and videos go to a temp folder, never into the
  project, and a down app is said plainly.

### Fixed

- **A risk note only for a ticket below the bar** (AGT-129). `ticket.mjs risk-comment` on a ticket
  that passes wrote "it has 100 of the 70 points it needs"; it now exits 2 with a plain line and no note.
- **Dependency files are off limits in a test run** (AGT-129). `package.json`, the lock files,
  `pyproject.toml`, `requirements*.txt`, `pom.xml`, the Gradle builds, `go.mod`/`go.sum` and the .NET
  project files join the default boundary, each kind with its own reason (dependencies, secrets and
  environment, CI) instead of "application code". `boundaries.forbidden` still replaces the defaults.
- **A link's UUIDs keep the ticket's numbering.** `sanitize` numbered the UUIDs in linked issues and
  web links on their own, so a placeholder in a link could stand for a different UUID than the same
  placeholder in the description. Links now share the ticket's numbering: one UUID gets one
  placeholder everywhere, and two different ones never share one.
- **Fill-in gains for a brief read from a file.** A brief passed as JSON (`fill-menu --in @…`) lost
  the keys its ticket can never earn (a Story's Bug keys among them), so each item's `→ N points` was
  scored over the whole rubric and came out too low. The menu now works those keys out again.

### Changed

- **Setup asks for the connectors one at a time.** First the source code connector (`1. GitLab /
  2. GitHub / 3. Both / 4. None for now`, the repo's own host marked), then Jira, required and with your
  account, then Figma, optional (`1. Connect Figma / 2. Skip`). The other commands keep their one-line
  check.

## [0.15.0] - 2026-10-23

**Two things to do when you update** (see Upgrading): `/quality-code:check` is gone (use the
`run-*` commands), and ticket copies move to `.quality-code/tickets`.

### Added

- **Three run commands replace `/quality-code:check`** (AGT-127). `/quality-code:run-frontend` runs
  every frontend (Playwright) spec of the project through the pipeline, `/quality-code:run-backend`
  every backend (Vitest) spec, and `/quality-code:run-pipeline` both together, the full suite. The
  script lists the specs (`pipeline.mjs --suite frontend|backend|full`), never the model; spec paths,
  `--key` and `--flaky` work as before, `run-pipeline --branch` takes only the tests your branch
  changed, and `run-pipeline --evals` runs the frozen evals.
- **Setup in two answers** (AGT-110, AGT-111, AGT-112). After the repo-or-no-repo card, one Confirm
  card shows the folder, remote, stack, Jira site and project(s), the base branch and the config, with
  `1. Write it / 2. Change something / 3. Cancel`. The site is not asked when the account has one. The
  Jira project is proposed from the keys in your branch names and recent commits (`setup.mjs --detect`
  gives `projectCandidates`); on a site with more than 20 projects a typed key is checked instead of
  showing the whole list. The base branch is proposed (an earlier `git.base`, the usual target of
  recent merged merge requests, `develop`, else `origin/HEAD`) and written as `git.base`.
- **Criteria drafted from the ticket** (AGT-116). When the fill-in asks for acceptance criteria and
  the ticket has text to work from, the model drafts Given / When / Then for the author: Use it / Edit /
  Skip. The script still scores it, nothing reaches Jira without the preview and a yes, and
  `/quality-code:kpi` counts drafted fill-ins.
- **No failed MCP servers without a token** (AGT-113). `figma-token` and `gitlab-token` start through
  `bin/mcp-launch.mjs`: the real server when its token is set, else a server with no tools.

- **`/quality-code:spec`: one command from ticket to checked tests**, for developers and QA. It runs
  the gate, the plan, the writing, the checks and the read-back, and asks a person three times at
  most: at the gate only when the ticket is refused, at the plan, and after the card. With no key it
  takes the ticket of your branch: from the branch name with no question, else the merge request's
  title or the commits. `--gate-only` is the gate alone (as `ticket-eval`); `--yes` skips the plan
  question. On a branch that already has tests for the ticket, the plan card can just check them.
  `start` and `write` are now thin aliases of `spec`, kept so the old names work.
- **A gate that only stops when it must.** A borderline ticket (60 to 69, with something to check)
  goes on, with every result marked 🔴 [RISK / NOT RECOMMENDED]. A refused ticket's card leads with
  the cheapest way over the bar (`To pass: add Expected result (→ 78 points)`). The fill-in asks every
  picked question in one card and takes the answers in one reply, can suggest text from the merge
  request or the branch's commits for you to accept, and still lets the script accept or refuse each
  answer. Answers typed in an earlier run that never reached Jira are offered again. New script
  calls: `ticket.mjs score --next` (the band and the cheapest fix) and `ticket.mjs saved <KEY>`.
- **GitHub pull requests, through the `gh` CLI.** On a GitHub repo, `branch.mjs --detect` finds the
  branch's open pull request when `gh` is installed and signed in: its target is the base (after
  `--base`, before `git.base`), a key in its title is a ticket candidate, and its description feeds
  the fill-in suggestions, as a GitLab merge request does. No MCP server and no token setting. The
  connectors card has a GitHub line (`gh`'s account, or why not and the `gh auth login` fix) for a
  GitHub repo, GitHub Enterprise on its own domain included (known by `gh`'s sign-in to it).
- **GitHub and GitLab repos work the same.** GitLab is on the connectors card only for a GitLab
  remote: the default `gitlab_api_url` used to put it on every card, so GitHub repos saw a GitLab
  warning on every run. A merge request's title and description, from either host, are saved as
  `mergeRequest` and redacted by `sanitize` before a fill-in suggestion can quote them (a GitLab
  description used to be quoted as the connector returned it). When the target branch is not fetched,
  both keep the detected base and say `git fetch origin <target>`.
- **`git.base` in the config.** When a project's merge requests target a branch other than
  `origin/HEAD` (for example `develop` while `origin/HEAD` is `main`), set `git.base` and every
  command that detects the branch (`spec`, `check`) diffs against it. An explicit `--base` flag, and
  an open pull request's or merge request's own target branch, still win over it; it still wins over
  `origin/HEAD` and the `develop`/`main`/`master` guess.
- **Any project, not only the warehouse.** New config fields, each defaulting to today's behaviour
  unless said otherwise (README, "The config file"): `jira.bugTypes`, `jira.doneStatuses`,
  `confluence` (`false`: no QA-plan criterion, the score scaled over the rest), `git.base`,
  `playwright.ungradedTitles` (default: none), `playwright.redTags`, and `$schema` (ignored).
  Jira keys may hold `_` (`MY_PROJ-12`). GitHub and Bitbucket repos: issue templates in
  `.github/ISSUE_TEMPLATE/`, pull request merges and links are read, no GitLab warning. Monorepos:
  tools are found in a parent's `node_modules`, a config is found from a subfolder, `.env*`,
  `dist/` and `node_modules/` are guarded at any depth. Tools run with Node itself, so Windows
  works. Solution-style tsconfigs, `vite.config.*` with a test block, lcov coverage, Bedrock and
  Vertex model ids, and the claude.ai Atlassian connector's operation names are understood.
  Svelte, Astro, `.mts`/`.cts` and `.html` files count as code changes; setup also proposes `app/`,
  `lib/`, `server/`, `pages/`, `components/` and `packages/*/src/` as paths a test run must not
  change, and guards the Jenkins, Azure, Bitbucket and CircleCI files.
- **`ticket.mjs field find @<file>`** finds the acceptance-criteria field in Jira's field list by
  the configured languages' heading, so `ticket-eval` no longer greps a large file with a call that
  was never pre-approved.

### Fixed

- **Criteria read from the content, not the headings** (AGT-120). A list of checks with no
  "Acceptance criteria" heading counts as criteria when its items name something a test can see;
  numbered action steps count as steps, and an `Env:` line or a named environment counts as the
  environment. A ticket is legacy only with no content signal at all. Vague items still are not
  testable.
- **No QA-plan points out of reach** (AGT-115). With no `qaPlanSearch` on any feature and no QA-plan
  page attached, the QA plan is left out of the score, as with `confluence: false`.
- **Uncommitted work no longer fails a write run's boundary check.** `run start` snapshots the hash of
  every path already changed before the run; the boundary step only counts a path whose content now
  differs from that snapshot (or that the run reverted back), so dirty files from before the run never
  fail it even when the run edits them further. The run marker, boundary log and the rest of the
  plugin's own state are never counted either.
- **The readiness gate no longer scores over points a project or this ticket can never earn.** A key
  this config can never credit (no features configured, no title prefixes configured, `"confluence":
  false` for a team with no Confluence, or one a Story is never asked for) is left out of the gate's
  denominator instead of permanently capping the score; the report, the refuse comment and the fill
  menu all stay silent about it. Earned anyway, it still counts: a Story that already has an
  environment section is not marked down for lacking one, and gets credit for it. A `qaPlanSearch`
  that simply finds nothing still lowers the score, and a plan that was in fact found is always
  credited.
- **A failed boundary or honesty check keeps the developer's files.** `write` undoes only its own
  change, with an edit, and never runs `git restore` or `git checkout`. A finding on a file the run
  did not write ends the run with the card instead.
- **A Story is never refused for what its fill-in cannot ask.** The fill-in never asks a Story for an
  environment or an expected and actual result; a refused ticket with nothing left to type in says
  what is missing and offers the Jira comment or the override, never an empty list.
- **`sanitize` deletes only the raw ticket file** (AGT-105). It deletes its input once the clean copy
  is written, and it used to delete any JSON file it was given (`--in @package.json` removed
  `package.json`). Now a file input must be `<ticketsDir>/<KEY>/raw.json`; anything else is refused
  with exit 2, left as it is, and nothing is written. `tickets-eval` likewise removes only
  `<ticketsDir>/tickets-eval.json`, the file its command writes.

- **Checks that let a weak test through.** A bare `expect(x)`, an uncalled matcher or an `expect(`
  in a string no longer counts as an assertion; a passing test mutation cannot check makes the run
  "not verified" instead of green; a test that passed once and failed every re-run is flaky; a
  value only inside `expect(…)` no longer counts as asserted (Vitest); `test.fixme`/`test.fail`,
  `skipIf`/`runIf`, `.only` and a skip of the ticket's own block are honesty failures; a colored or
  external git diff (from your git config) can no longer hide a removed `expect`.
- **Checks that failed an honest test.** `it.each`/`test.each`, `describe.concurrent`, `suite(`,
  `test.describe.serial`, `expect.soft`/`expect.poll`, `assert`, a regex `.test('…')` and plain
  Playwright value assertions are read right.
- **The boundary hook.** A path in another case, through a symlink or the `/tmp` alias is checked
  as the real file; the plugin's own run marker, logs and Claude settings are guarded; a glob folder
  rule covers its files; an uncommitted edit you had before the run no longer fails it.
- **The readiness gate.** Jira ADF descriptions keep their lines (a good ticket scored 10%); bold or
  bulleted Gherkin, `h2.` and decorated AC headings count; a short "X:" line no longer ends the
  criteria; vague But/E/Ma lines and "e.g." are read right; feature labels match in any case; an
  Environment section with any text counts; fill-in answers use the project's language; a crash
  exits 2, never 1 (refuse); tracked projects are not foreign; `score --json` is pure JSON; long
  blank runs no longer slow scoring down; two different UUIDs stay different when redacted.
- **Branch and setup.** `--merged` no longer counts the main branch's later work or a stash; a
  shallow clone keeps its dirty files; `ticketsDir` must stay inside the project; a symlinked
  `settings.json` is written through.
- **Reports and XRay.** Card replies (`ok`, `sì`, `basta`…) keep a run's cost in the run; `7d`/`30d`
  count back from `--until`; impossible dates are refused; another project sharing a transcript
  folder name is left out; a hand-written XRay case keeps its number; DDE payloads starting with `-`
  are quoted; evals pick the requirement's own case.
- **A killed run cleans up.** Ctrl-C or a timeout stops the test tools and removes their temp files.
- **A repo with no commit yet** is checked against the empty tree, instead of the honesty and
  boundary checks never running.
- **The commands.**
  - `write` rewrote nothing when the assertions check failed (it looked for a step named
    `assertions`); it now rewrites, also for a passing test mutation cannot check.
  - `kpi`'s "AI cost of the same days" option could not run; it now runs the consumption script.
  - `start` no longer runs an unapproved `git branch` call.
  - `setup` writes its proposal inline, with no temp file and no permission prompt.
  - `--dry-run` on `write` and `xray` says what it still does: the ticket is saved, nothing goes
    to Jira, a refused ticket ends the run.
  - `ticket-eval`'s score rule no longer contradicts itself, and a refuse comment's exit 1 is
    expected, not an error.
  - Figma is checked for fullstack repos too, `xray` no longer stops on an optional connector, and
    examples no longer use warehouse strings.
- `pick 1 2` works without quotes; a `sides` block that sets only some sides keeps the others'
  default marks; `jira.site` may end in `/`.

### Changed

- **`/quality-code:start` and `/quality-code:write` are now `/quality-code:spec`**, kept under their
  old names. `start` no longer ends on an action card: the plan card carries the choice.
- **The plan is a question.** `spec` (and `write`) show the plan card and wait; `--yes` goes straight
  on. `--ask` is gone.
- **The refuse card's order:** `1` fills it in here, `2` posts a comment on Jira, `3` continues anyway,
  `4` stops. `--ci` still comments (now option 2).
- **Ticket copies default to `.quality-code/tickets`**, not `.claude/quality-code/tickets`. Claude
  Code asks before every write under `.claude/`, so a `--ci` run could not save `raw.json`,
  `expected.json` or `target`, and an interactive run got extra prompts. A config that sets
  `ticketsDir` keeps it (AGT-107).

### Upgrading

- **`/quality-code:check` is gone.** Use `/quality-code:run-pipeline --branch` for the tests your
  branch changed, `/quality-code:run-pipeline <spec…>` for named specs, and
  `/quality-code:run-pipeline --evals` for the frozen evals.
- **New ticket folder.** With no `ticketsDir` in the config, rerun `/quality-code:setup` so
  `.gitignore` ignores `.quality-code/tickets/*/raw.json`, and move saved tickets with
  `mkdir -p .quality-code && mv .claude/quality-code/tickets .quality-code/` (or set `"ticketsDir": ".claude/quality-code/tickets"`
  to stay where you were, prompts included).

- **`languages` now defaults to `["en"]`.** A config without `languages` used to read English and
  Italian; add `"languages": ["en", "it"]` to keep both.
- **Design-capture tests** (titles with "capture" or "conformance") are graded now. To keep them
  out, as before, add `"ungradedTitles": "conformance|capture"` to the `playwright` block.
- A spec whose passing tests assert only with snapshots or a matcher mutation cannot flip now ends
  "not verified" instead of green: give those tests a value assertion.
- **`--ask` is gone** and the refuse card's numbers changed (`1` is now "fill it in here"): drop
  `--ask` from saved commands, and read the card before typing a number from habit.

## [0.14.0] - 2026-10-22

**`/quality-code:start` now runs the pipeline instead of showing a menu.**

### Changed

- **`/quality-code:start` runs the whole flow.** After the repo card and the ticket from the branch
  name, it runs the readiness gate, then the tests: when the branch changed test files it checks
  them (`check`, with the ticket key), otherwise it writes the tests for the ticket and checks them
  (`write`). A refused ticket stops at the gate with its refuse card and fill-in, as before.
- **`--ask`** brings back the old menu (`Evaluate the ticket / Check the tests on this branch /
  Write and check tests / Stop`) for when you want one step only.

### Upgrading

Nothing to do. If you used `start` only to evaluate a ticket, use `/quality-code:start --ask` or
`/quality-code:ticket-eval <KEY>`.

## [0.13.0] - 2026-10-22

**Every ticket's score changes:** attachments and links now count (see Changed). On the warehouse
parity set, 8 of 123 tickets go from pass to refuse.

### Added

- **For QA and product owners, no repo needed.** `/quality-code:setup` asks first where you use it:
  `In a repo (developers)` or `No repo, Jira only (QA, PO)`. The second saves a personal setup in
  your Claude folder (`~/.claude/quality-code.json`), so `ticket-eval`, `ticket` and `tickets-eval`
  work in any folder. Inside a repo, the repo's config still wins. `write`, `check`, `seed`, `xray`
  and `start` say plainly that they need a repo.
- **`/quality-code:tickets-eval <PROJECT> [--user <name>] [--status <s>] [--limit N]`:** scores a
  whole project's tickets in one go, read-only. One line per ticket (score, pass or refuse, the
  biggest gap), then the project: how many pass, the average score and the three items most often
  missing.
- **Figma drafts in the fill-in.** When a refused ticket links a Figma design, the guided fill-in
  offers `Draft from Figma and my changes`: it drafts the acceptance criteria, expected behaviour or
  steps from the design and the branch's code changes (the design only, without a repo). You see
  each draft and choose `Use it / Edit / Skip`; the script still decides whether it counts, and
  nothing reaches Jira without the preview and your yes. Unknown values stay as questions.
- **XRay test cases for QA.** With an `xray` block in the config (Playwright and fullstack), `write`
  adds one XRay test case per Playwright test it writes, and `/quality-code:xray <KEY>` writes the
  cases alone, with no test. `bin/xray.mjs` appends them to one CSV (`xray.csv`), numbered per
  ticket and never twice, and writes each ticket's `case.csv`, plus a styled `case.xlsx` when the
  project has `exceljs`, for import into Xray. `xray.headers` matches your import mapping's column
  names. The same rows the old in-repo harness wrote: its CSV is read as it is.
- **Confluence pages attached to a ticket.** `ticket-eval` reads the ticket's remote links (its Web
  links) and uses an attached Confluence page with scenarios as the QA plan, before searching by
  `qaPlanSearch`. It used to look in `issuelinks`, which only links tickets to tickets, so an
  attached page was never found.
- `check --evals`: a fixture with `requirement` also checks that each of its tests has an XRay case
  linked to that ticket (with an `xray` block).

### Changed

- **Attachments and links are in the 100 points**, the bar stays at 70. Backend (Vitest): criteria
  25, testable 15, steps 10, expected 15, attachments 10, links 5, context 5, title prefix 5, feature
  label 5, environment 5. Frontend (Playwright): criteria 25, testable 15, feature 10, QA plan 10,
  steps 10, expected 10, attachments 10, links 5, environment 5. Only the attachment count and the
  link addresses are kept, never file names or contents. The fill-in can add a link; an attachment is
  added on Jira and counted when the ticket is read again.
- **Cheaper and faster commands.** Each command now picks its model and effort for the turn it
  starts in: Haiku with low effort for `kpi`, `consumption` and `check`; Sonnet for `setup`,
  `start`, `ticket` and `ticket-eval`; your own model for `write`, `seed` and `xray`. Measured on
  the sample service against Opus: `kpi` $0.240 → $0.007, `consumption` $0.214 → $0.006, `check`
  $0.245 → $0.007, with the same cards.
- **No permission prompts for the plugin's own scripts.** Every command pre-approves its scripts
  (`kpi` and `consumption` only their own) and runs them exactly as written. Before, an added
  `echo` made a call miss its pre-approval and cost a prompt and an extra turn.
- **Base branch order.** With no `--base` and no merge request, the base is `git.base` when set,
  else the remote's default branch, else `init.defaultBranch`, `main`, `master`, and `develop`
  last (it used to be tried first).
- **Setup** says up front that Jira must be an Atlassian Cloud site and stops on a Server or Data
  Center one; its card shows the remote of any host (GitLab, GitHub, Bitbucket).
- **New folder layout.** `core/` is gone. The scripts the commands and the hook run are in `bin/`,
  the modules they use in `lib/` (`base`, `ticket`, `pipeline`, `report`), the guides in `guides/`.
  `core/quality-kpi.mjs` is now `lib/report/quality-program.mjs`. No behaviour change.

- **Quality Code has a brand.** A logo (code brackets around a check, in the TeamSystem palette),
  the display name **Quality Code**, the tagline "From Jira ticket to tests you can trust.", and the
  listing metadata: icon, homepage, repository, keywords, documentation and support links. The
  README opens with the wordmark. Name, colours and logo rules are in `docs/brand/BRAND.md`.

- **The marketplace is now `teamsystem`:** install and update with `quality-code@teamsystem`. The
  plugin's own README has a **Try it** section with example requests, shown with the plugin.

- **A short README:** overview, features, installation, quick start and links. The full reference
  moved, unchanged, to `docs/GUIDE.md`.

### Upgrading

- **Once per person**, because the marketplace was renamed: `/plugin uninstall quality-code@quality-code`,
  `/plugin marketplace remove quality-code`, `/plugin marketplace add vissz28/agentic-testing`,
  `/plugin install quality-code@teamsystem`. Your plugin settings are kept under the new id only if
  you set them again (`/plugin`, quality-code, configure). In repos whose `.claude/settings.json`
  lists the marketplace, rename its key to `teamsystem` and the `enabledPlugins` entry to
  `quality-code@teamsystem` (the README's Installation section shows the block).
- Nothing to do. To get XRay test cases, add an `xray` block (Guide, "XRay test cases").
- If a CI job or script of yours runs a plugin script by path, change it: `core/cli.mjs` →
  `bin/ticket.mjs`, `core/pipeline/cli.mjs` → `bin/pipeline.mjs`, `core/checks/cli.mjs` →
  `bin/checks.mjs`, `core/consumption/cli.mjs` → `bin/consumption.mjs`, and `core/<name>.mjs` →
  `bin/<name>.mjs` for `kpi`, `setup`, `branch`, `xray`, `evals` and `connector-settings`.

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
