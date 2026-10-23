// The pipeline on a backend other than Vitest: the registry's runner, no tsc, no Stryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ADAPTERS, mergeSides, runPipeline } from '../../lib/pipeline/pipeline.mjs'
import { formatCard } from '../../lib/pipeline/card.mjs'
import { dialectFor } from '../../lib/base/dialects/index.mjs'
import { result } from '../../lib/base/result.mjs'
import { pytestRunner } from '../../lib/pipeline/runners/pytest.mjs'
import { junitRunner } from '../../lib/pipeline/runners/junit.mjs'
import { goRunner } from '../../lib/pipeline/runners/go.mjs'
import { dotnetRunner } from '../../lib/pipeline/runners/dotnet.mjs'
import { ENV } from '../git-env.mjs'

const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
function repo(spec, src) {
  const d = mkdtempSync(join(tmpdir(), 'qc-be-pipe-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); put(d, 'README.md', 'x'); g('add', '-A'); g('commit', '-qm', 'i')
  put(d, spec, src)
  return d
}
const green = spec => async ({ files }) => ({ ran: true, broken: [], tests: [{ title: 'test_total', file: files[0] ?? spec, status: 'passed' }] })
const step = (out, check) => out.steps.find(s => s.check === check)

test('the registry builds a pipeline entry per backend; the stubs say they are not built yet', async () => {
  assert.equal(ADAPTERS.pytest.runner, pytestRunner)
  assert.equal(ADAPTERS.junit.runner, junitRunner)
  assert.equal(ADAPTERS.go.runner, goRunner)
  assert.equal(ADAPTERS.dotnet.runner, dotnetRunner)
  for (const a of ['pytest', 'junit', 'go', 'dotnet']) assert.equal(ADAPTERS[a].stryker, false, a)
  assert.equal(ADAPTERS.vitest.typeCheck, 'tsc')
  assert.equal(ADAPTERS.playwright.typeCheck, 'tsc')
  const r = await pytestRunner('/nowhere', {})({ files: ['tests/test_a.py'] })
  assert.deepEqual(r, { ran: false, tests: [], broken: [], error: 'pytest support is not built yet' })
  assert.equal((await dotnetRunner('/nowhere', {})({ files: [] })).error, '.NET support is not built yet')
})

test('pytest: no type step and Stryker not applicable; the card leaves both out', async () => {
  const spec = 'tests/test_orders.py'
  const d = repo(spec, 'def test_total():\n    assert total([40, 40, 40]) == 108\n')
  const out = await runPipeline({ specs: [spec], target: 'app/orders.py' }, { config: { adapter: 'pytest', jira: { projects: ['ABC'] } }, dialect: dialectFor('pytest'), root: d, runTests: green(spec) })
  assert.deepEqual(step(out, 'types'), result('types', 'pass', 'not applicable: no type-check for Python', [], { applicable: false }))
  assert.deepEqual(step(out, 'stryker'), result('stryker', 'pass', 'not applicable: Stryker is for JavaScript and TypeScript', [], { applicable: false, target: 'app/orders.py' }))
  assert.equal(step(out, 'tests').status, 'pass')
  // The stub dialect knows no assertion yet: mutation cannot show the test binds, so it is not verified.
  assert.equal(step(out, 'mutation').status, 'not_run')
  const card = formatCard(out, { specs: [spec] }).split('PIPELINE_JSON:')[0]
  assert.match(card, /tests {10}1 passed/)
  assert.doesNotMatch(card, /stryker|types/)
})

test('compiled stacks: the types step says they compile in the test run', async () => {
  for (const [a, spec, label] of [['junit', 'src/test/java/OrderTest.java', 'JUnit'], ['go', 'orders/total_test.go', 'Go'], ['dotnet', 'tests/OrderTests.cs', '.NET']]) {
    const d = repo(spec, 'x\n')
    const out = await runPipeline({ specs: [spec] }, { config: { adapter: a, jira: { projects: ['ABC'] } }, dialect: dialectFor(a), root: d, runTests: green(spec) })
    assert.equal(step(out, 'types').summary, `not applicable: ${label} compiles in the test run`, a)
    assert.equal(step(out, 'types').data.applicable, false, a)
    assert.equal(step(out, 'stryker').data.applicable, false, a)
  }
})

test('a stub runner leaves the tests not run, never a pass', async () => {
  const spec = 'tests/OrderTests.cs'
  const d = repo(spec, 'x\n')
  const out = await runPipeline({ specs: [spec] }, { config: { adapter: 'dotnet', jira: { projects: ['ABC'] } }, dialect: dialectFor('dotnet'), root: d })
  assert.equal(step(out, 'tests').status, 'not_run')
  assert.match(step(out, 'tests').summary, /\.NET support is not built yet/)
  assert.equal(out.verdict, 'not_verified')
})

test('go: a spec that does not build (or no go at all) leaves the tests not run, never a pass', async () => {
  const spec = 'orders/total_test.go'
  const d = repo(spec, 'x\n')
  put(d, 'go.mod', 'module example.com/demo\n')
  const out = await runPipeline({ specs: [spec] }, { config: { adapter: 'go', jira: { projects: ['ABC'] } }, dialect: dialectFor('go'), root: d })
  assert.equal(step(out, 'tests').status, 'not_run')
  assert.equal(out.verdict, 'not_verified')
})

test('fullstack on pytest: the backend side runs the pytest runner, the card names pytest + Playwright', async () => {
  const be = 'tests/test_orders.py'
  const fe = 'e2e/orders.spec.ts'
  const d = repo(be, 'def test_total():\n    assert 1\n')
  put(d, fe, "import { test, expect } from '@playwright/test'\ntest('shows', async ({ page }) => { await expect(page.getByText('a')).toBeVisible() })\n")
  const seen = []
  const runner = a => async ({ files }) => { seen.push([a, files[0]]); return { ran: true, broken: [], tests: [{ title: 'x', file: files[0], status: 'passed' }] } }
  const ok = async () => result('types', 'pass', 'compiles', [], { applicable: true })
  const out = await runPipeline({ specs: [be, fe], target: 'app/orders.py' }, {
    config: { adapter: 'fullstack', backend: 'pytest', jira: { projects: ['ABC'] }, playwright: { folder: 'e2e/' } },
    root: d, runners: { pytest: runner('pytest'), playwright: runner('playwright') }, typeChecks: { playwright: ok },
  })
  assert.deepEqual(out.runners, ['pytest', 'playwright'])
  assert.deepEqual(seen.filter(([, f]) => f === be).map(([a]) => a)[0], 'pytest')
  assert.match(step(out, 'types').summary, /^pytest: not applicable: no type-check for Python; Playwright: compiles$/)
  assert.match(step(out, 'stryker').summary, /^pytest: not applicable: Stryker is for JavaScript and TypeScript$/)
  assert.match(formatCard(out, { specs: [be, fe] }), /· pytest \+ Playwright/)
  assert.equal(mergeSides([{ adapter: 'dotnet', steps: [result('tests', 'pass', '1 passed')] }])[0].summary, '.NET: 1 passed')
})

test('a runner module\'s typeCheck export is the types step of a backend without tsc', async () => {
  const spec = 'tests/test_orders.py'
  const d = repo(spec, 'x\n')
  // The hook point: pytest's runner module may export typeCheck(root, config, specs); ctx.typeCheck stands in here.
  const calls = []
  const typeCheck = async specs => { calls.push(specs); return result('types', 'fail', 'mypy: 1 error', [{ file: spec, kind: 'type error', detail: 'x' }]) }
  const out = await runPipeline({ specs: [spec] }, { config: { adapter: 'pytest', pytest: { typeCheck: 'mypy {files}' }, jira: { projects: ['ABC'] } }, dialect: dialectFor('pytest'), root: d, runTests: green(spec), typeCheck })
  assert.deepEqual(calls, [[spec]])
  assert.equal(step(out, 'tests').status, 'not_run')
  assert.equal(out.verdict, 'checks_failed')
})
