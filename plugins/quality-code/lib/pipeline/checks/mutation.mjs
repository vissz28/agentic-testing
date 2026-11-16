// Assertion mutation: mutate each expect in green tests and run it from a temp copy; any survivor fails.
// Compiled dialects (mutation.inPlace) can't run a sibling copy (duplicate class), so they mutate the spec and restore its bytes.
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, posix, resolve } from 'node:path'
import { result } from '../result.mjs'
import { anchorRange, testMarks } from './suite-honesty.mjs'
import { ungradedTitlesOf } from '../../config/config.mjs'
import { inKeyBlock } from '../../config/keys.mjs'
import { escapeRegExp } from '../../core/text.mjs'

const TEMP = /^mut-tmp-(\d+)-[a-z0-9]+-[a-z0-9]+-.+$/

// Keep the basename so suffix-based includes (*.test.ts, *.spec.ts) still match.
export function tempSpecPath(specPath) {
  return resolve(dirname(specPath), `mut-tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${basename(specPath)}`)
}

export const originalOf = file => file.replace(/(^|\/)mut-tmp-\d+-[a-z0-9]+-[a-z0-9]+-/, '$1')

/** Full expect(...).matcher(...); statements, nested parens and chains included. */
export function findExpectRanges(src, dialect) {
  // Non-chain assertions (Go's if got != want { t.Errorf(…) }) need the dialect's own finder.
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

/** null when --key names a block that isn't there. */
export function planMutants(src, passedTitles, { key = null, ungraded = null, whole = false } = {}, dialect) {
  const range = key ? anchorRange(src, key, dialect, { whole }) : null
  if (key && !range) return null
  return dialect.mutation.plan({ src, passedTitles, range, ungraded, blocks: findTestBlocks(src, dialect), expects: findExpectRanges(src, dialect) })
}

/** Green tests with no mutant: nothing shows their assertions can fail. */
export function unmutated(src, passedTitles, mutants, { key = null, ungraded = null, whole = false } = {}, dialect) {
  const range = key ? anchorRange(src, key, dialect, { whole }) : null
  const passed = new Set(passedTitles)
  const hit = new Set(mutants.map(m => m.title))
  const blocks = findTestBlocks(src, dialect)
  const left = blocks.filter(b => (!range || (b.start >= range[0] && b.start < range[1])) && dialect.mutation.eligible(b, passed, ungraded) && !hit.has(b.title))
  // Passing titles no source block matches (escaped quote, template title) got no mutant either; counted in any range.
  // each/for table cases ("adds %i" ran as "adds 1") are never mutated, by design.
  const stray = passedTitles.filter(t => !ungraded?.test(t) && !blocks.some(b => b.mod === 'each' ? tableTitle(b.title).test(t) : dialect.mutation.eligible({ ...b, mod: null }, new Set([t]))))
  return [...new Set([...left.map(b => b.title), ...stray])]
}

// printf-style %s/%i/%#, $name and ${...} match any text.
const tableTitle = title => new RegExp(`^${String(title ?? '').split(/%[sdifjoOp#%]|\$\{[^}]*\}|\$[\w.]+/).map(escapeRegExp).join('[\\s\\S]*')}$`)

export function applyMutant(src, m) {
  return `${src.slice(0, m.start)}${m.replacement}${src.slice(m.end)}`
}

/** Remove temp mutants left by dead processes. */
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

export async function run({ spec, key = null, baseline = null, max = null, timeoutMs = 300_000, whole = false }, ctx) {
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
  let mutants = planMutants(src, passed, { key, ungraded, whole }, ctx.dialect)
  if (mutants === null) return result('mutation', 'not_run', `no ${key} block in ${spec}`, [{ file: spec, kind: 'no anchor block', detail: `no top-level group titled "${key} …"` }])
  const bare = unmutated(src, passed, mutants, { key, ungraded, whole }, ctx.dialect)
  const bareFindings = bare.map(t => ({ file: spec, test: t, kind: 'not mutated', detail: 'passes, but has no assertion mutation can check' }))
  const rank = ctx.dialect.mutation.rank
  mutants = [...mutants].sort((a, b) => rank(a.kind) - rank(b.kind))
  // maxMutants keeps the strongest; the summary reports how many were dropped.
  const capped = max != null && mutants.length > max ? mutants.length - max : 0
  if (capped) mutants = mutants.slice(0, max)

  const inPlace = ctx.dialect.mutation.inPlace === true
  const tmp = inPlace ? specPath : tempSpecPath(specPath)
  // posix.join: path.join would give backslashes on Windows.
  const relTmp = inPlace ? spec : posix.join(posix.dirname(spec), basename(tmp))
  // In place: restore the original bytes after each mutant, in finally, and on a signal.
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
      // A same-named test in another ticket's block can't kill this mutant; no describe path means no other block.
      const executed = r.ran ? r.tests.filter(t => t.title === m.title && (t.status === 'passed' || t.status === 'failed') && (!key || whole || !t.path?.length || inKeyBlock(t, key))) : []
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
  const data = { killed, survived: survivedList.length, errors, total: graded.length, score, survivors: survivedList.map(o => o.snippet), unmutated: bare.length, ...(capped ? { capped } : {}) }
  if (survivedList.length) {
    return result('mutation', 'fail', `${survivedList.length} of ${graded.length} mutant(s) survived: an assertion that cannot fail`,
      [...survivedList.map(o => ({ file: spec, test: o.title, kind: 'survived', detail: o.snippet })), ...bareFindings], data)
  }
  if (!graded.length && errors) return result('mutation', 'not_run', `${errors} mutant(s) ran no test`, [], data)
  if (score === null) return result('mutation', 'pass', 'no eligible assertions to mutate', [], data)
  // A passing test with no mutant is unchecked, so the step can't pass.
  if (bare.length) return result('mutation', 'not_run', `${bare.length} passing test(s) with no assertion mutation can check`, bareFindings, data)
  if (errors) return result('mutation', 'not_run', `${killed} of ${graded.length + errors} mutants killed; ${errors} ran no test`, [], data)
  return result('mutation', 'pass', `${killed}/${graded.length} mutants killed${capped ? `; ${capped} more left out by maxMutants` : ''}`, [], data)
}
