// End to end: the real pipeline, with the sample service's own Vitest, tsc and Stryker.
// Runs only with QC_E2E=1, after `npm ci` in examples/sample-service. The committed sample is
// never written; the hollow case runs in a temp copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENV } from '../checks/git-env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '../../core/pipeline/cli.mjs')
const SAMPLE = join(HERE, '../../../../examples/sample-service')
const skip = process.env.QC_E2E === '1' ? false : 'end to end: set QC_E2E=1 (after npm ci in examples/sample-service)'
const LONG = 10 * 60 * 1000

const installed = () => assert.ok(existsSync(join(SAMPLE, 'node_modules/.bin/vitest')) && existsSync(join(SAMPLE, 'node_modules/.bin/stryker')),
  'the sample has no node_modules: run npm ci in examples/sample-service first')

function pipeline(root, args) {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, QC_NO_AUDIT: '1' }, encoding: 'utf8', timeout: LONG })
  const seconds = ((Date.now() - t0) / 1000).toFixed(1)
  const line = r.stdout.trim().split('\n').at(-1)
  let outcome = null
  try { outcome = JSON.parse(line) } catch {}
  assert.ok(outcome, `no JSON outcome (exit ${r.status}): ${r.stderr || r.stdout}`)
  const step = name => outcome.steps.find(s => s.check === name)
  const card = `${outcome.verdict} in ${seconds}s, decided by ${outcome.decidedBy ?? '-'}: ${outcome.steps.map(s => `${s.check}=${s.status}`).join(' ')}`
  return { code: r.status, outcome, step, card }
}

const noTempSpecs = root => assert.deepEqual(readdirSync(join(root, 'test/unit')).filter(f => f.startsWith('mut-tmp-')), [])

test('the story DEMO-1 is green, Stryker included', { skip, timeout: LONG }, t => {
  installed()
  const r = pipeline(SAMPLE, ['test/unit/pricing.demo-1.spec.ts', '--key', 'DEMO-1', '--ticket', '@tickets/DEMO-1.json', '--target', 'src/pricing.ts'])
  t.diagnostic(r.card)
  assert.equal(r.outcome.verdict, 'green', r.card)
  assert.equal(r.code, 0)
  assert.equal(r.step('tests').data.passed, 6)
  assert.equal(r.step('expected').status, 'pass')
  assert.equal(r.step('expected').data.missing.length, 0)
  assert.equal(r.step('mutation').status, 'pass')
  const s = r.step('stryker')
  assert.equal(s.status, 'pass', s.summary)
  assert.equal(s.data.applicable, true)
  assert.ok(s.data.score >= s.data.threshold, s.summary)
  assert.ok(s.data.killed > 0)
  noTempSpecs(SAMPLE)
})

test('the bug DEMO-2 is red: the rounding bug is real', { skip, timeout: LONG }, t => {
  installed()
  // With --target, as write passes it: Stryker cannot start on a red run, so it must not decide the verdict.
  const r = pipeline(SAMPLE, ['test/unit/vat.demo-2.spec.ts', '--key', 'DEMO-2', '--ticket', '@tickets/DEMO-2.json', '--target', 'src/vat.ts'])
  t.diagnostic(r.card)
  assert.equal(r.outcome.verdict, 'tests_red', r.card)
  assert.equal(r.outcome.decidedBy, 'tests')
  assert.equal(r.code, 1)
  const tests = r.step('tests')
  assert.deepEqual({ passed: tests.data.passed, failed: tests.data.failed }, { passed: 1, failed: 3 })
  assert.deepEqual(tests.findings.map(f => f.test).sort(), ['half a cent rounds up', 'half a cent rounds up at the reduced rate', 'the gross total includes the rounded VAT'])
  assert.equal(r.step('expected').status, 'pass')
  assert.equal(r.step('stryker').data.applicable, false, r.step('stryker').summary)
  noTempSpecs(SAMPLE)
})

// The DEMO-1 tests with their values taken out: every assertion still passes, none binds the ticket.
const HOLLOW = `import { describe, expect, it } from 'vitest'
import { lineTotal, orderTotal } from '../../src/pricing'

describe('DEMO-1 Order total applies a 10% volume discount from 100.00', () => {
  it('line total', () => {
    const total = lineTotal({ sku: 'A-1', unitPrice: 4.50, quantity: 3 })

    expect(total).toBeDefined()
  })

  it('order below the discount threshold', () => {
    const order = orderTotal([{ sku: 'A-1', unitPrice: 4.50, quantity: 3 }])

    expect(order.total).toBeGreaterThan(0)
  })

  it('order above the discount threshold', () => {
    const order = orderTotal([{ sku: 'E-5', unitPrice: 60.00, quantity: 2 }])

    expect(order).toBeTruthy()
  })
})
`

test('a hollow DEMO-1 spec fails the checks', { skip, timeout: LONG }, t => {
  installed()
  const copy = mkdtempSync(join(tmpdir(), 'qc-e2e-sample-'))
  try {
    cpSync(SAMPLE, copy, { recursive: true, filter: src => relative(SAMPLE, src).split(sep)[0] !== 'node_modules' })
    symlinkSync(join(SAMPLE, 'node_modules'), join(copy, 'node_modules'), 'dir')
    // Committed as written, so no assertion was removed: the checks must catch it on the values alone.
    writeFileSync(join(copy, 'test/unit/pricing.demo-1.spec.ts'), HOLLOW)
    const g = (...a) => execFileSync('git', a, { cwd: copy, env: ENV, stdio: 'ignore' })
    g('init', '-q', '-b', 'main')
    g('add', '-A')
    g('commit', '-qm', 'sample')
    const r = pipeline(copy, ['test/unit/pricing.demo-1.spec.ts', '--key', 'DEMO-1', '--ticket', '@tickets/DEMO-1.json'])
    t.diagnostic(r.card)
    assert.equal(r.outcome.verdict, 'checks_failed', r.card)
    assert.equal(r.code, 1)
    assert.equal(r.step('tests').status, 'pass')
    assert.equal(r.step('honesty').status, 'pass')
    assert.equal(r.outcome.decidedBy, 'expected')
    const e = r.step('expected')
    assert.equal(e.status, 'fail')
    assert.ok(e.data.missing.includes('13.50'), e.summary)
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
})
