// Suite honesty: every test that runs must assert something (static check).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { result } from '../result.mjs'
import { keyPattern } from '../../config/keys.mjs'
import { ungradedTitlesOf } from '../../config/config.mjs'

// xit/fit/xdescribe (Jest, Jasmine, Mocha) act as .skip/.only; only on JS test words, not Go's TestX.
const PREFIXED = { x: 'skip', f: 'only' }
const prefixed = m => (/^[xf](?:it|test|describe|context|specify)\b/.test(m[0]) ? PREFIXED[m[0][0]] : null)

/** Column-0 groups. Dialects without a .skip chain (JUnit @Disabled) set the `skip` named group. */
export function groups(src, dialect) {
  const re = new RegExp(dialect.groupRe.source, 'gm')
  const out = []
  let m
  while ((m = re.exec(src))) {
    const chain = m[1] ?? ''
    out.push({ idx: m.index, mod: m.groups?.skip || /\.(?:skip|todo|fixme)\b/.test(chain) ? 'skip' : /\.only\b/.test(chain) ? 'only' : prefixed(m), title: m[3] })
  }
  return out
}

/**
 * End of the regex literal starting at i, or -1, so a quote inside one (/'/) isn't read as a string.
 * ponytail: a regex starts after start of line, an operator or return; after another keyword it is read as division.
 */
function regexEnd(src, i) {
  let j = i - 1
  while (j >= 0 && (src[j] === ' ' || src[j] === '\t')) j--
  if (!(j < 0 || '\n(,=:[!&|?{;'.includes(src[j]) || /(?<![\w$])return$/.test(src.slice(Math.max(0, j - 6), j + 1)))) return -1
  let cls = false
  for (let k = i + 1; k < src.length; k++) {
    const c = src[k]
    if (c === '\n') return -1
    if (c === '\\') k++
    else if (c === '[') cls = true
    else if (c === ']') cls = false
    else if (c === '/' && !cls) return k
  }
  return -1
}

/** Index past the matching ")", skipping strings and regex literals. */
function closeAt(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    let e
    if (c === '"' || c === "'" || c === '`') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++ }
    else if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && (e = regexEnd(src, i)) > 0) i = e
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
  }
  return src.length
}

// test('x', { skip: true }, …) in node --test and Vitest.
const OPTION_MOD = /^\s*,\s*\{([^{}]*)\}/

function optionMod(after) {
  const opts = OPTION_MOD.exec(after)?.[1] ?? ''
  return /\bskip\s*:(?!\s*false\b)/.test(opts) ? 'skip' : /\btodo\s*:(?!\s*false\b)/.test(opts) ? 'todo' : null
}

/**
 * each/for tests take the title after their table. modOf maps m[1] when skip isn't spelled "skip" (C# [Ignore]).
 * Annotation dialects (JUnit @Disabled) set the `skip`/`todo` named groups.
 */
export function testMarks(src, re, modOf = null) {
  const all = new RegExp(re.source, 'g')
  const out = []
  let m
  while ((m = all.exec(src))) {
    if (!m[4]) { out.push({ mod: m.groups?.skip ? 'skip' : m.groups?.todo ? 'todo' : modOf ? modOf(m[1]) : m[1] || prefixed(m) || optionMod(src.slice(m.index + m[0].length)) || null, title: m[3], idx: m.index }); continue }
    const title = /^\s*\(\s*(['"`])(.*?)\1/.exec(src.slice(closeAt(src, m.index + m[0].length - 1)))?.[2] ?? ''
    out.push({ mod: m[1] === 'skip' ? 'skip' : 'each', title, idx: m.index })
  }
  return out
}

/** Strip comments and blank out strings so expect( inside them isn't counted. */
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
    else if (c === '/' && regexEnd(src, i) > 0) { const e = regexEnd(src, i); out += `/${' '.repeat(e - i - 1)}/`; i = e }
    else out += c
  }
  return out
}

/**
 * expect(...) only counts with a matcher call; a bare expect(x) or uncalled .toBeTruthy asserts nothing.
 * chai also counts property chains (expect(ok).to.be.true) and Cypress .should(…).
 */
export function countAssertions(body, { chai = false, helpers = [] } = {}) {
  const code = codeOnly(body)
  let n = (code.match(/(?<![.\w$])assert(?:\.\w+)?\s*\(/g) || []).length
  // Page-object helpers count too: page.expectGridVisible(), dashboard.assertTitle(), plus configured prefixes.
  const prefixes = ['expect', 'assert', 'verify', ...helpers].filter(p => /^[A-Za-z_$][\w$]*$/.test(p))
  n += (code.match(new RegExp(`\\.(?:${prefixes.join('|')})[A-Z_$][\\w$]*\\s*\\(`, 'g')) || []).length
  if (chai) n += (code.match(/\.should\b(?:\s*\.\s*\w+)*\s*\(/g) || []).length
  for (const m of code.matchAll(/(?<![.\w$])expect(?:\.(?:soft|poll))?\s*\(/g)) {
    const rest = code.slice(closeAt(code, m.index + m[0].length - 1))
    if (/^(?:\s*\.\s*\w+)*?\s*\.\s*\w+\s*\(/.test(rest) || (chai && /^\s*\.\s*(?:not\s*\.\s*)?to(?![\w$])/.test(rest))) n++
  }
  return n
}

export function skippedGroupRanges(src, dialect) {
  const tops = groups(src, dialect)
  return tops.map((t, i) => (t.mod === 'skip' ? [t.idx, i + 1 < tops.length ? tops[i + 1].idx : src.length] : null)).filter(Boolean)
}

/** [start, end) of the key's top-level group. `whole` (ticketAnchor "branch"): no block means the whole file. */
export function anchorRange(src, key, dialect, { whole = false } = {}) {
  const tops = groups(src, dialect)
  const keyRe = keyPattern(key)
  const start = tops.find(t => keyRe.test(t.title))
  if (!start) return whole ? [0, src.length] : null
  const next = tops.find(t => t.idx > start.idx)
  return [start.idx, next ? next.idx : src.length]
}

/** ungraded: playwright.ungradedTitles. Dialects a regex can't parse (Go skips are calls) bring suite.marks/countAssertions. */
export function scoreSpec(src, dialect, ungraded = null, helpers = []) {
  const s = dialect.suite
  const skipRanges = s.skippedGroups ? skippedGroupRanges(src, dialect) : []
  const marks = s.marks ? s.marks(src) : testMarks(src, s.testRe, s.modOf)
  // Dialect-specific counters: C# Assert/.Should(), Go testify, pytest assert.
  const count = s.countAssertions ?? dialect.countAssertions ?? countAssertions
  return marks.map((mk, i) => {
    const expects = count(src.slice(mk.idx, mk.end ?? (i + 1 < marks.length ? marks[i + 1].idx : src.length)), { chai: s.chai, helpers })
    const inSkipped = skipRanges.some(([a, b]) => mk.idx >= a && mk.idx < b)
    return { title: mk.title, mod: inSkipped ? 'skip' : mk.mod, expects, idx: mk.idx, capture: Boolean(ungraded?.test(mk.title)) }
  })
}

export function grade(files, { key = null, ungraded = null, helpers = [], whole = false } = {}, dialect) {
  let behavioral = 0
  let honest = 0
  let skipped = 0
  let notYet = 0
  let capture = 0
  const hollow = []
  const missingFiles = []
  for (const { path, src } of files) {
    let tests = scoreSpec(src, dialect, ungraded, helpers)
    if (key) {
      // Key block, else tests titled with the key (older specs: top-level test('ABC-1-1 …')).
      const r = anchorRange(src, key, dialect, { whole })
      const named = r ? [] : tests.filter(t => keyPattern(key).test(t.title))
      if (!r && !named.length) { missingFiles.push(path); continue }
      tests = r ? tests.filter(t => t.idx >= r[0] && t.idx < r[1]) : named
    }
    for (const t of tests) {
      if (t.capture) { capture++; continue }
      if (t.mod === dialect.suite.notYet) notYet++
      if (t.mod === 'skip') skipped++
      behavioral++
      // Only skip and not-yet are exempt; .only, .concurrent, .fails still run and must assert.
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

export function run({ specs, key = null, whole = false }, ctx) {
  const files = specs.map(p => ({ path: p, src: readFileSync(resolve(ctx.root, p), 'utf8') }))
  return grade(files, { key, whole, ungraded: ungradedTitlesOf(ctx.config, ctx.dialect), helpers: ctx.config?.assertionHelpers ?? [] }, ctx.dialect)
}
