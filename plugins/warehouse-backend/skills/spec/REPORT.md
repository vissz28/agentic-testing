# Quality Program coverage — warehouse-backend `/spec`

What this harness covers against the parent-folder docs, and the numbers to watch.
Re-measure; do not edit the tables from memory.

Sources (parent of `warehouse-backend/`):

- `TeamSystem Quality Program v1.3_short.docx` (§4 pre-merge loop, §6 honesty, §9 KPIs, §10 harness, Appendix A)
- `xray-test-how-it-works.md` (frontend `/xray-test` — the reference slice)
- `mock_tickets_for_jira_test.md` (scorer lock)
- `baseline_data/reports/2026_strategy_report.md` (pilot sequencing; the old `strategy_plan_DRAFT.md` was renamed and moved here in dadd056)

---

## How to refresh

```bash
npm run test:kpi          # §9 rows this repo can source
npm run test:cov          # then test:kpi again for the coverage row
node .claude/harness/sanitize-ticket.mjs --self-test
node .claude/harness/expected-check.mjs --self-test
node .claude/boundary-guard.mjs --self-test
node .claude/harness/score-ticket.mjs --self-test
node .claude/harness/honesty-check.mjs --self-test
node .claude/harness/suite-honesty.mjs --self-test
node .claude/harness/mutate-generated.mjs --self-test
node .claude/harness/run-pipeline.mjs --self-test
node .claude/harness/evals/run.mjs --self-test
node .claude/harness/kpi.mjs --self-test
```

Paste `npm run test:kpi` stdout into **§ Snapshot**. Tick a gap in **§ Backlog** only when the **Verify** command says so.

---

## Snapshot — 2026-08-13

From `npm run test:kpi` (targets = §9 starting points, not yet calibrated per product).

| KPI | Measured | Target | Status | Detail |
|---|---:|---:|---|---|
| Requirement Traceability | **100%** | 100% | ✅ | 14/14 live specs name a `FIC-` ticket |
| Suite Honesty | **96%** | 100% | ⚠️ | 26/27 tests carry a real `expect(` |
| Completeness of Requirements | no data | ≥ 95% | — | 0 scored tickets in `.claude/audit/ticket-eval.jsonl` |
| Test Coverage (unit) | no data | ≥ 80% | — | run `npm run test:cov` |
| Gate integrity | **100%** | 100% | ✅ | 7/7 recorded runs fully gated |
| Adoption (acceptance) | no data | set at Strategy | — | 0/0 scored tickets generated a spec |
| Assertion mutation kill | **100%** | 100% | ✅ | mean over 4 eligible runs |
| Generated pipeline runs | 7 | — | — | 4 specs predate the readiness gate (outside adoption) |

Not sourced here (program-level, still blank on purpose): Defect Density, DRE, CFR, DSR, MTTR, Bug Reopening Rate.

Discovery baselines to beat (not this harness): suite mutation **45.9%** overall / **34%** `kpi.service.ts` (`baseline_data/mutation/mutation_probe_2026-07-23.md`); DRE ≈96%; BRR ≈1.5%.

---

## Pre-merge loop (§4 / A.2)

| Step | Program intent | Here? | Evidence |
|---|---|---|---|
| 1. Define | Human writes a clear ticket | **partial** | `.claude/TICKET_TEMPLATE.md` exists; intake is not enforced |
| 2. Before-Code | Flag thin / untestable AC | **yes** | `sanitize-ticket.mjs` + `score-ticket.mjs` inside `/spec`. Below 60% → refuse + Jira comment (`--refuse-comment` / `addCommentToJiraIssue`). Derivable count is from ticket text, not model `scenarios[]`. |
| 3. Test generation | Agent writes tests from ticket + QA plan | **partial** | `/spec` → `test/{unit,integration,range,api}/`. QA plans are **read-only** (ticket Then wins). No XRay writeback (backend tests live in git — intentional) |
| 4. Execution | Run tests; red-before-fix is fine | **yes, local** | `run-pipeline.mjs` → Testcontainers + Vitest. Docker down → `not_executed` (fail). Not a CI job |
| 5. Honesty | Green by fixing code, not weakening tests | **partial** | diff honesty + hollow-test + **expected-check** (ticket numbers/language, plus model tokens **grounded** in ticket text before they can fail the spec) + **hollow_target** + assertion mutation + Bug source-red (`@stryker-mutator/*` in `package.json`). `--fast` / missing binary on a green Bug → `stryker_unavailable`. `boundary-guard.mjs` refuses writes outside `test/`. **No coverage-drop check.** |
| 6. Reviewer agents | Extra review nets | **no** | Out of scope for this slice (same as frontend) |
| 7. Human review | Dev / Champion sample agent output | **partial** | three Claude Code pauses (`1`/`2`/`3`) + QA pipeline card. No Champion sampling process |
| 8. Merge with gates | CI blocks dishonest green | **no** | `.gitlab-ci.yml` runs `npm run test:cov:ci` only. No honesty / suite-honesty / live-spec job |

**CI gate live? N** — until this is Y, every check is voluntary on a laptop.

---

## Harness inventory vs frontend `/xray-test`

| Piece | Frontend | Backend | Notes |
|---|---|---|---|
| Ticket scorer | `e2e/xray/score-ticket.mjs` | `.claude/harness/score-ticket.mjs` | ✅ lock: mock tickets 0 / 55 / 100 (see below) |
| Pipeline conductor | `run-pipeline.mjs` | `run-pipeline.mjs` | ✅ |
| Diff honesty | `honesty-check.mjs` | `honesty-check.mjs` | ✅ no coverage-delta |
| Hollow-test gate | `suite-honesty.mjs` | `suite-honesty.mjs` | ⚠️ 96%; default scan path still comments `src/` |
| Assertion mutation | `mutate-generated.mjs` | `mutate-generated.mjs` | ✅ |
| KPI rollup | `kpi.mjs` / `e2e:kpi` | `kpi.mjs` / `test:kpi` | ✅ |
| Standalone `/ticket-eval` | yes | **no** | scoring only inside `/spec` |
| QA-plan input | `read-case.mjs` + xlsx | **read-only md** | `test/qa-plans/<Feature_Label>.md`, human-authored; `/spec` reads, never appends, ticket Then wins |
| XRay CSV / xlsx | `append-testcase.mjs` | n/a | intentional: code-level tests in git |
| Eval set for the tool | `evals/run.mjs` (empty corpus) | **yes** | `node .claude/harness/evals/run.mjs` — FIC-13441 / 13436 / 13971 |
| Boundary guard | `.claude/boundary-guard.mjs` | **yes** | `node .claude/boundary-guard.mjs --self-test` |
| Figma / visual | yes | n/a | frontend-only |
| Live specs | Playwright | files under `test/` | FIC-13173, 13436, 13441, 13628, 13860, 13971, 13962 |

---

## Scorer lock (`../../../../mock_tickets_for_jira_test.md`)

Threshold 60%. Below that is refuse (no warn rescue). Re-run the three bodies through `score-ticket.mjs --json`. Fail the lock if any cell drifts.

| Ticket | Expected | Measured 2026-08-25 | Gate interactive | Gate `--ci` |
|---|---|---|---|---|
| Bare (one-line IT prose) | 0%, `legacy / unstructured` | **0%** `legacy` | refuse | refuse, exit 1 |
| Mid (structured bug, no Gherkin) | ~55%, thin | **55%** | refuse | refuse, exit 1 |
| Full (Gherkin + labels + `[BE]`) | 100%, ready | **100%** `Giacenza_Prodotti` | pause 1 read-back | auto-yes |

---

## Backlog — tick only when Verify is green

Ordered by leverage. Item 1 outranks new mechanism.

| # | Item | Status | Verify |
|---|---|---|---|
| 1 | **CI job** runs honesty-check + suite-honesty + `npm run test:db` on MRs (non-blocking first) | missing | `.gitlab-ci.yml` contains those scripts; a pipeline on an MR shows the job |
| 2 | **Eval fixtures** `evals/<KEY>/{input,expected}.json` + `evals/run.mjs` — freeze a good `/spec` run | done | `node .claude/harness/evals/run.mjs` exits 0 against ≥1 fixture |
| 3 | **`/ticket-eval`** command (Before-Code gate on its own) | missing | `.claude/commands/ticket-eval.md` exists; `/ticket-eval FIC-…` prints `test-readiness` |
| 4 | **QA plans** `test/qa-plans/<Feature_Label>.md` (human-authored, read-only) | done | `test/qa-plans/` exists; step 4 reads, ticket Then wins, agent does not append |
| 5 | **Coverage-drop honesty** (A.2 Step 5: touched-file coverage must not fall) | missing | honesty-check (or a sibling script) fails an MR that deletes covered lines without new tests |
| 6 | **Boundary guard** refuses Write/Edit to `src/`, `.gitlab-ci.yml`, `.env` for `/spec` sessions | done | `node .claude/boundary-guard.mjs --self-test` |
| 7 | **Suite Honesty 100%** | 96% | `npm run test:kpi` Suite Honesty row is 100% |
| 8 | **Completeness + Adoption have data** | no data | `test:kpi` Completeness ≠ no data (run `/spec` so `ticket-eval.jsonl` fills) |
| 9 | **Unit coverage row filled** | no data | `npm run test:cov && npm run test:kpi` shows a % |
| 10 | Hot-module Stryker ≥80% (`kpi.service`, `movement.service`) before more generated tests | missing | Stryker report ≥80% on those files (baseline 34% / 50.3%) |
| 11 | Before-Code **writes a Jira comment** (A.2 Step 2) — opt-in, after team agrees | done | `/spec` refuse posts `--refuse-comment` via `addCommentToJiraIssue` |
| 12 | Reviewer / Security / Reliability / Production-Observer agents | out of scope | leave until Strategy; do not tick from this slice |

Program agents we are **not** counting as backend `/spec` work: Execution-as-CI-trigger (GitLab already runs tests), XRay Cloud writeback, Confluence QA-plan read, OpenAPI Before-Code, After-Release learning loop.

---

## What “done enough for the pilot slice” means

This file is green for the **test-generation + honesty** slice when:

1. Snapshot Suite Honesty = 100%, RT stays 100%, Gate integrity stays 100%.
2. Backlog **#1 is Y** (CI gate live).
3. Backlog **#2** has ≥1 frozen eval fixture.
4. Scorer lock still 0 / 55 / 100.

It is **not** the full Quality Program. Do not report §4 Steps 6–8 or §8’s learning loop as covered from this repo.
