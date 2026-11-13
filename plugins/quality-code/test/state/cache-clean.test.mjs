import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteCache, listCache } from '../../lib/state/cache-clean.mjs'
import { dirOf, fileOf, setProgress } from '../../lib/state/progress.mjs'
import { setFact } from '../../lib/state/context.mjs'
import { main } from '../../bin/clean-cache.mjs'

function setup() {
  const claude = mkdtempSync(join(tmpdir(), 'qc-cc-'))
  const env = { CLAUDE_CONFIG_DIR: claude }
  const a = mkdtempSync(join(tmpdir(), 'qc-proj-a-'))
  const b = mkdtempSync(join(tmpdir(), 'qc-proj-b-'))
  for (const r of [a, b]) {
    setProgress(r, 'setup', { step: 1, label: 'x', data: { site: 's' } }, env)
    setProgress(r, 'session', { step: 0, label: 'language', data: { language: 'it' } }, env)
  }
  setFact(a, 'flow', { v: 1 }, { kind: 'none' }, env)
  const config = join(claude, 'quality-code.json')
  writeFileSync(config, '{}')
  return { claude, env, a, b, config }
}

test('list is a dry run: project scope counts only this project', () => {
  const { env, a } = setup()
  const l = listCache(a, { env })
  assert.equal(l.projects.length, 1)
  assert.equal(l.files, 3)
  assert.ok(l.bytes > 0)
  assert.ok(existsSync(fileOf(a, 'setup', null, env)))
})
test('--all lists every project folder', () => {
  const { env, a } = setup()
  const l = listCache(a, { all: true, env })
  assert.equal(l.projects.length, 2)
  assert.equal(l.files, 5)
})
test('delete removes only this project; the other project and the config stay', () => {
  const { env, a, b, config } = setup()
  const r = deleteCache(a, { env })
  assert.equal(r.deleted, 3)
  assert.ok(!existsSync(fileOf(a, 'setup', null, env)))
  assert.ok(existsSync(fileOf(b, 'setup', null, env)))
  assert.equal(readFileSync(config, 'utf8'), '{}')
})
test('delete --all removes every project but never tickets or the config', () => {
  const { env, a, claude, config } = setup()
  mkdirSync(join(claude, 'quality-code', 'tickets'), { recursive: true })
  writeFileSync(join(claude, 'quality-code', 'tickets', 'T-1.md'), 'ticket')
  const r = deleteCache(a, { all: true, env })
  assert.equal(r.deleted, 5)
  assert.equal(listCache(a, { all: true, env }).files, 0)
  assert.ok(existsSync(join(claude, 'quality-code', 'tickets', 'T-1.md')))
  assert.ok(existsSync(config))
})
test('a symlink out of the cache is skipped, never followed or removed', () => {
  const { env, a } = setup()
  const outside = mkdtempSync(join(tmpdir(), 'qc-out-'))
  writeFileSync(join(outside, 'keep.txt'), 'keep')
  const dir = join(dirOf(env), listCache(a, { env }).projects[0].name)
  symlinkSync(outside, join(dir, 'link-dir'))
  symlinkSync(join(outside, 'keep.txt'), join(dir, 'link-file.json'))
  const r = deleteCache(a, { env })
  assert.equal(r.deleted, 3)
  assert.equal(r.skipped, 2)
  assert.ok(existsSync(join(outside, 'keep.txt')))
})
test('a linked cache folder is refused entirely', () => {
  const claude = mkdtempSync(join(tmpdir(), 'qc-cc-'))
  const outside = mkdtempSync(join(tmpdir(), 'qc-out-'))
  mkdirSync(join(outside, 'p-12345678'))
  writeFileSync(join(outside, 'p-12345678', 'a.json'), '{}')
  mkdirSync(join(claude, 'quality-code'))
  symlinkSync(outside, join(claude, 'quality-code', 'progress'))
  const env = { CLAUDE_CONFIG_DIR: claude }
  assert.equal(listCache('/x', { all: true, env }).files, 0)
  assert.equal(deleteCache('/x', { all: true, env }).deleted, 0)
  assert.ok(existsSync(join(outside, 'p-12345678', 'a.json')))
})
test('an empty or missing cache is fine', () => {
  const env = { CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-cc-')) }
  assert.equal(listCache('/x', { env }).files, 0)
  assert.equal(deleteCache('/x', { all: true, env }).deleted, 0)
})
test('cli: list, delete, usage; no internal fields leak', async () => {
  const { env, a } = setup()
  let out = ''
  const run = argv => main(argv, { env, cwd: a, stdout: s => { out += s }, stderr: s => { out += s } })
  assert.equal(await run(['list']), 0)
  assert.match(out, /3 files/)
  assert.ok(!out.includes('_paths'))
  out = ''
  assert.equal(await run(['delete']), 0)
  assert.match(out, /Deleted 3 cache files/)
  assert.equal(await run(['delete', 'extra']), 2)
  assert.equal(await run(['nope']), 2)
})
