// No customer id enters the plugin repo (spec §9.3, Ruling R11): no file under test/ may contain a
// U followed by five or more digits, and the parity data carries no e-mail but the placeholder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('./', import.meta.url).pathname
const CUSTOMER_ID = /U\d{5,}/
const MAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const PLACEHOLDER = 'user@example.test'

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
const files = walk(ROOT)

test('the walk sees the parity fixtures', () => {
  assert.ok(files.some(f => relative(ROOT, f).startsWith('parity/fixtures/')))
})

test('no file under test/ contains a customer id', () => {
  const hits = files.filter(f => CUSTOMER_ID.test(readFileSync(f, 'utf8'))).map(f => relative(ROOT, f))
  assert.deepEqual(hits, [])
})

test('parity data carries no e-mail except the placeholder', () => {
  const hits = files
    .filter(f => relative(ROOT, f).startsWith('parity/'))
    .flatMap(f => (readFileSync(f, 'utf8').match(MAIL) || []).filter(m => m !== PLACEHOLDER).map(m => `${relative(ROOT, f)}: ${m}`))
  assert.deepEqual(hits, [])
})
