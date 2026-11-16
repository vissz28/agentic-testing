// lib/core/shell.mjs: a project's own command line, filled in and quoted the same way by every runner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fillPlaceholders, shellQuote } from '../../lib/core/shell.mjs'

test('shellQuote: one word for sh, quotes and all; cmd.exe doubles a quote', () => {
  assert.equal(shellQuote("it's a b", false), `'it'\\''s a b'`)
  assert.equal(shellQuote(42, false), `'42'`)
  assert.equal(shellQuote('a "b" c', true), '"a ""b"" c"')
  if (process.platform !== 'win32') {
    const word = 'a b|c;$HOME `x` \'q\' "d" *'
    assert.equal(execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(word)}`], { encoding: 'utf8' }), word)
  }
})

test('fillPlaceholders: every slot in one pass; a value is never read again; an unknown slot stays', () => {
  assert.equal(fillPlaceholders('make PKGS={files} RUN={test} OUT={report} {files}', { files: 'a b', test: 't', report: 'r' }), 'make PKGS=a b RUN=t OUT=r a b')
  assert.equal(fillPlaceholders('run {files}', { files: '{report}', report: 'no' }), 'run {report}')
  assert.equal(fillPlaceholders('run {test}', { test: "'$&' $1 $$" }), "run '$&' $1 $$")
  assert.equal(fillPlaceholders('echo ${HOME} {other} {}', { files: 'x' }), 'echo ${HOME} {other} {}')
  assert.equal(fillPlaceholders('psql -f {file}', { file: '' }), 'psql -f ')
})

test('no script or runner keeps its own shell quote or fills a slot by hand', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const walk = p => readdirSync(join(root, p), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.mjs') ? [join(p, e.name)] : []))
  const own = [...walk('bin'), ...walk('lib')].filter(f => /replace(?:All)?\(\s*(?:'\{|\/\\\{)(?:files|test|report|file)\\?\}|const (?:quote|cmdQuote) = s => \(?(?:process\.platform|WIN|\/\^\[)/.test(readFileSync(join(root, f), 'utf8')))
  assert.deepEqual(own, [])
})
