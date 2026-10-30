# Seeding test data from a ticket: `/quality-code:seed`

> **Superseded (2026-10-29).** `/quality-code:seed` no longer writes test data: it loads mock data into a
> local database for testing by hand (`commands/seed.md`, `guides/seed-data.md`). Kept for the history.

Status: decided by the owner (Jira AGT-87) · Date: 2026-10-14 · Owner: Elvis Zefaj · Jira: AGT-87,
AGT-16 (the known dataset), commits tagged AGT-44 · Builds on: [part 4b](2026-10-14-part-4b-write-tests-design.md),
[part 3](2026-10-14-part-3-playwright-design.md), [part 1](2026-10-12-part-1-core-config-design.md)

## 1. Goal

From a ticket, write **only the data setup** a test needs, for any Jira project and any Vitest or
Playwright repo. This carries over the warehouse plugins' `/seed` (the data-only sibling of their test
writer) and AGT-16 (a known, documented, idempotent dataset seeded through the project's own builders,
so live tests can assert exact values, never writing to a developer's own database), generalized:
no warehouse labels, routes, endpoints, builder names, workspace ids, hosts or ticket keys are carried
into the plugin. Everything project-specific comes from the config or from the project's own files.

## 2. What was carried over, what was not

| Warehouse `/seed` | quality-code `/seed` |
|---|---|
| Shares the writer's front half: args, ticket, data facts, target | Shares `ticket-eval` steps 1–3 (read, save, sanitize) by reference, as `write` does |
| Backend: typed FK-aware builders in one fixed file, fixed builder names | Builders from `seed.builders`; only functions those files export; none configured → candidates in a numbered card |
| Backend: label → table map | None: the tables follow from the ticket's facts and the builders' parameters |
| Frontend: label → endpoints map, one fixed sibling spec as the shape source | Endpoints from `features[].route` and the ticket; shapes from any existing stub under `seed.stubsFrom` |
| Shell endpoints stubbed by one named fixture | "Endpoints a shared fixture or `beforeEach` already stubs" (generic) |
| One row per fact, every named field, decimals as strings, placeholder workspace | `core/guides/seed-data.md`, decimals *as the API returns them*, placeholder *tenant ids* |
| Print, or `--path` inserts into the spec's setup | Same; `--path` runs inside the run marker, so the boundary hook applies |
| Backend live-DB seeder (`/seed` on the container DB, SQL cache, reset script) | **Not carried over.** The plugin never writes to a database; the AGT-16 dataset is a document the command reads |
| Readiness gate applied (backend) / skipped (frontend) | **Skipped** (section 4) |

## 3. Configuration

One optional block; every field optional.

```json
"seed": {
  "builders": ["test/helpers/seed.ts"],
  "dataset": "docs/testing/dataset.md",
  "stubsFrom": "e2e/tests/"
}
```

| Field | Adapter | Rule | Absent |
|---|---|---|---|
| `builders` | `vitest` only | 1–10 unique relative files inside the project (no `..`, not absolute, one line, not a folder) | the command searches the test folders and asks with a numbered card |
| `dataset` | both | a relative `.md` file inside the project | no known dataset; new rows from the ticket's values |
| `stubsFrom` | `playwright` only | a relative folder ending in `/` | every spec of the project is searched |

`builders` with a Playwright adapter, or `stubsFrom` with a Vitest one, is a validation error that
names the other field: the two stacks seed differently (rows through builders vs the network through
`page.route`). `seedOf(config)` returns the block with its defaults (`[]`, `null`, `null`).
The schema documents the block with the validator's path pattern.

## 4. Why there is no gate

The 70-point gate protects a **graded result**: a test whose expected values come from the ticket and
that the pipeline will call green or red. `/seed` writes data only: no `expect`, no pipeline, no score,
and no database is touched. A thin ticket gives a short block whose missing values are listed as gaps
in the plan card, never invented. The warehouse backend applied the gate because its `/seed` wrote
into a live database; that path is not carried over.

## 5. The command

`/quality-code:seed <KEY> [--path <spec>]`, numbered cards, plain English, end the turn after every card.

1. **Check.** Key, `config check`, the adapter and the `seed` block. `--path` must name a spec
   (`.spec.` or `.test.` in its name); a spec that does not exist means "print instead". Connectors,
   Jira required.
2. **Ticket.** `ticket-eval` steps 1–3; a `PROJECT_MISMATCH:` line gets its step 4 card; step 5 (the
   score) is skipped. Harvest the data facts: entities, fields, values as written, whether the count
   matters; a missing value is a gap.
3. **Dataset.** With `seed.dataset`, read it and reuse a documented row's id and values when a fact
   matches it. Never change it.
4. **Source.** Read the guide. Vitest: read the builder files, list their exported functions, use
   only those; FK order from their parameters; none configured → the "Which file holds the seed
   builders?" card; none found → stop (never write a builder). Playwright: find existing
   `page.route` / `route.fulfill` stubs for the screen's endpoints and copy their shapes; none → stop
   ("I copy response shapes, I never guess them"); shared stubs are not repeated.
5. **Plan.** `Data for <KEY>`, one line per row, `Not in the ticket: …`, `From: …`, `1. Write the data / 2. Stop`.
6. **Write** the block: builder calls in FK order, or route stubs broad-first in a `stub<Feature>(page)` helper.
7. **Output.** Print, or with `--path`: `run start`, insert into the setup (`beforeEach`, or the top of
   the `test` body before the first navigation) and the missing imports, nothing else, `run stop`.

## 6. The guide — `core/guides/seed-data.md`

One row per named fact (more only when the count matters); every named field; exact values; seed the
cause, not only the result; unique ids for several rows; decimals, dates and enums as the API stores
them; no production ids or customer data; tenant ids as placeholders; never a developer's own
database; only existing builders; FK order; idempotent (fixed ids, the project's own reset); prefer
the known dataset; stub shapes copied; last-registered route wins, so broad first; shared endpoints
not re-stubbed. No project values (CI greps `core/`).

## 7. Out of scope

- Writing a seed builder, a fixture or the dataset document. The command reads them only.
- Running a seed against any database, local or remote.
- Entry from `start` or a `write` hand-off (those commands are being changed elsewhere; a follow-up
  can offer `seed` there).
- Setup cards for the `seed` block (a follow-up; the command prints the one config line to add after
  the builder card).

## 8. Tests

- `test/config.test.mjs`: valid blocks per adapter, `seedOf` defaults, adapter restrictions, each
  wrong part named, the schema's pattern.
- `test/seed-command.test.mjs`: steps in order, rules, `ticket-eval` steps 1–3 by reference with the
  no-gate reason, the builder card, the never-guess stop lines, the plan card, the run marker around
  `--path`, the guide's rules, no project values.
