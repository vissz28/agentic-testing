---
description: Turn a Jira ticket OR an XRay case into a Playwright spec + run the full pipeline (tsc/e2e/suite-honesty/mutation/visual). The automation half of /spec. No XRay rows written.
argument-hint: <TICKET-KEY> | <qa-plan.xlsx> ["<sheet>"] [<TC ID>] [<TICKET>] — then [--mr <ref>] [--ci] [--dry-run] [--no-mutate] [--mutation-threshold <pct>] [--no-edges]
---

The **Playwright half** of `/spec`: a Jira ticket (or a hand-written XRay case) in, a Playwright
spec under `e2e/tests/` out, then the full post-write pipeline. It writes **no** XRay rows (no csv,
no `<KEY>.xlsx`) — for those use `/xray`, or `/spec` to emit both halves linked by one test key in a
single pass.

## What it shares with /spec

Do exactly `/spec` **Steps 1–6** — both input modes (Step 2 ticket path with the readiness gate +
MR diff, or Step 2b `read-case.mjs` case path), Figma (Step 3), route (Step 4), draft + edges
(Step 5 / 5b), review gate (Step 6) — same token rules, same gate and honesty behavior. Then:

- Flags are `/spec`'s minus `--qa-only` (that flag is the XRay-export path, which this command is
  the opposite of): `--mr <ref>`, `--ci`, `--dry-run`, `--no-mutate`, `--mutation-threshold <pct>`,
  `--no-edges`. Neither a key nor an `.xlsx` →
  `pass a ticket key or a qa-plan sheet: /playwright <KEY> | /playwright .claude/harness/qa-plans/<plan>.xlsx`.

## Write (replaces /spec Step 7)

Write the **spec only** — `e2e/tests/<route-slug>/<KEY>.spec.ts`, exactly as `/spec` Step 5 drafts
it (one `test('<key>',…)` per scenario, edges as `-edge-<n>-` keys, a Figma capture test if there
is a design). Figma present → also write its `meta.json`. **Skip `append-testcase.mjs`** — this
command writes no XRay rows.

## Pipeline (/spec Step 8, unchanged) — relay stdout, do not reformat

```bash
node .claude/harness/run-pipeline.mjs --key <KEY> --spec e2e/tests/<route-slug>/<KEY>.spec.ts [--no-mutate] [--mutation-threshold <pct>] --audit '<json>'
```

The report shows `+0 CSV rows` because this command writes none — that is honest, not a miss.
Everything else behaves as in `/spec` Step 8: honesty fail stops the run, a red new-AC test is used
as a regression anchor (not a broken run), the assertion-mutation gate applies, red edges are
findings not failures, and the run is logged to `.claude/audit/xray-test.jsonl`. Tag every red test
the card shows, as `/spec` Step 5 says (`@anchor` / `@finding` plus `@<KEY>`), or CI's blocking
e2e gate fails on it.

To keep the spec's test keys aligned with an XRay case, run `/spec` (one pass, guaranteed link), or
generate the case first with `/xray <KEY>` and feed its `.xlsx` here.

## Examples

- `/playwright FIC-13441`
- `/playwright FIC-13441 --dry-run`
- `/playwright FIC-13441 --no-mutate` — full pipeline without assertion mutation
- `/playwright FIC-13441 --no-edges` — only the ticket's AC tests
- `/playwright FIC-13441 --ci`
- `/playwright .claude/harness/qa-plans/multi-warehouse.xlsx "Lista movimenti" 2 FIC-11780` — from QA's case 2

## Maintainers

Shares the draft logic in `/spec` (`${CLAUDE_PLUGIN_ROOT}/commands/spec.md`); before changing generated spec
shape, run `node .claude/harness/evals.mjs` and update the fixtures as for `/spec`.
