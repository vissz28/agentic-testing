# Visual checks (Playwright screenshots)

Optional. A layout change that breaks a screen is caught by comparing a screenshot of the screen with a
saved one, the baseline. It sits next to the ticket's scenarios: it never replaces a scenario's own
assertion. Playwright only; Vitest and the backend runners have no screenshots. Comparing with a Figma
design is out of scope here (a later ticket).

## When to offer it

Offer it when the ticket changes how a screen looks (a layout, a table, a card, a form) and the project
is Playwright. Skip it for a ticket about behaviour only, and when `$ARGUMENTS` has `--no-extras`.
The plan card carries one line, `Visual: baseline for N screens`, N being the screens that get a
`toHaveScreenshot` (one per screen, not one per scenario). No such line when there are none.

## The person confirms the baselines

A baseline says "this is how the screen must look from now on". Never create or update one silently:

- First time: the plan card's line is the question. `Yes, write these tests` confirms the baselines
  too; `Something else` can drop the visual checks.
- With `--yes` or `--ci`, create no baseline: write the check, leave the screens without a baseline
  and say `Visual: N screens have no baseline yet: run with --update-snapshots and review the images.`
- An existing baseline that differs is a finding, not something to overwrite. Show which screen
  differs and ask before updating it.
- After a baseline is created, tell the person to open the new `.png` files and look at them before
  committing: a baseline of a broken screen protects the break.

## Writing the check

- One `await expect(page).toHaveScreenshot('<screen>.png', { ... })` at the end of the scenario that
  shows the screen in its final state, after the assertions on its texts, so the page has loaded.
  Name it after the screen in kebab case (`orders-grid.png`), never after a ticket key.
- A fixed viewport, so every machine takes the same picture: `test.use({ viewport: { width: 1280, height: 720 } })`
  once in the file (or `use.viewport` in the config). Never rely on the window size.
- Mask what changes on every run, with `mask: [page.getByTestId('last-updated')]` (dates, times,
  counters, avatars, ads, anything random), and keep the data in the test stubbed so the rest is stable.
- `animations: 'disabled'` and `caret: 'hide'` are the defaults for screenshots; keep them. Wait for the
  data (`await expect(rows).toHaveCount(3)`) before the screenshot, never a fixed pause.
- Tolerance: leave the default. If a font renders slightly differently, set `maxDiffPixelRatio: 0.01`
  in the config's `expect.toHaveScreenshot`, not a large number per test. Never raise it to make a red
  check pass.
- Full page only when the screen is short; otherwise screenshot the region
  (`await expect(page.getByRole('table')).toHaveScreenshot('orders-table.png')`).

## Where baselines live

Playwright saves them beside the spec, in `<spec file>-snapshots/<name>-<project>-<platform>.png`
(for example `orders.spec.ts-snapshots/orders-grid-chromium-darwin.png`). They are committed with the
test: never in `.gitignore` (only `test-results/` and `playwright-report/` are ignored). The platform is
part of the name: a baseline taken on a Mac does not match a Linux CI run. Create the CI ones in the
same environment as CI (the Playwright Docker image), or keep the visual checks to one platform.
Keep the default path; do not set `snapshotPathTemplate`.

## Creating and updating baselines

- Create (no baseline yet) or update (the change is wanted): run the spec with `--update-snapshots`,
  for example `npx playwright test <spec> --update-snapshots`, after the person confirmed.
- Then run the spec again without the flag: it must pass.
- Commit the `.png` files with the spec, and say in the pull request which screens changed.
- A red `toHaveScreenshot` is a finding: open the diff in `test-results/` (expected, actual, diff) and
  report what changed. Update the baseline only when the change is wanted and the person says so.

## What the checks do with it

`*-snapshots/` folders are tests' data: the boundary check lets a run write the `.png` baselines of a
spec, and setup never ignores them. `toHaveScreenshot` is an assertion for the honesty check, but the
mutation check has nothing to flip in it, so it is judged only by the test staying green.
