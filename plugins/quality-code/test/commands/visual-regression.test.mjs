// Visual checks (AGT-170): screenshot baselines are optional, confirmed by the person, committed and allowed by the boundary.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rulesFor, violation } from '../../lib/pipeline/boundary.mjs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const spec = read('commands/spec.md')
const writing = read('guides/playwright-writing.md')
const guide = read('guides/visual-regression.md')
const setup = read('bin/setup.mjs')

test('spec.md plan card has the Visual line and points to the guide; baselines are never silent', () => {
  assert.ok(spec.includes('Visual: baseline for <N> screens'))
  assert.ok(spec.includes('guides/visual-regression.md'))
  assert.match(spec, /never created or updated silently/)
  assert.match(spec, /Figma comparison comes later/)
  assert.ok(writing.includes('guides/visual-regression.md'))
})
test('the guide covers masking, a fixed viewport, updating baselines and confirmation', () => {
  for (const s of ['toHaveScreenshot', 'mask:', 'viewport', '--update-snapshots', 'Visual: baseline for N screens', 'Never create or update one silently', '-snapshots/', 'Figma']) assert.ok(guide.includes(s), s)
})
test('setup ignores test output but never the baseline folders', () => {
  assert.match(setup, /PLAYWRIGHT_GITIGNORE = \['test-results\/', 'playwright-report\/'\]/)
  assert.ok(!/-snapshots/.test(setup))
})
test('the boundary lets a run write a spec\'s baseline images even in a forbidden folder', () => {
  const rules = rulesFor({}, '/nonexistent')
  assert.equal(violation('src/orders.spec.ts-snapshots/orders-grid-chromium-darwin.png', rules), null)
  assert.equal(violation('e2e/orders.spec.ts-snapshots/orders-grid-chromium-linux.png', rules), null)
  assert.ok(violation('src/logo.png', rules), 'other images in src stay forbidden')
  assert.ok(violation('src/orders.ts', rules))
})
