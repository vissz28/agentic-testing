---
description: Run the smoke suite, the few critical tests tagged @smoke, fast against the running app or any environment URL. Read-only. Shows the verdict card the script prints.
argument-hint: [--url URL]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
---

Runs the smoke suite: only the Playwright tests tagged `@smoke`, in seconds, against the app your Playwright config starts or, with `--url`, against that environment (staging, a preview, production). Read `${CLAUDE_PLUGIN_ROOT}/guides/smoke.md` for what a smoke run is, then read `${CLAUDE_PLUGIN_ROOT}/guides/run.md` and follow it with the suite `smoke` and `$ARGUMENTS`. Its rules apply: **Run each plugin script exactly as written**, one call each.
