---
description: Set this repo up for agentic testing. Detects the test stack, asks about Jira, writes .claude/agentic-testing.json after you confirm, and proves it on one recent ticket.
---

Set up this repo for the agentic-testing plugin. You propose and ask; the scripts detect and write. Use short sentences and numbered cards. End your turn after every card and wait for the answer.

**Rules**

- Never write `.claude/agentic-testing.json` yourself; only `setup.mjs --write` does. The same goes for the issue templates and the `.gitignore` line.
- Jira tools: refer to them by operation name on the Atlassian (Rovo) connector, whichever Atlassian MCP connection is available in this session (the plugin's own or one the user connected in claude.ai). If none is connected, stop with one message: `Connect the Atlassian connector (type /mcp), then run this command again.`
- Rerun: if `existing` is not null in the detect result, show its current values and start every step from them. The user may change any field.

**Steps**

1. **Detect.** Run `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --detect` and read the `SETUP_JSON:` line (`adapter`, `templates`, `existing`, `gitignore`, and `existingError` when the old file is broken).
   - `adapter` is `null`: stop with `This stack is not supported yet (v1: Playwright, Vitest).`
   - `adapter` is `both`: ask which one to use, as a numbered card (`1. playwright`, `2. vitest`), and wait.
2. **Jira.** Using the Atlassian connector:
   - Call `getAccessibleAtlassianResources`, then confirm the site URL with the user (`1. Use <site>` / `2. A different site`). The site is an `https://` URL with no path.
   - Call `getVisibleJiraProjects`. Show the projects as a numbered list; the user picks by number. Their keys become `jira.projects`.
   - Call `getJiraProjectIssueTypesMetaWithFields` for the first picked project. Propose the field named "Acceptance Criteria" (its id looks like `customfield_12345`). If there is none, use `null`.
   - Ask once whether any other projects should be tracked (`jira.trackingProjects`, optional; skip on no).
3. **Features.** Call `searchJiraIssuesUsingJql` with `project = <KEY> ORDER BY created DESC`, `maxResults` 100, fields `labels,description`. Count the labels and show them with their counts as a numbered list; the user picks by number. Each pick becomes `{ "label": "<label>" }`. For `playwright`, also propose a `route` per label from the app's router files (read-only; start with the router config) or ask the user for it. Routes start with `/`. For `vitest`, routes are not needed.
4. **Language and redaction.** Propose `["en"]`, adding `"it"` if the recent tickets show Italian section names (for example "Criteri di accettazione"). Customer-id redaction stays on by default; ask once for optional extra patterns (name to regular expression).
5. **Templates.** If `templates.bug` and `templates.story` are both found, say so and move on. If one is missing, offer the standard Story or Bug template (written only on a yes, as `templates.story` / `templates.bug` text in the proposal).
6. **Preview.** Show the full config as it will be written, then this card and end the turn:

   ```
   1. Write it
   2. Change something
   3. Cancel
   ```

   - **1:** write the proposal to a temp file as `{ "config": { … }, "templates": { … } }` (omit `templates` if none were accepted; the config has `version: 1`, `adapter`, `jira { site, projects, acceptanceCriteriaField, trackingProjects? }`, `languages`, `features`). Then run `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --write @<tmp proposal>`. If it prints errors, show them as they are and go back to step 6 with a fix. On `ok`, go on.
   - **2:** ask which part to change, redo that step, show the preview again.
   - **3:** stop. Nothing is written.
7. **Prove it.** Take one recent ticket from step 3's search. Read it (`getJiraIssue`; fields `summary,issuetype,status,labels,description,<jira.acceptanceCriteriaField>,issuelinks`, using the field id you just wrote, left out when it is `null`). Build the ticket JSON as in `/agentic-testing:ticket-eval` step 3, save it as a temp file, and run `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" score --in @<temp file>`. Show the report. Exit 1 (refused) is a normal result here: the gate is working. Then delete the temp file and say that setup is done.
