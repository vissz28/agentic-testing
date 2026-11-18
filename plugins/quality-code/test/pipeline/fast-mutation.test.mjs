// Faster mutation: mutants batched one per test per run, specs mutated side by side where safe, a suite only its changed specs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { applyMutants, originalOf, rounds, run } from '../../lib/pipeline/checks/mutation.mjs'
import { inPool, mutationWorkers, parallelSpec, runPipeline, scopedMutation } from '../../lib/pipeline/pipeline.mjs'
import { result } from '../../lib/pipeline/result.mjs'
import { branchChangedPaths } from '../../lib/core/git.mjs'
import { dialectFor } from '../../lib/stacks/dialects/index.mjs'
import { titlePattern as vitestTitles } from '../../lib/pipeline/runners/vitest.mjs'
import { titlePattern as playwrightTitles } from '../../lib/pipeline/runners/playwright.mjs'
import { filterFor } from '../../lib/pipeline/runners/dotnet.mjs'
import { selectorsFor } from '../../lib/pipeline/runners/junit.mjs'
import { runPattern } from '../../lib/pipeline/runners/go.mjs'
import { fillTemplate } from '../../lib/pipeline/runners/pytest.mjs'
import { ENV } from '../git-env.mjs'

const V = dialectFor('vitest')
const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const SPEC = `import { expect, it } from 'vitest'
it('adds', () => {
  expect(1 + 1).toBe(2)
  expect(2 + 2).toBe(4)
})
it('subtracts', () => {
  expect(3 - 1).toBe(2)
})
`

test('rounds: at most one mutant per test, each test\'s strongest first', () => {
  const ms = [{ title: 'a', n: 1 }, { title: 'a', n: 2 }, { title: 'b', n: 3 }, { title: 'a', n: 4 }]
  assert.deepEqual(rounds(ms).map(r => r.map(m => m.n)), [[1, 3], [2], [4]])
  assert.deepEqual(rounds([]), [])
})

test('applyMutants: several in one source keep each other\'s offsets', () => {
  const src = 'expect(a).toBe(1); expect(b).toBe(2);'
  const ms = [{ start: 0, end: 18, replacement: 'X;' }, { start: 19, end: 37, replacement: 'Y;' }]
  assert.equal(applyMutants(src, ms), 'X; Y;')
})

test('a runner that filters by name gets the round\'s names; one that does not runs the whole spec, and both grade every mutant', async () => {
  for (const namesFilter of [true, false]) {
    const d = mkdtempSync(join(tmpdir(), 'qc-fast-'))
    put(d, 'test/a.spec.ts', SPEC)
    const asked = []
    const runTests = Object.assign(async ({ files, testName }) => {
      asked.push(testName)
      // Every test fails while the spec it runs from holds a mutant.
      const mutated = files[0] !== 'test/a.spec.ts'
      return { ran: true, tests: ['adds', 'subtracts'].map(title => ({ title, file: files[0], status: mutated ? 'failed' : 'passed' })) }
    }, namesFilter ? { namesFilter } : {})
    const r = await run({ spec: 'test/a.spec.ts', baseline: ['adds', 'subtracts'] }, { root: d, dialect: V, runTests, config: {} })
    assert.equal(r.status, 'pass', r.summary)
    assert.equal(r.data.killed, 3)
    // Two rounds for three mutants: adds has two, subtracts one.
    assert.deepEqual(asked, namesFilter ? [['adds', 'subtracts'], 'adds'] : [undefined, 'adds'])
  }
})

test('a test that did not run in its round gets a run of its own before it counts', async () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-fast-'))
  put(d, 'test/a.spec.ts', SPEC)
  const asked = []
  const runTests = async ({ files, testName }) => {
    asked.push(testName)
    // In the shared round only adds reports (a serial group stopped early); alone, subtracts fails as it should.
    const tests = testName === undefined ? ['adds'] : [testName]
    return { ran: true, tests: tests.map(title => ({ title, file: files[0], status: 'failed' })) }
  }
  const r = await run({ spec: 'test/a.spec.ts', baseline: ['adds', 'subtracts'] }, { root: d, dialect: V, runTests, config: {} })
  assert.equal(r.status, 'pass', r.summary)
  assert.equal(r.data.killed, 3)
  assert.deepEqual(asked, [undefined, 'adds', 'subtracts'])
})

test('progress: each spec plans its mutants and counts them as they settle', async () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-fast-'))
  put(d, 'test/a.spec.ts', SPEC)
  const seen = []
  const mutationProgress = { plan: n => seen.push(['plan', n]), done: k => seen.push(['done', k]) }
  const runTests = async ({ files }) => ({ ran: true, tests: ['adds', 'subtracts'].map(title => ({ title, file: files[0], status: 'failed' })) })
  await run({ spec: 'test/a.spec.ts', baseline: ['adds', 'subtracts'] }, { root: d, dialect: V, runTests, config: {}, mutationProgress })
  assert.deepEqual(seen, [['plan', 3], ['done', true], ['done', true], ['done', true]])
})

test('inPool: never more than n at once, results in the items\' order', async () => {
  let now = 0
  let most = 0
  const out = await inPool([30, 10, 20, 5, 15], 2, async ms => {
    most = Math.max(most, ++now)
    await new Promise(r => setTimeout(r, ms))
    now--
    return ms * 2
  })
  assert.deepEqual(out, [60, 20, 40, 10, 30])
  assert.equal(most, 2)
  assert.deepEqual(await inPool([], 4, async x => x), [])
})

test('mutationWorkers: a few fewer than the cores, between 1 and 4', () => {
  assert.equal(mutationWorkers(10), 4)
  assert.equal(mutationWorkers(4), 2)
  assert.equal(mutationWorkers(1), 1)
})

test('parallelSpec: Vitest specs side by side, unless their config runs files one at a time; compiled and e2e specs alone', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-fast-'))
  put(d, 'vitest.config.mts', 'export default { test: { include: ["src/**/*.spec.ts"] } }')
  put(d, 'vitest.config.db.mts', 'export default { test: { fileParallelism: false, pool: "forks" } }')
  const config = { adapter: 'vitest', vitest: { configs: [{ match: 'test/**', config: 'vitest.config.db.mts' }] } }
  const ctx = { root: d, config, dialect: V }
  assert.equal(parallelSpec('src/a.spec.ts', ctx, 'vitest'), true)
  assert.equal(parallelSpec('test/db/a.spec.ts', ctx, 'vitest'), false, 'a shared database: one at a time')
  assert.equal(parallelSpec('e2e/a.spec.ts', { ...ctx, dialect: dialectFor('playwright') }, 'playwright'), false)
  assert.equal(parallelSpec('src/test/java/ATest.java', { ...ctx, dialect: dialectFor('junit') }, 'junit'), false)
})

test('scopedMutation: no changed spec is not applicable, never a fail; some changed says how many were left out', async () => {
  const none = await scopedMutation(['a', 'b'], [], () => { throw new Error('nothing to run') })
  assert.deepEqual([none.status, none.data.applicable], ['pass', false])
  assert.match(none.summary, /no spec changed on this branch \(--all-mutants mutates all 2\)/)
  const some = await scopedMutation(['a', 'b', 'c'], ['b'], async () => result('mutation', 'pass', '3/3 mutants killed', [], { killed: 3, total: 3 }))
  assert.equal(some.summary, '3/3 mutants killed; 2 unchanged spec(s) left out (--all-mutants checks them)')
  assert.equal(some.data.unchanged, 2)
  const all = await scopedMutation(['a'], null, async () => result('mutation', 'pass', '1/1 mutants killed'))
  assert.equal(all.summary, '1/1 mutants killed')
})

test('the pipeline mutates only the specs in mutateOnly, and the band counts the specs it mutates', async () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-fast-pipe-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main'); put(d, 'README.md', 'x'); g('add', '-A'); g('commit', '-qm', 'i')
  put(d, 'src/a.spec.ts', SPEC)
  put(d, 'src/b.spec.ts', SPEC)
  const mutated = new Set()
  const runTests = async ({ files }) => {
    for (const f of files) if (f.includes('mut-tmp-')) mutated.add(originalOf(f))
    return { ran: true, broken: [], tests: files.flatMap(f => ['adds', 'subtracts'].map(title => ({ title, file: f, status: f.includes('mut-tmp-') ? 'failed' : 'passed' }))) }
  }
  const counts = []
  const live = { file: null, side() {}, step() {}, count: (k, c) => k === 'mutants' && counts.push(c), finish() {} }
  const config = { adapter: 'vitest', backend: 'vitest', jira: { projects: ['ABC'] } }
  const out = await runPipeline({ specs: ['src/a.spec.ts', 'src/b.spec.ts'], mutateOnly: ['src/b.spec.ts'] }, { config, dialect: V, root: d, runTests, typeCheck: async () => result('types', 'pass', 'ok'), live, mutationWorkers: 2 })
  const m = out.steps.find(s => s.check === 'mutation')
  assert.equal(m.status, 'pass', m.summary)
  assert.equal(m.summary, '3/3 mutants killed; 1 unchanged spec(s) left out (--all-mutants checks them)')
  assert.deepEqual([...mutated], ['src/b.spec.ts'])
  assert.deepEqual(counts.at(-1), { done: 3, total: 3, killed: 3, files: { done: 1, total: 1 } })
})

test('branchChangedPaths: committed on the branch, not committed yet and untracked; not what the base already had', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-fast-git-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main')
  put(d, 'old.spec.ts', '1'); put(d, 'edited.spec.ts', '1'); g('add', '-A'); g('commit', '-qm', 'base')
  g('checkout', '-q', '-b', 'feature')
  put(d, 'committed.spec.ts', '1'); g('add', '-A'); g('commit', '-qm', 'branch work')
  put(d, 'edited.spec.ts', '2')
  put(d, 'untracked.spec.ts', '1')
  assert.deepEqual(branchChangedPaths(d, 'main').sort(), ['committed.spec.ts', 'edited.spec.ts', 'untracked.spec.ts'])
  // No base at all: only what is not committed yet.
  g('branch', '-q', '-m', 'main', 'trunk')
  assert.deepEqual(branchChangedPaths(d, null).sort(), ['edited.spec.ts', 'untracked.spec.ts'])
  assert.equal(branchChangedPaths(mkdtempSync(join(tmpdir(), 'qc-fast-nogit-'))), null)
})

test('every runner filters a round by its list of names', () => {
  assert.equal(vitestTitles(['a.b', 'c']), '(?:^| )(?:a\\.b|c)$')
  assert.equal(vitestTitles('a.b'), '(?:^| )a\\.b$')
  assert.equal(playwrightTitles(['a', 'b']), '(?:^| )(?:a|b)(?: @\\S+)*$')
  assert.equal(filterFor([{ fqn: 'Demo.T' }], ['Up', 'Down']), 'FullyQualifiedName~Demo.T.Up|FullyQualifiedName~Demo.T.Down')
  assert.equal(filterFor([{ fqn: 'Demo.T' }], undefined), 'FullyQualifiedName~Demo.T.')
  const info = { tops: ['demo.T'], tests: [{ title: 'up', cls: 'demo.T' }, { title: 'down', cls: 'demo.T$Inner' }] }
  assert.deepEqual(selectorsFor([info], ['up', 'down']), [{ cls: 'demo.T', method: 'up' }, { cls: 'demo.T$Inner', method: 'down' }])
  const pkgs = [{ funcs: new Map([['TestUp', { literal: new Map() }], ['TestDown', { literal: new Map([[1, 'a sale']]) }]]) }]
  assert.equal(runPattern(pkgs, ['TestUp', 'TestDown']), '^(TestUp|TestDown)$')
  assert.equal(runPattern(pkgs, ['TestUp', 'a sale']), '^(TestUp|TestDown)$', 'a subtest in the round: its package\'s functions')
  assert.deepEqual(fillTemplate('pytest -k {test} {files}', { targets: ['t.py'], report: '', testName: ['test_a', 'test_b'] }), ['pytest', '-k', 'test_a or test_b', 't.py'])
})
