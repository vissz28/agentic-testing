# Quality code: how to use it

> Written for QA and developers on the warehouse team. Install the plugins first: see the
> [warehouse plugins page](WAREHOUSE.md). Other teams: see the [README](../README.md).

## What it does

You give it a Jira ticket. It checks whether the ticket is written well enough to test, then writes
real tests from the ticket's acceptance criteria and runs them. You get a short result card: what was
checked, what passed, what failed, and what to do next.

- **Frontend** (`warehouse-frontend`): writes Playwright browser tests plus an XRay test case.
- **Backend** (`warehouse-backend`): writes Vitest tests against a real Postgres database.

The AI writes the tests, but it never decides whether they pass. Fixed scripts do the scoring and the
checks, so a green result is not the AI's opinion of its own work.

---

## Before the first run

1. **Open the right folder** in Claude Desktop (or Claude Code): `warehouse-frontend` for screen
   tickets, `warehouse-backend` for data and API tickets. The skill tells you if you are in the wrong
   one.
2. **Jira connector.** It comes with the plugin; sign in through the browser the first time.
   Without it the run stops at the start. You can also paste the ticket text instead.
3. **Backend only: start Docker.** The backend tests run against a real database in a container.
4. **Frontend, first time only:** `npm ci` (needs your Nexus token in `~/.npmrc`, see
   `e2e/WORKFLOW.md`).

---

## Running it

Type the command and a ticket key:

| Repo | Command | What you get |
|---|---|---|
| Frontend | `/warehouse-frontend:spec-frontend FIC-14333` | Playwright tests + XRay case for the ticket |
| Backend | `/warehouse-backend:spec FIC-13860` | Vitest tests (unit, integration, range) for the ticket |

You answer by typing a number: `1`, `2` or `3`. `stop` works on every card.

### Step 1: the readiness check

The ticket gets a score out of 100. **70 or more passes**, below 70 is refused. The points come from
what the ticket contains:

| What the ticket has | Points (frontend) | Points (backend) |
|---|---:|---:|
| Acceptance criteria | 30 | 30 |
| Criteria that are specific (no "works correctly") | 15 | 15 |
| Feature label (one of the 8, e.g. `Giacenza_Prodotti`) | 15 | 5 |
| Confluence QA plan linked | 15 | — |
| Steps to reproduce (bug) or user story (story) | 10 | 15 |
| Expected and actual result | 10 | 15 |
| Context / summary section | — | 10 |
| Title prefix `[FE]` / `[BE]` / `[FS]` | — | 5 |
| Environment (`Env: staging`) | 5 | 5 |

#### How to write acceptance criteria that count

Put them under an **Acceptance criteria** (or **Criteri di accettazione**) heading, or in the Jira
**Acceptance Criteria** field. Two formats work, and you can mix them:

**Plain language**: at least **150 characters**, so two or three real sentences:

```
## Acceptance criteria
The Delete button is disabled for a warehouse that still has stock. Hovering it shows the
tooltip "Empty the warehouse first" and no delete request is sent.
```

**Gherkin**: any length:

```
## Acceptance criteria
Given a warehouse that still has stock
When I open its menu
Then the Delete button is disabled
```

What does **not** count:

- Sentences with no criteria heading, even if they say "should" or "must".
- Plain-language criteria under 150 characters.
- Vague results such as "works correctly", "as expected", "funziona correttamente" or
  "come previsto". These keep the 30 points but lose the 15 for being specific.

### Step 2a: the ticket passes

You see what will be checked, in plain sentences:

```
I read FIC-14333 — Products stock: multi-warehouse view

We will check:
  • The table shows one row per warehouse under each product

1. Yes, that's right
2. No — I'll type the right result
3. Stop
```

### Step 2b: the ticket is refused

```
This ticket needs a bit more information. We cannot start yet.

1. Post a comment on Jira with what to add.
2. I will add the missing information here.
3. 🔴 [RISK / NOT RECOMMENDED] Continue anyway (developers only). The user story is not complete.
```

**Option 1: comment on Jira.** You see the comment first, word for word. Nothing is posted until you
confirm. The comment tells the author exactly what to add, with an example for each item.

**Option 2: add the missing information yourself.** This is a guided fill-in:

1. You get the list of what is missing and what each item is worth:

   ```
   This ticket has 0 of the 70 points it needs.
   What is missing:
     1. Acceptance criteria         +55
     2. Feature label               +15
     3. Steps to reproduce          +10
     4. Expected and actual result  +10
     5. Environment                 +5
   Type the numbers you want to fill, for example: 1 3
   ```

2. You pick, for example `1 2`. It tells you if that is enough:
   `With 1 and 2 the ticket reaches 70 points (the bar is 70): enough.`
3. For each item it asks one question and shows an example answer. You type the answer, or `skip`.
   An answer that does not count is refused with the reason, and you can try again (2 tries per
   item):

   ```
   Not accepted: Too short: 39 characters. Plain-language criteria need at least 150
   (two or three sentences on what should happen), or write them as Given / When / Then.
   ```

4. When the ticket passes, you can choose to **add what you typed to the Jira ticket**. You see a
   preview first. Only after you confirm is it added to the end of the description, and labels are
   added to the existing ones. Nothing already on the ticket is changed.

**Option 3: continue anyway.** For developers only. The checks run, but every result is flagged
`[RISK / NOT RECOMMENDED]` (in red in a terminal), because a test written from an incomplete story
may not check what the story means.

### Step 3: before writing the tests

```
1. Write the checks
2. Change what we check
3. Stop
```

### Step 4: the result

The checks run (backend: 2–4 minutes). You get a short card in everyday words: each check with
✓ or ✗, what went wrong in plain language, and what to do now. Then:

```
1. Done
2. That's not what I see in the app
3. Another ticket
```

**Reading the result:**

- **Red on a new ticket is often a good red**: the feature is not built yet, and the test proves it.
- **"Extra (not in the ticket)"** lines are edge cases the tool added (empty lists, long names,
  numbers, translations). A red extra is a case the team missed, not a broken run.
- **The detail for developers** is in the run log: `e2e/tickets/<KEY>/run.md` (frontend) or
  `.claude/audit/tickets/<KEY>/run.md` (backend).

---

## Other commands

| Command | Repo | What it does |
|---|---|---|
| `/warehouse-frontend:ticket-eval FIC-…` | Frontend | Only the readiness check: is this ticket ready? Writes nothing. |
| `/warehouse-frontend:seed` / `/warehouse-backend:seed FIC-…` | Both | Test data for a ticket. Frontend: the API stubs. Backend: loads ~25 rows per table into your local database so you can test by hand. |
| `/warehouse-frontend:playwright FIC-…` | Frontend | Only the Playwright test, no XRay case. |
| `/warehouse-frontend:xray FIC-…` | Frontend | Only the XRay test case, no test run. |
| `/warehouse-backend:unit`, `:integration`, `:range` | Backend | One test layer only. |
| `/warehouse-backend:check` | Backend | Re-runs a failing test several times to tell a real failure from a flaky one. |

---

## Writing tickets that pass first time

Use the GitLab templates: **New issue → Choose a template → Story / Bug**. They carry every section
the score looks for. The full standard is in `.claude/TICKET_TEMPLATE.md`.

Quick checklist:

- [ ] Title starts with `[FE]`, `[BE]` or `[FS]`.
- [ ] A feature label (`Giacenza_Prodotti`, `Lista_Movimenti_Magazzino`, …).
- [ ] **Acceptance criteria**: Gherkin, or plain sentences of 150+ characters, with specific results.
- [ ] Bug: steps to reproduce, expected, actual, `Env:`. Story: a user story line and context.

---

## What it will never do

- Edit application code (`src/`), the CI pipeline or `.env`. A guard blocks those writes.
- Post or change anything on Jira without showing you first and getting a yes.
- Grade its own tests. The scores and pass/fail come from fixed scripts.

## Open points (draft)

- `[PLACEHOLDER: who to ask when something looks wrong, e.g. a Slack channel]`
- `[PLACEHOLDER: link to this guide once it has a home, e.g. Confluence]`
