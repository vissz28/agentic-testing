---
description: Turn a Jira ticket into XRay manual test cases only (csv + <KEY>.xlsx) — the QA-authoring half of /spec. No Playwright spec, no e2e run.
argument-hint: <TICKET-KEY> [--ci] [--dry-run] [--no-edges]
---

The **XRay half** of `/spec`: a Jira ticket in, XRay manual test cases out
(`.claude/harness/warehouse-testcases.csv` + `e2e/tickets/<KEY>/case.xlsx` + `case.csv`) for QA to review or import.
It writes **no** Playwright spec and runs **no** e2e / tsc / mutation — for that use
`/playwright`, or `/spec` to emit both halves linked by one test key in a single pass.

## What it shares with /spec

Do exactly `/spec` **Steps 1, 2 (read ticket + readiness gate), 4 (route / feature label),
5 (+5b edges unless `--no-edges`), 6 (review gate)** — same token rules, same gate behavior —
then stop before `/spec`'s spec write and pipeline. Differences from `/spec`:

- **Input is a ticket key only.** No `.xlsx` case source (a QA sheet is already an XRay case),
  and **no Figma / visual** — `/spec` Step 3 is skipped, XRay rows carry no screenshots.
- **Skip the MR diff.** It exists to pick real selectors for a spec; XRay rows are prose steps
  (action / expected), so it is not read.
- Flags: `--ci` (no prompt), `--dry-run` (print the pre-write plan, write nothing), `--no-edges`
  (skip the proposed edge cases — `/spec` Step 5b). No key → `pass a ticket key: /xray <KEY>`.

## Write (replaces /spec Steps 7–8)

For each drafted scenario and each edge, one row group:

```bash
node .claude/harness/append-testcase.mjs '<json>'
```

`<json>` is the XRay shape from `/spec` Step 5:
`{key,summary,ticket,steps:[{action,data?,expected}],description?,feature?,label?,priority?,epic?,testType?}`.
Idempotent. `testType` defaults to `Cucumber` (these are automated tests from Gherkin, filed as
Cucumber not Manual; use `Generic` for a non-Gherkin automated case). TC ID is assigned per ticket
automatically; leave unknown metadata out rather than inventing it. **Do not** write a `.spec.ts`
and **do not** run `run-pipeline.mjs`.

Report the rows written and `e2e/tickets/<KEY>/case.xlsx` (the workbook QA reviews / imports; `case.csv` holds the same rows for a CSV import). Plain
English; same guardrails as `/spec` — redact customer ids, a closed ticket still generates (flag
its status).

No audit line and no honesty check are written here — there is no spec to grade or log. Use
`/playwright` or `/spec` when you need the run in the KPI audit trail.

## Examples

- `/xray FIC-13441`
- `/xray FIC-13441 --dry-run`
- `/xray FIC-13441 --no-edges` — only the ticket's AC cases, skip the proposed edges
- `/xray FIC-13441 --ci`

## Maintainers

Shares the draft logic in `/spec` (`${CLAUDE_PLUGIN_ROOT}/commands/spec.md`); if you change the XRay row shape,
run `node .claude/harness/evals.mjs` and update the fixtures as for `/spec`.
