# onboarding-quality: switching a warehouse repo to quality-code (draft)

Draft runbook for Jira AGT-86 (part 5, [spec](../specs/2026-10-14-part-5-rollout-design.md) §4–5).
One merge request per repo, **backend first**. Each step says what to run and what you should see.
Nothing here is automatic: read each list before you delete anything.

| | Backend (`warehouse-backend`) | Frontend (`warehouse-frontend`) |
|---|---|---|
| Config to add | [`warehouse-backend.quality-code.json`](warehouse-backend.quality-code.json) | [`warehouse-frontend.quality-code.json`](warehouse-frontend.quality-code.json) |
| Stack | Vitest | Playwright |
| Branch name | `onboarding-quality` | `onboarding-quality` |

## 0. Before you start

1. Install the plugin on your machine and check the version:
   ```
   /plugin marketplace update quality-code
   /plugin install quality-code@teamsystem
   ```
   `/plugin` must show `quality-code` **0.8.0 or later**. An older version refuses parts of the config.
2. Jira connected: `/quality-code:start` shows ✅ Jira. In `/plugin`, set `gitlab_api_url` to TeamSystem's
   GitLab, `https://biosphere.teamsystem.com/api/v4` (the default is gitlab.com; the connectors card
   also asks for the address).
3. A clean checkout of the repo's main development branch, then the branch above:
   ```bash
   git switch develop && git pull
   git switch -c onboarding-quality
   ```

## 1. Prove nothing changes (before touching anything)

Use the **old** harness and **quality-code** side by side. Write the results down: they go in the merge
request description (step 6).

1. **Gate, 20 recent tickets.** For each: old `ticket-eval <KEY>` and `/quality-code:ticket-eval <KEY>`.
   Score and pass/refuse must match. Known, deliberate difference: on the backend, a bare `warehouse`
   label no longer counts as a feature label (5 points less, spec §10 #2; the replay suite pins it).
   Any other mismatch is a finding: stop and report it on AGT-85.
2. **Checks, the specs of one recent branch.** Old check vs `/quality-code:check <specs>`. Verdicts
   must match, except the differences the specs record as deliberate: the mutation bar is fixed at
   100%, one exit-code scheme (0 green, 1 checks failed or tests red, 2 usage, 3 not verified), and
   on the frontend a red `@anchor` test is `tests red` (exit 1), not exit 0. Also deliberate:
   `.env.example` may be edited (the old backend guard refused it); the expected-values check reads
   every spec of the ticket together (the old backend graded each file alone), has no Italian/English
   rule and no warehouse-specific `hollow_target` check; with `--key`, another ticket's test in the
   same file does not count.
3. **Writing, one real ticket.** Backend: `/quality-code:write <KEY>`. Frontend:
   `/quality-code:write <KEY> --route <route>`. A developer reads the specs it wrote.

To do step 1 with the old harness still present, do it **before** step 3 removes it.

## 2. Add the config

```bash
mkdir -p .claude
cp <path-to>/agentic-testing/docs/rollout/warehouse-<backend|frontend>.quality-code.json .claude/quality-code.json
```

Then run `/quality-code:setup` in the repo: it starts from the file, re-confirms each card and writes
the `.gitignore` lines. Check `.gitignore` now has:

```
.claude/quality-code/tickets/*/raw.json
.claude/quality-code/*.jsonl
.claude/quality-code/run.active
mut-tmp-*
.claude/quality-code/audit/
```

(the first line follows `ticketsDir`; setup writes the exact one).

**Move the team guides** the config points at, before step 3 deletes the old skills (they are the
old harness's writing rules, read by `write` and `seed` on top of the plugin's own):

```bash
mkdir -p .claude/quality-code/guides
# backend
git mv .claude/skills/spec/layers.md .claude/quality-code/guides/layers.md
git mv .claude/skills/spec/seed.md .claude/quality-code/guides/seed.md
# frontend
git mv .claude/skills/spec-frontend/seed.md .claude/quality-code/guides/seed.md
cp <path-to>/agentic-testing/docs/rollout/guides/warehouse-frontend-playwright.md .claude/quality-code/guides/playwright.md
```

The frontend seed guide still names screens by their old folder names (`/products-stock`); the app's
routes are the ones in the config's `features` (`/productsStock`). The backend's `test/qa-plans/` stays
where it is: `qaPlans` points at it. The backend Bug template says the bar is 60%; the gate's bar is 70:
fix the template's line in the same merge request.

## 3. Remove the old harness

List first, then delete only what the list shows **and** what you recognise. These are the paths the
old harness used (from the old plugins and the parity capture):

| Path | Backend | Frontend | What it was |
|---|---|---|---|
| `.claude/harness/` | ✔ | ✔ | scorer, sanitizer, pipeline, checks, `kpi.mjs`, evals; **keep the scripts CI runs** (below) |
| `.claude/harness/qa-plans/` | | ✔ | QA's own case sheets; **keep a copy** if the team still reads them |
| `.claude/harness/warehouse-testcases.csv` | | ✔ | every XRay test case so far: **keep it**, the config's `xray.csv` points at it |
| `.claude/boundary-guard.mjs` | ✔ | ✔ | the old write guard (now `quality-code`'s hook) |
| `.claude/skills/spec/`, `.claude/skills/check/` | ✔ | | the old `/spec` and check skills |
| `.claude/skills/spec-frontend/` | | ✔ | the old frontend `/spec` skill |
| `.claude/commands/` (ticket-eval, playwright, seed, xray, unit, integration, range, …) | ✔ | ✔ | the old commands; delete only the harness ones |
| `.claude/jira-config.json` | ✔ | ✔ | old Jira settings (now in `.claude/quality-code.json`) |
| `.claude/audit/` | ✔ | ✔ | old ticket copies and logs (removed once in AGT-34, re-created by runs) |
| `.claude/seed-cache/` | ✔ | | old seed cache |
| `.claude/TICKET_TEMPLATE.md` | ✔ | ✔ | keep if `.gitlab/issue_templates/` does not have the same text |

**Keep what CI runs.** quality-code runs inside Claude Code, not in CI, so the old scripts a CI job
calls must stay at the same path, or that job breaks. They use only Node's own modules, so they run
without the rest of the harness. In warehouse these are `honesty-check.mjs` and `suite-honesty.mjs`
(both repos, `test-quality` job) and `anchor-report.mjs` (frontend, `e2e-anchors` job). To drop
one, a person removes its CI job first, in this same merge request.

```bash
# 1. see what exists, and what CI runs
git ls-files .claude | sort
git grep -n "\.claude/" -- .gitlab-ci.yml
# 2. remove, one path at a time, only what you recognise from the table;
#    in .claude/harness/, everything but the scripts CI runs and the XRay CSV
git ls-files .claude/harness | grep -vE '/(honesty-check|suite-honesty|anchor-report)\.mjs$|/warehouse-testcases\.csv$' | xargs git rm -q
git rm .claude/boundary-guard.mjs
# … and the rest of the table that exists in this repo
```

Also remove from `.claude/settings.json`:
- the `hooks` entry that runs `.claude/boundary-guard.mjs` (quality-code brings its own hook);
- `warehouse-frontend@…` / `warehouse-backend@…` in `enabledPlugins`, if present.

Add, so everyone who opens the repo is offered the plugin:

```json
{
  "extraKnownMarketplaces": {
    "teamsystem": { "source": { "source": "github", "repo": "vissz28/agentic-testing" } }
  },
  "enabledPlugins": { "quality-code@teamsystem": true }
}
```

And in `CLAUDE.md`, replace every line that points at the old harness (`.claude/harness/…`, `/spec`,
`/playwright`, `/unit`, …) with the new commands: `/quality-code:start`, `ticket-eval`, `check`,
`write`, `seed`, `kpi`.

## 4. CI ticket gate (if the repo has one)

In `.gitlab-ci.yml`, replace the job that ran `node .claude/harness/score-ticket.mjs …` with the
`quality-code` gate, `/quality-code:ticket-eval <KEY> --ci` (no questions; a refused ticket gets the
Jira comment and the job fails; see the README, "Gate tickets in CI"). `.gitlab-ci.yml` is outside what a test run may change: a person edits it, in
this same merge request.

## 5. Check the switch

```bash
git grep -n "\.claude/harness\|boundary-guard" -- . ':!*.md'   # only the CI lines of the kept scripts
```

A `.claude/boundary-guard.mjs` line left in `.gitlab-ci.yml` (the backend lists it in
`.spec-file-paths`) no longer matches anything: a person removes it.

In Claude Code, in the repo:
1. `/quality-code:start`: the repo card, the branch, the ticket.
2. `/quality-code:ticket-eval <a recent KEY>`: same score as in step 1.
3. `/quality-code:check` on the branch's specs: the card.
4. `/quality-code:kpi`: shows the runs you just did.

## 6. The merge request

Title: `[FS] Switch to quality-code (AGT-86)`. Description:

```
Switches this repo from the old harness to the quality-code plugin (0.8.0).

Added: .claude/quality-code.json (from agentic-testing docs/rollout/), .gitignore lines,
the marketplace and plugin in .claude/settings.json.
Removed: the old harness (list the paths from step 3).

Proofs (AGT-85):
- Gate: N tickets, same score and decision: <table or "all match">.
- Checks: <branch>, same verdicts: <table>, deliberate differences: <list or none>.
- Writing: <KEY>, specs read by <name>.

How to install: /plugin marketplace add vissz28/agentic-testing, then
/plugin install quality-code@teamsystem (0.8.0 or later).
```

## 7. After the merge

- Comment on AGT-86 with the merge request link; on AGT-85 with the proofs.
- Tell the team: install or update the plugin (step 0), run `/quality-code:start` on their branch.
- Pilot (AGT-87): one sprint; every surprise is an issue with the ticket key and the card.

## If something goes wrong

- **A gate score differs**: don't merge. Comment the ticket key and both outputs on AGT-85.
- **`config check` refuses the file**: the plugin is older than 0.8.0 (step 0).
- **A test run writes where it should not**: the boundary hook refuses it and logs it in
  `.claude/quality-code/boundary.jsonl`; `/quality-code:kpi` counts it.
- **Revert**: the merge request is one commit set; reverting it brings the old harness back.
