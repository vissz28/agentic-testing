---
description: Check the project's tests through the pipeline: tests, assertions, types and mutation, then one verdict card. With no flag, the full suite, frontend and backend (--branch: only the tests changed on this branch). --backend or --frontend checks one side; --smoke runs only the critical tests tagged @smoke, fast and read-only, against the running app or --url.
argument-hint: [spec…] [--branch] [--backend | --frontend] [--key KEY] [--flaky N] | --smoke [--url URL] | --evals
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
---

Checks the tests. Pick the suite from `$ARGUMENTS`, drop that flag, then read `${CLAUDE_PLUGIN_ROOT}/guides/run.md` and follow it with the suite and the rest of the arguments. Its rules apply: **Run each plugin script exactly as written**, one call each.

- **`--smoke`:** the suite `smoke`: only the Playwright tests tagged `@smoke`, in seconds, against the app your Playwright config starts or, with `--url`, against that environment (staging, a preview, production). Read `${CLAUDE_PLUGIN_ROOT}/guides/smoke.md` first for what a smoke run is. Show the verdict the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a live checklist, the pipeline card as a `###` section with the headline row first and the tests as a table and `diff` block, files as `HERE` links, never a code-block card. It makes nothing, so it has no wrap-up.
- **`--backend`:** the suite `backend`: every spec of the backend runner (Vitest, pytest, JUnit, Go or .NET) in the project's test layers, or the spec paths given.
- **`--frontend`:** the suite `frontend`: every Playwright spec in the project's e2e folder, or the spec paths given.
- **None of them, or both `--backend` and `--frontend`:** the suite `full`: the frontend and the backend specs together, each under its own runner, or the spec paths given.

Every question is asked with the AskUserQuestion picker as `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says, never as a numbered text card; the text card is only for a client without the tool. Every end of the command closes with the Next line from display.md: the one or two likeliest next commands, as code.

## Examples

- `/quality-code:check` checks the full suite.
- `/quality-code:check --branch` checks only the tests changed on this branch.
- `/quality-code:check --backend` checks every backend spec; `/quality-code:check --frontend` every frontend spec.
- `/quality-code:check e2e/cart.spec.ts --key ABC-123` checks one spec for one ticket.
- `/quality-code:check --smoke --url https://staging.example.com` runs the @smoke tests against staging.
- `/quality-code:check --evals` runs the frozen evals.
