# Continue anyway, the audit log and `/quality-code:kpi`

Status: decided by the owner (AGT-87) · Date: 2026-10-14 · Owner: Elvis Zefaj · Jira: AGT-44 · Builds on:
[part 1](2026-10-12-part-1-core-config-design.md), [part 2](2026-10-14-part-2-shared-checks-design.md),
[part 4a](2026-10-14-part-4a-vitest-pipeline-design.md), [consumption](2026-10-14-consumption-design.md),
[part 5 §8](2026-10-14-part-5-rollout-design.md)

## 1. Goal

Part 5 §8 left two items open: what refuse option 3 ("continue anyway") leads to, and whether to
build the run log, audit log and KPI rollup. The owner decided (AGT-87) to carry both over from the
warehouse harness, generalized for any Jira project.

## 2. What the warehouse harness did (AGT-31, done)

- Refuse option 3, `🔴 [RISK / NOT RECOMMENDED] Continue anyway (developers only)`, passed
  `--incomplete-ticket` to the pipeline.
- The result card opened with `[RISK / NOT RECOMMENDED] Ticket incomplete (<score>/<bar>)`, red in a
  terminal; the same line went into the run report.
- The audit entry recorded the override, so its `kpi.mjs` could count forced runs.
- Its audit logs (`.claude/audit/ticket-eval.jsonl`, `jira-test.jsonl`) were **committed** and grew
  with every run. AGT-34 removed them.

## 3. Decisions

| Decision | Value |
|---|---|
| Forced run | `core/pipeline/cli.mjs --incomplete-ticket <score>`: a whole number below the bar (`THRESHOLD` in `core/score.mjs`, 70). Anything else is a usage error (exit 2) before anything runs. |
| Its mark | The outcome gets `incompleteTicket: { score, bar }`; the card's first line after the title is `🔴 [RISK / NOT RECOMMENDED] Ticket incomplete (<score>/<bar>)`, for every verdict. ANSI red when stdout is a terminal and `NO_COLOR` is unset; chat gets the emoji. |
| Verdict | Unchanged. The script decides; the mark never softens or hardens a verdict or an exit code. |
| Run report | The card is the run report: `/quality-code:write` and `/quality-code:check` show it as printed. No separate `run.md`. |
| Audit log | `.claude/quality-code/audit/<kind>.jsonl`, one JSON line per event, **local and git-ignored** (the lesson of AGT-34). |
| Kept out of git twice | Setup's runtime `.gitignore` lines gain `.claude/quality-code/audit/` (`.claude/quality-code/*.jsonl` does not reach a subfolder), and the folder carries its own `.gitignore` (`*`), so a project set up before this change is covered too. |
| Content | Keys, numbers and fixed words only. Every entry is rebuilt from a whitelist per kind: a ticket key that is not `[A-Z][A-Z0-9]*-\d+` becomes `null`, a word that is not a lowercase id is dropped. Never ticket text, never a path, never a finding, no customer data. |
| Failure | A failed append returns false and never throws: it never changes a result, an output or an exit code. |
| Off switch | `--no-audit` on `core/cli.mjs` and `core/pipeline/cli.mjs`, or `QC_NO_AUDIT=1`. The committed sample's end-to-end test sets it. |
| Rollup | `node core/kpi.mjs [--since 7d\|30d\|YYYY-MM-DD] [--until YYYY-MM-DD] [--json]`, the `/quality-code:kpi` command. Exit 0 ok, 2 usage, 3 no audit data yet (it says where it looked). |
| Cost | Not in the rollup: the card points to `/quality-code:consumption` for the same days. |

## 4. Events

| Kind | Written by | Fields (plus `date`, ISO UTC) |
|---|---|---|
| `gate` | `cli.mjs score` (also with `--ci`, `--json`) | `key`, `issuetype`, `score`, `gate`, `rubric`, `legacy`, `missing` (criterion keys), `filled` (accepted fill-in answers on the ticket) |
| `pipeline` | `pipeline/cli.mjs`, every run that produced an outcome | `key`, `verdict`, `decidedBy`, `adapter`, `steps` (`check`, `status` only), `counts` (`specs`, `passed`, `failed`, `skipped`), `incompleteTicket` |
| `override` | `pipeline/cli.mjs` with `--incomplete-ticket`, once validated, before the run | `key`, `score`, `bar` |
| `jira` | `cli.mjs jira-posted <KEY> comment\|update` | `key`, `action` |

Posting to Jira goes through the Atlassian connector, not a script, so `ticket-eval` calls
`jira-posted` after a successful refuse comment (`comment`) or fill-in push (`update`). Nothing is
logged when the post fails. The boundary hook keeps its own log, `.claude/quality-code/boundary.jsonl`
(part 2 §9.5); the rollup reads it as it is.

## 5. The KPI card

```
quality-code KPI · last 30 days · my-service

Gate        5 tickets · 3 passed · 2 refused · 7 evaluations
Scores      0-29: 1 · 30-49: 0 · 50-69: 1 · 70-89: 2 · 90-100: 1
Missing     acceptance criteria 3 · steps to reproduce 3 · testable AC 1
Filled in   1 refused ticket filled in here, then passed
Jira        2 comments posted · 1 ticket updated
Forced      2 runs past the gate (continue anyway): ABC-2, ABC-4
Pipeline    6 runs · 2 green · 2 checks failed · 1 tests red · 1 not verified
Decided by  mutation 2 · tests 1 · types 1
Boundary    2 writes blocked

AI cost: /quality-code:consumption --since 2026-09-15 --until 2026-10-14
KPI_JSON:{…}
```

- **Tickets** are distinct keys; pass, refuse and the score bands use each ticket's last evaluation in
  the period. An evaluation without a key is its own ticket.
- **Missing**: the top three criteria across refused tickets (each ticket's last refusal), named by
  the rubric label up to its first bracket or colon.
- **Filled in**: tickets refused, then passed on a later evaluation whose ticket carries accepted
  fill-in answers. A ticket that passed after an edit on Jira is not counted.
- **Forced**: `override` events, with their keys.
- Dates are UTC; the period works as in `/quality-code:consumption` (default the last 30 days).

## 6. Not in this change

- Wiring option 3 in `/quality-code:write` (another change is editing `write.md` and `start.md`):
  today `write` stops on option 3. The wiring passes `--incomplete-ticket <score>` to the pipeline
  call so the card carries the mark.
- README and CHANGELOG entries, and the version bump.
