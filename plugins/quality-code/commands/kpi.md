---
description: Show the quality-code KPIs of this project: tickets gated, fill-ins, Jira comments, forced runs, pipeline verdicts and boundary blocks, plus the Quality Program numbers (traceability, completeness, suite honesty, gate integrity, adoption, coverage, mutation kill rate), read from the local audit log and the spec files. Read-only; sends nothing anywhere.
argument-hint: [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kpi.mjs":*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/consumption.mjs":*)
model: haiku
effort: low
---

Shows how the plugin is used in this project. You relay; the script reads and counts. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The script decides.** `kpi.mjs` reads the audit log and counts. Never compute, round, change or add up a count yourself, and never grade a team or a ticket from it.
- **Never read the log files yourself.** The card holds only counts, ticket keys, criterion names and dates.
- **Local only.** The audit log lives in `.claude/quality-code/audit/`, git-ignored, on this machine. Nothing is sent anywhere. Run only the scripts below (`kpi.mjs`, and `consumption.mjs` for option 1); no other tool.
- **Never ask for a token**, key or password in the chat.
- The script runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/bin/kpi.mjs" …`. With `root` in `.claude/quality-code.json` the project root is that folder: every path the scripts print or take is relative to it, so the files you read and write are under it.

## Steps

1. **Run.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/kpi.mjs" $ARGUMENTS`. Pass only the options in `$ARGUMENTS` (`--since`, `--until`); with none, the script shows the last 30 days. Do not pass `--json`.
   - Exit 3: no audit data yet. Show its lines as they are (they say where it looked) and stop.
   - Exit 2: show its lines as they are and stop.
2. **Card.** Show the card exactly as printed. Drop the `KPI_JSON:` line. Add nothing, explain nothing, grade nothing. Then show this card and end the turn:

   ```
   What next?
   1. The AI cost of the same days
   2. Another period
   3. Stop
   ```

   On `1`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/consumption.mjs" --since <since> --until <until>` with the dates from the card's `AI cost:` line (this is what `/quality-code:consumption` runs), show its card exactly as printed without the `CONSUMPTION_JSON:` line, and stop. On `2`, ask `Since when? For example 7d, 30d or 2026-10-01.`, then do step 1 again with that `--since` (and the same `--until`, if any). On `3`, stop.

## Examples

- `/quality-code:kpi` shows the last 30 days.
- `/quality-code:kpi --since 7d` shows the last 7 days.
- `/quality-code:kpi --since 2026-10-01 --until 2026-10-31` shows October.
