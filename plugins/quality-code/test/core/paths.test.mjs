// lib/core/paths.mjs: the small path helpers every folder shares.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanRelPath, isAbsoluteAnywhere, leavesFolder, noTrailingSlash, stripDotSlash } from '../../lib/core/paths.mjs'

test('stripDotSlash: forward slashes, every "./" in front goes; the end is kept', () => {
  assert.equal(stripDotSlash('./a/b'), 'a/b')
  assert.equal(stripDotSlash('././a/'), 'a/')
  assert.equal(stripDotSlash('.\\a\\b'), 'a/b')
  assert.equal(stripDotSlash('../a'), '../a')
  assert.equal(stripDotSlash('.hidden/x'), '.hidden/x')
})

test('noTrailingSlash: every "/" at the end goes, for a path or a URL', () => {
  assert.equal(noTrailingSlash('a/b//'), 'a/b')
  assert.equal(noTrailingSlash('https://x.atlassian.net/'), 'https://x.atlassian.net')
  assert.equal(noTrailingSlash('a'), 'a')
  assert.equal(noTrailingSlash('/'), '')
})

test('cleanRelPath: one way to write a folder: "./tickets/" and "tickets" are the same', () => {
  assert.equal(cleanRelPath('./tickets/'), 'tickets')
  assert.equal(cleanRelPath('.\\web\\app\\'), 'web/app')
  assert.equal(cleanRelPath('tickets'), 'tickets')
  assert.equal(cleanRelPath('C:\\Users\\me\\tickets'), 'C:/Users/me/tickets')
})

test('isAbsoluteAnywhere: "/x", "\\x" and a drive are absolute on some machine', () => {
  for (const p of ['/x', '\\x', 'C:\\x', 'c:/x', 'D:']) assert.ok(isAbsoluteAnywhere(p), p)
  for (const p of ['x', './x', '../x', 'a.b:c']) assert.ok(!isAbsoluteAnywhere(p), p)
})

test('leavesFolder: "..", "../x", "..\\x" and an absolute path leave; "..x" and "x/.." stay', () => {
  for (const p of ['..', '../x', '..\\x', '/x', 'D:\\x']) assert.ok(leavesFolder(p), p)
  for (const p of ['', 'x', '..x', '...', 'x/../y']) assert.ok(!leavesFolder(p), p)
})

test('no script or library file strips "./" or checks for leaving a folder by hand', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const walk = p => readdirSync(join(root, p), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.mjs') ? [join(p, e.name)] : []))
  const HAND = [".replace(/^(?:\\.\\/)+/, '')", ".replace(/^\\.\\//, '')", "/^[A-Za-z]:/", "startsWith('../')", "startsWith('..')", "=== '..'"]
  const own = [...walk('bin'), ...walk('lib')].filter(f => !f.startsWith(join('lib', 'core')) && HAND.some(h => readFileSync(join(root, f), 'utf8').includes(h)))
  assert.deepEqual(own, [])
})
