# Quality Code

From Jira ticket to tests you can trust.

Quality Code checks that a Jira ticket is clear enough to test, helps its author fill the gaps,
writes backend tests (Vitest, pytest, JUnit, Go or .NET) and Playwright tests from its acceptance criteria, and grades them with scripts, never
with the model. For frontend, backend and fullstack projects at TeamSystem.

## Install

```
/plugin install quality-code --marketplace vissz28/agentic-testing
```

On Claude Code older than 2.1.275: `/plugin marketplace add vissz28/agentic-testing`, then
`/plugin install quality-code@teamsystem`.

## Other platforms

| Platform | How | Status |
|---|---|---|
| **Claude Code** (CLI, desktop app) | the plugin: `/plugin install quality-code@teamsystem` | full support: every command, the boundary hook, `routine`, `check-update` |
| **GitHub Copilot** (VS Code) | `quality-code-mcp --init copilot --write`: MCP config and prompt files | every command except `routine` and `check-update`; not yet tried inside Copilot |
| **OpenAI Codex** (CLI, IDE) | `quality-code-mcp --init codex --write`: skills, plus a TOML for `~/.codex/config.toml` | same; not yet tried inside Codex |
| **Cursor** | `quality-code-mcp --init cursor --write`: MCP config and commands | same; not yet tried inside Cursor |
| **Gemini CLI** | `quality-code-mcp --init gemini --write`: an extension folder | same; not yet tried inside Gemini CLI |
| Other MCP clients (Windsurf, Cline, JetBrains, Claude Desktop) | `quality-code-mcp --print-config`, paste the JSON | the tools work; you start commands by asking for the tool |
| Any CI (GitHub Actions, GitLab CI) | `/quality-code:ci --init github\|gitlab`, or `node bin/ci.mjs` | no agent needed: the scripts grade |

The scripts (`bin/*.mjs`) are plain Node and grade the same everywhere. Outside Claude Code the MCP server runs on your
machine over stdio; install it with [`mcp-server/install.sh`](mcp-server/README.md#use-it-in-copilot-codex-cursor-or-gemini-cli).
Without Claude Code's hook, the block on editing code, CI and dependency files during a test-writing run is an instruction to the model only.

## Try it

- "Is ABC-123 ready to test?"
- "Write the tests for the ticket on my branch."
- "Check the tests I changed on this branch."
- "Show me the tickets assigned to me that are in progress."

…or type `/quality-code:spec` in any chat, from your feature branch.

## Commands

| Command | What it does |
|---|---|
| `/quality-code:setup` | connects Jira, GitLab and Figma, and writes the project's config |
| `/quality-code:spec` | your daily start: the branch, its ticket, the readiness gate, then the tests |
| `/quality-code:ticket-eval <KEY>` | scores a ticket for test-readiness (70 points to pass) |
| `/quality-code:spec <KEY>` | writes the tests for a ticket and grades them |
| `/quality-code:run-frontend` | runs every frontend (Playwright) spec through the pipeline |
| `/quality-code:run-backend` | runs every backend (Vitest) spec through the pipeline |
| `/quality-code:run-pipeline` | runs both, the full suite, in one run (`--branch`: only the tests your branch changed) |
| `/quality-code:routine` | a check Claude runs by itself on a schedule (a time, for a period or once): fetches what others pushed, runs a ticket's tests or the whole suite, says when it went from green to red and which commits came in between, and with `--stability N` runs every test N times to watch flaky tests and the pass rate over time |
| `/quality-code:check-update` | says whether a newer version of the plugin is out, lists what changed since yours, and updates it on your pick (`claude plugin update`); then asks you to type `/reload-plugins` |
| `/quality-code:ci` | for GitHub Actions and GitLab CI: detects whether the branch changed the backend or the frontend and runs only the tests it touched, per module (everything on the default branch or with `--all`); `--init github\|gitlab` writes the CI file, which runs all the tests of the test folders (`--changed`: only the touched ones) |
| `/quality-code:ticket` | finds a ticket and shows it in short |
| `/quality-code:seed <KEY>` | loads realistic mock data for a ticket into your local database, to test it by hand in the running app (local databases only; set up with the `seed` block) |
| `/quality-code:xray <KEY>` | writes XRay test cases for QA |
| `/quality-code:qa [KEY]` | for QA: lists your Xray test executions, runs one in the browser and drafts each defect; you give every verdict, and nothing reaches Jira without a yes |
| `/quality-code:config` | shows the settings and changes one at a time: the project config and your own plugin settings |
| `/quality-code:kpi`, `/quality-code:consumption` | usage numbers and AI cost, read locally |

The commands that run tests or load data (`spec`, the run commands, `seed`) work in Claude Code, where your repository is.

## Privacy

Quality Code reads Jira, Confluence, GitLab and Figma through your own connector sign-ins. It writes to
Jira only after you confirm a preview: a comment, or the fill-in you typed. Tickets are redacted
before they are scored (customer ids, emails), and everything else stays on your machine: the
config, saved tickets, run logs and the audit log. Tokens live in your system keychain, never in the
chat or the repository.

With `jira_api_token` set, it also reads a ticket's `.docx` files and screenshots, which the Jira
connector cannot download: read only, from your `*.atlassian.net` site, at most 3 of each per ticket,
5 MB each, 20,000 characters per `.docx`. PDFs and spreadsheets are not read.

Made by Elvis Zefaj. Full guide: [README](https://github.com/vissz28/agentic-testing#readme).
