---
description: Score a Jira ticket for test-readiness (the Before-Code gate). Reads Jira + the feature's Confluence QA plan, pulls out Gherkin scenarios, flags untestable / ambiguous AC, and emits a brief /spec consumes. Read-only, token-lean.
argument-hint: <TICKET-KEY> [--ci] [--threshold <pct>] [--json] [--refuse-comment]
---

From `$ARGUMENTS`: read the ticket and the feature's QA plan, judge whether a reliable test can be generated from it, and print a **brief** (`.claude/harness/score-ticket.mjs` does the scoring, the audit line, and the JSON). It scores **structurally** against `.claude/TICKET_TEMPLATE.md` — a ticket earns Acceptance-Criteria points only for literal Gherkin (in the dedicated field `customfield_11707` or the description), not for how clear the prose reads; a ticket with no template structure is marked `legacy`. The gate is hard: **below 70% the ticket is refused**, interactive and `--ci` alike. This is the blueprint's **Before-Code** step (Quality Program §4 Step 2): flag ambiguous / untestable requirements and missing acceptance criteria **before** any test is written. Read-only on Jira and Confluence — never write to either, never touch `src/`. `/spec` calls this as its Step 2; it also runs standalone so QA can ask "is this ticket ready?" without generating anything.

## Token discipline (hard)

- Atlassian MCP missing → **stop once**: `error: atlassian-rovo MCP not available`. No transcript/cache archaeology.
- Jira: **only** fields `summary,issuetype,status,labels,description,customfield_11707,issuelinks` — never `*all`, never a full comment dump. Scan description (+ labels + `issuelinks`) for the Figma/GitLab/Confluence URLs; read comments only if the description has no AC.
- Confluence: **at most one CQL search + one page read.** No space crawl, no descendant walk. None found → `qa_plan_found=false` and move on (this does NOT stop the run — a missing QA plan lowers the score, it isn't fatal).
- Do **not** explore `src/`, specs, or agent transcripts. Do not download Figma (that is `/spec`'s job) — just note the URL.
- After harvesting: run **one** shell — `node .claude/harness/score-ticket.mjs --in '<json>' …` — and **relay its stdout** as the report. Do not compute the score by hand.

## Steps

1. **Parse args.** First `[A-Z]+-\d+` = ticket key. Flags: `--ci` (no prompt — pass through to the scorer), `--threshold <pct>` (default 60), `--json` (print only the brief JSON, for a machine caller like `/spec`), `--refuse-comment` (print the Jira comment body for a refused ticket instead of the report — printing it never posts it; `/spec` owns the preview-and-confirm flow). No key → `pass a key: /ticket-eval <KEY>`.

2. **Read ticket.** `mcp__atlassian-rovo__getJiraIssue` with the field list above (`cloudId`: `teamsystem.atlassian.net`). Harvest:
   - `summary`, `issuetype`, `status`, `labels`; `browse` = `https://teamsystem.atlassian.net/browse/<KEY>`.
   - **AC** — read from **both** `customfield_11707` (the dedicated Acceptance Criteria field) and a `## Acceptance criteria` section in the description. Two jobs: (1) extract each `Scenario:` → `{name, gherkin}` for the brief (passed through to `/spec`); (2) keep the **raw** field text and the **raw** description — the scorer detects Gherkin structurally from these, it does not trust a judged boolean. AC in the field alone is fine.
   - **Feature label** ∈ `Lista_Movimenti_Magazzino | Report_Magazzino | Giacenza_Prodotti | Importa_Giacenze | arrivi_merce_magazzino | Il_mio_magazzino | Minimum_stock | Spinta_warehouse`. → route + QA-plan search term via the table below. None → `feature_label=false`, `feature=null`.
   - **Figma** `figma.com/(file|design)/…` in description, else labels, else `issuelinks`. Note the URL only.
   - **MR ref** — precedence: an MR URL/`!<iid>` in `summary`/description > the ticket key itself (branches are named `<KEY>-…`). Note `<project>!<iid>` or `null`; do NOT read the diff here (that is `/spec`).

3. **Find the QA plan (Confluence).** Prefer a Confluence page already linked in `issuelinks`/description. Else one `mcp__atlassian-rovo__searchConfluenceUsingCql`, e.g. `text ~ "<search term>" AND type = page` (adjust to the space's naming). Read **at most one** best match. If it holds Gherkin/step scenarios, pull them → `qaPlan = {title, url, scenarios:[{name,gherkin}]}`. Nothing sensible → `qaPlan=null`, add a flag `no Confluence QA plan found for <feature>`.

   | Feature label | Route | QA-plan search term |
   |---|---|---|
   | `Giacenza_Prodotti` | `/products-stock` | `Giacenza prodotti` |
   | `Lista_Movimenti_Magazzino` | `/movements-list` | `Lista movimenti` |
   | `Report_Magazzino` | `/warehouse-reports` | `Report magazzino` |
   | `Importa_Giacenze` | `/import-stock` | `Importa giacenze` |
   | `arrivi_merce_magazzino` | `/goods-arrival` | `Arrivi merce` |
   | `Il_mio_magazzino` | `/my-warehouse` | `Il mio magazzino` |
   | `Minimum_stock` | `/minimum-stock` | `Scorta minima` |
   | `Spinta_warehouse` | `/warehouse-push` | `Spinta magazzino` |

4. **Note ambiguities (optional flags).** The scorer decides `ac_testable` on its own (it blocks vague `Then`s like `works correctly` / `funziona correttamente`). Your job here is only to add human-readable `flags` for things a regex cannot see — an undefined term, a missing precondition, a `When` with no `Then`, an open design question the ticket itself raises. Informational; they do not change the score.

5. **Score.** Hand the **raw** text + labels to the scorer — it derives every structural signal itself (no judged booleans). Run one shell and relay its output:

```bash
node .claude/harness/score-ticket.mjs --in '<json>' --threshold <pct> [--ci] [--json] [--refuse-comment]
```

`<json>`:
```json
{
  "key": "<KEY>", "browse": "<url>", "issuetype": "<type>", "status": "<status>",
  "labels": ["<label>", "…"],
  "text": { "description": "<raw description>", "acField": "<raw customfield_11707, or empty>" },
  "scenarios": [{ "name": "…", "gherkin": "Given … When … Then …" }],
  "qaPlan": { "title": "…", "url": "…", "scenarios": [ … ] },
  "figma": "<url|null>", "mr": "<project>!<iid>|null",
  "flags": ["…"]
}
```

The scorer detects the Gherkin AC (in `acField` or `description`, EN **or** IT keywords), the template sections, and the feature label (from `labels`); it computes the score, the gate (`pass` / `refuse` — there is no `warn` band), the `legacy` flag (a ticket with no template structure at all), the feature + route, appends `.claude/audit/ticket-eval.jsonl`, and prints the brief. `figma` / `mr` ride through untouched. The structure it scores against is `.claude/TICKET_TEMPLATE.md` (EN) / `_IT.md`.

**The gate is the rubric alone:**

- score ≥ threshold → `pass`.
- score < threshold → `refuse`, interactive and `--ci` alike. A readable `Then` does **not** rescue it.

**`scenarios` still matter, but they no longer move the gate.** The scorer counts how many carry an expected result concrete enough to assert on — from `scenarios` **and** `qaPlan.scenarios` — and reports that as `derivable`, which `/spec` uses to shape the draft and to decide whether a developer override has anything to check. It used to downgrade `refuse` to `warn`; it does not any more, because that rescue meant almost every prose ticket was generated as a "regression anchor" and the ticket itself never got fixed.

A scenario counts when its `Then` (or a `then` / `expected` field) names something observable and is not a vague phrase — the scorer applies the same `works correctly` / `funziona correttamente` rule it applies to the ticket text. `Given a / When b` with no `Then` counts for nothing. So do **not** pad the list: you are not handing over a number and you cannot raise the score, and a padded scenario is caught downstream anyway by `suite-honesty.mjs` / `mutate-generated.mjs`. Report what the ticket actually supports; a `refuse` on a thin ticket is the right answer.

`refuse` exits non-zero so a `--ci` caller stops. `--refuse-comment` prints the ready-to-post Jira comment (what is missing, with an example to copy for each item). This command only prints it — `/spec` is what previews it and posts it after the human confirms.

## Output

The scorer's report is the output — relay it as-is. It gives: `test-readiness <pct>%`, the band (`ready` / `too thin` / `legacy / unstructured`), the gate, the feature/route, whether a QA plan was found, the scenario count **and how many of those are assertable**, the missing items (each with its weight), and the flags. A **legacy** ticket (no template structure — most current tickets) scores low and is **refused**: that is the gate working, not a failure of the tool. Say plainly what to add. `--json` prints only the brief so `/spec` can parse `TICKET_EVAL_JSON:` and consume `scenarios` + `qaPlan.scenarios` (it merges them, dedupe by name, ticket wins) + the gate + `missing` (each item carries a `key`, which is what the refuse comment is built from).

## Guardrails

- Redact customer ids in anything you echo.
- Closed ticket → still score; the gate is about readiness, not status.
- Never post anything to Jira from this command. `--refuse-comment` prints to stdout; `/spec` owns the preview and the post.
- A missing QA plan lowers the score but never stops the run — QA plans may not exist in Confluence yet.
- Plain English everywhere a human reads (the report, the flags). Short sentences, common words. Say plainly what is missing and what to add.

## Examples

- `/ticket-eval FIC-13441` — score + gate, human report
- `/ticket-eval FIC-13441 --json` — brief only (what `/spec` consumes)
- `/ticket-eval FIC-13441 --ci` — no prompt; still exits 1 below threshold
- `/ticket-eval FIC-13441 --refuse-comment` — print (do not post) the Jira comment for a refused ticket
- `/ticket-eval FIC-13441 --threshold 75` — stricter gate

## Maintainers only

Deterministic scoring + gate + report live in `.claude/harness/score-ticket.mjs`; change weights there (the calibration knob) and re-run `node .claude/harness/score-ticket.mjs --self-test`.
