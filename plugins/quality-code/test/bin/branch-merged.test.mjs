// branch.mjs --merged: what a ticket changed once its branch is merged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { merged } from '../../bin/branch.mjs'
import { ENV } from '../git-env.mjs'

const config = { adapter: 'playwright', jira: { projects: ['ABC'] } }
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'qc-merged-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV, encoding: 'utf8' })
  const put = (p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
  g('init', '-q', '-b', 'main'); put('README.md', 'x'); g('add', '-A'); g('commit', '-qm', 'init')
  g('checkout', '-qb', 'ABC-12-order-total')
  put('src/pricing.ts', 'export const total = 1\n'); put('src/i18n/en.json', '{}'); put('e2e/orders.abc-12.spec.ts', '//')
  g('add', '-A'); g('commit', '-qm', 'total on the order page')
  g('checkout', '-q', 'main')
  g('merge', '--no-ff', '-q', '-m', "Merge branch 'ABC-12-order-total' into 'main'", 'ABC-12-order-total')
  // A sync of main into another ticket's branch is not that ticket's change.
  g('checkout', '-qb', 'ABC-13-x'); put('src/other.ts', '1'); g('add', '-A'); g('commit', '-qm', 'ABC-13 other screen')
  g('merge', '--no-ff', '-q', '-m', "Merge branch 'main' into 'ABC-13-x'", 'main')
  g('checkout', '-q', 'main')
  return d
}

test('a merged ticket: its merge commit\'s diff, i18n files counted as code', () => {
  const r = merged(repo(), config, 'ABC-12')
  assert.equal(r.found, 'merge')
  assert.match(r.commit, /^[0-9a-f]{7}$/)
  assert.deepEqual(r.files, [
    { path: 'e2e/orders.abc-12.spec.ts', status: 'A', kind: 'test' },
    { path: 'src/i18n/en.json', status: 'A', kind: 'code' },
    { path: 'src/pricing.ts', status: 'A', kind: 'code' },
  ])
  assert.deepEqual(r.counts, { code: 2, test: 1, other: 0 })
})

test('no merge of the ticket\'s own branch: the commits that name it; nothing found is empty', () => {
  const d = repo()
  const r = merged(d, config, 'ABC-13')
  assert.equal(r.found, 'commits', 'the sync merge into ABC-13 is not its merge')
  assert.deepEqual(r.files.map(f => f.path), ['src/other.ts'])
  const none = merged(d, config, 'ABC-1')
  assert.deepEqual([none.found, none.files], [null, []], 'ABC-1 is not ABC-12 or ABC-13')
  assert.equal(merged(mkdtempSync(join(tmpdir(), 'qc-nogit-')), config, 'ABC-12').found, null)
})
