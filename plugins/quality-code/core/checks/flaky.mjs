// Flaky: re-run the same tests N times with retries off and classify each test from its tally.
// Judged from the runner's per-test results, never from an exit code. Not a proof: a local
// re-run does not reproduce CI load or cross-file interference.
import { result } from './result.mjs'
import { ownTests } from './keys.mjs'

export function classify(passes, fails) {
  if (fails > 0 && passes > 0) return 'flaky'
  if (fails > 0) return 'real'
  return 'green'
}

export function overall(verdicts) {
  if (verdicts.includes('flaky')) return 'flaky'
  if (verdicts.includes('real')) return 'real'
  return 'green'
}

export async function run({ specs, testName, runs = 5, timeoutMs = 300_000, key = null }, ctx) {
  const n = Number(runs)
  if (!Number.isInteger(n) || n < 1) throw new Error('runs must be a whole number of at least 1')
  const perTest = new Map()
  const broken = new Map()
  let executed = 0
  let couldNotRun = 0
  let lastError = ''
  for (let i = 0; i < n; i++) {
    const r = await ctx.runTests({ files: specs, testName, timeoutMs })
    if (!r.ran) { couldNotRun++; lastError = r.error || lastError; continue }
    const ranTests = ownTests((r.tests ?? []).filter(t => t.status === 'passed' || t.status === 'failed'), key)
    if (!ranTests.length) continue
    executed++
    for (const t of ranTests) {
      // The describe titles keep same-named tests in different groups apart.
      const name = `${t.file} > ${[...(t.path ?? []), t.title].join(' > ')}`
      const row = perTest.get(name) ?? { pass: 0, fail: 0 }
      row[t.status === 'passed' ? 'pass' : 'fail']++
      // The first failure says why, as the old flaky check printed it.
      if (t.status === 'failed' && !row.message && t.message) row.message = t.message
      perTest.set(name, row)
    }
    for (const b of r.broken ?? []) broken.set(b.file, b.message)
  }
  const brokenList = [...broken].map(([file, message]) => ({ file, message }))
  const base = { runs: n, executed, tests: [], broken: brokenList }
  if (!executed) {
    return result('flaky', 'not_run', couldNotRun
      ? `could not run: ${lastError || 'a build, config or environment error, not a code failure'}`
      : 'no tests ran: nothing matched, or every match is skipped', [], base)
  }
  const tests = [...perTest].map(([title, r]) => ({ title, pass: r.pass, fail: r.fail, verdict: classify(r.pass, r.fail), ...(r.message ? { message: r.message } : {}) }))
  const data = { ...base, tests }
  const v = overall(tests.map(t => t.verdict))
  const named = verdict => tests.filter(t => t.verdict === verdict).map(t => ({ test: t.title, kind: verdict, detail: `${t.pass} pass / ${t.fail} fail${t.message ? `; first failure: ${t.message}` : ''}` }))
  if (v === 'flaky') return result('flaky', 'fail', `flaky: ${named('flaky').length} test(s) passed and failed on the same code`, [...named('flaky'), ...named('real')], data)
  if (v === 'real') return result('flaky', 'fail', `real: ${named('real').length} test(s) failed every run`, named('real'), data)
  if (brokenList.length) return result('flaky', 'not_run', `${brokenList.length} file(s) never ran (import or build error)`, brokenList.map(b => ({ file: b.file, kind: 'never ran', detail: b.message })), data)
  if (executed !== n) return result('flaky', 'not_run', `only ${executed} of ${n} runs executed`, [], data)
  return result('flaky', 'pass', `green: every test passed all ${executed} run(s)`, [], data)
}
