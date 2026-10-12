---
description: Populate the LOCAL backend DB with ~25 rows/table of ticket-relevant data so QA can manually test the scenario in the running app. Backend live-DB seeder (not the spec test-data printer).
argument-hint: <TICKET-KEY | NUMBER>
---

Load real, ticket-relevant data into the **local backend container DB** so QA can open the app at
`localhost:3000` and manually test the ticket's scenario. This is **not** the test-data printer — that
is `/spec`, which writes seed rows into a committed spec. `/seed {TICKET}` writes to the **live DB**.

Needs the stack up (`make up`) and the backend repo open. Target is the **container** DB only.

## Flow

1. **Analyze the ticket.** Do `${CLAUDE_PLUGIN_ROOT}/skills/spec/SKILL.md` **steps 1–3 only** (resolve → sanitize +
   score → feature label / bucket). The readiness gate still applies: data invented from a vague
   ticket is the same lie as a test invented from one. Do **not** draft a test or run the pipeline.
2. **Feature label → tables** (same map as `${CLAUDE_PLUGIN_ROOT}/skills/spec/seed.md`):

   | Label | Tables (~25 rows each) |
   |---|---|
   | `Giacenza_Prodotti` / `Minimum_stock` | `trade_items` + `kpis` |
   | `Lista_Movimenti_Magazzino` / `arrivi_merce_magazzino` | `trade_items` + `events` + `movements` (+ `clients`/`suppliers`) |
   | `Report_Magazzino` | `trade_items` + `kpis` + `movements` |
   | `Importa_Giacenze` | `trade_items` + `import_adjustments` |

   Always also: 1 `warehouse` + the activated-workspace row. **All rows scoped to the workspace the
   local app actually selects — `test-studio-4-mock`, from `warehouse-frontend/mocks/js/react-starter-sdk.js`.**
   (Not `16475e6a-…`; that id only appears as mock *response* bodies, so seeding it shows nothing.)

3. **Reuse or generate the cache.** The dataset lives at `.claude/seed-cache/<feature-label>.sql`,
   keyed by **feature (= service)**:
   - **Exists** → reuse it. Tickets on the same service do **not** regenerate.
   - **Missing** → generate it, then save it to that path. ~25 rows/table following the column shapes
     in `prisma/schema.prisma`: snake_case columns, decimals as numeric, enum casts
     (`'incoming'::"MovementType"`), insert order `events → movements` and `trade_items → kpis`,
     every NOT-NULL column given (`id`, `created_at`, `updated_at` have no usable DB default — set
     them). **`trade_items.id` is GLOBALLY unique (not per-workspace)** — prefix generated ids by
     feature/workspace (e.g. `ti-mock-01`) so datasets for different workspaces never collide on the
     `trade_items_id_key` constraint. Wrap in a transaction that **first resets ALL of this workspace's content tables** (child-first:
     `kpis → movements → events → import_adjustments_reports → import_adjustments → reports → historical_reports → trade_items → warehouses → clients → suppliers`),
     then inserts. Wipe every content table even if this feature only fills some, so re-running any
     feature never accumulates rows.
     **Use realistic, domain-plausible values**: real product names, supplier/client company names,
     document numbers (DDT / fattura), plausible prices, quantities and dates, defined in a temp table
     of `VALUES`. Do NOT emit sequential filler like `Articolo 1..25` or generate_series-made names,
     and end with a `SELECT count(*)` check. Reference shapes: `Giacenza_Prodotti.sql` (products) and
     `Lista_Movimenti_Magazzino.sql` (movements + counterparties).
   - **Ticket-specific values** (a bug's exact `unit_cost`, a named code) → write a small overlay at
     `.claude/audit/tickets/<KEY>/seed.sql` and apply it **after** the base, giving the exact case a
     recognizable `code`/`name` so QA can find it among the 25.

4. **Apply to the live DB** with the pretty runner (container only, **never `localhost:5432`**). It
   resets + loads the cache, flushes the Redis read cache, verifies counts, and prints colored
   step-by-step progress plus a final pipeline recap — show this output as-is; it is the demo-facing
   report:
   ```bash
   node .claude/harness/seed-pretty.mjs --key <KEY> --feature <feature> --score <score>
   # equivalently, from the repo root:  make seed FEATURE=<feature>
   ```
   Then the ticket overlay if there is one (apply it with psql, then re-run the Redis flush).

5. **Report** — the runner already printed the colored step progress + pipeline recap; **that is the
   report**. Add at most one plain sentence (e.g. the ticket's specific case if an overlay pinned one).
   Do not re-type the pipeline, and do not dump SQL / paths / the workspace UUID into chat.

## Reset behavior

`/seed` **resets** the workspace's content each run (clean, repeatable): it wipes **all of this
workspace's content tables** (`kpis, movements, events, import_adjustments_reports, import_adjustments,
reports, historical_reports, trade_items, warehouses, clients, suppliers`), then loads the dataset. It
**preserves** the activated-workspace row and `stock_calculation_configurations` (the config seed).
Every cache resets the full set even if it only fills some, so re-running never accumulates.
Re-running, or switching to another ticket/feature, always lands on a clean known state.

## Viewing the seeded data locally (one-time setup)

Seeding only fills the DB. To actually SEE it at `http://localhost:3000/productsStock`, three
local-dev prerequisites must be in place. **All three are LOCAL ONLY — never apply them to a shared,
remote, or production backend.**

1. **Authorization off locally.** `PolicyGuard` defaults to `enforce`, and the external authorizer it
   calls is unreachable locally, so every read returns 401. Set `AUTHZ_ENFORCEMENT=disabled` in
   `warehouse-backend/.env`, then recreate the read service:
   `docker compose -p warehouse-backend --project-directory warehouse-backend -f warehouse-backend/docker-compose.yaml up -d --force-recreate --no-deps warehouse-read`.
   This turns authorization OFF; never set it outside local dev.
2. **UUID workspace.** The backend validates `workspaceId` as a UUID. The local mock SDK
   (`warehouse-frontend/mocks/js/react-starter-sdk.js`) must hand out a UUID as the workspace `id`,
   and the seed must target that same UUID. A non-UUID workspace (e.g. `test-studio-4-mock`) returns 400.
3. **Pre-set the login + workspace.** The app reads `workspaceId` from `localStorage` at render, so set
   it with the dev token in the browser console, then reload:
   `localStorage.setItem('warehouseToken','dev'); localStorage.setItem('workspaceId','<the UUID>'); location.href='http://localhost:3000/?useCustomLogin=true'`
4. **DB migrated to the current schema.** The container DB can lag the code, and reads then 500 on
   missing columns (e.g. `movements.applied_quantity`). Bring it up to date:
   `docker cp warehouse-backend/prisma.config.ts warehouse-write:/usr/src/app/service/prisma.config.ts`
   then `docker exec warehouse-write sh -lc 'cd /usr/src/app/service && DATABASE_URL="postgresql://postgres:postgres@postgres:5432/warehouse?schema=public" npx prisma migrate deploy'`.

`/seed` does **not** perform step 1 itself — turning auth off is a deliberate, human-run action, not
something a data command should do silently.

## Out of scope

- The **frontend** `/seed` (Playwright `page.route` stubs) is unchanged — it feeds automated tests,
  not the live app.
- KPI/movement rows are **static**, not recomputed by `kpi-calculation`; they can drift if you trigger
  a recalculation. Upgrade path: drive the write API on `:3011`.
- No remote / `*-test.teamsystem.cloud` DBs — local container only.

## Examples

- `/seed FIC-13441`
- `make seed FEATURE=Giacenza_Prodotti`   — re-apply a cached dataset without Claude
