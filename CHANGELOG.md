# Changelog

What changed in each version of the `quality-code` plugin, newest first, and what you have to do
when you update. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
plugin uses [semantic versioning](https://semver.org/) (before 1.0, a minor version can break
things, and says so here).

Update with `/plugin update quality-code@teamsystem`.

## [Unreleased]

## [0.58.2] - 2026-11-05

### Changed

- `/quality-code:qa`: the browser run starts in the browser pane you watch. You sign in to the app yourself (and again for each role a test needs); a sign-in page in the middle of a test is Blocked, not KO. An app address found in the Jira fields (run, story, parent) is confirmed with you, or you type another one.

**What to do:** update and restart Claude.

## [0.58.1] - 2026-11-05

### Changed

- `/quality-code:qa`: a run that is already Done, or assigned to someone else, starts with a dry run as the first option, so a finished run is not changed by mistake. When Jira is not signed in in the browser pane, it waits for the sign-in instead of only asking for a file, and tells you once that the Xray API key reads the tests with no browser.
- `/quality-code:qa` with a task key (a parent task, story or subtask) shows the subtasks and tests to cover, lets you pick one at a time, reads each one's fields, attachments, links and merge requests, and writes an end-to-end plan of how to test it. Nothing is sent to Jira unless you pick the comment option and confirm.
- `/quality-code:xray` reads the GitLab or GitHub links of the story (works with or without a repo) and adds cases from what the code does. When the ticket has such links and GitLab (or GitHub) is not connected, both commands say so and point to `/mcp` or `/quality-code:setup`, with `Signed in: read the merge requests`, `Continue without the code` and `Stop`, instead of skipping it silently.

**What to do:** update. For a fully automatic run, set the Xray API key with `/plugin` (the `xray` connector).

## [0.58.0] - 2026-11-05

### Added

- `/quality-code:ticket-eval` with no key takes it from the branch (its name, and the merge request title) and asks `Is this your Jira story?`. Several keys can be picked; each is scored in turn.
- `/quality-code:run-backend` (and the other run commands) offer to fix compile errors in the spec files after the card: only the lines the errors name, shown as a diff, then one more run.
- `/quality-code:consumption --session` shows the AI cost of this session only, and the `kpi` "What next?" card has it as an option.
- The `spec` card "Which code does this ticket change?" allows several answers: one spec per picked file.

### Changed

- `/quality-code:qa` needs the test execution key: `/quality-code:qa <KEY>`. The list of your executions and `--first` are gone; a development task key is refused with a clear line.

**What to do:** update. Run QA with the key of the test execution.

## [0.57.2] - 2026-11-05

### Changed

- `/quality-code:xray` ends with `Next: /quality-code:qa`: qa continues the work of xray, running the cases it wrote in the browser, test by test.

**What to do:** update.

## [0.57.1] - 2026-11-05

### Fixed

- `/quality-code:xray` no longer needs a repo. Xray is part of Jira, so it now works with the personal setup (QA and PO): no `xray` block is needed, the cases are kept in `xray-cases.csv` in your tickets folder, and the per-ticket files go beside the tickets. A repo still needs its `xray` block.

**What to do:** update. QA and PO: run `/quality-code:setup` once (option 2, no repo), then `/quality-code:xray <KEY>` from any folder.

## [0.57.0] - 2026-11-04

### Changed

- `/quality-code:spec` reads its testing rules from TeamSystem's hosted Central Context hub by default, so everyone who runs setup is connected with nothing to set. `centralContext.hub` still picks another hub, `"off"` still turns it off, and `CC_HUB_URL` still wins. To move the default to a new URL, see the comment on `DEFAULT_HUB` in `lib/base/rules.mjs`.
## [0.56.0] - 2026-11-04

### Added

- A third test flow, `both`: `testFlow: "both"` in the config, `--flow both` on `/quality-code:spec`, and a third answer on the setup and config cards. Each test, unit and e2e, is written in your project's own flow and again in Quality Code's (the ticket key in the file name), so the pipeline can still trace the ticket.

### Fixed

- The kpi usage test expected the usage line from before `--report`; it failed the CI core job on 0.54.0 and 0.55.0.

**What to do:** update. To use it, run `/quality-code:config-set testFlow both`.

## [0.55.0] - 2026-11-04

### Added

- **`config-set` and `config-get` as their own commands (AGT-180).** `/quality-code:config-set <key> <value>` and `/quality-code:config-get <key>` run the same checks as `config set` and `config get`: preview old and new, one yes, nothing written on an error or a secret. With no key, `config-set` lists the settable keys with an example (`ticket.mjs config keys`). A token or plugin setting is never set here; it shows the exact `/plugin configure quality-code@teamsystem` steps (for GitLab, the `read_api` scope). `/quality-code:config set ...` keeps working.
- **Setup ends with what is connected (AGT-179).** `/quality-code:setup` finishes with `Setup completed`: a table of Jira, GitLab or GitHub (a warning and the reason when sign-in fails, for example 401), Figma, repo, stack, base branch, config path and where files go, then `Next: /quality-code:spec`.

### Changed

- **Setup no longer offers to add Playwright, Vitest or a database test setup (AGT-179).** It only connects and configures, and never installs a package or writes a test. `/quality-code:spec` shows the runner card (what it installs and writes, app command and address, sign-in, `Add it` / `Not now`) at the plan stage when the repo lacks the runner, and installs only after you pick it, never with `--ci` or `--yes`.

### What to do

Run `/plugin update quality-code@teamsystem`, then `/reload-plugins`. If a repo has no Playwright or Vitest yet, pick `Add it` when `/quality-code:spec` shows the runner card. For a GitLab 401, set the token in `/plugin configure quality-code@teamsystem`.

## [0.54.0] - 2026-11-04

### Added

- **Richer result cards (AGT-176).** `guides/display.md` gains a headline row (verdict, score, ten-square bar with the gate, short counts for tests, negative, accessibility, visual and database), a `Next:` line, collapsible `<details>` for long lists, and one set of marks, used by spec, ticket-eval, tickets-eval, the run commands, kpi, consumption and ci. Cards are still never code blocks.
- **A report page with charts (AGT-178).** `--report` on `/quality-code:kpi`, `/quality-code:tickets-eval` and `/quality-code:consumption` writes one self-contained HTML file (inline SVG, light and dark, no scripts or network) to `<ticketsDir>/reports/`: verdict trend, pass rate per ticket, score distribution, mutation, cost by command, day and model. Only keys, scores and numbers go in. In the desktop app it can publish the file as a private Artifact after your yes. The chat card stays the text version.

### Changed

- `transcript-goal`, the `ticket-eval` story rewrite, `clean`, `clean-cache`, `config set/get` and `run-smoke` follow the display guide: a headline first, sections and tables, a wrap-up where something is made, a Next line, no code-block cards (AGT-177). Their safety rules are unchanged.
- `consumption` reads the project's own config instead of the home folder's when given an environment.

### What to do

Run `/plugin update quality-code@teamsystem`, then `/reload-plugins`. Try `/quality-code:kpi --report` and open the `HERE` link.

## [0.53.0] - 2026-11-04

### Added

- **Clear the cache (AGT-173).** `/quality-code:clean-cache [--all] [--yes]` lists, then deletes only the plugin's local cache (saved stops, reused facts, language) for this project or every project, after a Delete/Cancel question. Config, tickets and specs are never touched.
- **Undo Quality Code in a project (AGT-174).** `/quality-code:clean [--dry-run]` removes what the plugin created: setup files, saved output, the cache and, only if you pick them, the personal config and the tests `spec` wrote. A script lists it, you pick the groups, and one explicit yes is always asked (never skipped by `--yes` or `--ci`). Tracked files are flagged; git history is never touched.
- **Change one setting directly (AGT-175).** `/quality-code:config set <key> <value>` and `config get <key>`, for example `config set git.base develop`. Dotted keys, lists with commas and typed values are checked by the setup rules; nothing is written on an error or a secret. `--personal`, `--project` and `--yes` are supported.

### Changed

- `/quality-code:config` opens with a short summary card and shows `set` as the quick way.
- Project names (a Jira site and key, a ticket id) are kept out of the plugin's guides and scripts, which the CI check requires.

### What to do

Run `/plugin update quality-code@teamsystem`, then `/reload-plugins`. Try `/quality-code:clean --dry-run` before `/quality-code:clean`, and check `git status` if the preview lists tracked files. Tokens and the Jira email, GitLab and Xray settings stay in `/plugin`.

## [0.52.0] - 2026-11-04

### Added

- **Negative tests on every ticket (AGT-166).** `ticket.mjs negative-check` flags tickets with no invalid-input, error or permission-denied criteria (a suggestion that never changes the score). `/quality-code:spec` proposes negative tests per input and shows `Negative: N cases` on the plan card, where any case can be removed.
- **Accessibility (AGT-167).** Every Playwright screen spec ends with an axe scan (WCAG 2.1 AA, `@axe-core/playwright`) that fails on violations. The plan card shows `Accessibility: axe on N screens`; it asks before installing the package; `--no-axe` turns it off.
- **Smoke suite (AGT-168).** `/quality-code:run-smoke [--url U]` runs only the Playwright tests tagged `@smoke`, read-only, against the running app or any URL. `/quality-code:spec` lets you pick the critical tests, and `/quality-code:ci --smoke` adds an optional post-deploy job that runs them against `SMOKE_URL`. Backend smoke is not available yet.
- **Regression from a bug (AGT-169).** A Bug ticket in `/quality-code:spec` leaves a `@regression` test (key in the test name, project conventions first). The pipeline card shows the fail-then-pass proof with `--regression-before red|green`, and `/quality-code:routine --regression` runs the `@regression` suite.
- **Visual regression (AGT-170).** Playwright specs can include optional `toHaveScreenshot` checks with a `Visual: baseline for N screens` plan line. You confirm baselines before they are created or updated; they are committed, not ignored (guide: `visual-regression.md`).
- **Database checks (AGT-171).** Backend tickets that touch tables, queries or migrations get a `Database: N cases` section (constraints, migration up on an empty and a filled database, data integrity), run on a real database via Testcontainers.
- **Sprint goal from a Teams transcript (AGT-172).** `/quality-code:transcript-goal` turns a Teams sprint planning transcript (`.vtt`, `.docx`, `.txt`, pasted text, or the meeting via the Microsoft 365 connector) into a sprint goal and tasks, asks only what was not said, shows review cards, then creates the tasks in Jira after a preview and your yes (linking existing tickets) or saves them to `<ticketsDir>/sprint/<date>-goal.md`.

### What to do

Run `/plugin update quality-code@teamsystem`, then `/reload-plugins`. Tag your critical tests `@smoke` (or let `/quality-code:spec` do it) and set `SMOKE_URL` in your CI settings, then run `/quality-code:ci --smoke` again to add the post-deploy job. To use `transcript-goal`, export the transcript from Teams (Recap, Transcript, Download .vtt) and run `/quality-code:transcript-goal --file <file>`.

## [0.51.0] - 2026-11-04

### Added

- **Rewrite a weak story (AGT-165).** After `/quality-code:ticket-eval` scores a ticket, a script check (`ticket.mjs story-check`) tells whether the description is too long, has no structure (no goal, no acceptance criteria) or is too thin. When it does, the command offers to rewrite the story from the ticket description, Figma, Confluence or another source (a link or pasted text), asking about every gap and never inventing facts. The draft (Goal, What, Acceptance criteria, Done when) is shown as a card with what changed, what is still missing and the re-scored result. You then pick: post it to Jira (only after the preview and a yes), save it at `<ticketsDir>/<KEY>/story.md`, edit more or cancel. Nothing is asked with `--ci` or `--yes`. The thresholds sit in one block in `lib/ticket/story.mjs`.

### What to do

Nothing. Run `/plugin update quality-code@teamsystem`, then `/reload-plugins`.

## [0.50.0] - 2026-11-04

### Added

- **A memory for commands (AGT-159, AGT-164).** `setup` and `spec` remember the step they reached and your answers, and ask `Go on from there / Start over / Stop` the next time. The plugin also keeps what it learned about the project: the flow, the tests (naming, folders, per-unit files or a central file, base classes, assertion library), the style of the nearest specs, the stack, the base branch and the connectors. Each fact keeps its source and goes stale when the source changes (a new commit, a changed ticket, 24 hours for connectors); a stale fact is read again, and a rerun says `Reusing from your last run: …`. Files are kept as a path and a hash, never as a copy. `--fresh` reads everything again; `progress.mjs context list|clear` shows or forgets it. Local to your machine, never in the repo, never sent anywhere, and it refuses tokens, keys and passwords.
- **Your language is kept (AGT-163).** A pick, a number or a command run no longer switches the plugin back to English: it keeps the language of your last sentence and remembers it between commands and sessions (`guides/language.md`).

### Changed

- **Existing test structure first (AGT-160).** `spec` looks for where the project already tests the target: the file that tests the same unit, or the project's central test file or class, and adds the new tests there. A new file is created only when there is no such home, never one new class per ticket. `ticket.mjs config test-home <target>` shows what it found.
- **Project conventions before the stack's defaults (AGT-161).** When the project already has tests, its naming, folders, base classes, annotations and assertion library win over the JUnit (and pytest, Go, .NET, Vitest) guides. For Java, detection now reads the class suffix, the package layout, the base class, the annotations and the assertion library (`testStyle`).
- **Every question is a clickable picker (AGT-162).** The commands ask with `AskUserQuestion` (click, or arrows and Enter, with `Other` for your own words): more than four options are paged, and cards that allow several answers use multi-select. A numbered text card is only for a client without the tool.

### What to do

Nothing. Run `/plugin update quality-code@teamsystem`, then `/reload-plugins`.

## [0.49.0] - 2026-11-04

### Changed

- `/quality-code:spec` ends with the next command for the ticket's side: `/quality-code:run-backend` for a backend ticket (the whole backend suite, including the integration tests that use real databases in Testcontainers; Docker must be running), `/quality-code:run-frontend` for a frontend one, both for a fullstack one. Left out with `--ci`.

### What to do

Nothing.

## [0.48.0] - 2026-11-04

### Changed

- `/quality-code:spec`: the plan card now says what will be written before anything is: the runner and libraries, and the file paths (new or added to). It uses your project's own runner, libraries and flow when it has them, and Quality Code's defaults when it has none (Vitest + Stryker + Testcontainers, JUnit 5 + PIT + Testcontainers, xUnit + Stryker.NET + Testcontainers, pytest, Go, Playwright). The options are `1. Yes, write these tests`, `2. No, stop` and `3. Something else` (change the layers, leave out the extras, type a different result, or say it in words).
- The main repository is `github.com/vissz28/agentic-testing` again: the listing links, the guides, the user guide script and the CI file the `ci` command writes point to it. The TeamSystem organization repository (`teamsystem.ghe.com/teamsystem/quality-code`) is a mirror that is updated from it.
- New `mcp-server/DEPLOY.md`: how to run the shared MCP server in dev, test and main with Microsoft Entra ID sign-in (AGT-157, HWS-1334).

### What to do

Nothing, unless you added the marketplace from the organization address (0.44.2): run `/plugin marketplace remove teamsystem`, then `/plugin marketplace add vissz28/agentic-testing`, then `/plugin update quality-code@teamsystem`. `--yes` and `--ci` still skip the plan question and show the plan as information.

## [0.47.0] - 2026-11-04

### Changed
- `/quality-code:ci` names its jobs `test_quality_gate` and `test_quality_tests` (GitLab: `stage: test`), as Central Context's CI naming standard asks. **To do:** run `/quality-code:ci` again to rewrite the file; on GitHub, a branch protection that requires `quality-gate` now requires `test_quality_gate`.

### Added
- `/quality-code:ci` checks the file it wrote against Central Context's CI rules with the `central-context` connector, shown as the `Searched Central Context` step with one line per rule that applies (met, or what differs). It never edits the file for a rule.

### Fixed
- `/quality-code:spec`: the Central Context search sent `client_context` with a space, which Central Context refuses, so the search failed on every run. It now sends `<project>#<KEY>`.

## [0.46.0] - 2026-11-03

### Added
- `/quality-code:spec` searches Central Context with the `central-context` connector on every run: one search on the ticket's topic (a second only for a topic the first missed), shown as the `Searched Central Context` step. A hit that fits the tests is read in full and applied; none that fits is dropped and the run goes on with the rules `rules.mjs` reads. Each call names the project and the ticket in `client_context`, which Central Context records. The two connector tools are pre-approved for spec.

## [0.45.0] - 2026-11-03

### Added

- **The result card says whether Central Context was used.** `rules.mjs --key` saves what it read next to the ticket,
  and the card, the run log and the audit log show it on a `Rules` line: `✅ Central Context (<host>) · 9 testing
  rules, release …`, or `⚠️ Fallback: Central Context not used (<why>) · written with 4 built-in rules`.

### Fixed

- **No more italic progress lines** (*Running the checks, a few minutes…*): the `report` style no longer allows them;
  a long step is its to-do item. The desktop app's `update_plan` checklist now carries the steps and their results.
- **The wrap-up after a spec run**: `/quality-code:spec` now ends with the display guide's wrap-up (what was made, what
  needs you, notes on what changed on the way) instead of a list of paths.
## [0.44.2] - 2026-11-03

### Changed

- The plugin now lives in the TeamSystem organization: `https://teamsystem.ghe.com/teamsystem/quality-code`. The listing links, the guides, the user guide PDF script and the CI file the `ci` command writes (it clones the plugin from there) point to the new address.
- New `mcp-server/DEPLOY.md`: how to run the shared MCP server in dev, test and main with Microsoft Entra ID sign-in (AGT-157, HWS-1334).

### What to do

The marketplace address changed. Run `/plugin marketplace remove teamsystem`, then `/plugin marketplace add https://teamsystem.ghe.com/teamsystem/quality-code.git`, then `/plugin update quality-code@teamsystem`. You need access to the repository on teamsystem.ghe.com (SSO authorized). If you pinned the marketplace in `settings.json`, use `{ "source": "git", "url": "https://teamsystem.ghe.com/teamsystem/quality-code.git" }`. A CI job that cloned the plugin from the old address needs a token for the new one.

## [0.44.1] - 2026-11-03

### Fixed

- The KPI's traceability result keeps its old shape when there is no branch number (0.44.0 added an empty `branch` field that a
  test of the old shape rejected). No change to what the card shows.

## [0.44.0] - 2026-11-03

### Changed

- **Traceability shows the work on this branch next to the whole suite** (AGT-156). `/quality-code:kpi` kept one number: the
  share of all spec files that name a ticket. On an old suite that stays low for years (15% in the PFO-2556 pilot: 61 of 416
  files). The line now adds the spec files this branch changed against `git.base`, including uncommitted and new ones:
  `61 of 416 spec files name a ticket; on this branch 3 of 3 (100%, since develop)`. The whole-suite number and its 100%
  target are unchanged. With no `git.base` in the config, or no changed spec file, the line stays as it was.

### What to do

- Nothing. Set `git.base` (setup does) so the branch number can be worked out.

## [0.43.0] - 2026-11-03

### Changed

From the PFO-2556 pilot report (AGT-155):

- **The expected-value check reads the values a test feeds to its assertions,** not only those typed inside the matcher.
  A list or table the test loops over (`it.each([...])`, `for (const c of [...])`, `[...].forEach`) counts when the loop
  body asserts, and so does a variable an assertion reads (`const expected = {...}`; three levels deep). A list nothing
  asserts, an `it.each` whose body has no assertion, an unused variable and a negated matcher still count for nothing.
- **Scenarios only a database can check no longer become tests over a mock.** The new config `externalChecks` lists the files
  of tests that run outside the unit tests (a pgTAP file for a seeded table), relative to the folder that holds the config.
  Quality Code reads them (it does not run them): a ticket value they assert counts as checked, and the verdict says
  `(N checked in <file>, outside the unit tests: read, not run by Quality Code)`. `/quality-code:spec` marks such a
  scenario `checked outside the unit tests, in <file>` and writes no restating test; without `externalChecks` it says
  what to add.

### What to do

- If your service has database tests for seeded data, add them: `"externalChecks": ["db/tests/**/*.test.sql"]` in
  `.claude/quality-code.json`. Without it everything works as before.

## [0.42.0] - 2026-11-03

### Fixed

From the PFO-2556 pilot report (AGT-154):

- **Setup no longer picks the project by name.** In a repo with several projects, the candidates are ranked by what this
  branch changed and by spec files, and setup shows a card (`Which project is this work in?`, each with its evidence) when
  nothing decides. Before, the first folder alphabetically was taken and the pilot had to run setup twice.
- **The choice of where files go, and a Jira project's criteria field, are asked once per repo,** not again each time the
  project root changes. A pick saved before still counts.
- **`/quality-code:spec` can write the tests first.** The target card has a new option, `The code is not written yet`: you
  name the path where the code will live, the tests import it, run without Stryker, and are expected to fail until the code
  exists. Run `/quality-code:spec` again once it does.
- **Setup costs fewer requests.** Every request re-reads the whole conversation, so setup's cost is how many requests it
  makes, not how long its text is. It now makes independent calls (detect, site lookup, connector checks) together.

### What to do

- Nothing is required. Run `/quality-code:setup` again in a repo with several projects to see the new project card.

## [0.41.0] - 2026-11-03

### Added

- **Frontend unit tests, per feature** (AGT-151). A feature can be tested end to end (Playwright, the default), with unit
  tests of its components and code, or with both: `features[].approach`. `features[].guide` points to a file in the project
  that says how your team tests that feature; `/quality-code:spec` reads it before it plans, and it wins over the plugin's
  guide where they differ. `ticket.mjs approach <feature>` reads both. `/quality-code:setup advanced` asks for them;
  `spec` asks once when the feature has no approach and the repo already has frontend unit specs. Unit tests need a
  JavaScript unit runner (Vitest, Jest, Mocha or node --test); config check says so when there is none.
- **The whole feature, not only the branch** (AGT-152). `branch.mjs --detect` now also gives `integration` (the main line),
  `baseKind`, `needsConfirm` and `wholeFeature` (what the branch changed since it left the main line). When a pull or merge
  request goes into another feature branch, `/quality-code:spec` shows a card: check only this branch against that branch,
  check the whole feature against the main line, or type another branch. `--yes` and `--ci` go on with the target. When the
  target is not fetched here, the merge request's changed files are read from GitLab (paths only). New flag `--mr-base`.

### Changed

- **Files and the audit log stay in the session until you choose** (AGT-153). The default place is now the session (a temp
  folder), not the project repo, and the session keeps an audit log too. `/quality-code:setup` ends with the question:
  the project repo, this machine, or only this session. Other commands ask only for projects set up before this.
  `QUALITY_CODE_PLACE=repo|local|chat` sets the default for a CI job or a script.

### What to do

- If you had no saved choice, your files and audit log now go to a temp folder. To keep them, run `/quality-code:config`,
  item 7 (or answer the question at the end of `/quality-code:setup`). Files already in the repo stay where they are until you pick.
- To test a frontend feature with unit tests, set `"approach": "unit"` (or `"both"`) on it in `.claude/quality-code.json`,
  and `"guide": "docs/testing/<feature>.md"` if your team has a file about it.

## [0.40.0] - 2026-11-03

### Added

- **The team's own rules next to Central Context's** (`centralContext.local` in `.claude/quality-code.json`): a
  folder of rule files in the Central Context rule format (`id`, `summary`, `status`, `severity`, `applies_to`,
  `tags`), read on every `/quality-code:spec` run next to the hub's, each source on its own line. Both lists are
  candidates: the spec applies only the rules that fit the tests it writes for the ticket and says how many
  (`Read from Central Context · 6 rules, 2 apply`, `Read from local rules · 3 rules, 1 applies`). Where the two
  disagree, the team's rule wins. A hub that is down still leaves the local rules.
- **Built-in rules shipped with the plugin** (`rules/`): five draft quality rules every developer gets with the
  plugin, read on every run on their own line: ready requirement before test generation, fail evidence for generated
  tests, every test asserts an observable outcome, justified changes to existing tests, and requirement, story and
  test traceability. A rule Central Context publishes with the same id replaces the plugin's draft, and the team's
  own rule replaces both.
- **The Central Context connector** (`central-context`, plugin setting `central_context_url`, TeamSystem's hosted
  hub by default): the hub's MCP tools `search_knowledge` and `get_knowledge_document`, for the model to look further
  when a ticket touches a topic the testing rules do not cover (input checks, auth, secrets, data access, an API
  contract), at most two searches a run, each shown as a completed step with what was searched. The connector check
  shows it as an optional line. The testing rules are still read by `rules.mjs`, without the connector.

### Changed

- **The wrap-up is up to 400 words, with technical terms where they are precise** (spec, assertion, stub, control
  test), no emoji in its headings or rows, and no lines that state what a command always does.

## [0.39.0] - 2026-11-03

### Added

From the QA tester flow, compared with `/quality-code:qa` and `/quality-code:xray` (AGT-150):

- **Blocked is not failed.** A test that cannot be done (app down, sign-in failed, no data) is recorded as Blocked and sets
  BLOCKED (or ABORTED) in Xray. After `qa.blockedStop` (default 2) blocked tests in a row the run offers to stop. The script
  decides this, and which Xray status a verdict maps to (`bin/qa.mjs`).
- **Evidence.** Each failing step gets a file path for its screenshot; the file is attached to the defect.
- **Resume.** Answers are saved after every test (`<audit folder>/qa/`, ignored by git); `--resume` goes on from them. A test's
  Xray status is set right after its card. `--auto-pass` records an OK without a card and stops at the first KO or blocked test.
- **Retest** can file a new defect, linked to the old one, besides commenting. `--watch` schedules a check that tells you when a
  story you sent back reaches your "ready to test" status.
- **Pick-up.** The search uses your open sprint and board order, and `--first` takes the first run. Earlier bugs that are
  children of the story are found too. The app address is remembered. The built-in browser is accepted. After a run, the next
  execution is offered.
- **`qa` config block** (`executionTypes`, `sprint`, `app`, `statuses`, `blockedStop`, `autoPass`) and item 16 of
  `/quality-code:config`. Names of your statuses (`TEST KO`, `Ready to test`) are set there instead of guessed.
- **`/quality-code:xray` creates the tests in Xray** when the API key is set: the Xray connector gains `create_tests` and
  `add_tests_to_test_execution`; the tests are linked to the ticket and, with `--run KEY`, added to that execution. Cases created
  are remembered per ticket, so none is created twice. Not tried against a real Xray tenant: tested with mocks only.

### What to do

- In `.claude/quality-code.json`, add `qa` if your test execution sub-task has another issue type, or to name your statuses:
  `"qa": { "executionTypes": ["<your type>"], "statuses": { "ko": "TEST KO", "ready": "Ready to test", "done": "DONE" } }`
  (or run `/quality-code:config`, item 16). Without it everything still works with the defaults.
- Try one real run on a test execution of your own before relying on it: the Xray writes have only been tested with mocks.

## [0.38.0] - 2026-11-03

### Changed

- **A wrap-up you read in one go.** What Claude writes after the last card is at most 250 words, in a fixed order:
  the verdict in bold, `What we made` as a table, `Needs you` as numbered steps, `Good to know` as at most three lines.
- **Plain words, files as `HERE` links.** Results are written so a 12-year-old follows them, and a file shows as a
  clickable `HERE` instead of its whole path.

## [0.37.0] - 2026-11-02

### Added

- **Reply style in `/quality-code:config`** (item 15): turns the `report` output style on or off for the project,
  in its shared `.claude/settings.json`, so the whole team gets it once that file is committed. Setup turns it on
  for every new repo setup. A personal `/output-style` choice in `.claude/settings.local.json` still wins on that
  computer, and the card says so.

### Changed

- **No status lines when Claude Code asks for an update.** When Claude Code reminds Claude that the user has not
  heard from it in a while, the checklist is the update: no more sentences like "I'm now fetching its remote links".
  A line is written only for a finding or a change of plan.

### What to do

- In a project already set up: run `/quality-code:config`, pick 15, then commit `.claude/settings.json`.

## [0.36.0] - 2026-11-02

### Added

- **The `report` output style** (`quality-code:report`): every reply laid out for a reader who is not technical,
  with bold headlines, a section per result, tables, colour marks, a readiness bar, advice in quotes and no
  narration, shown by one finished `/quality-code:spec` run. It keeps Claude Code's coding instructions and is never
  forced: turn it on per project with `"outputStyle": "quality-code:report"` in `.claude/settings.local.json`.

## [0.35.4] - 2026-11-02

### Changed

- **Progress as a live checklist** (every command with more than two steps): Claude's to-do list shows each step
  as it runs and ticks it off with its result (`Readiness gate · 85% ✅`, `Read from Central Context · 6 testing
  rules ✅`). No more sentences about what is being done; sections only where the reader reads or decides.

## [0.35.3] - 2026-11-02

### Changed

- **Cards are never code blocks** (every command): a card's information is laid out as a section, and its options
  are asked with Claude's question picker wherever a command says to show a card and end the turn.

## [0.35.2] - 2026-11-02

### Changed

- **Central Context is one completed step** (`/quality-code:spec`): each read shows a single line,
  `✅ Read from Central Context: 6 testing rules for the backend side (release …, …)`, or `⚠️ Central Context not
  read: <reason>. No rule applied.`, in place of the list of rules. The tests still follow every rule read; the
  plan card no longer repeats it.

## [0.35.1] - 2026-11-02

### Changed

- **Every read of Central Context is shown** (`/quality-code:spec`): the Central Context section appears each time
  the rules are read, in full (every rule, never shortened), with the hub, the release and the side, and also when
  nothing was read, with the reason. `rules.mjs` is the only way the plugin reads Central Context.

## [0.35.0] - 2026-11-02

### Changed

- **Easier to read in the chat** (every command): results are laid out by the new `guides/display.md`, one section
  per step with an emoji heading, a bold headline, tables for rules, missing items, the plan and the checks, colour
  marks (✅ ❌ ⚠️ 🔴), a readiness bar, passed and failed tests in green and red, and hints in quotes. Choice cards
  become Claude's question picker where it is available (numbered cards otherwise, and never with `--ci`). The
  content does not change: every score, verdict, rule, path and option is the scripts' own.

## [0.34.0] - 2026-11-02

### Added

- **Central Context testing rules** (`/quality-code:spec`): before the plan, the new `bin/rules.mjs` reads the
  company's Central Context hub (`GET /v1/manifest`) and keeps the active rules of the quality domain about testing
  (tagged `test`, `testing`, `testability`, `unit-test` and the like) whose `applies_to` fits the ticket's side:
  `all` plus `node`, `typescript`, `javascript` and `rest` for a Vitest backend (`python`, `java`, `dotnet` for the
  other runners), `web`, `typescript` and `javascript` for the frontend, both for a fullstack ticket. CI and
  infrastructure rules are left out. The plan shows them with the hub's release and the tests follow them; a rule
  never gives an expected value, changes a score or skips a check. The hub is the new optional `centralContext.hub`
  in `.claude/quality-code.json` (`CC_HUB_URL` overrides it, `"off"` reads none); without one, or when it does not
  answer, the plan says so and the run goes on.
- **Coverage on Java, Kotlin and .NET** (`/quality-code:kpi`): the coverage line now reads JaCoCo (Maven's
  `jacoco.xml`, Gradle's `jacocoTestReport.xml` and `testCodeCoverageReport.xml`) and coverlet's
  `coverage.cobertura.xml`, anywhere in the repo, summed over the modules. A JaCoCo aggregate report stands for the
  modules; `jacoco-it` is left out; each `TestResults` folder counts only its newest run. Istanbul and lcov still
  come first. Nothing runs the suite: the team's own build writes the reports.

### Changed

- **The run cards say more when something fails** (`/quality-code:run-*`, `/quality-code:spec`, and the run log):
  - under the verdict, one line says what it means; a run whose checks fail and whose tests are red says both;
  - "What to do" gives one fix per failing check, not only the first, each test as `file › 'test'` (5 per check,
    then "and N more"; the run log has them all);
  - red tests have their own "Failing tests" block, apart from the fixes to the tests themselves.
  `/quality-code:spec` rewrites tests only for the "What to do" block, never to make a failing test pass.

## [0.33.0] - 2026-10-30

### Changed

- **`/quality-code:ci` writes the CI file with two jobs**, for each pull request (GitHub) or merge request (GitLab):
  - `quality-gate`, git and node only, in seconds: on the changed specs, honesty (no assertion or test removed,
    including a deleted spec or the old path of a renamed one; no skip without a ticket), assertions (every test
    asserts something) and the frozen evals;
  - `quality-tests`: types, tests and mutation on the changed specs, one run per module. A side whose code changed
    but no spec did runs its whole suite without mutation, as does a push to the default branch.
  The file fits the repo: the provider, the toolchain and the install lines (package manager, `prisma generate`,
  Playwright browsers, pip, Go, .NET) are guessed; a project with Testcontainers gets Docker (Docker-in-Docker on
  GitLab, Ryuk off); GitLab retries a dead runner, never a red test, and shows each run in the merge request. A
  project in a subfolder gets its jobs run there. A file Quality Code wrote is replaced, so running it again after
  an update moves the version. `--print` shows the file without writing it.
- **What to do:** if you wrote a CI file with an earlier `--init`, run `/quality-code:ci` again and check the install
  lines. The command no longer runs the tests in the chat; `ci.mjs --init github|gitlab --write`, `--changed`,
  `--suite`, `--flaky` and `--json` are gone. `ci.mjs --tests [--all] [--junit FILE]` is what the tests job runs.

### Added

- `pipeline.mjs --no-mutation` leaves the mutation step out of a run (the CI's whole-suite runs).

## [0.32.0] - 2026-10-30

### Added

- **Plugin-style files for GitHub Copilot, OpenAI Codex, Cursor and Gemini CLI** (AGT-148). `quality-code-mcp --init
  copilot|codex|cursor|gemini [--dir DIR] [--write]` shows, or with `--write` writes, the local MCP config (stdio only)
  and one thin wrapper per command: Copilot prompt files, Codex skills, Cursor commands, a Gemini extension. Each wrapper
  calls the command's MCP tool and follows what it returns, so the instructions stay in the plugin. Nothing is written
  without `--write`, an existing file is never replaced, and the Codex TOML is printed, not written to your home folder.
  `routine` and `check-update` stay Claude-only. Tested as generated files; not yet tried inside the four tools.

## [0.31.0] - 2026-10-30

### Changed

- **`/quality-code:seed` now loads mock data into your local database** instead of writing test data.
  It reads and gates the ticket, finds the tables in your schema, writes a realistic dataset per feature
  (about 25 rows per table, reused by the feature's tickets) plus the ticket's own case, shows the target
  and what the reset empties, and loads only on `1`. The test-data printer (builder calls, route stubs,
  `--path`) is gone.
- Safety: the new `bin/seed.mjs` loader writes only to `localhost`, `127.x.x.x`, `::1` or a container name,
  never in CI, refuses a file that drops, truncates or alters a table, and with `seed.tenant` refuses a
  reset or update that reaches another tenant.

**What to do:** to use it, add `seed.target` and `seed.apply` to `.claude/quality-code.json` (and
`seed.schema`, `seed.tenant` as needed; see `/quality-code:seed`'s "Setting it up"). The old
`seed.builders`, `seed.dataset` and `seed.stubsFrom` are ignored; remove them when convenient.

## [0.30.0] - 2026-10-30

### Changed

- **`/quality-code:check-update` now follows its card with a menu that fits the case** (AGT-147). A new version is out:
  `1. Update to the latest version`, `2. Check the version again`, `3. Stop`. Up to date, ahead, or updated but not loaded
  yet: `1. Check the version again`, `2. Stop`. Option 1 runs `claude plugin update quality-code@teamsystem` (the only
  command besides its own script that it may run) and asks you to type `/reload-plugins`.
- The script also reads the version installed on disk. After an update, checking again says `Version X is installed. Type
  /reload-plugins` (status `reload`) instead of offering the same update again. The card's machine line gains `running`.

## [0.29.0] - 2026-10-30

### Added

- **`/quality-code:check-update`.** Says whether a newer version of the plugin is out. A script reads the installed
  version and the latest one from the plugin's GitHub repository (the git tags when the files cannot be read), lists
  what each newer version changed, and prints the two commands to type: `/plugin update quality-code@teamsystem`, then
  `/reload-plugins`. Read-only: it installs nothing and sends nothing about you or the project. Exit 3 when the latest
  version cannot be read (offline, or no access). Runs on Haiku. No action needed when you update; the MCP server picks the
  command up on its own as `quality_code_check_update` (AGT-146).

## [0.28.1] - 2026-10-29

### Fixed

- A whole-suite run with a ticket (for example `/quality-code:run-backend` on AGT-144) no longer says "not verified": mutation skips the spec files that hold none of the ticket's tests, instead of counting each one as "baseline had no passing test".

## [0.28.0] - 2026-10-29

### Fixed

Everything the fiscal-orchestrator pilot report (0.18.0, a monorepo with co-located specs) and a second pilot asked for (AGT-145):

- **Spec discovery.** Specs next to the code (`*.unit.test.js(x)`) are found by name: the census, `run-backend` and
  `--suite backend` see them (28 of 439 before). A layer may point at `src/` once `boundaries.allow` names the test files
  there; `setup.mjs --detect` reports `colocated` and `--write` with `"colocated": true` wires it. A unit spec inside the e2e
  folder is no longer a Playwright spec "that never ran". The project flow keeps `.unit.test.jsx` as its pattern.
- **Expected check.** It reads only what follows the Then of a one-line Given / When / Then (the WHEN label is an input);
  `--expected` values from the ticket's Notes are honoured; new `expected` config: `aliases`, `ignore`, `fields`.
- **Honesty.** A skip with a condition that reads the environment, or whose reason names an environment variable or the
  ticket under test, is honest.
- **Assertions through page objects** (`page.expectGridVisible()`, `verify…`, `assert…`, and `assertionHelpers`) count.
- **Mutation** says how many mutants were killed and where it could not run, instead of contradicting its own counts.
- **`ticketAnchor: "branch"`**: a spec changed on the branch with no block of the key counts as the ticket's.
- **Red verdict reason.** "For a bug whose fix isn't merged yet, red is the expected result" only for a Bug that is not
  merged or done; a Task, Story or merged ticket gets the right reason.
- **A red Playwright test** shows the failing line, the locator, and the page URL and text when Playwright recorded them
  (`error-context.md`), or how to record them.
- **Screens.** `/quality-code:spec` checks a route against the app's router (`bin/routes.mjs`), names the closest ones,
  and the screen card says how to pass `--route`.
- `consumption` finds sessions that ran at the repo top when `root` is set. `tickets-eval --all` scores every ticket and the
  card says when the rate is only a sample. Setup proposes a workspace as `root` at the top of a monorepo and says what to do
  with the ticket files. The seed guide covers GraphQL apps (stubs keyed by operation name).

### Added

- Config: `expected`, `assertionHelpers`, `ticketAnchor`, `gate` (`omit`, `contextFromIntro`), `roots` (with
  `ticket.mjs root get|set`), `sides.default`.

## [0.27.0] - 2026-10-28

### Added

- **Integration tests on real databases (Testcontainers).** On a Vitest, pytest, Go or .NET backend
  that uses Postgres, MySQL, MongoDB or Redis (found from its drivers, or a Prisma schema) and has no
  Testcontainers yet, `/quality-code:setup` offers to install Testcontainers and write a helper that
  starts the databases in containers. The unit tests keep their mocks. Docker must be running when the
  integration tests run.
  - Vitest: `vitest.integration.config`, a global setup that starts the databases once per run (and
    applies the Prisma schema), and `test/integration/databases` for their addresses.
  - pytest: `tests/integration/conftest.py` with one session fixture per database (`postgres_url`, …).
    Installed with uv or Poetry when the project uses one, else pip.
  - Go: the `internal/testdb` package (`testdb.PostgresURL(t)`, …), with `go get`.
  - .NET: `Integration/TestDatabases.cs` in the test project (`await TestDatabases.PostgresAsync()`,
    …), with `dotnet add package`.
  - JUnit gets nothing from setup: there is no command that adds a dependency to a Maven or Gradle build.
  The Vitest, pytest, JUnit, Go and .NET writing guides now say: in the integration layer of a project
  that runs containers, use the real database, never a mock of it.

## [0.26.0] - 2026-10-28

### Added

- **`/quality-code:routine`: a check Claude runs on a schedule** (AGT-142). Pick a ticket or the whole suite, a
  time (a cron in local time, or one moment) and a period (`--until`). The command creates the schedule with
  Claude's scheduler (a scheduled task; `CronCreate` as a session-only fallback). Each run (`bin/routine.mjs run`)
  fetches the watched branch, reports the new commits and integral changes (`package.json`, lockfiles, runner
  config), runs the ticket's tests or the whole suite, and says REGRESSION, with the commits in between, when
  the last kept result was green and this one is not. No new commit: nothing to check.
- **Stability:** `--stability N` runs every test N times and names the flaky ones. Every run is kept in a local
  history; `/quality-code:routine status` shows the pass rate, the flaky tests seen and green-to-red changes, and
  says STABLE, UNSTABLE or NOT ENOUGH DATA. `list` and `stop` manage the routines.
- `bin/ci.mjs` JSON now lists the flaky tests of each phase.

## [0.25.0] - 2026-10-28

### Changed

- **The generated GitHub and GitLab CI files run all the tests of the test folders** (AGT-141).
  `/quality-code:ci --init github|gitlab` now writes a file that calls `ci.mjs --all`; add `--changed`
  for the variant that runs only what the branch touched. Running `/quality-code:ci` by hand is still
  change-aware. If you already wrote a CI file with 0.24.0, run `--init` again and replace its `ci.mjs`
  line (or add `--all`).

## [0.24.0] - 2026-10-28

### Added

- **`/quality-code:ci` for GitHub Actions and GitLab CI** (AGT-140). A pipeline command (`bin/ci.mjs`, no
  model) that reads what the branch changed against its target and runs only the backend or frontend tests
  that were added or changed, one run per module (a backend layer, an e2e folder). Code changed with no spec
  changed runs that side's whole suite; a shared file (`package.json`, a lockfile, a runner config) runs
  both; docs only is `NOTHING TO TEST` (exit 0). The default branch, `--all` and an unreadable history run
  everything, so nothing is silently left out. `--init github|gitlab [--write]` prints or writes the CI file,
  `--junit FILE` writes a JUnit report for GitLab, and GitHub gets a step summary and error annotations.
  Exit 0 green, 1 a check failed or a test is red, 2 usage or config, 3 not verified. It is also a tool of
  the MCP server.

## [0.23.0] - 2026-10-28

### Added

- **The online MCP server is tested end to end** (AGT-139): a test starts the HTTP server in its own
  process against a mock Entra tenant that serves the signing keys, then connects a real MCP client with a
  bearer token. The signed-in client gets the Jira-only tools and runs a script; forged, wrong-audience
  and expired tokens never connect.
- `QUALITY_CODE_ENTRA_AUTHORITY` sets the login host for a sovereign cloud (default
  `https://login.microsoftonline.com`).

## [0.22.0] - 2026-10-28

### Added

- **One-command install of the local MCP server** (AGT-138). `mcp-server/install.sh` makes the virtual
  environment, installs the server and checks it; `quality-code-mcp --check` checks Python, Node and the
  tools; `quality-code-mcp --print-config` prints the config for Claude Desktop, Cursor and Claude Code
  with this install's own paths.

## [0.21.0] - 2026-10-28

### Added

- **A shared MCP server for QA and PO** (AGT-137). Over HTTP the server offers only the Jira-only
  commands (`ticket`, `ticket-eval`, `tickets-eval`), the read-only scripts they call, and their
  guides; the caller never picks the folder; at most 4 scripts run at once; `/health` answers without
  a token. A `Dockerfile` (non-root, health check) builds it, and CI builds the image and checks it
  starts, answers `/health` and refuses an unsigned request. The local (stdio) server for developers is
  unchanged and still offers everything.

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
