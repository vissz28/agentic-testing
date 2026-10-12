---
name: spec-frontend
description: >-
  Write browser tests (Playwright + an XRay case) for a FIC Jira ticket in the
  warehouse-FRONTEND repo, or just the API stub data for one. Use when the
  warehouse-frontend folder is open and QA says /spec-frontend or /seed, pastes a
  FIC- key, asks to check a ticket, or asks for the seed data / stubs / fixtures for
  a ticket. Do NOT use for warehouse-backend — that repo has its own spec-backend skill.
---

# Spec (frontend) — Playwright + XRay from a Jira ticket

## Where this runs (check this FIRST, before Jira, before anything)

**Claude Desktop** (or Claude Code) with the **`warehouse-frontend`** folder open.

Both repos now keep the harness in **`.claude/harness/`**, so the harness path no longer tells them apart. The **`e2e/` folder** does: the frontend is Playwright with `e2e/tests/`, the backend has no `e2e/`.

- **`.claude/harness/run-pipeline.mjs` and an `e2e/tests/` folder both exist** -> this is the right repo. Continue.
- **`.claude/harness/run-pipeline.mjs` exists but there is no `e2e/` folder (you see `nest-cli.json`)** -> you are in **warehouse-backend**. Say exactly: `This is the backend repo. Use the spec-backend skill for this folder.` Then **stop**. Do not read Jira, do not score, do not write.
- **Neither** -> say `Open the warehouse-frontend folder so I can run the checks.` Then stop. Do not invent files.

This guard exists because both repos answer to "write tests for a FIC ticket" and both keep the harness in `.claude/harness/`. The `e2e/` folder on disk decides which one is correct, not the wording of the request.

Two ways in, same machinery after Step 4. **A Jira ticket** (the normal run, everything below), or **a manual test case QA already wrote** in an XRay sheet under `.claude/harness/qa-plans/` — the blueprint's "reads the existing test suite from Xray" half (Appendix §3), for the 54 multi-warehouse cases that exist as prose and nothing else. The case path skips Jira and the readiness gate entirely (see Step 2b): a hand-written QA case *is* the acceptance criteria, so there is nothing to score.

From `$ARGUMENTS`: (1) XRay rows → `.claude/harness/warehouse-testcases.csv` + `e2e/tickets/<KEY>/case.{xlsx,csv}`, (2) Playwright spec under `e2e/tests/`, same test key, (3) if Figma URL → `e2e/tickets/<KEY>/`. Read-only on Figma, and on Jira except one refuse comment (Step 2) and, only when QA confirms the preview, appending their guided fill-in to the ticket. Never modify `src/`. A **readiness gate** runs first (`/ticket-eval`'s scorer): below **70%** the ticket is **refused** — there is no warn band and a readable `Then` no longer rescues a thin ticket — and this skill offers to comment on Jira instead of generating. See Step 2. Beyond the ticket's acceptance criteria, the run also proposes **edge cases the ticket did not state** (empty, long text, numeric bounds, locale, …) — this is where it catches what a "done" feature missed. They are reported as their own section, so a green feature with a red edge reads as "the team missed this", not a broken run; skip with `--no-edges`. Assertion mutation (strict flips on baseline-green `expect`s — invert matchers / corrupt expected strings; not delete-expect) is part of the pipeline and **gates** the run: a surviving mutant is a passing test whose assertion does no real work, so the run fails (verdict `mutation_survived`). Default threshold 100% killed — any survivor fails; relax with `--mutation-threshold <pct>` or skip with `--no-mutate`. Not Stryker.

## Data only (`/seed`)

QA typed `/seed`, or asked for **just the data** — the stubs, the fixtures, the rows. Same ticket,
no test, nothing to grade.

Do the **"Where this runs" check above, then Steps 1, 2 (ticket + readiness gate), and 4 (route)**
only — skip Figma, the MR diff, the draft, the review gate and the pipeline. Then follow
[seed.md](seed.md) and emit **only** the `page.route(...)` stubs: no `test()` / `expect`, no
`run-pipeline.mjs`.

## Token discipline (hard)

- Atlassian MCP missing → **stop once**: `error: atlassian-rovo MCP not available` — no transcript/cache archaeology, no MCP catalog sweeps.
- Jira: **only** fields `summary,issuetype,status,labels,description,customfield_11707,issuelinks` — **never** `*all` or full comment dump. Scan description (+ labels + `issuelinks`) for Figma/GitLab URLs; skip comments unless description has no AC and no Figma. Remote/web links are a separate API call — **out of scope** (a design attached only as a web link is not fetched).
- MR diff is **optional context, never required**. Source is **local git** (this repo IS the GitLab project `oneplatform/islands/microsme/warehouse-frontend`); the official GitLab MCP (`mcp__gitlab__*`) is preferred **only if** those tools exist this session (instance had it disabled as of Aug 2026 — 404 at `/api/v4/mcp`). Can't resolve a diff → one line `no MR diff — <reason>` and continue (unlike Jira, which stops the run). Look at **only** the changed-files diff for one MR; ignore lockfiles, snapshots, generated/`dist`; read only frontend paths (`src/**` `.tsx`/`.ts`, i18n `*.json`). Never paste the raw diff into chat — use it to fix selectors/strings, then say in one line what it changed.
- Do **not** explore `src/`, agent transcripts, or unrelated specs. Template: read **one** file — prefer `e2e/tests/<route-slug>/*.spec.ts` sibling, else `e2e/tests/products-stock.smoke.spec.ts`.
- After write: run **one** shell — `node .claude/harness/run-pipeline.mjs …` — and **relay its stdout verbatim** as the post-run report. stdout is the QA card (everyday words, no paths); sub-tool chatter goes to stderr and the detail to `e2e/tickets/<KEY>/run.md`. Do not re-derive honesty/tsc/e2e/audit by hand. Do not paste the spec into chat.

## How to talk

The human is QA, in **Claude Desktop** (text chat, no buttons). They type `1`, `2`, or `3`; the send-preview card also has `4`.

- Short sentences. Everyday words. Ticket language (Italian if the ticket is Italian).
- Chat never contains: file paths, `src/`, `e2e/`, npm, flags (`--mr`, `--ci`, `--no-edges`), scores, readiness %, route slugs, XRay / CSV / xlsx mechanics, GitLab, Figma node ids, or spec source. **Exception:** keep the pipeline card's `Full details: <absolute path>` line when it is present — it is the run log, and it is the one path QA is meant to see. **Relay it verbatim, including that last line.** If the line is missing, the log was not written — do not invent a path.
- No clickable forms, no `AskQuestion` tool, no extra UI. A numbered block in the transcript is the whole interaction.
- After printing a pause block: **end the turn**. No more tools, no recap, no "waiting for you". The next user message is the answer.
- Keep paths, scores, and flags in the pipeline command and the run log.

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

`--ci` picks option 1. On a refuse card that is: comment on Jira, then stop (exit 1). `--ci` skips the send-preview and posts. `--dry-run` still does pause 1; at pause 2 it prints the card and stops with no write. **Never post on `--dry-run`**, even if they confirm the preview.

### Pauses (three, always this shape)

**Pause 1 — after the readiness gate, before the MR diff, the Figma download, or any drafting.** Pass → the read-back card (`--ci` auto-yes). Refuse → the refuse card. **Case source (Step 2b) skips pause 1 entirely** — a hand-written QA case is already the acceptance criteria, so there is nothing to score.

```
I read [<KEY>](<browse-url>) — <summary>

We will check:
  • <plain sentence from an AC Then>

1. Yes, that's right
2. No — I'll type the right result
3. Stop
```

**Pause 2 — after the draft is ready, before any write** (`--ci` writes). Same "We will check" bullets, no file names:

```
1. Write the checks
2. Change what we check
3. Stop
```

Option 2: wait for the new result, then pause 2 again (cap 2). `--dry-run`: print this block and stop.

**Pause 3 — after the pipeline stdout** (`--ci` skips). Paste the card as-is, then:

```
1. Done
2. That's not what I see in the app
3. Another ticket
```

Option 2: wait for what they see. If they give a different expected result, update the AC and re-run. **Do not weaken a check to match the bug.** Option 3: ask for the key, restart at step 1. Do not recap the card.

## Steps

1. **Parse args.** First `[A-Z]+-\d+` = ticket key. **An arg ending `.xlsx` = case source** — then the next quoted arg is the sheet and the next number is the TC ID, both optional (Step 2b). With **both** an `.xlsx` and a ticket key, the sheet is the content and the key is only the traceability link (QA left `Ticket collegati` blank, and the XRay row needs it). Flags: `--mr <ref>` (MR override — full URL or `!<iid>` or a branch/SHA; feeds the diff step when the ticket/git can't resolve it, e.g. a dev-panel-only MR), `--ci` (no prompt), `--dry-run` (print plan, write nothing), `--qa-only` (pipeline skips e2e/tsc/suite/mutate — export path; verdict is `not_run`, never `green`, because nothing was checked), `--no-mutate` (skip the mutation gate), `--mutation-threshold <pct>` (lower the kill-rate the gate demands; default 100), `--no-edges` (skip the edge-case tests — Step 5b). Neither → `pass a ticket key or a qa-plan sheet: /spec-frontend <KEY> | /spec-frontend .claude/harness/qa-plans/<plan>.xlsx`.

2. **Read ticket.** `mcp__atlassian-rovo__getJiraIssue` with the field list above (`cloudId`: `teamsystem.atlassian.net`). Harvest:
   - `summary`, `issuetype`, `status`, `labels`.
   - **AC** — Gherkin `Scenario` / `Given` / `When` / `Then` from (a) `## Acceptance criteria` in description and (b) `customfield_11707`; dedupe by scenario name; prefer description on conflict. Neither → one derived scenario + `shallow ticket — AC missing`.
   - **Feature label** ∈ `Lista_Movimenti_Magazzino | Report_Magazzino | Giacenza_Prodotti | Importa_Giacenze | arrivi_merce_magazzino | Il_mio_magazzino | Minimum_stock | Spinta_warehouse`.
   - **Figma** `figma.com/(file|design)/…` in description; if absent, scan `labels` then `issuelinks` (a linked design ticket); comments only if still none. Remote/web links are deliberately not fetched (out of scope).
   - **MR ref** — precedence: `--mr <ref>` flag > an MR URL/`!<iid>` in `summary`/description (smartlinks render the URL inline in markdown, so a plain scan catches them) > **the ticket key itself** (the reliable path — branches are named `<KEY>-…` and merge commits carry the key, so most MRs resolve from `<KEY>` with nothing in the ticket text; this is why dev-panel-only MRs are still reachable). None resolvable → skip the diff step.
   - Browse: `https://teamsystem.atlassian.net/browse/<KEY>`.

   **Readiness gate — run this before the MR diff, the Figma download, drafting, or the pipeline; it is where a ticket with too little information stops.** Hand the raw harvest to the scorer and let it decide (fail-fast: don't spend the diff read / Figma download / draft / Playwright run on a ticket that cannot yield a real test). The scorer detects the structure itself — it does **not** want judged booleans. **QA plan: only if the ticket links a Confluence page** in `issuelinks` — read that one page and pass it as `qaPlan`; otherwise `qaPlan:null` and do **not** go searching (a missing plan lowers the score, it never blocks). Then one shell:

   ```bash
   node .claude/harness/score-ticket.mjs --in '<json>' [--ci] --json
   ```
   `<json>` is the `/ticket-eval` shape (structural — raw text, not booleans): `{key,browse,issuetype,status,labels:[…],text:{description,acField},scenarios,qaPlan,figma,mr,flags}` — `text.description` is the raw ticket description, `text.acField` the raw `customfield_11707`. The scorer derives the score, gate, `legacy` flag, feature + route.

   **`scenarios` no longer moves the gate — fill it honestly anyway.** The rubric is the whole gate: `score ≥ 70` → `pass`, below → `refuse` (exit 1), interactive **and** `--ci`. A concrete `Then` read out of the prose is still counted (`derivable`) and still shapes the draft, but it does not rescue a thin ticket — that rescue is exactly what let every prose ticket through as a "regression anchor" and meant Before-Code never pushed anything back. You are not supplying a number and you cannot move the score; the scorer judges the scenarios itself and drops any vague `Then` (`works correctly` / `funziona correttamente`) or one that states no `Then` at all. Padding the list buys a run that then fails `suite-honesty` or `mutate-generated` on the hollow test it produces — so write what the ticket actually supports.

   **Gate — branch here, before the MR diff, the Figma download, or any drafting. Never say the score to QA** (one exception: the guided fill-in lines below, shown as the script prints them, points included). Carry `gate`, `legacy`, `missing`, `derivable`, and `qaPlan.scenarios` forward.

   - **`pass`** → the pause 1 read-back card. `--ci` auto-continues.
   - **`refuse`** → the card below. Most current tickets are prose and will land here; that is the point (see `.claude/TICKET_TEMPLATE.md`). `--ci` takes **1**: post the comment, then exit 1.

   ```
   This ticket needs a bit more information. We cannot start yet.

   1. Post a comment on Jira with what to add.
   2. I will add the missing information here.
   3. 🔴 **[RISK / NOT RECOMMENDED]** Continue anyway (developers only). The user story is not complete.
   ```

   Option 3 is always shown with that 🔴 tag, word for word. Chat cannot color text, so the emoji is the red.

   - **1 / `stop` / `comment`:** do **not** post yet. Run `--refuse-comment` (below), show the **send-preview** card, then **end the turn**. Hard no until they confirm.
   - **2:** the guided fill-in below. Do not ask your own questions and do not invent what is missing: the script decides both.
   - **3 Continue anyway:** development override. **Do not** post the Jira comment. Draft only if `derivable ≥ 1` (there is something to check). If `derivable === 0`, stay on this card with one extra sentence: `There is nothing to check yet — paste what should happen, or stop.` When you do proceed, the pipeline run **must** get `--incomplete-ticket` and the audit JSON must carry `template_score` and `template_threshold`, so the QA card, `run.md` and the audit log all open with the red `[RISK / NOT RECOMMENDED]` line. `--ci` never takes 3.

   **Guided fill-in (refuse option 2, and send-preview option 2).** First write the exact `<json>` you scored to `e2e/tickets/<KEY>/harvest.json` (gitignored: it is raw ticket text). Then three script calls with `--in @e2e/tickets/<KEY>/harvest.json`, each shown as printed (drop the `FILL_JSON:` line, it is for you). End the turn after every card.

   1. **The list.** `--fill-menu`. Show its card: the score, the bar, and each missing criterion with the points it adds (never the QA plan; the author cannot fix that). QA types the numbers they want to fill (`1 3`).
   2. **The pick.** `--pick "<their numbers>"`. Show its one line. Not enough → the list card again (cap 2, then the refuse card). Enough → go on. An unknown number → the line and the list again.
   3. **One criterion at a time,** in the order picked. Print the item's `question` and `example` from `FILL_JSON` as:

      ```
      <title>
      <question>
      For example: <example>

      Type your answer, or "skip".
      ```

      `--add <key> "<their answer, verbatim>"`. Show its line. `Accepted.` → next criterion. `Not accepted:` → show it and ask again; after 2 rejections on one criterion, move on. `skip` → move on. Only `--add` writes `harvest.json`, and only when the answer counts. Never edit it yourself on this path, and never post the answers to Jira.

   After the last criterion: re-score with the normal call on `--in @e2e/tickets/<KEY>/harvest.json` (this one is audited) and carry that harvest forward as `<json>`. Still `refuse` → the refuse card again. `pass` → this card (skip it if nothing was accepted; `--ci` never shows it):

   ```
   The ticket now has <score> points (the bar is <threshold>).

   1. Continue with the checks
   2. Also add what you typed to the Jira ticket (I'll show it first)
   3. Stop
   ```

   - **1:** pause 1 read-back.
   - **2:** run `--in @e2e/tickets/<KEY>/harvest.json --jira-update`. Show its preview as printed (drop the `JIRA_UPDATE_JSON:` line), then this card and **end the turn**:

     ```
     1. Update the Jira ticket
     2. Do not update, just continue
     3. Cancel
     ```

     **1 / yes:** only now write to Jira. Fetch the ticket fresh (`getJiraIssue`, `fields: ["description", "labels"]`, `responseContentFormat: "markdown"`), then one `editJiraIssue` (`contentFormat: "markdown"`) that sets **only** what `JIRA_UPDATE_JSON` names: `description` = the fresh description + a blank line + `append`; `labels` = the fresh labels plus `labelsAdd`. Never resend the harvest text, never rewrite or reorder what is already on the ticket. Then one sentence: `The Jira ticket has been updated.` and the pause 1 read-back. If the call fails: `Could not update the Jira ticket.` and the pause 1 read-back. **2:** pause 1 read-back, nothing sent. **3 / stop:** stop, nothing sent.
   - **3 / stop:** stop.

   `--dry-run` shows the preview and stops; it never writes to Jira.

   **Send-preview (only after refuse option 1).** Nothing is on Jira yet. Show the `--refuse-comment` stdout **as-is** — do not rewrite it, and do not prepend `<!-- /spec refuse -->` (Jira renders that as visible text). Then this card, then **end the turn**:

   ```
   Comment preview (not posted yet):

   <the comment>

   1. Post this comment to Jira
   2. Do not post. I will add the missing information here.
   3. Generate the comment again
   4. Cancel
   ```

   - **1 / yes:** post, then one sentence: `The comment has been posted. Work has not started.` Then end. Hard no.
   - **2:** do not send. Start the guided fill-in (same as refuse option 2).
   - **3 / again:** do not send. Re-read the ticket, re-score, re-run `--refuse-comment` — do **not** write the comment by hand. New score `pass` → leave refuse, show the pause 1 read-back card, end the turn. Still `refuse` → show this preview again with the new text, end the turn. Cap 2; after that, stay here with one extra sentence: `The comment has been generated twice. Please post it, add the missing information, or cancel.`
   - **4 / stop:** do not send. One sentence: `The comment was not posted.` Then end.

   `--ci` skips this preview and posts. `--dry-run` may show the preview; it never posts.

   **Jira comment (only after send-preview option 1; skipped on `--dry-run`, refuse 3, and send-preview 2/3/4).** Same `<json>` you scored:

   ```bash
   node .claude/harness/score-ticket.mjs --in '<json>' --refuse-comment --no-audit
   ```

   Post that stdout **verbatim** with the Jira add-comment tool (`mcp__atlassian-rovo__addCommentToJiraIssue`, or `addCommentToJiraIssue` on the Claude Desktop Jira connector): `cloudId` `teamsystem.atlassian.net`, `issueIdOrKey` the ticket key, `contentFormat` `markdown`. If this session has no add-comment tool, do **not** improvise one — show the text and say `Copy this onto the ticket.` The comment ends by naming the template the ticket should have followed (`.gitlab/issue_templates/Story.md` or `Bug.md`); do not rewrite that line. If an existing comment contains `Thanks, we can continue as soon as these are on the ticket.`, the older `Thanks — we can continue as soon as these are on the ticket.`, **or** `<!-- /spec refuse -->` (oldest posts), update that comment instead of adding a second one. Do not rewrite the body. If the call fails, still stop; one extra sentence: `Could not comment on Jira.`

   **MR diff (skip if no ref resolved).** Read the changed-files diff for that one MR, frontend paths only (token rule above). Use it to pick real selectors (`data-testid`, roles, the i18n keys the code actually renders) over guesses from AC, and to catch behavior the AC left implicit.
   - If `mcp__gitlab__*` tools exist this session → use the MCP MR-diff tool with project `oneplatform/islands/microsme/warehouse-frontend` + iid.
   - Else **local git** (default today). Find the MR *merge* commit — the one where the `<KEY>` branch is the thing being merged IN (source), not a `develop into <KEY>` sync in the other direction; the target may be `develop` OR a feature integration branch (`feature/…`), so match on the source branch, not the target. Then diff **its two parents** — a plain `git show` on a merge prints nothing, and the squashed feature commit usually lacks the key, so neither shortcut works:
     ```bash
     G=("src/**/*.tsx" "src/**/*.ts" "**/i18n/*.json")   # frontend scope
     m=$(git log --all -i --grep='<KEY>' --merges --oneline | grep -iE "merge branch '(refs/heads/)?<KEY>" | head -1 | awk '{print $1}')
     git diff "$m^1" "$m^2" --stat -- "${G[@]}"           # files; then read only these hunks:
     git diff "$m^1" "$m^2" -- "${G[@]}"
     ```
     `--mr <branch|SHA>` given → skip the grep, diff it directly (`git diff origin/develop...<ref> -- "${G[@]}"`). No merge found → `git fetch origin` once, retry; still nothing → `no MR diff — not in local git` and carry on with AC only.

2b. **Read case (case source only — replaces Step 2 entirely).** No Jira call, no readiness gate, no MR diff. One shell, and let it do the reading — **never open the `.xlsx` yourself and never `@`-mention it**: it is a zip of XML, and 54 cases of Italian prose inlined so you can pick one is exactly what the token rule above exists to stop.

   ```bash
   node .claude/harness/read-case.mjs <file.xlsx> ["<sheet>"] [<TC ID>]
   ```
   Sheet or TC ID missing → it prints the picker (sheets + counts, or cases in that sheet). **Relay that and stop** — the human picks. With both, it prints one case as JSON: `{source,key,summary,intro,expectations[],steps[],feature,label,ticket,route}`. Then:
   - `key` is the test key (`MW-<feature>-<id>`) — it replaces `<KEY>` everywhere below, including the spec filename and the audit.
   - **`expectations` are the acceptance criteria.** QA leaves Azione / Risultato atteso blank and writes the case as a bulleted list in Description, so each bullet is one observable expectation — near enough to a `Then` to draft from. `intro` is the setup they all share (the `Given`, usually "for a user with more than one warehouse"). `steps` is normally empty; use it when a sheet does fill it in.
   - `route` null → the case is for a screen with no route yet (`Multi_Warehouse_Managing`, `Multi_Warehouse_DDT_trasferimento`). **Ask which screen to open, as the numbered card below; refuse under `--ci`.** Same rule as a ticket with no feature label. Non-null → skip Step 4, the route is already resolved.
   - **Linked ticket** — precedence: a ticket key passed alongside the file > the case's own `ticket`. `append-testcase.mjs` requires one (it groups the CSV and names the workbook by it), and QA left the column blank on every multi-warehouse row, so with neither: **ask for the key; refuse under `--ci`**. The multi-warehouse cases belong to FIC-11780. It also becomes the MR ref for the diff step — no ticket, no diff, say `no MR diff — case has no linked ticket` and carry on.
   - No Figma from a sheet → skip Step 3, behavioral only.
   - **Expect red.** Multi-warehouse (FIC-11780) is not built yet, so these specs fail on first run by design — blueprint §4 Step 3, tests written before the code. Tag them `@anchor` (Step 5) so CI parks them instead of failing. Say so plainly in the closing report so nobody reads it as a defect in the generator.

3. **Design (Figma URL only).** Extract `fileKey` + `node-id`. **Download** PNG → `e2e/tickets/<KEY>/figma.png` (`download_figma_images`, scale 2). **Skip `get_figma_data`** when AC `When`/`Then` already quote UI strings (use those for selectors). Call `get_figma_data` only if selectors cannot be derived from AC/i18n literals. No Figma → `no design` — behavioral only; skip visual capture + artifact.

4. **Route** from label:

   | Label | Route | Stub |
   |---|---|---|
   | `Giacenza_Prodotti` | `/products-stock` | `trade-items`, `warehouse/basic-info` |
   | `Lista_Movimenti_Magazzino` | `/movements-list` | `movements`, `trade-items` |
   | `Report_Magazzino` | `/warehouse-reports` | `reports`, `historical-reports` |
   | `Importa_Giacenze` | `/import-stock` | `adjustment-files`, `stock-files` |

   Missing label → ask, as a numbered card between pause 1 and pause 2. Each option is one product sentence (the screen QA would open), never a route or a label:

   ```
   Which screen is this about?
   1. <product sentence>
   2. <product sentence>
   3. Stop
   ```

   `--ci` refuses instead of asking.

5. **Draft.** The scenario set is the ticket AC merged with any `qaPlan.scenarios` the readiness gate returned (dedupe by name, ticket wins). **Case source:** the scenario set is `expectations` — one test per bullet, with `intro` as the shared `Given` and the bullet as the `Then`; keep QA's wording in the Gherkin comment so the row and the test read the same. A bullet too vague to assert on → `test.fixme`, never a padded assertion (it would fail `suite-honesty` anyway). Per scenario: key `<KEY>-<n>-<slug>`. **The `<slug>` is what QA reads on the result card** — the pipeline strips `<KEY>-<n>-` and turns the dashes into spaces, so write a readable phrase (3–8 words) that names the case in product terms, not a one-word tag: `italian-empty-state-on-the-movement-filter`, not `empty`. Say what should happen, not what the code does. XRay `{key,summary,ticket,steps:[{action,data?,expected}],description?,feature?,label?,priority?,epic?,testType?}` (`key` is the Playwright test name; `feature` → Componenti, `label` → Label; `testType` defaults to `Cucumber` — these are automated tests written from Gherkin, so they are filed as Cucumber, not Manual; pass `Generic` only for a non-Gherkin automated case; leave unknown metadata out rather than inventing it — TC ID is assigned automatically as an integer per ticket); one `test('<key>',…)` in `e2e/tests/<route-slug>/<KEY>.spec.ts` using `../../fixtures`, in-test stubs, `warehouse.goto`, role/label selectors, `Then` asserts; unknowns → `test.fixme` (never invent). When an MR diff was read, prefer selectors/i18n keys it shows over ones guessed from AC. Figma present → final `test('<KEY> — design-conformance capture',…)` with `page.screenshot` (never `toHaveScreenshot`). Gherkin as leading comment on each test.

   **Tag what is red on purpose.** A test that cannot pass on this branch yet carries a tag naming its ticket, which moves it out of the blocking CI gate (`e2e-frontend`) into the non-blocking `e2e-anchors` job: red AC test (the feature is not built) → `{ tag: ['@anchor', '@<KEY>'] }`; red edge test (a case the ticket missed) → `{ tag: ['@finding', '@<KEY>'] }`. When every test in the spec waits on the same feature, declare `const ANCHOR = { tag: ['@anchor', '@<KEY>'] }` once and pass `ANCHOR` as each test's second argument. Never tag a test that passes: the tag hides it from the gate. `honesty-check` fails a tag without its ticket tag, and an untagged red test fails the gate, so tag every red test the pipeline card shows before handing over.

   **5b. Edge cases (added to the same spec, unless `--no-edges`).** After the AC tests, propose the cases the ticket did **not** state — this is where the tool earns its keep, catching what a "done" feature missed. Pick the ones that apply to this route/feature from the checklist below (2–5 is plenty; don't stuff irrelevant ones). Each edge → its own `test('<KEY>-edge-<n>-<slug>', …)` — the **`-edge-<n>-`** in the key is what the pipeline uses to report edges as a separate section, so keep that shape. Same slug rule as above: it becomes the `Extra (not in the ticket): <slug>` line QA reads, so `product-name-longer-than-the-column`, not `long`. Also append an XRay row per edge (same `{key,…}` shape). Assertion policy, in order: (a) a **concrete** expected result when the AC / MR diff / i18n literals make one derivable; (b) else **graceful-handling** — the screen still renders and **no raw i18n key leaks** (`await expect(page.getByText(/^[A-Z][A-Za-z]+Message$/)).toHaveCount(0)`), no crash/blank; (c) truly unknowable → `test.fixme`. Never invent a specific expected value. One-line comment on each saying which edge it probes.

   FE edge checklist — pick what applies to the route:
   - **Empty** — zero items: the empty-state message renders, translated, no raw key (the EN/IT buckets differ — a real miss).
   - **Long text** — a 200+ char name/description: no overflow or overlap; truncation/wrap holds.
   - **Numbers** — zero, negative, decimals, very large: formatting holds, no `NaN`, any warning threshold fires.
   - **Missing fields** — null `kpi` / unit / optional column: graceful blank, no crash.
   - **Special chars / unicode** in a name or code: renders, and filtering still works.
   - **Large list** — 100+ rows: the grid still renders (no hang or blank).
   - **Locale** — run one key assertion in **both** `en` and `it`: catches translation divergence.
   - **Dates** — period boundaries / timezone where the screen uses dates.

6. **Pause 2, then write.** Print the pause 2 card (below): the "We will check" bullets in plain sentences, and nothing else — no file names, no score, no route, no XRay counts. `--dry-run` → print it and stop, write nothing. `--ci` → skip the pause and write (a `refuse` already stopped the run at the gate). Otherwise **end the turn** and wait for `1` / `2` / `3`. Option 2: take the corrected result, redraft, show pause 2 again (cap 2).

7. **Write.** Spec via Write/Edit. Each scenario: `node .claude/harness/append-testcase.mjs '<json>'` (idempotent). Figma: `meta.json` = `{browse,screen,figmaNode}`.

8. **Pipeline (replaces manual honesty/tsc/e2e/audit).** One command — relay stdout, do not reformat:

```bash
node .claude/harness/run-pipeline.mjs --key <KEY> --spec e2e/tests/<route-slug>/<KEY>.spec.ts [--qa-only] [--no-mutate] [--mutation-threshold <pct>] [--incomplete-ticket] --audit '<json>'
```

Audit JSON: `{feature,route,inputs:{source,scenarios,figma,mr},test_keys,reasoning,mode}` (`mr`: `<project>!<iid>` or `null`). Pipeline runs honesty → (unless `--qa-only`) tsc + e2e + suite-honesty + **assertion mutation** (`mutate-generated.mjs`) + visual build → appends `.claude/audit/xray-test.jsonl` → writes the developer run log `e2e/tickets/<KEY>/run.md` → prints the **QA card** on stdout. Honesty fail → stop. Red e2e on new AC = used as a regression anchor, not a broken run — tag it `@anchor` (Step 5). `types_failed` still fails the process. A surviving mutant below the threshold fails the run (verdict `mutation_survived`, exit 1) — fix the weak assertion, relax with `--mutation-threshold`, or skip with `--no-mutate`. The gate only fires when there were baseline-green expects to mutate (a spec that is all regression anchors has none, so it is not gated). With `--qa-only` nothing is verified, so the verdict is `not_run` and the card says so — it exits 0 (skipping the app is the point of that path) but never reports green. Edge tests are classified by the `-edge-` key and appear on the card as `Extra (not in the ticket)`. A red edge is a **finding** — a case the ticket did not cover — surfaced but not a process failure (exit 0); tag it `@finding` (Step 5).

   **Show the card whole, then pause 3.** Do not rewrite it, recap it, trim it, or add a closing summary — the card already lists every check that ran, passed ones included, with the reason under each failure. The **last line is `Full details: <absolute path>`; it must survive into chat**, because it is the only way QA reaches the run log (`.claude/` is a hidden folder). If stdout has no such line the log was not written — do not mention or invent a path. Tables, spec paths, mutation survivors, and the `npm` / flag fixes live in that file, for a developer. `--ci`: no pause 3.

## Pause blocks (copy these)

No intro paragraph around a pause, and nothing after it — print the block and end the turn.

Pause 2 (before any write). One bullet per check, in the words a QA would use. The edge cases are the ones the ticket never asked for, so say that:

```
We will check:
  • <plain sentence from an AC Then>
  • <plain sentence from an AC Then>

And these extras the ticket does not mention:
  • <plain sentence>

1. Write the checks
2. Change what we check
3. Stop
```

Case source (`.xlsx`): same block, with QA's own bullets as the "We will check" list. Multi-warehouse cases are expected to fail on first run — add one sentence under the block: `This feature is not built yet, so these will fail today. That is expected.`

The pre-write detail that used to be printed here (score, route, Figma node, MR files, spec path, XRay counts) is **not** for chat. It rides in the pipeline command and the run log.

## Guardrails

- Redact customer ids in literals.
- Closed ticket → still generate (regression anchor); flag status.
- Visual is QA sign-off, never a gate.
- Plain English in everything a human reads — the pause blocks, the **test slug** (it is the case name on the QA card), the XRay `summary`, the audit `reasoning`/verdict. Readers here use English as a second language and have no humanizer. Short sentences, common words. Spell things out instead of coining compressed compounds (write "used as a regression anchor" not "bug-anchor", "going back a step" not "back-nav"). Say plainly what happened and what to do next.
- Jira is read-only **except** the refuse comment: only after the send-preview card is confirmed, only the `--refuse-comment` stdout, verbatim, and never on `--dry-run` or refuse option 3. Never post from the first refuse card. Update an existing refuse comment rather than adding a second one.

## Examples

- `/spec-frontend FIC-13441`
- `/spec-frontend FIC-13441 --dry-run`
- `/spec-frontend FIC-13441 --qa-only` — XRay/visual export, skip e2e/mutate
- `/spec-frontend FIC-13441 --no-mutate` — full pipeline without assertion mutation
- `/spec-frontend FIC-13441 --no-edges` — only the ticket's AC tests, skip the edge-case probing
- `/spec-frontend FIC-13441 --ci`
- `/spec-frontend .claude/harness/qa-plans/multi-warehouse.xlsx` — which sheets are in the plan
- `/spec-frontend .claude/harness/qa-plans/multi-warehouse.xlsx "Lista movimenti"` — which cases are in that sheet
- `/spec-frontend .claude/harness/qa-plans/multi-warehouse.xlsx "Lista movimenti" 2 FIC-11780` — generate from QA's case 2, linked to the multi-warehouse ticket

## Maintainers only (not part of a normal ticket run)

Before editing **this file**: `node .claude/harness/evals.mjs`. Fixtures: `e2e/tickets/<KEY>/eval-{input,expected}.json`. Add a fixture when you change generator output shape.
