// A spec in the shape /quality-code:write gives Playwright projects (guides/playwright-writing.md)
// must pass the static checks as they are: part 3b needs no pipeline change (spec §8).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanDiff } from '../../../lib/pipeline/checks/honesty.mjs'
import { grade, anchorRange } from '../../../lib/pipeline/checks/suite-honesty.mjs'
import { surface, tokensFrom, asserted } from '../../../lib/pipeline/checks/expected.mjs'
import { planMutants } from '../../../lib/pipeline/checks/mutation.mjs'
import { dialectFor } from '../../../lib/base/dialects/index.mjs'
import { titlePattern } from '../../../lib/pipeline/runners/playwright.mjs'

const P = dialectFor('playwright')
const KEYS = '(?:ABC)-\\d+'
const SPEC = `import { test, expect } from '@playwright/test'

test.describe('ABC-123 Orders show their total', { tag: '@ABC-123' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/orders')
  })

  test('an order of two items shows the total', { tag: ['@anchor', '@ABC-123'] }, async ({ page }) => {
    await page.getByRole('button', { name: 'Add item' }).click()

    await expect(page.getByRole('cell', { name: 'Total' })).toHaveText('€ 24,50')
  })

  test('an empty order says so', { tag: ['@anchor', '@ABC-123'] }, async ({ page }) => {
    await expect(page.getByText('No items yet')).toBeVisible()
  })

  test.fixme('a discount code lowers the total', { tag: ['@anchor', '@ABC-123'] }, async () => {})

  test('Extra: a product name longer than the column', { tag: ['@finding', '@ABC-123'] }, async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible()
  })
})
`
const ticket = {
  summary: 'Orders show their total',
  text: { description: '## Acceptance criteria\n\nScenario: two items\nGiven an order\nWhen I add an item\nThen the total shows "€ 24,50"\n\nScenario: empty\nGiven no items\nThen the page shows "No items yet"' },
}

test('honesty: a new spec in the writing shape has no finding (every tag list holds its @KEY)', () => {
  const diff = `+++ b/e2e/orders.abc-123.spec.ts\n${SPEC.split('\n').map(l => `+${l}`).join('\n')}`
  assert.deepEqual(scanDiff(diff, P, KEYS), [])
})
test('honesty: a tag list split over two lines fails, as the guide warns', () => {
  const diff = "+++ b/e2e/x.spec.ts\n+  test('t', { tag: [\n+    '@anchor',\n+    '@ABC-123',\n+  ] }, async () => {})"
  assert.deepEqual(scanDiff(diff, P, KEYS).map(v => v.kind), ['anchor tag without a ticket tag'])
})
test('suite honesty: the describe with a tag object is the key block; fixme is to do; Extra tests are graded', () => {
  assert.ok(anchorRange(SPEC, 'ABC-123', P))
  const r = grade([{ path: 'e2e/orders.abc-123.spec.ts', src: SPEC }], { key: 'ABC-123' }, P)
  assert.equal(r.status, 'pass', r.summary)
  assert.deepEqual({ tests: r.data.tests, withAssertion: r.data.withAssertion, todo: r.data.todo, hollow: r.data.hollow }, { tests: 4, withAssertion: 3, todo: 1, hollow: 0 })
})
test('expected: the ticket\'s values are read from the web-first matchers in the key block', () => {
  const s = surface(SPEC, 'ABC-123', P)
  const tokens = tokensFrom(ticket)
  assert.deepEqual(tokens.map(t => t.token).sort(), ['No items yet', '€ 24,50'])
  for (const t of tokens) assert.ok(asserted(t, s), t.token)
})
test('mutation: every expect of a green test gets mutants, the fixme test none', () => {
  const titles = ['an order of two items shows the total', 'an empty order says so', 'Extra: a product name longer than the column']
  const ms = planMutants(SPEC, titles, { key: 'ABC-123' }, P)
  assert.deepEqual([...new Set(ms.map(m => m.title))].sort(), [...titles].sort())
  assert.ok(!ms.some(m => m.title.startsWith('a discount')))
})
test('runner: -g finds a tagged test by its exact title', () => {
  const re = new RegExp(titlePattern('Extra: a product name longer than the column'))
  assert.ok(re.test('chromium e2e/orders.abc-123.spec.ts ABC-123 Orders show their total Extra: a product name longer than the column @finding @ABC-123 @ABC-123'))
})
