// The pipeline for every adapter: the shared checks, the type-check and the tests in a fixed order,
// then one verdict. The adapter picks the runner (a backend's of backends.mjs, or Playwright), the
// type-check and whether Stryker runs.
// Nothing here grades by opinion: every step is a script's result.
import * as boundary from '../base/boundary.mjs'
import { runActive } from '../base/boundary.mjs'
import * as expected from './checks/expected.mjs'
import * as flaky from './checks/flaky.mjs'
import * as honesty from './checks/honesty.mjs'
import * as mutation from './checks/mutation.mjs'
import { result } from '../base/result.mjs'
import { ownTests } from '../base/keys.mjs'
import * as suite from './checks/suite-honesty.mjs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { runStryker as realRunStryker } from './runners/stryker.mjs'
import { playwrightRunner } from './runners/playwright.mjs'
import { configFor } from './runners/vitest.mjs'
import * as vitestRunners from './runners/vitest.mjs'
import * as pytestRunners from './runners/pytest.mjs'
import * as junitRunners from './runners/junit.mjs'
import * as goRunners from './runners/go.mjs'
import * as dotnetRunners from './runners/dotnet.mjs'
import { genericRunner } from './runners/generic.mjs'
import { BACKENDS } from '../base/backends.mjs'
import { strykerThreshold, strykerTimeoutSeconds, timeoutSecondsOf } from '../base/config.mjs'
import { typeCheck as realTypeCheck } from './types.mjs'
import { dialectFor } from '../base/dialects/index.mjs'
import { adapterOfSpec, asAdapter, isFullstack, specsByAdapter } from '../base/stack.mjs'
import { RUNNERS, isSpecialized, runnerOf } from '../base/runners.mjs'

// Each backend's runner module: <adapter>Runner(root, config), and an optional typeCheck(root, config, specs)
// for a backend whose type-check is no tsc (pytest's typeCheck command).
const RUNNER_MODULES = { vitest: vitestRunners, pytest: pytestRunners, junit: junitRunners, go: goRunners, dotnet: dotnetRunners }

// Stryker mutates JavaScript and TypeScript source under unit tests; it does not run e2e tests. Another
// JavaScript runner of the same kind (runners.unit, runners.e2e) runs through the generic runner instead.
export const ADAPTERS = Object.freeze({
  ...Object.fromEntries(Object.entries(BACKENDS).map(([a, b]) => {
    const mod = RUNNER_MODULES[a]
    return [a, Object.freeze({ runner: mod[`${a}Runner`], stryker: b.stryker, typeCheck: b.typeCheck === 'tsc' ? 'tsc' : mod.typeCheck ?? null })]
  })),
  playwright: Object.freeze({ runner: playwrightRunner, stryker: false, typeCheck: 'tsc' }),
})

/** The types step of a backend with no tsc: its runner's own type-check when it has one, else not applicable. */
function noTsc(adapter, ctx) {
  const own = ADAPTERS[adapter].typeCheck
  if (typeof own === 'function') return specs => own(ctx.root, ctx.config, specs)
  // Compiled stacks compile in the test run: a compile error leaves the tests step not_run there.
  const why = BACKENDS[adapter].compiled ? `${BACKENDS[adapter].label} compiles in the test run` : `no type-check for ${BACKENDS[adapter].language}`
  return async () => result('types', 'pass', `not applicable: ${why}`, [], { applicable: false })
}

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

export function testsStep(run, requested = [], key = null) {
  if (!run.ran) return result('tests', 'not_run', `could not run: ${run.error}`, [], { ran: false })
  // Another ticket's test in the same file never decides this ticket's verdict.
  const tests = ownTests(run.tests, key)
  const others = run.tests.length - tests.length
  const count = s => tests.filter(t => t.status === s).length
  const data = { ran: true, passed: count('passed'), failed: count('failed'), skipped: count('skipped'), ...(others ? { otherTickets: others } : {}) }
  const outside = others ? ` (${others} test(s) outside the ${key} block not counted)` : ''
  // Each test once, for the card's list and the developer log; a long suite keeps only its counts.
  if (tests.length <= LIST_MAX) data.list = tests.map(t => ({ title: t.title, file: t.file, status: t.status, ...(t.message ? { message: t.message } : {}), ...(t.context ? { context: t.context } : {}) }))
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
    const failed = tests.filter(t => t.status === 'failed')
    return result('tests', 'fail', `${data.failed} of ${data.passed + data.failed} tests failed${outside}`, failed.map(t => ({ file: t.file, test: t.title, kind: 'failed', detail: t.message })), data)
  }
  return result('tests', 'pass', `${data.passed} passed${outside}`, [], data)
}

async function mutationStep(specs, key, run, ctx, timeoutMs, whole = false) {
  const per = []
  let redOnly = 0
  for (const spec of specs) {
    const own = ownTests(run.tests, key).filter(t => t.file === spec)
    const baseline = own.filter(t => t.status === 'passed').map(t => t.title)
    // A spec with failing tests and no passing one already shows its assertions can fail (spec §13).
    if (!baseline.length && own.some(t => t.status === 'failed')) { redOnly++; continue }
    let r = await mutation.run({ spec, key, baseline, timeoutMs, whole }, ctx)
    // Nothing eligible in a spec that had passing tests: the pipeline cannot show its assertions bind.
    if (r.status === 'pass' && (r.data?.total ?? 0) === 0 && baseline.length) {
      r = result('mutation', 'not_run', `no assertion in ${spec} that mutation can check (snapshot, chai-style or custom matchers)`,
        [{ file: spec, kind: 'nothing to mutate', detail: `${baseline.length} passing test(s) unchecked` }])
    }
    if (key && r.status === 'not_run' && r.findings.some(f => f.kind === 'no anchor block')) continue
    per.push({ ...r, spec })
  }
  if (!per.length && redOnly) return result('mutation', 'pass', 'skipped: no passing test to mutate (see tests)', [], { killed: 0, survived: 0, errors: 0, total: 0, survivors: [] })
  if (!per.length) return result('mutation', 'not_run', key ? `no ${key} block in the specs` : 'nothing to mutate')
  const sum = k => per.reduce((n, r) => n + (r.data?.[k] ?? 0), 0)
  const data = { killed: sum('killed'), survived: sum('survived'), errors: sum('errors'), total: sum('total'), survivors: per.flatMap(r => r.data?.survivors ?? []) }
  const findings = per.flatMap(r => r.findings)
  if (per.some(r => r.status === 'fail')) return result('mutation', 'fail', `${data.survived} of ${data.total} mutant(s) survived: an assertion that cannot fail`, findings, data)
  const notRun = per.filter(r => r.status === 'not_run')
  if (notRun.length) {
    // Mutants that did run are said too: the message and the counts must agree.
    const why = notRun[0].summary
    const where = notRun.map(r => r.spec).join(', ')
    return result('mutation', 'not_run', data.total ? `${data.killed}/${data.total} mutants killed in the specs that ran; not checked in ${where}: ${why}` : why, findings, { ...data, unchecked: notRun.map(r => ({ spec: r.spec, why: r.summary })) })
  }
  return result('mutation', 'pass', `${data.killed}/${data.total} mutants killed`, findings, data)
}

/** Stryker over the target file: a pass that says "not applicable" when it has nothing to run on. */
export async function strykerStep(target, tests, ctx, timeoutMs, specs = [], key = null) {
  const na = why => result('stryker', 'pass', `not applicable: ${why}`, [], { applicable: false, target })
  if (!target) return na('no target file')
  if (tests.status === 'not_run') return result('stryker', 'not_run', 'skipped: the tests did not run', [], { applicable: true, target })
  // Stryker's first run must be all green: a red bug spec cannot start it, and the red tests already show they can fail.
  if (tests.status === 'fail') return na('the tests are red (see tests)')
  const runStryker = ctx.runStryker ?? realRunStryker
  // One Vitest config per Stryker run: the first spec's (vitest.configs), with the specs that share it.
  // ponytail: specs under two configs mutate against the first group only; one run per config if that bites.
  const vitestConfig = configFor(specs[0] ?? '', ctx.config ?? {})
  const own = specs.filter(s => configFor(s, ctx.config ?? {}) === vitestConfig)
  const r = await runStryker(ctx.root, { target, specs: own, timeoutMs, vitestConfig, key })
  if (!r.ran && r.error === 'Stryker is not installed') return na('Stryker is not installed')
  if (!r.ran) return result('stryker', 'not_run', `could not run: ${r.error}`, [], { applicable: true, target })
  // A survivor no test ran against is no verdict: Stryker found no test to run for it.
  if (!r.killed && !r.timeout && r.survived && r.untested === r.survived) return result('stryker', 'not_run', `Stryker ran no test against the ${r.survived} code change(s) it made`, [], { applicable: true, target, untested: r.untested })
  const threshold = strykerThreshold(ctx.config)
  const data = { applicable: true, target, threshold, score: r.score, killed: r.killed, survived: r.survived, timeout: r.timeout, noCoverage: r.noCoverage }
  if (r.score === null || r.score === undefined) return result('stryker', 'not_run', `Stryker found no code change to try in ${target}`, [], data)
  if (r.score >= threshold) return result('stryker', 'pass', `${r.score}% of code changes caught (bar ${threshold}%)`, [], data)
  return result('stryker', 'fail', `${r.score}% of code changes caught, the bar is ${threshold}%`,
    [{ file: target, kind: 'code changes not caught', detail: `${r.survived ?? 0} survived, ${r.noCoverage ?? 0} not covered` }], data)
}

// A step that throws is a crash, not a verdict: rethrow tagged with the step so the CLI exits 2.
const step = async (name, fn) => {
  try { return await fn() } catch (e) { const err = new Error(String(e?.message ?? e)); err.step = name; throw err }
}

export async function runPipeline(opts, ctx) {
  const specs = [...new Set(opts.specs.map(f => normalizeSpec(ctx.root, f)))]
  if (!isFullstack(ctx.config)) {
    // The card names a generic runner, so its checks are never taken for the specialized ones.
    const runner = runnerOf(ctx.config)
    return { ...withVerdict(await runSide({ ...opts, specs }, ctx)), ...(isSpecialized(runner) ? {} : { runners: [runner] }) }
  }
  const groups = specsByAdapter(ctx.config, ctx.root, specs)
  const sideCtx = adapter => ({
    ...ctx,
    config: asAdapter(ctx.config, adapter),
    dialect: dialectFor(runnerOf(ctx.config, adapter)),
    runTests: ctx.runners?.[adapter] ?? ctx.runTests,
    typeCheck: ctx.typeChecks?.[adapter] ?? ctx.typeCheck,
  })
  const parts = []
  for (const [adapter, list] of groups) {
    // Only Vitest has a Stryker step; the value check reads every side at once (below).
    const own = { ...opts, specs: list, target: ADAPTERS[adapter]?.stryker ? opts.target : null, ticket: groups.length > 1 ? null : opts.ticket }
    parts.push({ adapter, runner: runnerOf(ctx.config, adapter), steps: await runSide(own, sideCtx(adapter), { boundary: !parts.length }) })
  }
  if (groups.length > 1 && opts.ticket) {
    const dialectOf = p => dialectFor(runnerOf(ctx.config, adapterOfSpec(ctx.config, ctx.root, p)))
    parts.push({ adapter: null, steps: [await step('expected', () => expected.run({ specs, key: opts.key ?? null, ticket: opts.ticket, candidates: opts.candidates ?? [], whole: ctx.config.ticketAnchor === 'branch' && Boolean(opts.range) }, { ...ctx, dialectOf }))] })
  }
  return { ...withVerdict(mergeSides(parts)), runners: parts.filter(p => p.adapter).map(p => p.runner ?? p.adapter) }
}

const withVerdict = steps => ({ ...decide(steps), steps })
const LIST_MAX = 40

const ORDER = ['boundary', 'honesty', 'suite-honesty', 'types', 'tests', 'expected', 'mutation', 'flaky', 'stryker']
const rank = { fail: 2, not_run: 1, pass: 0 }

/** Data of one check across sides: counts add up, lists join, the rest is the first side's. */
function mergeData(datas) {
  const out = {}
  for (const d of datas) for (const [k, v] of Object.entries(d ?? {})) {
    if (typeof v === 'number' && typeof out[k] === 'number') out[k] += v
    else if (Array.isArray(v) && Array.isArray(out[k])) out[k] = [...out[k], ...v]
    else if (!(k in out)) out[k] = v
  }
  if (datas.some(d => d?.applicable !== undefined)) out.applicable = datas.some(d => d?.applicable !== false)
  return out
}

// A spec is named by its runner, not its side: a frontend repo's Vitest unit tests are no backend.
const sideLabel = p => { const r = p.runner ?? p.adapter; return RUNNERS[r]?.label ?? BACKENDS[r]?.label ?? null }

/** One step per check from the runners of a fullstack run, each summary and finding named by its runner. */
export function mergeSides(parts) {
  const steps = []
  for (const check of ORDER) {
    const have = parts.flatMap(p => p.steps.filter(s => s.check === check).map(s => ({ side: sideLabel(p), s })))
    if (!have.length) continue
    const named = (side, text) => (side ? `${side}: ${text}` : text)
    const status = have.map(h => h.s.status).reduce((a, b) => (rank[b] > rank[a] ? b : a))
    steps.push({
      check,
      status,
      summary: have.map(h => named(h.side, h.s.summary)).join('; '),
      findings: have.flatMap(h => (h.s.findings ?? []).map(f => (h.side ? { ...f, runner: h.side } : f))),
      data: mergeData(have.map(h => h.s.data)),
    })
  }
  return steps
}

async function runSide({ specs, key = null, range = null, flakyRuns = null, ticket = null, target = null, candidates = [] }, ctx, { boundary: withBoundary = true } = {}) {
  const adapter = ADAPTERS[ctx.config.adapter]
  if (!adapter) throw new Error(`no pipeline for adapter "${ctx.config.adapter}"`)
  const runner = runnerOf(ctx.config)
  const runTests = ctx.runTests ?? (isSpecialized(runner) ? adapter.runner(ctx.root, ctx.config) : genericRunner(ctx.root, ctx.config, runner))
  const typeCheck = ctx.typeCheck ?? (adapter.typeCheck === 'tsc' ? s => realTypeCheck(ctx.root, ctx.config, s) : noTsc(ctx.config.adapter, ctx))
  const c = { ...ctx, runTests }
  // ticketAnchor "branch": a spec changed on the branch with no block of the key counts as a whole (an existing suite that does not name the key).
  const whole = ctx.config.ticketAnchor === 'branch' && Boolean(range)
  const timeoutMs = timeoutSecondsOf(ctx.config) * 1000
  const steps = []
  // Boundary guards a test-writing run: without the run marker there is nothing it can judge.
  if (withBoundary) {
    steps.push(runActive(ctx.root) ? await step('boundary', () => boundary.run({ range }, c))
      : result('boundary', 'pass', 'not applicable: not a test-writing run', [], { applicable: false }))
  }
  steps.push(await step('honesty', () => honesty.run({ specs, range, key }, c)))
  steps.push(await step('suite-honesty', () => suite.run({ specs, key, whole }, c)))
  const types = await step('types', () => typeCheck(specs))
  steps.push(types)
  let run = null
  if (types.status === 'fail') steps.push(result('tests', 'not_run', 'skipped: the specs do not compile', [], { ran: false }))
  else if (types.status === 'not_run') steps.push(result('tests', 'not_run', 'skipped: the type-check could not run', [], { ran: false }))
  else {
    run = await step('tests', () => runTests({ files: specs }))
    steps.push(testsStep(run, specs, key))
  }
  const tests = steps.at(-1)
  if (ticket) steps.push(await step('expected', () => expected.run({ specs, key, ticket, candidates, whole }, c)))
  if (tests.status !== 'not_run') steps.push(await step('mutation', () => mutationStep(specs, key, run, c, timeoutMs, whole)))
  else steps.push(result('mutation', 'not_run', 'skipped: the tests did not run'))
  if (flakyRuns) {
    if (steps.find(s => s.check === 'tests').status === 'not_run') steps.push(result('flaky', 'not_run', 'skipped: the tests did not run'))
    else {
      const f = await step('flaky', () => flaky.run({ specs, runs: flakyRuns, timeoutMs, key, seed: run }, c))
      // Tests that fail every run (the tests step's run included) are the tests step's red result, not a flaky failure.
      steps.push(f.status === 'fail' && !f.findings.some(x => x.kind === 'flaky')
        ? result('flaky', 'pass', `no flaky test; ${f.findings.length} test(s) fail every run (see tests)`, f.findings, f.data) : f)
    }
  }
  // ponytail: Stryker runs under Vitest only; Jest and Mocha have Stryker runners too, add them when a team asks.
  if (adapter.stryker && runner !== 'vitest') steps.push(result('stryker', 'pass', `not applicable: Stryker runs with Vitest only, not ${RUNNERS[runner]?.label ?? runner}`, [], { applicable: false, target }))
  else if (adapter.stryker) steps.push(await step('stryker', () => strykerStep(target, tests, c, strykerTimeoutSeconds(ctx.config) * 1000, specs, key)))
  // A backend Stryker cannot run on still shows the step, as Vitest's does with nothing to mutate.
  else if (BACKENDS[ctx.config.adapter]) steps.push(result('stryker', 'pass', 'not applicable: Stryker is for JavaScript and TypeScript', [], { applicable: false, target }))
  return steps
}
