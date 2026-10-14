import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanDiff } from '../../core/checks/honesty.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'

const KEYS = '(?:FIC|AGT)-\\d+'
const be = s => scanDiff(`+++ b/x.spec.ts\n${s}`, dialectFor('vitest'), KEYS)
const fe = s => scanDiff(`+++ b/x.spec.ts\n${s}`, dialectFor('playwright'), KEYS)
const kinds = v => v.map(x => x.kind)

test('vitest: the backend self-test', () => {
  assert.equal(be("+  expect(x).toBe(1)\n+it('n', () => {})").length, 0)
  assert.ok(kinds(be('-  expect(x).toBe(1)')).includes('assertion removed'))
  assert.ok(kinds(be("-it('t', () => {})")).includes('test removed'))
  assert.ok(kinds(be("-describe('t', () => {})")).includes('test removed'))
  assert.ok(kinds(be("+it.skip('t', () => {})")).includes('test newly skipped'))
  assert.ok(kinds(be("+describe.skip('t', () => {})")).includes('test newly skipped'))
  assert.equal(be("+it.todo('t')").length, 0)
  assert.equal(be("+it.skip('flaky (AGT-8)', () => {})").length, 0)
  assert.ok(kinds(be("+it.skip('flaky', () => {})")).includes('test newly skipped'))
  assert.equal(be("-it.skip('t', () => {})").length, 0)
  assert.equal(be("-it.skip('t', () => {})\n+it('t', () => {})").length, 0)
})
test('vitest: no move forgiveness (backend behaviour)', () => {
  assert.ok(kinds(be('-  expect(x).toBe(1)\n+    expect(x).toBe(1)')).includes('assertion removed'))
})
test('playwright: the frontend self-test', () => {
  assert.equal(fe("+  await expect(x).toBeVisible()\n+test('n', async () => {})").length, 0)
  assert.ok(kinds(fe('-  await expect(x).toBeVisible()')).includes('assertion removed'))
  assert.ok(kinds(fe("-test('t', async () => {})")).includes('test removed'))
  assert.ok(kinds(fe("+test.skip('t', async () => {})")).includes('test newly skipped'))
  assert.equal(fe("+test.fixme('t', async () => {})").length, 0)
  assert.equal(fe("-test.skip('t', async () => {})").length, 0)
  assert.ok(kinds(fe("-it('t', async () => {})")).includes('test removed'))
  assert.ok(kinds(fe("+it.skip('t', async () => {})")).includes('test newly skipped'))
  assert.equal(fe("+test.skip('flaky (AGT-8)', async () => {})").length, 0)
  assert.equal(fe("+it.skip('flaky (FIC-1234)', async () => {})").length, 0)
  assert.ok(kinds(fe("+test.skip('flaky', async () => {})")).includes('test newly skipped'))
  assert.equal(fe("-test('FIC-1-1-a', async ({ page }) => {\n+test('FIC-1-1-a', { tag: ['@anchor', '@FIC-1'] }, async ({ page }) => {").length, 0)
  assert.equal(fe("-test('FIC-1-1-a', async () => {\n+test(\n+  'FIC-1-1-a',\n+  ANCHOR,").length, 0)
  assert.ok(kinds(fe("-test('FIC-1-1-a', async () => {\n+test('FIC-1-1-b', async () => {")).includes('test removed'))
  assert.equal(fe('-  await expect(x).toBeVisible()\n+    await expect(x).toBeVisible()').length, 0)
  assert.equal(fe('-  await expect(x).toBeVisible()\n-  await expect(x).toBeVisible()\n+    await expect(x).toBeVisible()').filter(v => v.kind === 'assertion removed').length, 1)
  assert.ok(kinds(fe('-  await expect(x).toBeVisible()\n+    await expect(x).toBeHidden()')).includes('assertion removed'))
  assert.ok(kinds(fe("-test('t', async () => {\n+++ b/y.spec.ts\n+test('t', async () => {")).includes('test removed'))
  assert.equal(fe("+test('FIC-1-1-a', { tag: ['@anchor', '@FIC-1'] }, async () => {})").length, 0)
  assert.equal(fe("+  { tag: ['@finding', '@AGT-7'] },").length, 0)
  assert.ok(kinds(fe("+test('a', { tag: '@anchor' }, async () => {})")).includes('anchor tag without a ticket tag'))
})
test('tracked keys come from the config, not from fixed projects', () => {
  const v = scanDiff("+++ b/x.spec.ts\n+it.skip('flaky (ABC-3)', () => {})\n+it.skip('flaky (AGT-3)', () => {})", dialectFor('vitest'), '(?:ABC)-\\d+')
  assert.deepEqual(v.map(x => x.line), ["it.skip('flaky (AGT-3)', () => {})"])
})
test('violations carry no internal title field', () => {
  assert.deepEqual(Object.keys(be("-it('t', () => {}")[0]).sort(), ['file', 'kind', 'line'])
})
