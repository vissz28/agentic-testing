# Running the tests through the pipeline

Followed by `/quality-code:check`: the same steps for every suite. You ask and relay; the script runs and grades. Plain English, short sentences, numbered cards. Show every card and output the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a section per step, tables, colour marks, and the picker for questions. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool. End your turn after every card and wait for the answer.

## Rules

- **Where files go.** When the command has ended (after its last card is answered, or its last step when it shows none), follow `${CLAUDE_PLUGIN_ROOT}/guides/save-place.md`: the first run of a project asks once where its files and logs are kept.
- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **Node.js:** do not check for it yourself (no `Get-Command node`, `where node`, `which node`, `node -v`). Run the script. Only when a script call fails with `node is not recognized`, `command not found: node` or `node: not found`, follow `${CLAUDE_PLUGIN_ROOT}/guides/node-missing.md` (it finds Node installed per user, for all users or with nvm, and runs the script again) before you tell the person anything.
- **The script decides.** `pipeline.mjs` runs and grades. Never compute, change or soften a verdict, a count or a score yourself.
- **Never edit tests**, source files or config, and never retry. If the card shows a problem, show it and stop. The one exception is the **Compile errors** step below, and only after a yes.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop or Cancel option. Read only the first word for this; a sentence that gives a result (and no number) is a typed answer.
- **Language.** Talk in the language of the user's messages; before they write one, in the ticket's language (Italian for an Italian ticket). Script output and cards stay as printed.
- **One run per request.** If the user wants another run, they ask again.
- **Never read or show file contents or diffs.** Use only paths, kinds, counts and keys from `BRANCH_JSON`.
- **Never ask for a token**, key or password in the chat.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/bin/<script>" …`. With `root` in the config the project root is that folder: every path the scripts print or take is relative to it, so the files you read and write are under it.

## The suite

`/quality-code:check` names the suite from its flag: `frontend` (`--frontend`: the Playwright specs), `backend` (`--backend`: the specs of the backend runner, Vitest, pytest, JUnit, Go or .NET), `full` (no flag: both) or `smoke` (`--smoke`, see **Smoke** below). Keep it as `<suite>` for every step below.

## Steps

0. **Evals.** Only for the `full` suite. With `--evals` in `$ARGUMENTS`, run only `node "${CLAUDE_PLUGIN_ROOT}/bin/evals.mjs"` (the frozen evals in `.claude/quality-code/evals/`: each ticket's committed specs must keep saying what its fixture pins), show its lines as printed and stop. Exit 3 means there is no fixture yet: say so in one line.
1. **Project.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check --runner`. If it does not print `ok`, show its lines and stop (a missing config is never a dead end: show the **Not set up** card of the display guide). If it prints `ok (personal: …)`, or you are not inside a git repo, say `This needs a repo. Open the project folder, or run /quality-code:setup there.` and stop. Each `missing:` line names a test runner of the config that this project has not installed, so the specs could not run: show the lines and stop. Then read `frontend` and `backend` in the project config (`ticket.mjs config check` shows where it is): a `playwright` project has only `frontend`, a `vitest` project only `"backend": "vitest"`, a `fullstack` project both. They are checked the same way; the script picks the test runner (on a fullstack project, per spec: the e2e folder's specs run under Playwright, the others under Vitest, and the card shows both runners). Remember which it is for step 4.
2. **Specs.** If `$ARGUMENTS` has spec paths, use them and go to step 3. Without `--branch` in `$ARGUMENTS`, the specs are the whole suite: the script lists them itself (`--suite <suite>` in step 4), so do not look for files; say `Running every <frontend | backend | frontend and backend> spec of the project.` and go to step 3. With `--branch` (the `full` suite only; for the others say `--branch checks the whole suite: /quality-code:check --branch.` and stop), run `node "${CLAUDE_PLUGIN_ROOT}/bin/branch.mjs" --detect` and read the `BRANCH_JSON:` line. Take the `files` whose `kind` is `test` and whose `status` is not `D` (a deleted test cannot run). Remember that the specs came from the branch. If there are none, say `No test files changed on this branch. Give the spec paths: /quality-code:check <spec…>` and stop. Otherwise show this card and end the turn:

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

   With a key, look in `<ticketsDir>/<KEY>/` (`ticketsDir`: the path on the `tickets folder:` line of `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`, used as it is), where `write` and `ticket --eval` saved the ticket: when `ticket.json` is there, pass `--ticket @<ticketsDir>/<KEY>/ticket.json` (the value check then runs too), and `--expected @<ticketsDir>/<KEY>/expected.json` when that file is there; when `target` is there and names an existing file that is not one of the specs, and the project is `vitest` or `fullstack`, pass `--target '<that path>'` (Stryker then runs on it). Never pass `--target` on a `playwright` project. Missing files: leave the flag out; do not read the ticket from Jira here.

   Quote every spec path in single quotes. Pass `--range <base>...HEAD` only when the specs came from the branch (step 2 with `--branch`, or the spec command's "Only check the tests already on this branch"), with `base` from the `BRANCH_JSON:` line (the field `base`, for example `origin/main`). Honesty then reads everything committed on the branch since it left the base, so an assertion or test removed in an earlier commit is caught. It does not read changes that are not committed yet; with specs the user typed, no range is passed and honesty reads the changes not committed yet. Pass `--flaky` only when `$ARGUMENTS` has it. Do not pass `--json`.
5. **Card.** Show the card exactly as printed. Drop the `PIPELINE_JSON:` line. Add nothing, grade nothing. Lay it out with the **Richer cards** of the display guide: the headline row (verdict, and the bar and gate only when the card prints a score and a bar to pass), the counts the card prints, a `Next:` line, marks as the guide lists them, and any list or per-test detail beyond 8 rows in a `<details>` block after the table. The `Next:` line: after a green card, `/quality-code:check --backend` for the `frontend` suite, `/quality-code:check --frontend` for `backend`, `/quality-code:check --smoke` for `full` and `/quality-code:check` for `smoke`; after a red `smoke` card, `/quality-code:spec <KEY>`; after a red, failed or could not run card, the same command again once the problem on the card is fixed. If the script exits with 2 and its line is `This project has no frontend (Playwright) tests: …` (the `frontend` or `smoke` suite), follow `${CLAUDE_PLUGIN_ROOT}/guides/add-playwright.md` (a card: set Playwright up now, yes, no or other; on yes it installs, writes the config and runs the check again; with `--ci` it only shows the line). For any other exit 2, show its lines as they are and stop (for example `This project has no frontend (Playwright) tests`).

## Compile errors

After step 5, only when the card (or the output behind it) shows compile or type errors in spec files, and not with `--ci`, offer the fix with the picker (a sample is fine when the output was cut short):

```
The specs do not compile. Fix them?
1. Fix the compile errors in these spec files
2. Not now
```

On `1`: change only the spec files the errors name, and only the lines the errors name (an argument that does not match its type, a missing field, a wrong argument count, a missing header). Never source files or config, never remove or soften an assertion, never delete a test. Show each change as a `diff` block, then run the same step 4 command once and show its card as step 5 does. If errors remain, show them and stop: a second fix needs a new request. On `2`, stop as before.

## Smoke

The suite `smoke` (`/quality-code:check --smoke [--url URL]`) is the frontend suite cut down to the tests tagged `@smoke`: skip steps 0, 2 and 3 (no spec paths, no key, no `--branch`, no `--flaky`), do step 1, then say `Running the smoke tests (@smoke): the critical few, nothing is changed.` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/pipeline.mjs" --smoke [--url '<URL>']` (the `--url` only when `$ARGUMENTS` has it; quote it; never put a user name or password in it), then step 5. Exit 2 with `No @smoke tests found` means nothing is tagged yet: show the line and stop. Read-only: never tag, edit or add a test here.
