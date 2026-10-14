# Changelog

What changed in each version of the `quality-code` plugin, newest first, and what you have to do
when you update. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
plugin uses [semantic versioning](https://semver.org/) (before 1.0, a minor version can break
things, and says so here).

Update with `/plugin update quality-code@quality-code`.

## [0.3.2] - 2026-10-14

### Changed

- **Setup is short.** It asks only for the connectors, where the project lives (folder, stack, GitLab
  project from the `origin` remote) and the Jira project. Everything else has a default.
- **The acceptance-criteria field is found when a ticket is checked**, by its name, the first time a
  ticket of that project is checked by `/quality-code:start` or `/quality-code:ticket-eval`. It is
  remembered on your machine in `.claude/quality-code/jira-fields.json` (git-ignored). A field named
  in the config still wins.
- In the config, `languages` (default English and Italian), `features` (default none) and
  `jira.acceptanceCriteriaField` are now optional.

### Added

- `/quality-code:setup advanced`: the questions the short setup leaves out (projects to track,
  feature labels, routes, QA plans, Confluence spaces, title prefixes, languages, redaction,
  templates).

### Upgrade

Nothing to do: existing configs keep working as they are.

## [0.3.1] - 2026-10-14

### Added

- GitLab and Figma can each be reached in two ways: **sign in in the browser** (connectors `gitlab`
  and `figma`) or **a token** (`gitlab-token` with a `read_api` personal access token,
  `figma-token` with a Figma access token). One way is enough. The connectors card in `setup` and
  `start` checks both and shows the steps for each.
- Figma browser sign-in uses Figma's own connector (`https://mcp.figma.com/mcp`).

### Changed

- GitLab now runs through a pinned, read-only connector (`@zereight/mcp-gitlab` 2.2.5) against your
  GitLab's normal API. The old `gitlab_mcp_url` setting is gone: TeamSystem's GitLab has no MCP
  endpoint, so it never connected. New settings: `gitlab_api_url` (default TeamSystem's GitLab),
  `gitlab_oauth_client_id` (browser sign-in) and `gitlab_token` (secret).
- The Figma token connector is pinned (`figma-developer-mcp` 0.13.2).

### Removed

- The marketplace no longer carries the `warehouse-frontend` and `warehouse-backend` plugins:
  `quality-code` is the one plugin for every team. Teams that used them install `quality-code`
  instead.

### Upgrade

- After `/plugin update`, set either `gitlab_oauth_client_id` or `gitlab_token` from the `/plugin`
  menu (quality-code, configure) if you want GitLab, then `/mcp`. For Figma, sign in with `/mcp`, or
  keep using your `figma_api_key` (now the `figma-token` connector).

## [0.3.0] - 2026-10-14

**Breaking: the plugin is renamed from `agentic-testing` to `quality-code`.** The old names are no
longer read.

### Changed

- Plugin and marketplace: `agentic-testing` → `quality-code`. Install with
  `/plugin install quality-code@quality-code`.
- Commands: `/agentic-testing:setup`, `:start`, `:ticket-eval` → `/quality-code:setup`, `:start`,
  `:ticket-eval`.
- Team config: `.claude/agentic-testing.json` → `.claude/quality-code.json`.
- Local ticket copies: `.claude/agentic-testing/tickets` → `.claude/quality-code/tickets`.
- JSON schema: `schema/agentic-testing.schema.json` → `schema/quality-code.schema.json`.
- The line added above a fill-in pushed to Jira now reads
  `_Added during the quality-code readiness check._` (teams that set `messages.jiraFillMark` keep
  their own text).

### Not changed

- The marketplace address is still `vissz28/agentic-testing`.
- Scores, the 70-point bar, the rubrics and every other behaviour are the same as in 0.2.1.

### Upgrade

Once per person:

```
/plugin uninstall agentic-testing@agentic-testing
/plugin marketplace remove agentic-testing
/plugin marketplace add vissz28/agentic-testing
/plugin install quality-code@quality-code
```

Then, in each repo that was set up:

1. Run `/quality-code:setup`. It writes `.claude/quality-code.json`; commit it.
2. Delete `.claude/agentic-testing.json`, the `.claude/agentic-testing/` folder and its
   `.gitignore` line.
3. In the repo's `.claude/settings.json`, rename the `agentic-testing` marketplace key and the
   `enabledPlugins` entry to `quality-code` (the README's Install section shows the new block).

## [0.2.1] - 2026-10-14

### Added

- `/agentic-testing:start`, the daily command: checks the connectors, shows the repo card (branch,
  base branch, files changed, committed and not), takes the ticket key from the branch name (or the
  merge request title, or the commit subjects), and evaluates that ticket. The changes never affect
  the score. Running the full pipeline from it comes with the Vitest adapter.
- Connectors check, the first step of both `start` and `setup`: Jira (required), GitLab and Figma
  (optional, never blocking; Figma only for Playwright repos), with the fix for each. Keys are set
  in the plugin settings, never typed in the chat.
- `core/branch.mjs`: reads local git only (no network, no writes), redacts paths and commit
  subjects, strips credentials from the remote URL, and works in a project inside a subfolder of a
  larger repo. Base branch: the open merge request's target, else `origin/HEAD`, else `develop`,
  `main` or `master`.

### Documentation

- README rewritten for every team: quick start, supported projects, capabilities, roles. The
  warehouse-only pages moved out of the README.

## [0.2.0] - 2026-10-12

First release of the reusable plugin (then called `agentic-testing`), for any Jira project and any
repo with Playwright or Vitest.

### Added

- `/agentic-testing:setup`: detects the stack, asks about Jira (site, projects, criteria field,
  feature labels, title prefixes, Confluence spaces, languages, redaction, templates) one numbered
  card at a time, writes `.claude/agentic-testing.json` only after you confirm, and proves the setup
  on one recent ticket.
- `/agentic-testing:ticket-eval <KEY>`: the readiness gate. A script scores the ticket out of 100;
  70 passes, for every team. Acceptance criteria count as Gherkin or as at least 150 characters of
  plain language; vague results ("works correctly") lose points.
- On a refused ticket: a Jira comment listing what to add (preview first), a guided fill-in where
  the script decides whether each answer counts, and an optional push of the filled-in parts to
  Jira (append only, preview first). `--ci` comments and fails without asking.
- Redaction of customer ids, e-mails, UUIDs and your own patterns before anything is scored.
- English and Italian ticket keywords.
- A parity suite proving the same results as the original warehouse scripts on 116 real tickets.
