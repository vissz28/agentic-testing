# Writing Playwright tests from a ticket

The generic rules `/quality-code:write` always follows on a Playwright project. The team's own guide
(set in `playwright.guide`) adds its conventions on top of these (fixtures, login, which APIs to
stub) and wins where they differ. So do the specs already in the e2e folder: copy their imports,
fixtures and login, never invent new ones.

## Shape

- One spec file per ticket, all its tests inside one `test.describe('<KEY> <summary>', { tag:
  '@<KEY>' }, () => { … })` block, written at the start of a line (not indented).
- **One behaviour per test.** If a title needs "and", it is two tests.
- A test from the ticket's scenarios is named after the scenario, in plain words. An extra probe
  (see below) is named `Extra: <what it probes>`. Neither gets a tag of its own when written: the
  describe's `@<KEY>` covers them.
- **Only a red test gets a tag**, added after the checks ran: `{ tag: ['@anchor', '@<KEY>'] }` on a
  red scenario test, `{ tag: ['@finding', '@<KEY>'] }` on a red extra probe. A merge gate that skips
  `@anchor` and `@finding` then knows the test is red on purpose. Never tag a test that passes: the
  tag hides it from the gate.
- **Keep the tag list on the `test(` line**, never split over lines: the honesty check reads one
  line at a time and fails an `@anchor` or `@finding` whose `@<KEY>` is on another line. If a
  formatter would wrap it, shorten the title.
- Open the screen with `await page.goto('<route>')` (a path: the config's `baseURL` gives the host),
  in the test or in a `test.beforeEach`.
- Arrange, act, assert, in that order, separated by a blank line.

```ts
import { test, expect } from '@playwright/test'

test.describe('ABC-123 Orders show their total', { tag: '@ABC-123' }, () => {
  test('an order of two items shows the total', async ({ page }) => {
    await page.goto('/orders/new')

    await page.getByRole('button', { name: 'Add item' }).click()

    await expect(page.getByRole('cell', { name: 'Total' })).toHaveText('€ 24,50')
  })

  // Came out red on the checks, so it got its tag after the run.
  test('Extra: a product name longer than the column', { tag: ['@finding', '@ABC-123'] }, async ({ page }) => {
    await page.goto('/orders/new')

    await page.getByLabel('Product name').fill('A'.repeat(200))

    await expect(page.getByRole('button', { name: 'Add item' })).toBeVisible()
  })
})
```

## Locators

- **Role and label first:** `getByRole('button', { name: 'Save' })`, `getByLabel('Email')`,
  `getByPlaceholder`, `getByText`, then `getByTestId` when the app has test ids. Use the names the
  ticket or the app's code shows, never a guess.
- No CSS or XPath selectors (`page.locator('.btn-primary')`, `//div[2]`) unless the team guide says
  so: they break when the markup changes and say nothing about what the user sees.
- No `nth()`, `first()` or `last()` unless the order is the behaviour under test.

## Assertions

- **Web-first assertions only:** `await expect(locator).toHaveText(…)`, `toContainText`,
  `toHaveValue`, `toHaveCount`, `toBeVisible`, `toBeEnabled`, `toHaveURL`, `toHaveTitle`,
  `toHaveAttribute`. They wait and retry.
- **Use the real expected values from the ticket**, written as the ticket writes them: the numbers
  and quoted texts of its Then / Expected lines go inside the matcher. The pipeline checks that every
  one of them is asserted.
- Never read a value back and compare it by hand (`expect(await el.textContent()).toBe(…)`,
  `expect(await el.isVisible()).toBe(true)`): it does not wait, so it flakes.
- No screenshot or snapshot for values (`toHaveScreenshot`, `toMatchSnapshot`): they record whatever
  the page shows.
- Prefer the exact matcher: `toHaveText('3 items')` over `toBeVisible()` on the same element.
- The mutation check changes the text inside a locator and flips each matcher; a test whose
  assertion still passes then fails the check. Assert on the element the ticket names.
- A behaviour the ticket does not pin down is a `test.fixme('…')`, never a guess.

## Waiting

- **No `page.waitForTimeout`** and no other sleep: web-first assertions and actions already wait.
- Wait for a condition instead: `await expect(locator).toBeVisible()`, `await page.waitForURL(…)`, or
  `page.waitForResponse(…)` when the ticket's behaviour is the request itself.

## State

- **Each test arranges its own state:** its own data, its own login (the project's fixture or
  `storageState`), its own page. No order between tests, no `test.describe.configure({ mode:
  'serial' })`, no value carried from one test to the next.
- Never depend on data a previous run left behind, on today's date or on the machine's time zone:
  `page.clock` sets the time when the screen shows dates.

## Network stubs

- **Stub only at boundaries**, with `page.route(…)`: third-party services (payments, maps,
  analytics, an identity provider, a mail or chat service), and the app's own API only when the
  team guide says so or the specs already in the folder stub it. Everything else runs for real.
- **Copy the response shape from an existing stub** in the folder, never guess it. Fill it with the
  ticket's facts.
- Every field the ticket names appears on a stubbed row, even one the screen does not show yet.
- One row per fact; several rows only when the expected result depends on how many there are (a
  count, paging, ordering, an empty list).
- Playwright uses the handler registered **last** among those that match: register the broad route
  first and the more specific ones after it.
- No real customer data, ids or tokens in a stub; write values as the API returns them (a decimal
  string stays a string).
- `await route.fulfill({ json })` for a response; keep the stubs in the spec, not in a new data file.

## Extra probes

Cases the ticket did not state, where a finished feature often breaks. Pick **at most 3** that apply
to this screen; none is fine. Each is its own `Extra:` test.

- **Empty:** no items; the empty state shows.
- **Long text:** a 200-character name or description; the layout still holds.
- **Numbers:** zero, negative, decimals, very large; the format holds, no `NaN`.
- **Missing fields:** an optional value absent; the row still renders.
- **Special characters:** accents, emoji, quotes in a name; it renders and search still finds it.
- **A large list:** 100 or more rows; the list still renders.
- **A second language:** one key text in each language the app ships.
- **Dates:** the first and last day of a period, a time-zone edge.

What a probe asserts, in this order:

1. A concrete value from the ticket, the branch's code or the app's own translation files.
2. Otherwise, that the screen still works: an element a ticket scenario names is still visible and
   usable.
3. Otherwise, do not write the probe. Never invent an expected value.

A red extra test is a case the ticket does not cover: report it, never loosen it to make it pass.

## Never

- `.only` (`test.only`, `test.describe.only`): it silently drops every other test.
- `page.waitForTimeout(…)` or any fixed sleep.
- `.skip` without a ticket key in its title, or a test with no `expect`.
- An `expect` that cannot fail, or one on a value the test itself just typed.
- `{ force: true }` on an action to get past an element that is covered or disabled: that is the
  behaviour to report.
- A change to application code, config or another team's test to make a test pass.
