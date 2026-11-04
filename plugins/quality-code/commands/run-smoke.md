---
description: Run the smoke suite, the few critical tests tagged @smoke, fast against the running app or any environment URL. Read-only. Shows the verdict card the script prints.
argument-hint: [--url URL]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
---

Runs the smoke suite: only the Playwright tests tagged `@smoke`, in seconds, against the app your Playwright config starts or, with `--url`, against that environment (staging, a preview, production). Read `${CLAUDE_PLUGIN_ROOT}/guides/smoke.md` for what a smoke run is, then read `${CLAUDE_PLUGIN_ROOT}/guides/run.md` and follow it with the suite `smoke` and `$ARGUMENTS`. Its rules apply: **Run each plugin script exactly as written**, one call each. Show the verdict the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a live checklist, the pipeline card as a `###` section with the headline row first and the tests as a table and `diff` block, files as `HERE` links, never a code-block card. It makes nothing, so it has no wrap-up. It ends with the Next line from display.md: the one or two likeliest next commands, as code (`/quality-code:run-pipeline` after a green run, `/quality-code:spec <KEY>` after a red one).
