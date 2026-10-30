---
description: Load realistic mock data for a Jira ticket into your LOCAL database, so you can test the ticket by hand in the running app. Resets the rows it fills first. Local databases only, never a shared one.
argument-hint: <KEY>
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
---

Fills the local database with mock data for a ticket: about 25 realistic rows per table the ticket's screen reads, plus the ticket's own case, so QA can open the app and test it by hand. Each run resets those rows first, so it always lands on a clean, known state. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Where files go.** When the command has ended (after its last card is answered, or its last step when it shows none), follow `${CLAUDE_PLUGIN_ROOT}/guides/save-place.md`: the first run of a project asks once where its files and logs are kept.
- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **Local database only.** Data reaches the database only through `seed.mjs load`, after its check of `seed.target` passes. Never run SQL yourself and never reach a database another way (`psql`, `docker exec`, a client, the app's API). Never change `seed.target` or `seed.apply`, and never work around a `refused:` line: show it and stop.
- **The ticket's values exactly; the rest realistic, never real.** Values the ticket gives are used as it writes them. Every other row is plausible mock data that follows the schema. Never copy rows from a shared or production database, never a real customer.
- **Never edit application code.** Write only the SQL files in the tickets folder. The schema, migrations, source files and config stay as they are.
- **Never ask for a token**, key or password in the chat, and never show one or a connection string.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop or Cancel option. Read only the first word for this; a sentence that gives a result (and no number) is a typed answer.
- **Language.** Talk in the language of the user's messages; before they write one, in the ticket's language (Italian for an Italian ticket). Script output and cards stay as printed.
- Refer to Jira tools by operation name on the Atlassian connector.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/bin/<script>" …`. With `root` in `.claude/quality-code.json` the project root is that folder: every path the scripts print or take is relative to it, so the files you read and write are under it. Drop the machine lines (`TICKET_EVAL_JSON:`, `PROJECT_MISMATCH:`) when you show output.

## Steps

1. **Check.** The first `[A-Z][A-Z0-9_]*-\d+` in `$ARGUMENTS` is the key. No key: `pass a key: /quality-code:seed <KEY>`. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. If it does not print `ok`, show its lines and stop (a missing config means: run `/quality-code:setup`). If it prints `ok (personal: …)`, or you are not inside a git repo, say `This needs a repo. Open the project folder, or run /quality-code:setup there.` and stop. Read `.claude/quality-code.json`: `ticketsDir` (the path on the `tickets folder:` line `config check` printed, used as it is), `features`, and the `seed` block: `seed.schema`, `seed.tenant` and `seed.guide`, each optional.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/bin/seed.mjs" target`. It runs the project's `seed.target` command and checks that the database it reaches is on this computer. Exit 2: show its lines and stop (no `seed.target` or `seed.apply` yet: the project sets them once, as the lines show). Exit 1: show its `refused:` line, say `Nothing was loaded.` and stop. Exit 0: keep its `target:` line for the plan card.
   - Then read `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` and follow it, as the start command does. From the plugin settings (each empty when not set): `jira_email` is `${user_config.jira_email}`, `gitlab_username` is `${user_config.gitlab_username}`, `gitlab_api_url` is `${user_config.gitlab_api_url}`. Jira is required: go on only when its card lets you continue.
2. **Ticket and gate.** Read `${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md` and follow its steps 1–5 with `<KEY>` as `$ARGUMENTS`, no flags: read, save, sanitize and score. Mock data made up from a vague ticket shows QA the wrong case, so the gate applies.
   - **Refused:** its refuse card and its flow, as written there. Go on only when that flow ends with the ticket passing (the guided fill-in, then `1` or `2` on its Jira update card). Option 3 (continue anyway), a comment posted, a cancel or a stop: stop, `Mock data needs a ticket that passes the gate.` Nothing loaded.
   - **Passed:** go on with `<ticketsDir>/<KEY>/ticket.json`, the only copy of the ticket; never edit it. Keep the `feature` and the `route` from the last `TICKET_EVAL_JSON:` line. Harvest the ticket's **case**: each entity it names, each field, each value as the ticket writes it (mostly the `Given` lines). A value the case needs that the ticket does not give is a gap: name it, never invent it.
3. **Schema.** Read `${CLAUDE_PLUGIN_ROOT}/guides/seed-data.md`, then `seed.guide` when it is set: the team's own rules, on top of it (they win where they differ). A guide file that does not exist: say `The seed guide <path> does not exist; going on without it.`
   - With `seed.schema`, read it (a file, or a folder of migrations or models). It does not exist: `The schema <path> does not exist. Fix seed.schema in the config.` and stop. Without it, look for the project's schema (never in `node_modules/`): a `schema.prisma`, a `schema.sql` or `structure.sql`, a migrations folder, the ORM's model files. One found: use it and say which. Several: show up to three, best first, in this card and end the turn. None: `No database schema found. Name it in seed.schema in the config, then run this again.` and stop.

     ```
     Which file describes the database?
     1. <path>
     2. <path>
     3. Another file
     4. Stop
     ```

     On `3`, ask `Which file? Type its path from the project root.` and check it exists. On `4`, stop. After a pick, add one line: `To skip this question next time, add "seed": { "schema": "<path>" } to .claude/quality-code.json.`
   - From the schema and the ticket, find the **tables**: the ones the ticket's screen or endpoint reads (its entities, the feature's `route` and the code that serves it), the parents their foreign keys need, and every table whose rows point at the ones you fill (the reset must empty those first). Note each table's real name, its columns, which are required with no database default, its enums and its unique keys.
4. **Dataset.** The feature's dataset is `<ticketsDir>/seed/<feature>.sql` (with no feature, `<ticketsDir>/<KEY>/dataset.sql`). Tickets of one feature share it.
   - **It exists:** reuse it as it is. Read it for the plan card.
   - **It does not:** it will be written in step 6.
   - **The ticket's case:** the rows that hold the ticket's own values, when the dataset does not already hold them, go in `<ticketsDir>/<KEY>/seed.sql`, loaded after the dataset. No case beyond the dataset: no file.
5. **Plan.** Show this card and end the turn. `Empties` names the tables the reset clears, child tables first; with `seed.tenant`, add `(only <column> = <id>)`, else `(every row)`. Leave out `Ticket's case` with no ticket file, and `Not in the ticket` with no gaps.

   ```
   Mock data for <KEY>
     Target         <the target: line, without "target: ">
     Empties        <table>, <table>, … <(only <column> = <id>) or (every row)>
     Loads          <table> <n> rows, <table> <n> rows
     Ticket's case  <its facts, in a few words>
     Not in the ticket: <gap>, <gap>
     Dataset        <the dataset path> <(reused) or (new)>
   1. Load it
   2. Stop
   ```

   On `2`, stop. Nothing loaded.
6. **Write.** Follow the guide. Write the dataset when it is new, then the ticket's file when there is one. Nothing else.
7. **Load.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/seed.mjs" load <dataset path>`, with the ticket's file after it when there is one. Show its output as it is.
   - **Exit 0:** one more line: `Loaded. Open the app at <the route, when the feature has one> to test <the ticket's case in a few words>.` Stop.
   - **A `refused:` line:** show it and stop. Nothing was loaded. A refused file of yours breaks the guide: say so; it is fixed by writing it again, never by changing the config.
   - **`failed:`** (the database said no): show the database's lines. When a reused dataset fails on a table or column that is not there (the schema moved on), show this card and end the turn:

     ```
     The saved dataset no longer fits the database.
     1. Write the dataset again from the schema
     2. Stop
     ```

     On `1`, go back to step 3 and write the dataset anew (the plan card shows it as new). Any other failure: show the lines and stop.

## Setting it up

The project names, once, how to reach its local database. The plugin never knows the container, the port or the password:

```json
"seed": {
  "schema": "prisma/schema.prisma",
  "target": "echo localhost:5432/app",
  "apply": "psql -h localhost -d app -v ON_ERROR_STOP=1 -f {file}",
  "tenant": { "column": "tenant_id", "id": "00000000-0000-4000-8000-000000000001" }
}
```

- **`target`** prints the database it reaches, as `host[:port]/database` or a URL (a password in it is never shown). Only `localhost`, `127.x.x.x`, `::1` or a container name (one word, like `postgres`) pass. For a database in a container, ask it: `docker exec db psql -U app -Atc "select 'db/' || current_database()"`.
- **`apply`** loads one SQL file, `{file}`, into that database. It may do more after the load, such as empty the app's cache.
- **`tenant`** keeps every reset and update to one tenant: the one the local app shows. Leave it out when the app has no tenants.
- It never runs in CI.

## Examples

- `/quality-code:seed ABC-123`: load mock data for the ticket into the local database
