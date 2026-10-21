<p align="center">
  <img src="docs/brand/wordmark.svg" alt="Quality Code: from Jira ticket to tests you can trust" width="640">
</p>

<p align="center">
  <a href="https://github.com/vissz28/agentic-testing/actions/workflows/test.yml"><img src="https://github.com/vissz28/agentic-testing/actions/workflows/test.yml/badge.svg" alt="tests"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-0090D1" alt="Claude Code plugin">
  <img src="https://img.shields.io/badge/Vitest%20%C2%B7%20Playwright-005075" alt="Vitest and Playwright">
</p>

# Quality Code

**From Jira ticket to tests you can trust, inside Claude Code. One plugin for every team at TeamSystem.**

## Overview

Quality Code connects your Jira tickets to your test suite. It checks that a ticket is clear enough
to test, helps its author fill the gaps, writes tests from the ticket's acceptance criteria, and
grades them. It works with any Jira Cloud project and any repo that uses **Vitest** (backend),
**Playwright** (frontend) or both (fullstack). Your application code is never changed.

> **The rule everything is built on:** the model reads, drafts and writes, but it **never grades**.
> Every score and every pass/fail comes from a deterministic script.

## Features

| Feature | Command |
|---|---|
| **Readiness gate:** scores a ticket out of 100; 70 passes | `/quality-code:ticket-eval <KEY>` |
| **Gaps fixed on the spot:** a Jira comment listing what is missing, or a guided fill-in pushed to the ticket after a preview | `ticket-eval`, when a ticket is refused |
| **Daily start from your branch:** connectors, what the branch changed, the ticket from the branch name | `/quality-code:start` |
| **Tests written from the ticket:** Vitest and Playwright specs in your test folders, graded on the spot | `/quality-code:write <KEY>` |
| **Tests graded:** honesty, assertions, expected values, types, mutation, Stryker, flakiness | `/quality-code:check` |
| **Test data and QA cases:** seed builders or route stubs; XRay test cases to import | `/quality-code:seed <KEY>`, `/quality-code:xray <KEY>` |
| **Ticket lookup:** a ticket in short, with suggestions for its author | `/quality-code:ticket <KEY or words>` |
| **Numbers:** usage, Quality Program KPIs and AI cost, read locally | `/quality-code:kpi`, `/quality-code:consumption` |
| **CI gate:** refuses untestable tickets in the pipeline | `ticket-eval <KEY> --ci` |

## Installation

**Requirements:** Claude Code with plugin support, Node 18+, a repo whose `package.json` has
`vitest` or `@playwright/test`, and access to your Jira site.

In Claude Code, inside your repo:

```
/plugin install quality-code --marketplace vissz28/agentic-testing
```

On Claude Code older than 2.1.275, use two steps:

```
/plugin marketplace add vissz28/agentic-testing
/plugin install quality-code@teamsystem
```

**Offer it to everyone who opens the repo:** commit this in the repo's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "teamsystem": { "source": { "source": "github", "repo": "vissz28/agentic-testing" } }
  },
  "enabledPlugins": { "quality-code@teamsystem": true }
}
```

**Update** with `/plugin update quality-code@teamsystem`. What changed in each version is in the
[CHANGELOG](CHANGELOG.md).

## Quick start

1. **Set up the repo** (once, by one person). Answer the numbered cards, then commit the config it
   writes:

   ```
   /quality-code:setup
   ```

2. **Every day, start from your feature branch.** It finds the ticket from the branch name
   (`ABC-123-add-export`) and offers to evaluate it, check the branch's tests, or write tests for it:

   ```
   /quality-code:start
   ```

## Documentation

| Read | For |
|---|---|
| [Getting started](docs/GETTING_STARTED.md) | a step-by-step first run, for QA and developers |
| [Onboarding](docs/ONBOARDING.md) | bringing a team on board, with a team lead's checklist |
| [Guide](docs/GUIDE.md) | the full reference: every command, the readiness gate, the config file, connectors, privacy, troubleshooting, roadmap |
| [CHANGELOG](CHANGELOG.md) | what changed in each version, and what an update needs |
| [Brand](docs/brand/BRAND.md) | name, logo, colours and voice |

## Privacy

Tickets are redacted on your machine before they are scored. Nothing is written to Jira without a
preview and your yes. Tokens stay in your system keychain, never in the chat or the repository.
Details: [Guide, "Safety and privacy"](docs/GUIDE.md#safety-and-privacy).

## Support

Questions and problems: [issues](https://github.com/vissz28/agentic-testing/issues). Made by Elvis
Zefaj.
