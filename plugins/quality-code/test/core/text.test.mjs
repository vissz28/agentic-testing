// lib/core/text.mjs: the small text helpers every folder shares.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { escapeRegExp, firstLine, hasLineBreak, isLine, isTicketKey, localToForwardSlashes, noColour, toForwardSlashes, plural, withoutOrigin, collapseSpaces } from '../../lib/core/text.mjs'

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

test('isTicketKey: a project key, a dash and a number, as a string and nothing else', () => {
  for (const key of ['ABC-1', 'A-1', 'AB2_C-123', 'DEMO-000']) assert.equal(isTicketKey(key), true, key)
  for (const not of ['abc-1', 'ABC', 'ABC-', '-1', '1AB-2', 'ABC-1 ', ' ABC-1', 'ABC-1.json', 'ABC-1/..', '../ABC-1', 'ABC-1\nDEF-2', '']) assert.equal(isTicketKey(not), false, JSON.stringify(not))
  // Only a string: a list or an object that prints as a key is not one, so it never reaches a path.
  for (const not of [['ABC-1'], { toString: () => 'ABC-1' }, 1, null, undefined]) assert.equal(isTicketKey(not), false)
})

test('toForwardSlashes: a path someone else wrote; every backslash is turned, on any machine', () => {
  assert.equal(toForwardSlashes('src\\orders\\a.spec.ts'), 'src/orders/a.spec.ts')
  assert.equal(toForwardSlashes('C:\\work\\app/test\\a.ts'), 'C:/work/app/test/a.ts')
  assert.equal(toForwardSlashes('./already/fine/'), './already/fine/')
  assert.equal(toForwardSlashes(''), '')
})

test('localToForwardSlashes: a path this machine built; only its own separator is turned', () => {
  assert.equal(localToForwardSlashes(join('src', 'orders', 'a.spec.ts')), 'src/orders/a.spec.ts')
  assert.equal(localToForwardSlashes('already/fine'), 'already/fine')
  // Where the separator is "/", a backslash is part of a file name and stays; on Windows it is the separator.
  assert.equal(localToForwardSlashes('odd\\name.spec.ts'), sep === '/' ? 'odd\\name.spec.ts' : 'odd/name.spec.ts')
  assert.equal(toForwardSlashes('odd\\name.spec.ts'), 'odd/name.spec.ts')
})

test('the helpers are written once: no script or library file has its own copy', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const walk = d => readdirSync(join(root, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.mjs') ? [join(d, e.name)] : []))
  // The character class every hand-written copy of the escape used.
  const ESCAPE_CLASS = '[.*+?^${}()|[' + '\\]' + '\\\\' + ']'
  // The shapes each helper replaced. The Node test reporter keeps its own slash line: it is loaded into the
  // project's test process, so it imports nothing of the plugin.
  const COPIES = [ESCAPE_CLASS, '/^[A-Z][A-Z0-9_]*-\\d+$/', ".replace(/\\\\/g, '/')", ".split('\\\\').join('/')", ".split(sep).join('/')"]
  const ALLOWED = new Set([join('lib', 'core', 'text.mjs'), join('lib', 'pipeline', 'runners', 'node-test-reporter.mjs')])
  const own = [...walk('bin'), ...walk('lib')].filter(f => !ALLOWED.has(f)).filter(f => {
    const src = readFileSync(join(root, f), 'utf8')
    return /^(?:const|function) firstLine\b/m.test(src) || COPIES.some(c => src.includes(c))
  })
  assert.deepEqual(own, [])
})

test('plural: the count and its noun, "s" for any count but 1, or the given plural', () => {
  assert.equal(plural(1, 'file'), '1 file')
  assert.equal(plural(0, 'file'), '0 files')
  assert.equal(plural(2, 'spec file'), '2 spec files')
  assert.equal(plural(1, 'entry', 'entries'), '1 entry')
  assert.equal(plural(3, 'entry', 'entries'), '3 entries')
  assert.equal(plural('1', 'file'), '1 files', 'only the number 1 is singular, as every copy it replaces compared with === 1')
})

test('isLine: a string on one line, not empty or only spaces; hasLineBreak: a \\n or \\r in it', () => {
  for (const ok of ['make test', ' x ', 'a\tb', 'é']) assert.equal(isLine(ok), true, ok)
  for (const bad of ['', '   ', 'a\nb', 'a\rb', 'a\r\n', undefined, null, 3, ['a'], {}]) assert.equal(isLine(bad), false, String(bad))
  assert.equal(hasLineBreak('a\nb'), true)
  assert.equal(hasLineBreak('x\r'), true)
  assert.equal(hasLineBreak(''), false)
  assert.equal(hasLineBreak('   '), false)
})

test('withoutOrigin: origin/ goes from the front only; any other name stays', () => {
  assert.equal(withoutOrigin('origin/develop'), 'develop')
  assert.equal(withoutOrigin('origin/feature/origin/x'), 'feature/origin/x')
  assert.equal(withoutOrigin('main'), 'main')
  assert.equal(withoutOrigin('upstream/main'), 'upstream/main')
  assert.equal(withoutOrigin(''), '')
})

test('no script or library file checks for a line break or strips origin/ by hand', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const walk = p => readdirSync(join(root, p), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.mjs') ? [join(p, e.name)] : []))
  const own = [...walk('bin'), ...walk('lib')].filter(f => f !== join('lib', 'core', 'text.mjs') && /\/\[\\r\\n\]\/\.test\(|\.replace\(\/\^origin\\\//.test(readFileSync(join(root, f), 'utf8')))
  assert.deepEqual(own, [])
})

test('collapseSpaces: each run of spaces, tabs and line breaks is one space; the ends are kept', () => {
  assert.equal(collapseSpaces('expect(a)\n    .toBe(\t1)'), 'expect(a) .toBe( 1)')
  assert.equal(collapseSpaces('  a  b  '), ' a b ')
  assert.equal(collapseSpaces('a\r\n\r\nb'), 'a b')
  assert.equal(collapseSpaces('one'), 'one')
  assert.equal(collapseSpaces(''), '')
})

test('no script or library file collapses spaces by hand', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const walk = p => readdirSync(join(root, p), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.mjs') ? [join(p, e.name)] : []))
  const own = [...walk('bin'), ...walk('lib')].filter(f => f !== join('lib', 'core', 'text.mjs') && readFileSync(join(root, f), 'utf8').includes(".replace(/\\s+/g, ' ')"))
  assert.deepEqual(own, [])
})
