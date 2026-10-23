// Assertion mutation: does each generated assertion bind the value it checks? Strict mutants of the
// expect statements in baseline-green tests, each run alone from a temp sibling of the spec.
// Any survivor fails (the bar is 100%). The original spec is never written, except in place: a
// compiled language's dialect (mutation.inPlace) cannot run a sibling copy (a duplicate class or
// function), so each mutant goes over the spec itself and its original bytes always come back.
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { result } from '../../base/result.mjs'
import { anchorRange, testMarks } from './suite-honesty.mjs'
import { ungradedTitlesOf } from '../../base/config.mjs'
import { inKeyBlock } from '../../base/keys.mjs'

const TEMP = /^mut-tmp-(\d+)-[a-z0-9]+-[a-z0-9]+-.+$/

// The original basename is kept, so any suffix-based Vitest include (*.test.ts, *.spec.ts) still matches.
export function tempSpecPath(specPath) {
  return resolve(dirname(specPath), `mut-tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${basename(specPath)}`)
}

/** The original spec path of a mutant temp file (other paths come back unchanged). */
export const originalOf = file => file.replace(/(^|\/)mut-tmp-\d+-[a-z0-9]+-[a-z0-9]+-/, '$1')

/** { start, end } of each expect(...).matcher...; statement, nested parens and chains included. */
export function findExpectRanges(src, dialect) {
  // A dialect whose assertions are no call chain (Go's if got != want { t.Errorf(…) }) finds its own.
  if (dialect.mutation.ranges) return dialect.mutation.ranges(src)
  const ranges = []
  const re = new RegExp(dialect.mutation.expectRe.source, 'g')
  let m
  while ((m = re.exec(src))) {
    const start = m.index
    let i = start + m[0].length - 1
    let depth = 0
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '(') depth++
      else if (c === ')') { depth--; if (depth === 0) { i++; break } }
    }
    while (i < src.length && /\s|\./.test(src[i])) {
      if (src[i] === '.') {
        i++
        while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++
        if (src[i] === '(') {
          let d = 0
          for (; i < src.length; i++) {
            if (src[i] === '(') d++
            else if (src[i] === ')') { d--; if (d === 0) { i++; break } }
          }
        }
      } else i++
    }
    if (src[i] === ';') i++
    ranges.push({ start, end: i })
  }
  return ranges
}

export function findTestBlocks(src, dialect) {
  const marks = dialect.mutation.marks ? dialect.mutation.marks(src) : testMarks(src, dialect.mutation.testRe, dialect.mutation.modOf)
  return marks.map((mk, i) => ({ ...mk, start: mk.idx, end: mk.end ?? (i + 1 < marks.length ? marks[i + 1].idx : src.length) }))
}

/** Mutants for the baseline-green tests; null when --key names a block that is not there. */
export function planMutants(src, passedTitles, { key = null, thorough = false, ungraded = null } = {}, dialect) {
  const range = key ? anchorRange(src, key, dialect) : null
  if (key && !range) return null
  return dialect.mutation.plan({ src, passedTitles, range, thorough, ungraded, blocks: findTestBlocks(src, dialect), expects: findExpectRanges(src, dialect) })
}

/** The baseline-green tests in range that got no mutant: nothing shows their assertions can fail. */
export function unmutated(src, passedTitles, mutants, { key = null, ungraded = null } = {}, dialect) {
  const range = key ? anchorRange(src, key, dialect) : null
  const passed = new Set(passedTitles)
  const hit = new Set(mutants.map(m => m.title))
  const left = findTestBlocks(src, dialect).filter(b => (!range || (b.start >= range[0] && b.start < range[1])) && dialect.mutation.eligible(b, passed, ungraded) && !hit.has(b.title))
  return [...new Set(left.map(b => b.title))]
}

export function applyMutant(src, m) {
  return `${src.slice(0, m.start)}${m.replacement}${src.slice(m.end)}`
}

/** Remove temp mutants left by processes that are gone. */
export function sweepStale(dir) {
  let names = []
  try { names = readdirSync(dir) } catch { return 0 }
  let n = 0
  for (const name of names) {
    const m = TEMP.exec(name)
    if (!m || Number(m[1]) === process.pid) continue
    try { process.kill(Number(m[1]), 0); continue } catch (e) { if (e.code === 'EPERM') continue }
    try { unlinkSync(join(dir, name)); n++ } catch {}
  }
  return n
}

export async function run({ spec, key = null, baseline = null, max = null, thorough = false, timeoutMs = 300_000 }, ctx) {
  const specPath = resolve(ctx.root, spec)
  const bytes = readFileSync(specPath)
  const src = bytes.toString('utf8')
  sweepStale(dirname(specPath))
  let passed = baseline
  if (!passed) {
    const b = await ctx.runTests({ files: [spec], timeoutMs })
    if (!b.ran) return result('mutation', 'not_run', `could not run the baseline: ${b.error ?? 'unknown error'}`)
    passed = b.tests.filter(t => t.status === 'passed').map(t => t.title)
  }
  if (!passed.length) return result('mutation', 'not_run', 'baseline had no passing test')
  const ungraded = ungradedTitlesOf(ctx.config, ctx.dialect)
  let mutants = planMutants(src, passed, { key, thorough, ungraded }, ctx.dialect)
  if (mutants === null) return result('mutation', 'not_run', `no ${key} block in ${spec}`, [{ file: spec, kind: 'no anchor block', detail: `no top-level group titled "${key} …"` }])
  const bare = unmutated(src, passed, mutants, { key, ungraded }, ctx.dialect)
  const bareFindings = bare.map(t => ({ file: spec, test: t, kind: 'not mutated', detail: 'passes, but has no assertion mutation can check' }))
  const rank = ctx.dialect.mutation.rank
  mutants = [...mutants].sort((a, b) => rank(a.kind) - rank(b.kind))
  if (max != null && mutants.length > max) mutants = mutants.slice(0, Number(max))

  const inPlace = ctx.dialect.mutation.inPlace === true
  const tmp = inPlace ? specPath : tempSpecPath(specPath)
  const relTmp = inPlace ? spec : join(dirname(spec), basename(tmp))
  // In place, cleaning up is putting the original bytes back: after each mutant, in finally, on a signal.
  const cleanup = inPlace ? () => { try { writeFileSync(specPath, bytes) } catch {} } : () => { try { if (existsSync(tmp)) unlinkSync(tmp) } catch {} }
  const onSignal = () => { cleanup(); process.exit(130) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const outcomes = []
  try {
    for (const m of mutants) {
      try { writeFileSync(tmp, applyMutant(src, m)) } catch (e) {
        return result('mutation', 'not_run', `cannot write the ${inPlace ? 'mutant into the spec' : 'temp mutant next to the spec'}: ${String(e?.message ?? e).split('\n')[0]}`)
      }
      let r
      try { r = await ctx.runTests({ files: [relTmp], testName: m.title, timeoutMs }) } finally { if (inPlace) cleanup() }
      // A namesake in another ticket's block never kills this one's mutant. A result with no describe path
      // is taken as it is: it cannot be in another block.
      const executed = r.ran ? r.tests.filter(t => t.title === m.title && (t.status === 'passed' || t.status === 'failed') && (!key || !t.path?.length || inKeyBlock(t, key))) : []
      if (!executed.length) outcomes.push({ ...m, error: true })
      else outcomes.push({ ...m, killed: executed.some(t => t.status === 'failed') })
    }
  } finally {
    cleanup()
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
  const graded = outcomes.filter(o => !o.error)
  const killed = graded.filter(o => o.killed).length
  const survivedList = graded.filter(o => !o.killed)
  const errors = outcomes.length - graded.length
  const score = graded.length ? Math.round((100 * killed) / graded.length) : null
  const data = { killed, survived: survivedList.length, errors, total: graded.length, score, survivors: survivedList.map(o => o.snippet), unmutated: bare.length }
  if (survivedList.length) {
    return result('mutation', 'fail', `${survivedList.length} of ${graded.length} mutant(s) survived: an assertion that cannot fail`,
      [...survivedList.map(o => ({ file: spec, test: o.title, kind: 'survived', detail: o.snippet })), ...bareFindings], data)
  }
  if (!graded.length && errors) return result('mutation', 'not_run', `${errors} mutant(s) ran no test`, [], data)
  if (score === null) return result('mutation', 'pass', 'no eligible assertions to mutate', [], data)
  // A passing test with no mutant is unchecked, not checked: it never makes the step pass.
  if (bare.length) return result('mutation', 'not_run', `${bare.length} passing test(s) with no assertion mutation can check`, bareFindings, data)
  if (errors) return result('mutation', 'not_run', `${killed} of ${graded.length + errors} mutants killed; ${errors} ran no test`, [], data)
  return result('mutation', 'pass', `${killed}/${graded.length} mutants killed`, [], data)
}
