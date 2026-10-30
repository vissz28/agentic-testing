# Mock data for a local database

The generic rules `/quality-code:seed` always follows when it writes a dataset. The data is for QA testing a
ticket by hand in the running app, on a local database. A team's guide (`seed.guide`) adds its own rules on top
and wins where they differ.

## What to load

- **The tables the ticket's screen reads,** the parents their foreign keys need, and nothing else. A table only
  the reset touches gets no rows.
- **About 25 rows per main table:** enough to fill a page, sort, filter and page through. A parent most screens
  have one of (a company, a store, a site) gets one row, unless the ticket needs more.
- **Spread the values** so the screen shows its states: some rows below a threshold and some above, a few
  zeros, some old dates and some recent ones, every status the enum has.
- **The ticket's case** uses the ticket's values exactly, on a row with a code or name QA can find among the
  others (`BUG-<KEY>`, or the ticket's own product name). Seed the cause too: when the ticket says something
  already happened (an order reserved stock, an invoice was paid), load the row that records it, not only the
  total it produced.

## Realistic, never real

- **Plausible values** for the domain, in the ticket's language: real-sounding product names, company names,
  document numbers (an invoice `FT-2026/0142`, a delivery note `DDT 318`), prices with cents, quantities that
  fit the unit. Never `Item 1` to `Item 25`, never names a series function makes up.
- **Fictional, not real:** no real customer, person or production id. E-mails at `example.com`, phones `555-…`.
  Customer ids stay redacted as the sanitized ticket shows them.
- **Dates** fixed (`2026-03-14`), spread over the last months. Never `now()` for a value the screen shows; it
  is fine for `created_at` and `updated_at`.

## Shapes from the schema

- **Names as the database has them,** not as the code does: a Prisma `@map` or `@@map`, an ORM's table name.
- **Every required column** without a database default gets a value. Defaults the ORM fills in the app (a
  Prisma `@default(uuid())`, `@updatedAt`) are not database defaults: give `id`, `created_at` and `updated_at`.
- **Types as stored:** decimals as numbers, enums with the exact value (and a cast where the database needs
  one, like `'incoming'::"MovementType"` in Postgres), booleans, JSON.
- **Ids fixed and readable,** with a prefix (`mock-item-01`). An id column that is unique across all tenants
  needs a prefix no other tenant's dataset uses, or a re-run collides.

## The file

One transaction, in this order:

1. `BEGIN;`
2. **The reset:** `DELETE FROM` every table the dataset fills and every table that points at them, child
   tables first. With `seed.tenant`, every `DELETE` and `UPDATE` ends with `WHERE <column> = '<id>'`: the
   loader refuses one that does not. Leave alone the rows the app needs to start (settings, an activated
   tenant, users, migrations).
3. **The inserts,** parents first. A temporary table of `VALUES` and an `INSERT … SELECT` keeps 25 rows readable.
   With `seed.tenant`, every row of a tenant's table carries its id.
4. A `SELECT count(*)` per table filled, so the load shows what it holds.
5. `COMMIT;`

The ticket's file has no reset: only its inserts (or an `UPDATE` of a dataset row, kept to the tenant), loaded
after the dataset.

```sql
BEGIN;
DELETE FROM order_lines WHERE tenant_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM orders WHERE tenant_id = '00000000-0000-4000-8000-000000000001';
INSERT INTO orders (id, tenant_id, number, customer_name, total, status, ordered_on, created_at, updated_at) VALUES
  ('mock-ord-01', '00000000-0000-4000-8000-000000000001', 'ORD-2026/0142', 'Bianchi Forniture Srl', 1250.40, 'paid', '2026-03-14', now(), now());
SELECT 'orders' AS t, count(*) FROM orders WHERE tenant_id = '00000000-0000-4000-8000-000000000001';
COMMIT;
```

## Never

- `DROP`, `TRUNCATE` or `ALTER`: mock data deletes and inserts rows, it never changes the schema. The loader
  refuses them.
- A `DELETE` or `UPDATE` that reaches another tenant's rows.
- A value that stands for the ticket's case but is not in the ticket.
