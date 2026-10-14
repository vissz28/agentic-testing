# Part 5: rollout

Status: draft, open decisions in §8 · Date: 2026-10-14 · Owner: Elvis Zefaj · Jira: AGT-44 · Builds on:
parts [1](2026-10-12-part-1-core-config-design.md), [2](2026-10-14-part-2-shared-checks-design.md),
[4a](2026-10-14-part-4a-vitest-pipeline-design.md), [4b](2026-10-14-part-4b-write-tests-design.md),
[3](2026-10-14-part-3-playwright-design.md)

## 1. Goal

The warehouse frontend and backend run on `quality-code` with the same logic their own harness had,
and any other team can start in about 15 minutes. Part 5 adds no new checks: it switches repos,
proves nothing changed for them, and writes the onboarding.

## 2. Decisions

| Decision | Value |
|---|---|
| First repos | warehouse-backend (Vitest), then warehouse-frontend (Playwright, after part 3 ships). |
| How a repo switches | One merge request per repo: add `.claude/quality-code.json`, remove the old harness. |
| Configs | Prepared here in [`docs/rollout/`](../rollout/) from the parity configs, validated by a test. |
| Proof | Logic parity, not text parity: the same gate scores and decisions, the same check verdicts. Warehouse wording and values stay in the warehouse config. |
| Old harness | Removed in the same merge request that adds the config; never two harnesses in one repo. |
| Onboarding | One page, [`docs/ONBOARDING.md`](../ONBOARDING.md), plus a lead's checklist in it. |
| Release | `1.0.0` when the pilot criteria (§7) hold. |

## 3. The warehouse configs

[`warehouse-backend.quality-code.json`](../rollout/warehouse-backend.quality-code.json) and
[`warehouse-frontend.quality-code.json`](../rollout/warehouse-frontend.quality-code.json) are the
parity configs (116 fixtures prove the gate gives the old results with them) plus what parts 4a and 4b
added:

| Repo | Added | Why |
|---|---|---|
| backend | `vitest.configs`: `**/*.e2e.spec.ts` → `vitest.config.e2e.ts`, `test/**` → `vitest.config.db.ts` | the old `check` skill picked these configs by path |
| backend | `vitest.layers`: `unit`, `integration`, `range`, `api` in `test/<layer>/` | the old `spec` skill's layers; the live database stays in the team's own Vitest config and test helpers, never in the plugin |
| frontend | `.env.*` in `boundaries.forbidden` | the backend forbade it and the frontend did not; the general default forbids it too |

`setup` re-confirms each config inside its repo (rerun starts from the file).

## 4. Proof before switching

1. **Gate:** run `ticket-eval` on the 20 most recent tickets of each repo with both harnesses; scores
   and pass/refuse must match. The replay suite already covers 116 fixtures; add the frontend's own
   saved real tickets, which only the backend has today.
2. **Checks:** run `/quality-code:check` on each repo's existing specs on a branch, and the old
   `check` on the same specs; the verdicts must match, or the difference must be one the specs record
   as deliberate (for example the mutation bar fixed at 100%, or one exit-code scheme).
3. **Writing:** one real ticket per repo through `/quality-code:write` (backend) and the part 3 flow
   (frontend); a developer reads the specs.

## 5. Switching a repo

The merge request:

- adds `.claude/quality-code.json` (from `docs/rollout/`) and the `.gitignore` lines setup writes;
- removes the old harness: its commands, skills, hooks, scripts and their lines in `CLAUDE.md`;
- replaces a CI ticket gate, if any, with `ticket-eval <KEY> --ci`;
- says in its description how to install the plugin (`/plugin install quality-code@quality-code`).

## 6. Onboarding

`docs/ONBOARDING.md`: install, setup, the first ticket, the first check, the first written test; moving
from your own harness; a checklist for a team lead (connectors, config reviewed, CI gate, who owns the
config).

## 7. Pilot

- Warehouse uses it for one sprint. Every surprise is an issue with the ticket key and the card.
- Pilot criteria for `1.0.0`: no gate decision differs from the old harness without a recorded reason;
  every verdict can be explained from its card; no write outside the boundary.
- Then one or two other teams, chosen by the owner.

## 8. Open decisions

From the logic-parity audit of the warehouse plugins (logic they had that no part covers yet):

| Item | Options |
|---|---|
| Seeding test data (`:seed`) | build as a part, or leave seeding to the team's own helpers (recorded) |
| Run log, audit log, KPI rollup | build (partly covered by `/quality-code:consumption` for AI usage), or drop |
| Ticket-eval refuse option 3 ("continue anyway") | remove it, or let `write` run with every result marked at risk as the old harness did |
| Merge-request links from the Jira dev panel | fetch them in `start`, or drop |
| Which teams follow warehouse | the owner's choice |

Switching warehouse does not wait on these, except the option 3 behaviour, which a developer meets on
day one.

## 9. Access

The warehouse repos are on the team's GitLab. Opening their merge requests needs the GitLab connector
signed in (read-write for the merge request) or a developer applying the change by hand from this page.

## 10. Acceptance criteria

1. Both warehouse repos run on `quality-code` with no old harness left.
2. §4 proofs recorded in the merge requests.
3. A new team gets from install to a first gated ticket with `docs/ONBOARDING.md` alone.
4. The rollout configs stay valid: a plugin test validates every file in `docs/rollout/`.
