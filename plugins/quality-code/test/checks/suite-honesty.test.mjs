import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchorRange, grade, scoreSpec, skippedGroupRanges } from '../../core/checks/suite-honesty.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'

const V = dialectFor('vitest')
const P = dialectFor('playwright')

test('vitest: the backend self-test', () => {
  const t = scoreSpec("it('a', () => { expect(x).toBe(1) });it.skip('b', () => { expect(y).toBe(2) });it.todo('c');test('d', () => { doThing() })", V)
  assert.equal(t.length, 4)
  assert.ok(t[0].expects === 1 && !t[0].mod)
  assert.equal(t[1].mod, 'skip')
  assert.ok(t[2].mod === 'todo' && t[2].expects === 0)
  assert.ok(!t[3].mod && t[3].expects === 0)
  const wrapped = scoreSpec('describe.skip("FIC-1 — bug", () => {' + "it('a', () => { expect(x).toBe(1) });it('b', () => { expect(y).toBe(2) });})", V)
  assert.ok(wrapped.every(w => w.mod === 'skip'))
  assert.equal(scoreSpec(`describe("FIC-1 — bug", () => { it('a', () => { expect(x).toBe(1) }); })`, V)[0].mod, null)
  assert.equal(skippedGroupRanges(`describe("A", () => {});\ndescribe.skip("B", () => {});`, V).length, 1)
  assert.notEqual(anchorRange('describe.skip("FIC-9 — x", () => {});', 'FIC-9', V), null)
  const scoped = "it('legacy-hollow', () => { doLegacy() });\ndescribe('FIC-9 — anchor', () => {\n  it('inside', () => { expect(z).toBe(3) });\n});\ndescribe('OTHER — later', () => { it('other-hollow', () => {}) });\n"
  const r = anchorRange(scoped, 'FIC-9', V)
  const inside = scoreSpec(scoped, V).filter(x => x.idx >= r[0] && x.idx < r[1])
  assert.deepEqual(inside.map(x => x.title), ['inside'])
  assert.equal(anchorRange(scoped, 'FIC-404', V), null)
})

test('playwright: the frontend self-test', () => {
  const t = scoreSpec("test('a', () => { expect(x).toBe(1) });test.skip('b', () => { expect(y).toBe(2) });test('c capture', () => { page.screenshot() });test.fixme('d', () => {});test('e', () => { page.goto('/x') })", P)
  assert.equal(t.length, 5)
  assert.ok(t[0].expects === 1 && !t[0].capture && !t[0].mod)
  assert.equal(t[1].mod, 'skip')
  assert.ok(t[2].capture)
  assert.ok(t[3].mod === 'fixme' && t[3].expects === 0)
  assert.ok(!t[4].mod && !t[4].capture && t[4].expects === 0)
  const it = scoreSpec("it('f', () => { expect(z).toBe(3) });it('g', () => { doNothing() })", P)
  assert.ok(it[0].expects === 1 && !it[0].mod && !it[1].mod && it[1].expects === 0)
})

test('grade: a hollow test fails and is named', () => {
  const r = grade([{ path: 'a.spec.ts', src: "it('ok', () => { expect(1).toBe(1) });it('empty', () => { run() })" }], {}, V)
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.findings, [{ file: 'a.spec.ts', test: 'empty', kind: 'hollow test', detail: 'runs but has no expect()' }])
  assert.equal(r.data.percent, 50)
})

test('grade: nothing asserting at all fails; one todo next to a real test passes', () => {
  assert.equal(grade([{ path: 'a', src: "it.todo('x');it.todo('y')" }], {}, V).status, 'fail')
  const ok = grade([{ path: 'a', src: "it('x', () => { expect(1).toBe(1) });it.todo('y')" }], {}, V)
  assert.equal(ok.status, 'pass')
  assert.deepEqual(ok.data, { tests: 2, withAssertion: 1, hollow: 0, todo: 1, skipped: 0, capture: 0, percent: 50 })
})

test('grade: capture tests are left out (playwright)', () => {
  const r = grade([{ path: 'a', src: "test('ABC-1 — design-conformance capture', () => { shot() });test('b', () => { expect(1).toBe(1) })" }], {}, P)
  assert.equal(r.status, 'pass')
  assert.equal(r.data.capture, 1)
  assert.equal(r.data.tests, 1)
})

test('grade --key: only the anchor block; a missing block is not_run (Ruling 2)', () => {
  const src = "it('old-hollow', () => {});\ndescribe('ABC-9 — anchor', () => {\n  it('in', () => { expect(1).toBe(1) })\n})\n"
  assert.equal(grade([{ path: 'a', src }], { key: 'ABC-9' }, V).status, 'pass')
  const miss = grade([{ path: 'a', src }], { key: 'ABC-10' }, V)
  assert.equal(miss.status, 'not_run')
  assert.match(miss.summary, /no ABC-10 block/)
})

test('grade --key works for playwright groups too', () => {
  const src = "test('old', () => {});\ntest.describe('ABC-9 — anchor', () => {\n  test('in', async () => { await expect(x).toBeVisible() })\n})\n"
  assert.equal(grade([{ path: 'a', src }], { key: 'ABC-9' }, P).status, 'pass')
  assert.equal(grade([{ path: 'a', src }], {}, P).status, 'fail')
})

test('anchorRange: --key does not substring-match; ABC-1 does not match ABC-10', () => {
  assert.equal(anchorRange("describe('ABC-10 — x', () => {})\n", 'ABC-1', V), null)
  assert.notEqual(anchorRange("describe('ABC-10 — x', () => {})\ndescribe('ABC-1 — y', () => {})", 'ABC-1', V), null)
  assert.notEqual(anchorRange("describe('Fix ABC-1: thing', () => {})", 'ABC-1', V), null)
})

test('grade --key: skips files without the block, not_run only when no file has it', () => {
  const noBlock = "it('x', () => { expect(1).toBe(1) })"
  const withBlock = "describe('ABC-9 — anchor', () => { it('y', () => { expect(2).toBe(2) }) })"
  const twoFiles = [
    { path: 'first.spec.ts', src: noBlock },
    { path: 'second.spec.ts', src: withBlock }
  ]
  const r = grade(twoFiles, { key: 'ABC-9' }, V)
  assert.equal(r.status, 'pass')
  assert.equal(r.data.tests, 1)
  const neither = [
    { path: 'a.spec.ts', src: noBlock },
    { path: 'b.spec.ts', src: noBlock }
  ]
  const miss = grade(neither, { key: 'ABC-9' }, V)
  assert.equal(miss.status, 'not_run')
  assert.match(miss.summary, /a\.spec\.ts.*b\.spec\.ts/)
})
