---
description: Score a Jira ticket for test-readiness (the 70-point gate). Refuses thin tickets, guides the fill-in, and can comment on or update the ticket on Jira after a preview.
argument-hint: <TICKET-KEY> [--ci] [--json] [--refuse-comment]
---

From `$ARGUMENTS`: read the ticket, run the readiness gate with the plugin's script, and act on the result. The script scores; you never compute or guess a score. Below 70 the ticket is refused, interactive and `--ci` alike. Read-only on Jira, except one refuse comment and, after a preview the user confirms, appending their own fill-in to the ticket. Plain English everywhere a human reads. Short sentences, common words.

## Rules

- **Connector.** Refer to Jira tools by operation name on the Atlassian (Rovo) connector, whichever Atlassian MCP connection is available in this session (the plugin's own or one connected in claude.ai). If none is connected, stop once: `Sign in to Atlassian when prompted (type /mcp to connect it), then run this command again. Or paste the ticket text.` If the user pastes the ticket text, use it in place of step 2's read. No searching of transcripts or caches.
- **Token discipline.** Read only the fields listed in step 2; never all fields, never a comment dump. Read comments only when the description has no criteria.
- **Never say the score to the user**, except in the guided fill-in lines, shown exactly as the script prints them.
- Every script call is `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" <command> …`, run from the project root. Show script output as printed, but drop the machine lines (`TICKET_EVAL_JSON:`, `FILL_JSON:`, `JIRA_UPDATE_JSON:`, `PROJECT_MISMATCH:`).
- Redact customer ids in anything you echo.
- End your turn after every card and wait for the answer. `--ci` never asks and never takes option 3.

## Steps

1. **Parse and check.** The first `[A-Z][A-Z0-9]*-\d+` in `$ARGUMENTS` is the key. No key: `pass a key: /agentic-testing:ticket-eval <KEY>`. Run `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" config check`. If it does not print `ok`, show its lines and stop (a missing config means: run `/agentic-testing:setup`). Read `.claude/agentic-testing.json` for `jira.site`, `jira.projects`, `jira.acceptanceCriteriaField`, `confluenceSpaces` (optional) and `ticketsDir` (default `.claude/agentic-testing/tickets`; write it with `/` separators and no trailing `/`, as the script does). Never hard-code any of these.

2. **Read the ticket.** Call `getJiraIssue` on the Atlassian connector with `cloudId` set to the hostname of `jira.site` (no `https://`), fields `summary,issuetype,status,labels,description,<jira.acceptanceCriteriaField>,issuelinks` (leave the criteria field out when it is `null`; use the id from the config), and `responseContentFormat` `markdown` so headings and paragraphs keep their line breaks. Harvest:
   - `summary`, `issuetype`, `status`, `labels`; `browse` = `<jira.site>/browse/<KEY>`.
   - The raw description and the raw criteria field text. Do not judge them: the script reads them itself. Extract each `Scenario:` into `scenarios: [{ "name", "gherkin" }]`. Do not pad the list; write only what the ticket supports.
   - `figma`: a `figma.com/(file|design)/…` URL in the description, labels or `issuelinks`, else `null`. Note the URL only.
   - Flags: only things a script cannot see (an undefined term, a missing precondition, a `When` with no `Then`). Informational; they do not change the score.
   - `mr`: a merge request URL or `!<iid>` in the summary or description gives `<project>!<iid>`; else `null`. (`sanitize` also finds an MR URL in the ticket and stores it as `gitlab`.) Do not read any diff here.
   - **QA plan** (only when the config has `adapter: playwright`; otherwise `qaPlan = null`). The feature is the config feature whose `label` is on the ticket. First use a Confluence page already linked in `issuelinks` or the description. If there is none and that feature has a `qaPlanSearch`, run ONE `searchConfluenceUsingCql` on the Atlassian connector. First escape `\` as `\\` and `"` as `\"` in `qaPlanSearch`. Without `confluenceSpaces` the CQL is `text ~ "<qaPlanSearch>" AND type = page` (all spaces); with it, `text ~ "<qaPlanSearch>" AND type = page AND space in ("<K1>","<K2>")`, one quoted key per entry of `confluenceSpaces`. No `qaPlanSearch` configured, or no feature label: no search. The best match is a hit whose title contains the search words, ignoring case (every word of `qaPlanSearch`, in any order; for example `orders` matches "QA plan - Orders"). If no hit's title does, take no page: `qaPlan = null` with the flag below. Never credit a page only because it ranks first: other teams' pages often rank above yours. Read at most one page (the best match; if several titles match, the first of those). If it holds Gherkin or step scenarios, set `qaPlan = { "title", "url", "scenarios": [{ "name", "gherkin" }] }`. The score only credits a QA plan that has a `url`. Nothing sensible found: `qaPlan = null` and add the flag `no Confluence QA plan found for <feature>`. A missing QA plan lowers the score but never stops the run. No space crawl, no descendant walk.

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

   Then run `cli.mjs sanitize --in @<ticketsDir>/<KEY>/raw.json --out <ticketsDir>/<KEY>/ticket.json`. This deletes `raw.json`. From here on every call uses `--in @<ticketsDir>/<KEY>/ticket.json`, the only copy.

4. **Project check.** If any call prints `PROJECT_MISMATCH:` (the key's project is not in `jira.projects`), stop before scoring and show this card:

   ```
   This ticket is from project <X>, not one of <projects>.

   1. Continue anyway
   2. Stop
   ```

   `--ci` takes 2. Show this card once. On 1, go on and ignore the `PROJECT_MISMATCH:` line for the rest of the run; on 2, stop.

5. **Score.** `cli.mjs score --in @<ticketsDir>/<KEY>/ticket.json` (add `--ci` or `--json` if given; with `--json` print only the JSON and stop). Relay the report. Exit 0 is `pass`, 1 is `refuse`, 2 is a config or input error (show the message and stop). With `--refuse-comment`, run `cli.mjs refuse-comment` instead, print its text, and stop (printing never posts).
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

- **1:** do not post yet. Run `cli.mjs refuse-comment --in @<ticketsDir>/<KEY>/ticket.json`, then show the send-preview card and end the turn.
- **2:** the guided fill-in. Do not ask your own questions and do not invent what is missing: the script decides both.
- **3:** developer override. Post nothing. Proceed only if the brief's `derivable` is at least 1 (there is something to check). If `derivable` is 0, stay on this card with one extra sentence: `There is nothing to check yet — paste what should happen, or stop.` When proceeding, say plainly that the ticket is incomplete and the result carries the 🔴 **[RISK / NOT RECOMMENDED]** mark, then stop; callers that build on this command decide what to do with that.

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

- **1:** call `addCommentToJiraIssue` on the Atlassian connector: the ticket key, `contentFormat` `markdown`, the comment text verbatim. If an existing comment contains `Thanks, we can continue as soon as these are on the ticket.`, the older `Thanks — we can continue as soon as these are on the ticket.`, or `<!-- /spec refuse -->` (the same rule as `isRefuseComment` in the plugin's `core/jira.mjs`), update that comment instead of adding a second one. Do not rewrite the body. If no add-comment tool is available, do not improvise: show the text and say `Copy this onto the ticket.` On success: `The comment has been posted. Work has not started.` On failure: `Could not comment on Jira.` Then stop.
- **2:** the guided fill-in.
- **3:** re-read the ticket, re-run steps 2 to 5 and `refuse-comment`; never write the comment by hand. Now `pass`: say so and stop. Still `refuse`: show the preview again. Cap 2, then add one sentence: `The comment has been generated twice. Please post it, add the missing information, or cancel.`
- **4:** `The comment was not posted.` Stop.

## Guided fill-in

Three script calls with `--in @<ticketsDir>/<KEY>/ticket.json`, each shown as printed. End the turn after every card.

1. **The list.** `cli.mjs fill-menu`. Show its card: the score, the bar, and each missing item with the points it adds. The user types the numbers to fill (`1 3`).
2. **The pick.** `cli.mjs pick "<their numbers>"`. Show its one line. Not enough points: show the list again (cap 2, then the refuse card). Enough: go on. Unknown number: show the line and the list again. Minimal answers are fine only if the script credits them.
3. **One item at a time**, in the order picked. Print the item's `title`, `question` and `example` from `FILL_JSON` as:

   ```
   <title>
   <question>
   For example: <example>

   Type your answer, or "skip".
   ```

   Then `cli.mjs add --in @<ticket.json> <key> -- "<their answer, verbatim>"` (the `--` keeps an answer that starts with `--` from being read as a flag). Show its line. `Accepted.`: next item. `Not accepted:`: show it and ask again; after 2 rejections on one item, move on. `skip`: move on. Plain acceptance criteria need at least 150 characters, or Gherkin steps; the script says so when an answer is too short. Only `add` writes `ticket.json`, and only when the answer counts. Never edit it yourself and never send answers to Jira on this path.

After the last item, re-run `cli.mjs score` on the same file. Still `refuse`: show the refuse card again. `pass`: show this card (skip it if nothing was accepted; `--ci` never shows it):

```
The ticket now has <score> points (the bar is <threshold>).

1. Continue
2. Also add what you typed to the Jira ticket (I'll show it first)
3. Stop
```

- **1:** the ticket is ready; stop.
- **2:** run `cli.mjs jira-update --in @<ticketsDir>/<KEY>/ticket.json`. Show its preview as printed, then this card and end the turn:

  ```
  1. Update the Jira ticket
  2. Do not update, just continue
  3. Cancel
  ```

  **1:** only now write to Jira. Fetch the ticket fresh with `getJiraIssue` (fields `description,labels,summary`, `responseContentFormat` `markdown`), then one `editJiraIssue` (`contentFormat` `markdown`) that sets only what `JIRA_UPDATE_JSON` names: `description` = the fresh description + a blank line + `append`; `labels` = the fresh labels plus `labelsAdd`; `summary` = `[<titlePrefix>] ` + the fresh summary without its old `[..]` prefix, only when `titlePrefix` is set. Append only. Never send the text from disk, never rewrite or reorder what is on the ticket. Then one sentence: `The Jira ticket has been updated.` On failure: `Could not update the Jira ticket.` **2:** continue, nothing sent. **3:** stop, nothing sent.
- **3:** stop.

## Examples

- `/agentic-testing:ticket-eval ABC-123`: score and gate, human report
- `/agentic-testing:ticket-eval ABC-123 --json`: brief only
- `/agentic-testing:ticket-eval ABC-123 --ci`: no prompts; exit 1 below the bar
- `/agentic-testing:ticket-eval ABC-123 --refuse-comment`: print (do not post) the Jira comment for a refused ticket
