import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { EXIT, result } from '../../core/checks/result.mjs'
import { keySource, isProjectKey, projectKeys } from '../../core/checks/keys.mjs'
import { specDiff, changedPaths } from '../../core/checks/git.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'

import { ENV } from './git-env.mjs'

const cfg = { jira: { projects: ['ABC'], trackingProjects: ['T.K'] } }
const g = (d, ...a) => execFileSync('git', a, { cwd: d, env: ENV, encoding: 'utf8' })
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }

test('result shape and exit codes', () => {
  assert.deepEqual(result('honesty', 'pass', 'ok'), { check: 'honesty', status: 'pass', summary: 'ok', findings: [], data: {} })
  assert.deepEqual(EXIT, { pass: 0, fail: 1, not_run: 3 })
})
test('keys come from projects and tracking projects, regex-escaped', () => {
  assert.deepEqual(projectKeys(cfg), ['ABC', 'T.K'])
  assert.equal(keySource(cfg), '(?:ABC|T\\.K)-\\d+')
  assert.equal(isProjectKey(cfg, 'ABC-12'), true)
  assert.equal(isProjectKey(cfg, 'TXK-1'), false)
  assert.equal(isProjectKey(cfg, 'ABC-12 '), false)
})
test('git: spec diff against HEAD and changed paths with spaces and untracked files', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-git-'))
  g(d, 'init', '-q', '-b', 'main')
  put(d, 'test/a.spec.ts', "it('a', () => { expect(1).toBe(1) })\n")
  g(d, 'add', '-A'); g(d, 'commit', '-qm', 'init')
  put(d, 'test/a.spec.ts', "it('a', () => {})\n")
  put(d, 'src/my file.ts', 'x\n')
  const sd = specDiff(d, ['test/a.spec.ts'])
  assert.equal(sd.ok, true)
  assert.match(sd.diff, /^-it\('a', \(\) => \{ expect/m)
  assert.deepEqual(changedPaths(d).paths.sort(), ['src/my file.ts', 'test/a.spec.ts'])
  assert.equal(specDiff(d, ['x'], 'nope...HEAD').ok, false)
  assert.equal(changedPaths(mkdtempSync(join(tmpdir(), 'qc-nogit-'))).ok, false)
})
test('dialects', () => {
  const v = dialectFor('vitest')
  const p = dialectFor('playwright')
  assert.equal(v.name, 'vitest')
  assert.equal(p.name, 'playwright')
  assert.equal(v.suite.notYet, 'todo')
  assert.equal(p.suite.notYet, 'fixme')
  assert.equal(v.honesty.removedDecl.test("describe('x', () => {"), true)
  assert.equal(p.honesty.removedDecl.test("describe('x', () => {"), false)
  assert.equal(p.suite.isCapture('ABC-1 — design-conformance capture'), true)
  assert.equal(v.suite.isCapture('ABC-1 — design-conformance capture'), false)
  assert.throws(() => dialectFor('jest'), /no dialect/)
})
test('git: a range starting with "-" is refused inside the helpers (§9 #21)', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-rng-'))
  g(d, 'init', '-q', '-b', 'main')
  put(d, 'a.txt', 'a\n'); g(d, 'add', '-A'); g(d, 'commit', '-qm', 'init')
  assert.deepEqual(specDiff(d, ['a.txt'], '--output=x'), { ok: false, error: 'range must not start with "-"' })
  assert.deepEqual(changedPaths(d, '--output=x'), { ok: false, error: 'range must not start with "-"' })
  assert.equal(existsSync(join(d, 'x')), false)
})
