# QA and PO: tickets without a repo, attachments and links, Figma fill-in, project-wide evaluation

Status: decided with the owner on 22 Oct · Owner: Elvis Zefaj · Jira: AGT-44 · Release: 0.13.0

## 1. Goal

Quality Code is for QA and product owners too, not only developers. They work on tickets, not code,
so the ticket commands must run without a repository, the score must credit what they add to a
ticket (attachments, links), Figma designs must help fill a thin ticket, and a PO must see how a
whole project's tickets do against the bar.

## 2. Decisions

| # | Item | Decision |
|---|---|---|
| 1 | No repo | A **personal setup**, saved in the user's Claude folder (`~/.claude/quality-code.json`, or `$CLAUDE_CONFIG_DIR`). The ticket commands work in any folder with it. Inside a repo, the repo's `.claude/quality-code.json` wins. |
| 2 | 100 points | Attachments and links join the rubric, the bar stays at 70 (weights below). Every ticket's score changes; the parity fixtures are re-baselined and the CHANGELOG says so. |
| 3 | Figma | When a ticket links Figma, the fill-in can **draft** the missing items from the design and the branch's local changes. Each draft is shown; the script decides whether it counts; only on the user's yes is it appended to the Jira ticket. Nothing is overwritten. |
| 4 | Project-wide | New `/quality-code:tickets-eval <PROJECT> [--user <name>] [--status <s>] [--limit N]`: scores the project's tickets, read-only, and shows pass/refuse per ticket and how much of the project passes. |

## 3. Weights

| Item | Vitest (backend) | Playwright (frontend) |
|---|---|---|
| Acceptance criteria present | 25 (was 30) | 25 (was 30) |
| Testable criteria | 15 | 15 |
| Steps or user story | 10 (was 15) | 10 |
| Expected behaviour | 15 | 10 |
| **Attachments** (a screenshot, video or file on the ticket) | **10** (new) | **10** (new) |
| **Links** (a linked issue, or a web link: Figma, Confluence, other) | **5** (new) | **5** (new) |
| Context / summary section | 5 (was 10) | — |
| Title prefix | 5 | — |
| Feature label | 5 | 10 (was 15) |
| QA plan | — | 10 (was 15) |
| Environment | 5 | 5 |
| **Total** | 100 | 100 |

Omitted keys (no title prefixes or features configured) still drop out of the total as today. A
fullstack ticket keeps "both rubrics, the lower decides".

The fill-in cannot attach a file: for attachments it says where to add one on Jira and re-scores when
the user says it is done. A link can be given in the chat; it is appended as a web link line.

## 4. Personal setup (no repo)

- `/quality-code:setup` asks first: `1. A repo (developers) / 2. No repo, Jira only (QA, PO)`. Option 2
  skips the project folder and stack and asks the Jira site, the project(s) and which tickets they
  are (`frontend / backend / both`, default both → `adapter: "fullstack"` for scoring only).
- `config.mjs` finds the config in this order: the repo's `.claude/quality-code.json`, then the
  personal file. `config check` says which one it used.
- `ticket-eval`, `ticket`, `tickets-eval` work with either. `write`, `check`, `seed`, `xray` and
  `start` need a repo: with only a personal setup they say `This needs a repo. Open the project
  folder, or run /quality-code:setup there.`
- Saved tickets go to `~/.claude/quality-code/tickets` with a personal setup (never into the folder
  the user happens to be in).

## 5. tickets-eval

- One Jira search (`searchJiraIssuesUsingJql`): `project = <KEY>` plus `AND assignee = "<user>"` /
  `status = "<s>"` when given, `ORDER BY updated DESC`, `maxResults` = `--limit` (default 50, cap 200),
  with the fields the gate reads. The model writes the results to one file; `core/batch.mjs`
  sanitizes and scores them all in one run (no model judgement).
- Card: one line per ticket (key, score, pass/refuse, the biggest missing item), then the project:
  tickets scored, passing (number and %), average score, and the three items most often missing.
- Read-only: never comments or edits Jira. `--json` prints only the machine line.

## 6. Figma fill-in

- Links come from the ticket's web links and description (`figma.com/design|file|proto|board`).
- In the refuse card's guided fill-in, when the ticket has a Figma link and the Figma connector is
  connected, the list offers `Draft from Figma and my changes` for the items a design can answer
  (acceptance criteria, expected behaviour, steps). The model reads the design (frames, labels,
  states) and the branch's code changes (`branch.mjs --detect`, files of kind `code`) and drafts each
  item. Each draft is shown as it would be added; `1. Use it / 2. Edit / 3. Skip`. Used drafts go
  through `cli.mjs add` like typed answers (the script decides), then the usual Jira preview and
  push (append only).
- Without a repo, only the design is used.

## 7. Release

0.13.0. CHANGELOG: Added (personal setup, tickets-eval, Figma drafts), Changed (weights; every
score changes; parity re-baselined). README features table and the Guide updated.
