# quality-code

**Test-ready tickets and tests you can trust, inside Claude Code. One plugin for every team.**

quality-code connects your Jira tickets to your test suite. It checks whether a ticket is clear
enough to test, helps its author fill the gaps, then writes tests from the ticket's acceptance
criteria and grades them (Vitest today; Playwright as the [roadmap](#roadmap) lands). It works with any Jira project and any repo
that uses **Playwright** (frontend) or **Vitest** (backend). What is specific to your team (Jira
project, criteria field, feature labels, routes, languages, redaction) lives in one config file that
a guided setup command writes for you. Your application code is never changed.

> **The rule everything is built on:** the model reads, drafts and writes, but it **never grades**.
> Every score and every pass/fail comes from a deterministic script. A green result is not the
> model's opinion of its own work.

## At a glance

| | |
|---|---|
| **Works with** | any Jira Cloud project; repos with `@playwright/test` or `vitest` on Node 18+ |
| **Runs in** | Claude Code (terminal, desktop app, IDE extensions), and in CI with `--ci` |
| **Onboarding** | one guided command per repo; nobody edits config by hand |
| **Same for every team** | the 70-point readiness bar, the rubric per stack, the grading scripts |
| **Ticket languages** | English and Italian |
| **Data handling** | tickets are redacted locally before scoring; nothing is posted to Jira without a preview and a yes |

---

## Quick start

**1. Install (once per person).** In Claude Code, inside your repo:

```
/plugin marketplace add vissz28/agentic-testing
/plugin install quality-code@quality-code
```

**2. Set up the repo (once per repo, by one person).** Answer the numbered cards, then commit the
config it writes:

```
/quality-code:setup
```

**3. Every day, start from your feature branch.**

```
/quality-code:start
```

It checks your connectors, shows the branch and what it changed, and takes the ticket key from the
branch name (`ABC-123-add-export`). Then you pick: evaluate that ticket, check the tests on the branch
(Vitest), or write and check tests for it (Vitest). To check any ticket directly:
`/quality-code:ticket-eval ABC-123`. To write tests for one: `/quality-code:write ABC-123`.

The result is a score out of 100. At 70 or more the ticket is ready to test. Below 70 you can post a
comment on Jira listing what is missing, or fill in the gaps on the spot. New to it? Start with
[Getting started](docs/GETTING_STARTED.md), a step-by-step walk-through for QA and developers. Bringing
a whole team on board: [Onboarding](docs/ONBOARDING.md), one page with a team lead's checklist.

---

## Is my project supported?

| You need | You do not need |
|---|---|
| A Jira Cloud project you can read (and comment on, to post refuse comments) | A specific folder layout, branch model or CI system |
| `@playwright/test` or `vitest` in `package.json` | A dedicated Jira field: criteria can live in the description |
| Node 18 or newer | Feature labels or title prefixes: setup offers them, both are optional |
| Claude Code with plugin support | Changes to your application code |

**Not supported yet:** other test runners (Jest, Cypress, pytest, JUnit…) and ticket languages
other than English and Italian. See [Known limits](#known-limits).

---

## What you can do today

| Capability | How | Status |
|---|---|---|
| Guided setup for your repo and Jira project | `/quality-code:setup` | ✅ available |
| Start from your feature branch: connectors, branch changes, ticket from the branch name | `/quality-code:start` | ✅ available |
| Readiness gate: score a ticket out of 100 | `/quality-code:ticket-eval <KEY>` | ✅ available |
| Post what is missing as a Jira comment | `ticket-eval`, refuse option 1 | ✅ available |
| Guided fill-in, then push it to Jira | `ticket-eval`, refuse option 2 | ✅ available |
| Gate tickets in CI | `ticket-eval <KEY> --ci` | ✅ available |
| Deterministic checks on generated tests (honesty, assertions, expected values, mutation, boundaries, flakiness) | building blocks of the pipeline; run by hand with `core/checks/cli.mjs` | ✅ available (building blocks) |
| Check the tests on your branch: run them and grade them | `/quality-code:check` (or `start`, option 2) | ✅ available (Vitest, Playwright) |
| Write and grade backend tests, any Node/TS + Vitest service | `/quality-code:write <KEY>` (or `start`, option 3) | ✅ available (Vitest) |
| Write frontend tests from a ticket, any Playwright app | `/quality-code:write <KEY>` (or `start`, option 3) | ✅ available (Playwright) |
| Write only the test data a ticket needs: seed builder calls (Vitest) or route stubs (Playwright) | `/quality-code:seed <KEY> [--path <spec>]` | ✅ available |
| How the plugin is used here: tickets gated, fill-ins, Jira comments, forced runs, verdicts, boundary blocks | `/quality-code:kpi` | ✅ available |
| AI usage and estimated cost of the plugin's runs in this project | `/quality-code:consumption` | ✅ available |

## Who does what

| Role | Uses it to |
|---|---|
| **QA** | check a ticket before testing starts, fill the gaps with the author, get tests written and graded (Vitest) |
| **Developer** | check a ticket before picking it up; get a test pinned to a bug, red until the fix is merged (Vitest) |
| **Product owner / ticket author** | read the Jira comment that says exactly what to add, with examples |
| **Team lead** | run setup once and own `.claude/quality-code.json` in the repo |
| **CI** | refuse untestable tickets automatically with `--ci` |

---

## Contents

1. [Install](#install)
2. [Set up your project](#set-up-your-project)
3. [Check a ticket](#check-a-ticket)
   - [Check your tests](#check-your-tests)
   - [Write tests from a ticket](#write-tests-from-a-ticket)
   - [What do the runs cost?](#what-do-the-runs-cost)
4. [The readiness gate](#the-readiness-gate)
5. [When a ticket is refused](#when-a-ticket-is-refused)
6. [The config file](#the-config-file)
7. [Connectors and personal settings](#connectors-and-personal-settings)
8. [Safety and privacy](#safety-and-privacy)
9. [Troubleshooting](#troubleshooting)
10. [Known limits](#known-limits)
11. [Roadmap](#roadmap)
12. [Getting help](#getting-help)
13. [Developing the plugin](#developing-the-plugin)

---

## Install

**Requirements:** a recent Claude Code with plugin support (`claude plugin --help`), Node 18+, a repo
whose `package.json` has `@playwright/test` or `vitest`, and access to your Jira site. The marketplace
repo is private: `git clone https://github.com/vissz28/agentic-testing` must work on your machine
(keychain login, `gh auth login` or SSH).

Inside Claude Code, in your repo:

```
/plugin marketplace add vissz28/agentic-testing
/plugin install quality-code@quality-code
```

The same from a shell:

```bash
claude plugin marketplace add vissz28/agentic-testing
```

```bash
claude plugin install quality-code@quality-code --scope project
```

**Offer it to everyone who opens the repo:** add this to the repo's `.claude/settings.json` and
commit it:

```json
{
  "extraKnownMarketplaces": {
    "quality-code": { "source": { "source": "github", "repo": "vissz28/agentic-testing" } }
  },
  "enabledPlugins": { "quality-code@quality-code": true }
}
```

**Update** with `/plugin update quality-code@quality-code`. What changed in each version, and any
step an update needs, is in the [CHANGELOG](CHANGELOG.md).

---

## Set up your project

```
/quality-code:setup
```

Setup asks only for the connections and where the project lives, one card at a time; you answer by
typing a number:

1. **Connectors**: Jira (required), GitLab (optional) and, for Playwright projects, Figma
   (optional), each by browser sign-in or token, with the fix for anything missing. Keys go in the plugin settings, never in the chat.
2. **This project**: the folder (and subfolder, in a larger repo), the stack found in
   `package.json` (Playwright or Vitest; if both, you pick one) and the GitLab project of the
   `origin` remote.
3. **Jira**: the site and the project key(s) (`ABC`), picked from the projects you can see.

It then shows the config and asks `1. Write it / 2. Change something / 3. Cancel`. Nothing is
written before you type `1`. Setup writes only `.claude/quality-code.json` and its `.gitignore`
lines. It does not check any ticket: that is what `/quality-code:start` and
`/quality-code:ticket-eval` do.

Everything else has a default:

| Not asked | Default | How it is set |
|---|---|---|
| Acceptance-criteria field | found by its name ("Acceptance Criteria" / "Criteri di accettazione") the first time a ticket of the project is checked | remembered on your machine; asked only if the project has several such fields |
| Languages | English and Italian | `/quality-code:setup advanced` |
| Feature labels, routes, QA plans, Confluence spaces, title prefixes | none: those signals are not asked for, so the bar stays reachable | `/quality-code:setup advanced` |
| Templates, extra redaction, projects to track | built-in templates offered, customer ids always hidden, none | `/quality-code:setup advanced` |
| Paths a test run must never change; for Vitest, which config runs which tests and the test folders | `src/`, `.env`, `.env.*`, the CI file; Vitest's default config; one `unit` layer in `test/` | `/quality-code:setup advanced` |

**`/quality-code:setup advanced`** asks those questions too: labels picked from recent tickets (in a
project shared by many teams, narrowed to a word in the title or a component first), routes and QA
plans for Playwright, title prefixes for Vitest, languages, redaction, templates, the paths a test run
must never change and, for Vitest, which config runs which tests and the test folders
`/quality-code:write` writes in.

Run `/quality-code:setup` again any time to change a value; it starts from the current config and
keeps what it does not ask.

---

## Check a ticket

```
/quality-code:ticket-eval ABC-123
```

```
 Jira ticket ABC-123
      │
      ▼
 1. Check the config ──────────── a wrong field is named, and nothing runs
      │
      ▼
 2. Read the ticket (Jira connector, as markdown) and save a local copy
      │
      ▼
 3. Redact the copy (customer ids, e-mails, UUIDs, your own patterns)
      │
      ▼
 4. Readiness gate: score /100, pass at 70 ── a script, not the model
      │
      ├── pass ──► the ticket is ready
      │
      └── refused ──► 1  Post a comment on Jira saying what to add (preview first)
                      2  Fill in the missing parts here (guided), optionally push them to Jira
                      3  🔴 [RISK / NOT RECOMMENDED] continue anyway (developers only)
```

You answer every card by typing a number. Flags: `--ci` (no questions; a refused ticket gets the
Jira comment, exit code 1), `--json` (print only the machine result), `--refuse-comment` (print the
comment that would be posted, without posting it).

A ticket from a project that is not in your config gets one card first: `1. Continue anyway / 2. Stop`.

---

## Check your tests

For Vitest projects. `/quality-code:check` runs spec files and grades them; a script builds the
verdict, the model only relays it.

```
/quality-code:check test/orders.spec.ts --key ABC-123
```

With no spec paths it takes the test files your branch changed against its base (deleted files are
left out) and asks `1. Yes / 2. Pick some / 3. Stop`. `/quality-code:start` offers the same as
option 2 when the branch has such files. `--flaky 3` also runs the tests three times and fails on a
test that changes its result.

The steps, always in this order:

1. **boundary**: no change outside the allowed paths. It applies only while a test-writing run is
   active (see [the run marker](#write-tests-from-a-ticket)); otherwise it is "not applicable" and
   left off the card.
2. **honesty**: no assertion or test removed, no skip without a ticket. From the branch flow it reads
   everything committed on the branch; with spec paths you give, it reads your uncommitted changes.
3. **assertions**: every test that runs asserts something.
4. **types**: `tsc --noEmit` with the project's `tsconfig`.
5. **tests**: Vitest, with the project's own install and, per spec, the config you map in `vitest.configs`.
6. **expected**: only with `--ticket` (used by `/quality-code:write`): every concrete number and quoted
   text in the ticket's Then / Expected lines is asserted in the ticket's block.
7. **mutation**: each assertion is broken on purpose and the test must fail.
8. **flaky**: only with `--flaky`.
9. **stryker**: only with `--target` (used by `/quality-code:write`), when the project has
   `node_modules/.bin/stryker`, and when the tests are not red (Stryker needs a green first run;
   red tests already show they can fail). Stryker changes the target code and the tests must catch at least
   `vitest.stryker.threshold` percent of the changes (default 60). Otherwise it is "not applicable"
   and left off the card.

```
quality-code check · 2 spec files · ticket ABC-123

Verdict: ❌ checks failed

Tests     8 passed · 0 failed · 1 to do
Checks
  ✅ honesty        no assertion or test removed
  ❌ assertions     1 test(s) run but assert nothing: orders.spec.ts › 'cancels'
  ✅ types          compiles
  ✅ tests          8 passed
  ✅ mutation       6/6 mutants killed

What to do: add a real expect(...) to 'cancels', or mark it todo if the behaviour isn't known yet.
```

| Verdict | Meaning |
|---|---|
| ✅ green | every step ran and passed |
| ❌ checks failed | a check found a problem (boundary, honesty, assertions, types, expected, mutation, flaky, stryker) |
| ⚠️ not verified | something could not run (Vitest or `tsc` missing, a timeout, a spec whose assertions mutation cannot check such as snapshot-only ones, a spec with no block for the ticket key, Stryker failing to run). Never shown as green |
| 🔴 tests red | the checks passed but a test fails. Expected for a bug whose fix is not merged yet |

Exit codes of `core/pipeline/cli.mjs`: `0` green, `1` checks failed or tests red, `2` usage or config
error (or a crash), `3` not verified. The run writes nothing into your repo except Vitest's own cache
in `node_modules/.vite` and the mutation check's temporary spec copies, deleted when it ends.

---

## Write tests from a ticket

For Vitest and Playwright projects. `/quality-code:write` writes tests from a ticket that passes the readiness gate,
then the pipeline grades them. Claude writes; the scripts gate and grade.

```
/quality-code:write ABC-123
```

`/quality-code:start` offers the same as `Write and check tests` (option 3, or option 2 when the
branch has no test files to check).

1. **Gate.** The ticket is read and scored as in `ticket-eval`. A refused ticket gets the refuse card
   and its flow; if the guided fill-in makes it pass, writing goes on. Option 3, "Continue anyway",
   also goes on, and every result is marked 🔴 [RISK / NOT RECOMMENDED]. Anything else stops.
2. **Target.** Found from your branch's diff and the ticket: the changed source file that holds what
   the scenarios describe. When one file is clearly it, the command says `Target: <path>` and goes
   on; it asks `Which code does this ticket change?` only when no changed file matches or two match
   equally well. The choice is remembered for the ticket, so the next run does not ask again.
   `--target src/pricing.ts` names it yourself.
3. **Plan.** One line per scenario of the ticket, with the test folder (layer) it goes in, shown as
   information; writing goes straight on. `--layer unit` keeps one layer only. `--ask` stops at the
   target and the plan for you to choose, as a card each.
4. **Write.** One spec per layer, named `<target>.<key>.spec.ts` (for example
   `pricing.abc-123.spec.ts`), all tests in one `describe('ABC-123 <summary>', …)` block, the real
   expected values from the ticket inside `expect(...)`. A behaviour the ticket does not pin down
   becomes `it.todo`. Only spec files in the layer folders are written, never application code.
5. **Check.** The pipeline runs with the ticket and the target, so the `expected` and `stryker`
   steps run too. A fixable failure (expected, assertions, mutation, stryker, or types in a spec) gets
   at most two rewrites of the tests, never of the code; then the card is shown as it is.

For a Bug whose card is `🔴 tests red` with a test that asserts the ticket's expected value, one line
is added: `This is the bug the ticket describes; it should go green when the fix is merged.`

**The run marker.** While it writes, the command keeps a marker in
`.claude/quality-code/run.active` (git-ignored). Only then does the boundary hook block writes to the
forbidden paths, and only then does the boundary check run. The marker is removed at the end, on every
way out. One older than 12 hours is ignored and replaced. By hand:
`node <plugin>/core/checks/cli.mjs run start --key ABC-123`, `run stop`, `run status`.

---

### Playwright projects

On a Playwright project, `write` takes the screen from `--route`, else from the configured feature
whose label is on the ticket (`features[].route`), else asks. It plans the ticket's scenarios plus up
to 3 extra probes (`Extra: …`, tagged `@finding`; `--no-extras` leaves them out), writes
`<e2e folder>/<screen>.<key>.spec.ts` with `@anchor` and the ticket key on each test from the ticket,
and runs the checks. The app must be running, or started by your config's `webServer`. The e2e
folder is `playwright.folder`, else your Playwright config's `testDir` when it is a plain string,
else `e2e/` (`node <plugin>/core/cli.mjs config e2e-folder` shows which and why).

### Seed test data

`/quality-code:seed ABC-123` reads the ticket (no readiness gate: nothing is graded) and writes only
the data setup. On Vitest: calls to your own seed builders (`seed.builders`), in foreign-key order,
with the ticket's exact values. On Playwright: `page.route` stubs whose response shapes are copied
from a stub you already have (`seed.stubsFrom`). With `seed.dataset`, a documented known dataset's
ids and values come first. It prints the block, or puts it into an existing spec's setup with
`--path`. It never invents a builder, a shape or a value, and never writes to a database.

### What the plugin did here: `/quality-code:kpi`

```
/quality-code:kpi [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD]
```

Tickets gated (pass and refuse, score bands, the most missing criteria), refused then filled in then
passed, Jira comments posted, forced runs (option 3), pipeline runs by verdict and deciding step,
and boundary blocks. It reads the local audit log in `.claude/quality-code/audit/` (git-ignored; keys
and numbers only, never ticket text; `QC_NO_AUDIT=1` turns it off).

### What do the runs cost?

```
/quality-code:consumption [--since 7d|30d|YYYY-MM-DD] [--until YYYY-MM-DD] [--by command|ticket|day|model] [--prices file.json]
```

Reads Claude Code's local transcripts (`~/.claude/projects/…`) and shows the quality-code runs of
this project: runs, tokens in, out and cache, and an estimated cost per command, ticket, day or
model (default: the last 30 days, by command). An agent counts for the run that started it; usage
outside quality-code is one separate line. Nothing is sent anywhere, and no prompt or answer text is
shown. The cost is an estimate at API list prices (dated on the card); subscription plans are not
billed this way. `--prices` takes your own rates.

---

## The readiness gate

Before any test is written, the ticket gets a **score out of 100**. **70 or more passes**; below 70
it is refused, interactive and CI alike. The bar is the same for every team and cannot be changed.
The score is pure structure, read from the ticket text by a script, with English and Italian
keywords. The model never supplies the number.

| What the ticket has | Playwright | Vitest |
|---|---:|---:|
| Acceptance criteria | 30 | 30 |
| Criteria that are specific (no "works correctly") | 15 | 15 |
| A feature label from your config | 15 | 5 |
| A Confluence QA plan found (linked, or by the feature's search text: a page whose title contains those words, in `confluenceSpaces` when set) | 15 | — |
| Steps to reproduce (bug) or a user story (story) | 10 | 15 |
| Expected and actual result | 10 | 15 |
| A context / summary section | — | 10 |
| A title prefix from your config (`[API] …`) | — | 5 |
| Environment (`Env: staging`) | 5 | 5 |

A ticket with acceptance criteria also gets the Expected points. A signal your config cannot meet
(no feature labels, or no title prefixes) is never asked for and scores 0, so the best possible score
is then 85 (Playwright) or 90 to 95 (Vitest), still above the bar.

### Acceptance criteria that count

Put them under an **Acceptance criteria** / **Criteri di accettazione** heading, or in the Jira
acceptance-criteria field (no heading needed there). Both formats count the same, and you can mix
them in one section.

**Gherkin**, any length:

```
## Acceptance criteria
Given an order that has already shipped
When I open its menu
Then the Cancel button is disabled
```

**Plain language**, sentences or bullets, **at least 150 characters** of criteria text in total:

```
## Acceptance criteria
The Cancel button is disabled for an order that has already shipped. Hovering it shows the
tooltip "Shipped orders cannot be cancelled" and no cancel request is sent.
```

| Rule | Effect |
|---|---|
| Sentences with no criteria heading (even with "should" / "must") | earn nothing |
| Plain-language criteria under 150 characters | earn nothing |
| A vague result: "works correctly", "as expected", "is fine", "funziona correttamente", "come previsto", "come atteso" | keeps the 30, loses the 15 |
| Anything inside HTML comments (`<!-- … -->`), Gherkin included | ignored: template hints never count |
| A mixed section | each Gherkin `Then` (with its `And` lines) and each sentence is one criterion; all must be specific |
| A plain sentence that starts with "When" / "Given" / "Quando" and states a result after a comma ("When X, Y …"; a comma in a number like "2,5" does not count) | plain language: needs the 150 characters, then counts |
| Bare steps without a `Then` ("When the user opens the page") | setup: earn nothing |

The plugin's standard Story template is refused when left unfilled, so a ticket cannot pass on the
template's own text.

---

## When a ticket is refused

```
This ticket needs a bit more information. We cannot start yet.

1. Post a comment on Jira with what to add.
2. I will add the missing information here.
3. 🔴 [RISK / NOT RECOMMENDED] Continue anyway (developers only). The user story is not complete.
```

### 1. Comment on Jira

The script builds the comment from the gaps, each with an example to copy, and ends by naming the
issue template the ticket should follow. You see it word for word first; it is posted only when you
confirm. You can regenerate it (twice) or cancel. Running it again updates the earlier comment
instead of adding a new one.

### 2. Guided fill-in

You pick what to fill from a list that shows what each item is worth:

```
This ticket has 25 of the 70 points it needs.
What is missing:
  1. Acceptance criteria         +55
  2. Steps to reproduce          +10
  3. Environment                 +5
Type the numbers you want to fill, for example: 1 3
```

- The pick is checked first: it tells you whether those items reach 70, or how many points are still
  short.
- Then one question per item, with the smallest answer that counts as an example. Type it, or `skip`.
- **The script decides whether an answer counts, not the model.** It is saved only if the rubric
  then credits it; otherwise you see why and get a second try:

  ```
  Not accepted: Too short: 39 characters. Plain-language criteria need at least 150
  (two or three sentences on what should happen), or write them as Given / When / Then.
  ```

  Labels that are not in your config, a missing "actual" result and vague results are refused the
  same way.
- Answers go into the local copy only. **Nothing reaches Jira** unless you choose it.

**Pushing the fill-in to Jira.** When the filled-in ticket passes, you can add what you typed to the
real ticket. You see exactly what will be added; only after you confirm is it appended:

```
This will be added to the end of the description:

  _Added during the quality-code readiness check._

  ## Acceptance criteria
  - The export file uses the language of the user's account …

Label added: Orders
Nothing already on the ticket is changed.
```

Only your new text is sent, never the local (redacted) copy, so a redaction can never overwrite
real data. The ticket is re-read from Jira first and only appended to. `--ci` never pushes a fill-in.

### 3. Continue anyway

For developers. Nothing is posted. Inside `/quality-code:write`, the tests are still written and
checked, but the card opens with `🔴 [RISK / NOT RECOMMENDED] Ticket incomplete (<score>/70)` and the
override is recorded in the audit log (`/quality-code:kpi` counts these forced runs). The verdict is
not changed by the mark. If the ticket has nothing to check at all, it asks you to add what should
happen first.

---

## The config file

`.claude/quality-code.json` in the project root. Commit it, and change it by running
`/quality-code:setup` again rather than by hand. Every `ticket-eval` run checks it first and names
any field that is wrong. A JSON schema ships with the plugin (`schema/quality-code.schema.json`).

What `/quality-code:setup` writes:

```json
{
  "version": 1,
  "adapter": "vitest",
  "jira": { "site": "https://example.atlassian.net", "projects": ["ABC"] }
}
```

After `/quality-code:setup advanced` it can also hold, for example:

```json
{
  "jira": { "site": "https://example.atlassian.net", "projects": ["ABC"], "trackingProjects": ["OPS"] },
  "languages": ["en"],
  "features": [{ "label": "Orders" }, { "label": "Invoices" }],
  "titlePrefixes": ["API"]
}
```

| Field | Meaning | Default |
|---|---|---|
| `version` | always `1` | required |
| `adapter` | `playwright` or `vitest` | required |
| `jira.site` | your Jira site, `https://…`, no path | required |
| `jira.projects` | project keys whose tickets you check (`ABC`) | required |
| `jira.acceptanceCriteriaField` | id of the criteria field, or `null` for none. Leave it out to find it by name per project | found at ticket time |
| `jira.trackingProjects` | other projects whose tickets may be linked | `[]` |
| `languages` | `en`, `it`, or both | both |
| `features[]` | `label`; Playwright also `route` (`/orders`) and `qaPlanSearch` (Confluence search text) | `[]` |
| `titlePrefixes` | title prefixes without brackets, matched literally; `[]` for none | `[]` |
| `confluenceSpaces` | Playwright: Confluence space keys the QA-plan search is limited to (`["ABC"]`) | all spaces |
| `boundaries` | paths a test run may never write: `forbidden` (`{ path, why? }`) and `allow` exceptions | `src/`, `.env`, `.env.*`, the CI file |
| `playwright` | Playwright only: `configs` (`[{ "match": "e2e/admin/**", "config": "playwright.admin.config.ts" }]`, first match wins), `projects` (`["chromium"]`, 1 to 10 names), `tsconfig` (path), `timeoutSeconds` (10 to 3600), `folder` (where `write` puts new specs, ending in `/`, not in a forbidden boundary), `guide` (a `.md` with your e2e conventions) | default Playwright config, every project, `tsconfig.json`, 600; folder: your config's `testDir` when it is a plain string, else `e2e/`; no guide |
| `seed` | optional: `builders` (Vitest: the files with your seed builders), `dataset` (a `.md` documenting a known test dataset), `stubsFrom` (Playwright: the folder whose specs hold your route stubs) | none |
| `vitest` | Vitest only: `configs` (`[{ "match": "test/integration/**", "config": "vitest.config.db.ts" }]`, first match wins), `tsconfig` (path), `timeoutSeconds` (10 to 3600) | default Vitest config, `tsconfig.json`, 300 |
| `vitest.layers` | the test folders `/quality-code:write` writes in: 1 to 5 `{ "name", "folder", "guide"? }`. `name`: lower-case letters, digits and `-`, starting with a letter, used once. `folder`: ends in `/`, not inside a forbidden boundary. `guide`: an optional `.md` file with the team's own conventions | `[{ "name": "unit", "folder": "test/" }]` |
| `vitest.stryker` | `threshold`: the share of Stryker's code changes the tests must catch, a whole number from 0 to 100. Used only when the project has `node_modules/.bin/stryker` | `60` |
| `ticketTemplates` | paths of your Bug/Story issue templates (named in the Jira comment) | none |
| `ticketsDir` | where local ticket copies go, inside the project | `.claude/quality-code/tickets` |
| `redact` | name → regular expression. **Replaces** the default, so keep `customerId` in it | `{ "customerId": "\\bU\\d{5,}\\b" }` |
| `messages` | your own wording for the comment, the fill-in questions and the Jira fill marker | built-in texts |

Redaction patterns that would match empty text are rejected, and so are `ticketsDir` values with
line breaks, `..` or an absolute path.

---

## Connectors and personal settings

The plugin brings the connectors it needs. Jira is required; GitLab and Figma are optional, and
each can be reached in one of two ways: **sign in in the browser** or **use a token**. One way is
enough; the other stays disconnected.

| Service | Used for | Browser sign-in | Token |
|---|---|---|---|
| Jira (`atlassian-rovo`) | tickets, the refuse comment, the fill-in push, Confluence QA plans | `/mcp`, choose `atlassian-rovo`, sign in. An Atlassian connection you already have in claude.ai works too | — |
| GitLab (`gitlab`, `gitlab-token`) | the base branch from your merge request; merge requests in later parts. Read only | like Jira: `/mcp`, choose `gitlab`, sign in. Nothing to create or set: it is GitLab's own MCP server at `<gitlab_api_url>/mcp` (your GitLab admin must have it switched on, GitLab 19.5 or later) | set `gitlab_token` and `gitlab_username`, then `/mcp`, reconnect `gitlab-token` |
| Figma (`figma`, `figma-token`) | design comparison (later parts) | `/mcp`, choose `figma`, sign in | set `figma_api_key`, then `/mcp`, reconnect `figma-token` |

`/quality-code:setup`, `/quality-code:start` and `/quality-code:write` check the connectors first
and show, for each one that is missing, exactly these steps. Figma is on that card only for
Playwright projects.

**Personal settings.** The connectors card asks in the chat for what is not secret (your Jira
email, your GitLab address and username or email) and saves it for you. Tokens are set only from the
`/plugin` menu (quality-code, configure): they are kept in the system keychain, never in a repo and
never typed in the chat. Every setting can be changed there later.

| Setting | For | Notes |
|---|---|---|
| `gitlab_api_url` | both GitLab ways | your GitLab's API address, ending in `/api/v4`, no `/` at the end. Default: TeamSystem's GitLab (`https://biosphere.teamsystem.com/api/v4`) |
| `gitlab_token` (secret) | GitLab token | a personal access token with only the `read_api` scope |
| `gitlab_username` | both GitLab ways | your GitLab username (without `@`) or email. The connectors check confirms the signed-in account is yours and shows it on the card |
| `jira_email` | Jira | the email of your Atlassian account. The connectors check confirms Jira is signed in with it and shows it on the card |
| `figma_api_key` (secret) | Figma token | a Figma personal access token |

The plugin only ever calls GitLab's read operations. The token connector also runs in read-only mode, and its token has only the `read_api` scope.

---

## Safety and privacy

- **Nothing is posted to Jira without a preview and a yes.** That covers the refuse comment and the
  fill-in push. `--ci` posts only the refuse comment and never pushes a fill-in.
- **The local ticket copy is redacted before it is scored**: customer ids (`U` and 5 or more digits),
  e-mails, UUIDs and your own patterns, in the description, the criteria, the scenarios and the QA
  plan text. The raw copy is deleted after redaction and is git-ignored.
- **The model cannot inflate a score.** It hands over raw text and the script judges it. Invented
  scenarios do not move the gate.
- **Setup writes only its own files**: the config, the accepted templates and its `.gitignore` lines.
  The model never writes the config itself.

---

## Troubleshooting

| You see | Do this |
|---|---|
| `Run /quality-code:setup.` | The repo has no config yet, or a field is wrong. Run setup. |
| A command or config file from an older version is not recognised | Follow the upgrade steps for your version in the [CHANGELOG](CHANGELOG.md). |
| `jira.projects[0] … upper-case letters and digits` | Project keys are upper case: `ABC`, not `abc`. |
| `This stack is not supported yet (v1: Playwright, Vitest).` | `package.json` has neither `@playwright/test` nor `vitest`. |
| `Sign in to Atlassian when prompted…` | Connect the Atlassian connector with `/mcp`, or paste the ticket text. |
| "This ticket is from project X, not one of …" | Pick `1` to check it anyway, or add the project with setup. |
| `marketplace add` fails | Make sure `git clone https://github.com/vissz28/agentic-testing` works on its own. |
| Two Atlassian connectors listed | You also have one in claude.ai or in the repo's `.mcp.json`. Harmless. |
| `gitlab` or `figma-token` shows as failed in `/mcp` | You use the other way in for that service. Harmless; the connectors card shows the service as connected. |
| `Another test-writing run is active.` | A `/quality-code:write` run did not finish. Pick `1` to stop it and start yours, or run `node <plugin>/core/checks/cli.mjs run status` to see it. A run older than 12 hours is replaced on its own. |
| `the e2e folder "…" is inside the forbidden "…"` | Your Playwright `testDir` is in a folder tests must not write. Set `playwright.folder` to a test folder, or allow it in `boundaries.allow`. |
| `honesty: anchor tag without a ticket tag` | A tag list was split over lines; keep `{ tag: ['@anchor', '@KEY'] }` on the `test(` line. |
| `No quality-code audit data yet` | Gate a ticket or run a check first; the audit log is local to your machine. |
| A Playwright check says `the app is not reachable` | Start the app, or let your Playwright config's `webServer` start it, then run the check again. The verdict is `not verified`, never red. |

---

## Known limits

- **Playwright writing covers behaviour only.** No design (Figma) captures and no XRay rows yet;
  one e2e folder per project (`playwright.folder`).
- **Playwright checks need the app running** (or your config's `webServer`). No Stryker step for
  end-to-end tests.
- **Stryker is optional.** Without `node_modules/.bin/stryker` in the project, without a target
  file, or when the tests are red, the Stryker step is "not applicable".
- **Stacks:** Playwright and Vitest only. Other runners are possible later as new adapters.
- **Jira:** Jira Cloud through the Atlassian connector.
- **Languages:** English and Italian keywords.
- **Placeholders:** a team's own template with `{{…}}` placeholders outside comments is not detected
  as unfilled; the plugin's own templates are safe.

---

## Roadmap

| # | Part | What it brings | Status |
|---|---|---|---|
| 1 | Core + config | `/quality-code:setup`, the readiness gate, guided fill-in and Jira push for any Jira project | ✅ **available** |
| 2 | Shared checks | honesty, assertion, mutation, boundary and flaky checks, one version for both stacks, driven by the config | ✅ **available** |
| 4 | Vitest adapter | backend test writing for any Node/TS + Vitest service: test layers declared in the config (no database, Prisma or Docker), the expected-values check, optional Stryker; proved end to end on [`examples/sample-service`](examples/sample-service) with a real Vitest and Stryker | ✅ **available** (4a checking in 0.5.0, 4b writing in 0.6.0) |
| 3 | Playwright adapter | the pipeline for any Playwright app (3a), then writing Playwright tests from a ticket (3b) | ✅ **available** (3a checking in 0.7.0, 3b writing in 0.8.0) |
| 5 | Rollout | onboarding page, the first teams (warehouse included) switched to this plugin | 🚧 in progress: [onboarding page](docs/ONBOARDING.md) and warehouse configs done; the switch runbook is a [draft](docs/rollout/onboarding-quality.md) |

Parts are numbered by design order; the backend adapter (4) is built before the frontend one (3).

What stays the same for every team: the **70-point bar**, the rubric per stack, the
**150-character** rule for plain-language criteria, the vague-word rules, and the rule that the
model never grades its own tests.

**Not scheduled yet.** Logic the old warehouse plugins had that no part covers yet. These are open
items, not promises:

- reading merge-request links from the Jira development panel;
- design (Figma) captures and XRay rows for Playwright tests.

Seeding, the audit log with `/quality-code:kpi`, and what option 3 leads to were decided on 14 Oct
and ship in 0.8.0 (see the part 5 spec, §8).

Details:
part 1 [spec](docs/specs/2026-10-12-part-1-core-config-design.md) ·
[plan](docs/plans/2026-10-12-part-1-core-config.md);
part 2 [spec](docs/specs/2026-10-14-part-2-shared-checks-design.md) ·
[plan](docs/plans/2026-10-14-part-2-shared-checks.md);
start command [spec](docs/specs/2026-10-14-start-command-design.md) ·
[plan](docs/plans/2026-10-14-start-command.md);
part 4a [spec](docs/specs/2026-10-14-part-4a-vitest-pipeline-design.md) ·
[plan](docs/plans/2026-10-14-part-4a-vitest-pipeline.md);
part 4b [spec](docs/specs/2026-10-14-part-4b-write-tests-design.md) ·
[plan](docs/plans/2026-10-14-part-4b-write-tests.md);
part 3 [spec](docs/specs/2026-10-14-part-3-playwright-design.md) ·
[plan](docs/plans/2026-10-14-part-3-playwright.md);
part 5 [spec](docs/specs/2026-10-14-part-5-rollout-design.md) ·
[plan](docs/plans/2026-10-14-part-5-rollout.md);
consumption [spec](docs/specs/2026-10-14-consumption-design.md) ·
[plan](docs/plans/2026-10-14-consumption.md);
part 3b [spec](docs/specs/2026-10-14-part-3b-playwright-writing-design.md) ·
[plan](docs/plans/2026-10-14-part-3b-playwright-writing.md);
seed [spec](docs/specs/2026-10-14-seed-design.md) ·
[plan](docs/plans/2026-10-14-seed.md);
audit and KPI [spec](docs/specs/2026-10-14-audit-kpi-design.md) ·
[plan](docs/plans/2026-10-14-audit-kpi.md).

---

## Getting help

- **Something is not working:** check [Troubleshooting](#troubleshooting) first.
- **A bug, or a request for your stack or language:** open an issue in
  [vissz28/agentic-testing](https://github.com/vissz28/agentic-testing/issues) with the command you ran,
  the output, and your `.claude/quality-code.json` (it holds no secrets).
- **A ticket scored lower than you expected:** run `ticket-eval` with `--json`; the output lists
  every signal the rubric found and what is missing.

---

## Developing the plugin

```
agentic-testing/
├─ CHANGELOG.md                      what changed in each version
├─ .claude-plugin/marketplace.json
├─ .github/workflows/test.yml          core tests, JSON check, no project values in core or the checks
├─ plugins/
│  └─ quality-code/
│     ├─ .claude-plugin/plugin.json    manifest and personal settings
│     ├─ .mcp.json                     Jira, GitLab and Figma connectors (browser sign-in and token)
│     ├─ commands/                     check.md, consumption.md, kpi.md, seed.md, setup.md, start.md, ticket-eval.md, write.md
│     ├─ hooks/hooks.json              the boundary hook (acts only during a test-writing run)
│     ├─ core/                         the scripts (no dependencies): config, languages, criteria,
│     │                                rubrics, score, sanitize, fill, jira, fields, messages,
│     │                                cli, setup, branch, connectors.md
│     │  ├─ checks/                    boundary, honesty, suite-honesty, expected, flaky, mutation,
│     │  │                             the run marker (run) and their CLI
│     │  ├─ guides/                    vitest-writing.md, the rules /quality-code:write follows
│     │  ├─ runners/                   the Vitest, Playwright and Stryker runners
│     │  ├─ consumption/               reads Claude Code's local transcripts: usage and estimated cost
│     │  └─ pipeline/                  one pipeline for Vitest and Playwright, its card and CLI
│     ├─ schema/                       quality-code.schema.json
│     ├─ templates/                    standard Story and Bug templates
│     └─ test/                         unit tests and the parity suite
├─ examples/sample-service/          the end-to-end proof: a small pricing service, two tickets, their specs
├─ scripts/capture-parity.mjs          records the reference outputs the parity suite compares with
└─ docs/                               getting started, specs, plans
```

```bash
cd plugins/quality-code && npm test
```

Run a check by hand (from a set-up repo):

```bash
node <plugin>/core/checks/cli.mjs honesty test/orders.spec.ts
```

Exit codes: `0` pass, `1` fail, `2` usage or config error (or a crash), `3` not run.
Diff mode (`boundary`, `honesty`) reads git, so it cannot see git-ignored files such as `.env` or `dist/`.

`boundary`, `honesty`, `suite-honesty` run as they are; `expected` needs the ticket
(`expected --ticket @<ticketsDir>/ABC-123/ticket.json --key ABC-123 <spec…>`); `flaky` and
`mutation` need a test runner: both runners are there (Vitest and Playwright).
`run start --key KEY`, `run stop` and `run status` open, close and show a test-writing run (`run
start` exits `1` when a run is already active). The pipeline runs the checks in order, picking the runner from `adapter` (Playwright has no Stryker step and refuses `--target`):
`node <plugin>/core/pipeline/cli.mjs <spec…> [--key KEY] [--range A...B] [--flaky N] [--ticket @file] [--target path] [--json]`
(exit `0` green, `1` checks failed or tests red, `2` usage or config error, `3` not verified).

```bash
claude plugin validate plugins/quality-code && claude plugin validate .
```

- **No dependencies and no project values in `core/`.** CI fails if a warehouse value (project key,
  site, field id, label) appears there; every team value comes from the config.
- **Parity suite.** `test/parity/` runs the core with the warehouse configs against 116 real ticket
  fixtures and compares the output with what the original warehouse scripts printed. Differences
  are allowed only where the spec's §10 lists them.
- **Release:** add the version's entry to [CHANGELOG.md](CHANGELOG.md), bump `version` in
  `plugins/quality-code/.claude-plugin/plugin.json`, then
  `claude plugin tag plugins/quality-code`, then push. Users get it with `/plugin update`.

