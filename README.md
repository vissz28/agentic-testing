# quality-code

**Test-ready tickets and tests you can trust, inside Claude Code. One plugin for every team.**

quality-code connects your Jira tickets to your test suite. It checks whether a ticket is clear
enough to test, helps its author fill the gaps, and (as the [roadmap](#roadmap) lands) writes tests
from the ticket's acceptance criteria and grades them. It works with any Jira project and any repo
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

It checks your connectors, shows the branch and what it changed, takes the ticket key from the
branch name (`ABC-123-add-export`), and evaluates that ticket. To check any ticket directly:
`/quality-code:ticket-eval ABC-123`.

The result is a score out of 100. At 70 or more the ticket is ready to test. Below 70 you can post a
comment on Jira listing what is missing, or fill in the gaps on the spot. New to it? Start with
[Getting started](docs/GETTING_STARTED.md), a step-by-step walk-through for QA and developers.

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
| Deterministic checks on generated tests (honesty, assertions, mutation, boundaries, flakiness) | — | 🛠 in design (part 2) |
| Write and grade backend tests, any Node/TS + Vitest service | — | 📅 planned (part 4) |
| Write and grade frontend tests, any Playwright app | — | 📅 planned (part 3) |

## Who does what

| Role | Uses it to |
|---|---|
| **QA** | check a ticket before testing starts, fill the gaps with the author, (later) get tests written and graded |
| **Developer** | check a ticket before picking it up; (later) get a regression test pinned to a bug |
| **Product owner / ticket author** | read the Jira comment that says exactly what to add, with examples |
| **Team lead** | run setup once and own `.claude/quality-code.json` in the repo |
| **CI** | refuse untestable tickets automatically with `--ci` |

---

## Contents

1. [Install](#install)
2. [Set up your project](#set-up-your-project)
3. [Check a ticket](#check-a-ticket)
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

Setup first checks the connectors (Jira required; GitLab and Figma optional) and shows what is
connected, missing or broken, with the fix for each. Keys are set in the plugin settings, never typed
in the chat.

Setup detects the stack from `package.json` (Playwright or Vitest; if both, it asks which; if
neither, it stops: this stack is not supported yet). Then it asks one thing per card, and you answer
by typing a number:

1. **Jira**: the site (for example `https://example.atlassian.net`) and the project keys (`ABC`),
   picked from the projects you can see.
2. **Acceptance-criteria field**: the Jira field that holds the criteria, if your project has one
   (found by its name, "Acceptance Criteria" or "Criteri di accettazione"); if there is no single
   match, you pick it from a numbered list or choose none.
3. **Other projects to track** (optional).
4. **Feature labels**: picked from the labels on up to 100 recent tickets, with counts. In a project
   shared by many teams, first narrow the search to a word in the title or one component, or type
   your labels (each is checked to exist). For Playwright also the screen route of each one
   (`/orders`), the text used to find its Confluence QA plan (the label with `_` and `-` as spaces),
   and the Confluence space(s) to search, picked from the spaces that search finds, or all spaces.
   Each feature's search is tried once; if no page title matches its words, you pick one of the
   titles found, type other words, or choose no QA plan for it.
5. **Title prefixes** (Vitest only): counted from the same tickets' titles (`[API] …`), or none.
6. **Languages**: English, plus Italian if your tickets use Italian section names.
7. **Redaction**: customer-id redaction is on by default; add extra patterns if you need them.
8. **Templates**: if the repo has no Bug/Story issue templates, it offers the plugin's standard ones.

It then shows the whole config and asks `1. Write it / 2. Change something / 3. Cancel`. Nothing is
written before you type `1`. Setup writes only `.claude/quality-code.json`, the templates you
accepted, and one `.gitignore` line for the raw ticket copies. Finally it scores one recent ticket
to prove the setup works.

Run `/quality-code:setup` again any time to change a value; it starts from the current config.

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

For developers. Today the run stops here with the `[RISK / NOT RECOMMENDED]` mark; once test
writing arrives (parts 3–4), the tests will be written and every result will open with that mark.
If the ticket has nothing to check at all, it asks you to add what should happen first.

---

## The config file

`.claude/quality-code.json` in the project root. Commit it, and change it by running
`/quality-code:setup` again rather than by hand. Every `ticket-eval` run checks it first and names
any field that is wrong. A JSON schema ships with the plugin (`schema/quality-code.schema.json`).

```json
{
  "version": 1,
  "adapter": "vitest",
  "jira": {
    "site": "https://example.atlassian.net",
    "projects": ["ABC"],
    "acceptanceCriteriaField": "customfield_10001",
    "trackingProjects": []
  },
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
| `jira.acceptanceCriteriaField` | id of the criteria field, or `null` | required |
| `jira.trackingProjects` | other projects whose tickets may be linked | `[]` |
| `languages` | `en`, `it`, or both | required |
| `features[]` | `label`; Playwright also `route` (`/orders`) and `qaPlanSearch` (Confluence search text) | required |
| `titlePrefixes` | title prefixes without brackets, matched literally; `[]` for none | `[]` |
| `confluenceSpaces` | Playwright: Confluence space keys the QA-plan search is limited to (`["ABC"]`) | all spaces |
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
| GitLab (`gitlab`, `gitlab-token`) | the base branch from your merge request; merge requests in later parts. Read only | set `gitlab_oauth_client_id`, then `/mcp`, choose `gitlab`, sign in | set `gitlab_token`, then `/mcp`, reconnect `gitlab-token` |
| Figma (`figma`, `figma-token`) | design comparison (later parts) | `/mcp`, choose `figma`, sign in | set `figma_api_key`, then `/mcp`, reconnect `figma-token` |

`/quality-code:setup` and `/quality-code:start` check the connectors first and show, for each one
that is missing, exactly these steps.

**Personal settings.** Asked when the plugin is enabled, changed later from the `/plugin` menu
(quality-code, configure). Secrets are kept in the system keychain, never in a repo and never typed
in the chat.

| Setting | For | Notes |
|---|---|---|
| `gitlab_api_url` | both GitLab ways | your GitLab's API address, ending in `/api/v4`. Default: TeamSystem's GitLab (`https://biosphere.teamsystem.com/api/v4`) |
| `gitlab_oauth_client_id` | GitLab browser sign-in | the Application ID of a **public** GitLab application (not confidential) with redirect URI `http://127.0.0.1:8888/callback` and the `read_api` scope, created under GitLab *Settings > Applications*. One person can create it and share the ID with the team |
| `gitlab_token` (secret) | GitLab token | a personal access token with only the `read_api` scope |
| `figma_api_key` (secret) | Figma token | a Figma personal access token |

Both GitLab connectors run in read-only mode: the plugin can never change anything in GitLab.

---

## Safety and privacy

- **Nothing is posted to Jira without a preview and a yes.** That covers the refuse comment and the
  fill-in push. `--ci` posts only the refuse comment and never pushes a fill-in.
- **The local ticket copy is redacted before it is scored**: customer ids (`U` and 5 or more digits),
  e-mails, UUIDs and your own patterns, in the description, the criteria, the scenarios and the QA
  plan text. The raw copy is deleted after redaction and is git-ignored.
- **The model cannot inflate a score.** It hands over raw text and the script judges it. Invented
  scenarios do not move the gate.
- **Setup writes only its own files**: the config, the accepted templates and one `.gitignore` line.
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

---

## Known limits

- **No test writing yet.** Today the plugin covers setup, the readiness gate, the guided fill-in
  and Jira. Test writing and the checks come in parts 2–4.
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
| 2 | Shared checks | honesty, assertion, mutation, boundary and flaky checks, one version for both stacks, driven by the config | 🛠 in design |
| 4 | Vitest adapter | backend test writing for any Node/TS + Vitest service: test layers declared in the config, an optional database, optional Stryker; proved on a sample service in this repo | 📅 next, after part 2 |
| 3 | Playwright adapter | frontend test writing and the pipeline for any Playwright app | 📅 planned |
| 5 | Rollout | onboarding page, the first teams (warehouse included) switched to this plugin | 📅 planned |

Parts are numbered by design order; the backend adapter (4) is built before the frontend one (3).

What stays the same for every team: the **70-point bar**, the rubric per stack, the
**150-character** rule for plain-language criteria, the vague-word rules, and the rule that the
model never grades its own tests.

Details: [part 1 spec](docs/specs/2026-10-12-part-1-core-config-design.md) ·
[part 1 plan](docs/plans/2026-10-12-part-1-core-config.md).

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
quality-code/
├─ CHANGELOG.md                      what changed in each version
├─ .claude-plugin/marketplace.json
├─ .github/workflows/test.yml          core tests, JSON check, no project values in core
├─ plugins/
│  └─ quality-code/
│     ├─ .claude-plugin/plugin.json    manifest and personal settings
│     ├─ .mcp.json                     Jira, GitLab and Figma connectors (browser sign-in and token)
│     ├─ commands/                     setup.md, start.md, ticket-eval.md
│     ├─ core/                         the scripts (no dependencies): config, languages, criteria,
│     │                                rubrics, score, sanitize, fill, jira, cli, setup,
│     │                                branch, connectors.md
│     ├─ schema/                       quality-code.schema.json
│     ├─ templates/                    standard Story and Bug templates
│     └─ test/                         unit tests and the parity suite
├─ scripts/capture-parity.mjs          records the reference outputs the parity suite compares with
└─ docs/                               getting started, specs, plans
```

```bash
cd plugins/quality-code && npm test
```

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

