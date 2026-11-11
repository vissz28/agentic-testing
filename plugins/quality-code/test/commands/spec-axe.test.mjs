// AGT-167: every Playwright screen test also scans the screen with axe (WCAG 2.1 AA).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scanDiff } from '../../lib/pipeline/checks/honesty.mjs'
import { grade } from '../../lib/pipeline/checks/suite-honesty.mjs'
import { planMutants } from '../../lib/pipeline/checks/mutation.mjs'
import { dialectFor } from '../../lib/base/dialects/index.mjs'

const doc = readFileSync(new URL('../../commands/spec.md', import.meta.url), 'utf8')
const guide = readFileSync(new URL('../../guides/playwright-writing.md', import.meta.url), 'utf8')
const axeSection = guide.slice(guide.indexOf('## Accessibility (axe)'), guide.indexOf('## Waiting'))
const P = dialectFor('playwright')

test('guide: an axe section with @axe-core/playwright, the four WCAG 2.1 AA tags and a failing assertion', () => {
  assert.ok(axeSection.length > 200)
  assert.match(axeSection, /import AxeBuilder from '@axe-core\/playwright'/)
  for (const t of ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']) assert.ok(axeSection.includes(`'${t}'`), t)
  assert.ok(axeSection.includes('expect(results.violations).toEqual([])'))
  assert.match(axeSection, /Never filter a violation/)
})
test('guide: how to install it, and ask before installing', () => {
  assert.match(axeSection, /npm install -D\s+@axe-core\/playwright/)
  assert.match(axeSection, /ask before installing/)
})
test('guide: it can be turned off per run', () => {
  assert.match(axeSection, /--no-axe/)
})
test('spec: the plan card has the Accessibility line and the install question', () => {
  assert.ok(doc.includes('Accessibility: checked on <N> screens'))
  assert.ok(doc.includes('Accessibility: off (--no-axe)'))
  assert.match(doc, /@axe-core\/playwright is not installed\. Install it as a dev dependency/)
  const at = doc.indexOf('Accessibility: checked on <N> screens')
  assert.ok(at > 0 && doc.indexOf('1. Yes, write these tests', at) - at < 60)
})
test('spec: step 5 writes the axe test unless the card said off, and it is no pinned value', () => {
  assert.match(doc, /ends with the one axe test of the guide's "Accessibility \(axe\)" section/)
  assert.match(doc, /needs no entry in the pinned values/)
})
test('spec: --no-axe is a Playwright flag, listed in the examples', () => {
  assert.ok(doc.includes('--no-axe'))
  assert.ok(doc.includes('/quality-code:spec ABC-123 --no-axe'))
})

// The pipeline checks take the axe test as it is written.
const SPEC = `import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('ABC-123 Orders show their total', { tag: '@ABC-123' }, () => {
  test('an order shows the total', async ({ page }) => {
    await page.goto('/orders/new')

    await expect(page.getByRole('cell', { name: 'Total' })).toHaveText('€ 24,50')
  })

  test('Accessibility: /orders/new has no axe violations', async ({ page }) => {
    await page.goto('/orders/new')
    await expect(page.getByRole('heading', { name: 'New order' })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })
})
`
test('checks: honesty and suite honesty accept the axe test; mutation plans mutants for it', () => {
  const diff = `+++ b/e2e/orders-new.abc-123.spec.ts\n${SPEC.split('\n').map(l => `+${l}`).join('\n')}`
  assert.deepEqual(scanDiff(diff, P, '(?:ABC)-\\d+'), [])
  const r = grade([{ path: 'e2e/orders-new.abc-123.spec.ts', src: SPEC }], { key: 'ABC-123' }, P)
  assert.equal(r.status, 'pass', r.summary)
  assert.equal(r.data.hollow, 0)
  assert.equal(r.data.withAssertion, 2)
  const ms = planMutants(SPEC, ['an order shows the total', 'Accessibility: /orders/new has no axe violations'], { key: 'ABC-123' }, P)
  assert.ok(ms.some(m => m.title.startsWith('Accessibility')), 'the axe assertion is mutated')
})
