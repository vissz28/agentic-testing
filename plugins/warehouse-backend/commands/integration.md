---
description: Generate ONLY the Integration-layer Vitest spec from a Jira ticket (live Testcontainers Postgres). Single-layer sibling of /spec.
argument-hint: [TICKET-KEY | NUMBER] [--path src/…/foo.ts] [--no-edges] [--fast] [--no-mutate] [--mutation-threshold <pct>] [--no-stryker] [--dry-run] [--ci] [--mocked]
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/spec/SKILL.md` and follow it for `$ARGUMENTS`, with one change: produce **only the Integration layer**.

- Steps 1–4 unchanged (resolve ticket, score/gate, pick target, style + QA plan).
- Step 5: draft **only** `test/integration/…spec.ts` (Integration section of `${CLAUDE_PLUGIN_ROOT}/skills/spec/layers.md` — two+ real collaborators: service + repos + Prisma). Do not write the unit or range files. If the Integration layer does not apply to the target (per layers.md — a repository with no in-scope service caller and no table join), say so and stop; do not force a hollow spec.
- Pauses 1 and 3 unchanged. Pause 2: same numbered card; only this layer's "We will check" sentences (no file paths, no Integration label).
- Step 7 pipeline: pass only `--spec test/integration/…spec.ts` to `run-pipeline.mjs`.

Read `${CLAUDE_PLUGIN_ROOT}/skills/spec/layers.md` and `${CLAUDE_PLUGIN_ROOT}/skills/spec/seed.md` before drafting. Read-only on Jira; writes under `test/integration/`.
