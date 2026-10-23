---
description: Run every frontend (Playwright) spec of the project through the pipeline: tests, assertions, types and the other checks. Shows the verdict card the script prints.
argument-hint: [spec…] [--key KEY] [--flaky N]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
---

Runs the frontend suite: every Playwright spec in the project's e2e folder, or the spec paths given. Read `${CLAUDE_PLUGIN_ROOT}/guides/run.md` and follow it with the suite `frontend` and `$ARGUMENTS`. Its rules apply: **Run each plugin script exactly as written**, one call each.
