---
description: Check Vitest spec files with the pipeline: tests, assertions, types and mutation. Shows the verdict card the script prints.
argument-hint: [spec…] [--key KEY] [--flaky N]
---

Runs the pipeline on spec files. You ask and relay; the script runs and grades. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **The script decides.** `cli.mjs` runs and grades. Never compute, change or soften a verdict, a count or a score yourself.
- **Never edit tests**, source files or config, and never retry. If the card shows a problem, show it and stop.
- **One run per request.** If the user wants another run, they ask again.
- **Never read or show file contents or diffs.** Use only paths, kinds, counts and keys from `BRANCH_JSON`.
- **Never ask for a token**, key or password in the chat.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/core/<script>" …`.

## Steps

1. **Project.** If `.claude/quality-code.json` has `adapter: playwright`, say `The Playwright pipeline comes with part 3. For now this command checks Vitest projects only.` (the script says the same: the Playwright pipeline comes with part 3) and stop.
2. **Specs.** If `$ARGUMENTS` has spec paths, use them and go to step 3. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/core/branch.mjs" --detect` and read the `BRANCH_JSON:` line. Take the `files` whose `kind` is `test`. If there are none, say `No test files changed on this branch. Give the spec paths: /quality-code:check <spec…>` and stop. Otherwise show this card and end the turn:

   ```
   Check these <n> spec files?
     <path>
     <path>
   1. Yes
   2. Pick some
   3. Stop
   ```

   On `2`, show the paths as a numbered list; the user picks several numbers; use those. On `3`, stop.
3. **Key.** A `--key` in `$ARGUMENTS` is used as it is. Otherwise propose `keys[0]` from the branch detect (run it if step 2 did not) and confirm it: `1. Use <KEY>` / `2. A different ticket` / `3. No ticket`, then end the turn. With no key at all, ask `Which ticket? Type its key, for example ABC-123, or say none.` Pass `--key <KEY>` only when there is one.
4. **Run.** Say this one line, then run:

   `Running the checks: tests, assertions, types and mutation; this can take a few minutes.`

   `node "${CLAUDE_PLUGIN_ROOT}/core/pipeline/cli.mjs" <spec…> [--key <KEY>] [--flaky <N>]`

   Pass `--flaky` only when `$ARGUMENTS` has it. Do not pass `--json`.
5. **Card.** Show the card exactly as printed. Drop the `PIPELINE_JSON:` line. Add nothing, grade nothing. If the script exits with 2, show its lines as they are and stop.
