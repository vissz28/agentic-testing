import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { decide, runPipeline, testsStep } from '../../core/pipeline/vitest.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'
import { result } from '../../core/checks/result.mjs'
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
  assert.deepEqual(r.steps.map(s => s.check), ['boundary', 'honesty', 'suite-honesty', 'types', 'tests', 'mutation'])
  assert.equal(runs, 1)
  const m = r.steps.find(x => x.check === 'mutation')
  assert.equal(m.status, 'pass')
  assert.ok(m.data.total >= 1)
  assert.equal(m.data.killed, m.data.total)
})
test('tests red', async () => {
  const d = repo()
  const r = await runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { runTests: makeRunner(d, { red: true }) }))
  assert.equal(r.verdict, 'not_verified') // review focus 5: no passing test → empty baseline → mutation not_run
  assert.equal(r.steps.find(s => s.check === 'tests').status, 'fail')
  assert.equal(r.steps.find(s => s.check === 'mutation').status, 'not_run')
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
test('a boundary violation fails the run', async () => {
  const d = repo()
  put(d, 'src/app.ts', 'x')
  assert.equal((await runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d))).verdict, 'checks_failed')
})
test('flaky only when asked', async () => {
  const d = repo()
  const r = await runPipeline({ specs: ['test/a.spec.ts'], flakyRuns: 2 }, ctx(d))
  assert.equal(r.steps.at(-1).check, 'flaky')
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
test('a throwing flaky or mutation step is reported with its name', async () => {
  const d = repo()
  await assert.rejects(runPipeline({ specs: ['test/a.spec.ts'] }, ctx(d, { runTests: async () => { throw new Error('boom') } })), e => e.step === 'tests' && /boom/.test(e.message))
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
