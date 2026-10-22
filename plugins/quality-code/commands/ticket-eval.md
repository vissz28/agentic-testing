---
description: Score a Jira ticket for test-readiness (the 70-point gate). Refuses thin tickets, guides the fill-in, and can comment on or update the ticket on Jira after a preview.
argument-hint: <TICKET-KEY> [--ci] [--json] [--refuse-comment]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: sonnet
---

From `$ARGUMENTS`: read the ticket, run the readiness gate with the plugin's script, and act on the result. The script scores; you never compute or guess a score. Below 70 the ticket is refused, interactive and `--ci` alike. Read-only on Jira, except one refuse comment and, after a preview the user confirms, appending their own fill-in to the ticket. Plain English everywhere a human reads. Short sentences, common words.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **Connector.** Refer to Jira tools by operation name on the Atlassian (Rovo) connector, whichever Atlassian MCP connection is available in this session (the plugin's own or one connected in claude.ai). If none is connected, stop once: `Sign in to Atlassian when prompted (type /mcp to connect it), then run this command again. Or paste the ticket text.` If the user pastes the ticket text, use it in place of step 2's read. No searching of transcripts or caches.
- **Token discipline.** Read only the fields listed in step 2; never all fields, never a comment dump. Read comments only when the description has no criteria.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop or Cancel option. Read only the first word for this; a sentence that gives a result (and no number) is a typed answer.
- **Language.** Talk in the language of the user's messages; before they write one, in the ticket's language (Italian for an Italian ticket). Script output and cards stay as printed.
- **Never say the score to the user**, except in the guided fill-in lines, shown exactly as the script prints them.
- Every script call is `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" <command> …`, run from the project root. Show script output as printed, but drop the machine lines (`TICKET_EVAL_JSON:`, `FILL_JSON:`, `JIRA_UPDATE_JSON:`, `PROJECT_MISMATCH:`, `SIDE_JSON:`).
- Redact customer ids in anything you echo.
- End your turn after every card and wait for the answer. `--ci` never asks and never takes option 3.

## Steps

1. **Parse and check.** The first `[A-Z][A-Z0-9]*-\d+` in `$ARGUMENTS` is the key. No key: `pass a key: /quality-code:ticket-eval <KEY>`. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. If it does not print `ok`, show its lines and stop (a missing config means: run `/quality-code:setup`). Read `.claude/quality-code.json` for `adapter`, `jira.site`, `jira.projects`, `confluenceSpaces` (optional) and `ticketsDir` (default `.claude/quality-code/tickets`; write it with `/` separators and no trailing `/`, as the script does). Never hard-code any of these.

   - **Criteria field.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" field get <PROJECT>` (the key's project) and read the `FIELD_JSON:` line. `source` `config` or `stored`: use its `field` (`null` means the project has no criteria field: criteria come from the description only). `source` `unknown` (the first ticket of this project on this machine): find it once, then remember it:
     - Call `getJiraProjectIssueTypesMetadata` for the key's project to list its issue types, then `getJiraIssueTypeMetaWithFields` for the Story type (else the first type) with `requiredFieldsOnly` `false`, to read all its fields. When a Jira tool needs a `cloudId`, pass the hostname of the site (for example `example.atlassian.net`, no `https://`).
     - On a large project this result is very long (hundreds of thousands of characters) and is saved to a file. Never read that file whole. Search it for the field whose name matches `/acceptance criteria|criteri di accettazione/i` and take its key (it looks like `customfield_12345`), with `grep -n -i -E 'acceptance criteria|criteri di accettazione' <file>` or a one-line `node -e` that parses the file and prints the `key` and `name` of each matching field. Read only the matching lines.
     - Exactly one match: use it, with no question. More than one: ask with a numbered card of the matches plus a last line `<n>. None`, and end the turn (with `--ci`, never ask: take `None` and say so). No match: `None`.
     - Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" field set <PROJECT> <customfield_N|none>`. Later tickets of this project skip the lookup.
2. **Read the ticket.** Call `getJiraIssue` on the Atlassian connector with `cloudId` set to the hostname of `jira.site` (no `https://`), fields `summary,issuetype,status,labels,description,<criteria field>,issuelinks` (the field from step 1; leave it out when it is `null`), and `responseContentFormat` `markdown` so headings and paragraphs keep their line breaks. Harvest:
   - `summary`, `issuetype`, `status`, `labels`; `browse` = `<jira.site>/browse/<KEY>`.
   - The raw description and the raw criteria field text. Do not judge them: the script reads them itself. Extract each `Scenario:` into `scenarios: [{ "name", "gherkin" }]`. Do not pad the list; write only what the ticket supports.
   - `figma`: a `figma.com/(file|design)/…` URL in the description, labels or `issuelinks`, else `null`. Note the URL only.
   - Flags: only things a script cannot see (an undefined term, a missing precondition, a `When` with no `Then`). Informational; they do not change the score.
   - `mr`: a merge request URL or `!<iid>` in the summary or description gives `<project>!<iid>`; else `null`. (`sanitize` also finds an MR URL in the ticket and stores it as `gitlab`.) Do not read any diff here.
   - **QA plan** (only when the config has `adapter: playwright`, or `adapter: fullstack` and the ticket is not marked backend: its title prefix or labels hold none of `sides.backend`, by default `BE`; otherwise `qaPlan = null`). The feature is the config feature whose `label` is on the ticket. First use a Confluence page attached to the ticket. Jira keeps those in the ticket's remote links (its Web links), never in `issuelinks`: call `listJiraIssueRemoteIssueLinks` (`getJiraIssueRemoteIssueLinks` on an older connection) with the same `cloudId` and the key, and keep only the links whose `object.url` starts with `<jira.site>/wiki/` (the rest are commits and merge requests; a page's link title is just `Wiki Page`, and its page id is the URL's `pageId=` or the number after `/pages/`). Add a `<jira.site>/wiki/` URL written in the description. Read those pages in order, at most 3, whatever their space (`confluenceSpaces` limits only the search), and stop at the first that holds Gherkin or step scenarios: it is the QA plan, with the page's own title. Nothing attached, or no attached page holds scenarios: the search. If that feature has a `qaPlanSearch`, run ONE `searchConfluenceUsingCql` on the Atlassian connector. First escape `\` as `\\` and `"` as `\"` in `qaPlanSearch`. Without `confluenceSpaces` the CQL is `text ~ "<qaPlanSearch>" AND type = page` (all spaces); with it, `text ~ "<qaPlanSearch>" AND type = page AND space in ("<K1>","<K2>")`, one quoted key per entry of `confluenceSpaces`. No `qaPlanSearch` configured, or no feature label: no search. The best match is a hit whose title contains the search words, ignoring case (every word of `qaPlanSearch`, in any order; a word matches when a title word starts with it, so `order` matches "Orders"; accents and punctuation count as written). If no hit's title does, take no page: `qaPlan = null` with the flag below. Never credit a page only because it ranks first: other teams' pages often rank above yours. Read at most one page of the hits (the best match; if several titles match, take the one with the fewest words besides the search words, so "Orders" beats "Import orders"; still tied, the first of those). If it holds Gherkin or step scenarios, set `qaPlan = { "title", "url", "scenarios": [{ "name", "gherkin" }] }`. The score only credits a QA plan that has a `url`. Nothing sensible found: `qaPlan = null` and add the flag `no Confluence QA plan found for <feature>`. A missing QA plan lowers the score but never stops the run. No space crawl, no descendant walk.

3. **Save and sanitize.** Write this JSON to `<ticketsDir>/<KEY>/raw.json` (create the folder):

   ```json
   {
     "key": "<KEY>", "browse": "<url>", "issuetype": "<type>", "status": "<status>",
     "summary": "<summary>", "labels": ["<label>"],
     "text": { "description": "<raw description>", "acField": "<raw criteria field, or empty>" },
     "scenarios": [{ "name": "…", "gherkin": "Given … When … Then …" }],
     "qaPlan": null, "figma": null, "mr": null, "flags": []
   }
   ```

   Then run `ticket.mjs sanitize --in @<ticketsDir>/<KEY>/raw.json --out <ticketsDir>/<KEY>/ticket.json`. This deletes `raw.json`. From here on every call uses `--in @<ticketsDir>/<KEY>/ticket.json`, the only copy.

4. **Project check.** If any call prints `PROJECT_MISMATCH:` (the key's project is not in `jira.projects`), stop before scoring and show this card:

   ```
   This ticket is from project <X>, not one of <projects>.

   1. Continue anyway
   2. Stop
   ```

   `--ci` takes 2. Show this card once. On 1, go on and ignore the `PROJECT_MISMATCH:` line for the rest of the run; on 2, stop.

4b. **Side** (only for `adapter: fullstack`). A fullstack project writes Vitest tests for a backend ticket, Playwright tests for a frontend one, and both for a fullstack one, and scores each with its own rubric. Run `ticket.mjs side --in @<ticketsDir>/<KEY>/ticket.json` and read the `SIDE_JSON:` line. A `side` is set: go on. `side` is `null` (the title and labels do not say), show this card and end the turn (`--ci` never asks: it goes on, and the ticket is scored for both sides):

   ```
   Which part of the app does this ticket change?
   1. The frontend: a screen (Playwright tests)
   2. The backend: the code behind it (Vitest tests)
   3. Both (fullstack)
   ```

   Then run `ticket.mjs side --in @<ticketsDir>/<KEY>/ticket.json <frontend|backend|fullstack>` (1, 2, 3) and show its line. The side is saved in `ticket.json`; later steps read it from there.

5. **Score.** `ticket.mjs score --in @<ticketsDir>/<KEY>/ticket.json` (add `--ci` or `--json` if given; with `--json` print only the JSON and stop). Relay the report. Exit 0 is `pass`, 1 is `refuse`, 2 is a config or input error (show the message and stop). With `--refuse-comment`, run `ticket.mjs refuse-comment` instead, print its text, and stop (printing never posts).
   - **pass:** say the ticket is ready and stop. (Other commands that build on this gate continue from here.)
   - **refuse:** show the refuse card.

## The refuse card

```
This ticket needs a bit more information. We cannot start yet.

1. Post a comment on Jira with what to add.
2. I will add the missing information here.
3. 🔴 **[RISK / NOT RECOMMENDED]** Continue anyway (developers only). The user story is not complete.
```

Option 3 is always shown with that red tag, word for word. Chat cannot color text, so the emoji is the red. `--ci` takes 1: it skips the send-preview, posts the comment, and exits 1. It never takes 3.

- **1:** do not post yet. Run `ticket.mjs refuse-comment --in @<ticketsDir>/<KEY>/ticket.json`, then show the send-preview card and end the turn.
- **2:** the guided fill-in. Do not ask your own questions and do not invent what is missing: the script decides both.
- **3:** developer override. Post nothing now (`write` offers the risk note at its end). Proceed only if the brief's `derivable` is at least 1 (there is something to check). If `derivable` is 0, stay on this card with one extra sentence: `There is nothing to check yet — paste what should happen, or stop.` When proceeding, say plainly that the ticket is incomplete, the result carries the 🔴 **[RISK / NOT RECOMMENDED]** mark, and a note saying so is offered for the Jira ticket once the tests are written. Remember the brief's `score` from `TICKET_EVAL_JSON` as the incomplete score. Then:
  - When `write` sent you here, go back to it: it goes on with the incomplete score.
  - Otherwise (this command on its own, or `start`), go straight on to writing the tests: read `${CLAUDE_PLUGIN_ROOT}/commands/write.md` and follow it with `<KEY>` as `$ARGUMENTS` and the incomplete score. The ticket is already saved, sanitized and scored, so do not run the gate again, and the connectors were already checked: skip both. The tests it writes and their card carry the 🔴 mark.

## Send-preview (after refuse option 1)

Show the `refuse-comment` text as it is. Do not rewrite it. Then:

```
Comment preview (not posted yet):

<the comment>

1. Post this comment to Jira
2. Do not post. I will add the missing information here.
3. Generate the comment again
4. Cancel
```

- **1:** call `addCommentToJiraIssue` on the Atlassian connector: the ticket key, `contentFormat` `markdown`, the comment text verbatim. If an existing comment contains `Thanks, we can continue as soon as these are on the ticket.`, the older `Thanks — we can continue as soon as these are on the ticket.`, or `<!-- /spec refuse -->` (the same rule as `isRefuseComment` in the plugin's `lib/ticket/jira.mjs`), update that comment instead of adding a second one. Do not rewrite the body. If no add-comment tool is available, do not improvise: show the text and say `Copy this onto the ticket.` On success: `The comment has been posted. Work has not started.`, then run `ticket.mjs jira-posted <KEY> comment` (it logs the key for `/quality-code:kpi`; show nothing of it). On failure: `Could not comment on Jira.` Then stop.
- **2:** the guided fill-in.
- **3:** re-read the ticket, re-run steps 2 to 5 and `refuse-comment`; never write the comment by hand. Now `pass`: say so and stop. Still `refuse`: show the preview again. Cap 2, then add one sentence: `The comment has been generated twice. Please post it, add the missing information, or cancel.`
- **4:** `The comment was not posted.` Stop.

## Guided fill-in

Three script calls with `--in @<ticketsDir>/<KEY>/ticket.json`, each shown as printed. End the turn after every card.

1. **The list.** `ticket.mjs fill-menu`. Show its card: the score, the bar, and each missing item with the points it adds. The user types the numbers to fill (`1 3`).
2. **The pick.** `ticket.mjs pick "<their numbers>"`. Show its one line. Not enough points: show the list again (cap 2, then the refuse card). Enough: go on. Unknown number: show the line and the list again. Minimal answers are fine only if the script credits them.
3. **One item at a time**, in the order picked. Print the item's `title`, `question` and `example` from `FILL_JSON` as:

   ```
   <title>
   <question>
   For example: <example>

   Type your answer, or "skip".
   ```

   Then `ticket.mjs add --in @<ticket.json> <key> -- "<their answer, verbatim>"` (the `--` keeps an answer that starts with `--` from being read as a flag). Show its line. `Accepted.`: next item. `Not accepted:`: show it and ask again; after 2 rejections on one item, move on. `skip`: move on. Plain acceptance criteria need at least 150 characters, or Gherkin steps; the script says so when an answer is too short. Only `add` writes `ticket.json`, and only when the answer counts. Never edit it yourself and never send answers to Jira on this path.

After the last item, re-run `ticket.mjs score` on the same file. Still `refuse`: show the refuse card again. `pass` with nothing accepted: the ticket is ready; stop. `pass` with at least one answer accepted: what was typed goes to Jira next, so the ticket itself carries it. Say `The ticket now has <score> points (the bar is <threshold>).`, run `ticket.mjs jira-update --in @<ticketsDir>/<KEY>/ticket.json`, show its preview as printed, then this card and end the turn (`--ci` never gets here):

```
1. Update the Jira ticket
2. Do not update, just continue
3. Cancel
```

- **1:** only now write to Jira. Fetch the ticket fresh with `getJiraIssue` (fields `description,labels,summary`, `responseContentFormat` `markdown`), then one `editJiraIssue` (`contentFormat` `markdown`) that sets only what `JIRA_UPDATE_JSON` names: `description` = the fresh description + a blank line + `append`; `labels` = the fresh labels plus `labelsAdd`; `summary` = `[<titlePrefix>] ` + the fresh summary without its old `[..]` prefix, only when `titlePrefix` is set. Append only. Never send the text from disk, never rewrite or reorder what is on the ticket. Then one sentence: `The Jira ticket has been updated.`, and run `ticket.mjs jira-posted <KEY> update` (it logs the key for `/quality-code:kpi`; show nothing of it). On failure: `Could not update the Jira ticket.` Either way, the ticket is ready; stop.
- **2:** nothing sent. The ticket is ready; stop.
- **3:** stop, nothing sent.

## Examples

- `/quality-code:ticket-eval ABC-123`: score and gate, human report
- `/quality-code:ticket-eval ABC-123 --json`: brief only
- `/quality-code:ticket-eval ABC-123 --ci`: no prompts; exit 1 below the bar
- `/quality-code:ticket-eval ABC-123 --refuse-comment`: print (do not post) the Jira comment for a refused ticket
