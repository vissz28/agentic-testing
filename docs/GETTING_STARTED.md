# Getting started with agentic-testing

A short guide for QA and developers. It shows how to check whether a Jira ticket is ready to be
tested and how to fix it when it is not, all inside Claude Code. It works for any team with a
Playwright (frontend) or Vitest (backend) repo.

> **What it does today (v0.2.0):** setup, the readiness check, the guided fill-in and the Jira
> comment / update. Writing the tests themselves comes in a later version.

---

## 1. Before you start

You need:

- **Claude Code** with plugin support (check with `claude plugin --help`).
- **Node 18 or newer.**
- A repo whose `package.json` has `@playwright/test` or `vitest`.
- Access to your **Jira** site. Claude Code will ask you to sign in to Atlassian the first time.
- Access to the plugin repo: `git clone https://github.com/vissz28/agentic-testing` must work on
  your machine (keychain login, `gh auth login` or SSH).

---

## 2. Install the plugin (once per person)

Open Claude Code in your repo and type:

```
/plugin marketplace add vissz28/agentic-testing
/plugin install agentic-testing@agentic-testing
```

When Claude Code asks for the plugin's settings:

- **Figma API key**: optional; leave it empty if you don't have one.
- **GitLab MCP URL**: keep the default if you use TeamSystem's GitLab, otherwise enter yours.

You can change both later from the `/plugin` menu.

**Tip for the team lead:** to offer the plugin to everyone who opens the repo, commit this in the
repo's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "agentic-testing": { "source": { "source": "github", "repo": "vissz28/agentic-testing" } }
  },
  "enabledPlugins": { "agentic-testing@agentic-testing": true }
}
```

---

## 3. Set up the project (once per repo, by one person)

```
/agentic-testing:setup
```

Setup asks one question per card. You answer by typing a number (or `stop` to quit):

| Card | What you choose | Example |
|---|---|---|
| Stack | found from `package.json`; if the repo has both, you pick one | Playwright |
| Jira | the site and your project key(s) | `ABC` |
| Criteria field | the Jira field that holds acceptance criteria, or none | "Acceptance Criteria" |
| Narrow the search | in a project shared with other teams: all tickets, a word in the title, a component, or type your labels | `component = Orders` |
| Feature labels | the labels your team uses, picked from recent tickets | `Orders`, `Invoices` |
| Routes (Playwright) | the screen of each label | `/orders` |
| QA plans (Playwright) | the Confluence space and the search words for each feature's QA plan | space `ABC`, `order history` |
| Title prefixes (Vitest) | prefixes your team puts in titles, or none | `[API]` |
| Languages | English, plus Italian if your tickets use it | `en`, `it` |
| Redaction | customer ids are always hidden; add your own patterns if needed | — |
| Templates | if the repo has no Bug/Story templates, add the standard ones | yes |

At the end you see the **whole config** and choose `1. Write it / 2. Change something / 3. Cancel`.
Nothing is written before you type `1`. Setup then checks one recent ticket to show that it works.

**Then commit** `.claude/agentic-testing.json`, plus the templates and the `.gitignore` line if setup
added them. To change anything later, run `/agentic-testing:setup` again rather than editing the
file by hand.

---

## 4. Check a ticket

```
/agentic-testing:ticket-eval ABC-123
```

The plugin reads the ticket, hides customer data in its local copy, and a script gives it a
**score out of 100**. **70 or more passes.** The model never decides the score.

- **Pass:** the ticket is ready. You're done.
- **Refused:** you get this card:

```
This ticket needs a bit more information. We cannot start yet.

1. Post a comment on Jira with what to add.
2. I will add the missing information here.
3. 🔴 [RISK / NOT RECOMMENDED] Continue anyway (developers only). The user story is not complete.
```

### Option 1: ask the author on Jira

You see the full comment first: what is missing, with an example to copy for each item. It is posted
only when you confirm. Running it again later updates the same comment instead of adding a new one.

### Option 2: fill it in yourself (most common)

You get a list of what's missing and what each item is worth:

```
This ticket has 10 of the 70 points it needs.
What is missing:
  1. Acceptance criteria         +60
  2. Steps to reproduce          +15
  3. Expected and actual result  +15
  4. Summary                     +10
  5. Environment                 +5
Type the numbers you want to fill, for example: 1 3
```

1. Type the numbers, for example `1 2`. It tells you whether that is enough to reach 70.
2. Answer one question per item, or type `skip`.
3. **The script decides whether an answer counts.** If it doesn't, you see why and can try again.
4. When the ticket passes, you can **add what you typed to the real Jira ticket**. You see a preview
   first. Your text is only appended, and nothing already on the ticket changes.

### Option 3: continue anyway

Only for developers who know the risk. Everything afterwards is marked
`[RISK / NOT RECOMMENDED]`.

---

## 5. Writing acceptance criteria that count

Put them under an **Acceptance criteria** (or **Criteri di accettazione**) heading, or in the Jira
criteria field. Either format works.

**Gherkin**, any length:

```
## Acceptance criteria
Given an order that has already shipped
When I open its menu
Then the Cancel button is disabled
```

**Plain language**, at least **150 characters**:

```
## Acceptance criteria
When an order has already shipped, the Cancel button is disabled. Hovering it shows the tooltip
"Shipped orders cannot be cancelled" and no cancel request is sent.
```

What does **not** count:

| You wrote | Why it does not count |
|---|---|
| "It works correctly", "as expected", "funziona correttamente" | a test cannot check it: name the exact text, number or state |
| Fewer than 150 characters of plain text | too little to test against |
| `Given … / When …` with no `Then` | there is no result to check: add a `Then`, or write "When X, Y" |
| Sentences with no criteria heading | the script only reads the criteria section or field |
| Anything inside `<!-- … -->` | template hints never count |

---

## 6. Useful options

| Command | What it does |
|---|---|
| `/agentic-testing:ticket-eval ABC-123 --refuse-comment` | prints the Jira comment without posting it |
| `/agentic-testing:ticket-eval ABC-123 --json` | prints only the machine result |
| `/agentic-testing:ticket-eval ABC-123 --ci` | no questions: a refused ticket gets the Jira comment and the run fails |

---

## 7. If something goes wrong

| You see | Do this |
|---|---|
| `Run /agentic-testing:setup.` | the repo has no config yet, or a field is wrong: run setup |
| `This stack is not supported yet` | `package.json` has neither Playwright nor Vitest |
| `Sign in to Atlassian when prompted…` | type `/mcp` and connect Atlassian, or paste the ticket text |
| "This ticket is from project X…" | pick `1` to check it anyway, or add the project with setup |
| `marketplace add` fails | check that `git clone https://github.com/vissz28/agentic-testing` works on its own |

---

## 8. Good to know

- **Nothing reaches Jira without a preview and your yes.**
- **Customer data is hidden** in the local ticket copy before scoring (customer ids, e-mails, UUIDs).
- **The bar is 70 for every team** and cannot be changed.
- More detail is in the [README](../README.md).
