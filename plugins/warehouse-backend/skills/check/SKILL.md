---
name: check
description: >-
  Tell a real red apart from a flaky test by re-running it. Use when a test
  fails and you need to know if it is a genuine break or just flaky.
---

# check — real red or flaky?

Runs a test target several times on the same code and reads vitest's per-test results:

- a test fails every run → 🔴 **real** (fix the code)
- a test passes some runs, fails others → 🟡 **flaky** (quarantine it, AGT-8)
- every test passes every run → 🟢 **green**
- a file never got collected (import/build error) → ⚠️ listed separately; it is untested, not
  passing, so it never reads as green even if its neighbours pass
- it could not even run (build error, DB down, wrong config) → ⚠️ **could not run**, not a code verdict
- the file or `-t` filter matched nothing, or every match is skipped → ⚠️ **no tests ran**

It reports per test — keyed by **file + test name**, so two files with the same test name stay
apart — and a real fail sitting next to a flaky one does not hide the flaky one. A 🔴 real or
🟡 flaky row prints the first assertion error with it.

## What it does and does not catch

Catches nondeterminism that shows up in a lone, sequential, single-file re-run: in-test
randomness, wall-clock time, timers, uninitialised state within the file.

Does **not** reproduce the flakiness that dominates real CI: cross-file state pollution, shared
DB rows, parallel load, tight timeouts on a loaded runner, or infra hiccups (a runner crash, a
registry blip). Those need the whole suite under CI conditions. So a 🟢 green here is not proof a
test is stable in CI, only that it is stable when re-run alone.

## Run it

    npm run check -- <target> [--runs=5] [--timeout=300]
    # or
    node .claude/harness/flaky-check.mjs <target> [--runs=5] [--timeout=300]

`<target>` is whatever vitest takes, a file or `-t "test name"`:

    npm run check -- src/warehouse-write/controllers/reports.controller.spec.ts
    npm run check -- test/integration/common/repositories/movement.repository.spec.ts
    npm run check -- -t "generateReport" --runs=10

**The config is picked for you.** A `test/…` target gets `vitest.config.db.ts`, an `*.e2e.spec.ts`
target gets `vitest.config.e2e.ts`, anything else keeps the default — because the default config's
`include` is `src/**` only, so a `/spec`-generated test under `test/` would otherwise come back as
"no tests ran". Pass your own `--config` to override. DB-suite tests still need the stack up
(`make up`); without it you get "could not run", not a false "real".

`--timeout` bounds a single run (default 300s) so a hung test fails the run instead of hanging the
whole check. Any `--retry` you pass is dropped: a retried-then-passed test is reported as passed,
which is exactly the flakiness being measured.

## Exit codes

green 0, real 1, flaky 2, could-not-run / no-tests / uncollected-file / usage 3. More runs = more
confidence; `--runs=1` cannot tell the three apart at all, and a rare flake (1-in-50) needs a high
`--runs`.
