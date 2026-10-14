---
description: Write Vitest or Playwright tests for a Jira ticket that passes the readiness gate, in the team's test folders, then check them with the pipeline and show its card.
argument-hint: <KEY> [--layer NAME] [--target PATH] [--route PATH] [--no-extras]
---

Writes tests from a ticket. You write the tests; the scripts gate the ticket and grade the tests. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

The steps are the same for both adapters. Where a **Vitest** project (unit tests against a source file) and a **Playwright** project (e2e tests against a screen of the app) differ, the step says so.

## Rules

- **The scripts decide.** `cli.mjs` scores the ticket; the pipeline grades the tests. Never compute, change or soften a score, a verdict or a count, and never say a test is good yourself.
- **Never edit application code.** Write only spec files, only in the layer folders (Vitest) or the e2e folder (Playwright). Source files, config and other tests stay as they are. If the boundary hook denies a write, read its reason and write in a test folder instead.
- **Never weaken or delete a test** to make a check pass: no removed `expect`, no looser matcher, no `.skip`, no deleted `it` or `test`.
- **Never ask for a token**, key or password in the chat, and never show one.
- Refer to Jira tools by operation name on the Atlassian connector.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/core/<script>" …`. Drop the machine lines (`BRANCH_JSON:`, `TICKET_EVAL_JSON:`, `E2E_FOLDER_JSON:`, `PIPELINE_JSON:`) when you show output.
- **Run marker.** Once `run start` has succeeded, every way out of this command runs `node "${CLAUDE_PLUGIN_ROOT}/core/checks/cli.mjs" run stop` first: the card, a stop, an error, a crash of a script. `run stop` is safe to run twice.

## Steps

1. **Check.** The first `[A-Z][A-Z0-9]*-\d+` in `$ARGUMENTS` is the key. No key: `pass a key: /quality-code:write <KEY>`. Run `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" config check`. If it does not print `ok`, show its lines and stop (a missing config means: run `/quality-code:setup`). Read `.claude/quality-code.json`: its `adapter` is `vitest` or `playwright`, and `ticketsDir` (default `.claude/quality-code/tickets`).
   - **Vitest:** `--route` and `--no-extras` are for Playwright projects: if `$ARGUMENTS` has one, say `--route and --no-extras are for Playwright projects. Use --layer NAME or --target PATH here.` and stop. Read the layers from `vitest.layers`; with no `vitest.layers`, there is one layer, `unit`, in `test/`. A `--layer NAME` in `$ARGUMENTS` keeps only that layer; a name that is not a layer: `No layer <NAME>. The layers are <names>.` and stop.
   - **Playwright:** `--layer` and `--target` are for Vitest projects: if `$ARGUMENTS` has one, say `--layer and --target are for Vitest projects. Use --route PATH to name the screen.` and stop. Run `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" config e2e-folder` and read the `E2E_FOLDER_JSON:` line: its `folder` is the e2e folder, where the spec goes. If it exits with 2, show its lines and stop. Read `playwright.guide` and `features` too.

   Then read `${CLAUDE_PLUGIN_ROOT}/core/connectors.md` and follow it, as the start command does. The `gitlab_username` from the plugin settings is `${user_config.gitlab_username}` (empty when not set). Jira is required: go on only when its card lets you continue.
2. **Ticket and gate.** Read `${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md` and follow its steps 1–5 with `<KEY>` as `$ARGUMENTS`, no flags: read, save, sanitize and score. The script scores; never write a test for a ticket it refuses.
   - **Refused:** its refuse card and its flow, as written there. If that flow ends with the ticket passing (the guided fill-in and `1. Continue`), go on. On option 3, the developer override, go on only when the ticket-eval flow lets it (the brief's `derivable` is at least 1): remember the brief's `score` from `TICKET_EVAL_JSON` as the incomplete score, and say `The ticket is incomplete: the result carries the 🔴 [RISK / NOT RECOMMENDED] mark.` Anything else (a comment posted, a cancel, a stop), stop: `Writing tests needs a ticket that passes the gate, or option 3.` No run marker, no file written.
   - **Passed:** go on with `<ticketsDir>/<KEY>/ticket.json`. Read from it the `summary`, the `issuetype`, the scenarios and the expected values. This file is the only copy of the ticket; never edit it.
   - **Playwright:** also keep the `route` and the `feature` from the last `TICKET_EVAL_JSON:` line. The scenarios are the ticket's plus the QA plan's (`qaPlan.scenarios` in `ticket.json`), each name once; where both have a scenario with the same name, the ticket's wins.
3. **Target.** What the tests check: a source file (Vitest) or a screen of the app (Playwright).
   - **Vitest:** a `--target PATH` in `$ARGUMENTS` is used as it is: it must be an existing file that is not a spec; otherwise say so and stop. Without one, propose the source file the ticket's behaviour lives in, from the ticket, the branch (`node "${CLAUDE_PLUGIN_ROOT}/core/branch.mjs" --detect`, the `files` of kind `code` whose `status` is not `D`) and a search of the code for the ticket's terms. Show up to two candidates, best first, in this card and end the turn. One clear candidate still gets the card.

     ```
     Which code does this ticket change?
     1. <path>
     2. <path>
     3. Another file
     4. Stop
     ```

     Paths are fine here: a developer reads this card. On `3`, ask `Which file? Type its path from the project root.` and check it exists and is not a spec. On `4`, stop.
   - **Playwright:** a `--route PATH` in `$ARGUMENTS` is used as it is: it must start with `/` and be one line; otherwise say `--route must be a path in the app starting with /, like /orders` and stop. Without one, the `route` from step 2 (the configured feature whose label is on the ticket) is used, with no card. With neither, show this card, one line per entry of `features` that has a `route`, then `Another screen` and `Stop`, and end the turn:

     ```
     Which screen does this ticket test?
     1. <route>   (<feature label>)
     2. <route>   (<feature label>)
     3. Another screen
     4. Stop
     ```

     On `Another screen`, ask `Which screen? Type its path in the app, for example /orders.` and check it starts with `/`. On `Stop`, stop.
4. **Plan.**
   - **Vitest:** read `${CLAUDE_PLUGIN_ROOT}/core/guides/vitest-writing.md`, then the `guide` of each layer that has one (the team's own rules on top of it; they win where they differ). Read the target. Give each scenario of the ticket one line and one layer (the first layer unless a layer guide says otherwise). Show this card and end the turn:

     ```
     Tests for <KEY>, against <target>
       <layer>   <scenario, in a few words>
       <layer>   <scenario, in a few words>
     1. Write these tests
     2. Change the layers
     3. Stop
     ```

     On `2`, ask which scenario goes in which layer (the layer names only), then show the plan card again. On `3`, stop.
   - **Playwright:** read `${CLAUDE_PLUGIN_ROOT}/core/guides/playwright-writing.md`, then `playwright.guide` when it is set (the team's own rules on top of it; they win where they differ). Read at most two specs already in the e2e folder, the closest to the screen, for their imports, fixtures, login and stub shapes. To find the real roles, labels and texts the screen shows, you may read the branch's changed files of kind `code` for that screen (`node "${CLAUDE_PLUGIN_ROOT}/core/branch.mjs" --detect`); never show them in the chat. Give each scenario one line. Then, unless `$ARGUMENTS` has `--no-extras`, pick at most 3 extra probes from the guide's list that apply to this screen and that the guide lets you assert. Show this card and end the turn:

     ```
     Tests for <KEY>, on <route>
       From the ticket
         <scenario, in a few words>
       Extra (not in the ticket)
         <probe, in a few words>
     1. Write these tests
     2. Leave out the extras
     3. Stop
     ```

     With no extra probe, leave out the `Extra (not in the ticket)` lines and option 2, and number the rest in order. On `Leave out the extras`, drop them and show the plan card again. On `Stop`, stop.
5. **Write.** Run `node "${CLAUDE_PLUGIN_ROOT}/core/checks/cli.mjs" run start --key <KEY>` before writing any file. If it exits with an error because a run is already active, show its line, then this card and end the turn:

   ```
   Another test-writing run is active.
   1. Stop the other run and start this one
   2. Stop
   ```

   On `1`, run `node "${CLAUDE_PLUGIN_ROOT}/core/checks/cli.mjs" run stop`, then `run start --key <KEY>` again. On `2`, stop (the other run stays as it is). Any other error: show its lines and stop.

   - **Vitest:** write one spec file per layer that has scenarios, in that layer's folder:
     - **Name:** `<target basename>.<key lowercased>.spec.ts`, for example `pricing.abc-123.spec.ts` for `src/pricing.ts` and `ABC-123`. Use `.spec.js` when the project has no `tsconfig.json`. If the file already exists, keep every test in it and add to it.
     - **Shape:** all tests inside one `describe('<KEY> <summary>', …)` block, at the top level of the file. One `it` per scenario, named after the scenario.
     - **Values:** the real expected values from the ticket, written as they are in the ticket, inside an `expect(...)`. Never invent a value the ticket does not give; a behaviour the ticket does not pin down is an `it.todo`.
     - **Imports:** import the target directly. Mock only the boundary the guides say to mock.
   - **Playwright:** write one spec file in the e2e folder:
     - **Name:** `<folder><screen>.<key lowercased>.spec.ts`, where `<screen>` is the route's parts joined by `-` in lower case (`home` for `/`), for example `e2e/orders-new.abc-123.spec.ts` for `/orders/new` and `ABC-123`. Use `.spec.js` when the project has no `tsconfig.json`. If the file already exists, keep every test in it and add to it.
     - **Shape:** all tests inside one `test.describe('<KEY> <summary>', { tag: '@<KEY>' }, () => { … })` block, at the start of a line. One `test` per scenario, named after the scenario, with `{ tag: ['@anchor', '@<KEY>'] }`. One test per extra probe, named `Extra: <what it probes>`, with `{ tag: ['@finding', '@<KEY>'] }`. Keep each tag list on its `test(` line.
     - **Values:** the real expected values from the ticket, written as they are in the ticket, inside a web-first assertion (`await expect(<locator>).toHaveText(…)`). Never invent a value the ticket does not give; a behaviour the ticket does not pin down is a `test.fixme`.
     - **Screen:** `await page.goto('<route>')`. Imports, fixtures and login as the specs already in the folder do (else `import { test, expect } from '@playwright/test'`). Stub the network only where the guides say to. No design capture and no screenshot test.
6. **Check.** Say this one line, then run:

   `Running the checks: tests, assertions, types, expected values and mutation; this can take a few minutes.`

   - **Vitest:** `node "${CLAUDE_PLUGIN_ROOT}/core/pipeline/cli.mjs" '<spec>' '<spec>' --key <KEY> --ticket @<ticketsDir>/<KEY>/ticket.json --target '<target>'`
   - **Playwright:** first add this line: `The tests open the app: your Playwright config starts it (its webServer), or it must already be running.` Then `node "${CLAUDE_PLUGIN_ROOT}/core/pipeline/cli.mjs" '<spec>' --key <KEY> --ticket @<ticketsDir>/<KEY>/ticket.json`, with no `--target` (the pipeline refuses it for Playwright: there is no Stryker step).

   After option 3 in step 2, add `--incomplete-ticket <score>` with the score remembered there: the card then opens with the 🔴 [RISK / NOT RECOMMENDED] line. Never pass it otherwise.

   Quote every spec path and the target in single quotes. Pass every spec this run wrote. Do not pass `--range` or `--json`. Read the verdict and the step that decided it from the `PIPELINE_JSON:` line, without showing it.
   - **Fixable** (`checks_failed` decided by `expected`, `assertions`, `mutation`, `stryker`, or `types` with the error in a spec): rewrite the tests only, as the card's "What to do" says, and run the same command again. At most 2 rewrites in all; after the second, take the card as it is.
   - **`boundary` or `honesty`:** undo that change once (restore the file or the test as it was) and run again. If it fails again, take the card as it is. On Playwright, an `honesty` failure about an anchor tag means a tag list was split over lines: put it back on the `test(` line.
   - **Anything else** (`green`, `tests_red`, `not_verified`, `types` outside a spec): take the card as it is.
   - **Exit 2** (a usage or config error, a missing target, a crash): run `run stop`, show its lines as they are and stop.

   Then run `node "${CLAUDE_PLUGIN_ROOT}/core/checks/cli.mjs" run stop`.
7. **Card.** Show the last card exactly as printed. Drop the `PIPELINE_JSON:` line. Add nothing, grade nothing. Keep the 🔴 [RISK / NOT RECOMMENDED] line; never drop or soften it. Then the spec paths written, one per line. For a **Bug** (the ticket's `issuetype`) whose card is `tests red` with a test that asserts the ticket's expected value, add one line:

   `This is the bug the ticket describes; it should go green when the fix is merged.`

   On Playwright, also add one line in these two cases:
   - The card is `tests red` and the test it names starts with `Extra:`: `A red extra test is a case the ticket does not cover: show it to the ticket's author. Do not change the test to make it pass.`
   - The card is `not verified` because the app is not reachable: `Start the app (or check the webServer in your Playwright config), then run /quality-code:check with the spec path above.`

## Examples

- `/quality-code:write ABC-123`: gate the ticket, pick the code or the screen, plan, write and check
- `/quality-code:write ABC-123 --layer unit`: Vitest, write only in the `unit` layer
- `/quality-code:write ABC-123 --target src/pricing.ts`: Vitest, skip the target card
- `/quality-code:write ABC-123 --route /orders/new`: Playwright, test this screen
- `/quality-code:write ABC-123 --no-extras`: Playwright, only the ticket's scenarios
