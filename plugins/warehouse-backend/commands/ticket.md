---
description: Fetch a Jira ticket via Rovo MCP and summarize it
argument-hint: <TICKET-KEY | NUMBER | assignee:name | reporter:name | free text>
---

Fetch Jira issue(s) matching `$ARGUMENTS` using `mcp__atlassian-rovo__getJiraIssue` (single key) or `mcp__atlassian-rovo__searchJiraIssuesUsingJql` (search).

Resolution rules (evaluated top-down; first match wins):

1. Read `~/.claude/jira-config.json` if it exists — use its `cloudId` and `defaultProject`. If no `cloudId`, call `mcp__atlassian-rovo__getAccessibleAtlassianResources` and use the first resource's id (and suggest `/jira-config discover` to persist it).
2. **Ticket key** (`[A-Z]+-\d+`, e.g. `FIC-13415`) → `getJiraIssue` directly.
3. **Bare digits** (e.g. `1234`) → prefix with `defaultProject` → `getJiraIssue`. No `defaultProject` → ask for the project key.
4. **Prefixed filters** (`assignee:`, `reporter:`, `status:`, `label:`, `epic:`, `text:`) → build JQL. Multiple prefixes = AND. Examples:
   - `assignee:mattia` → `assignee = currentUser()` if arg is `me`, else resolve via `mcp__atlassian-rovo__lookupJiraAccountId` (name → accountId) then `assignee = "<accountId>"`.
   - `reporter:"Angela Spina" status:"In Review"` → `reporter = "<accountId>" AND status = "In Review"`.
   - `epic:FIC-9632` → `parent = FIC-9632` (or `"Epic Link" = FIC-9632` on older instances).
   - `text:"unit cost"` → `text ~ "unit cost"`.
5. **Bare text with no prefix and no key shape** → treat as `text ~ "<arg>"` scoped to `defaultProject` if set.
6. Always append `ORDER BY updated DESC` to search JQL; cap results at 10 (`maxResults: 10`).
7. **Ticket keys are always rendered as clickable links.** Derive the browse URL: `<site>/browse/<KEY>` where `<site>` is the site URL from `mcp__atlassian-rovo__getAccessibleAtlassianResources` (the `url` field of the resource matching the configured `cloudId`; cache per session). Every printed ticket key — in the overview title, in the multi-hit table, in "Links" (parent/epic/blockers), and in "Recent activity" comment references — uses the markdown-link form `[<KEY>](<url>)` so the key is clickable in Claude Code's chat and in any terminal that renders GFM.

Output shape (skip empty sections):

- **Single hit or key lookup** → full overview below.
- **Multiple hits** → one-line table (`[key](url) · type · status · assignee · summary`), then ask which to expand. Never dump full overviews for >1 result unless the user asked.

Overview shape (single ticket, skip empty sections):

- **Title** — key, summary, **issuetype** (Bug/Story/Task/Epic/…), **status** + done-marker (✅ if `resolution` set or `statusCategory.key == "done"`, otherwise show category: To Do / In Progress), priority
- **People** — reporter, assignee
- **Dates** — created, updated, due
- **Description** — 2–4 sentence gist, not raw ADF
- **Acceptance criteria / subtasks** — bullets
- **Links** — parent/epic, blockers, related
- **Recent activity** — last 2–3 comments, one line each

## AI-fill suggestions (read-only, appended when the ticket has template gaps)

After the overview, if the ticket is missing any section from the ticket template (Story or Bug, whichever matches `issuetype`), append an **AI-fill suggestions** block. This is **advisory only** — it never writes to Jira. The user copy-pastes what they accept.

The template is `../../.gitlab/issue_templates/Story.md` or `Bug.md`, whichever matches
`issuetype` — the same two GitLab offers in its menu, and the shape `/spec` scores against.

Templates are English only: source skeleton snippets (Gherkin keywords, section headings) from
the template verbatim — `Given` / `When` / `Then`, `Acceptance criteria` — even when the ticket
itself is Italian. Do not translate the skeleton.

Rules:

1. **Only propose what's derivable without judgment.** Skip the section entirely if only judgment-fields (impact, priority, AC semantics) are missing.
2. **Split the block by confidence:**
   - **Ready to accept** — high-confidence suggestions from evidence in the ticket text.
   - **Skeleton only** — placeholder headings + `TBD` markers, for sections the reporter has to fill semantically.
   - **Cannot infer** — one-line list of what the user must add themselves, with the reason.
3. **Never invent Gherkin scenarios from a one-line description.** Propose empty `Scenario:` skeletons, not fabricated behavior.
4. **Redact customer identifiers** in anything proposed (customer IDs, workspace UUIDs, email addresses).
5. Skip the entire block if the ticket is closed (`resolution` set) — no point autofilling done work.

What to infer per field:

| Field | Signal | Confidence |
|---|---|---|
| `warehouse` label | ticket is under one of the 3 epics | Ready |
| feature label | keyword match on description: `movimenti/movement` → `Lista_Movimenti_Magazzino`; `report` → `Report_Magazzino`; `giacenz/stock` → `Giacenza_Prodotti`; `import/importa` → `Importa_Giacenze`; `arrivi/arrival` → `arrivi_merce_magazzino`; `minimum/minima` → `Minimum_stock`; `il mio magazzino` → `Il_mio_magazzino` | Ready if single match, Skeleton if multi/none |
| Epic parent | feature label → epic: movements/reports/stock hotspots → FIC-7196; stock-on-date/inventory → FIC-11547; multi-warehouse → FIC-11780 | Ready if unambiguous |
| Environment (Bug) | description text mentions "prod/production/produzione", "staging", "local" | Ready if explicit |
| Steps to reproduce (Bug) | existing numbered list in description | Ready (hoist verbatim) |
| Title prefix `[FE]/[BE]/[FS]` | components / labels / touched paths in linked MRs | Ready if unambiguous |
| Template skeleton | any required section from the template missing | Skeleton |
| Impact classification, priority, AC semantics, expected vs actual | — | Cannot infer |

Output shape of the block:

```
**AI-fill suggestions** — copy-paste to accept; nothing written to Jira.

Ready to accept:
- Labels: `warehouse`, `Lista_Movimenti_Magazzino`  ← from "movimenti" in description
- Epic (parent): FIC-7196  ← from feature-label mapping
- Environment: prod  ← "in produzione" mentioned

Skeleton only (paste, then fill semantics):
- Acceptance criteria block missing → paste:
  Scenario: <verb-phrase>
    Given <precondition>
    When <action>
    Then <expected outcome>
- "Expected vs Actual" missing (Bug) → paste headings only

Cannot infer (add yourself):
- Impact classification — needs reporter judgment
- Priority — needs product judgment
- Named regression scenario — needs the shared function name
```

Keep it tight. Never expand the block beyond ~15 lines. If the ticket is well-formed, omit the block entirely.

Examples:
- `/ticket FIC-13415` — key lookup
- `/ticket assignee:me` — my open tickets
- `/ticket reporter:"Angela Spina" status:Open` — Angela's open tickets
- `/ticket epic:FIC-9632 status:"In Review"` — epic children in review
- `/ticket unit cost` — text search
