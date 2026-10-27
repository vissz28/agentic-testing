---
description: Write XRay test cases for QA from a Jira ticket that passes the readiness gate: one CSV with every case, and per ticket a case.csv (and case.xlsx) to import into Xray. No spec, no checks. /quality-code:spec adds the same cases for the tests it writes.
argument-hint: <KEY> [--route PATH] [--no-extras] [--dry-run] [--ci] | --sync [KEY]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
---

Writes XRay test cases from a ticket, and nothing else: no spec file, no test run, no check. A case is what a Playwright test of the ticket checks, as steps QA can read (action, data, expected result), named after that test so the two stay linked. `/quality-code:spec` writes the same cases for the tests it writes; this command is for QA when there is no test to write yet. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Where files go.** When the command has ended (after its last card is answered, or its last step when it shows none), follow `${CLAUDE_PLUGIN_ROOT}/guides/save-place.md`: the first run of a project asks once where its files and logs are kept.
- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The script writes.** `xray.mjs` numbers the cases, writes the CSV and the per-ticket files, and skips a case that is already there. Never edit those files yourself.
- **Never invent.** An expected result comes from the ticket (its Then, its QA plan) or from the guide's extra probes; a step whose result the ticket does not give has no expected result. Never a value the ticket does not give.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop option. Read only the first word for this; a sentence that gives a result (and no number) is a typed answer.
- **Language.** Talk in the language of the user's messages; before they write one, in the ticket's language. Write the cases in the ticket's language. Script output and cards stay as printed.
- **Never ask for a token**, key or password in the chat, and never show one.
- Refer to Jira tools by operation name on the Atlassian connector.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/bin/<script>" …`. With `root` in `.claude/quality-code.json` the project root is that folder: every path the scripts print or take is relative to it, so the files you read and write are under it. Drop the machine lines (`TICKET_EVAL_JSON:`, `PROJECT_MISMATCH:`, `SIDE_JSON:`, `E2E_FOLDER_JSON:`) when you show output.

## Steps

1. **Check.** With `--sync` in `$ARGUMENTS`, run only `node "${CLAUDE_PLUGIN_ROOT}/bin/xray.mjs" sync` (add the key when one follows `--sync`): it rewrites the per-ticket files from the CSV. Show its lines and stop. Otherwise the first `[A-Z][A-Z0-9_]*-\d+` in `$ARGUMENTS` is the key. No key: `pass a key: /quality-code:xray <KEY>`. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. If it does not print `ok`, show its lines and stop (a missing config means: run `/quality-code:setup`). If it prints `ok (personal: …)`, or you are not inside a git repo, say `This needs a repo. Open the project folder, or run /quality-code:setup there.` and stop. Read `.claude/quality-code.json`: `ticketsDir` (the path on the `tickets folder:` line `config check` printed, used as it is: where this person keeps the project's files, in the repo or outside it), `features` and the `xray` block. No `xray` block: say `XRay test cases are off in this project: add an "xray" block to .claude/quality-code.json (docs/GUIDE.md, "XRay test cases").` and stop.
   - **`--dry-run`:** go through steps 1 to 4 and show the plan card without its numbered options, then stop: no case written, nothing posted. The gate still saves the sanitized ticket (`<ticketsDir>/<KEY>/ticket.json`). A refused ticket ends the dry run at the gate's report: no refuse card, so no comment, fill-in or Jira update. **`--ci`:** never ask: a card that needs an answer stops the command instead (`--ci` stops here: <the question, in one line>), and step 4 writes without the card.

   Then read `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` and follow it, as the start command does. From the plugin settings (each empty when not set): `jira_email` is `${user_config.jira_email}`, `gitlab_username` is `${user_config.gitlab_username}`, `gitlab_api_url` is `${user_config.gitlab_api_url}`. Jira is required: go on only when its card lets you continue.
2. **Ticket and gate.** Read `${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md` and follow its steps 1–5 with `<KEY>` as `$ARGUMENTS`, no flags: read, save, sanitize and score.
   - **Refused:** its refuse card and its flow, as written there. Go on only when that flow ends with the ticket passing (the guided fill-in, then `1` or `2` on its Jira update card). Option 3 (continue anyway), a comment posted, a cancel or a stop: stop, `XRay test cases need a ticket that passes the gate.` Nothing written.
   - **Passed:** go on with `<ticketsDir>/<KEY>/ticket.json`, the only copy of the ticket; never edit it. Keep the `feature` and the `route` from the last `TICKET_EVAL_JSON:` line. The scenarios are the ticket's plus the QA plan's (`qaPlan.scenarios` in `ticket.json`), each name once; where both have a scenario with the same name, the ticket's wins.
   - **Fullstack:** a ticket whose `side` (the last `TICKET_EVAL_JSON:` line) is `backend` gets no XRay test cases: say `XRay test cases are written for frontend tickets (Playwright tests).` and stop.
3. **Screen.** A `--route PATH` in `$ARGUMENTS` is used as it is: it must start with `/` and be one line; otherwise say `--route must be a path in the app starting with /, like /orders` and stop. Without one, the `route` from step 2 is used, with no card. With neither, show `/quality-code:spec`'s screen card (its step 3, Playwright) and do as it says.
4. **Plan.** Read `${CLAUDE_PLUGIN_ROOT}/guides/playwright-writing.md` for its extra probes, then `playwright.guide` when it is set. One case per scenario, with the result it checks as a plain sentence from the ticket's Then. Then, unless `$ARGUMENTS` has `--no-extras`, at most 3 extra probes from the guide's list that apply to this screen, one case each. Show this card and end the turn:

   ```
   XRay test cases for <KEY>, on <route>
     From the ticket
       <scenario, in a few words>
     Extra (not in the ticket)
       <probe, in a few words>
   1. Write these test cases
   2. Leave out the extras
   3. No, I'll type the right result
   4. Stop
   ```

   With no extra probe, leave out the `Extra (not in the ticket)` lines and option 2, and number the rest in order. On `Leave out the extras`, drop them and show the card again. On `No, I'll type the right result`, ask `What should the result be?` and add the answer to the ticket as ticket-eval's guided fill-in does (`ticket.mjs add --in @<ticketsDir>/<KEY>/ticket.json ac_present -- "<answer>"`; its Jira update card follows when it is accepted), then show the card again with the new result. On `Stop`, stop.
5. **Write.** Write `<ticketsDir>/<KEY>/xray.json`: a JSON list with one case per test, each scenario and each extra probe:

   ```
   { "key": "<the test's name>", "summary": "<what it checks, one sentence>", "ticket": "<KEY>",
     "feature": "<the feature label>", "steps": [{ "action": "…", "data": "…", "expected": "…" }] }
   ```

   - **key:** the Playwright test's name: the scenario's name for a scenario, `Extra: <what it probes>` for an extra probe, as `/quality-code:spec` names them. It links the case to its test.
   - **steps:** from the scenario's Gherkin, in order: each `Given` and `When` is an `action`, each `Then` the `expected` of the step before it. The first step opens the screen (`Open <route>`). `data` holds the values the step types or picks, only when there are any. An extra probe's steps are what it probes and the result the guide lets it expect.
   - **Leave out** what you do not know: `description`, `label`, `priority`, `epic`. `testType` is `Cucumber` unless the case has no Gherkin behind it (`Generic`).

   Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/xray.mjs" add @<ticketsDir>/<KEY>/xray.json`. Exit 2 is a config or input error: show its lines; when it names a case, fix that case in `xray.json` once and run again.
6. **Report.** Show the script's lines as printed: the case numbers, a case that was already there, and the files for QA. Add one line: `QA imports the case file in Xray: Test Repository, Import, Excel or CSV.` Nothing is graded and no test is written: say `/quality-code:spec <KEY>` writes the tests with the same names when you need them.

## Examples

- `/quality-code:xray ABC-123`: gate the ticket, plan the cases, write them for QA
- `/quality-code:xray ABC-123 --no-extras`: only the ticket's scenarios
- `/quality-code:xray ABC-123 --route /orders/new`: cases for this screen
- `/quality-code:xray ABC-123 --dry-run`: the gate and the plan, then stop; no case is written and nothing is posted
- `/quality-code:xray --sync ABC-123`: rewrite the ticket's case.csv and case.xlsx from the CSV
