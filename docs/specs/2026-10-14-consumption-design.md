# `/quality-code:consumption`: AI usage and estimated cost of the plugin's runs

Status: decided by the controller · Date: 2026-10-14 · Owner: Elvis Zefaj · Jira: AGT-44 · Builds on:
[part 1](2026-10-12-part-1-core-config-design.md), [start](2026-10-14-start-command-design.md)

## 1. Goal

A team lead asks "what do the quality-code runs cost us?". One command answers from what is already
on the developer's machine: Claude Code's local transcripts. It shows runs, tokens and an estimated
cost, grouped by command, ticket, day or model, with everything else the project used on one
separate line.

## 2. Decisions

| Decision | Value |
|---|---|
| Source | Claude Code transcripts under `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<slug>/`. Nothing else. |
| Exposure | Read-only, local only, sends nothing. Output holds counts, model ids, command names, ticket keys and dates; never prompt, answer, argument or tool text. |
| Price | API list prices per million tokens in `core/consumption/prices.mjs`, with an as-of date and the source (the `claude-api` skill). Always labelled an estimate; subscription plans are not billed this way. |
| Unknown model | Tokens counted, cost `unknown price`. Never guessed. Fast-mode responses count as unknown too. |
| Override | `--prices <file.json>` adds or replaces models. |
| Dates | UTC. A run counts on the day it started, with all its usage (subagents included). |

## 3. Reading the transcripts

- **Folder.** The slug is the absolute project path with every character that is not a letter or
  digit replaced by `-` (`/home/user/agentic-testing` → `-home-user-agentic-testing`). If that
  folder has no `*.jsonl`, every folder under `projects/` whose sessions have `cwd` equal to the
  project root is used instead (long paths get a shortened slug).
- **Sessions.** `<sessionId>.jsonl`; subagents in `<sessionId>/subagents/agent-<id>.jsonl` with
  `.meta.json`.
- **Usage.** Assistant lines with `message.usage` and `message.model`. One API response is written
  on up to five lines with the same usage: count it once per `requestId` (else `message.id`).
  `<synthetic>` messages are skipped. Cache writes split into 5-minute and 1-hour by
  `usage.cache_creation`.
- **Runs.** A user line with `<command-name>/quality-code:<name></command-name>` starts a run of
  `<name>`. The run ends at the next real prompt or at any other slash command. Not real prompts:
  tool results, `isMeta` expansions, system reminders, task notifications, interruptions, and
  answers to a numbered card (a number or several, a ticket key, `yes`, `no`, `none`), so a
  card-driven flow stays one run.
- **Subagents** belong to the run whose tool call spawned them (`meta.toolUseId`), even when they
  work past the next prompt; without a match, to the run active when they started.
- **Ticket key.** First match in `<command-args>` of the project's keys (`keySource` from
  `core/checks/keys.mjs` with `.claude/quality-code.json`), else `[A-Z][A-Z0-9]+-\d+`.

## 4. The CLI and the card

```
node core/consumption/cli.mjs [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD] [--by command|ticket|day|model] [--prices file] [--json]
```

Defaults `--since 30d --by command`. Exit 0 ok, 2 usage error (one line on stderr), 3 no transcripts
found (stdout says where it looked).

```
quality-code consumption · last 30 days · my-app

Runs      3 runs in 2 sessions · 6 API requests
Tokens    in 3.0k · out 5.0k · cache write 2.0k · cache read 10k
Cost      $0.10 + unknown estimated · $0.03 + unknown per run

By command   runs     in    out   cache               cost            per run
  check         2   2.0k   4.0k     12k              $0.09              $0.05
  start         1   1.0k   1.0k       0   <$0.01 + unknown   <$0.01 + unknown

Other (not quality-code): 3 requests · in 30 · out 300 · cache 0 · <$0.01
Unknown price for claude-x: tokens counted, no cost.
Estimate at API list prices as of 2026-10-06 (claude-api skill); subscription plans are not billed this way.
CONSUMPTION_JSON:{...}
```

`/quality-code:consumption` runs it, shows the card without the machine line, then
`1. By ticket / 2. By day / 3. By model / 4. Stop`, ending the turn after each card.

## 5. Files

| File | Change |
|---|---|
| `core/consumption/transcripts.mjs` | new: folders, sessions, run attribution |
| `core/consumption/prices.mjs` | new: price table, cost, override |
| `core/consumption/report.mjs` | new: period, groups, card |
| `core/consumption/cli.mjs` | new |
| `commands/consumption.md` | new |
| `test/consumption/*.test.mjs`, `test/consumption/fixtures/` | new: synthetic transcripts only |
| `test/consumption-command.test.mjs` | new |

## 6. Acceptance criteria

1. On the fixtures: one response on three lines counts once; a subagent working after the next
   prompt counts for the run that spawned it; a card answer keeps the run; another command ends it.
2. Unknown models show tokens and `unknown price`; `--prices` can price them.
3. No `SECRET-` text from the fixtures appears in any output.
4. No transcripts: exit 3 and the folders looked at.
5. `npm test` green (but the two known container failures); no project values under `core/`.
