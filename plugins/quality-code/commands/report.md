---
description: Read-only reports of this project, read locally, sent nowhere. --kpi (the default) shows the quality-code KPIs: tickets gated, fill-ins, Jira comments, forced runs, pipeline verdicts and boundary blocks, plus the Quality Program numbers (traceability, completeness, suite honesty, gate integrity, adoption, coverage, mutation kill rate). --cost shows the AI usage and estimated cost of the plugin's runs, from Claude Code's local transcripts.
argument-hint: [--kpi | --cost [--by command|ticket|day|model] [--prices file.json] [--session]] [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD] [--report]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kpi.mjs":*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/consumption.mjs":*)
model: haiku
effort: low
---

Drop `--kpi` or `--cost` from `$ARGUMENTS` and follow one guide instead of this file, with the rest of the arguments:
- **`--cost`:** read `${CLAUDE_PLUGIN_ROOT}/guides/report-cost.md` and follow it.
- **`--kpi`, or neither:** read `${CLAUDE_PLUGIN_ROOT}/guides/report-kpi.md` and follow it.

Both guides show their cards the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool. Run each plugin script exactly as written: one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it.

## Examples

- `/quality-code:report` shows the KPIs of the last 30 days.
- `/quality-code:report --kpi --since 7d` shows the KPIs of the last 7 days.
- `/quality-code:report --cost` shows the AI cost of the last 30 days by command.
- `/quality-code:report --cost --since 7d --by ticket` shows the AI cost of the last 7 days by ticket.
