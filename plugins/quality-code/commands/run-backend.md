---
description: Run every backend (Vitest) spec of the project through the pipeline: tests, assertions, types and mutation. Shows the verdict card the script prints.
argument-hint: [spec…] [--key KEY] [--flaky N]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
---

Runs the backend suite: every Vitest spec in the project's test layers, or the spec paths given. Read `${CLAUDE_PLUGIN_ROOT}/guides/run.md` and follow it with the suite `backend` and `$ARGUMENTS`. Its rules apply: **Run each plugin script exactly as written**, one call each.
