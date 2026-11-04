# Database tests

Shared rules for the **Database** section of a backend plan. They apply when the ticket or the target
touches tables, queries or migrations (`lib/base/database.mjs` decides). The runner's own writing
guide (Vitest, pytest, JUnit, Go, .NET) says how a test looks; this guide says what the database
tests check.

## Project conventions come first

How the project already tests its database (its helper, base class, fixture, migration tool, naming,
folder) wins over everything here. Read the nearest existing database or integration tests before
proposing any. Only what the project has no habit for follows this guide.

## What to propose

Each is a case on the plan card, one line each, in the `Database: N cases` section:

- **Constraints:** a duplicate of a unique value is refused, a missing required (not null) value is
  refused, a row pointing at a parent that does not exist (foreign key) is refused. Only constraints
  the ticket or the schema really has; never invent one.
- **Migration up, empty database:** all migrations run from nothing and the schema has the new table,
  column or index.
- **Migration up, filled database:** rows that existed before the migration survive it, and a new
  column gets the value the ticket says for old rows (default or backfill).
- **Data integrity after the operation:** after the code under test ran, read the rows back and
  check them: counts, totals, no orphan rows, and a failed operation left nothing half written
  (rollback).

## How they run

On a real database in a container (Testcontainers), the same one the integration layer uses. Docker
must be running; `/quality-code:run-backend` runs them with the rest. Reuse the project's container
helper; without one, setup's Testcontainers suggestion applies. Never mock the database for these
tests: a mock only restates itself. Use the engine the project runs in production, not an in-memory
stand-in.

## Rules

- Each test starts from a known state (fresh container, or tables emptied) and does not depend on
  another test's rows.
- Expected values come from the ticket or the schema, never from running the code and copying.
- No real data, no production connection string: the container's own URL only.
- A scenario the ticket does not pin down gets no test (as in the runner's guide).
