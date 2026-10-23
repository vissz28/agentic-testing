// Suite honesty: does every test that runs carry an assertion? Static; no model opinion.
// A hollow test (runs, asserts nothing) fails the check; so does a run where no test asserts.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { result } from '../../base/result.mjs'
import { keyPattern } from '../../base/keys.mjs'
import { ungradedTitlesOf } from '../../base/config.mjs'

/** Top-level groups (column 0): { idx, mod, title }; a chain holding skip, todo or fixme never runs. */
export function groups(src, dialect) {
  const re = new RegExp(dialect.groupRe.source, 'gm')
  const out = []
  let m
  while ((m = re.exec(src))) {
    const chain = m[1] ?? ''
    out.push({ idx: m.index, mod: /\.(?:skip|todo|fixme)\b/.test(chain) ? 'skip' : /\.only\b/.test(chain) ? 'only' : null, title: m[3] })
  }
  return out
}

/** Index just past the ")" closing the "(" at `open`, skipping strings. */
function closeAt(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++ }
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
  }
  return src.length
}

/** Test declarations in order: { mod, title, idx }. An each/for test takes the title after its table. */
export function testMarks(src, re) {
  const all = new RegExp(re.source, 'g')
  const out = []
  let m
  while ((m = all.exec(src))) {
    if (!m[4]) { out.push({ mod: m[1] || null, title: m[3], idx: m.index }); continue }
    const title = /^\s*\(\s*(['"`])(.*?)\1/.exec(src.slice(closeAt(src, m.index + m[0].length - 1)))?.[2] ?? ''
    out.push({ mod: m[1] === 'skip' ? 'skip' : 'each', title, idx: m.index })
  }
  return out
}

/** The code without comments and with every string emptied, so expect( in a string or a comment is not read. */
function codeOnly(src) {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      out += c
      for (i++; i < src.length && src[i] !== c; i++) { if (src[i] === '\\') i++; out += ' ' }
      out += c
    } else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n' }
    else if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1 }
    else out += c
  }
  return out
}

/**
 * Assertions in a test body: an expect (or expect.soft / expect.poll) that ends in a matcher call, or an
 * assert call. A bare expect(x) or an uncalled .toBeTruthy asserts nothing.
 */
export function countAssertions(body) {
  const code = codeOnly(body)
  let n = (code.match(/(?<![.\w$])assert(?:\.\w+)?\s*\(/g) || []).length
  for (const m of code.matchAll(/(?<![.\w$])expect(?:\.(?:soft|poll))?\s*\(/g)) {
    if (/^(?:\s*\.\s*\w+)*?\s*\.\s*\w+\s*\(/.test(code.slice(closeAt(code, m.index + m[0].length - 1)))) n++
  }
  return n
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

/**
 * ungraded: the titles not graded (a Playwright project's playwright.ungradedTitles), or null. A dialect
 * whose marks a regex cannot give (Go: a skip is a call in the body) brings its own suite.marks(src),
 * each mark with its end, and its own suite.countAssertions(body).
 */
export function scoreSpec(src, dialect, ungraded = null) {
  const s = dialect.suite
  const skipRanges = s.skippedGroups ? skippedGroupRanges(src, dialect) : []
  const marks = s.marks ? s.marks(src) : testMarks(src, s.testRe)
  const count = s.countAssertions ?? countAssertions
  return marks.map((mk, i) => {
    // A test's slice runs up to the next test (or to its own end, when the dialect knows it).
    const expects = count(src.slice(mk.idx, mk.end ?? (i + 1 < marks.length ? marks[i + 1].idx : src.length)))
    const inSkipped = skipRanges.some(([a, b]) => mk.idx >= a && mk.idx < b)
    return { title: mk.title, mod: inSkipped ? 'skip' : mk.mod, expects, idx: mk.idx, capture: Boolean(ungraded?.test(mk.title)) }
  })
}

export function grade(files, { key = null, ungraded = null } = {}, dialect) {
  let behavioral = 0
  let honest = 0
  let skipped = 0
  let notYet = 0
  let capture = 0
  const hollow = []
  const missingFiles = []
  for (const { path, src } of files) {
    let tests = scoreSpec(src, dialect, ungraded)
    if (key) {
      // The key's block, else (older specs: test('ABC-1-1 …') at the top level) the tests named with the key.
      const r = anchorRange(src, key, dialect)
      const named = r ? [] : tests.filter(t => keyPattern(key).test(t.title))
      if (!r && !named.length) { missingFiles.push(path); continue }
      tests = r ? tests.filter(t => t.idx >= r[0] && t.idx < r[1]) : named
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
  return grade(files, { key, ungraded: ungradedTitlesOf(ctx.config, ctx.dialect) }, ctx.dialect)
}
