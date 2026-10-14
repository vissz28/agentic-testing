---
description: Write Vitest tests for a Jira ticket that passes the readiness gate, in the team's test folders, then check them with the pipeline and show its card.
argument-hint: <KEY> [--layer NAME] [--target PATH]
---

Writes tests from a ticket. You write the tests; the scripts gate the ticket and grade the tests. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **The scripts decide.** `cli.mjs` scores the ticket; the pipeline grades the tests. Never compute, change or soften a score, a verdict or a count, and never say a test is good yourself.
- **Never edit application code.** Write only spec files, only in the layer folders. Source files, config and other tests stay as they are. If the boundary hook denies a write, read its reason and write in a layer folder instead.
- **Never weaken or delete a test** to make a check pass: no removed `expect`, no looser matcher, no `.skip`, no deleted `it`.
- **Never ask for a token**, key or password in the chat, and never show one.
- Refer to Jira tools by operation name on the Atlassian connector.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/core/<script>" …`. Drop the machine lines (`BRANCH_JSON:`, `TICKET_EVAL_JSON:`, `PIPELINE_JSON:`) when you show output.
- **Run marker.** Once `run start` has succeeded, every way out of this command runs `node "${CLAUDE_PLUGIN_ROOT}/core/checks/cli.mjs" run stop` first: the card, a stop, an error, a crash of a script. `run stop` is safe to run twice.

## Steps

1. **Check.** The first `[A-Z][A-Z0-9]*-\d+` in `$ARGUMENTS` is the key. No key: `pass a key: /quality-code:write <KEY>`. Run `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" config check`. If it does not print `ok`, show its lines and stop (a missing config means: run `/quality-code:setup`). Read `.claude/quality-code.json`: if `adapter` is not `vitest`, say `The Playwright pipeline comes with part 3. For now this command writes Vitest tests only.` (the pipeline script says the same: the Playwright pipeline comes with part 3) and stop. Read `ticketsDir` (default `.claude/quality-code/tickets`) and the layers from `vitest.layers`; with no `vitest.layers`, there is one layer, `unit`, in `test/`. A `--layer NAME` in `$ARGUMENTS` keeps only that layer; a name that is not a layer: `No layer <NAME>. The layers are <names>.` and stop. Then read `${CLAUDE_PLUGIN_ROOT}/core/connectors.md` and follow it, as the start command does. Jira is required: go on only when its card lets you continue.
2. **Ticket and gate.** Read `${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md` and follow its steps 1–5 with `<KEY>` as `$ARGUMENTS`, no flags: read, save, sanitize and score. The script scores; never write a test for a ticket it refuses.
   - **Refused:** its refuse card and its flow, as written there. If that flow ends with the ticket passing (the guided fill-in and `1. Continue`), go on. Anything else (a comment posted, a cancel, a stop, or option 3, the developer override), stop: `Writing tests needs a ticket that passes the gate.` No run marker, no file written.
   - **Passed:** go on with `<ticketsDir>/<KEY>/ticket.json`. Read from it the `summary`, the `issuetype`, the scenarios and the expected values. This file is the only copy of the ticket; never edit it.
3. **Target.** A `--target PATH` in `$ARGUMENTS` is used as it is: it must be an existing file that is not a spec; otherwise say so and stop. Without one, propose the source file the ticket's behaviour lives in, from the ticket, the branch (`node "${CLAUDE_PLUGIN_ROOT}/core/branch.mjs" --detect`, the `files` of kind `code` whose `status` is not `D`) and a search of the code for the ticket's terms. Show up to two candidates, best first, in this card and end the turn. One clear candidate still gets the card.

   ```
   Which code does this ticket change?
   1. <path>
   2. <path>
   3. Another file
   4. Stop
   ```

   Paths are fine here: a developer reads this card. On `3`, ask `Which file? Type its path from the project root.` and check it exists and is not a spec. On `4`, stop.
4. **Plan.** Read `${CLAUDE_PLUGIN_ROOT}/core/guides/vitest-writing.md`, then the `guide` of each layer that has one (the team's own rules on top of it; they win where they differ). Read the target. Give each scenario of the ticket one line and one layer (the first layer unless a layer guide says otherwise). Show this card and end the turn:

   ```
   Tests for <KEY>, against <target>
     <layer>   <scenario, in a few words>
     <layer>   <scenario, in a few words>
   1. Write these tests
   2. Change the layers
   3. Stop
   ```

   On `2`, ask which scenario goes in which layer (the layer names only), then show the plan card again. On `3`, stop.
5. **Write.** Run `node "${CLAUDE_PLUGIN_ROOT}/core/checks/cli.mjs" run start --key <KEY>` before writing any file. If it exits with an error because a run is already active, show its line, then this card and end the turn:

   ```
   Another test-writing run is active.
   1. Stop the other run and start this one
   2. Stop
   ```

   On `1`, run `node "${CLAUDE_PLUGIN_ROOT}/core/checks/cli.mjs" run stop`, then `run start --key <KEY>` again. On `2`, stop (the other run stays as it is). Any other error: show its lines and stop.

   Then write one spec file per layer that has scenarios, in that layer's folder:
   - **Name:** `<target basename>.<key lowercased>.spec.ts`, for example `pricing.abc-123.spec.ts` for `src/pricing.ts` and `ABC-123`. Use `.spec.js` when the project has no `tsconfig.json`. If the file already exists, keep every test in it and add to it.
   - **Shape:** all tests inside one `describe('<KEY> <summary>', …)` block, at the top level of the file. One `it` per scenario, named after the scenario.
   - **Values:** the real expected values from the ticket, written as they are in the ticket, inside an `expect(...)`. Never invent a value the ticket does not give; a behaviour the ticket does not pin down is an `it.todo`.
   - **Imports:** import the target directly. Mock only the boundary the guides say to mock.
6. **Check.** Say this one line, then run:

   `Running the checks: tests, assertions, types, expected values and mutation; this can take a few minutes.`

   `node "${CLAUDE_PLUGIN_ROOT}/core/pipeline/cli.mjs" '<spec>' '<spec>' --key <KEY> --ticket @<ticketsDir>/<KEY>/ticket.json --target '<target>'`

   Quote every spec path and the target in single quotes. Pass every spec this run wrote. Do not pass `--range` or `--json`. Read the verdict and the step that decided it from the `PIPELINE_JSON:` line, without showing it.
   - **Fixable** (`checks_failed` decided by `expected`, `assertions`, `mutation`, `stryker`, or `types` with the error in a spec): rewrite the tests only, as the card's "What to do" says, and run the same command again. At most 2 rewrites in all; after the second, take the card as it is.
   - **`boundary` or `honesty`:** undo that change once (restore the file or the test as it was) and run again. If it fails again, take the card as it is.
   - **Anything else** (`green`, `tests_red`, `not_verified`, `types` outside a spec): take the card as it is.
   - **Exit 2** (a usage or config error, a missing target, a crash): run `run stop`, show its lines as they are and stop.

   Then run `node "${CLAUDE_PLUGIN_ROOT}/core/checks/cli.mjs" run stop`.
7. **Card.** Show the last card exactly as printed. Drop the `PIPELINE_JSON:` line. Add nothing, grade nothing. Then the spec paths written, one per line. For a **Bug** (the ticket's `issuetype`) whose card is `tests red` with a test that asserts the ticket's expected value, add one line:

   `This is the bug the ticket describes; it should go green when the fix is merged.`

## Examples

- `/quality-code:write ABC-123`: gate the ticket, pick the code, plan, write and check
- `/quality-code:write ABC-123 --layer unit`: write only in the `unit` layer
- `/quality-code:write ABC-123 --target src/pricing.ts`: skip the target card
