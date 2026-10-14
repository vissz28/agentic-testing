import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AS_OF, PRICES, SOURCE, baseModel, costOf, loadPrices, priceFor } from '../../core/consumption/prices.mjs'

const t = (input, output, cacheWrite5m = 0, cacheWrite1h = 0, cacheRead = 0) => ({ input, output, cacheWrite5m, cacheWrite1h, cacheRead })
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`)

test('prices carry their date and source', () => {
  assert.match(AS_OF, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(SOURCE, /claude-api skill/)
})
test('every price has the five rates; cache writes are 1.25x and 2x input', () => {
  for (const [id, p] of Object.entries(PRICES)) {
    for (const f of ['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead']) assert.equal(typeof p[f], 'number', `${id}.${f}`)
    close(p.cacheWrite5m, p.input * 1.25)
    close(p.cacheWrite1h, p.input * 2)
  }
})
test('cost of one response, per rate', () => {
  // claude-opus-5-5: $4 in, $20 out, $5 write 5m, $8 write 1h, $0.20 read
  close(costOf(t(1000, 1000, 1000, 1000, 10000), priceFor('claude-opus-5-5')), 0.039)
  close(costOf(t(1e6, 0), priceFor('claude-sonnet-5-5')), 2)
})
test('long prompts bill at the long rate where a model has one', () => {
  const p = priceFor('claude-haiku-5-5')
  close(costOf(t(1e5, 1e6), p), 0.01 + 0.5)
  close(costOf(t(1e5 + 1, 0), p), (1e5 + 1) * 0.5 / 1e6)
})
test('snapshot dates and [1m] suffixes resolve to the base model; unknown models get no price', () => {
  assert.equal(baseModel('claude-haiku-4-5-20251001'), 'claude-haiku-4-5')
  assert.equal(priceFor('claude-opus-5-5[1m]'), PRICES['claude-opus-5-5'])
  assert.equal(priceFor('claude-unknown-9'), null)
  assert.equal(costOf(t(1, 1), null), null)
})
test('an override file adds and replaces models', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-prices-'))
  const f = join(d, 'p.json')
  writeFileSync(f, JSON.stringify({ asOf: '2026-11-01', source: 'team sheet', models: { 'claude-unknown-9': { input: 1, output: 2, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 } } }))
  const p = loadPrices(f)
  assert.equal(p.asOf, '2026-11-01')
  assert.equal(p.source, 'team sheet')
  assert.deepEqual(p.models, ['claude-unknown-9'])
  close(costOf(t(1e6, 1e6), priceFor('claude-unknown-9', p.prices)), 3)
  assert.equal(p.prices['claude-opus-5-5'], PRICES['claude-opus-5-5'])
})
test('a bad override file is refused with a plain message', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-prices-'))
  const put = (name, body) => { writeFileSync(join(d, name), body); return join(d, name) }
  assert.throws(() => loadPrices(join(d, 'none.json')), /file not found/)
  assert.throws(() => loadPrices(put('a.json', '{')), /not valid JSON/)
  assert.throws(() => loadPrices(put('b.json', '{"models":{}}')), /needs "models"/)
  assert.throws(() => loadPrices(put('c.json', '{"models":{"m":{"input":1}}}')), /models\["m"\]\.output must be a number/)
  assert.throws(() => loadPrices(put('e.json', '{"models":{"m":{"input":-1,"output":1,"cacheWrite5m":1,"cacheWrite1h":1,"cacheRead":1}}}')), /input must be a number/)
})
