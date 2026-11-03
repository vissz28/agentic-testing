import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { formatQuality, qualityKpi, scanSpecs } from '../../lib/report/quality-program.mjs'

const CONFIG = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['ABC'] }, git: { base: 'main' }, features: [], languages: ['en'] }
const g = (d, ...a) => execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=n', ...a], { cwd: d, stdio: 'ignore' })
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const spec = title => `describe('${title}', () => {\n  it('works', () => { expect(1).toBe(1) })\n})\n`

test('traceability: the whole suite and the work on this branch are two numbers', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-bt-'))
  g(d, 'init', '-q', '-b', 'main')
  // An old suite nobody linked to tickets.
  for (let i = 1; i <= 8; i++) put(d, `test/old${i}.spec.ts`, spec(`feature ${i}`))
  put(d, 'test/old9.abc-9.spec.ts', spec('feature nine'))
  g(d, 'add', '-A'); g(d, 'commit', '-qm', 'init')
  g(d, 'checkout', '-qb', 'ABC-12-new')
  put(d, 'test/new.spec.ts', spec('ABC-12 new rule'))
  put(d, 'test/other.spec.ts', spec('another rule, no key'))
  g(d, 'add', '-A'); g(d, 'commit', '-qm', 'new')
  const scan = scanSpecs(d, CONFIG)
  assert.equal(scan.specs, 11)
  assert.equal(scan.traced, 2)
  assert.deepEqual(scan.branch, { base: 'main', specs: 2, traced: 1 })
  const q = qualityKpi({ finals: [], runs: [], scan, coverage: null })
  assert.equal(q.traceability.pct, 18)
  assert.equal(q.traceability.branch.pct, 50)
  assert.match(formatQuality(q).find(l => l.includes('Traceability')), /2 of 11 spec files name a ticket; on this branch 1 of 2 \(50%, since main\)/)
})

test('traceability: no base or no changed spec gives no branch number, and the old line stays', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-bt-'))
  g(d, 'init', '-q', '-b', 'main')
  put(d, 'test/a.spec.ts', spec('ABC-1 a'))
  g(d, 'add', '-A'); g(d, 'commit', '-qm', 'init')
  assert.equal(scanSpecs(d, CONFIG).branch, null, 'on the base nothing changed')
  assert.equal(scanSpecs(d, { ...CONFIG, git: undefined }).branch, null, 'no base in the config')
  const q = qualityKpi({ finals: [], runs: [], scan: scanSpecs(d, CONFIG), coverage: null })
  assert.match(formatQuality(q).find(l => l.includes('Traceability')), /1 of 1 spec files name a ticket$/)
})
