import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, overall, run } from '../../../lib/pipeline/checks/flaky.mjs'

test('classify and overall (both warehouse self-tests)', () => {
  assert.equal(classify(5, 0), 'green')
  assert.equal(classify(0, 5), 'real')
  assert.equal(classify(3, 2), 'flaky')
  assert.equal(classify(4, 1), 'flaky')
  assert.equal(overall(['green', 'real', 'flaky']), 'flaky')
  assert.equal(overall(['green', 'real']), 'real')
  assert.equal(overall(['green', 'green']), 'green')
})
const runner = script => {
  let i = 0
  const calls = []
  return { calls, runTests: async args => { calls.push(args); return script(i++) } }
}
const t = (title, status) => ({ title, file: 'a.spec.ts', status })

test('green, flaky and real verdicts; retries are the runner\'s job but runs is 5 by default', async () => {
  const g = runner(() => ({ ran: true, tests: [t('a', 'passed')] }))
  const green = await run({ specs: ['a.spec.ts'] }, { runTests: g.runTests })
  assert.equal(green.status, 'pass')
  assert.equal(g.calls.length, 5)
  const f = runner(i => ({ ran: true, tests: [t('a', i % 2 ? 'failed' : 'passed'), t('b', 'passed')] }))
  const flaky = await run({ specs: ['a.spec.ts'], runs: 4 }, { runTests: f.runTests })
  assert.equal(flaky.status, 'fail')
  assert.match(flaky.summary, /^flaky/)
  assert.deepEqual(flaky.data.tests.find(x => x.title === 'a.spec.ts > a'), { title: 'a.spec.ts > a', pass: 2, fail: 2, verdict: 'flaky' })
  const real = await run({ specs: ['a.spec.ts'], runs: 3 }, { runTests: runner(() => ({ ran: true, tests: [t('a', 'failed')] })).runTests })
  assert.equal(real.status, 'fail')
  assert.match(real.summary, /^real/)
})
test('could not run, no tests ran, every test skipped: not_run, never green', async () => {
  const a = await run({ specs: ['a'], runs: 2 }, { runTests: runner(() => ({ ran: false, tests: [], error: 'build error' })).runTests })
  assert.equal(a.status, 'not_run')
  assert.match(a.summary, /build error/)
  const b = await run({ specs: ['a'], runs: 2 }, { runTests: runner(() => ({ ran: true, tests: [] })).runTests })
  assert.equal(b.status, 'not_run')
  assert.match(b.summary, /no tests ran/)
  const c = await run({ specs: ['a'], runs: 2 }, { runTests: runner(() => ({ ran: true, tests: [t('a', 'skipped')] })).runTests })
  assert.equal(c.status, 'not_run')
})
test('a file that never ran turns green into not_run (Ruling 4)', async () => {
  const r = await run({ specs: ['a'], runs: 2 }, { runTests: runner(() => ({ ran: true, tests: [t('a', 'passed')], broken: [{ file: 'b.spec.ts', message: 'import error' }] })).runTests })
  assert.equal(r.status, 'not_run')
  assert.deepEqual(r.data.broken, [{ file: 'b.spec.ts', message: 'import error' }])
})
test('the runner gets the spec files, the test name and the timeout', async () => {
  const g = runner(() => ({ ran: true, tests: [t('a', 'passed')] }))
  await run({ specs: ['a.spec.ts'], testName: 'a', runs: 1, timeoutMs: 1000 }, { runTests: g.runTests })
  assert.deepEqual(g.calls[0], { files: ['a.spec.ts'], testName: 'a', timeoutMs: 1000 })
})
test('green verdict requires all runs executed; partial execution is not_run', async () => {
  const partial = runner(i => i === 0 ? { ran: true, tests: [t('a', 'passed')] } : { ran: false, tests: [], error: 'x' })
  const r = await run({ specs: ['a'], runs: 3 }, { runTests: partial.runTests })
  assert.equal(r.status, 'not_run')
  assert.match(r.summary, /only 1 of 3 runs executed/)
})
test('runs must be a whole number >= 1', async () => {
  const runner0 = runner(() => ({ ran: true, tests: [t('a', 'passed')] }))
  try {
    await run({ specs: ['a'], runs: 0 }, { runTests: runner0.runTests })
    assert.fail('should throw')
  } catch (e) {
    assert.match(e.message, /runs must be a whole number/)
  }
  const runnerAbc = runner(() => ({ ran: true, tests: [t('a', 'passed')] }))
  try {
    await run({ specs: ['a'], runs: 'abc' }, { runTests: runnerAbc.runTests })
    assert.fail('should throw')
  } catch (e) {
    assert.match(e.message, /runs must be a whole number/)
  }
  const runnerStr = runner(() => ({ ran: true, tests: [t('a', 'passed')] }))
  const r = await run({ specs: ['a'], runs: '2' }, { runTests: runnerStr.runTests })
  assert.equal(r.status, 'pass')
  assert.equal(runnerStr.calls.length, 2)
})

test('same-named tests in different groups stay apart; with a key, only its block counts', async () => {
  const at = (path, status) => ({ title: 'shows the total', path, file: 'a.spec.ts', status })
  // ABC-1's test passes every run; a namesake in ABC-2's block flips.
  const script = i => ({ ran: true, tests: [at(['ABC-1 Orders'], 'passed'), at(['ABC-2 Old'], i % 2 ? 'failed' : 'passed')] })
  const all = await run({ specs: ['a.spec.ts'], runs: 4 }, { runTests: runner(script).runTests })
  assert.deepEqual(all.data.tests.map(t => [t.title, t.verdict]), [['a.spec.ts > ABC-1 Orders > shows the total', 'green'], ['a.spec.ts > ABC-2 Old > shows the total', 'flaky']])
  const own = await run({ specs: ['a.spec.ts'], runs: 4, key: 'ABC-1' }, { runTests: runner(script).runTests })
  assert.equal(own.status, 'pass', own.summary)
})

test('a flaky or real test names its first failure', async () => {
  const s = i => ({ ran: true, tests: [{ title: 'a', file: 'a.spec.ts', status: i % 2 ? 'failed' : 'passed', message: i % 2 ? `Timeout ${i}` : '' }] })
  const r = await run({ specs: ['a.spec.ts'], runs: 4 }, { runTests: runner(s).runTests })
  assert.equal(r.findings[0].detail, '2 pass / 2 fail; first failure: Timeout 1')
  assert.equal(r.data.tests[0].message, 'Timeout 1')
})
