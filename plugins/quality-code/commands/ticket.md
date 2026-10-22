---
description: Find a Jira ticket and show it in short, with suggestions for what its author could add (never written to Jira). Takes a key, a number, search words, or filters like assignee:me status:"In Progress" label:<label>.
argument-hint: <KEY | number | words | assignee:me | reporter:<name> | status:<status> | label:<label> | epic:<KEY> | text:<words>>
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: sonnet
---

Finds tickets and shows one in short. Read-only on Jira: nothing is ever written, commented or changed. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **Read-only.** Only `getJiraIssue`, `searchJiraIssuesUsingJql` and `lookupJiraAccountId` on the Atlassian (Rovo) connector. On the claude.ai connector some operations have other names: use the table "Atlassian operation names" in `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md`. Never edit, comment or transition a ticket here. If no Atlassian connection is available, stop once: `Sign in to Atlassian when prompted (type /mcp to connect it), then run this command again.`
- **Suggestions are suggestions.** Never invent acceptance criteria, an expected result or a value the ticket does not give. The readiness score belongs to `/quality-code:ticket-eval`; never say a score here.
- Redact in everything you show: the config's `redact` patterns (without a `redact` in the config, the default customer id `\bU\d{5,}\b`; a `redact` in the config replaces it), e-mails and UUIDs.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop option.
- **Language.** Talk in the language of the user's messages; before they write one, in the ticket's language.
- When a Jira tool needs a `cloudId`, pass the hostname of `jira.site` (no `https://`). Every key you show is a link: `[KEY](<jira.site>/browse/KEY)`.

## Steps

1. **Config.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. If it does not print `ok`, show its lines and stop. Read `jira.site`, `jira.projects`, `features`, `titlePrefixes`, `adapter` and `sides` from `.claude/quality-code.json`.
2. **Find.** From `$ARGUMENTS`, the first rule that applies:
   - A key (`[A-Z][A-Z0-9_]*-\d+`): `getJiraIssue` with fields `summary,issuetype,status,labels,assignee,reporter,created,updated,description,parent,subtasks,issuelinks,comment` and `responseContentFormat` `markdown`. Go to step 3.
   - Only digits: the key is `<first of jira.projects>-<digits>`; as above.
   - Filters `assignee:` `reporter:` `status:` `label:` `epic:` `text:` (a value with spaces is in quotes): one JQL clause each, joined with `AND`, inside `project in (<jira.projects>)`. `assignee:me` and `reporter:me` are `currentUser()`; another name is looked up with `lookupJiraAccountId`. `epic:<KEY>` is `parent = <KEY>`. `text:<words>` is `text ~ "<words>"`. Escape `\` as `\\` and `"` as `\"` in every value first.
   - Anything else is search words: `project in (<jira.projects>) AND text ~ "<words>"`.

   Search with `searchJiraIssuesUsingJql`: the JQL plus `ORDER BY updated DESC`, `maxResults` 10, fields `summary,issuetype,status,assignee`. No hit: `No ticket found. Try other words, or a key.` and stop. One hit: step 3 with it. More: show one line per hit, `[KEY](url) · <type> · <status> · <assignee or unassigned> · <summary>`, then `Which one? Type its number, or stop.` and end the turn.
3. **The ticket, in short.**

   ```
   [KEY](url) · <type> · <status>
   <summary>
   Assignee <name or unassigned> · Reporter <name> · Created <date> · Updated <date>

   <what the ticket asks, in 2 to 4 plain sentences from the description>

   Acceptance criteria: <the scenarios or criteria, one line each, or "none written">
   Subtasks: <KEY status, …>   Links: <KEY relation, …>   Parent: <KEY>
   Last comments: <up to 3, newest first: who, date, one line each>
   ```

   Leave out a line that has nothing. Never paste the whole description.
4. **Suggestions** (skip when the status is Done, Closed or Resolved). At most 15 lines, under this heading:

   `Suggestions for the ticket (nothing is written to Jira; copy what you agree with):`

   - **Ready to use**, only what the ticket itself shows: a feature label from `features` whose words appear in the summary or description and that the ticket does not carry; a title prefix from `titlePrefixes` (on a fullstack project, the `sides` marks, by default `[FE]` `[BE]` `[FS]`) when the summary has none and the ticket says which part it changes; the environment, when the ticket names one but has no Environment section; steps to reproduce that are written in the description but not under a heading of their own.
   - **Skeleton to fill**, when the ticket has no acceptance criteria: an empty `Scenario:` / `Given` / `When` / `Then` block, never with invented content.
   - **Only the author knows**: the expected result when it is missing, the actual result of a bug, the impact.

   Then one line: `To check it is ready for tests: /quality-code:ticket-eval <KEY>`.

## Examples

- `/quality-code:ticket ABC-123`: the ticket in short, with suggestions
- `/quality-code:ticket 123`: the same, in the first configured project
- `/quality-code:ticket assignee:me status:"In Progress"`: my tickets in progress
- `/quality-code:ticket order total discount`: a search by words
