// lib/core/git.mjs: the one place the plugin runs git.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { git, gitOut } from '../../lib/core/git.mjs'
import { rankRoots } from '../../bin/setup.mjs'
import { ENV as GIT_ENV } from '../git-env.mjs'

const repo = files => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'qc-git-')))
  const run = args => execFileSync('git', args, { cwd: d, env: GIT_ENV, stdio: 'ignore' })
  run(['init', '-q'])
  for (const [p, s] of Object.entries(files)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), s) }
  run(['add', '-A'])
  run(['commit', '-qm', 'init'])
  return d
}

test('gitOut: the closing newline goes, the leading space of a status line stays; null when git fails', () => {
  const d = repo({ 'a.txt': '1' })
  writeFileSync(join(d, 'a.txt'), '2')
  assert.equal(gitOut(d, ['status', '--porcelain']), ' M a.txt')
  assert.equal(gitOut(d, ['rev-parse', '--verify', '--quiet', 'nope']), null)
})

test('git: okCodes count as success; a failure keeps what git printed and its first complaint', () => {
  const d = repo({ 'a.txt': '1' })
  assert.equal(git(d, ['diff', '--no-index', '--quiet', 'a.txt', 'a.txt']).ok, true)
  writeFileSync(join(d, 'b.txt'), '2')
  assert.equal(git(d, ['diff', '--no-index', '--quiet', 'a.txt', 'b.txt']).ok, false)
  assert.equal(git(d, ['diff', '--no-index', '--quiet', 'a.txt', 'b.txt'], { okCodes: [1] }).ok, true)
  const bad = git(d, ['rev-parse', 'nope'])
  assert.equal(bad.ok, false)
  assert.match(bad.error, /nope/)
  assert.equal(git(d, ['hash-object', '--stdin'], { input: '' }).out.trim(), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
})

test('rankRoots: an unstaged change in the first status line counts for its folder', () => {
  const d = repo({ 'api/x.test.js': '1', 'web/y.test.js': '1' })
  writeFileSync(join(d, 'api/x.test.js'), '2')
  const r = rankRoots(d, ['web', 'api'])
  assert.equal(r.evidence.api.changed, 1)
  assert.deepEqual([r.ordered[0], r.decisive], ['api', true])
})

test('no script or library file runs git by hand', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const walk = p => readdirSync(join(root, p), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.mjs') ? [join(p, e.name)] : []))
  const HAND = /\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec)\(\s*['"`]git\b/
  const own = [...walk('bin'), ...walk('lib')].filter(f => f !== join('lib', 'core', 'git.mjs') && HAND.test(readFileSync(join(root, f), 'utf8')))
  assert.deepEqual(own, [])
})
