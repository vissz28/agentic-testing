# Quality Code

From Jira ticket to tests you can trust.

Quality Code checks that a Jira ticket is clear enough to test, helps its author fill the gaps,
writes Vitest and Playwright tests from its acceptance criteria, and grades them with scripts, never
with the model. For frontend, backend and fullstack projects at TeamSystem.

## Try it

- "Is ABC-123 ready to test?"
- "Write the tests for the ticket on my branch."
- "Check the tests I changed on this branch."
- "Show me the tickets assigned to me that are in progress."

…or type `/quality-code:start` in any chat, from your feature branch.

## Commands

| Command | What it does |
|---|---|
| `/quality-code:setup` | connects Jira, GitLab and Figma, and writes the project's config |
| `/quality-code:start` | your daily start: the branch, its ticket and the readiness gate |
| `/quality-code:ticket-eval <KEY>` | scores a ticket for test-readiness (70 points to pass) |
| `/quality-code:write <KEY>` | writes the tests for a ticket and grades them |
| `/quality-code:check` | grades the spec files on your branch |
| `/quality-code:ticket` | finds a ticket and shows it in short |
| `/quality-code:seed <KEY>` | writes only the test data a ticket needs |
| `/quality-code:xray <KEY>` | writes XRay test cases for QA |
| `/quality-code:kpi`, `/quality-code:consumption` | usage numbers and AI cost, read locally |

The commands that run tests (`write`, `check`, `seed`) work in Claude Code, where your repository is.

## Data

Quality Code reads Jira, Confluence, GitLab and Figma through your own connector sign-ins. It writes to
Jira only after you confirm a preview: a comment, or the fill-in you typed. Tickets are redacted
before they are scored (customer ids, emails), and everything else stays on your machine: the
config, saved tickets, run logs and the audit log. Tokens live in your system keychain, never in the
chat or the repository.

Made by Elvis Zefaj. Full guide: [README](https://github.com/vissz28/agentic-testing#readme).
