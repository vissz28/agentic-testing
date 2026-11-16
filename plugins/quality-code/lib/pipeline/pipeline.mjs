// Runs the checks, type-check and tests in a fixed order and folds them into one verdict.
import * as boundary from './boundary.mjs'
import { runActive } from './boundary.mjs'
import * as expected from './checks/expected.mjs'
import * as flaky from './checks/flaky.mjs'
import * as honesty from './checks/honesty.mjs'
import * as mutation from './checks/mutation.mjs'
import { result } from './result.mjs'
import { keyPattern, ownTests } from '../config/keys.mjs'
import * as suite from './checks/suite-honesty.mjs'
import { anchorRange } from './checks/suite-honesty.mjs'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { localToForwardSlashes } from '../core/text.mjs'
import { functionLines as realFunctionLines, runStryker as realRunStryker } from './runners/stryker.mjs'
import { playwrightRunner } from './runners/playwright.mjs'
import { configFor } from './runners/vitest.mjs'
import * as vitestRunners from './runners/vitest.mjs'
import * as pytestRunners from './runners/pytest.mjs'
import * as junitRunners from './runners/junit.mjs'
import * as goRunners from './runners/go.mjs'
import * as dotnetRunners from './runners/dotnet.mjs'
import { genericRunner } from './runners/generic.mjs'
import { BACKENDS } from '../stacks/backends.mjs'
import { maxMutantsOf, strykerThreshold, strykerTimeoutSeconds, timeoutSecondsOf } from '../config/config.mjs'
import { typeCheck as realTypeCheck } from './types.mjs'
import { dialectFor } from '../stacks/dialects/index.mjs'
import { adapterOfSpec, asAdapter, isFullstack, specsByAdapter } from '../stacks/stack.mjs'
import { RUNNERS, isSpecialized, runnerOf } from '../stacks/runners.mjs'

// Each exports <adapter>Runner(root, config), plus typeCheck(root, config, specs) when it isn't tsc.
const RUNNER_MODULES = { vitest: vitestRunners, pytest: pytestRunners, junit: junitRunners, go: goRunners, dotnet: dotnetRunners }

// Stryker is unit-only (JS/TS). Other JS runners (runners.unit, runners.e2e) go through the generic runner.
export const ADAPTERS = Object.freeze({
  ...Object.fromEntries(Object.entries(BACKENDS).map(([a, b]) => {
    const mod = RUNNER_MODULES[a]
    return [a, Object.freeze({ runner: mod[`${a}Runner`], stryker: b.stryker, typeCheck: b.typeCheck === 'tsc' ? 'tsc' : mod.typeCheck ?? null })]
  })),
  playwright: Object.freeze({ runner: playwrightRunner, stryker: false, typeCheck: 'tsc' }),
})

/** No tsc: use the runner's own type-check, else mark the step not applicable. */
function noTsc(adapter, ctx) {
  const own = ADAPTERS[adapter].typeCheck
  if (typeof own === 'function') return specs => own(ctx.root, ctx.config, specs)
  // Compiled stacks fail to compile in the test run, which leaves the tests step not_run.
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

// Root-relative, forward slashes, no leading './'.
export function normalizeSpec(root, spec) {
  const rel = isAbsolute(spec) ? relative(root, spec) : relative(root, resolve(root, spec))
  return localToForwardSlashes(rel)
}

export function testsStep(run, requested = [], key = null) {
  if (!run.ran) return result('tests', 'not_run', `could not run: ${run.error}`, [], { ran: false })
  // Other tickets' tests in the same file don't count toward this verdict.
  const tests = ownTests(run.tests, key)
  const others = run.tests.length - tests.length
  const count = s => tests.filter(t => t.status === s).length
  const data = { ran: true, passed: count('passed'), failed: count('failed'), skipped: count('skipped'), ...(others ? { otherTickets: others } : {}) }
  const outside = others ? ` (${others} test(s) outside the ${key} block not counted)` : ''
  // Long suites keep only the counts.
  if (tests.length <= LIST_MAX) data.list = tests.map(t => ({ title: t.title, file: t.file, status: t.status, ...(t.message ? { message: t.message } : {}), ...(t.context ? { context: t.context } : {}) }))
  if ((run.broken ?? []).length) {
    const b = run.broken[0]
    return result('tests', 'not_run', `${run.broken.length} file(s) never ran: ${b.file}: ${b.message}`, run.broken.map(x => ({ file: x.file, kind: 'never ran', detail: x.message })), data)
  }
  // Requested, no results and not reported broken: it never ran.
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
    // No tests for this key: the spec belongs to another ticket, skip it.
    if (key && !own.length) continue
    const baseline = own.filter(t => t.status === 'passed').map(t => t.title)
    // Only failing tests: the assertions already proved they can fail.
    if (!baseline.length && own.some(t => t.status === 'failed')) { redOnly++; continue }
    let r = await mutation.run({ spec, key, baseline, max: maxMutantsOf(ctx.config), timeoutMs, whole }, ctx)
    // Passing tests but nothing to mutate: we can't prove the assertions bind.
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
  const capped = sum('capped')
  const data = { killed: sum('killed'), survived: sum('survived'), errors: sum('errors'), total: sum('total'), survivors: per.flatMap(r => r.data?.survivors ?? []), ...(capped ? { capped } : {}) }
  const findings = per.flatMap(r => r.findings)
  if (per.some(r => r.status === 'fail')) return result('mutation', 'fail', `${data.survived} of ${data.total} mutant(s) survived: an assertion that cannot fail`, findings, data)
  const notRun = per.filter(r => r.status === 'not_run')
  if (notRun.length) {
    // Report the mutants that did run so the message matches the counts.
    const why = notRun[0].summary
    const where = notRun.map(r => r.spec).join(', ')
    return result('mutation', 'not_run', data.total ? `${data.killed}/${data.total} mutants killed in the specs that ran; not checked in ${where}: ${why}` : why, findings, { ...data, unchecked: notRun.map(r => ({ spec: r.spec, why: r.summary })) })
  }
  return result('mutation', 'pass', `${data.killed}/${data.total} mutants killed${capped ? `; ${capped} more left out by maxMutants` : ''}`, findings, data)
}

export async function strykerStep(target, tests, ctx, timeoutMs, specs = [], key = null, functions = []) {
  const na = why => result('stryker', 'pass', `not applicable: ${why}`, [], { applicable: false, target })
  if (!target) return na('no target file')
  if (tests.status === 'not_run') return result('stryker', 'not_run', 'skipped: the tests did not run', [], { applicable: true, target })
  // Stryker needs a green first run; red tests already show they can fail.
  if (tests.status === 'fail') return na('the tests are red (see tests)')
  const runStryker = ctx.runStryker ?? realRunStryker
  // One Vitest config per Stryker run: the first spec's, plus the specs that share it.
  // ponytail: specs under two configs mutate against the first group only; one run per config if that bites.
  const vitestConfig = configFor(specs[0] ?? '', ctx.config ?? {})
  const own = specs.filter(s => configFor(s, ctx.config ?? {}) === vitestConfig)
  // Mutate only the named functions; if none are found, the whole file (and say so).
  const spans = functions.length ? (ctx.functionLines ?? realFunctionLines)(ctx.root, target, functions) ?? [] : []
  const missing = functions.filter(f => !spans.some(x => x.name === f))
  const mutate = spans.length ? spans.map(x => `${target}:${x.start}-${x.end}`) : null
  const where = spans.length ? ` in ${spans.map(x => x.name).join(', ')}` : ''
  const note = missing.length ? ` (${missing.join(', ')} not found in ${target}: ${spans.length ? 'left out' : 'the whole file'})` : ''
  const scope = functions.length ? { scope: { functions: spans.map(x => x.name), lines: spans.map(x => `${x.start}-${x.end}`), missing } } : {}
  const r = await runStryker(ctx.root, { target, specs: own, timeoutMs, vitestConfig, key, ...(mutate ? { mutate } : {}) })
  if (!r.ran && r.error === 'Stryker is not installed') return na('Stryker is not installed')
  if (!r.ran) return result('stryker', 'not_run', `could not run: ${r.error}`, [], { applicable: true, target })
  // Every survivor untested: Stryker found no test to run, so no verdict.
  if (!r.killed && !r.timeout && r.survived && r.untested === r.survived) return result('stryker', 'not_run', `Stryker ran no test against the ${r.survived} code change(s) it made`, [], { applicable: true, target, untested: r.untested })
  const threshold = strykerThreshold(ctx.config)
  const data = { applicable: true, target, threshold, score: r.score, killed: r.killed, survived: r.survived, timeout: r.timeout, noCoverage: r.noCoverage, ...scope }
  if ((r.score === null || r.score === undefined) && r.noCoverage) return result('stryker', 'not_run', `the tests run none of the code in ${target} (${r.noCoverage} code change(s), none covered)`, [], data)
  if (r.score === null || r.score === undefined) return result('stryker', 'not_run', `Stryker found no code change to try in ${target}`, [], data)
  // Score covers only code the tests run; uncovered code is reported, not judged.
  const rest = r.noCoverage ? `; ${r.noCoverage} in code these tests do not run` : ''
  if (r.score >= threshold) return result('stryker', 'pass', `${r.score}% of code changes caught${where} (bar ${threshold}%)${rest}${note}`, [], data)
  return result('stryker', 'fail', `${r.score}% of code changes caught${where}, the bar is ${threshold}%${rest}${note}`,
    [{ file: target, kind: 'code changes not caught', detail: `${r.survived ?? 0} survived in the code the tests run` }], data)
}

// A throwing step is a crash, not a verdict: tag it with the step so the CLI exits 2.
const step = async (name, fn) => {
  try { return await fn() } catch (e) { const err = new Error(String(e?.message ?? e), { cause: e }); err.step = name; throw err }
}

export async function runPipeline(opts, ctx) {
  const specs = [...new Set(opts.specs.map(f => normalizeSpec(ctx.root, f)))]
  if (!isFullstack(ctx.config)) {
    // Name a generic runner on the card so it isn't mistaken for a specialized one.
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
    // Only Vitest has a Stryker step; the expected check runs once across all sides, below.
    const own = { ...opts, specs: list, target: ADAPTERS[adapter]?.stryker ? opts.target : null, ticket: groups.length > 1 ? null : opts.ticket, multi: groups.length > 1 }
    parts.push({ adapter, runner: runnerOf(ctx.config, adapter), steps: await runSide(own, sideCtx(adapter), { boundary: !parts.length }) })
  }
  if (groups.length > 1 && (opts.ticket || opts.key)) {
    const dialectOf = p => dialectFor(runnerOf(ctx.config, adapterOfSpec(ctx.config, ctx.root, p)))
    const wholeBranch = ctx.config.ticketAnchor === 'branch' && Boolean(opts.range)
    if (!wholeBranch && lacksAnchor(specs, opts.key, ctx, dialectOf)) parts.push({ adapter: null, steps: [noAnchorStep()] })
    else if (opts.ticket) parts.push({ adapter: null, steps: [await step('expected', () => expected.run({ specs, key: opts.key ?? null, ticket: opts.ticket, candidates: opts.candidates ?? [], whole: ctx.config.ticketAnchor === 'branch' && Boolean(opts.range) }, { ...ctx, dialectOf }))] })
  }
  return { ...withVerdict(mergeSides(parts)), runners: parts.filter(p => p.adapter).map(p => p.runner ?? p.adapter) }
}

const NO_ANCHOR = 'no ticket anchor: expected values not compared'

/** A key is given but no spec mentions it: an existing spec checked on its own. */
function lacksAnchor(specs, key, ctx, dialectOf = () => ctx.dialect) {
  if (!key || !specs.length) return false
  return specs.every(p => {
    let src
    try { src = readFileSync(resolve(ctx.root, p), 'utf8') } catch { return false }
    const d = dialectOf(p)
    if (!d) return false
    try { if (anchorRange(src, key, d)) return false } catch { return false }
    return !keyPattern(key).test(src)
  })
}
const noAnchorStep = () => result('expected', 'pass', NO_ANCHOR, [], { applicable: false, noAnchor: true })

const withVerdict = steps => ({ ...decide(steps), steps })
const LIST_MAX = 40

const ORDER = ['boundary', 'honesty', 'suite-honesty', 'types', 'tests', 'expected', 'mutation', 'flaky', 'stryker']
const rank = { fail: 2, not_run: 1, pass: 0 }

/** Numbers add, arrays concat, anything else keeps the first side's value. */
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

// Label by runner, not side: a frontend repo's Vitest unit tests aren't a backend.
const sideLabel = p => { const r = p.runner ?? p.adapter; return RUNNERS[r]?.label ?? BACKENDS[r]?.label ?? null }

/** Fullstack: one step per check, summaries and findings prefixed by runner. */
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

async function runSide({ specs, key = null, range = null, flakyRuns = null, ticket = null, target = null, functions = [], candidates = [], mutation: mutate = true, multi = false }, ctx, { boundary: withBoundary = true } = {}) {
  const adapter = ADAPTERS[ctx.config.adapter]
  if (!adapter) throw new Error(`no pipeline for adapter "${ctx.config.adapter}"`)
  const runner = runnerOf(ctx.config)
  const runTests = ctx.runTests ?? (isSpecialized(runner) ? adapter.runner(ctx.root, ctx.config) : genericRunner(ctx.root, ctx.config, runner))
  const typeCheck = ctx.typeCheck ?? (adapter.typeCheck === 'tsc' ? s => realTypeCheck(ctx.root, ctx.config, s, { range }) : noTsc(ctx.config.adapter, ctx))
  const c = { ...ctx, runTests }
  // ticketAnchor "branch": a changed spec without a key block is checked as a whole.
  let whole = ctx.config.ticketAnchor === 'branch' && Boolean(range)
  // Explicit spec that names no ticket: check it whole and skip the expected-value compare.
  const noAnchor = !whole && lacksAnchor(specs, key, ctx)
  if (noAnchor) whole = true
  const timeoutMs = timeoutSecondsOf(ctx.config) * 1000
  const steps = []
  // Boundary only means something inside a test-writing run (run marker present).
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
  if (noAnchor) { if (!multi) steps.push(noAnchorStep()) }
  else if (ticket) steps.push(await step('expected', () => expected.run({ specs, key, ticket, candidates, whole }, c)))
  // Whole-suite CI runs pass --no-mutation: it's the slow step, kept for changed specs.
  if (!mutate) steps.push(result('mutation', 'pass', 'not applicable: left out of this run (--no-mutation)', [], { applicable: false }))
  else if (tests.status !== 'not_run') steps.push(await step('mutation', () => mutationStep(specs, key, run, c, timeoutMs, whole)))
  else steps.push(result('mutation', 'not_run', 'skipped: the tests did not run'))
  if (flakyRuns) {
    if (steps.find(s => s.check === 'tests').status === 'not_run') steps.push(result('flaky', 'not_run', 'skipped: the tests did not run'))
    else {
      const f = await step('flaky', () => flaky.run({ specs, runs: flakyRuns, timeoutMs, key, seed: run }, c))
      // Failing every run is a red test, not a flaky one.
      steps.push(f.status === 'fail' && !f.findings.some(x => x.kind === 'flaky')
        ? result('flaky', 'pass', `no flaky test; ${f.findings.length} test(s) fail every run (see tests)`, f.findings, f.data) : f)
    }
  }
  // ponytail: Stryker runs under Vitest only; Jest and Mocha have Stryker runners too, add them when a team asks.
  if (adapter.stryker && runner !== 'vitest') steps.push(result('stryker', 'pass', `not applicable: Stryker runs with Vitest only, not ${RUNNERS[runner]?.label ?? runner}`, [], { applicable: false, target }))
  else if (adapter.stryker) steps.push(await step('stryker', () => strykerStep(target, tests, c, strykerTimeoutSeconds(ctx.config) * 1000, specs, key, functions)))
  // Non-JS backends still show the step, as not applicable.
  else if (BACKENDS[ctx.config.adapter]) steps.push(result('stryker', 'pass', 'not applicable: Stryker is for JavaScript and TypeScript', [], { applicable: false, target }))
  return steps
}
