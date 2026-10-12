# Part 1: core and configuration

Status: draft for review · Date: 2026-10-12 · Owner: Elvis Zefaj · Related: AGT-28

## 1. Goal

Turn the warehouse-only ticket-readiness gate into a common solution any TeamSystem team can use from
Claude Code, with no warehouse or FIC value left in the code. Part 1 delivers the shared core, the
team configuration and the setup command; at its end any team can install the plugin, run setup, and
check whether its tickets are ready to test (`ticket-eval`), including the guided fill-in, the refuse
comment and the Jira push.

This is part 1 of 5:

| # | Part | Delivers |
|---|---|---|
| **1** | **Core + config** (this spec) | config, setup, readiness gate, fill-in, Jira read/write |
| 2 | Shared checks | honesty-check, suite-honesty, mutation, boundary guard, flaky-check from config |
| 3 | Playwright adapter | frontend pipeline + skill, optional XRay output |
| 4 | Vitest adapter | backend pipeline + skill, layers, Stryker |
| 5 | Sample project + rollout | reference project, onboarding, README, warehouse switched to the plugin |

Each part has its own spec, plan and review.

## 2. Decisions already taken

| Decision | Value |
|---|---|
| Supported stacks (v1) | React + Playwright frontends; Node/TypeScript + Vitest backends. Other stacks later, as adapters. |
| Where the code lives | Self-contained plugin (approach A). Scripts run from the plugin and find the project through `$CLAUDE_PROJECT_DIR`. |
| Pass bar | **70, fixed for every project.** Not configurable. |
| Proof | A sample project in the plugin repo (part 5) plus warehouse unchanged in behaviour. |
| Where it runs | Everything inside Claude Code: setup, gate, fill-in, results. Nobody edits config by hand. |
| Configuration pattern | Claude Code's plugin settings (`userConfig`) for personal values and secrets; one committed project file for team values. |

## 3. Packaging

- One plugin, **`agentic-testing`**, in the existing marketplace `vissz28/agentic-testing`. It replaces
  `warehouse-frontend` and `warehouse-backend`, which keep working unchanged until part 5 and are then
  removed.
- Commands are namespaced by Claude Code: `/agentic-testing:setup`, `/agentic-testing:ticket-eval`
  (part 1); `:spec`, `:seed`, `:check` follow in parts 3–4.
- The stack is chosen by the project config (`adapter`), not by installing a different plugin.
- Version `0.2.0` when part 1 ships.

## 4. Configuration

### 4.1 Personal values: plugin settings (`userConfig`)

Declared in `plugins/agentic-testing/.claude-plugin/plugin.json`, set with `/plugin configure
agentic-testing@agentic-testing`, stored by Claude Code (secrets in the system keychain, the rest in
the user's settings). Never committed.

| Key | Type | Required | Default | Used by |
|---|---|---|---|---|
| `figma_api_key` | string, `sensitive: true` | no | — | Figma connector env `FIGMA_API_KEY` = `${user_config.figma_api_key}` |
| `gitlab_mcp_url` | string | no | `https://biosphere.teamsystem.com/api/v4/mcp` | GitLab connector `url` = `${user_config.gitlab_mcp_url}` |

### 4.2 Team values: `.claude/agentic-testing.json`

Committed in each project, written only by the setup command, checked at the start of every run.
The plugin ships its format as `schema/agentic-testing.schema.json` (JSON Schema, draft 2020-12) for
documentation; the check itself is `core/config.mjs`, without dependencies.

| Field | Type | Required | Rule / default | Replaces today's |
|---|---|---|---|---|
| `version` | integer | yes | `1` | — |
| `adapter` | `"playwright"` \| `"vitest"` | yes | — | detection by `e2e/` folder or `nest-cli.json` |
| `jira.site` | https URL | yes | — | `teamsystem.atlassian.net` in skills and scripts |
| `jira.projects` | list of keys, ≥1, each `^[A-Z][A-Z0-9]+$` | yes | — | `FIC` in regexes and texts |
| `jira.acceptanceCriteriaField` | string `customfield_<digits>` or `null` | yes | `null` = criteria only from the description | `customfield_11707` |
| `jira.trackingProjects` | list of keys | no | `[]` | the `AGT\|FIC` allowed in `.skip(... TICKET-1 ...)` (used from part 2) |
| `languages` | list of `"en"` \| `"it"`, ≥1 | yes | — | built-in EN+IT keyword lists |
| `features` | list of `{label, route?, qaPlanSearch?}`, labels unique | yes (may be empty) | `route` must start with `/` | the 8 warehouse labels in 6+ files |
| `titlePrefixes` | list of strings | no | `["FE","BE","FS"]` | `[FE\|BE\|FS]` in the backend rubric |
| `ticketTemplates.bug` / `.story` | repo-relative paths | no | `null` (refuse comment then names no template) | `.gitlab/issue_templates/{Bug,Story}.md` |
| `ticketsDir` | repo-relative path | no | `.claude/agentic-testing/tickets` | `e2e/tickets/` (FE), `.claude/audit/tickets/` (BE) |
| `redact` | object of name → regex string | no | `{ "customerId": "\\bU\\d{5,}\\b" }` | `U######` pattern in the backend sanitizer |
| `messages` | object: per rubric key `{title, missing, add, question, example}`, a `story` object with the same per-key overrides, and `templateLine` (`{bug, story}`) | no | neutral built-in texts | warehouse wording in the refuse comment, the fill-in and the template line |

Unknown fields are an error (so a typo is caught, not ignored). Every error names the field and says
what is expected, for example `jira.projects[0] "fic" must be upper-case letters and digits, like "FIC"`.

Fields for later parts (test folders, boundary paths, ports, Docker, stubs, layers) are added by their
own specs, together with the setup steps that fill them.

### 4.3 Fixed in the plugin (the shared standard)

- Pass bar 70.
- The two rubrics, chosen by `adapter`:

  | Signal | `playwright` | `vitest` |
  |---|---:|---:|
  | Acceptance criteria | 30 | 30 |
  | Criteria specific | 15 | 15 |
  | Feature label (one of `features`) | 15 | 5 |
  | QA plan found (Confluence, by `qaPlanSearch`) | 15 | — |
  | Steps (bug) or user story (story) | 10 | 15 |
  | Expected and actual | 10 | 15 |
  | Context / summary section | — | 10 |
  | Title prefix (one of `titlePrefixes`) | — | 5 |
  | Environment (`Env:` line) | 5 | 5 |

- Acceptance-criteria rules: Gherkin at any length; plain language ≥150 characters of criteria text
  under a criteria heading or in the criteria field; prose without a heading earns nothing; vague
  results keep the 30 and lose the 15; HTML comments ignored; mixed sections allowed.
- Guided fill-in, refuse comment and Jira-push behaviour exactly as today (AGT-31/32).
- Connector names: `atlassian-rovo`, `figma`, `gitlab`, so tool names in skills are the same for every team.

## 5. Components

All under `plugins/agentic-testing/core/`. Node built-ins only, no npm dependencies, ES modules.

| Module | One job | Depends on |
|---|---|---|
| `config.mjs` | find, load and validate `.claude/agentic-testing.json`; the only module that knows where config lives | — |
| `languages/en.mjs`, `languages/it.mjs` | keyword packs: Gherkin steps, continuations, setup steps, criteria headings, section names, vague phrases, steps / user-story / expected / actual / environment / context patterns, question forms | — |
| `criteria.mjs` | read criteria (Gherkin + plain), strip vague criteria, count derivable results | languages |
| `rubrics/playwright.mjs`, `rubrics/vitest.mjs` | per stack: the weights, the signal detectors (the backend also accepts question forms for expected/actual and counts derivable results from the ticket text; the frontend uses headings and counts from scenarios) and the extra brief fields (frontend: feature route, QA plan) | languages, criteria |
| `score.mjs` | pick the rubric by `adapter`, score, gate at 70, build the brief | config, rubrics |
| `sanitize.mjs` | redact emails, UUIDs and the configured patterns in summary, description and criteria field | config |
| `fill.mjs` | fill menu, pick, add (accepted only if the rubric then credits it), `filled` record | score, criteria |
| `jira.mjs` | refuse comment text; fill-in push payload (append, labels, title prefix); browse URL | config, score |
| `cli.mjs` | the one entry point | all |
| `setup.mjs` | `--detect` (read-only repo scan → JSON) and `--write` (validate, then write config + optional templates + `.gitignore` line) | config |

One home per behaviour: the criteria reader and the vague-word list exist once (today: twice in the
backend, once in the frontend).

## 6. CLI contract

Invoked by the skills as `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" <command> …` with the working
directory at the project root. The output lines and exit codes are kept from today's scripts, so the
skills' reading of them does not change.

| Command | Input | stdout | Exit |
|---|---|---|---|
| `sanitize --in @raw.json --out ticket.json` | raw Jira fields | — | 0 / 2 bad input |
| `score --in @ticket.json [--json] [--ci]` | sanitized ticket | report + `TICKET_EVAL_JSON:{…}` (or JSON only) | 0 pass / 1 refuse / 2 config or input error |
| `refuse-comment --in @ticket.json` | | comment text | 1 refuse / 0 pass |
| `fill-menu --in @ticket.json` | | menu + `FILL_JSON:{…}` | 0 |
| `pick --in @ticket.json "1 3"` | | one line + `FILL_JSON:{…}` | 0 enough / 1 short / 2 bad number |
| `add --in @ticket.json <criterion> "<answer>"` | | one line + `FILL_JSON:{…}`; file rewritten only when accepted | 0 accepted / 1 rejected / 2 no file |
| `jira-update --in @ticket.json` | | preview + `JIRA_UPDATE_JSON:{append,labelsAdd,titlePrefix,replacedVague}` | 0 |
| `config check` | | `ok` or the errors | 0 / 2 |

Every command first loads the config; a missing or invalid config exits 2 with the message from §8.

Ticket files live in `<ticketsDir>/<KEY>/`: `raw.json` (deleted after sanitizing), `ticket.json`
(sanitized, the only copy the gate and the fill-in use). Setup adds `<ticketsDir>/*/raw.json` to
`.gitignore`; whether `ticket.json` is committed is the team's choice (default: committed, as the
backend does today).

## 7. Setup command (`/agentic-testing:setup`)

Same numbered-card style as `/spec`. The model proposes and asks; `setup.mjs` detects and writes.
The model never writes the config file.

1. **Detect** (`setup.mjs --detect`, read-only): `@playwright/test` → `playwright`, `vitest` → `vitest`
   in `package.json` (both → ask; neither → stop: "this stack is not supported yet"); issue templates
   in `.gitlab/issue_templates/` or `.github/ISSUE_TEMPLATE/`; an existing config (rerun starts from it).
2. **Jira** (connector): confirm the site; pick projects by number from the visible projects; propose
   the field named "Acceptance Criteria" from the project's fields (none → `null`); optional tracking
   projects.
3. **Features**: list labels used on the project's last 100 tickets with counts; pick by number. For
   `playwright`, propose a route per label from the app's router files (read-only) or ask for it.
4. **Language and redaction**: propose `en`, plus `it` if recent tickets contain Italian section
   names; TeamSystem customer-id redaction on by default; optional extra patterns.
5. **Templates**: none found → offer the standard Story/Bug templates (written only on yes).
6. **Preview**: the full file, then `1. Write it / 2. Change something / 3. Cancel`.
   `setup.mjs --write` validates and writes; nothing is written on 2 or 3.
7. **Prove it**: score one recent ticket with the new config and show the result card.

Rerun shows current values and changes any field. Setup writes only `.claude/agentic-testing.json`,
the accepted templates and the `.gitignore` line.

## 8. Errors

Each is one message in the chat; nothing is scored or written after it.

| Situation | Message (gist) | Exit |
|---|---|---|
| No `.claude/agentic-testing.json` | "This repo is not set up. Run `/agentic-testing:setup`." | 2 |
| Invalid config | the field, the value, what is expected | 2 |
| Jira connector unavailable | "Sign in to Atlassian when prompted, or paste the ticket text." | — |
| Ticket key from a project not in `jira.projects` | asks before scoring: continue / stop | — |
| Unsupported stack at setup | "This stack is not supported yet (v1: Playwright, Vitest)." | — |
| `add` without a ticket file | as today | 2 |

## 9. Testing

In the plugin repo, with Node's built-in runner (`node --test`), no dependencies.

1. **Unit tests**, one file per module, covering: 70 bar (69/70), 150 characters (149/150), Gherkin
   exemption, vague words in both formats, headings and the criteria field, HTML comments, mixed
   sections, every fill-in answer type, the Jira payload, every config error, setup detection.
2. **Parity tests**: the saved warehouse tickets, all self-test fixtures of today's two scorers and
   the shared-rule cases from the frontend/backend alignment check (rebuilt as a test file), run through the current scripts and through the core with warehouse's
   config (one config per repo). Outputs must match exactly: score, gate, missing items, fill-in
   results, comment text, JSON lines. Only the differences listed in §10 are allowed, each with a
   named test.
3. **Fixtures are redacted on import**: no customer id (one is present in a backend eval today) enters
   the plugin repo. A test fails if any fixture matches the redaction patterns.
4. **CI**: a GitHub Actions job runs `node --test` and checks every JSON manifest on each push.

## 10. Deliberate differences from today (the only allowed parity breaks)

1. Docs that say 60 say 70 (ticket-eval command, backend CHECKS / SKILL / REPORT / templates).
2. The backend no longer accepts a bare `warehouse` label as a feature label (its own templates
   already say not to use it).
3. The frontend gate now sanitizes tickets too, as the backend does; the frontend `harvest.json`
   (raw, unredacted) is replaced by `ticket.json` (redacted).
4. Refuse-comment, fill-in and template-line texts come from `messages` in config; warehouse's
   config carries today's texts, so warehouse output is unchanged.
5. The backend rubric key `warehouse_label` is named `feature_label`, as in the frontend. The skills
   read keys from the fill menu, so nothing breaks; the JSON key name changes.

## 11. Out of scope for part 1

Writing tests, the post-write checks, switching the warehouse repos, the sample project, the new
README, languages other than English and Italian, stacks other than Playwright and Vitest, run
logging (unchanged, AGT-34).

## 12. Acceptance criteria

```gherkin
Scenario: no warehouse value is left in the core
  Given the files under plugins/agentic-testing/core/
  When they are searched for FIC, the 8 warehouse labels, teamsystem.atlassian.net and customfield_11707
  Then nothing is found

Scenario: warehouse behaves exactly as before
  Given warehouse's two config files
  When the parity tests run
  Then every output matches today's scripts except the differences listed in §10

Scenario: a new project is set up without editing files
  Given a repo with Playwright or Vitest and no config
  When /agentic-testing:setup is run and the preview is confirmed
  Then .claude/agentic-testing.json is written, passes config check, and a real ticket is scored

Scenario: a broken config stops the run with a clear message
  Given a config whose jira.projects is "fic"
  When ticket-eval runs
  Then it stops before scoring and names jira.projects and the expected format
```
