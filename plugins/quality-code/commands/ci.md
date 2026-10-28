---
description: The testing phases for GitHub Actions or GitLab CI (or a terminal). It detects what the branch changed, backend or frontend, and runs only the tests that were added or changed, per module, through the pipeline (everything on the default branch or with --all). Also writes the CI file for GitHub or GitLab. The scripts decide; nothing is graded by the model.
argument-hint: [--suite full|backend|frontend] [--all] [--base REF] [--flaky N] [--junit FILE] | --init github|gitlab [--write]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
---

Runs the testing phases in one command and shows the summary the script prints. It is the command a CI job runs (GitHub Actions, GitLab CI), and you can run it by hand to see what CI will see. It reads what the branch changed against its target and **runs** only what was touched: the specs that were added or changed (by you or by Quality Code), one run per module (a backend layer, an e2e folder); a side whose code changed but no spec did runs its whole suite; a side with no change is skipped; docs-only changes have nothing to test. On the default branch, with `--all`, or when the changes cannot be read (no git history), everything runs. Plain English, short lines.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/ci.mjs" …` command, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code.
- **The script decides.** Never compute, change or soften a verdict or a count. Never edit tests, source files or config, and never retry.
- **Language.** Talk in the language of the user's messages. Script output stays as printed.

## Steps

1. **CI file.** If `$ARGUMENTS` has `--init`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/ci.mjs" $ARGUMENTS`. Without `--write` it prints the GitHub Actions or GitLab CI file: show it in a code block and say `Save it as .github/workflows/quality-code.yml (GitHub) or in .gitlab-ci.yml (GitLab), or run /quality-code:ci --init <github|gitlab> --write and I write it for you.` With `--write` it writes the file and never overwrites one (an existing `.gitlab-ci.yml` gets the job in `.gitlab/quality-code.gitlab-ci.yml`, with the `include` line to add): show its lines as printed. Stop.
2. **Run.** Otherwise say `Checking what changed, then running those tests; this can take several minutes.` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/ci.mjs" $ARGUMENTS`. If it exits with 2, show its lines as they are (for example `run /quality-code:setup`) and stop.
3. **Result.** Show the output as printed: one section per phase and the summary. Exit 0 is green, 1 a check failed or a test is red, 3 something could not run (never a pass). Add nothing and grade nothing.

## Examples

- `/quality-code:ci`: only the tests this branch touched, per module
- `/quality-code:ci --all`: every test, backend and frontend
- `/quality-code:ci --suite backend --flaky 3`: backend only, each test run 3 times for flakiness
- `/quality-code:ci --init github --write`: add the GitHub Actions file to the repo
- `/quality-code:ci --init gitlab`: print the GitLab CI job
