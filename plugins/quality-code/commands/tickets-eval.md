---
description: Score a Jira project's tickets for test-readiness in one run (the 70-point gate): one line per ticket, how much of the project passes, and what is missing most often. Read-only; sends nothing anywhere.
argument-hint: <PROJECT> [--user <name>] [--status <status>] [--limit N] [--json]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: sonnet
---

From `$ARGUMENTS`: read a project's tickets in one search, score them all with the plugin's script, and show the card. The script scores; you never compute or guess a score. Read-only on Jira: nothing is ever commented, edited or transitioned. Plain English, short sentences, common words.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **Connector.** Refer to Jira tools by operation name on the Atlassian (Rovo) connector, whichever Atlassian MCP connection is available in this session. If none is connected, stop once: `Sign in to Atlassian when prompted (type /mcp to connect it), then run this command again.`
- **Read-only.** Only `searchJiraIssuesUsingJql` on the Atlassian connector. Never comment on, edit or transition a ticket here, and never write to Confluence.
- **One search.** ONE `searchJiraIssuesUsingJql` (paged only with `nextPageToken`), never one call per ticket. No comment reads, no Confluence, no Figma: the score uses what the search returns.
- **Language.** Talk in the language of the user's messages. The card stays as printed.
- Redact customer ids (`\bU\d{5,}\b`, plus the config's `redact` patterns) in anything you echo.
- When a Jira tool needs a `cloudId`, pass the hostname of `jira.site` (no `https://`).

## Steps

1. **Config.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. If it does not print a line starting with `ok`, show its lines and stop (a missing config means: run `/quality-code:setup`). The config is the repo's or the personal one; use whichever it found. Read `jira.site`, `jira.projects`, `jira.trackingProjects` (optional) and `ticketsDir` (default `.quality-code/tickets`, with `/` separators and no trailing `/`) from it.
2. **Parse.** From `$ARGUMENTS`:
   - `<PROJECT>`: the first word that is a project key (`[A-Z][A-Z0-9]*`), mandatory. Missing: `pass a project: /quality-code:tickets-eval <PROJECT>` and stop. It must be in `jira.projects` or `jira.trackingProjects`; if not, say `<PROJECT> is not one of <those keys>. Add it with /quality-code:setup, or pick one of them.` and stop.
   - `--user <name>`, `--status <status>` (a value with spaces is in quotes), `--limit N` (default 50, cap 200; not a whole number of 1 or more: say so and stop), `--json`.
   - **Criteria field.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" field get <PROJECT>` and read the `FIELD_JSON:` line. `source` `config` or `stored`: use its `field` (`null` means the project has no criteria field). `source` `unknown`: look it up once exactly as step 1 of `${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md` does (Story type, all fields, search the saved result, never read it whole) and remember it with `field set`.
3. **Search.** Call `searchJiraIssuesUsingJql` once on the Atlassian connector. The JQL is `project = <PROJECT>`, then `AND assignee = "<user>"` when `--user` is given, then `AND status = "<status>"` when `--status` is given, then `ORDER BY updated DESC`. Escape `\` as `\\` and `"` as `\"` in the user and status values first. `maxResults` is the limit; `fields` are `summary,issuetype,status,labels,description,<criteria field>,issuelinks,attachment` (leave the criteria field out when it is `null`); `responseContentFormat` is `markdown`. If more results exist and fewer than the limit came back, call again with `nextPageToken` until you have the limit or no token is left. No ticket found: `No tickets found for <PROJECT> with these filters.` and stop.
4. **Write the results.** Write one JSON array to `<ticketsDir>/tickets-eval.json` (create the folder if needed). The script deletes this file once it has scored it, so the raw text does not stay on disk. Each ticket is an object in the shape `ticket-eval` writes to `raw.json`:

   ```json
   { "key": "<KEY>", "browse": "<jira.site>/browse/<KEY>", "issuetype": "<type>", "status": "<status>",
     "summary": "<summary>", "labels": ["<label>"],
     "text": { "description": "<raw description>", "acField": "<raw criteria field, or empty>" },
     "attachments": 0, "links": [{ "url": "…", "title": "…" }],
     "scenarios": [], "qaPlan": null, "figma": null, "mr": null, "flags": [] }
   ```

   Copy the text as returned; do not judge, trim or rewrite it, and do not invent scenarios (leave `scenarios` empty: the script reads the text itself).
   - `attachments`: the number of entries in the `attachment` field (`0` when there are none). Only the count: never a file name, an attachment URL or a file's contents.
   - `links`: one `{ "url", "title" }` per linked issue in `issuelinks` (inward or outward): `url` = `<jira.site>/browse/<linked KEY>`, `title` = the key and its summary. Only for a ticket with no linked issue, also read its web links: one `listJiraIssueRemoteIssueLinks` call (`getJiraIssueRemoteIssueLinks` on an older connection) for that key, each as `url` = `object.url`, `title` = `object.title`. A ticket that already has a linked issue needs no such call: one link is all the score needs. No links: `[]`.
5. **Score.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" tickets-eval --in @<ticketsDir>/tickets-eval.json` (add `--json` if given; with `--json` print only the `TICKETS_EVAL_JSON:` line and stop). It exits 0 whatever the pass rate; exit 2 is bad input or config (show the message and stop). Show the card exactly as printed, and drop the `TICKETS_EVAL_JSON:` machine line.
6. **End.** After the card, one sentence: how many tickets were read, and that nothing was sent to Jira. If the search hit the limit, add `Showing the latest <N>. Use --limit to read more (up to 200).` To fix one ticket: `/quality-code:ticket-eval <KEY>`. Stop.

## Examples

- `/quality-code:tickets-eval ABC`: the latest 50 tickets of ABC
- `/quality-code:tickets-eval ABC --user "Jane Doe" --status "To Do"`: one person's open tickets
- `/quality-code:tickets-eval ABC --limit 200 --json`: machine result only
