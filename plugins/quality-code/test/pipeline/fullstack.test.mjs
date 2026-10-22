// A fullstack run: Vitest specs and Playwright specs in one pipeline call, one verdict.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runPipeline } from '../../lib/pipeline/pipeline.mjs'
import { formatCard } from '../../lib/pipeline/card.mjs'
import { result } from '../../lib/base/result.mjs'
import { ENV } from '../git-env.mjs'

const config = { adapter: 'fullstack', jira: { projects: ['ABC'] }, playwright: { folder: 'e2e/' } }
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const BE = "describe('ABC-1 Orders total', () => {\n  it('totals the order', () => { expect(total([40, 40, 40])).toBe(108) })\n})\n"
const FE = "import { test, expect } from '@playwright/test'\n\ntest.describe('ABC-1 Orders total', { tag: '@ABC-1' }, () => {\n  test('shows the total', async ({ page }) => {\n    await page.goto('/orders')\n\n    await expect(page.getByRole('cell', { name: 'Total' })).toHaveText('€ 108,00')\n  })\n})\n"
const TICKET = JSON.stringify({ key: 'ABC-1', summary: '[FS] Orders total', text: { description: '## Acceptance criteria\nScenario: total\nGiven 3 items at 40\nWhen I open the order\nThen the API total is 108\nAnd the page shows "€ 108,00"' } })

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'qc-fs-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); put(d, 'README.md', 'x'); g('add', '-A'); g('commit', '-qm', 'i')
  put(d, 'test/a.spec.ts', BE)
  put(d, 'e2e/orders.abc-1.spec.ts', FE)
  put(d, 't.json', TICKET)
  return d
}

// Each runner passes its file's test, and fails it when mutation changed the file (a mutant killed).
const runner = (root, original, title, { red = false, calls = [] } = {}) => async ({ files, testName }) => {
  calls.push(files)
  const changed = readFileSync(join(root, files[0]), 'utf8') !== original
  const status = red || (testName && changed) ? 'failed' : 'passed'
  return { ran: true, broken: [], tests: [{ title, file: files[0], status, message: status === 'failed' ? 'Expected "€ 108,00"' : '' }] }
}
const compiles = async () => result('types', 'pass', 'compiles', [], { applicable: true })
const ctx = (d, { red = false, vitestCalls = [], playwrightCalls = [] } = {}) => ({
  config,
  root: d,
  typeCheck: compiles,
  runners: {
    vitest: runner(d, BE, 'totals the order', { calls: vitestCalls }),
    playwright: runner(d, FE, 'shows the total', { red, calls: playwrightCalls }),
  },
})
const specs = ['test/a.spec.ts', 'e2e/orders.abc-1.spec.ts']

test('each side runs its own specs with its own runner; one green verdict over both', async () => {
  const d = repo()
  const vitestCalls = []
  const playwrightCalls = []
  const r = await runPipeline({ specs, key: 'ABC-1' }, ctx(d, { vitestCalls, playwrightCalls }))
  assert.equal(r.verdict, 'green', JSON.stringify(r.steps.map(s => [s.check, s.status, s.summary])))
  assert.deepEqual(r.runners, ['vitest', 'playwright'])
  assert.deepEqual(r.steps.map(s => s.check), ['boundary', 'honesty', 'suite-honesty', 'types', 'tests', 'mutation', 'stryker'])
  assert.ok(vitestCalls.every(f => f.every(x => x.startsWith('test/'))) && vitestCalls.length)
  assert.ok(playwrightCalls.every(f => f.every(x => x.startsWith('e2e/'))) && playwrightCalls.length)
  const tests = r.steps.find(s => s.check === 'tests')
  assert.deepEqual([tests.data.passed, tests.data.failed], [2, 0], 'counts add up across sides')
  assert.equal(tests.summary, 'Vitest: 1 passed; Playwright: 1 passed')
  assert.match(r.steps.find(s => s.check === 'stryker').summary, /^Vitest: /, 'Stryker is a Vitest step only')
  assert.equal(r.steps.filter(s => s.check === 'boundary').length, 1)
  assert.match(formatCard(r, { specs, key: 'ABC-1' }), /^quality-code check · 2 spec files · Vitest \+ Playwright · ticket ABC-1/)
})

test('the ticket values are checked across both sides: each side asserts its half', async () => {
  const d = repo()
  const r = await runPipeline({ specs, key: 'ABC-1', ticket: join(d, 't.json') }, ctx(d))
  const e = r.steps.find(s => s.check === 'expected')
  assert.equal(e.status, 'pass', e.summary)
  assert.equal(e.data.tokens, 2)
  assert.equal(r.verdict, 'green')
})

test('a red Playwright test: tests_red, the finding names its runner', async () => {
  const d = repo()
  const r = await runPipeline({ specs, key: 'ABC-1' }, ctx(d, { red: true }))
  assert.equal(r.verdict, 'tests_red')
  const tests = r.steps.find(s => s.check === 'tests')
  assert.equal(tests.status, 'fail')
  assert.deepEqual(tests.findings.map(f => [f.runner, f.test]), [['Playwright', 'shows the total']])
})

test('only Vitest specs on a fullstack project: one runner, no Playwright run', async () => {
  const d = repo()
  const playwrightCalls = []
  const r = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, ctx(d, { playwrightCalls }))
  assert.equal(r.verdict, 'green')
  assert.deepEqual(r.runners, ['vitest'])
  assert.equal(playwrightCalls.length, 0)
})
