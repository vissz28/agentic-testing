---
description: Set this repo up for agentic testing. Detects the test stack, asks about Jira, writes .claude/agentic-testing.json after you confirm, and proves it on one recent ticket.
---

Set up this repo for the agentic-testing plugin. You propose and ask; the scripts detect and write. Use short sentences and numbered cards. End your turn after every card and wait for the answer.

**Rules**

- Never write `.claude/agentic-testing.json` yourself; only `setup.mjs --write` does. The same goes for the issue templates and the `.gitignore` line.
- Jira tools: refer to them by operation name on the Atlassian (Rovo) connector, whichever Atlassian MCP connection is available in this session (the plugin's own or one the user connected in claude.ai). If none is connected, stop with one message: `Sign in to Atlassian when prompted (type /mcp to connect it), then run this command again. Or paste the ticket text.`
- Rerun: if `existing` is not null in the detect result, show its current values and start every step from them. The user may change any field.

**Steps**

1. **Detect.** Run `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --detect` and read the `SETUP_JSON:` line (`adapter`, `templates`, `existing`, `gitignore`, and `existingError` when the old file is broken).
   - `adapter` is `null`: stop with `This stack is not supported yet (v1: Playwright, Vitest).`
   - `adapter` is `both`: ask which one to use, as a numbered card (`1. playwright`, `2. vitest`), and wait.
2. **Jira.** Using the Atlassian connector:
   - Call `getAccessibleAtlassianResources`, then confirm the site URL with the user (`1. Use <site>` / `2. A different site`). The site is an `https://` URL with no path.
   - Call `getVisibleJiraProjects`. Show the projects as a numbered list; the user picks by number. Their keys become `jira.projects`.
   - Call `getJiraProjectIssueTypesMetadata` for the first picked project to list its issue types, then `getJiraIssueTypeMetaWithFields` for one type (Story, else the first) to read its fields. Propose the field named "Acceptance Criteria" (its id looks like `customfield_12345`). If there is none, use `null`. When a Jira tool needs a `cloudId`, pass the hostname of the site (for example `example.atlassian.net`, no `https://`).
   - Ask once whether any other projects should be tracked (`jira.trackingProjects`, optional; skip on no).
3. **Features.** Call `searchJiraIssuesUsingJql` with `project = <KEY> ORDER BY created DESC`, `maxResults` 100, fields `summary,labels,description`. Count the labels and show them with their counts as a numbered list; the user picks by number. Each pick becomes `{ "label": "<label>" }`. For `playwright`, also propose a `route` per label from the app's router files (read-only; start with the router config) or ask the user for it. Routes start with `/`. For `playwright`, also propose a `qaPlanSearch` per picked label (the search text used to find that feature's Confluence QA plan; default: the label text) and let the user change it or clear it. Add both to the feature: `{ "label", "route", "qaPlanSearch" }`. For `vitest`, neither is needed.
   - **Title prefixes** (only for `vitest`). In the same summaries, count each bracket prefix matched by `^\[([^\]]+)\]` (for example `[API] …` counts `API`). Show them with their counts as a numbered list, plus a last line `<n>. None`; the user picks by number. The picks become `titlePrefixes`, in the order picked. `None` writes `"titlePrefixes": []`: no title prefix is asked for and it never scores. Never leave `titlePrefixes` out for `vitest`, or the default `["FE","BE","FS"]` applies. For `playwright`, leave it out.
4. **Language and redaction.** Propose `["en"]`, adding `"it"` if the recent tickets show Italian section names (for example "Criteri di accettazione"). Customer-id redaction stays on by default; ask once for optional extra patterns (name to regular expression). Whenever the proposal contains `redact`, it must always include `"customerId": "\\bU\\d{5,}\\b"` (written exactly so in JSON), because a `redact` in the config replaces the default. Leave it out only if the user explicitly turns customer-id redaction off; with no extra patterns and redaction left on, omit `redact` entirely.
5. **Templates.** If `templates.bug` and `templates.story` are both found, say so and move on. If one is missing, offer the plugin's standard template for it (generic English: Story has a user story, context, Acceptance criteria with a Gherkin example and a plain-language example, and an environment section; Bug has steps to reproduce, expected, actual and environment). Ask `1. Add it / 2. Skip`. On a yes, read the file from `${CLAUDE_PLUGIN_ROOT}/templates/story.md` or `${CLAUDE_PLUGIN_ROOT}/templates/bug.md` and pass its exact text in the proposal as `templates.story` / `templates.bug`. Never draft or edit template text yourself. `setup.mjs --write` writes the file; you never do.
6. **Preview.** Show the full config as it will be written (for `vitest` this includes `titlePrefixes`, even when it is `[]`), then this card and end the turn:

   ```
   1. Write it
   2. Change something
   3. Cancel
   ```

   - **1:** write the proposal to a temp file as `{ "config": { … }, "templates": { … } }` (omit `templates` if none were accepted; the config has `version: 1`, `adapter`, `jira { site, projects, acceptanceCriteriaField, trackingProjects? }`, `languages`, `features`, and for `vitest` `titlePrefixes`). Then run `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --write @<tmp proposal>`. If it prints errors, show them as they are and go back to step 6 with a fix. On `ok`, go on.
   - **2:** ask which part to change, redo that step, show the preview again.
   - **3:** stop. Nothing is written.
7. **Prove it.** Take one recent ticket from step 3's search. Read it (`getJiraIssue`; fields `summary,issuetype,status,labels,description,<jira.acceptanceCriteriaField>,issuelinks`, using the field id you just wrote, left out when it is `null`; `responseContentFormat` `markdown`). Build the raw ticket JSON as in `/agentic-testing:ticket-eval` step 3, save it as `<ticketsDir>/<KEY>/raw.json`, run `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" sanitize --in @<ticketsDir>/<KEY>/raw.json --out <ticketsDir>/<KEY>/ticket.json`, then `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" score --in @<ticketsDir>/<KEY>/ticket.json`. Show the report. Exit 1 (refused) is a normal result here: the gate is working. Say that setup is done.
