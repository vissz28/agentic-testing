// lib/core/files.mjs: reading small files, where a missing file and a broken one are not the same thing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, readJsonOr, tryReadJson } from '../../lib/core/files.mjs'

test('readJsonOr: the content; the fallback for a missing file; a broken one throws, naming the file', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-files-'))
  try {
    writeFileSync(join(d, 'ok.json'), '{"a":1}')
    writeFileSync(join(d, 'bad.json'), '{"a":')
    mkdirSync(join(d, 'folder.json'))
    assert.deepEqual(readJsonOr(join(d, 'ok.json'), null), { a: 1 })
    assert.equal(readJsonOr(join(d, 'gone.json'), null), null)
    assert.deepEqual(readJsonOr(join(d, 'gone.json'), {}), {})
    assert.throws(() => readJsonOr(join(d, 'bad.json'), null), e => e.message.startsWith(`${join(d, 'bad.json')} is not valid JSON (`) && e.cause instanceof SyntaxError)
    assert.throws(() => readJsonOr(join(d, 'folder.json'), null), /folder\.json cannot be read \(EISDIR\)/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('tryReadJson: the content; the fallback for a missing, unreadable or broken file', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-files-'))
  try {
    writeFileSync(join(d, 'ok.json'), '{"a":1}')
    writeFileSync(join(d, 'null.json'), 'null')
    writeFileSync(join(d, 'bad.json'), 'not json')
    mkdirSync(join(d, 'folder.json'))
    assert.deepEqual(tryReadJson(join(d, 'ok.json'), null), { a: 1 })
    assert.equal(tryReadJson(join(d, 'null.json'), {}), null)
    assert.equal(tryReadJson(join(d, 'gone.json'), null), null)
    assert.equal(tryReadJson(join(d, 'bad.json'), null), null)
    assert.deepEqual(tryReadJson(join(d, 'folder.json'), []), [])
    assert.equal(tryReadJson(null, 'none'), 'none')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('readJson: the content; a missing or broken file throws what Node and JSON.parse throw', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-files-'))
  try {
    writeFileSync(join(d, 'ok.json'), '[1,"two"]')
    writeFileSync(join(d, 'bad.json'), '{"a":')
    assert.deepEqual(readJson(join(d, 'ok.json')), [1, 'two'])
    assert.deepEqual(readJson(new URL(`file://${join(d, 'ok.json')}`)), [1, 'two'])
    assert.throws(() => readJson(join(d, 'gone.json')), e => e.code === 'ENOENT')
    assert.throws(() => readJson(join(d, 'bad.json')), SyntaxError)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('no script or library file keeps its own readJson helper', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const walk = p => readdirSync(join(root, p), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.mjs') ? [join(p, e.name)] : []))
  const own = [...walk('bin'), ...walk('lib')].filter(f => /^const readJson = \w+ => \{ try \{ return JSON\.parse\(readFileSync/m.test(readFileSync(join(root, f), 'utf8')))
  assert.deepEqual(own, [])
})
