# agentic-testing

A Claude Code plugin marketplace with two plugins that turn a FIC Jira ticket into real, graded
tests for the warehouse apps:

| Plugin | For | What it writes |
|---|---|---|
| `warehouse-frontend` | `warehouse-frontend` | Playwright spec + XRay test case |
| `warehouse-backend` | `warehouse-backend` | Live-database Vitest specs (unit, integration, range) |

The AI writes the tests; it never grades them. A readiness gate scores the ticket before anything is
written, and deterministic scripts check the tests afterwards.

The plugins carry the **Claude side** of the solution: the skills, the slash commands, the Jira /
Figma / GitLab connectors and (frontend) the write-boundary hook. The **harness scripts stay in each
repo** under `.claude/harness/`, versioned with the code they test, so the repo you open must be on a
branch that has them (`agentic-testing-fe` / `agentic-testing-be`, or a branch merged from them).

## Install

Inside Claude Code, in the warehouse repo you work on:

```
/plugin marketplace add vissz28/agentic-testing
/plugin install warehouse-frontend@agentic-testing
```

(or `warehouse-backend@agentic-testing` in the backend repo). The repo is private, so your git must
already be able to clone it: a GitHub login in the macOS keychain, `gh auth login`, or an SSH key.

From a shell, the same thing:

```bash
claude plugin marketplace add vissz28/agentic-testing
claude plugin install warehouse-frontend@agentic-testing --scope project
```

To have it offered to everyone who opens a repo, add this to that repo's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "agentic-testing": { "source": { "source": "github", "repo": "vissz28/agentic-testing" } }
  },
  "enabledPlugins": { "warehouse-frontend@agentic-testing": true }
}
```

### Connectors

- **Jira (Atlassian)**: both plugins. Sign in through the browser the first time a skill reads a ticket.
- **Figma**: frontend. Set `FIGMA_API_KEY` in your environment. Without it, behavioural tests still
  work; only the design side-by-side is skipped.
- **GitLab**: frontend. Used for MR diffs when the instance has MCP enabled; optional.
- **Docker**: backend. The tests run against a real Postgres container.

## Commands

| Frontend | Backend | What it does |
|---|---|---|
| `/warehouse-frontend:spec-frontend FIC-…` | `/warehouse-backend:spec FIC-…` | Full run: gate → tests → checks → result card |
| `/warehouse-frontend:ticket-eval FIC-…` | — | Readiness check only |
| `/warehouse-frontend:seed FIC-…` | `/warehouse-backend:seed FIC-…` | Test data only (frontend: API stubs; backend: local DB rows) |
| `/warehouse-frontend:playwright FIC-…` | `/warehouse-backend:unit` / `:integration` / `:range` | One output only |
| `/warehouse-frontend:xray FIC-…` | `/warehouse-backend:ticket FIC-…` | XRay case only / ticket overview |
| — | `/warehouse-backend:check` | Real failure or flaky? Re-runs a failing test |

How to use them, step by step, is in [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Updating the plugins

The skills and commands are copied from the repos, which stay the source of truth:

```bash
scripts/sync-from-repos.sh                               # from origin/agentic-testing-fe and -be
BE_REF=origin/agt-34-remove-audit-logs scripts/sync-from-repos.sh   # another ref
claude plugin validate . && claude plugin validate plugins/warehouse-frontend && claude plugin validate plugins/warehouse-backend
```

Bump `version` in the plugin's `.claude-plugin/plugin.json`, commit, push; users get it with
`/plugin update`.
