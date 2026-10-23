---
description: Run the full suite, frontend and backend, through the pipeline in one run (or only the tests changed on this branch with --branch). Shows the verdict card the script prints.
argument-hint: [spec…] [--branch] [--key KEY] [--flaky N] | --evals
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
---

Runs the full suite: the frontend and the backend specs together, each under its own runner, or the spec paths given. Read `${CLAUDE_PLUGIN_ROOT}/guides/run.md` and follow it with the suite `full` and `$ARGUMENTS`. Its rules apply: **Run each plugin script exactly as written**, one call each.
