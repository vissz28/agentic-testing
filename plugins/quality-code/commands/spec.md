---
description: Take a Jira ticket to checked tests, for developers and QA. The readiness gate stops only when the ticket is not workable, you confirm the plan, then Vitest or Playwright tests (or both, on a fullstack project) are written in the team's test folders, checked by the pipeline, and read back. With no key, it takes the ticket of your feature branch.
argument-hint: [KEY] [--gate-only] [--base BRANCH] [--layer NAME] [--target PATH] [--route PATH] [--no-extras] [--yes] [--dry-run] [--ci]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
---

Takes a ticket to checked tests. You write the tests; the scripts gate the ticket and grade the tests. A person is asked three times at most: at the gate, only when the ticket is refused; at the plan; and at the read-back after the card. Everything else runs without stopping. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

The steps are the same for both adapters. Where a **Vitest** project (unit tests against a source file) and a **Playwright** project (e2e tests against a screen of the app) differ, the step says so. A **fullstack** project (`adapter: fullstack`) has both: a backend ticket takes the Vitest parts of each step, a frontend ticket the Playwright parts, and a fullstack ticket both, the Vitest part first. Its specs are checked together, in one run (step 6).

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The scripts decide.** `ticket.mjs` scores the ticket; the pipeline grades the tests. Never compute, change or soften a score, a verdict or a count, and never say a test is good yourself.
- **Never edit application code.** Write only spec files, only in the layer folders (Vitest) or the e2e folder (Playwright). Source files, config and other tests stay as they are. If the boundary hook denies a write, read its reason and write in a test folder instead.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop or Cancel option. Read only the first word for this; a sentence that gives a result (and no number) is a typed answer.
- **Language.** Talk in the language of the user's messages; before they write one, in the ticket's language (Italian for an Italian ticket). Script output and cards stay as printed.
- **Never weaken or delete a test** to make a check pass: no removed `expect`, no looser matcher, no `.skip`, no deleted `it` or `test`.
- **Never ask for a token**, key or password in the chat, and never show one.
- Refer to Jira tools by operation name on the Atlassian connector.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/bin/<script>" …`. Drop the machine lines (`BRANCH_JSON:`, `MERGED_JSON:`, `TICKET_EVAL_JSON:`, `GATE_JSON:`, `SAVED_JSON:`, `E2E_FOLDER_JSON:`, `PIPELINE_JSON:`) when you show output.
- **Run marker.** Once `run start` has succeeded, every way out of this command runs `node "${CLAUDE_PLUGIN_ROOT}/bin/checks.mjs" run stop` first: the card, a stop, an error, a crash of a script. `run stop` is safe to run twice.

## Steps

1. **Check.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. If it prints `ok (personal: …)`, or you are not inside a git repo, say `This needs a repo. Open the project folder, or run /quality-code:setup there.` and stop (`--gate-only` is the exception: go on to it). If it does not print `ok`, show its lines, then this card and end the turn (`--ci` stops instead):

   ```
   This repo is not set up yet.
   1. Run setup now
   2. Stop
   ```

   On `1`, read `${CLAUDE_PLUGIN_ROOT}/commands/setup.md` and follow it; when it is done, come back here (setup has just checked the connectors: skip them below). On `2`, stop. Read `.claude/quality-code.json`: its `adapter` is `vitest`, `playwright` or `fullstack`, and `ticketsDir` (default `.claude/quality-code/tickets`).
   - **Vitest:** `--route` and `--no-extras` are for Playwright projects: if `$ARGUMENTS` has one, say `--route and --no-extras are for Playwright projects. Use --layer NAME or --target PATH here.` and stop. Read the layers from `vitest.layers`; with no `vitest.layers`, there is one layer, `unit`, in `test/`. A `--layer NAME` in `$ARGUMENTS` keeps only that layer; a name that is not a layer: `No layer <NAME>. The layers are <names>.` and stop.
   - **Playwright:** `--layer` and `--target` are for Vitest projects: if `$ARGUMENTS` has one, say `--layer and --target are for Vitest projects. Use --route PATH to name the screen.` and stop. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config e2e-folder` and read the `E2E_FOLDER_JSON:` line: its `folder` is the e2e folder, where the spec goes. If it exits with 2, show its lines and stop. Read `playwright.guide`, `features` and `xray` too.
   - **Fullstack:** every flag is allowed: `--layer` and `--target` for the backend part, `--route` and `--no-extras` for the frontend part. Read the layers as for Vitest and the e2e folder, `playwright.guide` and `features` as for Playwright.

   - **`--gate-only`:** the gate alone, no test: read `${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md` and follow it with the key (below) and `--ci` when given, then stop. `/quality-code:ticket-eval` is the same.
   - **`--dry-run`:** go through steps 1 to 4 as usual, show the plan card (step 4's, with its options left out) and stop: no run marker, no test written, no `target` saved, nothing posted. The gate still saves the sanitized ticket (`<ticketsDir>/<KEY>/ticket.json`). A refused ticket ends the dry run at the gate's report: no refuse card, so no comment, fill-in or Jira update. **`--ci`:** never ask: a card that needs an answer stops the command instead (`--ci` stops here: <the question, in one line>), and every Jira post is left out. Both may be given with any other flag.

   Then read `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` and follow it (skip it when setup has just run). From the plugin settings (each empty when not set): `jira_email` is `${user_config.jira_email}`, `gitlab_username` is `${user_config.gitlab_username}`, `gitlab_api_url` is `${user_config.gitlab_api_url}`. Jira is required: go on only when its card lets you continue.

   **The ticket.** The first `[A-Z][A-Z0-9_]*-\d+` in `$ARGUMENTS` is the key. Without one, take the ticket of the branch you are on:
   - Run `node "${CLAUDE_PLUGIN_ROOT}/bin/branch.mjs" --detect` (add `--base <name>` from `$ARGUMENTS`) and read the `BRANCH_JSON:` line. On GitHub, the script finds the branch's open pull request itself, with the `gh` CLI: its `pullRequest` (`base`, `title`, `description`) is the merge request for the rest of this command, and its target is already the base (`baseSource` `pull-request`, unless `--base` was given); never run `gh` yourself. Otherwise, if GitLab is connected, look for an open merge request whose source branch is its `branch`: with exactly one, its target branch is the base (run detect again with `--base <target>` when they differ). Either way, when the target is not in `branches` (as `<target>` or `origin/<target>`), it is not fetched: keep the detected base, do not run detect again, and say `The merge request targets <target>, which is not fetched here: comparing against <base>. Run git fetch origin <target> to compare against it.` Keep the merge request's title and description: ticket-eval saves them, redacted, for the fill-in (its `mergeRequest`). Keep `files` and `subjects` for later steps. The branch never changes the score, and no diff content is shown in the chat.
   - **The key:** `keys[0]` when it appears in the branch name, ignoring case: say `Ticket: <KEY> (from the branch <branch>)` and go on, with no card. Otherwise the first key in the merge request's title whose project is in `jira.projects` or `jira.trackingProjects`, else `keys[0]` (from the branch's commit messages). With more than one candidate and none in the branch name, show them as a numbered card plus a last line `<n>. Another ticket`, and end the turn.
   - **No key from the branch:** not a git repo (`isRepo` false), no branch checked out (`detached`), on the base or no changes (`onBase`, or `files` empty), no shared history (`mergeBase` null; with `shallow`, add `Run git fetch --unshallow to compare.`), or simply no key found: say which in one line and ask `Which ticket? Type its key, for example ABC-123.`, then end the turn. With `base` null, show `branches` as a numbered card first and detect again with the pick. `--ci` never asks: it stops with `--ci needs a key, or a branch named after the ticket.`
2. **Ticket and gate.** Coming from ticket-eval's option 3 (it handed you the key and the incomplete score; `<ticketsDir>/<KEY>/ticket.json` is saved): skip this step and go on as after option 3 below, with that score. Otherwise, read `${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md` and follow its steps 1–5 with `<KEY>` as `$ARGUMENTS`, no flags: read, save, sanitize and score. The script scores; never write a test for a ticket it refuses.
   Read `band` from the last `GATE_JSON:` line (ticket-eval's step 5 runs `score --next`):
   - **ready:** say the report's first line and go on.
   - **borderline** (up to 10 points under the bar, with something to check): do not stop. Show the report's first line and its `To pass:` line, then `Going on: the result carries the 🔴 [RISK / NOT RECOMMENDED] mark. To clear it, add the missing information with /quality-code:ticket-eval <KEY>.` Remember the brief's `score` from `TICKET_EVAL_JSON` as the incomplete score, as after option 3. The same with `--dry-run` and `--ci`.
   - **Refused:** its refuse card and its flow, as written there (the first of the three questions). If that flow ends with the ticket passing (the guided fill-in, then `1` or `2` on its Jira update card), go on. On option 3, the developer override, go on only when the ticket-eval flow lets it (the brief's `derivable` is at least 1): remember the brief's `score` from `TICKET_EVAL_JSON` as the incomplete score, and say `The ticket is incomplete: the result carries the 🔴 [RISK / NOT RECOMMENDED] mark.` Anything else (a comment posted, a cancel, a stop), stop: `Writing tests needs a ticket that passes the gate, or option 3.` No run marker, no file written.
   - **Going on** (ready, borderline, or passed after the fill-in): go on with `<ticketsDir>/<KEY>/ticket.json`. Read from it the `summary`, the `issuetype`, the scenarios and the expected values. This file is the only copy of the ticket; never edit it.
   - **Fullstack:** the side is the `side` of the last `TICKET_EVAL_JSON:` line (ticket-eval asked for it when the ticket did not say): `backend` takes the Vitest parts of steps 3 to 5, `frontend` the Playwright parts, `fullstack` both. Say it in one line: `Side: <side> (<Vitest tests | Playwright tests | Vitest and Playwright tests>)`.
   - **Playwright:** also keep the `route` and the `feature` from the last `TICKET_EVAL_JSON:` line. The scenarios are the ticket's plus the QA plan's (`qaPlan.scenarios` in `ticket.json`), each name once; where both have a scenario with the same name, the ticket's wins.
3. **Target.** What the tests check: a source file (Vitest) or a screen of the app (Playwright).
   - **Vitest:** a `--target PATH` in `$ARGUMENTS` is used as it is: it must be an existing file that is not a spec; otherwise say so and stop. Without one, and when `<ticketsDir>/<KEY>/target` exists (a target chosen in an earlier run of this ticket) and still names an existing file that is not a spec, reuse it without asking. Otherwise find the source file the ticket's behaviour lives in, from the ticket, the branch (the `files` of kind `code` whose `status` is not `D`, from step 1's `BRANCH_JSON:` or `node "${CLAUDE_PLUGIN_ROOT}/bin/branch.mjs" --detect`) and a search of the code for the ticket's terms. When the branch shows no changed code file (for example on the base branch, after the ticket was merged), run `node "${CLAUDE_PLUGIN_ROOT}/bin/branch.mjs" --merged <KEY>` and use the `files` of its `MERGED_JSON:` line the same way: the change of the ticket's merge commit (`found` `merge`) or of the commits that name it (`found` `commits`); say `changed by the <KEY> merge <commit>` in the target line. Nothing found: go on without it. When one file is clearly the best (it changed on this branch and it holds what the ticket's scenarios describe), pick it yourself and do not stop: say one line, `Target: <path> (changed on this branch, <what it holds, in a few words>)`, and go on. Show this card only when no changed code file matches the ticket, or when two match equally well, up to two candidates, best first, and end the turn:

     ```
     Which code does this ticket change?
     1. <path>
     2. <path>
     3. Another file
     4. Stop
     ```

     Paths are fine here: a developer reads this card. On `3`, ask `Which file? Type its path from the project root.` and check it exists and is not a spec. On `4`, stop. Whichever way the target was found, write its path, one line, to `<ticketsDir>/<KEY>/target` (not with `--dry-run`), so the next run of this ticket does not ask again.
   - **Playwright:** a `--route PATH` in `$ARGUMENTS` is used as it is: it must start with `/` and be one line; otherwise say `--route must be a path in the app starting with /, like /orders` and stop. Without one, the `route` from step 2 (the configured feature whose label is on the ticket) is used, with no card. With neither, show this card, one line per entry of `features` that has a `route`, then `Another screen` and `Stop`, and end the turn:

     ```
     Which screen does this ticket test?
     1. <route>   (<feature label>)
     2. <route>   (<feature label>)
     3. Another screen
     4. Stop
     ```

     On `Another screen`, ask `Which screen? Type its path in the app, for example /orders.` and check it starts with `/`. On `Stop`, stop.
4. **Plan.** When the config has `qaPlans` (a folder) and `<qaPlans><feature label>.md` exists for the ticket's feature label, read it first: a person wrote its rules for that feature, so they are extra things the tests must respect. The ticket's Then wins where they disagree; say the clash in one line under the plan. Never edit that file.
   - **Vitest:** read `${CLAUDE_PLUGIN_ROOT}/guides/vitest-writing.md`, then the `guide` of each layer that has one (the team's own rules on top of it; they win where they differ). Read the target. Give each scenario of the ticket one line and one layer (the first layer unless a layer guide says otherwise), and under it the result it checks, as a plain sentence from the ticket's Then (`We check: the total is 108.00`). Show this card and end the turn: it is the second of the three questions. With `--yes` or `--ci`, show it as information instead (its lines without the numbered options, under `Writing these tests:`) and go on to step 5 without stopping:

     ```
     Tests for <KEY>, against <target>
       <layer>   <scenario, in a few words>
       <layer>   <scenario, in a few words>
     1. Write these tests
     2. Change the layers
     3. No, I'll type the right result
     4. Stop
     ```

     On `2`, ask which scenario goes in which layer (the layer names only), then show the plan card again. On `3`, ask `What should the result be?` and add the answer to the ticket as ticket-eval's guided fill-in does (`ticket.mjs add --in @<ticketsDir>/<KEY>/ticket.json ac_present -- "<answer>"`; its Jira update card follows when it is accepted), then show the plan again with the new result. Never write a result into a test that the ticket file does not hold. On `4`, stop.
   - **Playwright:** read `${CLAUDE_PLUGIN_ROOT}/guides/playwright-writing.md`, then `playwright.guide` when it is set (the team's own rules on top of it; they win where they differ). Read at most two specs already in the e2e folder, the closest to the screen, for their imports, fixtures, login and stub shapes. To find the real roles, labels and texts the screen shows, you may read the branch's changed files of kind `code` for that screen (`node "${CLAUDE_PLUGIN_ROOT}/bin/branch.mjs" --detect`, or `--merged <KEY>` when the branch shows none: translation files count as code there); never show them in the chat. Give each scenario one line, with the result it checks as a plain sentence from the ticket's Then (`We check: the grid shows No orders found`). Then, unless `$ARGUMENTS` has `--no-extras`, pick at most 3 extra probes from the guide's list that apply to this screen and that the guide lets you assert. Show this card and end the turn, as for Vitest (with `--yes` or `--ci`, as information, without stopping):

     ```
     Tests for <KEY>, on <route>
       From the ticket
         <scenario, in a few words>
       Extra (not in the ticket)
         <probe, in a few words>
     1. Write these tests
     2. Leave out the extras
     3. No, I'll type the right result
     4. Stop
     ```

     With no extra probe, leave out the `Extra (not in the ticket)` lines and option 2, and number the rest in order.

   **Tests already on the branch.** When the ticket came from the branch (step 1) and its `files` hold tests (kind `test`, status other than `D`), add the option `Only check the tests already on this branch` before the plan card's Stop. On it, read `${CLAUDE_PLUGIN_ROOT}/commands/check.md` and follow it with those spec paths and `--key <KEY>`, show its card as printed, and stop. On `Leave out the extras`, drop them and show the plan card again. On `No, I'll type the right result`, do as for Vitest. On `Stop`, stop.
5. **Write.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/checks.mjs" run start --key <KEY>` before writing any file. If it exits with an error because a run is already active, show its line, then this card and end the turn:

   ```
   Another test-writing run is active.
   1. Stop the other run and start this one
   2. Stop
   ```

   On `1`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/checks.mjs" run stop`, then `run start --key <KEY>` again. On `2`, stop (the other run stays as it is). Any other error: show its lines and stop.

   - **Vitest:** write one spec file per layer that has scenarios, in that layer's folder:
     - **Name:** `<target basename>.<key lowercased>.spec.ts`, for example `pricing.abc-123.spec.ts` for `src/pricing.ts` and `ABC-123`. Use `.spec.js` when the project has no `tsconfig.json`. If the file already exists, keep every test in it and add to it.
     - **Shape:** all tests inside one `describe('<KEY> <summary>', …)` block, at the top level of the file. One `it` per scenario, named after the scenario.
     - **Values:** the real expected values from the ticket, written as they are in the ticket, inside an `expect(...)`. Never invent a value the ticket does not give; a behaviour the ticket does not pin down is an `it.todo`.
     - **Imports:** import the target directly. Mock only the boundary the guides say to mock.
   - **Playwright:** write one spec file in the e2e folder:
     - **Name:** `<folder><screen>.<key lowercased>.spec.ts`, where `<screen>` is the route's parts joined by `-` in lower case (`home` for `/`), for example `e2e/orders-new.abc-123.spec.ts` for `/orders/new` and `ABC-123`. Use `.spec.js` when the project has no `tsconfig.json`. If the file already exists, keep every test in it and add to it.
     - **Shape:** all tests inside one `test.describe('<KEY> <summary>', { tag: '@<KEY>' }, () => { … })` block, at the start of a line. One `test` per scenario, named after the scenario. One test per extra probe, named `Extra: <what it probes>`. No tag on a `test(` line yet: step 6 tags only the tests that come out red.
     - **Values:** the real expected values from the ticket, written as they are in the ticket, inside a web-first assertion (`await expect(<locator>).toHaveText(…)`). Never invent a value the ticket does not give; a behaviour the ticket does not pin down is a `test.fixme`.
     - **Screen:** `await page.goto('<route>')`. Imports, fixtures and login as the specs already in the folder do (else `import { test, expect } from '@playwright/test'`). Stub the network only where the guides say to. No design capture and no screenshot test.
   - **Pinned values:** once the specs are written, save the ticket's expected values the tests assert, each written exactly as the ticket writes it (numbers, texts, and field names like `unit_cost`), as one JSON list in `<ticketsDir>/<KEY>/expected.json`, for example `["80", "unit_cost", "No orders found"]`. The check keeps only the values the ticket's expected text holds and requires each of them in an assertion; never list a value the ticket does not give.
   - **XRay test cases** (Playwright tests, only when the config has an `xray` block): read `${CLAUDE_PLUGIN_ROOT}/commands/xray.md` step 5 and do it for the tests this run wrote, each scenario test and each `Extra:` test, with its name exactly as in its `test(` as the `key`. XRay is not a check: when the script exits with 2, keep its lines for step 7 and go on.
6. **Check.** Say this one line, then run:

   `Running the checks: tests, assertions, types, expected values and mutation; this can take a few minutes.`

   - **Vitest:** `node "${CLAUDE_PLUGIN_ROOT}/bin/pipeline.mjs" '<spec>' '<spec>' --key <KEY> --ticket @<ticketsDir>/<KEY>/ticket.json --expected @<ticketsDir>/<KEY>/expected.json --target '<target>'`
   - **Playwright:** first add this line: `The tests open the app: your Playwright config starts it (its webServer), or it must already be running.` Then `node "${CLAUDE_PLUGIN_ROOT}/bin/pipeline.mjs" '<spec>' --key <KEY> --ticket @<ticketsDir>/<KEY>/ticket.json --expected @<ticketsDir>/<KEY>/expected.json`, with no `--target` (the pipeline refuses it for Playwright: there is no Stryker step).
   - **Fullstack:** one run with every spec this run wrote, of both parts: `node "${CLAUDE_PLUGIN_ROOT}/bin/pipeline.mjs" '<spec>' '<spec>' --key <KEY> --ticket @<ticketsDir>/<KEY>/ticket.json --expected @<ticketsDir>/<KEY>/expected.json`, plus `--target '<target>'` when there is a Vitest part (Stryker checks the backend target). When there is a Playwright part, add the app line above first. The pipeline sends each spec to its own runner and the card shows both runners; the value check reads the specs of both sides together, so each value of the ticket may be asserted on either side.

   After option 3 in step 2, or a borderline ticket, add `--incomplete-ticket <score>` with the score remembered there: the card then opens with the 🔴 [RISK / NOT RECOMMENDED] line. Never pass it otherwise.

   Quote every spec path and the target in single quotes. Pass every spec this run wrote. Do not pass `--range` or `--json`. Read the verdict and the step that decided it from the `PIPELINE_JSON:` line, without showing it.
   - **Fixable** (`checks_failed` decided by `expected`, `suite-honesty`, `mutation`, `stryker`, or `types`, the card calling `suite-honesty` "assertions"; or `not_verified` decided by `mutation` with `not mutated` findings: a passing test with no assertion mutation can check): rewrite the tests only, as the card's "What to do" says, and run the same command again. At most 2 rewrites in all; after the second, take the card as it is.
   - **`boundary` or `honesty`:** undo that change once (restore the file or the test as it was) and run again. If it fails again, take the card as it is. On Playwright, an `honesty` failure about an anchor tag means a tag list was split over lines: put it back on the `test(` line.
   - **Anything else** (`green`, `tests_red`, any other `not_verified`, or `checks_failed` decided by `flaky`): take the card as it is.
   - **Playwright, red tests:** when the last run's `tests` step failed, tag each failed test its findings list (in `PIPELINE_JSON:`), on its `test(` line: `{ tag: ['<scenario tag>', '@<KEY>'] }` for a scenario test, `{ tag: ['<extra tag>', '@<KEY>'] }` for an `Extra:` test, the tags being the config's `playwright.redTags` (`scenario` and `extra`; by default `@anchor` and `@finding`). With `playwright.redTags` set to `null`, tag nothing and only list the red tests. Keep each tag list on its `test(` line. The tag tells a merge gate that skips `@anchor` and `@finding` that the test is red on purpose until the feature or the fix lands. Never tag a test that passed: the tag would hide it from the gate. Change nothing else, and do not run the checks again.
   - **Exit 2** (a usage or config error, a missing target, a crash): run `run stop`, show its lines as they are and stop.

   Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/checks.mjs" run stop`.
7. **Card.** Show the last card exactly as printed. Drop the `PIPELINE_JSON:` line. Add nothing, grade nothing. Keep the 🔴 [RISK / NOT RECOMMENDED] line; never drop or soften it. Then the spec paths written, one per line, and, with an `xray` block, the lines `xray.mjs add` printed in step 5. For a **Bug** (the ticket's `issuetype`) whose card is `tests red` with a test that asserts the ticket's expected value, add one line:

   `This is the bug the ticket describes; it should go green when the fix is merged.`

   On Playwright, also add one line in these two cases:
   - The card is `tests red` and the test it names starts with `Extra:`: `A red extra test is a case the ticket does not cover: show it to the ticket's author. Do not change the test to make it pass.`
   - The card is `not verified` because the app is not reachable: `Start the app (or check the webServer in your Playwright config), then run /quality-code:check with the spec path above.`
8. **Risk note on Jira.** Only after option 3 in step 2 (the run had `--incomplete-ticket`), and only when step 7 showed a card. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" risk-comment --in @<ticketsDir>/<KEY>/ticket.json`; never write the note yourself. Show it as printed, then this card and end the turn:

   ```
   Note for the Jira ticket (not posted yet):

   <the note>

   1. Post this note to Jira
   2. Do not post
   ```

   - **1:** call `addCommentToJiraIssue` on the Atlassian connector: the ticket key, `contentFormat` `markdown`, the note verbatim. If an existing comment contains `Logged by quality-code: tests were written on an incomplete ticket.` (the same as `RISK_COMMENT_FOOTER` in the plugin's `lib/ticket/jira.mjs`), update that comment instead of adding a second one (as "Updating a comment" in `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` says). If no add-comment tool is available, show the text and say `Copy this onto the ticket.` On success: `The note has been posted on the ticket.`, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" jira-posted <KEY> risk` (it logs the key for `/quality-code:kpi`; show nothing of it). On failure: `Could not post the note on Jira.`
   - **2:** `The note was not posted.`
9. **After the card.** The read-back, the last of the three questions. Not with `--ci`. Show this card and end the turn:

   ```
   1. Done
   2. That's not what I see in the app
   3. Another ticket
   ```

   - **1:** stop.
   - **2:** ask `What do you see in the app?` and wait. Then say which it is, in one or two sentences, without changing any test: the app shows something the ticket did not ask for, so a red test there is a finding to show the ticket's author (the test stays as it is); or the ticket's expected result is wrong, so the ticket is fixed first (refuse option 1 of ticket-eval adds the right result to the ticket and offers the Jira update), and then `/quality-code:spec <KEY>` runs again. **Never weaken or change a test to match what the app does.**
   - **3:** ask for the key and run this command again with it.

## Examples

- `/quality-code:spec`: the ticket of this branch: gate, plan, write and check
- `/quality-code:spec ABC-123`: gate the ticket, pick the code or the screen, plan, write and check
- `/quality-code:spec ABC-123 --gate-only`: the gate alone, as `/quality-code:ticket-eval ABC-123`
- `/quality-code:spec ABC-123 --yes`: no plan question
- `/quality-code:spec ABC-123 --layer unit`: Vitest, write only in the `unit` layer
- `/quality-code:spec ABC-123 --target src/pricing.ts`: Vitest, skip the target card
- `/quality-code:spec ABC-123 --route /orders/new`: Playwright, test this screen
- `/quality-code:spec ABC-123 --no-extras`: Playwright, only the ticket's scenarios
- `/quality-code:spec ABC-123 --target src/pricing.ts --route /orders`: fullstack, a backend target and a screen
- `/quality-code:spec ABC-123 --dry-run`: the gate and the plan, then stop; no test is written and nothing is posted
- `/quality-code:spec ABC-123 --ci`: no questions; stops where it would have to ask
