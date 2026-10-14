# Part 3b: writing Playwright tests from a ticket

Status: decided by the controller under the user's "don't ask" instruction · Date: 2026-10-14 ·
Owner: Elvis Zefaj · Jira: AGT-93 (commits carry AGT-44, the project's convention) · Builds on:
[part 3](2026-10-14-part-3-playwright-design.md), [part 4b](2026-10-14-part-4b-write-tests-design.md),
[part 2](2026-10-14-part-2-shared-checks-design.md)

## 1. Goal

From a ticket that passed the readiness gate, Claude writes Playwright e2e specs for the screen the
ticket changes, then the part 3 pipeline grades them (boundary, honesty, assertions, types, tests,
expected values, mutation). `/quality-code:write` gains a Playwright path next to its Vitest one;
`start` option 3 offers it for both adapters. This generalizes the warehouse frontend's `/spec`,
`/playwright` and `/seed` (part 3 §12 lists what 3b takes over): the feature-label route, anchor and
finding tags, edge-case probing and the network-stub rules come over as generic, config-driven rules;
no warehouse value (labels, routes, endpoints, fixtures, Jira site or fields) is carried.

## 2. Decisions

| Decision | Value |
|---|---|
| Entry points | `/quality-code:write <KEY>` on a Playwright project (no longer "not available yet"); `start` option 3 for both adapters. |
| Gate | Unchanged from 4b: `ticket-eval` steps 1–5; below 70 the refuse flow, never a test. The Playwright rubric's `derivable` cannot unlock writing (part 3 §12): only the score gates. |
| Where specs go | One folder, `playwright.folder`. Default: the `testDir` of the project's default Playwright config when it is one plain string literal, else `e2e/`. A script resolves it (`cli.mjs config e2e-folder`), never Claude. |
| Target | A screen (a route), not a source file. `--route PATH` wins; else the `route` the score derived from the configured feature whose label is on the ticket (`features[].route`), used without a card; else a card listing the configured routes, plus "Another screen". |
| File name | `<folder><screen>.<key lowercased>.spec.ts` (`.js` without a `tsconfig.json`); `<screen>` is the route's segments joined by `-`, `home` for `/`. An existing file is kept and added to. |
| Tags | The describe carries `{ tag: '@<KEY>' }`. A test from the ticket's scenarios carries `{ tag: ['@anchor', '@<KEY>'] }`; an extra probe `{ tag: ['@finding', '@<KEY>'] }`, on the `test(` line. The tags say where a test came from, not whether it is red. |
| Extra probes | Up to 3 per ticket, picked from a fixed checklist in the guide, only when they apply to the screen; each its own `test('Extra: <what it probes>', …)`. `--no-extras` leaves them out; the plan card offers it too. |
| Red extras | `tests_red` like any red test (part 3 §12): no new verdict, no card change. The `Extra:` title makes the card readable; `write` adds one line when the test the card names is an extra. |
| Network stubs | `page.route` only at boundaries the guide names: third-party hosts, and the app's own API only when the project's e2e specs already stub it or the team guide says so. Shapes copied from an existing stub, never guessed. |
| Team guide | Optional `playwright.guide` (a repo `.md`), read on top of the plugin's `core/guides/playwright-writing.md`; it wins where they differ. |
| Design captures (Figma) | **Deferred.** 3b writes no capture test and reads no Figma file. The checks keep ignoring capture tests (part 3 §5). |
| XRay | **Deferred** (part 3 §12): a CSV behind a config switch, later. |
| The app | Must be reachable when the checks run: the config's `webServer` starts it, or it already runs. Down is `not_verified` (part 3 §4), never red, never green. |
| Pipeline | No change needed: the run marker, boundary, honesty with `@anchor` / `@finding`, `expected` with web-first matchers and the Playwright runner already serve a writing run (§8). |
| Dependencies | None. Node ≥ 18 built-ins only. |
| Release | quality-code 0.8.0, after 0.7.0 (part 3). |

## 3. Configuration

Two optional fields in the `playwright` block (valid only with `adapter: "playwright"`, as today):

```json
"playwright": {
  "folder": "e2e/checkout/",
  "guide": "docs/testing/e2e.md"
}
```

| Field | Rule | Default |
|---|---|---|
| `folder` | repo-relative path ending `/`; not inside a forbidden boundary (same rule and message shape as `vitest.layers[].folder`) | the default config's `testDir` when readable (§4), else `e2e/` |
| `guide` | repo-relative path to a `.md` file | none |

Unknown keys stay refused; the message lists the six allowed keys. No setup card: the block is
hand-edited, like the rest of it (part 3 §11). The folder must be inside the Playwright config's
`testDir`, or Playwright will not find the specs; a wrong folder shows as `not verified` ("no tests
found" or "1 file(s) never ran"), never as a pass.

## 4. The e2e folder — `core/e2e-folder.mjs`

`e2eFolder(root, config) → { ok: true, folder, source, configFile? } | { ok: false, error }`,
also `node core/cli.mjs config e2e-folder`, which prints one plain line and
`E2E_FOLDER_JSON:{…}` (exit 0), or the error (exit 2).

- `source: 'config'` — `playwright.folder` as configured.
- `source: 'testDir'` — read statically from the first of `playwright.config.ts`, `.js`, `.mts`,
  `.mjs`, `.cts`, `.cjs` in the root (Playwright's own order). Only a line whose first token is
  `testDir:` followed by one quoted literal counts (a commented line does not); exactly one distinct
  value must be found. It is normalized (`\` to `/`, no leading `./`, a trailing `/`) and must be a
  relative path inside the project; `.` or the root itself does not count.
- `source: 'default'` — `e2e/`, when there is no config file, no literal, several values, or a
  computed `testDir` (`path.join(…)`). The script never runs the config.
- The adapter must be `playwright` (exit 2: `the e2e folder is for Playwright projects`). The
  resolved folder must not be inside a forbidden boundary of the effective rules
  (`boundaries.forbidden`, else the default; `boundaries.allow` wins): `the e2e folder "<f>" is inside
  the forbidden "<rule>": set playwright.folder, or allow it in boundaries.allow` (exit 2).
- With `playwright.configs` the default config may not be the one that runs the new spec; such a
  project should set `playwright.folder` (documented, not detected).

## 5. `/quality-code:write <KEY> [--layer NAME] [--target PATH] [--route PATH] [--no-extras]`

Same seven steps as 4b; each step says what differs for Playwright. The Vitest flow is unchanged.
`--layer` and `--target` are Vitest-only, `--route` and `--no-extras` Playwright-only; a flag of
the other adapter stops with one line naming the flags that fit.

1. **Check.** `config check`; adapter `vitest` → 4b; adapter `playwright` → `cli.mjs config
   e2e-folder` gives the folder (exit 2: show its lines and stop). Connectors as `start` does (Jira
   required).
2. **Ticket and gate.** As 4b. Playwright keeps the `route` and `feature` from the score's
   `TICKET_EVAL_JSON:` line, and the scenarios of the ticket plus the QA plan's (`qaPlan.scenarios`,
   deduplicated by name, the ticket wins).
3. **Target (the screen).** `--route PATH` (must start with `/`, one line); else the derived
   `route`, without a card; else:

   ```
   Which screen does this ticket test?
   1. <route>   (<feature label>)
   2. <route>   (<feature label>)
   3. Another screen
   4. Stop
   ```

   one line per configured feature that has a route; "Another screen" asks for a path starting
   with `/`.
4. **Plan.** Read the plugin guide, then `playwright.guide`. Read at most two existing specs in the
   folder (for imports, fixtures, login and stub shapes) and, to find the real roles, labels and
   texts, the branch's changed code files for that screen (never shown in the chat). Card:

   ```
   Tests for <KEY>, on <route>
     From the ticket
       <scenario, in a few words>
     Extra (not in the ticket)
       <probe, in a few words>
   1. Write these tests
   2. Leave out the extras
   3. Stop
   ```

   With no extras (none applies, or `--no-extras`) the Extra section and option 2 are left out and
   the rest numbered in order.
5. **Write.** `run start` first (as 4b). One spec file in the folder (§2 naming). The describe at
   column 0 (the dialect's block finder needs it), the imports the existing specs use (else
   `@playwright/test`), `await page.goto('<route>')`, one `test` per scenario, one per extra, the
   tags of §2 on the `test(` line, real expected values from the ticket in web-first assertions,
   `test.fixme` for a behaviour the ticket does not pin down.
6. **Check.** The 4b line plus the part 3 app line, then the pipeline CLI with the spec, `--key`
   and `--ticket` (never `--target`: the CLI refuses it for Playwright). Fixable verdicts and the
   2-rewrite cap as 4b, without `stryker` (no such step). `run stop` on every exit.
7. **Card.** As 4b, plus: `tests red` naming an `Extra:` test → `A red extra test is a case the
   ticket does not cover: show it to the ticket's author. Do not change the test to make it pass.`;
   `not verified` because the app is not reachable → `Start the app (or check the webServer in your
   Playwright config), then run /quality-code:check with the spec path above.`

## 6. The guide — `core/guides/playwright-writing.md`

Generic Playwright conventions, always read: role and label locators over CSS and XPath; web-first
assertions (`await expect(locator).toHaveText(…)`) with the ticket's real values, never a value read
back from the page and compared by hand; no `waitForTimeout` or other sleeps; no `.only`;
`test.fixme` for an unknown behaviour; one behaviour per test; isolated state (each test arranges
its own data and login); network stubs only at the named boundaries, with the `/seed` rules (shape
from an existing stub, every named field on a row, one row per fact unless the count matters, the
last-registered handler wins so broad routes first, no real customer data); the tag rules; the
extra-probe checklist and its assertion policy. No project values.

### Extra probes

Checklist (pick what applies to the screen, at most 3): empty (no items), long text, numbers (zero,
negative, decimals, very large), missing optional fields, special characters, a large list, a second
language, date boundaries. Assertion policy, in order: (a) a concrete value from the ticket, the
branch's code or the app's own translation files; (b) the screen still works: an element a ticket
scenario names is still visible and nothing the ticket names is lost; (c) neither → not written. A
probe never invents an expected value.

## 7. Tags and the honesty check

The part 2 honesty rule reads one added line at a time: a line with `'@anchor'` or `'@finding'`
must also hold `'@<KEY>'`. So the tag list stays on the `test(` line, never split across lines (a
formatter that wraps it would fail the check; the guide says so). The describe's `@<KEY>` makes
`npx playwright test --grep @<KEY>` select the ticket's tests. A team whose CI leaves `@anchor` /
`@finding` tests out of a blocking job (the warehouse convention) should know that every ticket test
written here carries one of them; the tags describe origin, and the team's CI decides what to do
with it.

## 8. Pipeline: what a writing run needs, and why nothing changes

- **Boundary:** the run marker and the hook are adapter-free; the folder is validated against the
  same rules.
- **Honesty:** the Playwright dialect already forgives moved lines and checks the tag pairing.
- **Suite honesty and mutation:** read `test(`, `test.fixme(`, `test.describe(` at column 0; a
  describe with a tag object keeps its title; `Extra:` titles are plain titles.
- **Expected:** the surface reads the web-first matchers (part 3 §5).
- **Runner:** `-g` sees titles with their tags appended (part 3 §4); the title pattern allows them.
- **Tags in the runner result** (part 3 ruling 5) stay deferred: the card needs no tag, since the
  title says `Extra:`.

## 9. Errors

| Situation | Result |
|---|---|
| Playwright flag on a Vitest project, or the reverse | one line naming the flags that fit; stop before the gate |
| `config e2e-folder` fails (forbidden folder, wrong adapter) | its lines; stop before the gate |
| No route derived, none configured | the screen card with only "Another screen" and "Stop" |
| `--route` not starting with `/` | `--route must be a path in the app starting with /, like /orders` and stop |
| The app is down at check time | `not verified`; the card plus the app line |
| The spec is outside the config's `testDir` | `not verified` ("no tests found" / "never ran") |
| A formatter splits a tag list | `honesty` fails: undo once (as 4b), then rewrite with the list on one line |

## 10. Testing

- `e2eFolder`: configured folder; `testDir` from each config file name in order; `./`, backslashes
  and a trailing `/` normalized; commented line ignored; two different values, a computed value, `.`,
  `..`, absolute → default; no config file → default; forbidden folder (default rules and configured
  rules, `allow` wins); non-Playwright adapter. CLI: the line, the JSON, exit codes.
- Config: `playwright.folder` and `playwright.guide` (valid, not ending `/`, `..`, inside `src/`,
  allowed by `boundaries.allow`, guide not `.md`), the new unknown-key message, the schema.
- Commands: `write.md` and `start.md` pinned by string tests (both flows, the flags, the screen card,
  the plan card, the tags, the file naming, the extra and app lines, no `--target` for Playwright);
  the guide pinned (locators, web-first, no `waitForTimeout`, no `.only`, `test.fixme`, stubs, tags,
  extras, no project values).
- No new pipeline code (§8); its tests stay as they are.

## 11. Release

quality-code **0.8.0**: CHANGELOG (Added: `/quality-code:write` for Playwright projects, the
Playwright writing guide, `playwright.folder` and `playwright.guide`, `config e2e-folder`, `start`
option 3 for Playwright projects), README (writing Playwright tests, the two fields), Getting
started. Done at release, outside this branch.

## 12. Out of scope (later)

Design-conformance captures and reading Figma; XRay CSV rows; the runner returning tags and a card
"Extra" section; an advanced-setup card for the `playwright` block; several Playwright folders
(layers) per project; the warehouse's case-sheet input (`.xlsx` QA plans) and run log.

## 13. Acceptance criteria

1. `/quality-code:write` on a Playwright project with a passed ticket writes one spec in the e2e
   folder only, with the describe and test tags of §2, and shows the pipeline card.
2. A spec that does not assert the ticket's expected values fails `expected`; an `@anchor` without
   `@<KEY>` fails `honesty`.
3. The folder comes from a script; a forbidden folder stops the command.
4. `start` offers "Write and check tests" for both adapters.
5. All tests pass (except the two known container failures); no project values in `core/`.

## 14. Rulings during the build

Recorded here while building; where one differs from an earlier section, this one wins.
