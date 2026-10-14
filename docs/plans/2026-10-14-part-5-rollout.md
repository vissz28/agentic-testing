# Part 5 implementation plan: rollout

Spec: [part 5](../specs/2026-10-14-part-5-rollout-design.md) · Jira: AGT-44 · After 0.6.0 (part 4b) and
part 3.

## Task R1: rollout configs and their test (done here)

Files: `docs/rollout/warehouse-{backend,frontend}.quality-code.json`,
`plugins/quality-code/test/rollout-configs.test.mjs` (every `docs/rollout/*.json` passes
`validateConfig`; backend has the four layers and both Vitest configs; frontend forbids `.env.*`).

## Task R2: onboarding page

File: `docs/ONBOARDING.md`, linked from the README quick start. Install, setup, first ticket, first
check, first written test, moving from your own harness, the lead's checklist.

## Task R3: frontend real tickets in the replay suite

Capture the frontend scorer's results on the saved real tickets the backend already has, as
`test/parity/fixtures/fe--saved-*.json` and expected files.

## Task R4: proofs (needs the warehouse repos)

Spec §4 on both repos; results go in the merge requests.

## Task R5: switch merge requests (needs GitLab access)

Spec §5, backend first; frontend after part 3 ships.

## Task R6: decisions in spec §8, then pilot and 1.0.0

Record each decision in the spec; build what is chosen as its own part; release `1.0.0` when §7 holds.
