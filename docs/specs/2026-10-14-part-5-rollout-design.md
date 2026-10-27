# Part 5: rollout

Status: decisions in §8 taken 14 Oct and 27 Oct (switch merge requests and pilot dropped, see §8) · Date: 2026-10-14 · Owner: Elvis Zefaj · Jira: AGT-44 · Builds on:
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
2. **Checks:** run `/quality-code:run-pipeline` on each repo's existing specs on a branch, and the old
   `check` on the same specs; the verdicts must match, or the difference must be one the specs record
   as deliberate (for example the mutation bar fixed at 100%, or one exit-code scheme).
3. **Writing:** one real ticket per repo through `/quality-code:spec` (backend) and the part 3 flow
   (frontend); a developer reads the specs.

## 5. Switching a repo

Step-by-step draft: [`docs/rollout/onboarding-quality.md`](../rollout/onboarding-quality.md).

The merge request:

- adds `.claude/quality-code.json` (from `docs/rollout/`) and the `.gitignore` lines setup writes;
- removes the old harness: its commands, skills, hooks, scripts and their lines in `CLAUDE.md`;
- replaces a CI ticket gate, if any, with `ticket-eval <KEY> --ci`;
- says in its description how to install the plugin (`/plugin install quality-code@teamsystem`).

## 6. Onboarding

`docs/ONBOARDING.md`: install, setup, the first ticket, the first check, the first written test; moving
from your own harness; a checklist for a team lead (connectors, config reviewed, CI gate, who owns the
config).

## 7. Pilot

- Warehouse uses it for one sprint. Every surprise is an issue with the ticket key and the card.
- Pilot criteria for `1.0.0`: no gate decision differs from the old harness without a recorded reason;
  every verdict can be explained from its card; no write outside the boundary.
- Then one or two other teams, chosen by the owner.

## 8. Decisions (owner, 14 Oct)

Taken from the logic-parity audit of the warehouse plugins: carry over what the warehouse did,
generalized through the config.

| Item | Decision | Warehouse reference |
|---|---|---|
| Ticket-eval refuse option 3 ("continue anyway") | Kept for developers. It leads to `write` with every result marked: the pipeline gets `--incomplete-ticket <score>` and the card opens with `🔴 [RISK / NOT RECOMMENDED] Ticket incomplete (<score>/<bar>)`. The verdict is unchanged; the override is recorded in the audit log. | AGT-31 |
| Run log, audit log, KPI rollup | Built: one JSON line per gate, pipeline run, Jira write and override in `.claude/quality-code/audit/`, **git-ignored** (the warehouse committed its logs and they grew with every run); `/quality-code:kpi` rolls them up. AI cost stays in `/quality-code:consumption`. | AGT-31, AGT-34 |
| Seeding test data | Built: `/quality-code:seed <KEY>`, the data-only sibling of `write`: the project's own builders (Vitest) or network stubs copied from an existing spec (Playwright); an optional documented known dataset. | AGT-16, the warehouse `/seed` |
| Merge-request links from the Jira dev panel | **Decided 27 Oct (owner):** the dev panel itself is not fetched. `/quality-code:spec` finds the branch's merge request itself (GitLab connector) or pull request (`gh`), and `ticket-eval` reads the ticket's web links and any merge request URL in its text. A merge request that exists only in the dev panel is not seen. | — |
| Which teams follow warehouse | **Open, the owner's choice.** The pilot (§7) runs on warehouse first; the next one or two teams are named by the owner after the pilot criteria hold. | — |

Status 27 Oct: the owner dropped the switch merge requests (§5) and the proofs (§4) for now: no
merge request is opened on the warehouse repos, and the CI ticket gate (`ticket-eval <KEY> --ci`) is
left for scripts to be added later. Any team can follow warehouse. Three decisions are built and released (option 3, the audit log and KPI rollup, seeding;
see the changelog). The merge-request proposal is confirmed. Which teams follow warehouse: any team. The pilot and `1.0.0`
need the warehouse repos and GitLab access (§9) and are not started.

## 9. Access

The warehouse repos are on the team's GitLab. Opening their merge requests needs the GitLab connector
signed in (read-write for the merge request) or a developer applying the change by hand from this page.

## 10. Acceptance criteria

1. Both warehouse repos run on `quality-code` with no old harness left.
2. §4 proofs recorded in the merge requests.
3. A new team gets from install to a first gated ticket with `docs/ONBOARDING.md` alone.
4. The rollout configs stay valid: a plugin test validates every file in `docs/rollout/`.
