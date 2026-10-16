// The pipeline for both adapters: the shared checks, the type-check and the tests in a fixed order,
// then one verdict. The adapter picks the runner (Vitest or Playwright) and whether Stryker runs.
// Nothing here grades by opinion: every step is a script's result.
import * as boundary from '../checks/boundary.mjs'
import { runActive } from '../checks/boundary.mjs'
import * as expected from '../checks/expected.mjs'
import * as flaky from '../checks/flaky.mjs'
import * as honesty from '../checks/honesty.mjs'
import * as mutation from '../checks/mutation.mjs'
import { result } from '../checks/result.mjs'
import * as suite from '../checks/suite-honesty.mjs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { runStryker as realRunStryker } from '../runners/stryker.mjs'
import { playwrightRunner } from '../runners/playwright.mjs'
import { vitestRunner } from '../runners/vitest.mjs'
import { strykerThreshold, timeoutSecondsOf } from '../config.mjs'
import { typeCheck as realTypeCheck } from './types.mjs'

// Stryker mutates source code under unit tests; it does not run e2e tests.
export const ADAPTERS = Object.freeze({
  vitest: Object.freeze({ runner: vitestRunner, stryker: true }),
  playwright: Object.freeze({ runner: playwrightRunner, stryker: false }),
})

export function decide(steps) {
  const failed = steps.find(s => s.status === 'fail' && s.check !== 'tests')
  if (failed) return { verdict: 'checks_failed', decidedBy: failed.check }
  const notRun = steps.find(s => s.status === 'not_run')
  if (notRun) return { verdict: 'not_verified', decidedBy: notRun.check }
  if (steps.some(s => s.check === 'tests' && s.status === 'fail')) return { verdict: 'tests_red', decidedBy: 'tests' }
  return { verdict: 'green', decidedBy: null }
}

// One spelling per spec: root-relative, forward slashes, no leading './'.
export function normalizeSpec(root, spec) {
  const rel = isAbsolute(spec) ? relative(root, spec) : relative(root, resolve(root, spec))
  return rel.split(sep).join('/')
}

export function testsStep(run, requested = []) {
  if (!run.ran) return result('tests', 'not_run', `could not run: ${run.error}`, [], { ran: false })
  const count = s => run.tests.filter(t => t.status === s).length
  const data = { ran: true, passed: count('passed'), failed: count('failed'), skipped: count('skipped') }
  if ((run.broken ?? []).length) {
    const b = run.broken[0]
    return result('tests', 'not_run', `${run.broken.length} file(s) never ran: ${b.file}: ${b.message}`, run.broken.map(x => ({ file: x.file, kind: 'never ran', detail: x.message })), data)
  }
  // A requested spec with no result and not reported broken never ran (spec §5).
  const seen = new Set([...run.tests.map(t => t.file), ...(run.broken ?? []).map(b => b.file)])
  const missing = requested.filter(f => !seen.has(f))
  if (missing.length) return result('tests', 'not_run', `${missing.length} file(s) never ran: ${missing[0]}`, missing.map(f => ({ file: f, kind: 'never ran', detail: f })), data)
  if (!data.passed && !data.failed) return result('tests', 'not_run', 'no tests ran', [], data)
  if (data.failed) {
    const failed = run.tests.filter(t => t.status === 'failed')
    return result('tests', 'fail', `${data.failed} of ${data.passed + data.failed} tests failed`, failed.map(t => ({ file: t.file, test: t.title, kind: 'failed', detail: t.message })), data)
  }
  return result('tests', 'pass', `${data.passed} passed`, [], data)
}

async function mutationStep(specs, key, run, ctx, timeoutMs) {
  const per = []
  let redOnly = 0
  for (const spec of specs) {
    const own = run.tests.filter(t => t.file === spec)
    const baseline = own.filter(t => t.status === 'passed').map(t => t.title)
    // A spec with failing tests and no passing one already shows its assertions can fail (spec §13).
    if (!baseline.length && own.some(t => t.status === 'failed')) { redOnly++; continue }
    let r = await mutation.run({ spec, key, baseline, timeoutMs }, ctx)
    // Nothing eligible in a spec that had passing tests: the pipeline cannot show its assertions bind.
    if (r.status === 'pass' && (r.data?.total ?? 0) === 0 && baseline.length) {
      r = result('mutation', 'not_run', `no assertion in ${spec} that mutation can check (snapshot, chai-style or custom matchers)`,
        [{ file: spec, kind: 'nothing to mutate', detail: `${baseline.length} passing test(s) unchecked` }])
    }
    if (key && r.status === 'not_run' && r.findings.some(f => f.kind === 'no anchor block')) continue
    per.push(r)
  }
  if (!per.length && redOnly) return result('mutation', 'pass', 'skipped: no passing test to mutate (see tests)', [], { killed: 0, survived: 0, errors: 0, total: 0, survivors: [] })
  if (!per.length) return result('mutation', 'not_run', key ? `no ${key} block in the specs` : 'nothing to mutate')
  const sum = k => per.reduce((n, r) => n + (r.data?.[k] ?? 0), 0)
  const data = { killed: sum('killed'), survived: sum('survived'), errors: sum('errors'), total: sum('total'), survivors: per.flatMap(r => r.data?.survivors ?? []) }
  const findings = per.flatMap(r => r.findings)
  if (per.some(r => r.status === 'fail')) return result('mutation', 'fail', `${data.survived} of ${data.total} mutant(s) survived: an assertion that cannot fail`, findings, data)
  const nr = per.find(r => r.status === 'not_run')
  if (nr) return result('mutation', 'not_run', nr.summary, findings, data)
  return result('mutation', 'pass', `${data.killed}/${data.total} mutants killed`, findings, data)
}

/** Stryker over the target file: a pass that says "not applicable" when it has nothing to run on. */
export async function strykerStep(target, tests, ctx, timeoutMs, specs = []) {
  const na = why => result('stryker', 'pass', `not applicable: ${why}`, [], { applicable: false, target })
  if (!target) return na('no target file')
  if (tests.status === 'not_run') return result('stryker', 'not_run', 'skipped: the tests did not run', [], { applicable: true, target })
  // Stryker's first run must be all green: a red bug spec cannot start it, and the red tests already show they can fail.
  if (tests.status === 'fail') return na('the tests are red (see tests)')
  const runStryker = ctx.runStryker ?? realRunStryker
  const r = await runStryker(ctx.root, { target, specs, timeoutMs })
  if (!r.ran && r.error === 'Stryker is not installed') return na('Stryker is not installed')
  if (!r.ran) return result('stryker', 'not_run', `could not run: ${r.error}`, [], { applicable: true, target })
  const threshold = strykerThreshold(ctx.config)
  const data = { applicable: true, target, threshold, score: r.score, killed: r.killed, survived: r.survived, timeout: r.timeout, noCoverage: r.noCoverage }
  if (r.score === null || r.score === undefined) return result('stryker', 'not_run', `Stryker found no code change to try in ${target}`, [], data)
  if (r.score >= threshold) return result('stryker', 'pass', `${r.score}% of code changes caught (bar ${threshold}%)`, [], data)
  return result('stryker', 'fail', `${r.score}% of code changes caught, the bar is ${threshold}%`,
    [{ file: target, kind: 'code changes not caught', detail: `${r.survived ?? 0} survived, ${r.noCoverage ?? 0} not covered` }], data)
}

export async function runPipeline({ specs: rawSpecs, key = null, range = null, flakyRuns = null, ticket = null, target = null }, ctx) {
  const adapter = ADAPTERS[ctx.config.adapter]
  if (!adapter) throw new Error(`no pipeline for adapter "${ctx.config.adapter}"`)
  const runTests = ctx.runTests ?? adapter.runner(ctx.root, ctx.config)
  const typeCheck = ctx.typeCheck ?? (s => realTypeCheck(ctx.root, ctx.config, s))
  const c = { ...ctx, runTests }
  const specs = [...new Set(rawSpecs.map(f => normalizeSpec(ctx.root, f)))]
  const timeoutMs = timeoutSecondsOf(ctx.config) * 1000
  // A step that throws is a crash, not a verdict: rethrow tagged with the step so the CLI exits 2.
  const step = async (name, fn) => {
    try { return await fn() } catch (e) { const err = new Error(String(e?.message ?? e)); err.step = name; throw err }
  }
  const steps = []
  // Boundary guards a test-writing run: without the run marker there is nothing it can judge.
  if (runActive(ctx.root)) steps.push(await step('boundary', () => boundary.run({ range }, c)))
  else steps.push(result('boundary', 'pass', 'not applicable: not a test-writing run', [], { applicable: false }))
  steps.push(await step('honesty', () => honesty.run({ specs, range }, c)))
  steps.push(await step('suite-honesty', () => suite.run({ specs, key }, c)))
  const types = await step('types', () => typeCheck(specs))
  steps.push(types)
  let run = null
  if (types.status === 'fail') steps.push(result('tests', 'not_run', 'skipped: the specs do not compile', [], { ran: false }))
  else if (types.status === 'not_run') steps.push(result('tests', 'not_run', 'skipped: the type-check could not run', [], { ran: false }))
  else {
    run = await step('tests', () => runTests({ files: specs }))
    steps.push(testsStep(run, specs))
  }
  const tests = steps.at(-1)
  if (ticket) steps.push(await step('expected', () => expected.run({ specs, key, ticket }, c)))
  if (tests.status !== 'not_run') steps.push(await step('mutation', () => mutationStep(specs, key, run, c, timeoutMs)))
  else steps.push(result('mutation', 'not_run', 'skipped: the tests did not run'))
  if (flakyRuns) {
    if (steps.find(s => s.check === 'tests').status === 'not_run') steps.push(result('flaky', 'not_run', 'skipped: the tests did not run'))
    else {
      const f = await step('flaky', () => flaky.run({ specs, runs: flakyRuns, timeoutMs }, c))
      // Tests that fail every run are the tests step's red result, not a flaky failure.
      steps.push(f.status === 'fail' && !f.findings.some(x => x.kind === 'flaky')
        ? result('flaky', 'pass', `no flaky test; ${f.findings.length} test(s) fail every run (see tests)`, f.findings, f.data) : f)
    }
  }
  if (adapter.stryker) steps.push(await step('stryker', () => strykerStep(target, tests, c, timeoutMs, specs)))
  return { ...decide(steps), steps }
}
