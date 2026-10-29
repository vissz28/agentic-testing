---
description: Set this repo up for quality code. Checks the connectors (Jira, GitLab, Figma), finds where the project lives, its Jira project and its base branch, shows them on one card to confirm, and writes .claude/quality-code.json after you confirm. It does not check any ticket: that is /quality-code:spec. Add "advanced" for feature labels, QA plans, title prefixes, templates and redaction.
argument-hint: [advanced]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: sonnet
---

Set up this repo for the quality-code plugin. Setup asks only where the project lives, then shows what it found on one card to confirm; everything about how tickets are written has defaults, and the acceptance-criteria field is found the first time a ticket is checked with start or ticket-eval. You propose and ask; the scripts detect and write. The **Where** card comes first (in a repo, or no repo for QA and PO); then the connectors, one at a time: the source code connector (repo only), Jira (required), Figma (optional). Besides the connectors, a clean setup takes two answers: the **Where** card and the **Confirm** card. Find every other value yourself and put it on the Confirm card; show another card only where a step below says so. Use short sentences and numbered cards. End your turn after every card and wait for the answer.

**Rules**

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- Never write `.claude/quality-code.json` yourself; only `setup.mjs --write` does. The same goes for the issue templates, the `.gitignore` lines, the Playwright config and smoke test setup adds to a frontend, and the Vitest config it adds to a repo with no tests. The one file setup leaves to you is the sign-in of step 4.
- Jira tools: refer to them by operation name on the Atlassian (Rovo) connector, whichever Atlassian MCP connection is available in this session (the plugin's own or one the user connected in claude.ai). On the claude.ai connector some operations have other names: use the table "Atlassian operation names" in `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md`. If none is connected, step 0's Jira card (in `connectors.md`) says what to do.
- Run `setup.mjs --detect` once. Step 1 already runs it (in `connectors.md`): keep its `SETUP_JSON:` line and the sites `getAccessibleAtlassianResources` returned, and use both in the steps below without calling them again. The one exception is a new project root (step 2's **Project root**).
- Rerun: if `existing` is not null in the detect result, show its current values and start every step from them. The user may change any field.

**Steps**

If `$ARGUMENTS` contains `advanced`, go to **Advanced** below.

0. **Where.** First, before any connector, ask where the user will use Quality Code, as this card, and end the turn:

   ```
   Where will you use Quality Code?
   1. In a repo (developers)
   2. No repo, Jira only (QA, PO)
   ```

1. **Connectors.** Read `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` and follow it. From the plugin settings (each empty when not set): `jira_email` is `${user_config.jira_email}`, `gitlab_username` is `${user_config.gitlab_username}`, `gitlab_api_url` is `${user_config.gitlab_api_url}`. Follow its **Setup: one connector at a time** sequence, not the single card: the source code connector (GitLab, GitHub, both or none), then Jira (required, with your account), then Figma (optional). With `2` on the Where card (no repo), skip the source code card: there is no repo to link; start at Jira. Go on as the Where answer says (below) when the sequence says to continue.

   After the connectors (step 1):

   - **1:** the repo setup: steps 2 to 5 below, as written.
   - **2:** the personal setup, for people who read tickets and have no repo (QA, PO). Read `personal` in the `SETUP_JSON:` line (`path`, `existing`, and `existingError` when the file is broken). Skip step 2 (no project folder, no stack, no base branch, no GitLab). On a rerun (`personal.existing` is not null), show the current personal config and start every step from it. Then do step 3 (the Jira site and project(s), exactly as for a repo). Which tickets the user reads is a value on the Confirm card: `personal.existing.adapter` on a rerun, else both (`"fullstack"`). To change it, show this card and end the turn:

     ```
     Which tickets?
     1. Frontend
     2. Backend
     3. Both
     ```

     `1` gives `adapter: "playwright"`, `2` `"vitest"`, `3` `"fullstack"`. The adapter is used only to score tickets. Then step 4 with the personal rules, and step 5 with the personal done line.
2. **This project.** No card here, except for a repo with no tests or a frontend with no Playwright yet (below): find the values of the Confirm card. Read `adapter`, `scaffold`, `vitestScaffold`, `here`, `base`, `existing` (and `existingError` when the old file is broken) in the `SETUP_JSON:` line.
   - **Project root.** `root.proposed` is not null: the repo's top has no project of its own and the app lives in that subfolder (on a rerun, the config's `root`). The rest of the detect result is already read from it. The config gets `"root": "<root.proposed>"`: it is still written at the top, every script and the boundary hook work in the subfolder, and every other path in the config is relative to it. Ask nothing now. To change it from the Confirm card, list `root.candidates` (`<n>. <folder>`) plus `<n>. The repo's top` and end the turn; then run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --detect --root <folder>` (`.` for the top), keep its `SETUP_JSON:` line in place of the old one, and redo step 2 from it.
   - `adapter`, `scaffold` and `vitestScaffold` are all null: stop with `This stack is not supported yet (Playwright or Cypress; for the backend Vitest, Jest, Mocha, node --test, pytest, JUnit, Go or .NET).`
   - **No tests yet.** `vitestScaffold` is not null: this repo has no test runner, and it is not a frontend alone (a backend, a library, or a frontend with its server). Setup can add Vitest for the tests of its code. With `vitestScaffold.problem`, say it: setup cannot add Vitest now, and goes on as on `2` (`Not now`) below; with `scaffold` too, the Playwright card below then adds Playwright alone, and the stack is `fullstack` all the same. With `scaffold` too and no problem, the repo is a frontend with its server: the Playwright card below adds both. Otherwise show this card and end the turn (with `vitestScaffold.files` empty, the Writes line is `nothing: the Vitest config is there`):

     ```
     This repo has no tests yet. Setup can add Vitest:
       Installs  <vitestScaffold.install>
       Writes    <vitestScaffold.files, comma-separated>
     1. Add Vitest
     2. Not now
     ```

     - **1:** the stack is `vitest`. Keep `vitestScaffold: true` for the Confirm card and step 4.
     - **2:** the stack is `vitest` all the same, and nothing is installed: setup still writes the config, so tickets can be checked, and `/quality-code:spec` says how to add Vitest before it writes a test.
   - **No Playwright yet.** `scaffold` is not null: this frontend has no Playwright config, and no Playwright either when `scaffold.install` is set. It may already have Vitest (`adapter` `vitest`) for its unit tests. Setup can add them. With `scaffold.problem`, say it, then go on as on `4` (`Not now`) below. When `scaffold.command` is null, ask `Which command starts the app? For example npm run dev.`; when `scaffold.url` is null, ask `At which address does <command> open the app? For example http://localhost:3000.`; end the turn after each. A command is one line; an address starts with `http://` or `https://`. Then show this card and end the turn (with `scaffold.install` null, the Installs line is `the Chromium browser`). With `vitestScaffold` too (and no `vitestScaffold.problem`), the card adds both: its first line is `This repo has no tests yet. Setup can add Vitest for the backend and Playwright for the frontend:`, the Installs line starts with `<vitestScaffold.install>; `, the Writes line with `vitestScaffold.files`, and `1` and `2` read `Add both` in place of `Add Playwright`:

     ```
     This frontend has no Playwright tests yet. Setup can add them:
       Installs  <scaffold.install>, and the Chromium browser
       Writes    <scaffold.files, comma-separated>
       App       <command> at <url>
     1. Add Playwright: the app has no sign-in
     2. Add Playwright: the app has a sign-in
     3. Change the command or the address
     4. Not now
     ```

     - **1**, **2:** the stack is `playwright`; when `adapter` is `vitest` or `both`, the repo then has both runners: propose `fullstack`, as **Stack** below does for `both`, with its card to change it (`3. Backend only: Vitest` there also drops the Playwright setup would add, and `2. Frontend only` the Vitest). With `vitestScaffold`, the stack is `fullstack`: keep `vitestScaffold: true` too, unless it has a problem. Keep `scaffold: { command, url, signIn }` for the Confirm card and step 4, `signIn` true on `2`.
     - **3:** ask which, and its new value, then show this card again.
     - **4:** with `adapter` `null`, the stack is `playwright` (`fullstack` with `vitestScaffold`) all the same, and nothing is installed: setup still writes the config, so tickets can be checked, and `/quality-code:spec` says how to add the runners before it writes a test. Otherwise go on without Playwright (a `vitest` repo stays `vitest`).
   - **Real databases.** `containersScaffold` is not null: this backend (Vitest, pytest, Go or .NET; on Vitest also the one setup adds) uses `containersScaffold.databases` and has no Testcontainers yet. Setup can add a helper that starts them in containers, so the integration tests run against real databases while the unit tests keep their mocks. With `vitestScaffold` and `2` (`Not now`) on its card, skip this. With `containersScaffold.problem`, say it and go on without it. Otherwise show this card and end the turn, `<databases>` being the names joined with `and` (`postgres` reads Postgres, `mysql` MySQL, `mongodb` MongoDB, `redis` Redis), with a last line `  Note      <containersScaffold.note>` above the options when it has one:

     ```
     This backend uses <databases>. Setup can run its integration tests against real ones, in containers:
       Installs  <containersScaffold.install>
       Writes    <containersScaffold.files, comma-separated>
       Needs     Docker running when the tests run
     1. Add real databases
     2. Not now
     ```

     - **1:** keep `containersScaffold: true` for the Confirm card and step 4. On a Vitest backend, when `vitestScaffold` is null (the repo already runs Vitest), say `Your own Vitest run also picks up the specs in <containersScaffold.folder>: add '<containersScaffold.folder>**' to its exclude, or they fail there without their databases.`
     - **2:** go on without it.
   - **Runner.** `runners` in the detect result names the repo's own runner when it is not Vitest or Playwright: `unit` (`jest`, `mocha`, or `node` for Node's own `node --test`, found from a script that runs it) for the tests of the code, `e2e` (`cypress`) for the tests of screens. The plugin writes and checks the tests in that runner, with the generic checks; Vitest and Playwright keep the specialized ones. Put it in the config as `runners` and show it on the Stack line. Ask nothing. `unit` comes only with a JavaScript backend (`backend` `vitest`): pytest, JUnit, Go and .NET run their own tests.
   - **Stack.** `vitest` or `playwright`, or another backend runner (`pytest`, `junit`, `go`, `dotnet`): that one. `backend` in the detect result names the backend runner; `<Runner>` below is its name: Vitest, pytest, JUnit, Go or .NET. `both` (the repo has Vitest and Playwright, or another backend runner and Playwright): propose `fullstack`, with `"backend": "<backend>"` when `backend` is not `vitest`, or `existing.adapter` (and `existing.backend`) on a rerun. Ask nothing now; to change it from the Confirm card, show this card and end the turn:

     ```
     This repo has both <Runner> and Playwright.
     1. Fullstack: backend tests with <Runner>, frontend tests with Playwright
     2. Frontend only: Playwright
     3. Backend only: <Runner>
     ```

     `1` gives `adapter: "fullstack"` (plus `backend` when it is not `vitest`), `2` `"playwright"`, `3` `"<backend>"`.
   - **Tests next to the code.** `colocated` in the detect result is not null: most of the project's tests sit beside its code (`colocated.pattern`, `colocated.specs` files) and the code folder is protected, so no run could find or write them. Ask nothing: put `"colocated": true` in the proposal, next to `config`: the write finds those tests and lets a run write their names, in one step, keeping what `existing` already has. Show one line on the Confirm card: `Tests     beside the code (<colocated.pattern>): <colocated.specs> files in <colocated.layer.folder>`.
   - **Test flow.** `conventions.specs` in the detect result is above 0: the project already has tests (`conventions.pattern`, in `conventions.folders`). Ask nothing now: propose `testFlow: "project"` (`existing.testFlow` on a rerun) and show it on the Confirm card as `Tests`. To change it from the Confirm card, show this card and end the turn:

     ```
     This project already has <conventions.specs> tests (<conventions.pattern>, in <conventions.folders>).
     1. Follow your project's flow: new tests use your naming, folders and style
     2. Use Quality Code's flow: the ticket key in the file name, Quality Code's test folders
     ```

     `1` gives `testFlow: "project"`, `2` `"quality-code"`. With `conventions.specs` 0, leave `testFlow` out of the config and the card (Quality Code's flow is used until the project has tests; `/quality-code:config` changes it later).
   - **GitLab project.** If GitLab is connected and `here.gitlab` is not null, look the project up by its path with one read-only GitLab call. Not found: show it on the card as `<path> not found on <host> (check gitlab_api_url)`; it never blocks. The GitLab project is read from the remote every time; it is not written to the config.
   - **Base branch** (`git.base`: the branch feature branches start from and merge into; start, spec and check diff against it). On a rerun, keep `existing.git.base` when it is set. Else, when the GitLab project was found, make one read-only GitLab call for its 20 most recently merged merge requests and propose their most common target branch (from `recent merge requests`). Else propose `base.proposed` from the detect result: `base.source` `develop` reads `from origin/develop`, `origin-head` reads `from origin/HEAD`. When `base` is null and nothing else proposes one, leave `git.base` out and show `none found (main or master at run time)`.
3. **Jira.** Using the Atlassian connector. No card when the values are clear:
   - **Site.** From the sites of step 1. On a rerun, keep `existing.jira.site` when it is one of them. Else, when there is exactly one site, use it and ask nothing. With several, show them as a numbered list (`<n>. <site URL>`) and end the turn; the pick is the site. The site is an `https://` URL with no path. Only Atlassian Cloud sites work (the ones `getAccessibleAtlassianResources` lists): when the team's Jira is a Server or Data Center site, say `quality-code needs Jira Cloud: the Atlassian connector cannot reach <site>.` and stop. When a Jira tool needs a `cloudId`, pass the hostname of the site (for example `example.atlassian.net`, no `https://`).
   - **Project.** On a rerun, keep `existing.jira.projects`. Else read `projectCandidates` in the detect result: the project keys named by this repo's branch names and recent commit subjects, most frequent first. Check the first one with one `getVisibleJiraProjects` call with `searchString` `<KEY>`: it exists when a returned project's key is exactly `<KEY>`. It exists: it is the project, ask nothing. It does not: check the next one, at most 3 calls in all. No candidate exists, or there is none: show the project card.
   - **The project card.** Call `getVisibleJiraProjects` once with `maxResults` 21 and no `searchString`. 20 projects or fewer: show them as a numbered list (`<n>. <KEY>  <name>`), plus a last line `<n>. Type a project key`, and end the turn; the user picks by number, several allowed. More than 20 (a large site can have hundreds): never list them; ask `Which Jira project? Type its key (for example ABC).` and end the turn. A typed key: upper-case it and check it with one `getVisibleJiraProjects` call with `searchString` `<KEY>` (exists when a returned project's key is exactly `<KEY>`). It does not exist: say `<KEY> does not exist on <site host>, or this account cannot see it.`, ask for the key again and end the turn. The picked or typed keys become `jira.projects`.
   - Ask nothing else: no criteria field, labels, prefixes, languages or templates.
4. **Confirm.** Show everything on one card, with the config as it will be written, and end the turn. Leave out each `Adds` line unless setup adds that runner (step 2's cards, `1` or `2`), and `(subfolder …)` when `here.subfolder` is null (with `root.proposed`, it reads `(project root, in <here.repoTop>; the config stays at the top)`); write `Remote   none` when `here.remote` is null; add the line `  <path> not found on <host> (check gitlab_api_url)` under Remote when the GitLab lookup did not find it.

   ```
   Quality Code setup
     Folder   <here.folder>   (subfolder <here.subfolder> of <here.repoTop>)
     Remote   <here.remote.path> on <here.remote.host> (<here.remote.kind>)
     Stack    <frontend (Playwright) | backend (<Runner>) | fullstack (<Runner> and Playwright), from adapter and backend; a runner of `runners` in place of its default, with `generic checks`, for example `backend (Jest, generic checks)`>
     Adds     Vitest: <vitestScaffold.files, comma-separated>
     Adds     Playwright: <scaffold.files, comma-separated>; app <command> at <url>; sign-in <yes | no>
     Adds     Real databases (<databases>): <containersScaffold.files, comma-separated>; integration tests in <containersScaffold.folder; left out when it is null (Go: the tests stay beside the code)>
     Tests    <follow your project's flow (<conventions.pattern>) | Quality Code's flow>
     Jira     <site host>, project(s) <keys>
     Base     <branch>   (from <where it was found>)
   Writes .claude/quality-code.json:
   <the config JSON>
   1. Write it
   2. Change something
   3. Cancel
   ```

   The config is `version: 1`, `root` (only with `root.proposed`), `adapter`, `backend` (only for `fullstack` with a backend runner other than Vitest), `runners` (only when the detect result has one), `testFlow` (only when the project has tests), `jira { site, projects }` and `git { base }` (left out when no base was found). On a rerun, keep every other field of `existing` unchanged in it (labels, prefixes, templates and the rest stay as they were).

   - **Personal setup (option 2):** the card has no Folder, Remote, Stack or Base line, and shows `Tickets  <frontend | backend | both>` under Jira; in place of the `Writes` line it says `Saved in <personal.path>; no repo file is touched.` On **1**, build the proposal `{ "scope": "personal", "config": { "version": 1, "adapter": …, "jira": { site, projects } } }`, keeping every other field of `personal.existing` on a rerun, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --write-personal '<proposal JSON>'` (inline, as below). It writes only the personal file (never `.gitignore`, templates or any repo file). Errors, `2` and `3` work as below.
   - **1:** when setup adds Vitest, Playwright or real databases, do **Adding the runners** below first, up to the write. Build the proposal `{ "config": { … } }` from the config on the card. Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --write '<proposal JSON>'`: the JSON inline as one single-quoted argument, no temp file (write a `'` inside a value as `'\''`). If it prints errors, show them as they are and go back to step 4 with a fix. On `ok`, go on.
   - **Adding the runners** (step 2's cards, `1` or `2`). On the Confirm card's `1`, before the write, say `Installing <Vitest | Playwright | Vitest and Playwright>; this can take a minute.` and run `vitestScaffold.install` when setup adds Vitest, then `containersScaffold.install` when it adds real databases, then, when it adds Playwright, `scaffold.install` when it is set and `scaffold.browsers`; each as one command exactly as detect gave it (they download, and ask for permission). If any fails, show its last lines and stop: nothing is written. Then add `"vitestScaffold": true` (adding Vitest), `"containersScaffold": true` (adding real databases) and `"scaffold": { "command", "url", "signIn" }` (adding Playwright) to the proposal, next to `config`: `--write` also writes the files of the `Adds` lines, adds the integration tests in `containersScaffold.folder` to the config (real databases; on Vitest with their own Vitest config), and `.gitignore` lines for Playwright's output (with a sign-in, also for `playwright/.auth/` and `.env.e2e`). It never replaces a file. On `ok`, when setup added Playwright:
     - **Unit runner** (only when `adapter` was `vitest` or `both`: the repo already runs Vitest, Jest, Mocha or node --test). Run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --unit-overlap`. Exit 0: go on. Exit 2: show its line and go on. Exit 1: the team's own unit test run would also pick up the Playwright specs it lists, and fail on them (Playwright's `test()` runs only under Playwright). Show this card and end the turn, `<runner>` being the runner its first line names:

       ```
       Your <runner> run would also run the Playwright specs in e2e/, and fail on them.
       1. Keep e2e/ out of <runner>: add it to the exclude in <its config>
       2. Leave it
       ```

       `<its config>` is the file the runner reads. **Vitest:** `vitest.config.*`, else `vite.config.*`, else a new `vitest.config.<ts or js>`. On `1`, add `'e2e/**'` to its `test.exclude`, after `...configDefaults.exclude` (imported from `vitest/config`) so Vitest's own defaults stay; when `test.exclude` is there, add only `'e2e/**'` to it. A `vite.config.*` with no `test` block gets one (in TypeScript with `/// <reference types="vitest/config" />` at the top). A new file is `import { configDefaults, defineConfig } from 'vitest/config'` and `export default defineConfig({ test: { exclude: [...configDefaults.exclude, 'e2e/**'] } })`. **Jest:** `jest.config.*`, else the `jest` key of `package.json` (add one when there is none). On `1`, set `testPathIgnorePatterns` to `['/node_modules/', '<rootDir>/e2e/']`, keeping Jest's own `/node_modules/`; when it is there, add only `'<rootDir>/e2e/'` to it. Change nothing else in the file. Then run `--unit-overlap` again: exit 0, say `<runner> now leaves e2e/ to Playwright.`; otherwise show its lines and say `<runner> still picks them up: keep e2e/ out of it by hand.` On `2`, say `Your <runner> run fails on the specs in e2e/ until e2e/ is in its exclude.` Either way, go on.
     - **Sign-in** (`signIn` true). Write `e2e/auth.setup.<ts or js>` yourself, with the smoke test's extension: only the app's code says how it signs in. Read the app's sign-in screen (read-only, never shown in the chat) for its route and the real labels of its fields and button. A user-and-password form: fill it from `process.env.E2E_USERNAME` and `process.env.E2E_PASSWORD`, and throw `Set E2E_USERNAME and E2E_PASSWORD in .env.e2e` when either is missing. Anything else (single sign-on, a token, a dev switch): ask `How does a tester sign in when the app runs locally? Describe it in a few words.`, end the turn, and write what the answer says. The file imports `{ test as setup, expect }` from `@playwright/test` and holds one `setup('sign in', async ({ page }) => { … })` that signs in, waits with an `expect` until the app is past its sign-in page, and ends with `await page.context().storageState({ path: 'playwright/.auth/user.json' })`. Never ask for a password or a token in the chat, and never write one in a file. When the file reads the two variables, show this card and end the turn:

       ```
       The sign-in reads E2E_USERNAME and E2E_PASSWORD from .env.e2e, which git ignores. Put a test user's there, then:
       1. Run the smoke test
       2. Later
       ```

       On `2`, say `/quality-code:spec runs the smoke test first, until it passes.` and go to step 5.
     - **Smoke test.** Say `Starting the app for the smoke test; this can take a minute.`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --smoke` and show its line. Exit 0: go to step 5. Exit 1: the setup does not work yet, and tests written now would fail on it, not on the app. Show this card and end the turn:

       ```
       1. Run the smoke test again
       2. Stop here
       ```

       On `1`, run it again: the user fixed what the line says, or you fix the sign-in file you wrote (never the app's code or the Playwright config). On `2`, say `The setup is written. /quality-code:spec runs the smoke test first, until it passes.` and go to step 5.
   - **2:** ask only which value to change, as this card, and end the turn (Stack only when `adapter` is `both`, or setup adds Playwright to a `vitest` repo, or adds both; Project root only when `root.candidates` is not empty; Test flow only when `conventions.specs` is above 0; for a personal setup, `Tickets` in place of Stack, and no Base or Project root):

     ```
     Change what?
     1. Stack
     2. Jira site
     3. Jira project
     4. Base branch
     5. Project root
     6. Test flow
     ```

     The user may type the new value with the number (for example `4 main`); then use it as it is. Else ask only for that value: Stack shows the both card of step 2, Tickets the tickets card of step 0's personal setup, the site the sites as a numbered list plus `<n>. A different site` (a typed site follows step 3's site rules), the project the project card of step 3, and the base `Which base branch? Type its name (for example develop).` A base is a branch name with no spaces that does not start with `-`. Then show the Confirm card again with the new value and end the turn. Project root follows step 2's **Project root**; Test flow shows step 2's test flow card. Ask nothing else again.
   - **3:** stop. Nothing is written.
5. **Done.** For a personal setup say only: `Setup is done: Jira <site host>, project(s) <keys>, tickets <frontend|backend|both>. Saved in <personal.path>. Check any ticket from any folder: /quality-code:ticket-eval <KEY>, or a whole project: /quality-code:tickets-eval <PROJECT>. Writing tests needs a repo: run /quality-code:setup there.` Otherwise: setup only configures. Do not read, score or comment on any ticket here: checking tickets is the job of `/quality-code:spec`, and the first ticket checked there also finds the project's acceptance-criteria field. Say: `Setup is done: <adapter>, Jira <site host>, project(s) <keys>, base <branch>. Commit .claude/quality-code.json. The ticket files (.quality-code/tickets/<KEY>/ticket.json, run.md) and the Xray CSV are left for your team to decide: commit them to share the reports, or add .quality-code/ to .gitignore. Every day, from your feature branch: /quality-code:spec. For any ticket: /quality-code:spec <KEY>, or /quality-code:spec <KEY> --gate-only for the readiness check alone. For feature labels, QA plans, title prefixes, templates and redaction: /quality-code:setup advanced.` When setup added Playwright, say `Commit .claude/quality-code.json, the Playwright files, .gitignore, package.json and its lockfile.` (adding `, and the <runner> config` when the unit runner card changed it, or `, and the Vitest config` when it added Vitest too) in place of `Commit .claude/quality-code.json.`; when it added Vitest alone, `Commit .claude/quality-code.json, the Vitest config, package.json and its lockfile.` When it added real databases, add `, and the integration files (<containersScaffold.files, comma-separated>)` before the final period (alone: `Commit .claude/quality-code.json, <containersScaffold.files, comma-separated>, and the files the install changed (<package.json and its lockfile | pyproject.toml and its lockfile | go.mod and go.sum | the test project's .csproj>).`, the one of the backend; with pip, `the requirements your tests install`). After `Not now` on a repo with no tests, add: `/quality-code:spec needs a test runner: run /quality-code:setup again to add it.`

## Advanced

`/quality-code:setup advanced` adds the questions the short setup leaves to defaults. It needs a config: without one, run steps 0 to 4 first. Run `setup.mjs --detect` and start every step from the current config.

A1. **Other projects to track.** Ask once whether any other projects should be tracked (`jira.trackingProjects`, optional; skip on no).
A2. **Features.** In a Jira project shared by many teams, most recent tickets carry other teams' labels. Before counting, ask how to narrow the search, as a numbered card, and end the turn:

   ```
   1. All recent tickets of the project
   2. Only tickets with a word in the title
   3. Only one component
   4. I'll type my labels
   ```

   In every value the user types into a JQL query (the title word, a component name, a label), escape `\` as `\\` and `"` as `\"` first.

   - **1:** the JQL is `project = <KEY> ORDER BY created DESC`.
   - **2:** ask for the word and keep letters, digits and spaces only; the JQL is `project = <KEY> AND summary ~ "<word>" ORDER BY created DESC`.
   - **3:** list the project's components: call `searchJiraIssuesUsingJql` with `project = <KEY> ORDER BY created DESC`, `maxResults` 100, fields `components`, and show the distinct component names as a numbered list, plus a last line `<n>. Type a component name` (with no components, ask the user to type it). The JQL is `project = <KEY> AND component = "<component>" ORDER BY created DESC`.
   - **4:** ask for the labels as a comma-separated list. For each label, check that it exists with one `searchJiraIssuesUsingJql` count query, `project = <KEY> AND labels = "<label>"` with `searchResultMode` `count`. Warn about the unknown ones (count 0) by name and ask whether to keep them, drop them or retype them. The kept labels are the picks; skip the counting below.

   For 1 to 3, call `searchJiraIssuesUsingJql` with that JQL, `maxResults` 100, fields `labels,summary` only. Count the labels and show them with their counts as a numbered list; the user picks by number. If the list holds none of the team's labels, offer the card again.

   Each pick becomes `{ "label": "<label>" }`. For `playwright` and `fullstack`, also propose a `route` per label from the app's router files (read-only; start with the router config) or ask the user for it. Routes start with `/`: the path the app's router uses (for example `/orderHistory`), not a folder name. For `playwright` and `fullstack`, also propose a `qaPlanSearch` per picked label (the search text used to find that feature's Confluence QA plan): the label with `_` and `-` replaced by spaces (for example `order_history` becomes `order history`), because Confluence's text search finds nothing for a word joined by `_`. Let the user change it or clear it. Add both to the feature: `{ "label", "route", "qaPlanSearch" }`. For `vitest`, neither is needed.
   - **Confluence spaces** (only for `playwright` and `fullstack`). On a Confluence site shared by many teams, other teams' pages can rank first. Run ONE `searchConfluenceUsingCql` with `text ~ "<first proposed qaPlanSearch>" AND type = page` (escape `\` and `"` in the text first). List the distinct spaces of the hits (key and name) as a numbered card, plus a last line `<n>. All spaces`, and end the turn. The user may pick several numbers. The picked keys become `confluenceSpaces` (for example `["ABC"]`). `All spaces`, or no hits, leaves `confluenceSpaces` out: the QA-plan search then looks in all spaces.
   - **QA-plan check** (only for `playwright` and `fullstack`). Run ONE `searchConfluenceUsingCql` per feature with its `qaPlanSearch`, scoped to the picked spaces: the CQL `/quality-code:ticket-eval` uses (`text ~ "<qaPlanSearch>" AND type = page`, plus `AND space in ("<K1>","<K2>")` when spaces were picked; escaped the same way). For the first feature with all spaces, reuse the hits of the spaces search. If a hit's title contains all the words of `qaPlanSearch` (ignoring case, matched the same way as in ticket-eval: a title word starts with each search word), keep the search text. If no hit's title contains all the words (for example the label is in one language and the page titles in another), show up to 5 hit titles as a numbered card, plus `<n>. Type other search words` and `<n>. No QA plan for this feature`, and end the turn. Picking a title proposes search words taken from that title (its feature words, for example `order history` from "QA plan - Order history"); the user confirms or edits them. Typed words replace the search text as they are. `No QA plan for this feature` removes its `qaPlanSearch`. Do not search again for that feature.
   - **Title prefixes** (only for `vitest` and `fullstack`). In the summaries of the same narrowed search (after option 4, of one `project = <KEY> AND labels in ("<label>", …) ORDER BY created DESC` search with the kept labels, `maxResults` 100, fields `labels,summary`), count each bracket prefix matched by `^\[([^\]]+)\]` (for example `[API] …` counts `API`). Show them with their counts as a numbered list, plus a last line `<n>. None`; the user picks by number. The picks become `titlePrefixes`, in the order picked. `None` writes `"titlePrefixes": []`: no title prefix is asked for and it never scores. Left out, it defaults to `[]` (none). For `playwright`, leave it out.
   - **Ticket sides** (only for `fullstack`). A fullstack project writes Vitest tests for a backend ticket, Playwright tests for a frontend ticket, and both for a fullstack one. The side comes from the ticket's title prefix or a label: by default `[FE]`, `[BE]` and `[FS]`. From the prefix counts above, propose `sides: { "frontend": [...], "backend": [...], "fullstack": [...] }` with the prefixes that name each side (no brackets), or keep the defaults (then leave `sides` out). A ticket with no mark is scored for both sides, and `write` asks which side to test.
A3. **Language and redaction.** Start from the current languages (English unless the config says otherwise). Propose `["en"]`, adding `"it"`, if the summaries from A2 are in Italian or the user says the tickets are written in Italian (for example with "Criteri di accettazione" sections); when the summaries do not tell, ask once. Customer-id redaction stays on by default; ask once for optional extra patterns (name to regular expression). Whenever the proposal contains `redact`, it must always include `"customerId": "\\bU\\d{5,}\\b"` (written exactly so in JSON), because a `redact` in the config replaces the default. Leave it out only if the user explicitly turns customer-id redaction off; with no extra patterns and redaction left on, omit `redact` entirely.
A4. **Templates.** If `templates.bug` and `templates.story` are both found, say so and move on. If one is missing, offer the plugin's standard template for it (generic English: Story has a user story, context, Acceptance criteria with a Gherkin example and a plain-language example, and an environment section; Bug has steps to reproduce, expected, actual, Acceptance criteria with a Gherkin and a plain-language example, and environment). Ask `1. Add it / 2. Skip`. On a yes, read the file from `${CLAUDE_PLUGIN_ROOT}/templates/story.md` or `${CLAUDE_PLUGIN_ROOT}/templates/bug.md` and pass its exact text in the proposal as `templates.story` / `templates.bug`. Never draft or edit template text yourself. `setup.mjs --write` writes the file; you never do.

   **Paths a test run must never change.** Show `boundaries` from the detect result as a numbered list (they exist in this repo: application code, environment files, the CI file), then this card and end the turn:

   ```
   1. Keep this list
   2. Add a path
   3. Remove a path
   ```

   If `existing.boundaries` is set (a rerun), show it first and keep it as it is: every path, every `why` text and every `allow` pattern. Offer the paths detected in this repo only as additions the user may accept, never as a replacement list. If the user removes every forbidden path but keeps an `allow` list, write `boundaries: { "allow": [...] }` with no `forbidden` (the plugin then uses its default forbidden paths together with the `allow` list).

   A path is a folder ending in `/` (`src/`), an exact file (`.env`) or a pattern with `*` / `**`. Repeat the card until the user keeps the list. For `vitest` with `specsBesideCode` true, also ask once: `Do your specs live next to the code (src/**/*.spec.ts)? 1. Yes / 2. No`; a yes adds `"allow": ["src/**/*.spec.ts"]`. Put the result in the proposal as `boundaries: { "forbidden": [{ "path": "<p>" }, …], "allow"?: [...] }`. An empty list leaves `boundaries` out (the plugin then uses its defaults). `dist/`, `node_modules/`, `.git/` and the config file are always protected; do not list them.

   **Where Playwright runs.** Only for `playwright` and `fullstack`, and only when `playwrightConfigs` from the detect result has a config that is not at the root (Playwright finds only a root one by itself). Propose `playwright: { configs: [{ "match": "<the config's folder>/**", "config": "<its path>" }] }`; the e2e folder is then that config's `testDir` (`folder` in the detect result), so leave `playwright.folder` out. With a config at the root, skip this card. Keep the rest of an existing `playwright` block as it is. With no config at all (`playwrightConfigs` is empty), say once and go on: `No Playwright config found. The tests need one with a baseURL, and a webServer or the app already running: npm init playwright@latest creates it.`

   **Which Vitest config runs which tests.** Only for `vitest` and `fullstack`, and only when `vitestConfigs` from the detect result has more than one entry. Show the configs as a numbered list. For each config ask which folder or pattern it runs (`Which tests does <config> run? A folder ending in /, an exact path, or a * / ** pattern`). Put the answers in the proposal as `vitest: { configs: [{ match, config }, …] }`, where `match` is the folder or pattern and `config` is the config file. If `existing.vitest` is set (a rerun), show its `configs` first, keep the existing `vitest` block as it is (including `tsconfig` and `timeoutSeconds`) and offer only the changes. With one config or none, skip this card; the plugin then uses that config, or Vitest's defaults.

   **Test folders.** Only for `vitest` and `fullstack`. Propose the test layers from `specFolders` in the detect result (the folders that already hold specs): one layer per folder, named after its last segment (`test/unit/` becomes `unit`, `test/integration/` becomes `integration`), lower-case letters, digits and `-` only, starting with a letter, each name used once. With no `specFolders`, propose `[{ "name": "unit", "folder": "test/" }]`. For `fullstack`, leave out the e2e folder (the Playwright tests'): its specs run under Playwright. Show the layers as a numbered list (`<name>   <folder>`), then this card and end the turn:

   ```
   1. Use these test folders
   2. Change a test folder
   3. Skip
   ```

   - **1:** put the list in the proposal as `vitest: { layers: [{ "name", "folder" }, …] }`, at most 5 layers.
   - **2:** ask which layer to change, add or remove, and its name, its folder (relative, ending in `/`) and, optionally, a `guide` (a `.md` file with the team's own test conventions). Show the card again.
   - **3:** leave `layers` out (the plugin then uses one `unit` layer in `test/`).

   If `existing.vitest.layers` is set (a rerun), show it first and keep it; offer the detected folders only as additions. A layer folder inside a forbidden boundary (for example `src/`) is refused by `setup.mjs --write`; do not propose one. Keep the rest of the `vitest` block as it is.

A5. **Preview and write.** Show the full config as it will be written (for `vitest` and `fullstack` this includes `titlePrefixes`, even when it is `[]`; for `playwright` and `fullstack` each feature's `qaPlanSearch` and `confluenceSpaces`, or `confluenceSpaces: all spaces` when it is left out; for `fullstack` the `sides`, or `sides: [FE] [BE] [FS]` when it is left out; and `boundaries` when any path was kept), then this card and end the turn:

   ```
   1. Write it
   2. Change something
   3. Cancel
   ```

   - **1:** build the proposal `{ "config": { … }, "templates": { … } }` (omit `templates` if none were accepted; the config is the current one with the answers of A1 to A4 merged in: `version: 1`, `adapter`, `jira { site, projects, trackingProjects? }`, `languages`, `features`, for `vitest` and `fullstack` `titlePrefixes`, for `playwright` and `fullstack` `confluenceSpaces` when spaces were picked and `playwright` `configs` when the Playwright card was answered, for `fullstack` `sides` when they differ from the defaults, `vitest` `configs` when the Vitest configs card was answered, `vitest` `layers` when the test folders were accepted, and `boundaries` when any path was kept). Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --write '<proposal JSON>'` as in step 4. If it prints errors, show them as they are and go back to A5 with a fix. On `ok`, say that the advanced setup is done.
   - **2:** ask which part to change, redo that step, show the preview again.
   - **3:** stop. Nothing is written.
