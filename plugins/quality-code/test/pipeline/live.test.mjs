// Live progress: the file the band reads, the reporters' counts and the order the pipeline reports in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { liveFile, liveSlug, readLive, startLive, testCounts } from '../../lib/pipeline/live.mjs'
import { LiveCounter } from '../../lib/pipeline/runners/live-reporter.mjs'
import { strykerProgress } from '../../lib/pipeline/runners/stryker.mjs'
import { runPipeline } from '../../lib/pipeline/pipeline.mjs'
import { dialectFor } from '../../lib/stacks/dialects/index.mjs'
import { ENV } from '../git-env.mjs'

test('the slug is the band\'s too: the same path from the same folder', () => {
  assert.equal(liveSlug('/Users/me/shop app/'), 'Users-me-shop-app')
  assert.equal(liveFile('/Users/me/shop', '/tmp/x'), join('/tmp/x', 'quality-code', 'live', 'Users-me-shop.json'))
})

test('a run writes its side, steps, counts and verdict; a new run starts clean', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'qc-live-'))
  const file = liveFile('/repo', tmp)
  const live = startLive('/repo', { key: 'ABC-1', file })
  live.side('Vitest', ['types', 'tests'], 1)
  live.step('tests')
  live.count('tests', { total: 3, done: 1, passed: 1, failed: 0, skipped: 0 })
  let s = readLive(file)
  assert.deepEqual([s.key, s.side, s.sideIndex, s.step, s.tests.done, s.verdict], ['ABC-1', 'Vitest', 0, 'tests', 1, null])
  live.side('Playwright', ['tests'], 2)
  s = readLive(file)
  assert.deepEqual([s.side, s.sideIndex, s.sides, s.tests], ['Playwright', 1, 2, null])
  live.finish('green')
  assert.equal(readLive(file).verdict, 'green')
  assert.ok(readLive(file).finishedAt)
  startLive('/repo', { key: 'ABC-2', file })
  assert.deepEqual([readLive(file).key, readLive(file).verdict, readLive(file).side], ['ABC-2', null, null])
})

test('a write that fails never throws: progress is best effort', () => {
  const live = startLive('/repo', { file: '/nonexistent-dir-qc/\0bad/live.json' })
  assert.doesNotThrow(() => { live.step('tests'); live.finish('green') })
})

test('the counter counts each test once and keeps the total at least what finished', () => {
  const writes = []
  const c = new LiveCounter('/f', (_file, change) => writes.push(change({ step: 'tests' }).tests))
  c.add(2)
  c.done('a', 'passed'); c.done('a', 'passed'); c.done('b', 'failed'); c.done('c', 'skipped'); c.done('d', 'timedOut')
  c.flush(Date.now() + 1000, true)
  clearTimeout(c.timer)
  assert.deepEqual(writes.at(-1), { total: 4, done: 4, passed: 1, failed: 2, skipped: 1 })
  c.fileTotal(3); c.fileDone()
  c.flush(Date.now() + 2000, true)
  clearTimeout(c.timer)
  assert.deepEqual(writes.at(-1).files, { done: 1, total: 3 })
})

test('Stryker\'s progress line gives done, total and survived; other lines give nothing', () => {
  assert.deepEqual(strykerProgress('Mutation testing 45% (elapsed: <1m, remaining: ~1m) 12/27 tested (3 survived, 0 timed out)'), { done: 12, total: 27, survived: 3 })
  assert.equal(strykerProgress('INFO ProjectReader Found 1 of 40 file(s) to be mutated.'), null)
})

test('testCounts reads a finished run', () => {
  assert.deepEqual(testCounts({ tests: [{ status: 'passed' }, { status: 'failed' }, { status: 'skipped' }] }), { total: 3, done: 3, passed: 1, failed: 1, skipped: 1 })
  assert.deepEqual(testCounts(null), { total: 0, done: 0, passed: 0, failed: 0, skipped: 0 })
})

test('the pipeline names the side and its plan, marks each step as it starts, and hands the runner the file', async () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-live-pipe-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); writeFileSync(join(d, 'README.md'), 'x'); g('add', '-A'); g('commit', '-qm', 'i')
  const spec = 'tests/test_orders.py'
  mkdirSync(dirname(join(d, spec)), { recursive: true })
  writeFileSync(join(d, spec), 'def test_total():\n    assert total([40, 40, 40]) == 108\n')
  const calls = []
  const live = { file: '/tmp/live.json', side: (...a) => calls.push(['side', ...a]), step: n => calls.push(['step', n]), count: (k, c) => calls.push(['count', k, c.done]), finish: () => {} }
  let handed = null
  const runTests = async ({ files, live: f }) => { handed = f ?? handed; return { ran: true, broken: [], tests: [{ title: 'test_total', file: files[0], status: 'passed' }] } }
  await runPipeline({ specs: [spec] }, { config: { adapter: 'pytest', backend: 'pytest', jira: { projects: ['ABC'] } }, dialect: dialectFor('pytest'), root: d, runTests, live })
  assert.deepEqual(calls[0], ['side', 'pytest', ['honesty', 'suite-honesty', 'types', 'tests', 'mutation'], 1])
  const steps = calls.filter(c => c[0] === 'step').map(c => c[1])
  assert.deepEqual(steps.slice(0, 4), ['honesty', 'suite-honesty', 'types', 'tests'])
  assert.ok(steps.includes('mutation'))
  assert.equal(handed, '/tmp/live.json')
  // Zeroed before the run, the real counts after it.
  assert.deepEqual(calls.filter(c => c[0] === 'count' && c[1] === 'tests').map(c => c[2]), [0, 1])
})
