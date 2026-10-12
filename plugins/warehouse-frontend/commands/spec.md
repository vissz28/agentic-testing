---
description: Turn a Jira ticket (+ optional Figma + optional MR diff) into an XRay case + Playwright spec (shared test key). Token-lean: narrow Jira fields, no repo wander, post-write via run-pipeline.mjs. Chat output is for non-technical QA.
argument-hint: <TICKET-KEY> | <qa-plan.xlsx> ["<sheet>"] [<TC ID>] — then [--mr <ref>] [--ci] [--dry-run] [--qa-only] [--no-mutate] [--mutation-threshold <pct>] [--no-edges]
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/spec-frontend/SKILL.md` and follow it for `$ARGUMENTS`. That file is the single source of truth — this command is only the `/spec` entry point for Claude Code, and the same file is what ships to Claude Desktop as the `spec-frontend` skill.

First do its **Where this runs** check: `.claude/harness/run-pipeline.mjs` must be on disk and this must be the frontend repo (an `e2e/tests/` folder exists). If there is no `e2e/` folder (you see `nest-cli.json`), this is warehouse-backend. Stop and say to use `spec-backend`.

Read-only on Figma, and on Jira except the refuse comment. Writes under `e2e/tests/` + the XRay CSV/xlsx; never `src/`. Numbered pauses (`1` / `2` / `3`), then **end the turn**. `--ci` skips pauses. After the pipeline prints, relay the whole card including the final `Full details:` line, then pause 3 — no recap.
