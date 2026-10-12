---
name: spec
description: >-
  Write live warehouse tests from a FIC Jira ticket, or just its test data. Use when
  QA says /spec or /seed, pastes a FIC- key, asks to check a ticket, or asks for a
  ticket's seed data or fixtures.
---

# Spec — live-DB tests from a Jira ticket

Read-only on Jira except one refuse comment (`addCommentToJiraIssue`) and, only when QA confirms the preview, appending their guided fill-in to the ticket (`editJiraIssue`). Writes under `test/{unit,integration,range}/` (never next to source). Existing mocked `src/**/*.spec.ts` are untouched unless `--mocked`.

Flags: `[TICKET-KEY | NUMBER] [--path src/…/foo.ts] [--no-edges] [--fast] [--no-mutate] [--mutation-threshold <pct>] [--no-stryker] [--dry-run] [--ci] [--mocked]`

Read [layers.md](layers.md) before drafting. Read [seed.md](seed.md) before seeding. Coverage vs the Quality Program: [REPORT.md](REPORT.md).

## Data only (`/seed`) — load the LOCAL DB for manual testing

`/seed {TICKET}` no longer prints a copy-paste block. It **populates the local backend container DB**
with ~25 rows/table of ticket-relevant data so QA can manually test the scenario in the running app
at `localhost:3000`. **Follow [../../commands/seed.md](../../commands/seed.md) for the full flow.** In brief:

- Do **steps 1–3 only** (resolve; sanitize + score; feature label / bucket). The readiness gate still
  applies: data invented from a vague ticket is the same lie as a test invented from one.
- Feature label → tables → reuse or generate `.claude/seed-cache/<feature>.sql` (~25 rows/table,
  cached per service), then apply it to the **container** DB via
  `docker exec -i postgres psql -U postgres -d warehouse` — **never `localhost:5432`** (a native
  Postgres shadows it). Resets this workspace's content each run, scoped to the workspace the local
  app selects (`test-studio-4-mock`, from the frontend mock SDK — not `16475e6a-…`).
- **No** `it` / `describe` / `expect`, and **no** `run-pipeline.mjs` — there is nothing to grade.

Writing seed rows *into a committed spec* is `/spec`'s job (step 5, via [seed.md](seed.md)), not
`/seed`. The `test/helpers/seed.ts` builders and the completeness rules in [seed.md](seed.md) still
govern that path.

## Where this runs

**Claude Desktop** (or Claude Code) with the `warehouse-backend` folder open. Docker on. Jira connector on.

Before anything else, check that `.claude/harness/run-pipeline.mjs` is on disk.

- **Yes** → full flow (pauses + pipeline).
- **No** → still do pause 1 if Jira works, then stop with: `Open the warehouse-backend folder in Claude Desktop to run the checks.` Do not invent files.
- **Jira tools missing** → `Turn on the Jira connector in Claude Desktop, or paste the ticket text.` Then stop unless they paste it.
- **Docker down** (pipeline) → already on the result card; one extra sentence at pause 2 is allowed.

## How to talk

The human is QA, in **Claude Desktop** (text chat, no buttons). They type `1`, `2`, or `3` (send-preview also has `4`).

- Short sentences. Everyday words. Ticket language (Italian if the ticket is Italian).
- Chat never contains: file paths, `src/`, `test/`, npm, flags (`--fast`, `--target`), scores, layer names (unit/integration/range), GitLab, readiness %, or spec source. **Exception:** keep the pipeline card's `More: .claude/audit/tickets/<KEY>/run.md` line when it is present, and show the fill-in lines from `score-ticket.mjs` (`--fill-menu`, `--pick`, `--add`) as printed, points included: they are how QA chooses what to add. If that line is missing, the log was not written — do not invent the path.
- No clickable forms, no Cursor `AskQuestion`, no extra UI. A numbered block in the transcript is the whole interaction.
- After printing a pause block: **end the turn**. No more tools, no recap, no "waiting for you". The next user message is the answer.
- Keep paths, scores, and flags in the pipeline command and the run log. Keep the card's `More:` line. Do not invent a run-log path.

### Reading their reply

Treat the first token as the number on **this** card (not a global meaning):

| They type | Means |
|---|---|
| `1` `yes` `y` `sì` `si` `ok` `va bene` | option 1 |
| `2` | option 2 |
| `3` | option 3 |
| `4` | option 4 (send-preview only) |
| `stop` `basta` | the Stop option on this card |
| `comment` `jira` | option 1 on the refuse card (show the comment preview) |
| `again` `new` `regenerate` | option 3 on the send-preview card (write the comment again) |
| a sentence with a result (and no `1`/`2`/`3`/`4`) | paste / option 2 on the refuse and read-back cards |

`--ci` picks option 1. On a refuse card that is: comment on Jira (ticket is not complete), then stop. `--ci` skips the send-preview and posts. `--dry-run` still does pause 1; at pause 2 it prints the card and stops with no write. Never post on `--dry-run`, even if they confirm the preview.

### Pauses (three, always this shape)

**Pause 1 — after score, before any target or draft.** Pass: read-back (`--ci` skips / auto-yes). Refuse: the card below (`--ci` takes 1: skip preview, post the Jira comment, then stop).

```
I read [<KEY>](<browse-url>) — <summary>

We will check:
  • <plain sentence from the ticket Then>

1. Yes, that's right
2. No — I'll type the right result
3. Stop
```

If **refuse** (below 60%), show this card **first**. Do not post Jira and do not generate until they pick.

```
This ticket needs a bit more information. We cannot start yet.

1. Post a comment on Jira with what to add.
2. I will add the missing information here.
3. 🔴 **[RISK / NOT RECOMMENDED]** Continue anyway (developers only). The user story is not complete.
```

Option 3 is always shown with that 🔴 tag, word for word. Chat cannot color text, so the emoji is the red.

- **1 / Stop / comment:** do **not** post yet. Run `--refuse-comment` (below), then show the **send-preview** card, then **end the turn**. Hard no until they confirm.
- **2:** the guided fill-in below. Do not ask your own questions and do not invent what is missing: the script decides both.
- **3 Continue anyway:** development override. **Do not** post the Jira comment. Proceed to draft only if `derivable ≥ 1` (there is something to check). If `derivable === 0`, stay on this card with one extra sentence: `There is nothing to check yet — paste what should happen, or stop.` When you do proceed, the pipeline run **must** get `--incomplete-ticket` and the audit JSON must carry `template_score` and `template_threshold`, so the result card, `run.md` and the audit log all open with the red `[RISK / NOT RECOMMENDED]` line. `--ci` never takes 3.

**Guided fill-in (refuse option 2, and send-preview option 2).** Three script calls, each shown as printed (drop the `FILL_JSON:` line, it is for you). End the turn after every card.

1. **The list.** Run `score-ticket.mjs --in @.claude/audit/tickets/<KEY>/ticket.json --fill-menu`. Show its card: the score, the bar, and each missing criterion with the points it adds. QA types the numbers they want to fill (`1 3`).
2. **The pick.** Run `--pick "<their numbers>"`. Show its one line. Not enough → show the list card again (cap 2, then the refuse card). Enough → go on. An unknown number → show the line and the list again.
3. **One criterion at a time,** in the order picked. Print the item's `question` and `example` from `FILL_JSON` as:

   ```
   <title>
   <question>
   For example: <example>

   Type your answer, or "skip".
   ```

   Run `--add <key> "<their answer, verbatim>"`. Show its line. `Accepted.` → next criterion. `Not accepted:` → show it and ask again; after 2 rejections on one criterion, move on. `skip` → move on. Only `--add` writes the ticket file, and only when the answer counts. Never edit the file yourself on this path, and never post the answers to Jira.

After the last criterion: re-score with the normal call (this one is audited). Still `refuse` → the refuse card again. `pass` → this card (skip it if nothing was accepted; `--ci` never shows it):

```
The ticket now has <score> points (the bar is <threshold>).

1. Continue with the checks
2. Also add what you typed to the Jira ticket (I'll show it first)
3. Stop
```

- **1:** pause 1 read-back.
- **2:** run `--in @.claude/audit/tickets/<KEY>/ticket.json --jira-update`. Show its preview as printed (drop the `JIRA_UPDATE_JSON:` line), then this card and **end the turn**:

  ```
  1. Update the Jira ticket
  2. Do not update, just continue
  3. Cancel
  ```

  **1 / yes:** only now write to Jira. Fetch the ticket fresh (`getJiraIssue`, `fields: ["description", "labels", "summary"]`, `responseContentFormat: "markdown"`), then one `editJiraIssue` (`contentFormat: "markdown"`) that sets **only** what `JIRA_UPDATE_JSON` names: `description` = the fresh description + a blank line + `append`; `labels` = the fresh labels plus `labelsAdd`; `summary` = `[<titlePrefix>] ` + the fresh summary without its old `[..]` prefix, only when `titlePrefix` is set. Never send the sanitized text from disk, never rewrite or reorder what is already on the ticket. Then one sentence: `The Jira ticket has been updated.` and the pause 1 read-back. If the call fails: `Could not update the Jira ticket.` and the pause 1 read-back. **2:** pause 1 read-back, nothing sent. **3 / stop:** stop, nothing sent.
- **3 / stop:** stop.

`--dry-run` shows the preview and stops; it never writes to Jira.

**Send-preview (only after refuse option 1).** Nothing is on Jira yet. Show the `--refuse-comment` stdout as-is. Do **not** add `<!-- /spec refuse -->` (Jira shows that as text). Do not rewrite. Then this card, then **end the turn**:

```
Comment preview (not posted yet):

<the comment>

1. Post this comment to Jira
2. Do not post. I will add the missing information here.
3. Generate the comment again
4. Cancel
```

- **1 / yes:** post (below), then one sentence: `The comment has been posted. Work has not started.` Then end. Hard no.
- **2:** do not send. Start the guided fill-in (same as refuse option 2).
- **3 / again:** do not send. Fetch the ticket again, sanitize, score, run `--refuse-comment`. Do **not** write the comment by hand. If the new score is `pass`, leave refuse: show the pass read-back card, then end the turn. If still `refuse`, show this send-preview again with the new text, then end the turn. Cap 2. After 2, stay on this card with one extra sentence: `The comment has been generated twice. Please post it, add the missing information, or cancel.`
- **4 / stop:** do not send. One sentence: `The comment was not posted.` Then end.

`--ci` skips this preview and posts. `--dry-run` may show the preview; never post.

**Jira comment (only after send-preview option 1, skip on `--dry-run`, refuse 3, and send-preview 2/3/4):**

```bash
node .claude/harness/score-ticket.mjs --in @.claude/audit/tickets/<KEY>/ticket.json --refuse-comment --no-audit
```

The comment is built from the rubric and ends by naming the template the ticket should have
followed — `.gitlab/issue_templates/Story.md` or `Bug.md`, the two the GitLab template menu offers.
Do not paste the template into the comment and do not rewrite that line.

Post that stdout **verbatim** with `addCommentToJiraIssue`:
- `cloudId`: `https://teamsystem.atlassian.net`
- `issueIdOrKey`: the ticket key
- `commentBody`: the stdout (do **not** prepend `<!-- /spec refuse -->`)
- `contentFormat`: `markdown`

If an existing comment contains `Thanks, we can continue as soon as these are on the ticket.`, the older `Thanks — we can continue as soon as these are on the ticket.`, **or** `<!-- /spec refuse -->` (oldest posts), pass that comment's `commentId` to update it instead of adding another. Do not rewrite the body. If the comment call fails, still stop; one extra sentence: `Could not comment on Jira.`

**Pause 2 — after draft is ready, before write** (`--ci` writes). Same "We will check" bullets:

```
1. Write the checks
2. Change what we check
3. Stop
```

Option 2: wait for the new result, then pause 2 again (cap 2). `--dry-run`: print this block and stop.

**Pause 3 — after the pipeline stdout** (`--ci` skips). Paste the stdout card, then:

```
1. Done
2. That's not what I see in the app
3. Another ticket
```

Option 2: wait for what they see. If they give a different expected result, update Then + expected file and re-run (counts as a retry). Do not weaken the check to match the bug. Option 3: ask for the key, restart at step 1. Do not recap the stdout.

## Steps (top-down)

1. **Resolve the ticket.** Same as `/ticket` (config, key vs bare digits + `defaultProject`). No arg → scan last ~20 messages for `[A-Z]+-\d+` (skip `FIC-XXX` placeholders). One candidate: confirm. Several: numbered list. None: stop. Fetch `getJiraIssue` with `fields: ["*all"]` and `comment`. Also fetch `getJiraIssueRemoteIssueLinks` (GitLab MRs often live there, not in the description). Browse URL `<site>/browse/<KEY>`; cache site URL. Every key is `[<KEY>](<url>)`. Put remote-link `url`s on the raw JSON as `remoteLinks: [{url}]` so sanitize can see them.
2. **Sanitize, then score.** Never draft from the raw issue.    Write the fetched JSON via the Write tool to `.claude/audit/tickets/<KEY>/raw.json`, then:

   ```bash
   node .claude/harness/sanitize-ticket.mjs --in @.claude/audit/tickets/<KEY>/raw.json --out .claude/audit/tickets/<KEY>/ticket.json
   node .claude/harness/score-ticket.mjs --in @.claude/audit/tickets/<KEY>/ticket.json [--ci] --json
   ```

   Delete the `.raw.json` after sanitize. Use `--in @file` (never inline JSON). Score from the sanitized file only. JSON: `{key, browse, issuetype, status, summary, labels, text:{description, acField}, gitlab}`. `gitlab` is `{url, iid}` when the ticket (body, comments, or remote links) contains a GitLab merge-request URL; otherwise `null`. Do **not** pass `scenarios` to move the gate — `derivable` is counted from Then/Allora / expected-behavior **in the ticket text**. Carry `score, gate, legacy, missing, derivable`.

   **Expected tokens (after score, does not move the gate).** From the sanitized ticket only, list 1–5 pinable tokens: numbers (keep the sign: `-5` not `5`), field names (`unit_cost`), quoted strings, `italian`/`english`, `exact`. Not a full Then sentence. Write a JSON array to `.claude/audit/tickets/<KEY>/expected.json`. Invented tokens are dropped by the pipeline — only copy phrases that appear in the ticket Then/expected text. The harness also requires snake/camel names from the Then on `expect(…)` even without this file (`unit_cost` matches `unitCost`; `toBe(80)` on `unitPrice` is not enough). On the confirm card, turn those tokens into plain "We will check" sentences — never dump the raw pin list.

   **Gate (here, before any target or draft work).** Do not mention scores to QA.
   - **`pass`** → pause 1 read-back. `--ci` auto-continues.
   - **`refuse`** → pause 1 refuse card (comment preview / paste / continue anyway). **1** = show send-preview, post only if they confirm. **2** = guided fill-in. **3** = development continue, no Jira comment (needs `derivable ≥ 1`), run with `--incomplete-ticket`. `--ci` takes **1** (skip preview, post). Do not draft unless they picked 3 or re-score is `pass`.

   Symptom bucket (one line): **Read / display** → repos `find*` / mappers; **Write / create** → services `.create`/`.update`; **Compute / aggregate** → KPI; **Sync / event** → handlers / cache; **Unknown** → ask. For a **Bug**, the bucket is a hint for grep, not the target: a KPI/display/valuation symptom is a service, not `TradeItemRepository.get`.

3. **Pick target** (first match): named spec in ticket → strip `.spec.ts`; `--path`; **GitLab MR on the ticket** (below); path in the ticket text; root-cause grep; `git diff` of files in the bucket; keyword grep in the bucket.

   **If `gitlab` is set** (a merge-request link was on the ticket — not a flag): use it only to pick the file. The ticket Then still wins. Do not paste the diff.

   ```bash
   iid=<gitlab.iid>
   git fetch origin "merge-requests/$iid/head:mr-$iid"
   base=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo origin/develop)
   git diff "$base"...mr-$iid --stat -- 'src/**/*.ts' ':!src/generated'
   ```

   Fetch once. If it fails, continue (do not paste a GitLab error). From the changed files, pick `--target` (for a Bug, a `*service.ts` over a `*repository.ts`). Several services → numbered choice. Each option is one product sentence (what the user would see); type `1`, `2`, or `stop`. `--ci` refuses if still ambiguous.

   **Bug tickets — aim at the defect, not the nearest read.** A regression anchor must sit on the function that *chooses or computes the wrong value*. Grep the wrong field/sign (`unitPrice` vs `unitCost`, an outgoing sign) and target the site that *reads* it wrong — a service/aggregation — not the repository read that returns the raw column. Pass that path as `--target` into the pipeline (do not let `new Foo(` decide). The expected-result check fails a Bug whose spec only instantiates a `*Repository` for a KPI/cost/stock symptom, or feeds `stockOnHandDelta: -<n>` into `upsertKpiStock`.

   **Target gate:** the picked path must exist, sit under `src/`, and not be `generated/` or `dist/`. Missing or ambiguous → don't guess; numbered choice with product sentences (`1` / `2` / `stop`). `--ci` refuses. Once resolved, read the git diff of the target (context only, never paste).
4. **Style + QA plan.** Read the target. Sibling `src/…/*.spec.ts` is style reference for mocks of Redis/Dapr/HTTP only — do not copy Prisma mocks. If `test/qa-plans/<Feature_Label>.md` exists, **read it** as extra invariants; the **ticket `Then` wins** if they disagree. Do not append to that file.
5. **Draft the live specs** (skip a layer that does not apply — see [layers.md](layers.md)). Mapping: `src/common/services/kpi/kpi.service.ts` → `test/<layer>/common/services/kpi/kpi.service.spec.ts`. Each file: top-level ``describe(`<KEY> — <summary>`)``. If that describe already exists, **edit it** so it matches this ticket's Then (strengthen/add; honesty-check fails deleted `expect(`). Do not skip a hollow existing anchor.

   **For a Bug, one anchor that reaches the defect beats three that don't.** Only write a layer whose test executes the buggy function from step 3 and would go **red** if the defect returned. Assert the ticket's **expected** value (80), not the actual (150). Put the step-2 tokens in a positive `expect(…)` (matcher arg or the `expect(subject)`). Skip repository column-mapping and pre-signed deltas.

   Harvest seed facts from Given / expected-actual / `## Data / fixtures` — every named field becomes a row ([seed.md](seed.md)).

   - **Unit:** one method, `startLiveDb()` + real class + real Prisma. Mock Redis/Dapr/HTTP/queues only.
   - **Integration:** two+ collaborators (service + real repos + Prisma). No HTTP app. Do not mock the repository that holds the field under test.
   - **Range:** 2–4 `fast-check` `fc.asyncProperty` inside a normal `it(...)` that contains `expect(`. `numRuns: 20`. Invariants: ticket Then → hardcoded (`unit_cost` not `unit_price`; outgoing never increases `stockOnHand`; `deletedAt: null`) → QA plan (never overrides the Then). `--no-edges` skips extra edge `it`s, not range.
   - **API:** HTTP against Testcontainers Postgres + Redis + `warehouse-read` (`startLiveApi()`). For Read / display tickets. Seed with `api.prisma()`, `fetch(api.baseUrl)`. Rebuild `warehouse-backend-warehouse-read` after source changes.

   `--mocked`: also write the old sibling `src/…/*.spec.ts` with factory mocks. Pass `--mocked` to the pipeline so the boundary guard allows those spec files.

6. **Pause 2, then write.** Print pause 2. `--dry-run`: stop, no write. `--ci`: skip. Then Write/Edit **only** under `test/` (plus `src/**/*.spec.ts` if `--mocked`). Do not paste spec code into chat. Do not write production `src/`, `prisma/`, `.env`, or `.gitlab-ci.yml`.
7. **Pipeline.** Do not skip this, and do not call a green run that never executed.

   **Post one line before the command.** The tool call renders nothing until it returns, so QA
   otherwise watches a blank chat for minutes. Say what is about to run and roughly how long:

   ```
   Running the checks now — the tests, then: nothing deleted, every test asserts something,
   the right expected result, the type-check, and the assertion-mutation gate. 2–4 minutes.
   ```

   ```bash
   node .claude/harness/run-pipeline.mjs \
     --key <KEY> \
     --spec test/unit/…spec.ts \
     --spec test/integration/…spec.ts \
     --spec test/range/…spec.ts \
     [--spec test/api/…spec.ts] \
     --target <step-3 src path> \
     --ticket @.claude/audit/tickets/<KEY>/ticket.json \
     --expected @.claude/audit/tickets/<KEY>/expected.json \
     [--mocked] [--no-mutate] [--fast] [--no-stryker] \
     [--incomplete-ticket] \
     --audit '<json>'
   ```

   `--ticket` is required (the sanitized ticket JSON). `--expected` is the step-2 token file; the pipeline **grounds** each token in the ticket text (drops invented ones) and requires the rest in `expect(…)`. `--target` is the step-3 path (not a guess from `new Foo(`). `--fast` / `--no-stryker` on a **Bug** fails `stryker_unavailable`. Docker down fails `not_executed` (specs may exist; the run is not green). Stryker is a repo **devDependency** (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`); a missing binary after `npm ci` is still `stryker_unavailable` — do **not** rewrite the spec. A red Bug is already self-proving; Stryker is not required. `--audit` needs **issuetype** and **status** (from the sanitized ticket). `--incomplete-ticket` only after refuse option 3; with it, `--audit` also carries `template_score` and `template_threshold` from the gate.

   **Show the pipeline stdout, then pause 3.** Do not rewrite or recap the card. Keep the `More:` line if stdout has it (the run log). If stdout has no `More:` line, do not mention a run log. Paths, npm, and flags otherwise stay in that file. If the card says Jira is TEST OK and the test failed, that is the finding — not a failed generator. `--ci`: no pause 3.

   **Retry a fixable fail (cap 2), don't just report it.** Silent on chat until the last run's stdout.
   - `mutation_survived` → bind the real expected value, then re-run.
   - `bug_anchor_hollow` / `hollow_target` → re-pick the target at the code that computes the wrong value, rewrite, re-run. A column-mapping read is always hollow.
   - `expected_mismatch` → the spec asserted the actual (buggy) value, omitted a Then number (32 is not 58.86+32), used the wrong sign (`toBe(5)` vs stays −5), put the right number on the wrong field (`unitPrice` vs `unit_cost`), or a sibling file never pinned the Then. Assert the ticket's Then in **each** spec file.

   Do **not** retry by rewriting tests on `stryker_unavailable`. The QA card already says ask a developer; the run log has the install / flag fix. Give up after 2 retries on the rewrite cases. `honesty_check_failed` / `suite_honesty_failed` / `types_failed` / `boundary_guard_failed`: fix the write once, no auto-loop.

## Guardrails

- Run sanitize before scoring or drafting. Customer ids (`U######`, placeholder UUID, `user@example.test`).
- Never invent expected tokens that are not in the sanitized ticket text. The pipeline drops them anyway; they must not become the Then.
- Jira is read-only except the refuse comment: after send-preview confirm, `addCommentToJiraIssue` with `--refuse-comment` stdout, verbatim (no HTML tag). `cloudId` = `https://teamsystem.atlassian.net`. Never post from the first refuse card. Update an existing comment that contains the footer or the old `<!-- /spec refuse -->` tag.
- Instantiate classes directly — no `Test.createTestingModule`.
- `deletedAt: null` on read assertions. Types from `@prisma-client`. Isolation: `db.restore()` in `beforeEach` and inside each `fc` iteration.
- Prefer `??` over `||`.

## Pause blocks (copy these)

No intro around a pause. If Docker must be on, one sentence under pause 2.

Refuse send-preview (after they pick 1 on the refuse card; not on `--ci`):

```
Comment preview (not posted yet):

<the comment>

1. Post this comment to Jira
2. Do not post. I will add the missing information here.
3. Generate the comment again
4. Cancel
```

Ambiguous target (between pause 1 and 2):

```
Which of these matches what you see?
1. <product sentence>
2. <product sentence>
3. Stop
```

## Examples

- `/spec FIC-13441` — live specs for the KPI unit_cost bug, aimed at the service that picks the field (`--target src/common/services/movement/movement.service.ts` or the KPI valuation), never `TradeItemRepository.get`.
- `/spec FIC-13441 --path src/common/services/movement/movement.service.ts` — same, explicit path.
- `/spec FIC-13441 --mocked` — also a factory-mock sibling under `src/`.
- `/spec FIC-13441 --ci --path src/common/services/movement/movement.service.ts` — `--ci` still runs the expected-result check + source-red; a hollow or unproven Bug exits 1.
