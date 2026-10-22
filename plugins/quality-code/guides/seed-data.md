# Seeding test data from a ticket

The generic rules `/quality-code:seed` always follows. Vitest projects seed rows through the
project's own builders; Playwright projects seed the network with route stubs. A team's dataset
document (`seed.dataset`) adds the known rows on top of these rules and wins where it gives an id or
a value.

## What to seed

- **One row per named fact.** Each entity the ticket names is one builder call or one row in a stub.
  Add rows only when the expected result depends on *how many* rows exist: a count, pagination or
  page size, ordering, filtering out of a larger set, a sum over rows, an empty state. Gut check: if
  the test would pass the same with one row, seed one.
- **Every field the ticket names** appears on the row, including fields the code does not read yet.
  A field the ticket does not name keeps the builder's default, or the value the copied stub already
  has. Never fill it with a made-up value to look complete.
- **Exact values from the ticket**, written as the ticket writes them. A value the ticket does not
  give is a gap: list it, do not invent it.
- **Seed the cause, not only the result.** When the ticket says something already happened (an order
  reserved stock, an invoice was paid), seed the row that records that event too, not only the total
  it produced. Data the application could never produce gives tests that fail against correct code.
- **Several rows of one kind need unique ids**, built from the row's index (`'item-' + i`), or they
  collide on the primary key.

## Values as the API stores them

- **Decimals** exactly as the API returns them. When the API sends money or quantities as strings
  (`"150.00"`, `"2325.00000000"`), write strings with the same number of decimals; when it sends
  numbers, write numbers. Copy the format from the builder's types or the existing stub, never
  convert.
- **Dates** in the format the API uses (an ISO string `2026-01-15T10:00:00Z`, or a date `2026-01-15`),
  fixed, never today's date.
- **Enums** with the exact value the code uses, from the builder's types or the existing stub.

## No real data

- **No production ids, no customer data.** Customer ids stay redacted (`U######` as the sanitized
  ticket shows them); names, e-mails and phone numbers are test values (`user@example.test`).
- **Tenant, workspace or account ids are placeholders**: the constant the project's tests already
  use (a fixture export, a test helper constant), else a clearly fake UUID such as
  `00000000-0000-4000-8000-000000000001`. Never paste a real tenant id from the ticket.
- **Never write to a developer's own database.** Builders run inside the tests, against the test
  database the project's test setup provides. This command writes code; it never runs a seed.

## Builder calls (Vitest)

- **Only functions that exist.** Call the builders the configured files export, with the parameters
  their signatures take. Never write a new builder or a raw insert next to them.
- **Foreign-key order:** parents before children. A builder that takes another row's id needs that
  row seeded first; reuse the id you seeded, never a placeholder, when the row is in play.
- **Idempotent:** the block can run before every test. Use fixed ids, not random ones, and rely on the
  project's own reset (a `beforeEach` that restores or truncates) rather than deleting rows yourself.
- **Prefer the known dataset.** When the dataset document already has a row that matches a fact, use
  its id and values instead of seeding a new one. Never change the dataset document.

```ts
const customer = await seedCustomer(db, { id: 'cust-1', name: 'Test Customer' })
await seedOrder(db, { id: 'ord-1', customerId: customer.id, total: '150.00', status: 'paid' })
```

## Route stubs (Playwright)

- **Shape copied, never guessed.** Copy the response shape from an existing stub of the same endpoint:
  the keys, the nesting, the wrapper (`{ data, total }`, `{ count, items }`, or the bare body), the
  types. Fill it with the ticket's facts. No existing stub for an endpoint: stop and say so.
- **Registration order:** Playwright uses the handler registered **last** among the routes that match
  a request. Register the broad route first (`**/orders**`) and the specific ones after it
  (`**/orders/ord-1**`), or the broad one swallows them.
- **Shared endpoints are already stubbed.** Endpoints a shared fixture or a shared `beforeEach`
  already stubs (sign-in, current user, menus, settings) are not stubbed again: stub only the data the
  ticket's screen reads.
- **Several stubs** go in one helper, `async function stub<Feature>(page)`, as the existing specs do.

```ts
async function stubOrders(page) {
  await page.route('**/api/orders**', route => route.fulfill({ json: { data: [{ id: 'ord-1', total: '150.00', status: 'paid' }], total: 1 } }))
  await page.route('**/api/orders/ord-1**', route => route.fulfill({ json: { id: 'ord-1', total: '150.00', status: 'paid' } }))
}
```

## Never

- A test, an `it`, a `describe` or an `expect`: this is data only.
- A value, a field, a builder or a response shape that is not in the ticket, the builder files, the
  dataset document or an existing stub.
- A change to application code, to a builder file, to a fixture or to the dataset document.
