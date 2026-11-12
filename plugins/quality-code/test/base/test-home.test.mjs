import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { findTestHome, unitOfTest } from '../../lib/base/test-home.mjs'

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const tests = n => Array.from({ length: n }, (_, i) => `  it('case ${i}', () => {})`).join('\n')
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'qc-home-'))
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(f)), { recursive: true })
    writeFileSync(join(root, f), text)
  }
  return root
}

test('unitOfTest names the unit a test file is about', () => {
  assert.equal(unitOfTest('pricing.spec.ts'), 'pricing')
  assert.equal(unitOfTest('pricing.unit.test.js'), 'pricing')
  assert.equal(unitOfTest('FooServiceTest.java'), 'FooService')
  assert.equal(unitOfTest('test_pricing.py'), 'pricing')
  assert.equal(unitOfTest('pricing_test.go'), 'pricing')
  assert.equal(unitOfTest('pricing.ts'), null)
})

test('a test file for the same unit exists: unit-file, beside the code or in a test folder', () => {
  const root = project({
    'src/pricing.ts': 'export const a = 1',
    'src/pricing.spec.ts': tests(2),
    'src/other.spec.ts': tests(2),
    'test/tax.test.ts': tests(2),
  })
  assert.deepEqual(findTestHome(root, 'src/pricing.ts'), { kind: 'unit-file', file: 'src/pricing.spec.ts', reason: 'src/pricing.spec.ts already tests pricing' })
  assert.equal(findTestHome(root, 'src/tax.ts').file, 'test/tax.test.ts')
})

test('one file holds most of the tests: central', () => {
  const root = project({
    'tests/all.spec.ts': tests(12),
    'tests/small.spec.ts': tests(2),
  })
  const r = findTestHome(root, 'src/newthing.ts')
  assert.equal(r.kind, 'central')
  assert.equal(r.file, 'tests/all.spec.ts')
})

test('a Java module with one test class: central, the class that mentions the unit', () => {
  const root = project({
    'core/src/main/java/app/WorkspaceSettlementService.java': 'class WorkspaceSettlementService {}',
    'core/src/test/java/app/CoreTest.java': `import app.WorkspaceSettlementService;\nclass CoreTest {\n@Test void a() {}\n@Test void b() {}\n}`,
    'billing/src/test/java/app/BillingTest.java': 'class BillingTest {\n@Test void a() {}\n}',
    'billing/src/test/java/app/InvoiceServiceTest.java': 'class InvoiceServiceTest {\n@Test void a() {}\n}',
    'billing/src/test/java/app/LedgerTest.java': 'class LedgerTest {\n@Test void a() {}\n}',
  })
  const r = findTestHome(root, 'core/src/main/java/app/WorkspaceSettlementService.java')
  assert.equal(r.kind, 'central')
  assert.equal(r.file, 'core/src/test/java/app/CoreTest.java')
})

test('tests kept per unit and none for this one: none', () => {
  const root = project({
    'src/a.spec.ts': tests(3),
    'src/b.spec.ts': tests(3),
    'src/c.spec.ts': tests(3),
  })
  assert.equal(findTestHome(root, 'src/d.ts').kind, 'none')
})

test('a project without tests: none', () => {
  const root = project({ 'src/a.ts': 'x' })
  const r = findTestHome(root, 'src/a.ts')
  assert.equal(r.kind, 'none')
  assert.equal(r.file, null)
})

test('config test-home prints a line and TEST_HOME_JSON', () => {
  const root = project({ 'src/pricing.spec.ts': tests(2), '.claude/quality-code.json': JSON.stringify({ version: 2, backend: 'vitest', jira: { site: 'https://example.atlassian.net', projects: ['ABC'] } }) })
  const r = spawnSync('node', [CLI, 'config', 'test-home', 'src/pricing.ts'], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^test home: src\/pricing\.spec\.ts/m)
  const line = r.stdout.split('\n').find(l => l.startsWith('TEST_HOME_JSON:'))
  assert.equal(JSON.parse(line.slice(15)).kind, 'unit-file')
})
