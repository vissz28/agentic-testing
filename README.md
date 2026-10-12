# agentic-testing

**From a Jira ticket to real, graded tests, inside Claude Code.**

A Claude Code plugin marketplace for the TeamSystem warehouse apps. You give it a FIC ticket; it checks
whether the ticket is written well enough to test, writes tests from the ticket's acceptance
criteria, runs them, and hands back a short result card in plain words.

| Plugin | Use it in | It writes |
|---|---|---|
| **`warehouse-frontend`** | `warehouse-frontend` | a Playwright spec that drives the real app, plus an XRay test case (CSV + styled Excel) |
| **`warehouse-backend`** | `warehouse-backend` | Vitest specs against a real Postgres (unit, integration, range) |
| **`agentic-testing`** | any repo with Playwright or Vitest | part 1 today: setup and the readiness gate, guided fill-in, Jira comment and push (no tests written yet) |

> **Status.** The two warehouse plugins are built for the warehouse repos. `agentic-testing` is the
> reusable plugin any team can configure; part 1 is ready, see
> [The reusable plugin](#the-reusable-plugin-agentic-testing) and the [Roadmap](#roadmap).

> **The rule everything is built on:** the model drafts and writes the tests, but it **never grades
> them**. Every score and every pass/fail comes from a deterministic script. A green result is not
> the model's opinion of its own work.

---

## Contents

1. [The reusable plugin: agentic-testing](#the-reusable-plugin-agentic-testing)
2. [How it works](#how-it-works)
3. [Requirements](#requirements)
4. [Install](#install)
5. [Quick start](#quick-start)
6. [The readiness gate](#the-readiness-gate)
7. [When a ticket is refused](#when-a-ticket-is-refused)
8. [The checks after writing](#the-checks-after-writing)
9. [Commands](#commands)
10. [Where the output goes](#where-the-output-goes)
11. [Safety](#safety)
12. [Maintaining the plugins](#maintaining-the-plugins)
13. [Troubleshooting](#troubleshooting)
14. [Known limits](#known-limits)
15. [Roadmap](#roadmap)
16. [History](#history)

---

## The reusable plugin: agentic-testing

The same readiness gate, for any Jira project and any repo with Playwright or Vitest. Nothing about
your team is built in: it lives in one config file that a setup command writes for you.

**Install**, inside Claude Code in your repo:

```
/plugin marketplace add vissz28/agentic-testing
/plugin install agentic-testing@agentic-testing
/agentic-testing:setup
```

Then check a ticket:

```
/agentic-testing:ticket-eval ABC-123
```

**What setup asks.** It detects the stack from `package.json` (Playwright or Vitest; if both, it
asks which), then asks one thing per card and you answer by number:

1. the Jira site (for example `https://example.atlassian.net`) and the project keys (`ABC`);
2. the Jira field that holds the acceptance criteria, if your project has one;
3. other projects to track (optional);
4. which labels are feature labels, picked from the labels on your recent tickets; for Playwright
   also the screen route of each one and the text used to find its Confluence QA plan;
5. for Vitest, the title prefixes your team uses (for example `[API]`), counted from recent ticket
   titles, or none;
6. the languages of your tickets (English, plus Italian if your tickets use it);
7. extra redaction patterns (optional);
8. whether to add the plugin's standard Bug and Story templates, if your repo has none.

It shows the whole config before writing it, writes only after you type `1`, adds the ticket-copy
folder to `.gitignore`, and proves the setup on one recent ticket.

**The config file** is `.claude/agentic-testing.json` in the project root. Commit it. Change it by
running `/agentic-testing:setup` again, not by hand. Every `ticket-eval` run checks it first and names
any field that is wrong. Ticket copies go to `.claude/agentic-testing/tickets/` (`ticketsDir`).

**The gate** is the same for every team: a ticket needs **70 points out of 100** to pass, and the
bar cannot be changed. Acceptance criteria count when they are Gherkin (Given / When / Then, any
length) or **at least 150 characters** of plain criteria under an Acceptance criteria heading or in
the criteria field. HTML comments are never read as criteria. A feature label or title prefix your
config does not have is never asked for.

**Redaction.** Before scoring, the ticket copy on disk is redacted: e-mails, UUIDs and customer ids
(`U` followed by 5 or more digits) by default. Extra patterns you add in setup replace that default
list, so setup always keeps the customer-id pattern in it unless you turn it off.

**GitLab.** The plugin setting `gitlab_mcp_url` defaults to TeamSystem's GitLab
(`https://biosphere.teamsystem.com/api/v4/mcp`). Teams on another GitLab enter their own URL when Claude Code asks for the plugin's settings
at enable time, or change it later from the `/plugin` menu.

---

## How it works

```
 FIC ticket (Jira)
      │
      ▼
 1. Read the ticket ──────────── backend: customer ids, emails and UUIDs are redacted first
      │
      ▼
 2. Readiness gate (score /100, pass at 70) ── deterministic, see below
      │
      ├── refused ──► 1  Post a comment on Jira saying what to add (preview first)
      │               2  Fill in the missing parts here (guided), optionally push them to Jira
      │               3  🔴 [RISK / NOT RECOMMENDED] continue anyway (developers only)
      ▼
 3. Read-back: "We will check: …"            you confirm with 1 / 2 / 3
      │
      ▼
 4. Draft the tests (+ edge cases the ticket did not state)
      │
      ▼
 5. "Write the checks?"                       you confirm with 1 / 2 / 3
      │
      ▼
 6. Deterministic checks: nothing deleted, every test asserts something, the asserts carry
    weight (mutation), the right expected values, types, the run itself
      │
      ▼
 7. Result card in everyday words + a developer run log (run.md)
```

You answer every card by typing a number. `stop` works on every card.

**What the plugin is and is not.** The plugins carry the *Claude side* of the solution: skills, slash
commands, the Jira / Figma / GitLab connectors and, for the frontend, the write-boundary hook. The
*harness scripts* (the scorer, the pipeline, the checks) stay in each repo under `.claude/harness/`,
versioned with the code they test and run with that repo's `node_modules`. So the repo you open must
be on a branch that has them.

---

## Requirements

| | Frontend | Backend |
|---|---|---|
| Claude Code | recent version with plugin support (`claude plugin --help`) | same |
| Repo branch with the harness | `agentic-testing-fe`, or a branch merged from it | `agentic-testing-be` (or `agt-34-remove-audit-logs` until merged) |
| Node | 18+ (the repo's own `npm ci`, with a Nexus token in `~/.npmrc`) | the repo's Node |
| Docker | not needed for the default (stubbed) suite | **required**: tests run against a Postgres container |
| Jira | the Atlassian connector (ships with the plugin) | same |
| Figma | optional: `FIGMA_API_KEY` in your environment | — |
| Access to this repo | git must be able to clone it (keychain login, `gh auth login`, or SSH) | same |

---

## Install

Inside Claude Code, in the warehouse repo you work on:

```
/plugin marketplace add vissz28/agentic-testing
/plugin install warehouse-frontend@agentic-testing
```

In `warehouse-backend`, install `warehouse-backend@agentic-testing` instead.

The same from a shell:

```bash
claude plugin marketplace add vissz28/agentic-testing
claude plugin install warehouse-frontend@agentic-testing --scope project
```

**Offer it to everyone who opens a repo:** add this to that repo's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "agentic-testing": { "source": { "source": "github", "repo": "vissz28/agentic-testing" } }
  },
  "enabledPlugins": { "warehouse-frontend@agentic-testing": true }
}
```

**Update** with `/plugin update warehouse-frontend@agentic-testing` (or the backend one).

---

## Quick start

```
/warehouse-frontend:spec-frontend FIC-14333
```

```
I read FIC-14333 — Products stock: multi-warehouse view

We will check:
  • The table shows one row per warehouse under each product

1. Yes, that's right
2. No — I'll type the right result
3. Stop
```

Type `1`. A second card asks before anything is written; type `1` again. The checks run (backend:
2–4 minutes), then you get the result card:

```
## FIC-14333 — ok

Ticket checks — 3 of 3 passed:
  ✓ one row per warehouse under each product
  …
What you do now:
  Looks good. You can try the same case in the app.
```

Backend equivalent: `/warehouse-backend:spec FIC-13860`.

---

## The readiness gate

Before a single test is written, the ticket gets a **score out of 100**. **70 or more passes**;
below 70 it is refused, interactive and CI alike. The score is pure structure, read from the raw
ticket text by a script (`score-ticket.mjs`), English and Italian keywords. The model never supplies
the number.

| What the ticket has | Frontend | Backend |
|---|---:|---:|
| Acceptance criteria | 30 | 30 |
| Criteria that are specific (no "works correctly") | 15 | 15 |
| Feature label (one of the 8, e.g. `Giacenza_Prodotti`) | 15 | 5 |
| Confluence QA plan linked | 15 | — |
| Steps to reproduce (bug) or a user story (story) | 10 | 15 |
| Expected and actual result | 10 | 15 |
| Context / Summary section | — | 10 |
| Title prefix `[FE]` / `[BE]` / `[FS]` | — | 5 |
| Environment (`Env: staging`) | 5 | 5 |

A ticket with acceptance criteria also gets the Expected points, so criteria are worth up to 60
(frontend 55) on a bare ticket.

### Acceptance criteria that count

Put them under an **Acceptance criteria** / **Criteri di accettazione** heading, or in the Jira
**Acceptance Criteria** field (no heading needed there). Both formats are accepted, and you can mix
them in one section:

**Gherkin**: any length, English or Italian.

```
## Acceptance criteria
Given a warehouse that still has stock
When I open its menu
Then the Delete button is disabled
```

**Plain language**: sentences or bullets, **at least 150 characters** of criteria text in total.

```
## Acceptance criteria
The Delete button is disabled for a warehouse that still has stock. Hovering it shows the
tooltip "Empty the warehouse first" and no delete request is sent.
```

| Rule | Effect |
|---|---|
| Sentences with no criteria heading (even with "should" / "must") | earn nothing |
| Plain-language criteria under 150 characters | earn nothing |
| A vague result: "works correctly", "as expected", "is fine", "funziona correttamente", "come previsto", "come atteso" | keeps the 30, loses the 15 |
| HTML comments in the GitLab templates (`<!-- … -->`) | ignored, they are hints |
| In a mixed section | each Gherkin `Then` (with its `And` lines) and each sentence is one criterion; all must be specific |

The backend and frontend scorers apply exactly these rules; a side-by-side check of both found
no difference.

---

## When a ticket is refused

```
This ticket needs a bit more information. We cannot start yet.

1. Post a comment on Jira with what to add.
2. I will add the missing information here.
3. 🔴 [RISK / NOT RECOMMENDED] Continue anyway (developers only). The user story is not complete.
```

### 1. Comment on Jira

The comment is built by the script from the gaps, each with an example to copy, and ends by naming
the GitLab template the ticket should have followed. You see it first, word for word; it is posted
only when you confirm. You can regenerate it or cancel.

### 2. Guided fill-in

You pick what to fill from a list that shows what each item is worth:

```
This ticket has 0 of the 70 points it needs.
What is missing:
  1. Acceptance criteria         +55
  2. Feature label               +15
  3. Steps to reproduce          +10
  4. Expected and actual result  +10
  5. Environment                 +5
Type the numbers you want to fill, for example: 1 3
```

- The pick is checked first: `With 1 and 2 the ticket reaches 70 points (the bar is 70): enough.`
  If not, it tells you how many points are still short.
- Then one question per item, with the smallest answer that counts as an example. Type it or `skip`.
- **The script decides whether an answer counts, not the model.** It is saved only if the rubric
  then credits it; otherwise it says why and you get a second try:

  ```
  Not accepted: Too short: 39 characters. Plain-language criteria need at least 150
  (two or three sentences on what should happen), or write them as Given / When / Then.
  ```

  Invented labels, a missing "actual" result and vague results are refused the same way.
- Answers go into the local copy of the ticket only. **Nothing reaches Jira** unless you choose so:

### Pushing the fill-in to Jira

When the filled-in ticket passes, you can add what you typed to the real Jira ticket. You see a
preview of exactly what will be added; only after you confirm is it appended:

```
This will be added to the end of the description:

  _Added during the /spec readiness check._

  ## Acceptance criteria
  - The generated report file is in Italian …

Label added: Importa_Giacenze
Title gets the prefix [BE]
Nothing already on the ticket is changed.
```

Only your new text is sent, never the local (backend: redacted) copy of the ticket, so a redaction
can never overwrite real data. The skill re-reads the ticket from Jira first and only appends.

### 3. Continue anyway

For developers. The checks run, but the result card and the run log open with
`[RISK / NOT RECOMMENDED] Ticket incomplete (25/70)`, in red on a terminal: a test written from an
incomplete story may not check what the story means.

---

## The checks after writing

All plain scripts in the repo's `.claude/harness/`, no model inside, each with its own `--self-test`.

| Check | What it catches | FE | BE |
|---|---|:-:|:-:|
| `boundary-guard` | a write to `src/`, `prisma/`, `dapr/`, `.gitlab-ci.yml` or `.env` | ✓ (every write, via the plugin hook) | ✓ (the run's git diff) |
| `honesty-check` | a check or a whole test quietly deleted or skipped (a `.skip` must name a ticket) | ✓ | ✓ |
| `suite-honesty` | a test with no assertion, or a run where everything was postponed | ✓ | ✓ |
| `expected-check` | the test does not assert the values the ticket's criteria name | | ✓ |
| type-check | the spec does not compile | ✓ | ✓ |
| the run | Playwright (stubbed backend by default) / Vitest on Testcontainers Postgres | ✓ | ✓ |
| `mutate-generated` | an assertion that cannot fail: it is broken on purpose and must turn the test red | ✓ | ✓ |
| Stryker | on a backend bug: the fix really is what the test pins | | ✓ |

**A red result is not always bad.** A test that fails because the feature is not built yet is doing
its job. An "Extra (not in the ticket)" line is an edge case the tool added (empty lists, long
names, numbers, translations); a red one is a case the team missed, not a broken run.

---

## Commands

| | Frontend (`warehouse-frontend`) | Backend (`warehouse-backend`) |
|---|---|---|
| Full run | `/warehouse-frontend:spec-frontend FIC-…` (or `:spec`) | `/warehouse-backend:spec FIC-…` |
| Readiness check only | `/warehouse-frontend:ticket-eval FIC-…` | — |
| One output only | `:playwright FIC-…` (spec), `:xray FIC-…` (XRay case) | `:unit`, `:integration`, `:range` |
| Test data only | `:seed FIC-…` (API stubs) | `:seed FIC-…` (~25 rows per table into your local DB) |
| Ticket overview | — | `:ticket FIC-…` |
| Flaky or real? | — | `:check` (re-runs a failing test) |
| Jira settings | — | `:jira-config` |

Useful flags on the full run: `--dry-run` (stop before writing), `--ci` (no pauses; refused tickets
get the Jira comment), `--no-edges`, `--no-mutate`; backend `--fast`, `--mocked`.

---

## Where the output goes

| | Frontend | Backend |
|---|---|---|
| Tests | `e2e/tests/<route>/<KEY>.spec.ts` | `test/{unit,integration,range,api}/…` |
| Test cases | `e2e/tickets/<KEY>/case.csv` (+ `case.xlsx`, not committed) and `.claude/harness/warehouse-testcases.csv` | — |
| Developer run log | `e2e/tickets/<KEY>/run.md` | `.claude/audit/tickets/<KEY>/run.md` |
| Ticket copy | `e2e/tickets/<KEY>/harvest.json` (not committed, raw text) | `.claude/audit/tickets/<KEY>/ticket.json` (redacted) |

---

## Safety

- **No application code is touched.** The frontend hook refuses writes to `src/`, the CI pipeline and
  `.env` on every write; the backend pipeline fails the run if its diff touches them.
- **Nothing is posted to Jira without a preview and a yes.** That covers the refuse comment and the
  fill-in push. `--ci` never pushes a fill-in. `--dry-run` never writes.
- **Customer data stays out of the tests** (backend): ticket text is redacted before scoring.
- **The model cannot inflate a score.** It hands over raw text; the scripts judge it. Invented
  scenarios do not move the gate, and a hollow test fails `suite-honesty` or the mutation check.

---

## Maintaining the plugins

The skills and commands are copied from the two repos, which stay the source of truth.

```bash
scripts/sync-from-repos.sh                                        # from origin/agentic-testing-fe and -be
BE_REF=origin/agt-34-remove-audit-logs scripts/sync-from-repos.sh # any other ref
claude plugin validate .
claude plugin validate plugins/warehouse-frontend
claude plugin validate plugins/warehouse-backend
```

The sync rewrites skill and command paths to `${CLAUDE_PLUGIN_ROOT}` and drops the backend `spec`
command (inside a plugin it collides with the `spec` skill of the same name). Then bump `version`
in the plugin's `.claude-plugin/plugin.json`, commit and push. Users get it with `/plugin update`.

```
agentic-testing/
├─ .claude-plugin/marketplace.json
├─ plugins/
│  ├─ warehouse-frontend/   .claude-plugin/plugin.json · skills/ · commands/ · hooks/hooks.json · .mcp.json
│  └─ warehouse-backend/    .claude-plugin/plugin.json · skills/ · commands/ · .mcp.json
├─ scripts/sync-from-repos.sh
└─ docs/USER_GUIDE.md       step-by-step guide for QA
```

---

## Troubleshooting

| You see | Do this |
|---|---|
| "Open the warehouse-… folder to run the checks" | The repo branch has no `.claude/harness/`. Switch to `agentic-testing-fe` / `-be` or merge it. |
| "This is the backend repo…" (or frontend) | Use the other plugin for this repo. |
| "Turn on the Jira connector…" | Sign in to Atlassian when prompted, or paste the ticket text. |
| Backend run says Docker was down | Start Docker; the live tests did not run, so the result is not green. |
| No design comparison | Set `FIGMA_API_KEY`; behavioural tests still ran. |
| `marketplace add` fails on a private repo | Make sure `git clone https://github.com/vissz28/agentic-testing` works on its own (keychain, `gh auth login` or SSH). |
| Two Jira connectors listed | The repo's own `.mcp.json` also declares one. Harmless. |

---

## Known limits

- **Warehouse only, for now.** The Jira project (`FIC`), feature labels, screen routes and stack
  details are built in, and the harness scripts live in each warehouse repo rather than in the
  plugin. Making it reusable is the [Roadmap](#roadmap) below (AGT-28).
- **The backend has no write-time hook.** Its guard checks the run's git diff afterwards.
- **Run logging is unchanged and local.** The audit `.jsonl` logs were cleared (AGT-34); the scripts
  still write them, and changing that flow is a separate task.

---

## Roadmap

The next version is one plugin, **`agentic-testing`**, that any TeamSystem team can use with a
React + Playwright frontend or a Node/TypeScript + Vitest backend, with no warehouse value left in
the code. It is built in five parts, each with its own reviewed spec and plan:

| # | Part | What it brings | Status |
|---|---|---|---|
| 1 | Core + config | `/agentic-testing:setup` writes the team config inside Claude Code; the readiness gate, guided fill-in and Jira push work for any Jira project | built (v0.2.0) |
| 2 | Shared checks | honesty, assertion and mutation checks, boundary guard and flaky check, configured instead of hard-coded | planned |
| 3 | Playwright adapter | frontend test writing and the pipeline for any app | planned |
| 4 | Vitest adapter | backend test writing, layers and Stryker for any service | planned |
| 5 | Sample project + rollout | a reference project, an onboarding page, warehouse switched to the new plugin | planned |

What stays the same for every team: the **70-point bar**, the rubric per stack, the
**150-character** rule for plain-language criteria, the vague-word rules, and the rule that the
model never grades its own tests.

How configuration will work:

- **Team settings** (Jira project, acceptance-criteria field, feature labels and routes, languages,
  redaction) in one committed file, `.claude/agentic-testing.json`, written and checked by the setup
  command, never edited by hand.
- **Personal settings and secrets** (Figma key, GitLab URL) through Claude Code's own plugin settings
  (asked when the plugin is enabled, editable from the `/plugin` menu); secrets are stored in the system keychain, never in a repo.

Details: [part 1 spec](docs/specs/2026-10-12-part-1-core-config-design.md) ·
[part 1 plan](docs/plans/2026-10-12-part-1-core-config.md).

The `warehouse-frontend` and `warehouse-backend` plugins keep working unchanged until part 5.

---

## History

| Ticket | What |
|---|---|
| AGT-29 / AGT-30 | Natural-language acceptance criteria accepted next to Gherkin; 150-character minimum |
| AGT-31 / AGT-32 | Guided fill-in on refuse, push to Jira, `[RISK / NOT RECOMMENDED]` flag |
| AGT-33 | Frontend bar raised from 60 to 70 to match the backend |
| AGT-34 | Accumulated audit logs removed |
| AGT-28 | Reusable solution for any team: in progress, see [Roadmap](#roadmap) |

Step-by-step guide for QA: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).
