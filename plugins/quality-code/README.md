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
| `/quality-code:ticket` | finds a ticket and shows it in short |
| `/quality-code:seed <KEY>` | writes only the test data a ticket needs |
| `/quality-code:xray <KEY>` | writes XRay test cases for QA |
| `/quality-code:qa [KEY]` | for QA: lists your Xray test executions, runs one in the browser and drafts each defect; you give every verdict, and nothing reaches Jira without a yes |
| `/quality-code:config` | shows the settings and changes one at a time: the project config and your own plugin settings |
| `/quality-code:kpi`, `/quality-code:consumption` | usage numbers and AI cost, read locally |

The commands that run tests (`spec`, the run commands, `seed`) work in Claude Code, where your repository is.

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
