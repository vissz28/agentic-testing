# Onboarding a team to quality-code

One page, about 15 minutes, from nothing to a first gated ticket. For the details of any step, the
[README](../README.md) and [Getting started](GETTING_STARTED.md) have more.

## Before you start

| You need | Check |
|---|---|
| Claude Code with plugin support | `claude plugin --help` works |
| Node 18 or newer | `node --version` |
| A repo whose `package.json` has `vitest` or `@playwright/test` | that is the stack the plugin will use |
| Access to your Jira site | you can open a ticket of your project in the browser |
| Read access to `vissz28/agentic-testing` | `git clone https://github.com/vissz28/agentic-testing` works |

## 1. Install (each person, once)

In Claude Code, inside your repo:

```
/plugin marketplace add vissz28/agentic-testing
/plugin install quality-code@quality-code
```

Then connect Jira: run `/mcp`, choose `atlassian-rovo`, sign in (an Atlassian connection you already
have in claude.ai works too). GitLab and Figma are optional.

## 2. Set up the repo (one person, once)

```
/quality-code:setup
```

Answer the numbered cards: the stack, the Jira site and project, the acceptance-criteria field. It
writes `.claude/quality-code.json` only after you confirm, then proves the setup on one recent
ticket. Commit the config and the `.gitignore` lines it adds. Run `/quality-code:setup advanced` later
for forbidden paths and, for Vitest, which config runs which tests and the test folders. A
Playwright project sets its `playwright` block by hand for now (see the README's config table).

To offer the plugin to everyone who opens the repo, commit the `.claude/settings.json` block shown in
the README's Install section.

## 3. The first ticket

```
/quality-code:ticket-eval ABC-123
```

A score out of 100; 70 or more is ready to test. Below 70 you can post a Jira comment that lists what
is missing, or fill the gaps on the spot. A ticket that passes on the first try is rare: the comment
is the point.

## 4. The first check

On a branch that changed some tests:

```
/quality-code:check
```

It runs the tests and grades them: no hollow test, no removed assertion, assertions that can fail.
The verdict is `green`, `checks failed`, `tests red` or `not verified`, decided by a script. For
Playwright, the app must be running, or your config's `webServer` must start it.

## 5. The first written test (Vitest)

```
/quality-code:spec ABC-123
```

Only for a ticket that passes the gate. It asks which code the ticket changes, shows the plan, writes
the tests in your test folders only, runs the checks and shows the card. Read the tests before you
commit them. On Playwright it asks which screen (or takes it from the feature's route).

From then on, every day: `/quality-code:spec` on your feature branch.

## Moving from your own harness

If the repo already has its own test-writing commands, skills or hooks:

1. Set up quality-code (step 2) and compare: run `ticket-eval` on a few recent tickets with both, and
   `check` on the same specs with both. Note any difference and why.
2. In one merge request, add the config and remove the old harness: its commands, skills, hooks,
   scripts and their lines in `CLAUDE.md`. Never keep two harnesses in one repo.
3. Replace a CI ticket gate, if you had one, with `/quality-code:ticket-eval <KEY> --ci`.

The warehouse repos' configs in [`rollout/`](rollout/) are worked examples.

## Checklist for a team lead

- [ ] Everyone has the plugin installed and Jira connected (`/quality-code:spec` shows ✅ Jira).
- [ ] `.claude/quality-code.json` is reviewed and committed; someone owns it.
- [ ] The forbidden paths cover your application code (default: `src/`, `.env`, `.env.*`, the CI file).
- [ ] For Vitest: the test folders are right (`vitest.layers`); Stryker is installed if you want its bar.
- [ ] A CI job runs `ticket-eval <KEY> --ci`, if you gate tickets in CI.
- [ ] The team knows where to report a surprise: an issue with the ticket key and the card.
- [ ] After a sprint, `/quality-code:consumption` shows what the runs cost.
