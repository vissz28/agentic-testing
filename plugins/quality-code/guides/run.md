# Running the tests through the pipeline

Shared by `/quality-code:run-frontend`, `/quality-code:run-backend` and `/quality-code:run-pipeline`: the same steps, one suite each. You ask and relay; the script runs and grades. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The script decides.** `pipeline.mjs` runs and grades. Never compute, change or soften a verdict, a count or a score yourself.
- **Never edit tests**, source files or config, and never retry. If the card shows a problem, show it and stop.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop or Cancel option. Read only the first word for this; a sentence that gives a result (and no number) is a typed answer.
- **Language.** Talk in the language of the user's messages; before they write one, in the ticket's language (Italian for an Italian ticket). Script output and cards stay as printed.
- **One run per request.** If the user wants another run, they ask again.
- **Never read or show file contents or diffs.** Use only paths, kinds, counts and keys from `BRANCH_JSON`.
- **Never ask for a token**, key or password in the chat.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/bin/<script>" …`. With `root` in `.claude/quality-code.json` the project root is that folder: every path the scripts print or take is relative to it, so the files you read and write are under it.

## The suite

The command that sent you here names its suite: `frontend` (`/quality-code:run-frontend`: the Playwright specs), `backend` (`/quality-code:run-backend`: the specs of the backend runner, Vitest, pytest, JUnit, Go or .NET) or `full` (`/quality-code:run-pipeline`: both). Keep it as `<suite>` for every step below.

## Steps

0. **Evals.** Only for the `full` suite. With `--evals` in `$ARGUMENTS`, run only `node "${CLAUDE_PLUGIN_ROOT}/bin/evals.mjs"` (the frozen evals in `.claude/quality-code/evals/`: each ticket's committed specs must keep saying what its fixture pins), show its lines as printed and stop. Exit 3 means there is no fixture yet: say so in one line.
1. **Project.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check --runner`. If it does not print `ok`, show its lines and stop (a missing config means: run `/quality-code:setup`). If it prints `ok (personal: …)`, or you are not inside a git repo, say `This needs a repo. Open the project folder, or run /quality-code:setup there.` and stop. Each `missing:` line names a test runner of the config that this project has not installed, so the specs could not run: show the lines and stop. Then read `adapter` in `.claude/quality-code.json`. `vitest`, `playwright` and `fullstack` projects are checked the same way; the script picks the test runner (on a fullstack project, per spec: the e2e folder's specs run under Playwright, the others under Vitest, and the card shows both runners). Remember the adapter for step 4.
2. **Specs.** If `$ARGUMENTS` has spec paths, use them and go to step 3. Without `--branch` in `$ARGUMENTS`, the specs are the whole suite: the script lists them itself (`--suite <suite>` in step 4), so do not look for files; say `Running every <frontend | backend | frontend and backend> spec of the project.` and go to step 3. With `--branch` (the `full` suite only; for the others say `--branch is for /quality-code:run-pipeline.` and stop), run `node "${CLAUDE_PLUGIN_ROOT}/bin/branch.mjs" --detect` and read the `BRANCH_JSON:` line. Take the `files` whose `kind` is `test` and whose `status` is not `D` (a deleted test cannot run). Remember that the specs came from the branch. If there are none, say `No test files changed on this branch. Give the spec paths: /quality-code:run-pipeline <spec…>` and stop. Otherwise show this card and end the turn:

   ```
   Check these <n> spec files?
     <path>
     <path>
   1. Yes
   2. Pick some
   3. Stop
   ```

   On `2`, show the paths as a numbered list; the user picks several numbers; use those. On `3`, stop.
3. **Key.** A `--key` in `$ARGUMENTS` is used as it is. A whole suite spans many tickets: without `--key`, pass none and go on. For specs from the branch or typed paths, propose `keys[0]` from the branch detect (run it if step 2 did not) and confirm it: `1. Use <KEY>` / `2. A different ticket` / `3. No ticket`, then end the turn. With no key at all, ask `Which ticket? Type its key, for example ABC-123, or say none.` Pass `--key <KEY>` only when there is one.
4. **Run.** Say this one line, then run:

   `Running the checks: tests, assertions, types and mutation; this can take a few minutes.` (with `--ticket`, say `tests, assertions, types, expected values and mutation`)

   For the `frontend` and `full` suites on a project with Playwright, for `playwright`, and for `fullstack` when a spec is in the e2e folder, add this second line: `The tests open the app: your Playwright config starts it (its webServer), or it must already be running.` With Cypress (`runners.e2e` in the config), the line is `The tests open the app: it must already be running (Cypress does not start it).`

   `node "${CLAUDE_PLUGIN_ROOT}/bin/pipeline.mjs" --suite <suite> [--key <KEY>] [--flaky <N>]` for the whole suite, else `node "${CLAUDE_PLUGIN_ROOT}/bin/pipeline.mjs" '<spec>' '<spec>' [--range <base>...HEAD] [--key <KEY>] [--ticket @<ticketsDir>/<KEY>/ticket.json] [--expected @<ticketsDir>/<KEY>/expected.json] [--target '<target>'] [--flaky <N>]`

   With a key, look in `<ticketsDir>/<KEY>/` (`ticketsDir` from the config, default `.quality-code/tickets`), where `write` and `ticket-eval` saved the ticket: when `ticket.json` is there, pass `--ticket @<ticketsDir>/<KEY>/ticket.json` (the value check then runs too), and `--expected @<ticketsDir>/<KEY>/expected.json` when that file is there; when `target` is there and names an existing file that is not one of the specs, and the adapter is `vitest` or `fullstack`, pass `--target '<that path>'` (Stryker then runs on it). Never pass `--target` on a `playwright` project. Missing files: leave the flag out; do not read the ticket from Jira here.

   Quote every spec path in single quotes. Pass `--range <base>...HEAD` only when the specs came from the branch (step 2 with `--branch`, or the spec command's "Only check the tests already on this branch"), with `base` from the `BRANCH_JSON:` line (the field `base`, for example `origin/main`). Honesty then reads everything committed on the branch since it left the base, so an assertion or test removed in an earlier commit is caught. It does not read changes that are not committed yet; with specs the user typed, no range is passed and honesty reads the changes not committed yet. Pass `--flaky` only when `$ARGUMENTS` has it. Do not pass `--json`.
5. **Card.** Show the card exactly as printed. Drop the `PIPELINE_JSON:` line. Add nothing, grade nothing. If the script exits with 2, show its lines as they are and stop (for example `This project has no frontend (Playwright) tests`).
