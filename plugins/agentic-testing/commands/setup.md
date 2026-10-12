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
   - Call `getJiraProjectIssueTypesMetadata` for the first picked project to list its issue types, then `getJiraIssueTypeMetaWithFields` for the Story type (else the first type) with `requiredFieldsOnly` `false`, to read all its fields. When a Jira tool needs a `cloudId`, pass the hostname of the site (for example `example.atlassian.net`, no `https://`).
   - On a large project this result is very long (hundreds of thousands of characters) and is saved to a file. Never read that file whole. Search it for the field whose name matches `/acceptance criteria|criteri di accettazione/i` and take its key (it looks like `customfield_12345`), with `grep -n -i -E 'acceptance criteria|criteri di accettazione' <file>` or a one-line `node -e` that parses the file and prints the `key` and `name` of each matching field. Read only the matching lines.
   - Exactly one match: propose it (`1. Use <name> (<key>)` / `2. None`). No match, or more than one: ask with a numbered card of the matches (if any), plus a last line `<n>. None`. `None` writes `null`.
   - Ask once whether any other projects should be tracked (`jira.trackingProjects`, optional; skip on no).
3. **Features.** In a Jira project shared by many teams, most recent tickets carry other teams' labels. Before counting, ask how to narrow the search, as a numbered card, and end the turn:

   ```
   1. All recent tickets of the project
   2. Only tickets with a word in the title
   3. Only one component
   4. I'll type my labels
   ```

   - **1:** the JQL is `project = <KEY> ORDER BY created DESC`.
   - **2:** ask for the word (drop any `"` from it); the JQL is `project = <KEY> AND summary ~ "<word>" ORDER BY created DESC`.
   - **3:** list the project's components: call `searchJiraIssuesUsingJql` with `project = <KEY> ORDER BY created DESC`, `maxResults` 100, fields `components`, and show the distinct component names as a numbered list (if there are none, ask the user to type the component name). The JQL is `project = <KEY> AND component = "<component>" ORDER BY created DESC`.
   - **4:** ask for the labels as a comma-separated list. For each label, check that it exists with one `searchJiraIssuesUsingJql` count query, `project = <KEY> AND labels = "<label>"` with `searchResultMode` `count`. Warn about the unknown ones (count 0) by name and ask whether to keep them, drop them or retype them. The kept labels are the picks; skip the counting below.

   For 1 to 3, call `searchJiraIssuesUsingJql` with that JQL, `maxResults` 100, fields `labels,summary` only. Count the labels and show them with their counts as a numbered list; the user picks by number. If the list holds none of the team's labels, offer the card again.

   Each pick becomes `{ "label": "<label>" }`. For `playwright`, also propose a `route` per label from the app's router files (read-only; start with the router config) or ask the user for it. Routes start with `/`. For `playwright`, also propose a `qaPlanSearch` per picked label (the search text used to find that feature's Confluence QA plan): the label with `_` and `-` replaced by spaces (for example `order_history` becomes `order history`), because Confluence's text search finds nothing for a word joined by `_`. Let the user change it or clear it. Add both to the feature: `{ "label", "route", "qaPlanSearch" }`. For `vitest`, neither is needed.
   - **Confluence spaces** (only for `playwright`). On a Confluence site shared by many teams, other teams' pages can rank first. Run ONE `searchConfluenceUsingCql` with `text ~ "<first proposed qaPlanSearch>" AND type = page` (escape `\` and `"` in the text first). List the distinct spaces of the hits (key and name) as a numbered card, plus a last line `<n>. All spaces`, and end the turn. The user may pick several numbers. The picked keys become `confluenceSpaces` (for example `["ABC"]`). `All spaces`, or no hits, leaves `confluenceSpaces` out: the QA-plan search then looks in all spaces.
   - **Title prefixes** (only for `vitest`). In the summaries of the same narrowed search (after option 4, of one `project = <KEY> AND labels in ("<label>", …) ORDER BY created DESC` search with the kept labels, `maxResults` 100, fields `labels,summary`), count each bracket prefix matched by `^\[([^\]]+)\]` (for example `[API] …` counts `API`). Show them with their counts as a numbered list, plus a last line `<n>. None`; the user picks by number. The picks become `titlePrefixes`, in the order picked. `None` writes `"titlePrefixes": []`: no title prefix is asked for and it never scores. Left out, it defaults to `[]` (none). For `playwright`, leave it out.
4. **Language and redaction.** Propose `["en"]`, adding `"it"` if the summaries from step 3 are in Italian or the user says the tickets are written in Italian (for example with "Criteri di accettazione" sections); when the summaries do not tell, ask once. Customer-id redaction stays on by default; ask once for optional extra patterns (name to regular expression). Whenever the proposal contains `redact`, it must always include `"customerId": "\\bU\\d{5,}\\b"` (written exactly so in JSON), because a `redact` in the config replaces the default. Leave it out only if the user explicitly turns customer-id redaction off; with no extra patterns and redaction left on, omit `redact` entirely.
5. **Templates.** If `templates.bug` and `templates.story` are both found, say so and move on. If one is missing, offer the plugin's standard template for it (generic English: Story has a user story, context, Acceptance criteria with a Gherkin example and a plain-language example, and an environment section; Bug has steps to reproduce, expected, actual and environment). Ask `1. Add it / 2. Skip`. On a yes, read the file from `${CLAUDE_PLUGIN_ROOT}/templates/story.md` or `${CLAUDE_PLUGIN_ROOT}/templates/bug.md` and pass its exact text in the proposal as `templates.story` / `templates.bug`. Never draft or edit template text yourself. `setup.mjs --write` writes the file; you never do.
6. **Preview.** Show the full config as it will be written (for `vitest` this includes `titlePrefixes`, even when it is `[]`; for `playwright` each feature's `qaPlanSearch` and `confluenceSpaces`, or `confluenceSpaces: all spaces` when it is left out), then this card and end the turn:

   ```
   1. Write it
   2. Change something
   3. Cancel
   ```

   - **1:** write the proposal to a temp file as `{ "config": { … }, "templates": { … } }` (omit `templates` if none were accepted; the config has `version: 1`, `adapter`, `jira { site, projects, acceptanceCriteriaField, trackingProjects? }`, `languages`, `features`, for `vitest` `titlePrefixes`, and for `playwright` `confluenceSpaces` when spaces were picked). Then run `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --write @<tmp proposal>`. If it prints errors, show them as they are and go back to step 6 with a fix. On `ok`, go on.
   - **2:** ask which part to change, redo that step, show the preview again.
   - **3:** stop. Nothing is written.
7. **Prove it.** Take one recent ticket from step 3's search (the narrowed one, or after option 4 the search by the kept labels). Read it (`getJiraIssue`; fields `summary,issuetype,status,labels,description,<jira.acceptanceCriteriaField>,issuelinks`, using the field id you just wrote, left out when it is `null`; `responseContentFormat` `markdown`). Build the raw ticket JSON as in `/agentic-testing:ticket-eval` step 3, save it as `<ticketsDir>/<KEY>/raw.json`, run `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" sanitize --in @<ticketsDir>/<KEY>/raw.json --out <ticketsDir>/<KEY>/ticket.json`, then `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" score --in @<ticketsDir>/<KEY>/ticket.json`. Show the report. Exit 1 (refused) is a normal result here: the gate is working. Say that setup is done.
