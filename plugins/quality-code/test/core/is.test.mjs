// lib/core/is.mjs: the value checks every folder shares.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDate, isObject, isWholeNumber } from '../../lib/core/is.mjs'

test('isObject: a plain { … } only; null, a list and a string are not', () => {
  for (const v of [{}, { a: 1 }, Object.create(null)]) assert.ok(isObject(v))
  for (const v of [null, undefined, [], 'x', 1, true]) assert.ok(!isObject(v), String(v))
})

test('isDate: a real day written YYYY-MM-DD; 2026-02-31 and 2026-2-1 are not', () => {
  for (const v of ['2026-11-16', '2024-02-29']) assert.ok(isDate(v), v)
  for (const v of ['2026-02-31', '2025-02-29', '2026-13-01', '2026-2-1', ' 2026-11-16', '2026-11-16T00:00', 20261116, null]) assert.ok(!isDate(v), String(v))
})

test('isWholeNumber: digits only, written plainly, at least min', () => {
  for (const v of ['0', '7', '120', 3]) assert.ok(isWholeNumber(v), String(v))
  for (const v of ['', '-1', '1.5', ' 3', '3 ', '1e3', '01', null, undefined]) assert.ok(!isWholeNumber(v), String(v))
  assert.ok(!isWholeNumber('0', { min: 1 }))
  assert.ok(isWholeNumber('1', { min: 1 }))
})

test('no script or library file checks a plain object, a date or a whole number by hand', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const walk = p => readdirSync(join(root, p), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.mjs') ? [join(p, e.name)] : []))
  const HAND = [/typeof [\w.?]+ [!=]== 'object' (?:&&|\|\|) !?Array\.isArray/, /\(?\\d\{4\}\)?-\(?\\d\{2\}\)?-\(?\\d\{2\}\)?\$\//, /\/\^\[1-9\]\\d\*\$\//]
  const own = [...walk('bin'), ...walk('lib')].filter(f => !f.startsWith(join('lib', 'core')) && HAND.some(h => h.test(readFileSync(join(root, f), 'utf8'))))
  assert.deepEqual(own, [])
})
