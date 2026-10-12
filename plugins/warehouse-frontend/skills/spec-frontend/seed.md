# Seed from a ticket (data only)

The frontend answer to the backend `/seed`. The backend seeds a Prisma DB with `seedX(...)` builder
calls; the frontend app has no DB in a test — it reads the **network**. So "seed data" here is the
set of **`page.route('**/<endpoint>**', route => route.fulfill({ json }))`** stubs that feed the
screen the ticket's scenario. This command emits **only** those stubs — no `test()` / `expect`, and
no `run-pipeline.mjs` (there is nothing to grade, it is just data). The runnable-test sibling is
`/playwright`; `/spec` writes the whole thing.

## Shares /spec's front half

Do `/spec` **Step 1 (parse args), Step 2 (read the ticket — harvest the data facts named in the AC /
description, plus the feature label), Step 4 (route)**. **Skip** the readiness gate (no test to
gate), the MR diff, Figma, the draft, and the pipeline. Then:

- The **shell** endpoints (tenant, products, menu-items, token handshake) are already stubbed by the
  `warehouse` fixture in `e2e/fixtures.ts` — do **not** re-stub them. Seed only the **feature** data
  the screen reads, by label:

  | Label | Route | Feature endpoints to stub |
  |---|---|---|
  | `Giacenza_Prodotti` / `Minimum_stock` | `/products-stock` | `trade-items/workspace`, `warehouse/basic-info` |
  | `Lista_Movimenti_Magazzino` / `arrivi_merce_magazzino` | `/movements-list` | `movements/workspace`, `movements/<id>/workspace`, `movements/documents/workspace`, `movements/clients-suppliers/workspace`, `trade-items`, `warehouse/basic-info` |
  | `Report_Magazzino` | `/warehouse-reports` | `reports`, `historical-reports` |
  | `Importa_Giacenze` | `/import-stock` | `adjustment-files`, `stock-files` |

- **Response shape comes from an existing stub, never guessed.** Read **one** file — the sibling
  `e2e/tests/<route-slug>/*.spec.ts`, else `e2e/tests/products-stock.smoke.spec.ts` — and copy the
  JSON shape its `route.fulfill` already uses (trade-items is `{count, items:[{id,code,name,
  measurementUnit,minimumStock,workspaceId,kpi:[{stockOnHand,stockAvailability,stockValue,
  averageCost}]}]}`; movements list is `{data:[…],total}`; a single movement is the body itself,
  unwrapped). Fill it with the ticket's facts.
- **Registration order matters.** Playwright uses the handler registered **last** among matches, so
  put the broad list route first and the more specific `.../<id>/workspace/**` routes after it — as
  the movements sibling spec does.

## Completeness + guardrails

- Every field the ticket names appears on a stubbed row, including values the current screen does not
  read yet.
- Money / stock as Decimal **strings** (`"150.0000"`, `"2325.00000000"`), never floats — that is how
  the API returns them and how the existing stubs are written.
- Customer ids redacted; real workspace UUIDs → the `WORKSPACE_ID` placeholder exported from
  `e2e/fixtures.ts` (`550e8400-…`). Do not paste production tenant ids into a stub.
- Row count: one row per named fact by default; use several rows only when the expected result
  depends on *how many* exist (a count, pagination, ordering, an empty state).
- i18n is optional here — data seeding asserts nothing. Stub `**/i18n/**` only if a downstream test
  will read labels (then from `mocks/buckets/i18n/warehouse-app--it.json`, not retyped).

## Output

- **Default:** print the stub block for copy-paste — the `page.route(...)` calls (wrapped in a
  `stub<Feature>(page)` helper when there are several, as the sibling spec does), with a one-line
  note on which endpoints and why. The spec is the store; do not write a separate fixtures/data file.
- **`--path <spec>`:** insert the block into that spec's setup (top of the `test(...)` body before
  `warehouse.goto`, or a `beforeEach`), touching nothing else. File does not exist → print instead
  and say so.

## Examples

- `/seed FIC-13441`
- `/seed FIC-12624 --path e2e/tests/movements-list/FIC-12624.spec.ts`
