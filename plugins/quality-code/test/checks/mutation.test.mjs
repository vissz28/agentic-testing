import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyMutant, findExpectRanges, planMutants, run, sweepStale, tempSpecPath } from '../../core/checks/mutation.mjs'
import { dialectFor } from '../../core/checks/dialects/index.mjs'
import { fakeRunner } from './fake-runner.mjs'

const V = dialectFor('vitest')
const P = dialectFor('playwright')
const HERE = dirname(fileURLToPath(import.meta.url))

test('vitest: the backend self-test', () => {
  const f = V.mutation.flips
  assert.ok(f('expect(result).toBe(80)').some(x => x.kind === 'invert-matcher' && x.text === 'expect(result).not.toBe(80)'))
  assert.ok(f('expect(result).toBe(80)').some(x => x.kind === 'num→n+1' && x.text === 'expect(result).toBe(81)'))
  assert.ok(f("expect(row.code).toBe('ABC')").some(x => x.kind === 'corrupt-string' && x.text.includes('ABC★MUT')))
  assert.ok(f('expect(x).not.toBe(1)').some(x => x.kind === 'drop-not' && x.text === 'expect(x).toBe(1)'))
  assert.ok(f('expect(flag).toBeTruthy()').some(x => x.kind === 'truthy→falsy'))
  const f5 = f('expect(spy).toHaveBeenCalledTimes(2)')
  assert.ok(f5.some(x => x.kind === 'invert-matcher') && f5.some(x => x.text.includes('toHaveBeenCalledTimes(3)')))
  const src = "describe('FIC-9 — anchor', () => {\n  it('green', () => { expect(compute(a, b)).toBe(80); expect(name).toBe('x') });\n  it('red', () => { expect(compute()).toBe(999) });\n});\ndescribe('OTHER', () => { it('legacy', () => { expect(z).toBe(1) }) });\n"
  const ranges = findExpectRanges(src, V)
  assert.equal(ranges.length, 4)
  assert.equal(src.slice(ranges[0].start, ranges[0].end), 'expect(compute(a, b)).toBe(80);')
  const plan = planMutants(src, ['green'], { key: 'FIC-9' }, V)
  assert.equal(plan.length, 2)
  assert.ok(plan.every(p => p.title === 'green'))
  const applied = applyMutant(src, plan.find(p => p.kind === 'invert-matcher'))
  assert.ok(applied.includes('.not.toBe(80)') && applied.includes('expect(compute()).toBe(999)'))
  assert.ok(planMutants(src, ['green', 'legacy'], { key: 'FIC-9' }, V).every(p => p.title === 'green'))
  assert.ok(planMutants(src, ['green'], { key: 'FIC-9', thorough: true }, V).length > plan.length)
  assert.ok(plan.every(p => V.mutation.rank(p.kind) === 0))
  assert.equal(planMutants(src, ['green'], { key: 'FIC-404' }, V), null)
})
test('playwright: the frontend self-test', () => {
  const src = "\ntest('T-1-green', async ({ page }) => {\n  await expect(page.getByText('a')).toBeVisible()\n  await expect(page.getByText('b')).toHaveCount(0)\n})\ntest('T-2 — design-conformance capture', async ({ page }) => {\n  await expect(page.getByText('x')).toBeVisible()\n})\ntest.fixme('T-3', async () => {\n  await expect(page.getByText('y')).toBeVisible()\n})\ntest('T-4-red', async ({ page }) => {\n  await expect(page.getByText('z')).toBeVisible()\n})\n"
  const flips = P.mutation.flips("await expect(page.getByText('a')).toBeVisible()")
  assert.ok(flips.some(f => f.kind === 'flip-visible→count-999' && f.text.includes('toHaveCount(999')))
  assert.ok(flips.some(f => f.kind === 'corrupt-getBy-string' && f.text.includes('★MUT')))
  const plan = planMutants(src, ['T-1-green'], {}, P)
  assert.ok(plan.length >= 3)
  assert.ok(plan.every(p => p.title === 'T-1-green'))
  const mut = applyMutant(src, plan.find(p => p.kind === 'flip-visible→count-999'))
  assert.ok(mut.includes('toHaveCount(999') && mut.includes("getByText('a')"))
})
test('temp spec is a sibling, never the original', () => {
  const tp = tempSpecPath('/x/src/a/kpi.service.spec.ts')
  assert.equal(dirname(tp), '/x/src/a')
  assert.match(tp, /\/mut-tmp-\d+-[a-z0-9]+-[a-z0-9]+\.spec\.ts$/)
})

const SPEC = "describe('ABC-1 — anchor', () => {\n  it('adds', () => { expect(add(1, 1)).toBe(2) })\n  it('weak', () => { expect(add(1, 1)).toBeDefined() })\n})\n"
function spec(text = SPEC) {
  const d = mkdtempSync(join(tmpdir(), 'qc-mut-'))
  mkdirSync(join(d, 'test'))
  writeFileSync(join(d, 'test/a.spec.ts'), text)
  return d
}
// A mutant is killed when the test's assertion line was changed in a way the "real code" notices:
// 'adds' fails when its expect changed; 'weak' never fails (toBeDefined binds nothing).
const verdict = (src, title) => (title === 'adds' && !src.includes('expect(add(1, 1)).toBe(2)') ? 'failed' : 'passed')

test('run: a survivor fails the check at the 100% bar and is named', async () => {
  const d = spec()
  const { runTests } = fakeRunner(d, verdict)
  const r = await run({ spec: 'test/a.spec.ts', key: 'ABC-1' }, { root: d, dialect: V, runTests })
  assert.equal(r.status, 'fail')
  assert.deepEqual({ ...r.data, survivors: r.data.survivors.length }, { killed: 1, survived: 1, errors: 0, total: 2, score: 50, survivors: 1 })
  assert.deepEqual(r.findings.map(f => f.test), ['weak'])
  assert.equal(readFileSync(join(d, 'test/a.spec.ts'), 'utf8'), SPEC)
  assert.deepEqual(readdirSync(join(d, 'test')), ['a.spec.ts'])
})
test('run: all killed passes; nothing eligible passes with score null', async () => {
  const d = spec("describe('ABC-1', () => { it('adds', () => { expect(add(1, 1)).toBe(2) }) })\n")
  assert.equal((await run({ spec: 'test/a.spec.ts' }, { root: d, dialect: V, runTests: fakeRunner(d, verdict).runTests })).status, 'pass')
  const none = spec("it.todo('later')\n")
  const r = await run({ spec: 'test/a.spec.ts' }, { root: none, dialect: V, runTests: fakeRunner(none, verdict).runTests })
  assert.equal(r.status, 'pass')
  assert.equal(r.data.score, null)
})
test('run: baseline red tests are never mutated; --baseline skips the baseline run', async () => {
  const d = spec()
  const { runTests, calls } = fakeRunner(d, verdict)
  const r = await run({ spec: 'test/a.spec.ts', baseline: ['adds'] }, { root: d, dialect: V, runTests })
  assert.equal(r.data.total, 1)
  assert.ok(calls.every(c => c.testName === 'adds'))
})
test('run: runner could not run → not_run; mutants that ran nothing are errors, not survivors', async () => {
  const d = spec()
  const r = await run({ spec: 'test/a.spec.ts' }, { root: d, dialect: V, runTests: fakeRunner(d, verdict, { ran: false, error: 'db down' }).runTests })
  assert.equal(r.status, 'not_run')
  assert.match(r.summary, /db down/)
  let first = true
  const flaky = async args => (first ? ((first = false), { ran: true, tests: [{ title: 'adds', file: args.files[0], status: 'passed' }] }) : { ran: true, tests: [] })
  const e = await run({ spec: 'test/a.spec.ts' }, { root: d, dialect: V, runTests: flaky })
  assert.equal(e.status, 'not_run')
  assert.equal(e.data.errors, 1)
})
test('run: --max keeps the strongest; a missing --key block is not_run', async () => {
  const d = spec()
  const r = await run({ spec: 'test/a.spec.ts', max: 1, thorough: true }, { root: d, dialect: V, runTests: fakeRunner(d, verdict).runTests })
  assert.equal(r.data.total, 1)
  const m = await run({ spec: 'test/a.spec.ts', key: 'ABC-2' }, { root: d, dialect: V, runTests: fakeRunner(d, verdict).runTests })
  assert.equal(m.status, 'not_run')
})
test('run: the runner gets the exact title, regex characters and all (review focus 5)', async () => {
  const d = spec("it('a (b) + c', () => { expect(x).toBe(1) })\n")
  const { runTests, calls } = fakeRunner(d, () => 'passed')
  await run({ spec: 'test/a.spec.ts' }, { root: d, dialect: V, runTests })
  assert.ok(calls.slice(1).every(c => c.testName === 'a (b) + c'))
})
test('sweepStale removes temp mutants of dead processes only', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-sweep-'))
  writeFileSync(join(d, 'mut-tmp-999999-abc-def.spec.ts'), 'x')
  writeFileSync(join(d, `mut-tmp-${process.pid}-abc-def.spec.ts`), 'x')
  writeFileSync(join(d, 'a.spec.ts'), 'x')
  assert.equal(sweepStale(d), 1)
  assert.deepEqual(readdirSync(d).sort(), ['a.spec.ts', `mut-tmp-${process.pid}-abc-def.spec.ts`])
})
test('SIGINT mid-run leaves the original spec byte-identical and no temp file', async () => {
  const d = spec()
  const child = spawn(process.execPath, [join(HERE, 'mutation-interrupt.fixture.mjs'), d], { stdio: 'ignore' })
  const tempSeen = await new Promise(done => {
    const t0 = Date.now()
    const tick = setInterval(() => {
      const temp = readdirSync(join(d, 'test')).some(n => n.startsWith('mut-tmp-'))
      if (temp || Date.now() - t0 > 5000) { clearInterval(tick); done(temp) }
    }, 20)
  })
  assert.ok(tempSeen)
  child.kill('SIGINT')
  await new Promise(done => child.on('exit', done))
  assert.equal(readFileSync(join(d, 'test/a.spec.ts'), 'utf8'), SPEC)
  assert.deepEqual(readdirSync(join(d, 'test')), ['a.spec.ts'])
})
