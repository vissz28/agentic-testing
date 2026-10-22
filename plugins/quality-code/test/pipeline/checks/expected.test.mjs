import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { asserted, normNum, run, surface, tokensFrom } from '../../../lib/pipeline/checks/expected.mjs'
import { dialectFor } from '../../../lib/base/dialects/index.mjs'
import { buildVocabulary } from '../../../lib/ticket/languages/index.mjs'

const V = dialectFor('vitest')
const ticket = (description, acField = '') => ({ key: 'ABC-7', summary: 'Pricing', text: { description, acField } })
const values = t => t.map(x => x.token)

test('normNum: both decimal styles, thousands, trailing zeros and the minus sign agree', () => {
  for (const s of ['1.234,5', '1,234.5', '1234.5', '1234.50', '1 234.5'.replace(' ', '')]) assert.ok(normNum(s).includes('1234.5'), s)
  assert.deepEqual(normNum('−5'), ['-5'])
  assert.deepEqual(normNum('-5'), ['-5'])
  assert.deepEqual(normNum('+5'), ['5'])
  assert.deepEqual(normNum('2,5'), ['2.5'])
  assert.deepEqual(normNum('0.50'), ['0.5'])
  assert.deepEqual(normNum('007'), ['7'])
  assert.deepEqual(normNum('-0'), ['0'])
  assert.deepEqual(normNum('1,000').sort(), ['1', '1000'])
  assert.deepEqual(normNum('1.000.000'), ['1000000'])
  assert.deepEqual(normNum('1.2.3'), [])
})

test('tokens: numbers and quoted strings from the Then lines, never plain words', () => {
  const t = tokensFrom(ticket([
    '## Acceptance criteria',
    'Given a cart with 3 items',
    'When I apply the code "SAVE10"',
    "Then the total is 1.234,50 and the banner reads 'Discount applied'",
    'And the user\'s balance shows −5',
  ].join('\n')))
  assert.deepEqual(values(t), ['Discount applied', '1.234,50', '-5'])
  assert.equal(t[1].from, "the total is 1.234,50 and the banner reads 'Discount applied'")
  assert.equal(t[0].kind, 'string')
  assert.deepEqual(t[1].values, ['1234.5'])
})

test('tokens: a key, a version and a word with digits are not numbers', () => {
  const t = tokensFrom(ticket('## Expected\nThe badge for ABC-12 shows v2 on release 1.2.3 and counts 4.'))
  assert.deepEqual(values(t), ['4'])
})

test('tokens: Expected sections, the criteria field and "instead of" count; a value twice is one token', () => {
  const t = tokensFrom(ticket('## Steps\n1. open\n## Expected\nThe total is 10.00\n## Actual\nThe total is 12', 'The total is 10 for two items.'))
  assert.deepEqual(values(t), ['10.00'])
  const i = tokensFrom(ticket('Then it shows 3 instead of 5'))
  assert.ok(values(i).includes('5'))
})

test('tokens: quoted strings of 2 to 80 characters only', () => {
  const long = 'x'.repeat(81)
  const t = tokensFrom(ticket(`Then it reads "a" and "ok" and "${long}" and “Saved”`))
  assert.deepEqual(values(t), ['ok', 'Saved'])
})

test('tokens: none when the ticket states no concrete value', () => {
  assert.deepEqual(tokensFrom(ticket('Then the user sees the confirmation page')), [])
  assert.deepEqual(tokensFrom(ticket('')), [])
  assert.deepEqual(tokensFrom({}), [])
})

test('tokens: Italian Then lines with the Italian vocabulary', () => {
  const t = tokensFrom(ticket('Allora il totale è 1.234,50'), buildVocabulary(['it']))
  assert.deepEqual(values(t), ['1.234,50'])
})

const spec = (inside, outside = '') => `${outside}\ndescribe('ABC-7 pricing', () => {\n${inside}\n})\ndescribe('OTHER', () => {})\n`

test('surface: the argument text of the assertion calls inside the key block only', () => {
  const src = spec("  it('a', () => {\n    const r = total([1, 2])\n    expect(r.sum).toBe(1234.5)\n    expect(msg).toEqual('Discount applied')\n    doThing(99)\n  })", "it('x', () => { expect(y).toBe(777) })")
  const s = surface(src, 'ABC-7', V)
  assert.match(s, /1234\.5/)
  assert.match(s, /Discount applied/)
  assert.doesNotMatch(s, /777/)
  assert.doesNotMatch(s, /99/)
  assert.equal(surface(src, 'ABC-8', V), null)
})

test('surface: every listed matcher, nested parens and strings with parens', () => {
  const s = surface(spec("  it('a', () => {\n    expect(fn(a(1))).toStrictEqual({ v: '(2)' })\n    expect(list).toContain(3)\n    expect(o).toMatchObject({ n: 4 })\n    expect(o).toHaveProperty('p', 5)\n    expect(() => go()).toThrow('six')\n  })"), 'ABC-7', V)
  for (const v of ['1', "'(2)'", '3', '4', '5', 'six']) assert.ok(s.includes(v), v)
})

test('asserted: numbers by value, strings as written or escaped', () => {
  const n = { kind: 'number', values: ['1234.5'], token: '1.234,50' }
  assert.ok(asserted(n, 'total, 1234.50'))
  assert.ok(asserted(n, "'1.234,5'"))
  assert.ok(!asserted(n, '12345'))
  assert.ok(!asserted({ kind: 'number', values: ['-5'], token: '-5' }, 'x, 5'))
  assert.ok(asserted({ kind: 'number', values: ['-5'], token: '-5' }, 'x, -5'))
  assert.ok(asserted({ kind: 'string', token: "it's done" }, "'it\\'s done'"))
  assert.ok(!asserted({ kind: 'string', token: 'Saved' }, "'saved'"))
})

function proj(files) {
  const d = mkdtempSync(join(tmpdir(), 'qc-expected-'))
  for (const [p, s] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
  return { root: d, dialect: V, config: { languages: ['en'] } }
}
const T = JSON.stringify(ticket('## Acceptance criteria\nGiven a cart\nWhen I check out\nThen the total is 1.234,50 and the banner reads "Discount applied"'))

test('run: pass when every ticket value is asserted in the block, across several specs', () => {
  const ctx = proj({
    't.json': T,
    'test/a.spec.ts': spec("  it('a', () => { expect(total()).toBe(1234.5) })"),
    'test/b.spec.ts': spec("  it('b', () => { expect(banner()).toBe('Discount applied') })"),
  })
  const r = run({ specs: ['test/a.spec.ts', 'test/b.spec.ts'], key: 'ABC-7', ticket: 't.json' }, ctx)
  assert.equal(r.status, 'pass', r.summary)
  assert.equal(r.summary, 'all 2 expected value(s) from the ticket are asserted')
  assert.deepEqual(r.data, { tokens: 2, asserted: 2, missing: [] })
})

test('run: a ticket value missing from the spec fails, naming the value and its Then', () => {
  const ctx = proj({ 't.json': T, 'test/a.spec.ts': spec("  it('a', () => { expect(total()).toBe(1234.5); expect(banner()).toBeTruthy() })") })
  const r = run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, ctx)
  assert.equal(r.status, 'fail')
  assert.equal(r.summary, '1 of 2 expected value(s) from the ticket not asserted')
  assert.equal(r.findings[0].token, 'Discount applied')
  assert.equal(r.findings[0].detail, 'Discount applied (from "the total is 1.234,50 and the banner reads "Discount applied"")')
})

test('run: an invented value in the spec is never required; a value only outside the block fails', () => {
  const extra = proj({ 't.json': T, 'test/a.spec.ts': spec("  it('a', () => { expect(total()).toBe(1234.5); expect(b()).toBe('Discount applied'); expect(c()).toBe(42) })") })
  assert.equal(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, extra).status, 'pass')
  const outside = proj({ 't.json': T, 'test/a.spec.ts': spec("  it('a', () => { expect(b()).toBe('Discount applied') })", "it('x', () => { expect(total()).toBe(1234.5) })") })
  const r = run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, outside)
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.data.missing, ['1.234,50'])
})

test('run: no concrete values is a pass that says so', () => {
  const ctx = proj({ 't.json': JSON.stringify(ticket('Then the user sees the confirmation page')), 'test/a.spec.ts': spec("  it('a', () => { expect(page()).toBeTruthy() })") })
  const r = run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, ctx)
  assert.equal(r.status, 'pass')
  assert.equal(r.summary, 'no concrete expected values in the ticket')
})

test('run: not_run without a block, a key, or a readable ticket', () => {
  const ctx = proj({ 't.json': T, 'bad.json': '{', 'null.json': 'null', 'test/a.spec.ts': "it('a', () => { expect(1).toBe(1234.5) })" })
  const noBlock = run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, ctx)
  assert.equal(noBlock.status, 'not_run')
  assert.equal(noBlock.summary, 'no ABC-7 block in test/a.spec.ts')
  assert.equal(run({ specs: ['test/a.spec.ts'], key: null, ticket: 't.json' }, ctx).status, 'not_run')
  for (const f of ['missing.json', 'bad.json', 'null.json', null]) {
    const r = run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: f }, ctx)
    assert.equal(r.status, 'not_run', String(f))
    assert.match(r.summary, /^cannot read the ticket file: /)
  }
})
test('surface: Playwright web-first matchers count for the Playwright dialect only', () => {
  const src = "test.describe('ABC-7 cart', () => {\n  test('total', async ({ page }) => {\n    await expect(page.getByTestId('total')).toHaveText('12,50 €')\n    await expect(page).toHaveURL('/cart/42')\n    await expect(rows).toHaveCount(3)\n  })\n})\n"
  const s = surface(src, 'ABC-7', dialectFor('playwright'))
  for (const v of ["'12,50 €'", "'/cart/42'", '3', "page.getByTestId('total')"]) assert.ok(s.includes(v), v)
  const vt = surface(src.replace("test.describe('ABC-7 cart'", "describe('ABC-7 cart'"), 'ABC-7', V)
  assert.ok(!vt.includes("'12,50 €'"))
  assert.ok(vt.includes("page.getByTestId('total')"))
})

test('run: a negated matcher and a commented-out expect assert nothing', () => {
  const t = JSON.stringify(ticket('## Acceptance criteria\nGiven a cart\nWhen I check out\nThen the total is 80'))
  const not = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(total()).not.toBe(80) })") })
  assert.deepEqual(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, not).data.missing, ['80'])
  const commented = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => {\n    // expect(total()).toBe(80)\n    /* expect(total()).toBe(80) */\n    expect(total()).toBeDefined()\n  })") })
  assert.deepEqual(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, commented).data.missing, ['80'])
  const kept = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(note()).toBe('// not a comment'); expect(total()).toBe(80) })") })
  assert.equal(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, kept).status, 'pass', 'a // inside a string is not a comment')
})

test('run: a field the ticket names must be read in a Vitest assertion; a negated one is not asked for', () => {
  const t = JSON.stringify(ticket('## Acceptance criteria\nGiven a stock row\nWhen the KPI is computed\nThen the KPI reads unit_cost, not unit_price, and shows 80'))
  const wrong = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(row.unitPrice).toBe(80) })") })
  const r = run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, wrong)
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.data.missing, ['unit_cost'])
  assert.equal(r.findings[0].kind, 'field not asserted')
  const right = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(row.unitCost).toBe(80) })") })
  assert.equal(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, right).status, 'pass', 'unit_cost and unitCost are the same field')
  // An e2e spec asserts what the screen shows, so the field name is not asked for there.
  const e2e = proj({ 't.json': t, 'e2e/a.spec.ts': "test.describe('ABC-7 Pricing', () => {\n  test('a', async ({ page }) => { await expect(page.getByRole('cell')).toHaveText('80') })\n})\n" })
  assert.equal(run({ specs: ['e2e/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, { ...e2e, dialect: dialectFor('playwright') }).status, 'pass')
})

test('run: a bug test that asserts the reported wrong result says so', () => {
  const t = JSON.stringify(ticket('## Steps to reproduce\n1. Open the KPI\n## Expected result\nThe value is 80\n## Actual result\nThe value is 150'))
  const ctx = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(kpi()).toBe(150) })") })
  const r = run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, ctx)
  assert.equal(r.status, 'fail')
  assert.equal(r.summary, 'asserts 150, the wrong result the ticket reports, not the expected value')
  assert.deepEqual([r.findings[0].kind, r.findings[0].token, r.findings[0].actual], ['asserts the actual result', '80', '150'])
  const inline = JSON.stringify(ticket('## Acceptance criteria\nGiven the KPI\nWhen I open it\nThen it shows 80\n\nToday it shows 150 instead of 80.'))
  const r2 = run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, { ...ctx, root: proj({ 't.json': inline, 'test/a.spec.ts': spec("  it('a', () => { expect(kpi()).toBe(150) })") }).root })
  assert.equal(r2.findings[0].kind, 'asserts the actual result')
})

test('run: the values the model pins count only when the ticket\'s expected text holds them', () => {
  const t = JSON.stringify(ticket('## Acceptance criteria\nGiven no movements\nWhen I filter by an unknown customer\nThen the grid shows Nessun movimento trovato'))
  const without = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(grid()).toBeTruthy() })") })
  const r = run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json', candidates: ['Nessun movimento trovato', 'invented text', '99'] }, without)
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.data.missing, ['Nessun movimento trovato'])
  assert.deepEqual(r.data.ignored, ['invented text', '99'])
  const pinned = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(grid()).toBe('Nessun movimento trovato') })") })
  assert.equal(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json', candidates: ['Nessun movimento trovato'] }, pinned).status, 'pass')
})

test('run: toBeCloseTo, comparisons and toHaveLength pin values too (FIC-13436 asserts toBeCloseTo(58.86, 2))', () => {
  const t = JSON.stringify(ticket('## Acceptance criteria\nGiven the movements\nWhen the history is rebuilt\nThen the reconstructed stock ends at 58.86 and there are 3 rows'))
  const ctx = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(stock()).toBeCloseTo(58.86, 2); expect(rows()).toHaveLength(3) })") })
  assert.equal(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, ctx).status, 'pass')
  const neg = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(stock()).not.toBeCloseTo(58.86, 2); expect(rows()).toHaveLength(3) })") })
  assert.deepEqual(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, neg).data.missing, ['58.86'])
})

test('run: a ticket value that is only an input inside expect(...) is not asserted (Vitest); an argument-less matcher reads expect(...)', () => {
  const t = JSON.stringify(ticket('## Acceptance criteria\nGiven an order\nWhen I check out\nThen the order total is 80'))
  const input = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(orderTotal([{ price: 80, qty: 1 }])).toBeGreaterThan(0) })") })
  assert.equal(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, input).status, 'fail')
  const shown = proj({ 't.json': t, 'test/a.spec.ts': spec("  it('a', () => { expect(screen.getByText('Total 80')).toBeInTheDocument() })") })
  assert.equal(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, shown).status, 'pass')
  const field = JSON.stringify(ticket('## Acceptance criteria\nGiven a row\nWhen saved\nThen unit_cost is 5'))
  const read = proj({ 't.json': field, 'test/a.spec.ts': spec("  it('a', () => { expect(row.unit_cost).toBe(5) })") })
  assert.equal(run({ specs: ['test/a.spec.ts'], key: 'ABC-7', ticket: 't.json' }, read).status, 'pass', 'a field is still read inside expect(...)')
})
