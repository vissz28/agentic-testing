import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, overall, run } from '../../core/checks/flaky.mjs'

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
