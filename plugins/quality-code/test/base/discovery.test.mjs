// Pilot report: tests that sit next to the code are found, counted and run; a layer may point at src/ once the
// file names are allowed; unit specs in the e2e folder are not Playwright's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { allowCovers } from '../../lib/base/boundary.mjs'
import { validateConfig } from '../../lib/base/config.mjs'
import { detectConventions, testNameOf } from '../../lib/base/conventions.mjs'
import { projectSpecs } from '../../lib/report/quality-program.mjs'

const base = { version: 1, adapter: 'fullstack', jira: { site: 'https://x.atlassian.net', projects: ['PFO'] }, playwright: { folder: 'e2e-tests/' } }
function project(files) {
  const d = mkdtempSync(join(tmpdir(), 'qc-disc-'))
  for (const [p, s] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
  return d
}

test('an allow rule on file names inside a folder covers that folder as a layer', () => {
  assert.equal(allowCovers(['src/**/*.unit.test.js'], 'src/'), true)
  assert.equal(allowCovers(['src/**/*.unit.test.js'], 'src/features/'), true)
  assert.equal(allowCovers(['src/**/*.unit.test.js'], 'lib/'), false)
  assert.equal(allowCovers(['src/'], 'src/'), false, 'a plain allowed folder is matched the usual way')
  assert.equal(allowCovers([], 'src/'), false)
})

test('vitest.layers may point at src/ when boundaries.allow lets the test names through; not otherwise', () => {
  const layers = [{ name: 'unit', folder: 'src/' }]
  const refused = validateConfig({ ...base, vitest: { layers } })
  assert.ok(refused.errors.some(m => /is inside the forbidden "src\/"/.test(m)), refused.errors.join('; '))
  const ok = validateConfig({ ...base, vitest: { layers }, boundaries: { allow: ['src/**/*.unit.test.js', 'src/**/*.unit.test.jsx'] } })
  assert.equal(ok.ok, true, (ok.errors ?? []).join('; '))
})

test('the project flow keeps a tag before .test: .unit.test.jsx is the pattern, not .test.jsx', () => {
  assert.deepEqual(testNameOf('Dialog.unit.test.jsx'), { pattern: '.unit.test.jsx', style: 'suffix' })
  assert.deepEqual(testNameOf('Dialog.test.jsx'), { pattern: '.test.jsx', style: 'suffix' })
  assert.deepEqual(testNameOf('api.e2e.test.js'), { pattern: '.e2e.test.js', style: 'suffix' })
  assert.deepEqual(testNameOf('a.b.spec.ts'), { pattern: '.spec.ts', style: 'suffix' })
  const d = project({ 'src/a/A.unit.test.jsx': 'x', 'src/b/B.unit.test.jsx': 'x', 'src/c/C.unit.test.js': 'x' })
  const c = detectConventions(d)
  assert.equal(c.pattern, '.unit.test.jsx')
  assert.equal(c.beside, true)
})

test('specs beside the code are found wherever they are; the e2e folder keeps only Playwright specs', () => {
  const cfg = { ...base, vitest: { layers: [{ name: 'unit', folder: 'test/' }] } }
  const d = project({
    'src/a/A.unit.test.jsx': 'x', 'src/a/B.unit.test.js': 'x', 'src/b/C.unit.test.js': 'x', 'src/b/c.js': 'x',
    'test/cases/old.test.js': 'x',
    'e2e-tests/tax/list.spec.js': 'x', 'e2e-tests/ivn/expected-values.unit.test.js': 'x', 'e2e-tests/page.js': 'x',
  })
  const by = Object.fromEntries(projectSpecs(d, cfg).map(s => [s.path, s.adapter]))
  assert.equal(by['src/a/A.unit.test.jsx'], 'vitest')
  assert.equal(by['src/b/C.unit.test.js'], 'vitest')
  assert.equal(by['test/cases/old.test.js'], 'vitest')
  assert.equal(by['e2e-tests/tax/list.spec.js'], 'playwright')
  assert.equal(by['e2e-tests/ivn/expected-values.unit.test.js'], 'vitest', 'a unit spec in the e2e folder runs under the unit runner')
  assert.equal(by['e2e-tests/page.js'], undefined)
  assert.equal(Object.keys(by).length, 6)
})

test('a project whose tests are in its test folder is read as before', () => {
  const cfg = { version: 1, adapter: 'vitest', jira: base.jira }
  const d = project({ 'test/a.spec.ts': 'x', 'src/a.ts': 'x', 'src/deep/b.spec.ts': 'x' })
  const paths = projectSpecs(d, cfg).map(s => s.path).sort()
  assert.deepEqual(paths, ['test/a.spec.ts'], 'most tests are in test/: a stray spec in src/ is not pulled in')
})
