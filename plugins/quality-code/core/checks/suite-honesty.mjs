// Suite honesty: does every test that runs carry an assertion? Static; no model opinion.
// A hollow test (runs, asserts nothing) fails the check; so does a run where no test asserts.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { result } from './result.mjs'
import { keyPattern } from './keys.mjs'

/** Top-level groups (column 0): { idx, mod, title }. */
export function groups(src, dialect) {
  const re = new RegExp(dialect.groupRe.source, 'gm')
  const out = []
  let m
  while ((m = re.exec(src))) out.push({ idx: m.index, mod: m[1] || null, title: m[3] })
  return out
}

/** Char ranges of top-level skipped groups: a test inside one never runs. */
export function skippedGroupRanges(src, dialect) {
  const tops = groups(src, dialect)
  return tops.map((t, i) => (t.mod === 'skip' ? [t.idx, i + 1 < tops.length ? tops[i + 1].idx : src.length] : null)).filter(Boolean)
}

/** [start, end) of the top-level group whose title holds the key, up to the next top-level group. */
export function anchorRange(src, key, dialect) {
  const tops = groups(src, dialect)
  const keyRe = keyPattern(key)
  const start = tops.find(t => keyRe.test(t.title))
  if (!start) return null
  const next = tops.find(t => t.idx > start.idx)
  return [start.idx, next ? next.idx : src.length]
}

export function scoreSpec(src, dialect) {
  const s = dialect.suite
  const re = new RegExp(s.testRe.source, 'g')
  const skipRanges = s.skippedGroups ? skippedGroupRanges(src, dialect) : []
  const marks = []
  let m
  while ((m = re.exec(src))) marks.push({ mod: m[1] || null, title: m[3], idx: m.index })
  return marks.map((mk, i) => {
    // A test's slice runs up to the next test, so strip comments before counting expect( calls.
    const body = src
      .slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : src.length)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    const expects = (body.match(/\bexpect\s*\(/g) || []).length
    const inSkipped = skipRanges.some(([a, b]) => mk.idx >= a && mk.idx < b)
    return { title: mk.title, mod: inSkipped ? 'skip' : mk.mod, expects, idx: mk.idx, capture: s.isCapture(mk.title) }
  })
}

export function grade(files, { key = null } = {}, dialect) {
  let behavioral = 0
  let honest = 0
  let skipped = 0
  let notYet = 0
  let capture = 0
  const hollow = []
  const missingFiles = []
  for (const { path, src } of files) {
    let tests = scoreSpec(src, dialect)
    if (key) {
      const r = anchorRange(src, key, dialect)
      if (!r) { missingFiles.push(path); continue }
      tests = tests.filter(t => t.idx >= r[0] && t.idx < r[1])
    }
    for (const t of tests) {
      if (t.capture) { capture++; continue }
      if (t.mod === dialect.suite.notYet) notYet++
      if (t.mod === 'skip') skipped++
      behavioral++
      // Only skip and the not-yet marker are exempt; .only, .concurrent, .fails run, so they must assert.
      const plain = t.mod !== 'skip' && t.mod !== dialect.suite.notYet
      if (plain && t.expects >= 1) honest++
      if (plain && t.expects === 0) hollow.push({ file: path, test: t.title })
    }
  }
  if (key && missingFiles.length === files.length) {
    return result('suite-honesty', 'not_run', `no ${key} block in ${missingFiles.join(', ')}`, [{ file: missingFiles.join(', '), kind: 'no anchor block', detail: `no top-level group titled "${key} …"` }])
  }
  if (!behavioral) return result('suite-honesty', 'not_run', 'no test to grade', [{ kind: 'no test to grade', detail: 'no graded test in the given spec(s)' }])
  const note = missingFiles.length ? ` (no ${key} block in ${missingFiles.join(', ')})` : ''
  const percent = behavioral ? Math.round((honest / behavioral) * 100) : 100
  const data = { tests: behavioral, withAssertion: honest, hollow: hollow.length, todo: notYet, skipped, capture, percent }
  if (hollow.length) {
    return result('suite-honesty', 'fail', `${hollow.length} test(s) run but assert nothing${note}`,
      hollow.map(h => ({ file: h.file, test: h.test, kind: 'hollow test', detail: 'runs but has no expect()' })), data)
  }
  if (behavioral > 0 && honest === 0) {
    return result('suite-honesty', 'fail', `none of the ${behavioral} test(s) carries an assertion, so nothing here can fail${note}`,
      [{ kind: 'nothing asserts', detail: `${notYet} not written yet, ${skipped} skipped` }], data)
  }
  return result('suite-honesty', 'pass', `${honest}/${behavioral} tests carry assertions (${percent}%)${note}`, [], data)
}

export function run({ specs, key = null }, ctx) {
  const files = specs.map(p => ({ path: p, src: readFileSync(resolve(ctx.root, p), 'utf8') }))
  return grade(files, { key }, ctx.dialect)
}
