# Layers

Map `src/<rest>.ts` → `test/<layer>/<rest>.spec.ts`. Never write live specs under `src/`.

`vitest.config.db.ts` sets `isolate: false`, so every file in a run shares ONE Postgres/Redis/
service stack and one module registry. That is what keeps the suite at ~34s instead of ~116s.
The price: do not mutate module-level state in a spec, and always `restore()` in `beforeEach`
(and inside each `fc` iteration) — that truncate plus Redis flush is what keeps files independent.

Helpers: `startLiveDb` / `createTestPrisma` / seed builders from `@test/postgres.container`, `@test/prisma.factory`, `@test/seed`.

## Unit (`test/unit/…`)

One method on the real class against seeded rows.

```ts
import { startLiveDb, type LiveDb } from "@test/postgres.container";
import { seedTradeItem, WS } from "@test/seed";

let db: LiveDb;
beforeAll(async () => {
  db = await startLiveDb();
});
beforeEach(async () => {
  await db.restore();
});
```

- `new KpiRepository(db.prisma())` — real Prisma.
- Mock only Redis, Dapr, HTTP, BullMQ, `ClientProxy`.
- Bug: one `it` that fails against current source (regression anchor). Story: one `it` per Gherkin scenario.
- Skip this layer only if the target has no Prisma / no single method worth pinning.

## Integration (`test/integration/…`)

Two or more real collaborators: service + its repositories + Prisma. Still mock Redis/Dapr/HTTP.

**Do not hand-roll the service's dependency list.** Read the constructor first — these signatures
change, and a spec that passes too few arguments fails with `X is not a function` from whichever
dependency silently landed in the wrong slot. Use the shared doubles:

```ts
import { allocationService, cacheDouble } from "@test/fakes";

const configs = { get: vi.fn().mockResolvedValue(/* the stock rule */) } as never;
new KpiService(
  new KpiRepository(db.prisma()),
  mockEvents,
  configs,
  allocationService(db.prisma(), configs), // real service, Redis lock faked
  cacheDouble() as never,                  // carries bumpVersion
);
```

`allocationService` takes the *same* `configs` double you hand the service, or allocation and KPI
compute against different configuration. Prefer the real `DocumentLinkageAllocationService` over
stubbing its ten methods — its return values feed the KPI maths, so invented ones make the test
pass or fail for the wrong reason.

Do not use `createTestApp` / HTTP inject here — but note the `src/**/*.e2e.spec.ts` files are
**not** end-to-end. They mock every dependency, call `app.inject()` rather than real HTTP, and
override the throttler, activation and policy guards. They have been caught asserting response
fields the service never returns and a 400 where production answers 404. Never treat them as
proof an HTTP path works; that is the API layer's job.

Skip if the target is a repository with no service caller in-scope, unless the method already joins tables (then one integration `it` on that join is enough).

## Range (`test/range/…`)

Property-based. Wrap `fc.asyncProperty` in a plain `it("…", async () => { await fc.assert(…); })` that contains `expect(` — suite-honesty does not parse `it.each` / `fc` as tests.

```ts
await fc.assert(
  fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (qty) => {
    await db.restore();
    const prisma = db.prisma();
    // seed + call + expect(…)
  }),
  { numRuns: 20 },
);
```

Log each iteration with `logRange({ key, sample, actual, ok })` from `@test/range-log` → `test/.logs/range.jsonl` (gitignored). Override path with `RANGE_LOG`. Call it before `expect` so a failing sample is still written.

**Pin a failing sample.** When a property fails, fast-check shrinks to a minimal counterexample and prints it. Promote that exact sample into the spec as a deterministic case with `fc.assert(prop, { examples: [[/* the counterexample tuple */]], numRuns: 20 })` (or pin `{ seed, path }`) before reporting, so a probabilistic catch becomes a permanent regression guard that lives in the committed spec, not just in `range.jsonl`. On a Bug it pins the input that reproduces the defect: red now, green for good once the fix lands.

Arbitraries: integer quantities `1…1e6`; integer cents for money (then Decimal strings); dates around the ticket window in `Europe/Rome`; `fc.constantFrom("incoming", "outgoing")`. Do not generate floats for money.

Invariants, in order: ticket `Then` → hardcoded: KPI reads `unit_cost` not `unit_price`; outgoing never increases `stockOnHand`; reads use `deletedAt: null` → QA plan (read-only, never overrides the Then).

Skip if there is no numeric / date / enum field to vary.

## API (`test/api/…`)

HTTP against a Testcontainers stack: Postgres + Redis + the service image. `startLiveApi()` boots warehouse-read, `startLiveApi("write")` boots warehouse-write. **Rebuild after source changes** (`docker compose build warehouse-read`) — a stale image silently tests old code, and has already hidden both a landed fix and a change in guard defaults.

```ts
import { startLiveApi, type LiveApi } from "@test/api.container";
import { seedTradeItem, seedWorkspace, WS } from "@test/seed";

let api: LiveApi;
beforeAll(async () => {
  api = await startLiveApi();
});
beforeEach(async () => {
  await api.restore();
});
```

Seed via `api.prisma()`, then `fetch(api.baseUrl + "/api/v1/…")`. Always `seedWorkspace` — the activation guard is on.

This is the **only** layer that proves an HTTP path works, because the `src/**` e2e specs are
mocked (see Integration above). Write it whenever the ticket names a request, a status code, a
response field or a filter. Skip it only when the ticket touches no HTTP path at all.

### Four traps on any API spec, all of which have already bitten

**1. The container runs the IMAGE, not your working tree.** Editing `src/` changes nothing until
`docker compose build warehouse-read`. A stale image has twice reported a false result: it hid a
fix that had already shipped (FIC-13173), and it made a soft-delete regression look uncaught.
Rebuild before trusting any API-layer result about source you just changed.

**2. Guards run before pipes, so a malformed input is 404, not 400.** `WorkspaceActivationGuard`
rejects an unknown workspace before `ValidationPipe` ever sees a bad `workspaceAttributeId`.
Confirmed on three separate routes. Every mocked spec asserts 400 here and every one of them is
wrong, because `createTestApp` overrides the guard to pass through. Always `seedWorkspace` first,
then assert what the route actually returns.

**3. Do not copy the response shape from the mocked spec.** It asserts its own fixture, so it can
describe a shape the service has never produced — `warehouse.basic-info` claimed
`{ latestImportAdjustment, latestReport }` for a method returning four different fields. Probe the
real endpoint before writing assertions: seed a row, `fetch` it, print the body, then assert.
`/trade-items` returns `{ items }`, `/movements` returns `{ data, total }`, `/movements/entities`
returns plain strings. There is no house style to guess from.

**4. Some routes proxy to a microservice the stack does not boot.** On the READ side `reports`
and `historical-reports` both `send()` to reports-generation over TCP and WAIT for it. Their
success paths need that service; their failure paths are real and worth pinning, and the two
controllers do not agree — one wraps errors into 404/400, the other lets a raw 500 out. Write the
reachable half and mark the rest a deliberate gap in the spec's doc comment.
The same-named WRITE routes are the opposite: they `emit()` (fire and forget) and never await, so
they are fully reachable with nothing listening. A 200 there means the request was accepted and
validated, never that a report was produced. Check which of the two you are looking at.

### A bug you find while converting goes to `test/repro/`

Converting a mocked spec to a live one is how bugs surface. When the live version fails against
current source and the ticket is not about that failure, do not weaken the assertion and do not
leave the suite red: write the spec asserting the CORRECT behaviour under
`test/repro/api/...`, where `vitest.config.db.ts`'s include does not reach it, and say in the doc
comment what the cause and the fix are. `npm run test:db:repro` runs them; a spec that goes green
there is a bug someone fixed, ready to be promoted back into the gating suite.

### Driving the parts a mock cannot reach

`LiveApi` exposes more than `prisma()`:

```ts
await api.redis("SET", `migration_completed:${WS}`, "");   // drive a Redis branch for real
await api.exec("sh", "-c", "printf 'x' > /tmp/uploads/report.xlsx"); // place a file it reads back
```

Use them for handlers that branch on a cache flag or stream a file. Those are exactly the
branches a stubbed service reports as working when they are not.

`startLiveApi("write")` boots the command side (port 3011, `warehouse-backend-warehouse-write:latest`,
override with `WAREHOUSE_WRITE_IMAGE`) — no Dapr sidecar is needed, `main.ts` logs "Continuing
without Dapr functionality" and serves HTTP regardless. The one thing a write-side spec cannot do
is assert on an outbound published event, because nothing is subscribed.

### The write side, specifically

All ten mocked `src/warehouse-write/e2e/*.e2e.spec.ts` files now have a live counterpart under
`test/api/warehouse-write/`. Four more traps surfaced while converting them.

**5. Route versions are not uniform, and only the real image tells you.** `createTestApp` mounts
whatever it is handed, so a mocked spec cannot get a path wrong. On the real service
`POST /api/activation/activate/workspace/:id` and `POST /api/trade-items/migrate-stock/workspace/:id`
have NO version segment (the `/api/v1/...` form is a 404), while everything around them is
versioned. Probe the path before asserting on the response.

**6. A path param does not satisfy the body DTO.** `ValidationPipe` runs on the body before the
controller merges `@Param("workspaceId")` in, so `POST /movements/workspace/:id` is a 400 unless
the body ALSO carries `workspaceId`, and a `PUT` needs `id` in the body as well. The controller
then overwrites both with the path values, so those fields are mandatory and ignored at once.

**7. The two auth guards fail with different status codes.** `DaprAuthGuard` throws, so a bad or
missing `dapr-api-token` is **401**. `M2mTokenGuard` returns `false`, so Nest raises its own
`ForbiddenException` and a bad or missing bearer token is **403**, not the 401 its Swagger
annotation advertises. `api.container.ts` sets `APP_API_TOKEN` and `FIC_M2M_TOKEN`, exported as
`DAPR_TOKEN` and `M2M_TOKEN`; without the former every Dapr ingest route is 401 and untestable.

**8. On a bulk ingest route, the status code proves nothing.** orders, delivery-notes,
operational-invoices and trade-items always answer 200 and report the real outcome per entry in
`statuses[]` (`SUCCESS` / `RETRY` / `DROP`). trade-items-sync answers a FLAT `{ status }` instead,
and paper-invoices takes a bare CloudEvent with its routing facts in HTTP HEADERS
(`__key`, `workspaceid`, `appname`) rather than a bulk envelope. Assert the row the handler wrote,
not the 200: an upsert, a soft delete and a skipped-because-not-activated are all 200 SUCCESS.
Use `daprBulk()` / `daprHeaders` from `@test/dapr` so the envelope is right.

Write-side gaps that are deliberate, not oversights: `migrate-stock` and the multipart adjustment
upload need Azure Blob Storage and the validator worker, and `trade-items-sync` needs the upstream
TeamSystem trade-item API, so only their guard and validation halves are covered. A sync request
answering `RETRY` against this stack is correct behaviour for an unreachable upstream, and the spec
asserts it as such rather than stubbing the upstream to force a green.

## `--fast`

Draft range files, but the pipeline does not run them. `--fast` also skips Stryker. On a **Bug** the pipeline fails `stryker_unavailable` unless an AC anchor is already red (self-proving). Don't `--fast` a green Bug.
