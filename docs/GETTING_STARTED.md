# Getting started with quality-code

A short guide for QA and developers. It shows how to check whether a Jira ticket is ready to be
tested and how to fix it when it is not, all inside Claude Code. It works for any team with a
Playwright (frontend) or Vitest (backend) repo.

> **What it does today:** setup, the daily start from your feature branch, the readiness check,
> the guided fill-in, the Jira comment / update, and checking and writing Vitest tests. Playwright
> tests come in a later version; see the [CHANGELOG](../CHANGELOG.md) for what each version added.

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
/plugin install quality-code@quality-code
```

When Claude Code asks for the plugin's settings (all optional):

- **GitLab API URL**: keep the default if you use TeamSystem's GitLab, otherwise enter yours
  (ending in `/api/v4`).
- **GitLab Application ID** or **GitLab token**: one of them, to reach GitLab by browser sign-in or
  by a `read_api` token. Leave both empty if you don't use GitLab yet.
- **Figma API key**: leave it empty if you don't have one, or sign in to Figma in the browser instead.

You can change them later from the `/plugin` menu. Secrets stay in the system keychain.

**Tip for the team lead:** to offer the plugin to everyone who opens the repo, commit this in the
repo's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "quality-code": { "source": { "source": "github", "repo": "vissz28/agentic-testing" } }
  },
  "enabledPlugins": { "quality-code@quality-code": true }
}
```

---

## 3. Set up the project (once per repo, by one person)

```
/quality-code:setup
```

Setup asks one question per card. You answer by typing a number (or `stop` to quit):

| Card | What you choose | Example |
|---|---|---|
| Connectors | Jira must be connected; GitLab is optional, and so is Figma (Playwright projects only), by browser sign-in or token | ✅ Jira |
| This project | confirm the folder, the stack (from `package.json`) and the GitLab project | `orders-app`, Vitest |
| Jira | the site and your project key(s) | `ABC` |

At the end you see the config and choose `1. Write it / 2. Change something / 3. Cancel`. Nothing
is written before you type `1`. Setup does not check any ticket; the first ticket you check with
`/quality-code:start` or `/quality-code:ticket-eval` also finds your project's acceptance-criteria
field and remembers it.

Want the extra points for feature labels, QA plans or title prefixes, or your own templates? Run
`/quality-code:setup advanced`. It also asks which paths a test run must never change and, for
Vitest, which config runs which tests and the test folders that new tests go in.

**Then commit** `.claude/quality-code.json` and the `.gitignore` lines setup added. To change
anything later, run `/quality-code:setup` again rather than editing the file by hand.

---

## 4. Every day: start from your branch

Check out your feature branch (named with the ticket key, for example `ABC-123-add-export`), then:

```
/quality-code:start
```

You confirm the repo card (branch, base, how many files changed), confirm the ticket key, and pick
what to do:

```
ABC-123 on ABC-123-add-export (5 files changed against origin/main)
1. Evaluate the ticket
2. Check the tests on this branch
3. Write and check tests
4. Stop
```

Option 2 shows only in a Vitest project whose branch has test files; without it, `Write and check
tests` is option 2. The rest of this section is what you see after `1. Evaluate the ticket`. To check
a ticket that has no branch yet, use `/quality-code:ticket-eval ABC-123`.

```
/quality-code:ticket-eval ABC-123
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

Only for developers who know the risk. Nothing is posted, and the run stops with the
`[RISK / NOT RECOMMENDED]` mark. No tests are written for a refused ticket.

---

## Checking tests (Vitest projects)

Once your branch has test files, run:

```
/quality-code:check
```

Or pick `2. Check the tests on this branch` in `/quality-code:start`. You can also name the specs:
`/quality-code:check test/orders.spec.ts`. It lists the test files your branch changed (deleted ones
are left out) and asks `1. Yes / 2. Pick some / 3. Stop`, confirms the ticket key, then runs the
tests and the checks. This can take a few minutes. You get one card with a verdict:

| Verdict | What to do |
|---|---|
| ✅ green | nothing: the tests pass and every check ran |
| ❌ checks failed | read the "What to do" line: for example an assertion was removed, a test asserts nothing, an expected value from the ticket is not asserted, or the code does not compile |
| ⚠️ not verified | something could not run (Vitest missing, a timeout). Fix what the card names and run it again. A spec of only snapshots is also not verified, because the check cannot show its assertions can fail |
| 🔴 tests red | a test fails. Normal for a bug whose fix is not merged yet |

The check never edits your tests or code and writes nothing into the repo, apart from Vitest's own
cache and short-lived temporary copies of the spec that the mutation check makes next to it. If your
repo has more than one Vitest config, `/quality-code:setup advanced` asks which config runs which tests.

---

## Writing tests (Vitest projects)

To have the tests written from the ticket, run:

```
/quality-code:write ABC-123
```

Or pick `Write and check tests` in `/quality-code:start`. It goes like this:

1. **The ticket is checked first.** A ticket below 70 gets the same refuse card as above. Fill it in
   until it passes and writing goes on; otherwise nothing is written.
2. **Which code?** It proposes the source file the ticket changes: `1. <path> / 2. <path> /
   3. Another file / 4. Stop`. Add `--target src/pricing.ts` to skip this card.
3. **The plan.** One line per scenario of the ticket, with the test folder it goes in:
   `1. Write these tests / 2. Change the layers / 3. Stop`. The folders come from
   `/quality-code:setup advanced`; by default it is `test/`.
4. **The tests are written** in those folders only, with the real expected values from the ticket.
   Your code is never changed.
5. **The checks run**, as in `/quality-code:check`, plus two more: every expected value from the
   ticket must be asserted, and, if the project has Stryker installed, the tests must catch enough
   changes to the code. A fixable problem gets up to two rewrites of the tests; then you see the card.

For a bug, `🔴 tests red` is normal: the card says the test should go green when the fix is merged.

If you see `Another test-writing run is active.`, an earlier run did not finish: pick `1` to stop it
and start yours.

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
| `/quality-code:ticket-eval ABC-123 --refuse-comment` | prints the Jira comment without posting it |
| `/quality-code:ticket-eval ABC-123 --json` | prints only the machine result |
| `/quality-code:ticket-eval ABC-123 --ci` | no questions: a refused ticket gets the Jira comment and the run fails |
| `/quality-code:check test/orders.spec.ts --flaky 3` | also runs the tests three times and fails on a test that changes its result |
| `/quality-code:write ABC-123 --target src/pricing.ts` | writes tests against that file, without asking which code |
| `/quality-code:write ABC-123 --layer unit` | writes only in the `unit` test folder |
| `/quality-code:consumption --by ticket` | AI usage and estimated cost of the plugin's runs, per ticket |

---

## 7. If something goes wrong

| You see | Do this |
|---|---|
| `Run /quality-code:setup.` | the repo has no config yet, or a field is wrong: run setup |
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
