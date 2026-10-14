import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ADAPTERS, decide, runPipeline, testsStep } from '../../core/pipeline/pipeline.mjs'
import { playwrightRunner } from '../../core/runners/playwright.mjs'
import { vitestRunner } from '../../core/runners/vitest.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'
import { result } from '../../core/checks/result.mjs'
import { RUN_MARKER } from '../../core/checks/boundary.mjs'
import { ENV } from '../checks/git-env.mjs'

const config = { adapter: 'vitest', jira: { projects: ['ABC'] } }
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const SPEC = "describe('ABC-1 — anchor', () => {\n  it('adds', () => { expect(add(1, 1)).toBe(2) })\n})\n"
function repo(spec = SPEC) {
  const d = mkdtempSync(join(tmpdir(), 'qc-pipe-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); put(d, 'README.md', 'x'); g('add', '-A'); g('commit', '-qm', 'i')
  put(d, 'test/a.spec.ts', spec)
  return d
}
// A runner bound to the repo: 'adds' passes, except during mutation (a testName is given) when the
// spec text is no longer the original (the temp mutant differs from the real assertion: killed).
function makeRunner(root, opts = {}) {
  return async ({ files, testName }) => {
    if (opts.ran === false) return { ran: false, tests: [], error: 'db down' }
    const src = readFileSync(join(root, files[0]), 'utf8')
    const status = opts.red ? 'failed' : testName && src !== SPEC ? 'failed' : 'passed'
    return { ran: true, broken: [], tests: [{ title: 'adds', file: files[0], status, message: status === 'failed' ? 'Expected 2' : '' }] }
  }
}

const ok = async () => result('types', 'pass', 'compiles', [], { applicable: true })
const ctx = (d, extra = {}) => ({ config, dialect: dialectFor('vitest'), root: d, runTests: makeRunner(d), typeCheck: ok, ...extra })

test('green: every step ran and passed; mutation used the step-5 baseline without a second run', async () => {
  const d = repo()
  let runs = 0
  const r0 = makeRunner(d)
  const r = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, ctx(d, { runTests: async a => { if (!a.testName) runs++; return r0(a) } }))
  assert.equal(r.verdict, 'green')
  assert.deepEqual(r.steps.map(s => s.check), ['boundary', 'honesty', 'suite-honesty', 'types', 'tests', 'mutation', 'stryker'])
  assert.equal(r.steps.at(-1).summary, 'not applicable: no target file')
  assert.equal(runs, 1)
  const m = r.steps.find(x => x.check === 'mutation')
  assert.equal(m.status, 'pass')
  assert.ok(m.data.total >= 1)
  assert.equal(m.data.killed, m.data.total)
})
test('a pure-red spec (no passing test) skips mutation and gives tests_red', async () => {
  const d = repo()
  let mutated = 0
  const r0 = makeRunner(d, { red: true })
  const r = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, ctx(d, { runTests: async a => { if (a.testName) mutated++; return r0(a) } }))
  assert.equal(r.verdict, 'tests_red')
  assert.equal(r.steps.find(s => s.check === 'tests').status, 'fail')
  assert.equal(r.steps.find(s => s.check === 'mutation').status, 'pass')
  assert.equal(mutated, 0)
})
test('a spec with passing tests whose assertions mutation cannot touch is not verified', async () => {
  const d = repo("describe('ABC-1 — anchor', () => {\n  it('adds', () => { expect(add(1, 1)).toMatchSnapshot() })\n})\n")
  const r = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, ctx(d))
  const m = r.steps.find(s => s.check === 'mutation')
  assert.equal(m.status, 'not_run')
  assert.match(m.summary, /^no assertion in test\/a\.spec\.ts that mutation can check/)
  assert.equal(m.findings[0].kind, 'nothing to mutate')
  assert.equal(r.verdict, 'not_verified')
})
test('checks failed beats everything; types fail skips tests and mutation', async () => {
  const d = repo("it('hollow', () => { run() })\n")
  const failTypes = async () => result('types', 'fail', 'x.ts(1,1): error TS1', [], { applicable: true })
  const r = await runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { typeCheck: failTypes }))
  assert.equal(r.verdict, 'checks_failed')
  assert.equal(r.decidedBy, 'suite-honesty')
  assert.equal(r.steps.find(s => s.check === 'tests').summary, 'skipped: the specs do not compile')
  assert.equal(r.steps.find(s => s.check === 'mutation').status, 'not_run')
})
test('not verified when the tests could not run', async () => {
  const d = repo()
  const r = await runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { runTests: makeRunner(d, { ran: false }) }))
  assert.equal(r.verdict, 'not_verified')
  assert.equal(r.decidedBy, 'tests')
})
test('a boundary violation fails a test-writing run (the run marker is present)', async () => {
  const d = repo()
  put(d, RUN_MARKER, '1')
  put(d, 'src/app.ts', 'x')
  const r = await runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d))
  assert.equal(r.verdict, 'checks_failed')
  assert.equal(r.decidedBy, 'boundary')
})
test('without the run marker boundary is not applicable and passes, even with changes outside the tests', async () => {
  const d = repo()
  put(d, 'src/app.ts', 'x')
  const r = await runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d))
  const b = r.steps.find(s => s.check === 'boundary')
  assert.equal(b.status, 'pass')
  assert.equal(b.summary, 'not applicable: not a test-writing run')
  assert.equal(b.data.applicable, false)
  assert.notEqual(r.verdict, 'checks_failed')
})
test('flaky only when asked', async () => {
  const d = repo()
  const r = await runPipeline({ specs: ['test/a.spec.ts'], flakyRuns: 2 }, ctx(d))
  assert.deepEqual(r.steps.slice(-2).map(s => s.check), ['flaky', 'stryker'])
})
test('testsStep and decide', () => {
  assert.equal(testsStep({ ran: true, broken: [], tests: [] }).status, 'not_run')
  assert.equal(testsStep({ ran: true, broken: [{ file: 'b', message: 'm' }], tests: [{ title: 'x', file: 'a', status: 'passed' }] }).status, 'not_run')
  assert.deepEqual(testsStep({ ran: true, broken: [], tests: [{ title: 'x', file: 'a', status: 'passed' }, { title: 'y', file: 'a', status: 'skipped' }] }).data, { ran: true, passed: 1, failed: 0, skipped: 1 })
  const s = (check, status) => ({ check, status })
  assert.deepEqual(decide([s('tests', 'fail'), s('mutation', 'not_run')]), { verdict: 'not_verified', decidedBy: 'mutation' })
  assert.deepEqual(decide([s('tests', 'fail'), s('mutation', 'pass')]), { verdict: 'tests_red', decidedBy: 'tests' })
  assert.deepEqual(decide([s('honesty', 'fail'), s('tests', 'not_run')]), { verdict: 'checks_failed', decidedBy: 'honesty' })
  assert.deepEqual(decide([s('tests', 'pass')]), { verdict: 'green', decidedBy: null })
})
test('a throwing type-check is reported with its step name', async () => {
  const d = repo()
  await assert.rejects(runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { typeCheck: async () => { throw new Error('kaput') } })), e => e.step === 'types' && /kaput/.test(e.message))
})
test('a throwing tests step is reported with its name', async () => {
  const d = repo()
  await assert.rejects(runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { runTests: async () => { throw new Error('boom') } })), e => e.step === 'tests' && /boom/.test(e.message))
})
test('a throwing mutation step is reported with its name', async () => {
  const d = repo()
  const r0 = makeRunner(d)
  const runTests = async a => { if (a.testName) throw new Error('mutant boom'); return r0(a) }
  await assert.rejects(runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, ctx(d, { runTests })), e => e.step === 'mutation' && /mutant boom/.test(e.message))
})
test('mutation and flaky get the timeout from vitest.timeoutSeconds, 300 s by default', async () => {
  const d = repo()
  const seen = async cfg => {
    const timeouts = []
    const r0 = makeRunner(d)
    await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1', flakyRuns: 2 }, ctx(d, { config: cfg, runTests: async a => { if (a.timeoutMs !== undefined) timeouts.push(a.timeoutMs); return r0(a) } }))
    return timeouts
  }
  const t900 = await seen({ ...config, vitest: { timeoutSeconds: 900 } })
  assert.ok(t900.length >= 3)
  assert.deepEqual([...new Set(t900)], [900_000])
  assert.deepEqual([...new Set(await seen(config))], [300_000])
})
test('flaky on a red run: tests that fail every run are not a flaky failure, the verdict stays tests_red', async () => {
  const d = repo()
  const r = await runPipeline({ specs: ['test/a.spec.ts'], flakyRuns: 2 }, ctx(d, { runTests: makeRunner(d, { red: true }) }))
  assert.equal(r.verdict, 'tests_red')
  const f = r.steps.find(s => s.check === 'flaky')
  assert.equal(f.status, 'pass')
  assert.match(f.summary, /fail every run \(see tests\)/)
})
test('flaky is not_run when the tests step did not run, without calling the runner for it', async () => {
  const d = repo()
  let calls = 0
  const r = await runPipeline({ specs: ['test/a.spec.ts'], flakyRuns: 2 }, ctx(d, { runTests: async () => { calls++; return { ran: false, tests: [], error: 'db down' } } }))
  assert.equal(calls, 1)
  const f = r.steps.find(s => s.check === 'flaky')
  assert.equal(f.status, 'not_run')
  assert.equal(f.summary, 'skipped: the tests did not run')
  assert.equal(r.verdict, 'not_verified')
})
test('a genuinely flaky test is still a flaky failure', async () => {
  const d = repo()
  let n = 0
  const r0 = makeRunner(d)
  const runTests = async a => {
    const r = await r0(a)
    if (a.testName) return r
    n++ // call 1 is step 5, calls 2 and 3 are the flaky runs: pass, then fail
    return n === 3 ? { ...r, tests: r.tests.map(t => ({ ...t, status: 'failed', message: 'x' })) } : r
  }
  const r = await runPipeline({ specs: ['test/a.spec.ts'], flakyRuns: 2 }, ctx(d, { runTests }))
  assert.equal(r.steps.find(s => s.check === 'flaky').status, 'fail')
  assert.equal(r.verdict, 'checks_failed')
})
test('specs are de-duplicated after normalization', async () => {
  const d = repo()
  const seen = []
  const r0 = makeRunner(d)
  const r = await runPipeline({ specs: ['test/a.spec.ts', './test/a.spec.ts', join(d, 'test/a.spec.ts')], key: 'ABC-1' }, ctx(d, { runTests: async a => { seen.push(a); return r0(a) } }))
  assert.equal(r.verdict, 'green')
  assert.deepEqual(seen.filter(a => !a.testName).map(a => a.files), [['test/a.spec.ts']])
  assert.equal(seen.filter(a => a.testName).length, r.steps.find(s => s.check === 'mutation').data.total)
})
test('a part 2 check that throws is reported with its step name', async () => {
  const d = repo()
  await assert.rejects(runPipeline({ specs: ['test/a.spec.ts'], flakyRuns: 'x' }, ctx(d)), e => e.step === 'flaky' && /runs must be/.test(e.message))
})
test('a requested spec with no results is never-ran: tests not_run, mutation skipped, not_verified', async () => {
  const d = repo()
  put(d, 'test/b.spec.ts', SPEC)
  const r = await runPipeline({ specs: ['test/a.spec.ts', 'test/b.spec.ts'], key: 'ABC-1' }, ctx(d))
  const t = r.steps.find(s => s.check === 'tests')
  assert.equal(t.status, 'not_run')
  assert.deepEqual(t.findings.map(f => [f.file, f.kind, f.detail]), [['test/b.spec.ts', 'never ran', 'test/b.spec.ts']])
  const m = r.steps.find(s => s.check === 'mutation')
  assert.equal(m.status, 'not_run')
  assert.equal(m.summary, 'skipped: the tests did not run')
  assert.equal(r.verdict, 'not_verified')
})
test('mutation waits for the tests: a broken file skips mutation even though the runner ran', async () => {
  const d = repo()
  let mutated = 0
  const runTests = async a => {
    if (a.testName) mutated++
    return { ran: true, broken: [{ file: 'test/a.spec.ts', message: 'boom' }], tests: [] }
  }
  const r = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, ctx(d, { runTests }))
  assert.equal(r.steps.find(s => s.check === 'tests').status, 'not_run')
  assert.equal(r.steps.find(s => s.check === 'mutation').summary, 'skipped: the tests did not run')
  assert.equal(mutated, 0)
})
test('specs are normalized to root-relative once: ./ and absolute forms still match', async () => {
  const d = repo()
  const seen = []
  const r0 = makeRunner(d)
  const runTests = async a => { if (!a.testName) seen.push(a.files[0]); return r0(a) }
  for (const spec of ['./test/a.spec.ts', join(d, 'test/a.spec.ts')]) {
    const r = await runPipeline({ specs: [spec], key: 'ABC-1' }, ctx(d, { runTests }))
    assert.equal(r.verdict, 'green')
    assert.equal(r.steps.find(s => s.check === 'mutation').data.total >= 1, true)
  }
  assert.deepEqual(seen, ['test/a.spec.ts', 'test/a.spec.ts'])
})

const TICKET = JSON.stringify({ key: 'ABC-1', summary: 'add', text: { description: '## Acceptance criteria\nGiven two numbers\nWhen I add 1 and 1\nThen the result is 2' } })
const stryker = (r, calls = []) => async (root, o) => { calls.push(o); return r }

test('expected runs after tests when a ticket is given; a missing value is checks_failed', async () => {
  const d = repo()
  put(d, 't.json', TICKET)
  const r = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1', ticket: 't.json' }, ctx(d))
  assert.deepEqual(r.steps.map(s => s.check), ['boundary', 'honesty', 'suite-honesty', 'types', 'tests', 'expected', 'mutation', 'stryker'])
  assert.equal(r.steps.find(s => s.check === 'expected').status, 'pass')
  assert.equal(r.verdict, 'green')
  put(d, 't.json', TICKET.replace('is 2', 'is 3'))
  const f = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1', ticket: 't.json' }, ctx(d))
  assert.equal(f.verdict, 'checks_failed')
  assert.equal(f.decidedBy, 'expected')
})
test('no ticket: no expected step', async () => {
  const r = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, ctx(repo()))
  assert.ok(!r.steps.some(s => s.check === 'expected'))
})
test('stryker: over the bar passes, under it is checks_failed, with the target and the bar', async () => {
  const d = repo()
  put(d, 'src/add.ts', 'export const add = (a, b) => a + b\n')
  const calls = []
  const good = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1', target: 'src/add.ts' }, ctx(d, { runStryker: stryker({ ran: true, score: 80, killed: 8, survived: 2, timeout: 0, noCoverage: 0 }, calls) }))
  assert.equal(good.verdict, 'green')
  assert.equal(calls[0].target, 'src/add.ts')
  assert.deepEqual(calls[0].specs, ['test/a.spec.ts'], 'only the specs under test run under Stryker')
  const s = good.steps.at(-1)
  assert.equal(s.summary, '80% of code changes caught (bar 60%)')
  assert.equal(s.data.applicable, true)
  const bad = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1', target: 'src/add.ts' }, ctx(d, { config: { ...config, vitest: { stryker: { threshold: 90 } } }, runStryker: stryker({ ran: true, score: 80, killed: 8, survived: 2, timeout: 0, noCoverage: 0 }) }))
  assert.equal(bad.verdict, 'checks_failed')
  assert.equal(bad.decidedBy, 'stryker')
  assert.equal(bad.steps.at(-1).summary, '80% of code changes caught, the bar is 90%')
})
test('stryker: not installed is not applicable; an error or no mutants is not_run; red tests still run it; not run tests skip it', async () => {
  const d = repo()
  const go = (r, extra = {}) => runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1', target: 'src/add.ts' }, ctx(d, { runStryker: stryker(r), ...extra }))
  const na = await go({ ran: false, error: 'Stryker is not installed' })
  assert.equal(na.verdict, 'green')
  assert.equal(na.steps.at(-1).summary, 'not applicable: Stryker is not installed')
  assert.equal(na.steps.at(-1).data.applicable, false)
  const err = await go({ ran: false, error: 'took longer than 5s' })
  assert.equal(err.verdict, 'not_verified')
  assert.equal(err.steps.at(-1).summary, 'could not run: took longer than 5s')
  const none = await go({ ran: true, score: null, killed: 0, survived: 0, timeout: 0, noCoverage: 0 })
  assert.equal(none.steps.at(-1).status, 'not_run')
  const calls = []
  const red = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1', target: 'src/add.ts' }, ctx(d, { runTests: makeRunner(d, { red: true }), runStryker: stryker({ ran: true, score: 100, killed: 1, survived: 0, timeout: 0, noCoverage: 0 }, calls) }))
  assert.equal(red.verdict, 'tests_red')
  assert.equal(calls.length, 1)
  const down = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1', target: 'src/add.ts' }, ctx(d, { runTests: makeRunner(d, { ran: false }), runStryker: stryker({ ran: true, score: 100 }) }))
  assert.equal(down.steps.at(-1).summary, 'skipped: the tests did not run')
})

// Playwright: the same steps with the Playwright dialect and runner, and no Stryker step.
const pwConfig = { adapter: 'playwright', jira: { projects: ['ABC'] } }
const PW_SPEC = "test.describe('ABC-1 — anchor', () => {\n  test('shows', async ({ page }) => {\n    await expect(page.getByText('Saved')).toBeVisible()\n  })\n})\n"
function pwRunner(root, opts = {}) {
  return async ({ files, testName }) => {
    if (opts.ran === false) return { ran: false, tests: [], error: 'the app is not reachable: net::ERR_CONNECTION_REFUSED' }
    const src = readFileSync(join(root, files[0]), 'utf8')
    const status = opts.red ? 'failed' : testName && src !== PW_SPEC ? 'failed' : 'passed'
    return { ran: true, broken: [], tests: [{ title: 'shows', file: files[0], status, message: status === 'failed' ? 'Timed out' : '' }] }
  }
}
const pwCtx = (d, extra = {}) => ({ config: pwConfig, dialect: dialectFor('playwright'), root: d, runTests: pwRunner(d), typeCheck: ok, ...extra })

test('playwright: green with the Playwright dialect; every flip killed; no stryker step, even with a target', async () => {
  const d = repo(PW_SPEC)
  const timeouts = []
  const r0 = pwRunner(d)
  const r = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1', flakyRuns: 2, target: 'src/x.ts' }, pwCtx(d, { runTests: async a => { timeouts.push(a.timeoutMs); return r0(a) } }))
  assert.equal(r.verdict, 'green', JSON.stringify(r.steps))
  assert.deepEqual(r.steps.map(s => s.check), ['boundary', 'honesty', 'suite-honesty', 'types', 'tests', 'mutation', 'flaky'])
  const m = r.steps.find(s => s.check === 'mutation')
  assert.equal(m.data.total, 2)
  assert.equal(m.data.killed, 2)
  assert.deepEqual([...new Set(timeouts.filter(t => t !== undefined))], [600_000])
})
test('playwright: red, checks failed and not verified', async () => {
  const d = repo(PW_SPEC)
  assert.equal((await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, pwCtx(d, { runTests: pwRunner(d, { red: true }) }))).verdict, 'tests_red')
  const down = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, pwCtx(d, { runTests: pwRunner(d, { ran: false }) }))
  assert.equal(down.verdict, 'not_verified')
  assert.equal(down.steps.find(s => s.check === 'tests').summary, 'could not run: the app is not reachable: net::ERR_CONNECTION_REFUSED')
  const h = repo("test.describe('ABC-1 — anchor', () => {\n  test('shows', async ({ page }) => {\n    await page.goto('/')\n  })\n})\n")
  const hollow = await runPipeline({ specs: ['test/a.spec.ts'], key: 'ABC-1' }, pwCtx(h, { runTests: pwRunner(h) }))
  assert.equal(hollow.verdict, 'checks_failed')
  assert.equal(hollow.decidedBy, 'suite-honesty')
})
test('playwright: a design capture test is neither graded nor mutated', async () => {
  const spec = `${PW_SPEC}test('ABC-1 — design-conformance capture', async ({ page }) => { await page.screenshot({ path: 'x.png' }) })\n`
  const d = repo(spec)
  const runner = async ({ files, testName }) => {
    const src = readFileSync(join(d, files[0]), 'utf8')
    const status = testName && src !== spec ? 'failed' : 'passed'
    return { ran: true, broken: [], tests: [{ title: 'shows', file: files[0], status, message: '' }, { title: 'ABC-1 — design-conformance capture', file: files[0], status: 'passed', message: '' }] }
  }
  const r = await runPipeline({ specs: ['test/a.spec.ts'] }, pwCtx(d, { runTests: runner }))
  assert.equal(r.verdict, 'green', JSON.stringify(r.steps))
  assert.equal(r.steps.find(s => s.check === 'suite-honesty').data.capture, 1)
  assert.equal(r.steps.find(s => s.check === 'mutation').data.total, 2)
})
test('the adapter picks the runner; an unknown adapter is a crash', async () => {
  assert.equal(ADAPTERS.playwright.runner, playwrightRunner)
  assert.equal(ADAPTERS.playwright.stryker, false)
  assert.equal(ADAPTERS.vitest.runner, vitestRunner)
  assert.equal(ADAPTERS.vitest.stryker, true)
  const d = repo()
  await assert.rejects(runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { config: { ...config, adapter: 'jest' } })), /no pipeline for adapter "jest"/)
})
