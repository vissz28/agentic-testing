# Quality Code: review and recommendations

Written 2026-11-01 against plugin 0.33.0 (main at `0558fc5`) and the Central Context branch
`feat/central-context-rules` (vissz28/agentic-testing#14). A document of recommendations, not a plan: nothing here is
implemented.

## Summary

The plugin is sound where it matters and heavy where people meet it. The grading is right: scripts decide, the model only drafts and relays, a hook stops writes to application code, and since this week every run names the Central Context rules it answered to. What costs adoption is the surface: 17 commands, 11 flags on `spec` alone, a setup of 12 cards, and 40,000 words of instructions the model must follow word for word.

Three changes carry most of the gain:

1. **One door.** A single `/quality-code` command that reads the situation (no config, a ticket key, a feature branch, nothing) and does the right thing; the 17 names stay as aliases for a while, then go.
2. **Four flags, not thirty.** On `spec`, keep the key, `--dry-run`, `--ci` and `--yes`; everything else becomes an option on a card or a line in the config.
3. **Setup in one card.** Detect everything, show one confirm card, write. Connectors are checked the first time a command needs them, not up front.

The measure of success: a new developer goes from install to a first green card in under ten minutes and answers no more than four cards on the way. Today that path crosses about ten.

## What a person meets today

Seventeen commands under `/quality-code:`, each a Markdown file the model follows step by step, backed by 3,600 lines of scripts in `bin/` and 9,700 in `lib/`. The commands and guides together are 40,589 words. Three files hold 44 percent of that: `setup.md` (6,587 words, 12 cards), `spec.md` (6,095 words, 10 points where the turn ends) and `ticket-eval.md` (5,423 words).

| Role | Commands they are sent to | Flags they see on the way |
| --- | --- | --- |
| Developer | `setup`, `spec`, `run-pipeline --branch`, `seed`, `ci` | `spec`: `[KEY] [--gate-only] [--base] [--layer] [--target] [--route] [--no-extras] [--flow] [--yes] [--dry-run] [--ci]` |
| QA | `setup`, `ticket`, `ticket-eval`, `xray`, `qa`, `routine` | `ticket`: seven filter forms; `routine`: a cron grammar in the hint |
| Product owner | `setup` (Jira only), `tickets-eval`, `ticket-eval` | `tickets-eval`: `--user --status --limit --all --json` |
| Team lead | `setup`, `ci`, `kpi`, `consumption`, `config`, `check-update` | date ranges, `--by`, `--prices` |

Three groups of commands do one job each under several names: `run-frontend`, `run-backend` and `run-pipeline` differ only by which specs they take (94, 94 and 82 words each, the rest shared in `guides/run.md`); `ticket`, `ticket-eval` and `tickets-eval` all read and score tickets; `kpi` and `consumption` both read the local audit log for a period.

A first run in a fresh repo passes these stops before a test exists: install and plugin settings (ten of them), the connectors one at a time, the Where card, the project confirm card, the first `spec` gate, the plan card, the result card, the read-back card, and then the save-place card asking where files should live. About ten answers. The onboarding guide promises 15 minutes; the setup text alone is longer than this review.

## What works and must not be lost

- **The model never grades.** Scores, verdicts and counts come from `ticket.mjs` and `pipeline.mjs`; the command text repeats the rule in every file. This is the plugin's whole credibility and the reason the Central Context record can be trusted.
- **The boundary hook.** A `PreToolUse` hook denies writes outside test folders, so a bad run cannot touch application code. Enforcement, not instruction.
- **The refuse card leads with the cheapest fix.** `To pass:` names the fewest missing items that reach 70, and the fill-in is driven by the script, item by item, with a Jira preview before anything is posted.
- **Honesty checks on the diff.** Removed assertions, removed tests, skips without a ticket, hollow tests: caught by static analysis, in the pipeline and in CI.
- **One pipeline, six runners.** Vitest, pytest, JUnit, Go, .NET and Playwright share the checks and the card; a team changes `adapter`, nothing else.
- **Provenance.** Every run now records which rules, which status, which release, on the card, in `run.md` and in the audit log; the chat prints what came from Central Context in a labelled block.
- **Tests on the instructions themselves.** `test/commands/*.test.mjs` assert what the command texts say (the three pauses, the neutral keys, the card shapes). Few plugins have this.
- **CI in two jobs.** A gate in seconds on the changed specs, the tests and mutation after; the file is generated for the repo's toolchain.

## Friction found

Each row is a place a person stalls, with where the text causes it.

| Who | Where they stall | Evidence | Cost |
| --- | --- | --- | --- |
| Everyone | Choosing among 17 names before knowing what they want | the README needs three role flowcharts to explain which command to type | the first question is the wrong one: which command, not which ticket |
| Developer | `spec` flags | 11 flags; `--layer`, `--target`, `--route`, `--no-extras` are choices the plan card could offer; `--gate-only` duplicates `ticket-eval`; `--flow` is config | flags read like a tool, not a colleague |
| Developer | Three run commands | `run-frontend`, `run-backend`, `run-pipeline` differ by suite only | the name must be learned before the first run |
| Developer | Waiting with no signal | step 6 prints one line, then minutes of silence until the card | people assume it hung and start again, which trips the run marker |
| QA | `ticket`, `ticket-eval`, `tickets-eval` | three entry points for reading and scoring; `ticket` shows tips "never posted", `ticket-eval` offers the post | which one to type for a ticket in hand |
| QA, PO | The fill-in | list card, pick line, all-at-once card, drafts from the ticket, drafts from Figma, re-score, Jira update card; cap-2 rules in three places | the longest flow in the plugin; text is 1,400 words for one interaction |
| First-time | Setup | 12 cards; connectors one at a time; a Where card before anything is detected; a Playwright card asks for the app command and the address | the onboarding guide says 15 minutes; the text alone is 6,600 words |
| First-time | Save-place card after the first run | appears after the first `spec`, `run`, `xray` or `seed`, once per project per person | an unexpected question at the moment of success |
| Everyone | Machine lines | the model must drop `GATE_JSON:`, `PIPELINE_JSON:`, `SAVED_JSON:` and five more from what it shows | when it forgets, the user sees JSON; a script-side quiet flag would end it |
| Everyone | Two sources of truth for the bar | the plugin says 70 everywhere; the warehouse Bug template still says 60 (`onboarding-quality.md`) | a team argues with the gate |
| Everyone | Docs drift | `GETTING_STARTED.md` says Playwright "comes in a later version" and lists a GitLab Application ID that the settings no longer have | the first page a person reads is stale |
| Maintainer | Prose as program | 6,000-word command files encode branching logic the model must execute; tests pin the wording, which protects it and also freezes it | every improvement is a rewrite of a long file |

No audit event exists yet in the warehouse repo apart from this week's proof run, so these are read from the texts and from running them, not from usage data. The audit log is where the usage data will come from.

## Recommendations, ranked

Quick wins are text and routing changes with no new script logic; medium changes move logic from prose into scripts; larger moves change what the plugin is. Items 6, 8, 9, 10, 15, 16, 18 and 20 come from Anthropic's skill-writing guidance, held against the plugin in the section below.

### Quick wins (days)

1. **One door: `/quality-code`.** With no config it runs setup. With a key it runs `spec`. On a feature branch with no key it takes the branch's ticket. With nothing, it shows four lines: check a ticket, write tests, run the checks, set up. The 17 names stay as aliases for two releases.
2. **Merge the three run commands into `run`.** `run` takes spec paths, `--branch`, or nothing for the whole project; the side comes from the specs. Same for `ticket`: show and score in one command, since scoring is cheap and the score is what QA wants anyway. `tickets-eval` becomes `ticket <PROJECT>`.
3. **Cut `spec` to four flags.** Keep `KEY`, `--dry-run`, `--ci`, `--yes`. Move `--layer`, `--target`, `--route`, `--no-extras` to option 2 of the plan card, where they already have a home. Drop `--gate-only` (that is `ticket`). Move `--flow` and `--base` to the config.
4. **Kill the save-place card.** Default to the repo's git-ignored folder; the choice stays in `config`.
5. **Quiet flag on the scripts.** `--quiet` (or default when stdout is not a TTY) prints the card without the machine lines; the model reads them from a file or a second call. Nine "drop this line" rules disappear from the texts.
6. **Fix the docs that lie.** `GETTING_STARTED.md`, the settings list, the 60 percent in the warehouse Bug template, the "later version" note. Anthropic names time-sensitive text as an anti-pattern for the same reason.
7. **Progress lines while the pipeline runs.** The script already knows when each check ends; print one line per check as it finishes so the chat moves.
8. **The three non-negotiables in the first 20 lines of every command.** The model never grades, never changes application code, never posts to Jira without a preview. After context compaction only the start of a skill survives, so what is deep in step 8 is lost first.
9. **Descriptions of one sentence of what and one of when.** Several are over 400 characters; the listing caps description plus when-to-use at 1,536 and drops the least-used skills' descriptions first. With one door, most commands no longer need to trigger on their own.

### Medium changes (weeks)

10. **Move decisions from prose to scripts.** Every place the text says "when X in the JSON, show card Y" is a script's job: `ticket.mjs score --card` prints the exact card, the model shows it. Target: no command file over 1,500 words, `spec.md` under 2,000. Anthropic's rule is the same: prose for open work, scripts for fragile sequences, and a SKILL.md under 500 lines. The tests on the texts then shrink to "the script's card is shown unchanged".
11. **One card grammar.** Every card: one title line, at most three numbered options, the same numbers for the same meaning (1 go on, 2 change, last stop). Today cards have two to four options and `Stop` sits at 2, 3 or 4.
12. **Setup in one card.** Detect stack, folder, base branch, Jira site from the remotes and the repo; show one confirm card; write. Connectors are checked the first time a command needs one, with the sign-in link at that moment. `advanced` becomes items of `config`.
13. **A status line on every card.** `FIC-1234 · gate 82/100 · rules dir-632b` as the first line of the plan card and the result card, so a screenshot of any card says where it came from.
14. **Shorten the fill-in.** One card: the missing items with their points, type the numbers, then one question per item. Drop the separate pick line and the all-at-once card; keep the drafts, offered as the default answer.
15. **A hook on Jira posts.** "Never post without a preview" is text today; the boundary is a hook. A `PreToolUse` hook on `addCommentToJiraIssue` and `editJiraIssue` that denies the call unless the script left a preview marker for that key makes the rule hold every time, which is what Anthropic says a hook is for.
16. **A routing table and a pitfalls list per runner.** `spec.md` explains Vitest, Playwright, pytest, JUnit, Go and .NET inline. The `docx` skill shows the better shape: one table of adapter to what differs, and a short list of pitfalls per runner in `guides/`, because the model already knows the frameworks.

### Larger moves (a quarter)

17. **Team profile as a file, not a setup dialogue.** A `profiles/<team>.json` in the plugin repo per adopting team (the `docs/rollout/` files are already this); `setup` offers the profile that matches the remote. New repos of a known team need no questions.
18. **Scenario evals on the commands, on two models.** `claude plugin eval` cases per command: a refused ticket, a borderline one, a red bug, a hub down; each case runs with and without the plugin and reports the delta. Run them on Sonnet and Haiku before telling teams which model to use. Today the texts are tested for wording; the behaviour is tested by people.
19. **Rules as the source of the card wording.** The `Central Context:` lines and the refuse card's reason come from the rule's summary on the hub, not from the command text, so a rule change changes what people read without a plugin release.
20. **Write up the TeamSystem pattern.** Stop-and-wait cards with numbered options, and tests on the instruction text, have no published equivalent in Anthropic's guidance. A two-page authoring guide in `docs/` makes them the rule for the next plugin and for HoT's own skills.

## A simpler command set

From 17 commands to 9, with one entry point. Nothing is removed from what the plugin can do; names and flags are folded into cards and config.

| Today | After | How the old use is reached |
| --- | --- | --- |
| (none) | `/quality-code` | reads the situation: setup, spec, or a four-line menu |
| `setup`, `config`, `check-update` | `setup` | one confirm card; `config` items for later changes; update offered when a new version exists |
| `ticket`, `ticket-eval`, `tickets-eval` | `ticket <KEY \| PROJECT \| filter>` | a key scores and shows; a project scores the list; filters find |
| `spec` (11 flags) | `spec [KEY] [--dry-run] [--ci] [--yes]` | layer, target, route, extras: option 2 on the plan card; gate alone: `ticket` |
| `run-frontend`, `run-backend`, `run-pipeline` | `run [specs \| --branch]` | the side follows the specs; nothing given on a branch means `--branch` |
| `seed` | `seed <KEY>` | unchanged |
| `xray`, `qa` | `xray <KEY>`, `qa [KEY]` | unchanged; `xray --sync` stays |
| `routine` | `routine` | a card asks when, instead of a cron grammar in the hint |
| `ci` | `ci` | the provider is detected from the remote; `--print` stays |
| `kpi`, `consumption` | `report [--since]` | one card with the KPIs on top and the cost table under it |

The daily path for a developer becomes two commands: `/quality-code` on the branch, then `run` before pushing. For QA: `ticket`, then `spec` or `xray`. For a product owner: `ticket ABC`.

Two things stay deliberately separate: `seed` (it writes to a database) and `qa` (it drives a browser), because each needs its own confirmation and its own failure modes.

## Cards and wording

The cards are the product. People never read the command files; they read a card and type a number. Today's cards are good one by one and inconsistent as a set.

**Keep as they are.** The refuse card with its `To pass:` line on top. The plan card (one line per scenario, the result it checks). The result card from `pipeline.mjs`, now with its `Rules:` line. The Jira preview before any post. The read-back with `That's not what I see in the app`.

**Cut.**

- The save-place card (a default and a config item instead).
- The Where card in setup (a repo is detected or it is not).
- The two "Not now" scaffold cards in setup (one card: add the runner, or not).
- The pick line in the fill-in (typing the numbers is the pick).
- The app line before Playwright runs (print it only when the app is not reachable).
- `Running the checks: tests, assertions, types, expected values and mutation; this can take a few minutes.` Replace with progress lines from the script.

**Make the same everywhere.**

- Option numbers mean the same thing on every card: 1 is go on, 2 is change something, the last is stop. Today `Stop` is option 2, 3 or 4 depending on the card.
- At most three options. A card with four is two decisions; split it or drop one.
- One title line, then the choices, then any note. The 🔴 risk line stays first when present.
- A status line on the plan and result cards: `<KEY> · gate <score>/70 · rules <release>`.
- Words a person uses, not the plugin's: "the result the ticket expects", not "expected tokens"; "a test that checks nothing", not "hollow". The texts already do this in most places; the card from `pipeline.mjs` still says `assertions` for suite honesty and `mutation 1/1 mutants killed`.

**Language.** The rule "talk in the user's language, cards stay as printed" is right. It needs one addition: the `Central Context:` lines and the `From Central Context` block print the hub's summary as returned, in English, until the hub carries Italian text (planned for hub v2.3.0); the card says so in one line the first time.

## Setup and configuration

The config has 31 top-level fields; a team needs about six. The rest are defaults that `setup` writes out, which is why the warehouse file is 190 lines and why every rollout starts with a copy of it.

**What setup should do.**

1. Detect: the stack from `package.json` and the lock file; the project folder (or `root`); the base branch from the remote's HEAD; the Jira site and project keys from branch names and commit messages; the Git provider from the remote URL.
2. Offer the team profile when the remote matches one in the plugin (`docs/rollout/` today, `profiles/` tomorrow).
3. Show one card with the detected values and `1. Write it  2. Change something  3. Cancel`.
4. Write the config with only the fields that differ from the defaults, and the `.gitignore` lines.

Two minutes, one card, one commit. Connectors are not part of setup: the first command that needs Jira checks the connector and shows the sign-in link then. A Figma or GitLab connector is checked only by the commands that use it.

**The config file.** Write the minimum. The warehouse config could be:

```json
{
  "version": 1,
  "adapter": "vitest",
  "profile": "warehouse",
  "jira": { "site": "https://teamsystem.atlassian.net", "projects": ["FIC"] },
  "centralContext": { "hub": "http://localhost:8080" }
}
```

with the layers, boundaries, messages and seed commands coming from the `warehouse` profile in the plugin. A team that wants to differ adds the field; the schema stays as it is.

**Plugin settings.** Ten `userConfig` entries at install time is the first thing a person meets, before they know what the plugin does. Keep the two that unlock the daily path (`jira_email`, `central_context_url`) and ask for a GitLab, Figma or Xray value the first time a command needs it, through `config`.

**Two bars, one number.** The gate is 70 in the plugin; the warehouse Bug template says 60. Put the number in one place the templates can read, or state in the template that the plugin's card is the authority.

## Central Context in the skill

This week's integration is the right shape: the plugin cites three rule ids, the pipeline reads their text from the hub and records id, status and release with every verdict, and the chat shows what came from the hub in a labelled block. What follows is what to change once the first demo is done.

- **Read once per session, not once per run.** `spec` reads the three rules over MCP before the gate and the pipeline reads them again over REST. Keep the pipeline's read (it is the record), but cache the model's block per session so a developer who runs three tickets sees it once, with the release id, and a one-line `Central Context: release unchanged` after.
- **Rules drive the wording.** The `Central Context:` lines under the refuse and plan cards are hard-coded sentences today. Take them from the rule's `summary` as the hub returns it, so a wording change in the knowledge repository changes the card without a plugin release.
- **Say what a status means.** A `draft` rule is not served over MCP, so the model sees `missing on the hub` while REST with `include_draft` sees the draft. The card should distinguish "draft, not yet binding" from "unknown to the hub"; the pipeline can ask REST with `include_draft=true` and label it.
- **Deprecated rules.** When the hub returns `deprecated` with `superseded_by`, the record should name the successor and the plugin should move its id in the next release. Today it would print `deprecated` and carry on.
- **The hub address belongs to the team profile.** `centralContext.hub` is one value per team: the local preview during the pilot, HoT's hosted address after. A profile carries it so no developer edits a config when the hub moves.
- **Floors stay in the rules.** The gate's 70 and the mutation threshold are plugin constants. If a team asks to lower them, the answer is a rule in Central Context that states the floor, read by the plugin, not a config knob. The provenance already makes a lowered threshold visible; the rule makes it refusable.
- **Search for the why.** When a check fails, the card could end with `Why: <rule summary>` from `get_knowledge_document`, and `search_knowledge` is the right tool when a developer asks "is there a rule on X". Both are one call on a connector that is already there.
- **Keep the snapshot honest.** The pinned snapshot is a fallback, not a cache: refresh it in every plugin release from the hub's active release, and have a test fail when a pinned rule's status no longer matches the hub.

## How great skills are written

Anthropic's own guidance, read on 2026-11-01, and what it says about `quality-code`. Sources: the Claude Code skills page, the Agent Skills best-practices guide, the plugin evals page and the `anthropics/skills` repository.

| Guidance | Source | quality-code today | Gap |
| --- | --- | --- | --- |
| Keep SKILL.md under 500 lines; move detail one level down into referenced files | [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | `setup.md` 6,587 words, `spec.md` 6,095, `ticket-eval.md` 5,423; the published `pdf` skill is about 1,350 words, `docx` about 1,100 | three files are four to six times the size of Anthropic's largest consumer skills |
| Assume the model is capable; challenge every paragraph for its token cost | [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | the texts spell out how to read each JSON line and which card follows | the model is treated as an interpreter; a script printing the card removes most of it |
| Match specificity to fragility: prose for open work, scripts for fragile sequences | [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | the grading is in scripts (right); the card routing is in prose (fragile) | move routing into the scripts, keep judgment in prose |
| Put key rules first: after compaction only the start of a skill survives | [skills page](https://code.claude.com/docs/en/skills.md) | the Rules block is at the top of each command (right); the pauses and Jira safety are deep in the steps | repeat the three non-negotiables in the first 20 lines |
| Rules that must hold every time belong in a hook, not in text | [skills page](https://code.claude.com/docs/en/skills.md) | the boundary is a hook (right); "never weaken a test" and "never post without preview" are text | a hook on `addCommentToJiraIssue` without a preview marker would close the second |
| Descriptions in third person, what and when, with the words users type; put the key case first | [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | descriptions are long and complete, some over 400 characters | shorten to one sentence of what plus one of when; the one-door command makes most of them unnecessary |
| Anti-patterns: too many options, magic numbers, time-sensitive text, scripts that defer errors to the model | [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | 11 flags on `spec`; `70` and `60` as literals; "comes in a later version" in the getting-started guide; the cap-2 retry rules live in prose | each is named above as a quick win |
| Evaluation-driven development: about three scenarios, a baseline without the skill, then minimal text; `claude plugin eval` runs cases three times with and without the plugin | [plugin evals](https://code.claude.com/docs/en/plugin-evals.md) | tests pin the wording of the texts; no scenario eval exists | add `evals/` with a refused ticket, a red bug and a hub-down case, run in CI |
| Test with every model you plan to use | [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | written and tried against one model | run the evals on Sonnet and Haiku before telling teams which to use |
| The `docx` skill: a task-to-approach routing table and a list of pitfalls only, because the model knows the API | [anthropics/skills](https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md) | `spec.md` explains Vitest, Playwright and five backends inline | one routing table (adapter, what differs) plus a pitfalls list per runner in `guides/` |

Two things the guidance does not cover, where the plugin is ahead of it: there is no published pattern for stop-and-wait cards with numbered options, and none for testing the instruction text itself. The plugin's `end the turn` convention and its `test/commands/*.test.mjs` are worth writing up as the TeamSystem pattern.

The one place the sources disagree: the Claude Code page says state what to do rather than why; the skill-creator skill says explain the why and treats all-caps MUSTs as a warning sign. The sensible reading for this plugin: state actions directly, give the reason only where the model has a judgment call, and keep the obligations in scripts and hooks.

## Order of work

Four steps, each shippable on its own, each with the number that says it worked. The measures come from the audit log the plugin already writes (`gate`, `pipeline`, `jira`, `override`, `fill` events) plus two events to add: a card shown and a card abandoned.

1. **Fix what lies and what repeats.** Docs drift, the 60 versus 70, the save-place card, the quiet flag on the scripts, progress lines. Measure: zero `JSON:` lines seen in a sample of ten transcripts; the first-run path drops from about ten answers to seven.
2. **One door and nine commands.** `/quality-code` routing, `run` merged, `ticket` merged, `spec` down to four flags, aliases kept. Measure: the README's three flowcharts become one; time from install to first green card under ten minutes for a new developer, timed on two people.
3. **Scripts print the cards.** `ticket.mjs` and `pipeline.mjs` emit the exact card text; the command files shrink to rules, steps and the card to show. Measure: no command file over 1,500 words; the wording tests move from "the text says" to "the script's card is shown unchanged".
4. **Profiles and evals.** Team profiles in the plugin, setup in one card, `evals/` with three scenarios run in CI on two models. Measure: a new repo of a known team set up in one card; eval delta positive on all three cases.

After the first demo and before step 2, one week of real use by two developers and one QA on the warehouse repo, with the audit log read at the end, so the order above is confirmed by what people actually did rather than by this reading of the texts.

## Method

Read in full: the 17 command files and 10 guides of `plugins/quality-code` (40,589 words, counted with `wc -w`), `README.md`, `docs/GETTING_STARTED.md`, `docs/ONBOARDING.md`, `docs/GUIDE.md` (config table), `docs/rollout/`, the schema, `lib/base/config.mjs`, `lib/base/audit.mjs`, `lib/pipeline/pipeline.mjs` and `card.mjs`, `bin/pipeline.mjs`, the command tests under `test/commands/`. Card and turn-end counts come from the `end the turn` and fenced-block markers in each file.

Run: `npm test` on the plugin (2,133 tests), `bin/pipeline.mjs` on a warehouse spec against the local hub, `ticket.mjs config check` on the warehouse config, the install through `claude plugin marketplace add` and `claude plugin install`.

Not available: usage data. The warehouse audit log held no events before this week, so the friction table is a reading of the texts and of one person's runs, not a measurement. The research on skill authoring was done by a delegated agent against the pages linked in that section, on 2026-11-01.
