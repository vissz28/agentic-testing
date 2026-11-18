---
description: 'Check the project''s tests through the pipeline: tests, assertions, types and mutation, then one verdict card. With no flag, the full suite, frontend and backend (--branch: only the tests changed on this branch). --backend or --frontend checks one side; --smoke runs only the critical tests tagged @smoke, fast and read-only, against the running app or --url.'
argument-hint: '[spec…] [--branch] [--backend | --frontend] [--key KEY] [--flaky N] [--no-mutation] [--all-mutants] | --smoke [--url URL] | --evals'
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
user-invocable: false
---

Checks the tests. Pick the suite from `$ARGUMENTS`, drop that flag, then read `${CLAUDE_PLUGIN_ROOT}/guides/run.md` and follow it with the suite and the rest of the arguments. Its rules apply: **Run each plugin script exactly as written**, one call each.
**Node.js:** do not check for it yourself (no `Get-Command node`, `where node`, `which node`, `node -v`). Run the script. Only when a script call fails with `node is not recognized`, `command not found: node` or `node: not found`, follow `${CLAUDE_PLUGIN_ROOT}/guides/node-missing.md` (it finds Node installed per user, for all users or with nvm, and runs the script again) before you tell the person anything.

- **`--smoke`:** the suite `smoke`: only the Playwright tests tagged `@smoke`, in seconds, against the app your Playwright config starts or, with `--url`, against that environment (staging, a preview, production). Read `${CLAUDE_PLUGIN_ROOT}/guides/smoke.md` first for what a smoke run is. Show the verdict the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a live checklist, the pipeline card as a `###` section with the headline row first and the tests as a table and `diff` block, files as `HERE` links, never a code-block card. It makes nothing, so it has no wrap-up.
- **`--backend`:** the suite `backend`: every spec of the backend runner (Vitest, pytest, JUnit, Go or .NET) in the project's test layers, or the spec paths given.
- **`--frontend`:** the suite `frontend`: every Playwright spec in the project's e2e folder, or the spec paths given. Before the run, the screens the specs open are checked against the app's routes, in the code and in the browser when the app answers (a path, a `/#/` hash route or a base path, which can differ per project and per environment); this happens for the `full` and `smoke` suites too.
- **`--no-mutation`:** keep it in the arguments for `run.md`: the mutation step is left out, and the card says so. Mutation reruns the passing tests with one assertion changed in each test at a time, the slow step on live end-to-end specs; the config's `maxMutants` caps it instead. A Playwright spec whose config has no `webServer` (it runs against a live app) runs the 5 strongest mutants unless `playwright.maxMutants` says otherwise.
- **`--all-mutants`:** keep it in the arguments for `run.md`. A whole suite (no spec paths) mutates only the specs this branch changed or added, committed or not; the others were mutation-checked when they were written, and the card says how many it left out. `--all-mutants` mutates every spec of the suite.
- **None of them, or both `--backend` and `--frontend`:** the suite `full`: the frontend and the backend specs together, each under its own runner, or the spec paths given.

Every question is asked with the AskUserQuestion picker as `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says, never as a numbered text card; the text card is only for a client without the tool. Every end of the command closes with the Next line from display.md: the one or two likeliest next commands, as code.

## Examples

- `/quality-code:check` checks the full suite.
- `/quality-code:check --branch` checks only the tests changed on this branch.
- `/quality-code:check --backend` checks every backend spec; `/quality-code:check --frontend` every frontend spec.
- `/quality-code:check e2e/cart.spec.ts --key ABC-123` checks one spec for one ticket.
- `/quality-code:check --frontend --no-mutation` checks every frontend spec without the slow mutation step.
- `/quality-code:check --backend --all-mutants` checks every backend spec and mutates them all, not only the ones this branch changed.
- `/quality-code:check --smoke --url https://staging.example.com` runs the @smoke tests against staging.
- `/quality-code:check --evals` runs the frozen evals.
