---
description: Set this repo up for quality code. Checks the connectors (Jira, GitLab, Figma), confirms where the project lives and which Jira project it uses, and writes .claude/quality-code.json after you confirm. It does not check any ticket: that is /quality-code:start and /quality-code:ticket-eval. Add "advanced" for feature labels, QA plans, title prefixes, templates and redaction.
argument-hint: [advanced]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: sonnet
---

Set up this repo for the quality-code plugin. Setup asks only for the connections and where the project lives; everything about how tickets are written has defaults, and the acceptance-criteria field is found the first time a ticket is checked with start or ticket-eval. You propose and ask; the scripts detect and write. Use short sentences and numbered cards. End your turn after every card and wait for the answer.

**Rules**

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- Never write `.claude/quality-code.json` yourself; only `setup.mjs --write` does. The same goes for the issue templates and the `.gitignore` lines.
- Jira tools: refer to them by operation name on the Atlassian (Rovo) connector, whichever Atlassian MCP connection is available in this session (the plugin's own or one the user connected in claude.ai). On the claude.ai connector some operations have other names: use the table "Atlassian operation names" in `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md`. If none is connected, step 0's Jira card (in `connectors.md`) says what to do.
- Rerun: if `existing` is not null in the detect result, show its current values and start every step from them. The user may change any field.

**Steps**

If `$ARGUMENTS` contains `advanced`, go to **Advanced** below.

0. **Connectors.** Read `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` and follow it. From the plugin settings (each empty when not set): `jira_email` is `${user_config.jira_email}`, `gitlab_username` is `${user_config.gitlab_username}`, `gitlab_api_url` is `${user_config.gitlab_api_url}`. Go on to step 1 only when its card lets you continue.
1. **This project.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --detect` and read the `SETUP_JSON:` line (`adapter`, `here`, `existing`, and `existingError` when the old file is broken).
   - `adapter` is `null`: stop with `This stack is not supported yet (v1: Playwright, Vitest, or both).`
   - `adapter` is `both` (the repo has Vitest and Playwright): ask what the project is, as this card, and end the turn:

     ```
     This repo has both Vitest and Playwright.
     1. Fullstack: backend tests with Vitest, frontend tests with Playwright
     2. Frontend only: Playwright
     3. Backend only: Vitest
     ```

     `1` gives `adapter: "fullstack"`, `2` `"playwright"`, `3` `"vitest"`.
   - If GitLab is connected and `here.gitlab` is not null, look the project up by its path with one read-only GitLab call. Not found: show it on the card as `<path> not found on <host> (check gitlab_api_url)`; it never blocks.
   - Show this card and end the turn (leave out `(subfolder …)` when `here.subfolder` is null; write `no GitLab remote` when `here.gitlab` is null):

     ```
     This project
       Folder   <here.folder>   (subfolder <here.subfolder> of <here.repoTop>)
       Stack    <frontend (Playwright) | backend (Vitest) | fullstack (Vitest and Playwright), from adapter>
       GitLab   <here.gitlab.path> on <here.gitlab.host>
     1. Yes, this is it
     2. Stop
     ```

     The GitLab project is read from the remote every time; it is not written to the config.
2. **Jira.** Using the Atlassian connector:
   - Call `getAccessibleAtlassianResources`, then confirm the site URL with the user (`1. Use <site>` / `2. A different site`). The site is an `https://` URL with no path. Only Atlassian Cloud sites work (the ones `getAccessibleAtlassianResources` lists): when the team's Jira is a Server or Data Center site, say `quality-code needs Jira Cloud: the Atlassian connector cannot reach <site>.` and stop. When a Jira tool needs a `cloudId`, pass the hostname of the site (for example `example.atlassian.net`, no `https://`).
   - Call `getVisibleJiraProjects`. Show the projects as a numbered list; the user picks by number. Their keys become `jira.projects`.
   - Ask nothing else: no criteria field, labels, prefixes, languages or templates.
3. **Preview.** Show the config as it will be written, then this card and end the turn:

   ```
   1. Write it
   2. Change something
   3. Cancel
   ```

   - **1:** write the proposal to a temp file as `{ "config": { … } }` with `version: 1`, `adapter` and `jira { site, projects }`. On a rerun, keep every other field of `existing` unchanged in it (labels, prefixes, templates and the rest stay as they were). Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --write @<tmp proposal>`. If it prints errors, show them as they are and go back to step 3 with a fix. On `ok`, go on.
   - **2:** ask which part to change, redo that step, show the preview again.
   - **3:** stop. Nothing is written.
4. **Done.** Setup only configures. Do not read, score or comment on any ticket here: checking tickets is the job of `/quality-code:start` and `/quality-code:ticket-eval`, and the first ticket checked there also finds the project's acceptance-criteria field. Say: `Setup is done: <adapter>, Jira <site host>, project(s) <keys>. Commit .claude/quality-code.json. Every day, from your feature branch: /quality-code:start. To check any ticket: /quality-code:ticket-eval <KEY>. For feature labels, QA plans, title prefixes, templates and redaction: /quality-code:setup advanced.`

## Advanced

`/quality-code:setup advanced` adds the questions the short setup leaves to defaults. It needs a config: without one, run steps 0 to 3 first. Run `setup.mjs --detect` and start every step from the current config.

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
A3. **Language and redaction.** Start from the current languages (English and Italian unless the config says otherwise). Propose `["en"]`, adding `"it"`, if the summaries from A2 are in Italian or the user says the tickets are written in Italian (for example with "Criteri di accettazione" sections); when the summaries do not tell, ask once. Customer-id redaction stays on by default; ask once for optional extra patterns (name to regular expression). Whenever the proposal contains `redact`, it must always include `"customerId": "\\bU\\d{5,}\\b"` (written exactly so in JSON), because a `redact` in the config replaces the default. Leave it out only if the user explicitly turns customer-id redaction off; with no extra patterns and redaction left on, omit `redact` entirely.
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

   - **1:** write the proposal to a temp file as `{ "config": { … }, "templates": { … } }` (omit `templates` if none were accepted; the config is the current one with the answers of A1 to A4 merged in: `version: 1`, `adapter`, `jira { site, projects, trackingProjects? }`, `languages`, `features`, for `vitest` and `fullstack` `titlePrefixes`, for `playwright` and `fullstack` `confluenceSpaces` when spaces were picked and `playwright` `configs` when the Playwright card was answered, for `fullstack` `sides` when they differ from the defaults, `vitest` `configs` when the Vitest configs card was answered, `vitest` `layers` when the test folders were accepted, and `boundaries` when any path was kept). Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --write @<tmp proposal>`. If it prints errors, show them as they are and go back to A5 with a fix. On `ok`, say that the advanced setup is done.
   - **2:** ask which part to change, redo that step, show the preview again.
   - **3:** stop. Nothing is written.
