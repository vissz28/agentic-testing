# Seed from a ticket

Use builders in `test/helpers/seed.ts`. Money is Decimal **strings** (`"80"`, `"150"`), never floats. Workspace is the placeholder `WS` (`00000000-0000-4000-8000-000000000001`) unless the ticket's fixture id is already a placeholder.

## Completeness

Every field the ticket names must appear on a seeded row — including values the current source does not read (e.g. both `unitPrice` and `unitCost`). Same rule as the old mock-setup completeness rule, now as rows.

## How many rows — single vs `seedMany`

Default is **one row per named fact**. Ask: does the expected result depend on *how many* rows exist? This is a semantic read of the ticket, not a keyword match.

- **No, only the values matter** (which field is picked, a delta applied, a mapping) → single builder calls. Adding rows would not change the answer.
- **Yes, count matters** (pagination / page size, counting "shows N", ordering, filtering out of a larger set, an aggregate/sum over rows) → `seedMany(builder, prisma, count, i => ({ /* unique id per row */ }))`. `each(i)` must give each row a unique id (`eventId: ` + i), or the rows collide on the primary key.

Gut check: if the test would pass identically with one row, seed one. If a specific count is what makes the assertion mean anything, use `seedMany`. On the range layer, use `seedMany` only when the property itself is over a collection (vary the count with `fc.integer`); a normal range test varies values on a fixed small row set.

## FK order

`ActivatedWorkspace` → `Warehouse` → `TradeItem` → `Event` → `Movement` → `Kpi`.

`seedWarehouse` creates the workspace if missing (`activatedAt` defaults to `2020-01-01` so document events are not skipped as pre-activation). `seedMovement` creates the event if missing. `TradeItem` does not need a warehouse. `Kpi.lastMovementId` is a required string (no FK). Use the id of a movement you actually seeded; a placeholder UUID is only acceptable when no movement is in play at all (see "Seed the cause, not just the result").

## Seed the cause, not just the result

A KPI row records the *effect* of a movement. Seeding one without the movement that caused it
leaves the database in a state the application can never produce, and the services notice.

`DocumentLinkageAllocationService` deduplicates by looking the parent movement up **in the
database** by `sourceDocument`. No parent row → `parentConfig` is null → "no parent for this
trade item" → it applies every dimension in full. A test that fakes the parent's effect as a KPI
row therefore reproduces a bug that does not exist, and stays red forever against correct code.

So whenever the ticket says something *already moved* the stock (a DDT shipped the goods, an
order reserved them), seed that movement row too:

```ts
// the order reserved availability (seed rule 12: outgoing/order/salesOrder)
await seedMovement(prisma, {
  eventId: "evt-ord", sourceDocument: "sales-258048787",
  type: MovementType.outgoing, reason: MovementReason.order,
  parentDocument: ParentDocument.salesOrder, quantity: "15",
});
// the DDT that shipped against it
await seedMovement(prisma, {
  eventId: "evt-ddt", sourceDocument: "sales-987-active",
  parentSourceDocument: "sales-258048787",
  type: MovementType.outgoing, reason: MovementReason.sale,
  parentDocument: ParentDocument.salesDeliveryNote, quantity: "5",
});
```

Two rules that make the lookup actually match:

- **`sourceDocument` format** is `` `${source}-${id}` `` with an active/passive suffix for DDTs and
  invoices but **not** orders: a DDT is `sales-987-active`, its order is `sales-258048787`. See
  `OperationalInvoiceService.buildParentSourceDocumentResolver`.
- **`parentDocument` must match a row in `prisma/seed.ts`**, or the parent resolves to no
  configuration and is treated as absent. A DDT is `salesDeliveryNote` (rule 30), an order is
  `salesOrder` (rule 12). `parentDocument: null` matches nothing.

The same applies to any service driven by an in-memory event payload: if the payload names a
movement id, that movement row has to exist, because the allocation service writes its snapshot
onto it (`movement.update()` → P2025 "no record found" when it does not).

## The builders, and the columns that are easy to miss

`seedWorkspace` `seedWarehouse` `seedTradeItem` `seedEvent` `seedMovement` `seedKpi`
`seedImportAdjustment` `seedImportAdjustmentReport` `seedClient` `seedSupplier` `seedMany`

Three groups of `seedMovement` overrides exist because a route reads them and nothing else will
make that route return anything:

- `sourceDocument` / `parentSourceDocument` — the document-linkage chain. See "Seed the cause".
- `entity` / `client` / `supplier` — the counterparty strings `/movements/entities` groups by.
- `document` / `documentType` / `parentDocument` — what `/movements/documents` returns.

**`client`/`supplier` on a movement are NOT what `/movements/clients-suppliers` reads.** That
route goes through ClientSupplierService to the `Client` and `Supplier` tables, so it needs
`seedClient` / `seedSupplier`. Setting the movement columns alone leaves it returning
`{ clients: [], suppliers: [] }`, which is the sort of wiring a mocked spec hides.

`seedTradeItem` takes `deletedAt`. Use it: mutation testing showed that deleting a
`deletedAt: null` filter from a repository changed no test result, because no spec had ever
seeded a soft-deleted row. Any list route deserves one "hides soft-deleted rows" case.

## A file on disk is not the row that points at it

`seedImportAdjustmentReport` writes a row whose `filePath` is **relative to the service's
`FILE_UPLOAD_DIR`** (`/tmp/uploads` in the live stack). A download endpoint reads that file for
real, so the row alone gives a 404. Place the file too:

```ts
await api.exec("sh", "-c", "mkdir -p /tmp/uploads && printf 'x' > /tmp/uploads/report.xlsx");
```

The reverse is a case worth writing on purpose: row present, file absent, expect 404. A mocked
spec cannot express it, because its `getReportFile` stub always succeeds.

## Feature label → extra tables

| Label                                                  | Also seed                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `Giacenza_Prodotti` / `Minimum_stock`                  | TradeItem + Kpi (+ Movement if stock direction is in play)     |
| `Lista_Movimenti_Magazzino` / `arrivi_merce_magazzino` | TradeItem + Event + Movement                                   |
| `Report_Magazzino`                                     | whatever the report reads (usually TradeItem + Kpi + Movement) |
| `Importa_Giacenze`                                     | TradeItem + ImportAdjustment (`seedImportAdjustment`)          |
| `Il_mio_magazzino`                                     | ActivatedWorkspace + Warehouse                                 |

## Redaction

Customer ids → `U######`. Real workspace UUIDs → `WS`. Emails → `user@example.test`. Do not copy production tenant ids into seeds.

## Isolation

`await db.restore()` in `beforeEach` and at the start of every `fc` iteration, then re-read `db.prisma()` (restore rebuilds the client).
