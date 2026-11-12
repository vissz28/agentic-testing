// lib/core/text.mjs: the small text helpers every folder shares.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { escapeRegExp, firstLine, noColour } from '../../lib/core/text.mjs'

test('noColour: the colour codes of a terminal are removed, the text is kept', () => {
  assert.equal(noColour('\x1b[31mError:\x1b[0m boom \x1b[2m(x.ts:3)\x1b[22m'), 'Error: boom (x.ts:3)')
  assert.equal(noColour('plain [31m text'), 'plain [31m text')
  assert.equal(noColour(null), '')
  assert.equal(noColour(42), '42')
})

test('firstLine: the first line that says something, trimmed, without colour codes', () => {
  assert.equal(firstLine('\n   \n  Cannot find module x  \nat load (a.js:1)\n'), 'Cannot find module x')
  assert.equal(firstLine('\x1b[31m\x1b[0m\n\x1b[31m  Timeout 5000ms exceeded\x1b[39m\nmore'), 'Timeout 5000ms exceeded')
  assert.equal(firstLine('one line'), 'one line')
  assert.equal(firstLine('a\r\nb'), 'a')
  for (const nothing of ['', '  \n\t\n', null, undefined]) assert.equal(firstLine(nothing), '')
})

test('escapeRegExp: text with pattern characters matches only itself', () => {
  for (const text of ['adds 1.5 (rounded)', 'a+b*c?', '[FE] price ^ $ {x} | y', 'back\\slash', 'plain']) {
    assert.ok(new RegExp('^' + escapeRegExp(text) + '$').test(text), text)
  }
  assert.ok(!new RegExp('^' + escapeRegExp('1.5') + '$').test('1x5'))
  assert.equal(escapeRegExp('plain'), 'plain')
  assert.equal(escapeRegExp(42), '42')
})

test('firstLine and escapeRegExp are written once: no script or library file has its own', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const walk = d => readdirSync(join(root, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.mjs') ? [join(d, e.name)] : []))
  // The character class every hand-written copy of the escape used.
  const ESCAPE_CLASS = '[.*+?^${}()|[' + '\\]' + '\\\\' + ']'
  const own = [...walk('bin'), ...walk('lib')].filter(f => f !== join('lib', 'core', 'text.mjs')).filter(f => {
    const src = readFileSync(join(root, f), 'utf8')
    return /^(?:const|function) firstLine\b/m.test(src) || src.includes(ESCAPE_CLASS)
  })
  assert.deepEqual(own, [])
})
