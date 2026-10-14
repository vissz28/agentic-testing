// The Vitest pipeline: the shared checks, the type-check and the tests in a fixed order, then one
// verdict. Nothing here grades by opinion: every step is a script's result.
import * as boundary from '../checks/boundary.mjs'
import * as flaky from '../checks/flaky.mjs'
import * as honesty from '../checks/honesty.mjs'
import * as mutation from '../checks/mutation.mjs'
import { result } from '../checks/result.mjs'
import * as suite from '../checks/suite-honesty.mjs'
import { vitestRunner } from '../runners/vitest.mjs'
import { typeCheck as realTypeCheck } from './types.mjs'

export function decide(steps) {
  const failed = steps.find(s => s.status === 'fail' && s.check !== 'tests')
  if (failed) return { verdict: 'checks_failed', decidedBy: failed.check }
  const notRun = steps.find(s => s.status === 'not_run')
  if (notRun) return { verdict: 'not_verified', decidedBy: notRun.check }
  if (steps.some(s => s.check === 'tests' && s.status === 'fail')) return { verdict: 'tests_red', decidedBy: 'tests' }
  return { verdict: 'green', decidedBy: null }
}

export function testsStep(run) {
  if (!run.ran) return result('tests', 'not_run', `could not run: ${run.error}`, [], { ran: false })
  const count = s => run.tests.filter(t => t.status === s).length
  const data = { ran: true, passed: count('passed'), failed: count('failed'), skipped: count('skipped') }
  if ((run.broken ?? []).length) {
    const b = run.broken[0]
    return result('tests', 'not_run', `${run.broken.length} file(s) never ran: ${b.file}: ${b.message}`, run.broken.map(x => ({ file: x.file, kind: 'never ran', detail: x.message })), data)
  }
  if (!data.passed && !data.failed) return result('tests', 'not_run', 'no tests ran', [], data)
  if (data.failed) {
    const failed = run.tests.filter(t => t.status === 'failed')
    return result('tests', 'fail', `${data.failed} of ${data.passed + data.failed} tests failed`, failed.map(t => ({ file: t.file, test: t.title, kind: 'failed', detail: t.message })), data)
  }
  return result('tests', 'pass', `${data.passed} passed`, [], data)
}

async function mutationStep(specs, key, run, ctx) {
  const per = []
  for (const spec of specs) {
    const baseline = run.tests.filter(t => t.file === spec && t.status === 'passed').map(t => t.title)
    const r = await mutation.run({ spec, key, baseline }, ctx)
    if (key && r.status === 'not_run' && r.findings.some(f => f.kind === 'no anchor block')) continue
    per.push(r)
  }
  if (!per.length) return result('mutation', 'not_run', key ? `no ${key} block in the specs` : 'nothing to mutate')
  const sum = k => per.reduce((n, r) => n + (r.data?.[k] ?? 0), 0)
  const data = { killed: sum('killed'), survived: sum('survived'), errors: sum('errors'), total: sum('total'), survivors: per.flatMap(r => r.data?.survivors ?? []) }
  const findings = per.flatMap(r => r.findings)
  if (per.some(r => r.status === 'fail')) return result('mutation', 'fail', `${data.survived} of ${data.total} mutant(s) survived: an assertion that cannot fail`, findings, data)
  const nr = per.find(r => r.status === 'not_run')
  if (nr) return result('mutation', 'not_run', nr.summary, findings, data)
  return result('mutation', 'pass', data.total ? `${data.killed}/${data.total} mutants killed` : 'no eligible assertions to mutate', findings, data)
}

export async function runPipeline({ specs, key = null, range = null, flakyRuns = null }, ctx) {
  const runTests = ctx.runTests ?? vitestRunner(ctx.root, ctx.config)
  const typeCheck = ctx.typeCheck ?? (s => realTypeCheck(ctx.root, ctx.config, s))
  const c = { ...ctx, runTests }
  // A step that throws is a crash, not a verdict: rethrow tagged with the step so the CLI exits 2.
  const step = async (name, fn) => {
    try { return await fn() } catch (e) { const err = new Error(String(e?.message ?? e)); err.step = name; throw err }
  }
  const steps = []
  steps.push(await step('boundary', () => boundary.run({ range }, c)))
  steps.push(await step('honesty', () => honesty.run({ specs, range }, c)))
  steps.push(await step('suite-honesty', () => suite.run({ specs, key }, c)))
  const types = await step('types', () => typeCheck(specs))
  steps.push(types)
  let run = null
  if (types.status === 'fail') steps.push(result('tests', 'not_run', 'skipped: the specs do not compile', [], { ran: false }))
  else if (types.status === 'not_run') steps.push(result('tests', 'not_run', 'skipped: the type-check could not run', [], { ran: false }))
  else {
    run = await step('tests', () => runTests({ files: specs }))
    steps.push(testsStep(run))
  }
  if (run?.ran) steps.push(await step('mutation', () => mutationStep(specs, key, run, c)))
  else steps.push(result('mutation', 'not_run', 'skipped: the tests did not run'))
  if (flakyRuns) steps.push(await step('flaky', () => flaky.run({ specs, runs: flakyRuns }, c)))
  return { ...decide(steps), steps }
}
