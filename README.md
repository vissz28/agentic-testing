# agentic-testing

**From a Jira ticket to real, graded tests, inside Claude Code. For any team.**

A Claude Code plugin that checks whether a Jira ticket is written well enough to test, helps fix
it when it is not, and (in later parts) writes the tests from the ticket's acceptance criteria and
grades them. It works with any Jira project and any repo that uses **Playwright** (frontend) or
**Vitest** (backend). Everything that is specific to your team (Jira project, criteria field,
feature labels, routes, languages, redaction) lives in one config file that a setup command writes
for you.

> **The rule everything is built on:** the model reads, drafts and writes, but it **never grades**.
> Every score and every pass/fail comes from a deterministic script. A green result is not the
> model's opinion of its own work.

| Plugin | For | Status |
|---|---|---|
| **`agentic-testing`** | any repo with Playwright or Vitest, any Jira project | **part 1 (v0.2.0):** setup, readiness gate, guided fill-in, Jira comment and push |
| `warehouse-frontend`, `warehouse-backend` | the TeamSystem warehouse repos only | the original full pipeline (tests, XRay, checks); kept until part 5, see [Warehouse plugins](#warehouse-plugins-reference-implementation) |

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
12. [Developing the plugin](#developing-the-plugin)
13. [Warehouse plugins (reference implementation)](#warehouse-plugins-reference-implementation)
14. [History](#history)

---

## Install

**Requirements:** a recent Claude Code with plugin support (`claude plugin --help`), Node 18+, a repo
whose `package.json` has `@playwright/test` or `vitest`, and access to your Jira site. The marketplace
repo is private: `git clone https://github.com/vissz28/agentic-testing` must work on your machine
(keychain login, `gh auth login` or SSH).

Inside Claude Code, in your repo:

```
/plugin marketplace add vissz28/agentic-testing
/plugin install agentic-testing@agentic-testing
```

The same from a shell:

```bash
claude plugin marketplace add vissz28/agentic-testing
```

```bash
claude plugin install agentic-testing@agentic-testing --scope project
```

**Offer it to everyone who opens the repo:** add this to the repo's `.claude/settings.json` and
commit it:

```json
{
  "extraKnownMarketplaces": {
    "agentic-testing": { "source": { "source": "github", "repo": "vissz28/agentic-testing" } }
  },
  "enabledPlugins": { "agentic-testing@agentic-testing": true }
}
```

**Update** with `/plugin update agentic-testing@agentic-testing`.

---

## Set up your project

```
/agentic-testing:setup
```

Setup detects the stack from `package.json` (Playwright or Vitest; if both, it asks which; if
neither, it stops: this stack is not supported yet). Then it asks one thing per card, and you answer
by typing a number:

1. **Jira**: the site (for example `https://example.atlassian.net`) and the project keys (`ABC`),
   picked from the projects you can see.
2. **Acceptance-criteria field**: the Jira field that holds the criteria, if your project has one
   (found by its name, "Acceptance Criteria"); otherwise none.
3. **Other projects to track** (optional).
4. **Feature labels**: picked from the labels on your project's last 100 tickets, with counts. For
   Playwright also the screen route of each one (`/orders`) and the text used to find its Confluence
   QA plan.
5. **Title prefixes** (Vitest only): counted from recent ticket titles (`[API] …`), or none.
6. **Languages**: English, plus Italian if your tickets use Italian section names.
7. **Redaction**: customer-id redaction is on by default; add extra patterns if you need them.
8. **Templates**: if the repo has no Bug/Story issue templates, it offers the plugin's standard ones.

It then shows the whole config and asks `1. Write it / 2. Change something / 3. Cancel`. Nothing is
written before you type `1`. Setup writes only `.claude/agentic-testing.json`, the templates you
accepted, and one `.gitignore` line for the raw ticket copies. Finally it scores one recent ticket
to prove the setup works.

Run `/agentic-testing:setup` again any time to change a value; it starts from the current config.

---

## Check a ticket

```
/agentic-testing:ticket-eval ABC-123
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
| A Confluence QA plan found (linked, or by the feature's search text) | 15 | — |
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

  _Added during the agentic-testing readiness check._

  ## Acceptance criteria
  - The export file uses the language of the user's account …

Label added: Orders
Nothing already on the ticket is changed.
```

Only your new text is sent, never the local (redacted) copy, so a redaction can never overwrite
real data. The ticket is re-read from Jira first and only appended to. `--ci` never pushes a fill-in.

### 3. Continue anyway

For developers. In part 1 the run stops here with the `[RISK / NOT RECOMMENDED]` mark; once test
writing arrives (parts 3–4), the tests will be written and every result will open with that mark.
If the ticket has nothing to check at all, it asks you to add what should happen first.

---

## The config file

`.claude/agentic-testing.json` in the project root. Commit it, and change it by running
`/agentic-testing:setup` again rather than by hand. Every `ticket-eval` run checks it first and names
any field that is wrong. A JSON schema ships with the plugin (`schema/agentic-testing.schema.json`).

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
| `ticketTemplates` | paths of your Bug/Story issue templates (named in the Jira comment) | none |
| `ticketsDir` | where local ticket copies go, inside the project | `.claude/agentic-testing/tickets` |
| `redact` | name → regular expression. **Replaces** the default, so keep `customerId` in it | `{ "customerId": "\\bU\\d{5,}\\b" }` |
| `messages` | your own wording for the comment, the fill-in questions and the Jira fill marker | built-in texts |

Redaction patterns that would match empty text are rejected, and so are `ticketsDir` values with
line breaks, `..` or an absolute path.

---

## Connectors and personal settings

The plugin brings three connectors:

| Connector | Used for | Setup |
|---|---|---|
| `atlassian-rovo` | reading tickets, the refuse comment, the fill-in push, Confluence QA plans | sign in to Atlassian when prompted (`/mcp`). An Atlassian connection you already have in claude.ai works too |
| `figma` | design comparison (later parts) | optional personal Figma token |
| `gitlab` | merge requests (later parts) | the GitLab MCP URL |

Personal settings and secrets are asked when the plugin is enabled and can be changed later from the
`/plugin` menu. Secrets are kept in the system keychain, never in a repo.

- `figma_api_key`: optional.
- `gitlab_mcp_url`: defaults to TeamSystem's GitLab (`https://biosphere.teamsystem.com/api/v4/mcp`).
  Teams on another GitLab enter their own URL.

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
| `Run /agentic-testing:setup.` | The repo has no config yet, or a field is wrong. Run setup. |
| `jira.projects[0] … upper-case letters and digits` | Project keys are upper case: `ABC`, not `abc`. |
| `This stack is not supported yet (v1: Playwright, Vitest).` | `package.json` has neither `@playwright/test` nor `vitest`. |
| `Sign in to Atlassian when prompted…` | Connect the Atlassian connector with `/mcp`, or paste the ticket text. |
| "This ticket is from project X, not one of …" | Pick `1` to check it anyway, or add the project with setup. |
| `marketplace add` fails | Make sure `git clone https://github.com/vissz28/agentic-testing` works on its own. |
| Two Atlassian connectors listed | You also have one in claude.ai or in the repo's `.mcp.json`. Harmless. |

---

## Known limits

- **Part 1 does not write tests yet.** It covers setup, the readiness gate, the guided fill-in and
  Jira. Test writing and the checks come in parts 2–4.
- **Stacks:** Playwright and Vitest only.
- **Languages:** English and Italian keywords.
- **Placeholders:** a team's own template with `{{…}}` placeholders outside comments is not detected
  as unfilled; the plugin's own templates are safe.

---

## Roadmap

| # | Part | What it brings | Status |
|---|---|---|---|
| 1 | Core + config | `/agentic-testing:setup`, the readiness gate, guided fill-in and Jira push for any Jira project | **built (v0.2.0)** |
| 2 | Shared checks | honesty, assertion and mutation checks, boundary guard and flaky check, configured instead of hard-coded | planned |
| 3 | Playwright adapter | frontend test writing and the pipeline for any app | planned |
| 4 | Vitest adapter | backend test writing, layers and Stryker for any service | planned |
| 5 | Sample project + rollout | a reference project, an onboarding page, the warehouse repos switched to this plugin | planned |

What stays the same for every team: the **70-point bar**, the rubric per stack, the
**150-character** rule for plain-language criteria, the vague-word rules, and the rule that the
model never grades its own tests.

Details: [part 1 spec](docs/specs/2026-10-12-part-1-core-config-design.md) ·
[part 1 plan](docs/plans/2026-10-12-part-1-core-config.md).

---

## Developing the plugin

```
agentic-testing/
├─ .claude-plugin/marketplace.json
├─ .github/workflows/test.yml          core tests, JSON check, no project values in core
├─ plugins/
│  ├─ agentic-testing/
│  │  ├─ .claude-plugin/plugin.json    manifest and personal settings
│  │  ├─ .mcp.json                     Atlassian, Figma, GitLab connectors
│  │  ├─ commands/                     setup.md, ticket-eval.md
│  │  ├─ core/                         the scripts (no dependencies): config, languages, criteria,
│  │  │                                rubrics, score, sanitize, fill, jira, cli, setup
│  │  ├─ schema/                       agentic-testing.schema.json
│  │  ├─ templates/                    standard Story and Bug templates
│  │  └─ test/                         unit tests and the parity suite
│  ├─ warehouse-frontend/
│  └─ warehouse-backend/
├─ scripts/sync-from-repos.sh
└─ docs/                               specs, plans, USER_GUIDE.md
```

```bash
cd plugins/agentic-testing && npm test
```

```bash
claude plugin validate plugins/agentic-testing && claude plugin validate .
```

- **No dependencies and no project values in `core/`.** CI fails if a warehouse value (project key,
  site, field id, label) appears there; every team value comes from the config.
- **Parity suite.** `test/parity/` runs the core with the warehouse configs against 116 real ticket
  fixtures and compares the output with what the original warehouse scripts printed. Differences
  are allowed only where the spec's §10 lists them.
- **Release:** bump `version` in `plugins/agentic-testing/.claude-plugin/plugin.json`, then
  `claude plugin tag plugins/agentic-testing`, then push. Users get it with `/plugin update`.

---

## Warehouse plugins (reference implementation)

`warehouse-frontend` and `warehouse-backend` are the original, warehouse-only version of this
solution. They run the whole pipeline (readiness gate, test writing, deterministic checks, result
card) using harness scripts that live in each warehouse repo under `.claude/harness/`. They stay as
they are until part 5 moves the warehouse repos onto `agentic-testing`.

| | `warehouse-frontend` | `warehouse-backend` |
|---|---|---|
| Install (in that repo) | `/plugin install warehouse-frontend@agentic-testing` | `/plugin install warehouse-backend@agentic-testing` |
| Repo branch with the harness | `agentic-testing-fe`, or a branch merged from it | `agentic-testing-be` (or `agt-34-remove-audit-logs` until merged) |
| Full run | `/warehouse-frontend:spec-frontend FIC-…` | `/warehouse-backend:spec FIC-…` |
| Readiness check only | `/warehouse-frontend:ticket-eval FIC-…` | — |
| One output only | `:playwright`, `:xray` | `:unit`, `:integration`, `:range` |
| Test data | `:seed` (API stubs) | `:seed` (~25 rows per table into your local DB) |
| It writes | a Playwright spec and an XRay case (CSV + Excel) | Vitest specs against a real Postgres (Docker required) |

The checks after writing, all plain scripts with their own `--self-test`:

| Check | What it catches |
|---|---|
| `boundary-guard` | a write to application code, the CI pipeline or `.env` |
| `honesty-check` | a check or a whole test quietly deleted or skipped |
| `suite-honesty` | a test with no assertion, or a run where everything was postponed |
| `expected-check` (backend) | the test does not assert the values the criteria name |
| type-check and the run | the spec does not compile, or fails |
| `mutate-generated` | an assertion that cannot fail |
| Stryker (backend bugs) | the fix is not really what the test pins |

**Maintaining them.** Their skills and commands are copied from the two repos, which stay the source
of truth:

```bash
scripts/sync-from-repos.sh
```

Then `claude plugin validate plugins/warehouse-frontend` (and the backend one), bump `version`, and
push. The step-by-step guide for QA is in [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

---

## History

| Ticket | What |
|---|---|
| AGT-29 / AGT-30 | Plain-language acceptance criteria accepted next to Gherkin; 150-character minimum |
| AGT-31 / AGT-32 | Guided fill-in on refuse, push to Jira, `[RISK / NOT RECOMMENDED]` flag |
| AGT-33 | Frontend bar raised from 60 to 70 to match the backend |
| AGT-34 | Accumulated audit logs removed |
| AGT-28 | Reusable solution for any team: part 1 built (`agentic-testing` v0.2.0) |
