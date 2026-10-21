---
description: Show the AI usage and estimated cost of quality-code runs in this project, read from Claude Code's local transcripts. Read-only; sends nothing anywhere.
argument-hint: [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD] [--by command|ticket|day|model] [--prices file.json]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/core/consumption/cli.mjs":*)
model: haiku
effort: low
---

Shows what the plugin's runs used. You relay; the script reads and counts. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/core/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The script decides.** `cli.mjs` reads the transcripts, counts the tokens and prices them. Never compute, round, change or add up a count or a cost yourself.
- **Never read the transcripts yourself**, and never show prompt or answer text. The card holds only counts, command names, ticket keys and dates.
- **Local only.** Nothing is sent anywhere. Run only the script below; no other tool.
- **The cost is an estimate** at API list prices. Subscription plans are not billed this way; the card says so. Never present it as a bill.
- **Never ask for a token**, key or password in the chat.
- The script runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/core/consumption/cli.mjs" …`.

## Steps

1. **Run.** Run `node "${CLAUDE_PLUGIN_ROOT}/core/consumption/cli.mjs" $ARGUMENTS`. Pass only the options in `$ARGUMENTS` (`--since`, `--until`, `--by`, `--prices`); with none, the script shows the last 30 days by command. Do not pass `--json`.
   - Exit 3: no transcripts were found. Show its lines as they are (they say where it looked) and stop.
   - Exit 2: show its lines as they are and stop.
2. **Card.** Show the card exactly as printed. Drop the `CONSUMPTION_JSON:` line. Add nothing, explain nothing, grade nothing. Then show this card and end the turn:

   ```
   See it another way?
   1. By ticket
   2. By day
   3. By model
   4. Stop
   ```

   On `1`, `2` or `3`, run the script again with the same `--since`, `--until` and `--prices` as before and `--by ticket`, `--by day` or `--by model`, then do step 2 again. On `4`, stop.

## Examples

- `/quality-code:consumption` shows the last 30 days by command.
- `/quality-code:consumption --since 7d --by ticket` shows the last 7 days by ticket, for example `ABC-123`.
- `/quality-code:consumption --prices prices.json` prices with your own rates: `{ "asOf": "2026-10-01", "models": { "<model id>": { "input": 4, "output": 20, "cacheWrite5m": 5, "cacheWrite1h": 8, "cacheRead": 0.2 } } }` in dollars per million tokens.
