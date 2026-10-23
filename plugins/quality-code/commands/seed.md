---
description: Write only the test data a Jira ticket needs: calls to your seed builders (Vitest) or route stubs (Playwright). No test, nothing graded. Prints the block, or puts it into an existing spec with --path.
argument-hint: <KEY> [--path <spec>]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
---

Writes the data setup for a ticket, and nothing else. It is the data-only sibling of `/quality-code:spec`, for QA: same ticket reading, no test, no checks. You write the data from the ticket and the project's own builders or stubs; nothing is invented. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **Data only.** No `it`, `test`, `describe` or `expect`, no pipeline run, no score. The block is data a test will use.
- **Never invent.** Call only builder functions that the builder files export. Copy a response shape only from an existing stub. Take values only from the ticket or the dataset document. Anything else is a gap you name, never a guess.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop or Cancel option. Read only the first word for this; a sentence that gives a result (and no number) is a typed answer.
- **Language.** Talk in the language of the user's messages; before they write one, in the ticket's language (Italian for an Italian ticket). Script output and cards stay as printed.
- **Never write to a database.** The block seeds when the tests run, against the test database the project's test setup provides. Never run a seed, never connect to a database, least of all a developer's own.
- **Never edit application code.** With `--path`, write only that one spec file, and only its setup. Builder files, fixtures, the dataset document, source files and config stay as they are. If the boundary hook denies a write, show its reason and print the block instead.
- **Never ask for a token**, key or password in the chat, and never show one.
- Refer to Jira tools by operation name on the Atlassian connector.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/bin/<script>" …`. Drop the machine lines (`TICKET_EVAL_JSON:`, `PROJECT_MISMATCH:`) when you show output.
- **Run marker.** Once `run start` has succeeded, every way out of this command runs `node "${CLAUDE_PLUGIN_ROOT}/bin/checks.mjs" run stop` first. `run stop` is safe to run twice.

## Steps

1. **Check.** The first `[A-Z][A-Z0-9_]*-\d+` in `$ARGUMENTS` is the key. No key: `pass a key: /quality-code:seed <KEY>`. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. If it does not print `ok`, show its lines and stop (a missing config means: run `/quality-code:setup`). If it prints `ok (personal: …)`, or you are not inside a git repo, say `This needs a repo. Open the project folder, or run /quality-code:setup there.` and stop. Read `.claude/quality-code.json`: the `adapter` (`vitest` seeds with builder calls, `playwright` with route stubs, `fullstack` with either or both, by the ticket's side), `ticketsDir` (default `.quality-code/tickets`), `features`, and the `seed` block: `seed.builders` (Vitest), `seed.stubsFrom` (Playwright) and `seed.dataset`, each optional.
   - A `--path <spec>` in `$ARGUMENTS` asks to insert the block into that spec. It must be an existing file whose name has `.spec.` or `.test.` in it. Not a spec: `<path> is not a spec file. Give a spec, or leave out --path to print the block.` and stop. A spec that does not exist: say `<path> does not exist, so the block will be printed instead.` and go on without `--path`.
   - Then read `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` and follow it, as the start command does. From the plugin settings (each empty when not set): `jira_email` is `${user_config.jira_email}`, `gitlab_username` is `${user_config.gitlab_username}`, `gitlab_api_url` is `${user_config.gitlab_api_url}`. Jira is required: go on only when its card lets you continue.
2. **Ticket.** Read `${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md` and follow its steps 1–3 with `<KEY>` as `$ARGUMENTS`, no flags: read, save and sanitize. If a call prints `PROJECT_MISMATCH:`, show its step 4 card. **Skip step 5, the score: there is no gate here.** The gate protects a graded result: a test whose expected values come from the ticket. This command writes data only. Nothing is asserted, nothing is graded, and no database is touched, so there is nothing to protect. A thin ticket gives a short block with its gaps named, never invented data.

   Go on with `<ticketsDir>/<KEY>/ticket.json`, the only copy of the ticket; never edit it. Harvest its **data facts** from the summary, the description, the criteria and the scenarios (mostly the `Given` lines): each entity the ticket names, each field, each value as the ticket writes it. Note whether the expected result depends on how many rows exist. A value the ticket needs but does not give is a gap.
3. **Dataset.** If `seed.dataset` is set, read that file. It documents the project's known test dataset. When a fact matches a documented row, use that row's id and values instead of a new row; a fact it does not hold gets a new row with the ticket's values. A dataset file that does not exist: say `The dataset file <path> does not exist; going on without it.` Never change the dataset file. Without `seed.dataset`, skip this step.
4. **Source.** Read `${CLAUDE_PLUGIN_ROOT}/guides/seed-data.md`, then `seed.guide` when it is set: the team's own seeding rules, on top of it (they win where they differ). A guide file that does not exist: say `The seed guide <path> does not exist; going on without it.` On a `fullstack` project, first find the ticket's side as ticket-eval's step 4b does (`ticket.mjs side`, and its card when the ticket does not say): `backend` takes the `vitest` parts below, `frontend` the `playwright` parts, `fullstack` both, builders first. Then, by adapter:
   - **`vitest`: the builders.** With `seed.builders`, read each file. A file that does not exist: `The builder file <path> does not exist. Fix seed.builders in the config.` and stop. Without `seed.builders`, search the test folders (the `vitest.layers` folders, else `test/`, never `node_modules/`) for files that export functions which insert one row, named like `seed…`, `create…`, `build…`, `make…` or `…Factory`. Show up to three, best first, in this card and end the turn. One candidate still gets the card.

     ```
     Which file holds the seed builders?
     1. <path>
     2. <path>
     3. Another file
     4. Stop
     ```

     On `3`, ask `Which file? Type its path from the project root.` and check it exists. On `4`, stop. None found: `No seed builders found. Add a file with a builder for each table, or name it in seed.builders in the config, then run this again.` and stop. Never write a builder yourself. After the pick, add one line: `To skip this question next time, add "seed": { "builders": ["<path>"] } to .claude/quality-code.json.`

     List the functions the files export, with their parameters. Use only those. The foreign-key order comes from them: a builder that takes another row's id needs that row seeded first.
   - **`playwright`: the stubs.** Search the specs in `seed.stubsFrom`, else every spec of the project (never `node_modules/`), for `page.route(` and `route.fulfill(` (with Cypress, `runners.e2e` in the config: `cy.intercept(`). Pick the endpoints the ticket's screen reads: the `route` of the feature whose `label` is on the ticket, the ticket's text, and the specs for that route (the best source). For each endpoint, find an existing stub of that same endpoint and copy its response shape. No stub at all in that folder: `No route stubs found in <folder>. Write one stub by hand first; I copy response shapes, I never guess them.` and stop. No stub for one endpoint: `No existing stub for <endpoint>. Write one stub by hand first; I copy response shapes, I never guess them.` and stop. Endpoints a shared fixture or a shared `beforeEach` already stubs are not stubbed again.
5. **Plan.** Show this card and end the turn. One line per row (several rows of one kind on one line, with their count). Leave out the `Not in the ticket` line when there are no gaps.

   ```
   Data for <KEY>
     <entity>   <its facts, in a few words>
     <entity>   <its facts, in a few words>
   Not in the ticket: <gap>, <gap>
   From: <builder file, or the spec the shapes come from>
   1. Write the data
   2. Stop
   ```

   On `2`, stop.
6. **Write.** Follow the guide. One block:
   - **`vitest`:** builder calls in foreign-key order, parents first, one call per row, every field the ticket names, values as the API stores them, ids from the dataset or fixed ones. Plus the import line for each builder file used.
   - **`playwright`:** `page.route('**/<endpoint>**', route => route.fulfill({ json: … }))` calls with the copied shapes, broad routes first and specific ones after (Playwright uses the last match). Several stubs go in one `async function stub<Feature>(page)` helper, as the existing specs do. With Cypress: `cy.intercept('GET', '**/<endpoint>**', { body: … })` calls, in the same order (Cypress also calls the last match first), in one `function stub<Feature>()` helper.
7. **Output.**
   - **Without `--path`:** show the import lines and the block in one code block, then the `From:` line of the plan card. Write no file. Stop.
   - **With `--path`:** run `node "${CLAUDE_PLUGIN_ROOT}/bin/checks.mjs" run start --key <KEY>` before the edit. If it exits with an error because a run is already active, show its line, then this card and end the turn:

     ```
     Another test-writing run is active.
     1. Stop the other run and start this one
     2. Print the block instead
     ```

     On `1`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/checks.mjs" run stop`, then `run start --key <KEY>` again. On `2`, print as without `--path` and stop. Any other error: show its lines and print the block instead.

     Then insert the block into the spec's setup and touch nothing else: no test, no `expect` and no other line changes. For `vitest`, in the `beforeEach` of the ticket's `describe` (add one at its top when there is none). For `playwright`, at the top of the `test(...)` body before the first navigation, or in the spec's `beforeEach` when its setup lives there. Add the import lines next to the existing imports, only those missing. Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/checks.mjs" run stop` and say `Added to <path>: <n> rows.` with `<n>` the rows written. One more line: `To run it, use /quality-code:check <path>.`

## Examples

- `/quality-code:seed ABC-123`: print the data block for the ticket
- `/quality-code:seed ABC-123 --path test/orders.abc-123.spec.ts`: put it into that spec's setup
