---
description: Generate ONLY the Range-layer (fast-check property) Vitest spec from a Jira ticket (live Testcontainers Postgres). Single-layer sibling of /spec.
argument-hint: [TICKET-KEY | NUMBER] [--path src/…/foo.ts] [--no-edges] [--fast] [--no-mutate] [--mutation-threshold <pct>] [--no-stryker] [--dry-run] [--ci] [--mocked]
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/spec/SKILL.md` and follow it for `$ARGUMENTS`, with one change: produce **only the Range layer**.

- Steps 1–4 unchanged (resolve ticket, score/gate, pick target, style + QA plan).
- Step 5: draft **only** `test/range/…spec.ts` (Range section of `${CLAUDE_PLUGIN_ROOT}/skills/spec/layers.md` — 2–4 `fc.asyncProperty` inside an `it(...)` that contains `expect(`, `numRuns: 20`, `db.restore()` per iteration). Do not write the unit or integration files. If the Range layer does not apply to the target (per layers.md — no numeric/date/enum field to vary), say so and stop; do not force a hollow spec.
- Pauses 1 and 3 unchanged. Pause 2: same numbered card; only this layer's "We will check" sentences (no file paths, no Range label).
- Step 7 pipeline: pass only `--spec test/range/…spec.ts` to `run-pipeline.mjs`. Note `--fast` skips range execution — omit it here if you want the range run.

Read `${CLAUDE_PLUGIN_ROOT}/skills/spec/layers.md` and `${CLAUDE_PLUGIN_ROOT}/skills/spec/seed.md` before drafting. Read-only on Jira; writes under `test/range/`.
