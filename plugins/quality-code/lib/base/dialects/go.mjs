// Go syntax, as the backend checks read it. A test is a func TestXxx(t *testing.T); a scenario is a
// t.Run("<name>", …) with a string-literal name, directly in it. A test function with no such t.Run
// (one plain test, or a table-driven one whose t.Run takes tc.name) is one scenario itself, titled
// with its function name. The runner (runners/go.mjs) reports results on the same rule, with the
// same titles. The ticket's block is a test function whose doc comment holds the key:
//
//   // ABC-12 Reorder below the threshold
//   func TestReorder(t *testing.T) { t.Run("stock of 4 reorders", …) }
//
// A regex cannot tell a skip (a call in the body) nor an assertion (an if around t.Errorf), so this
// dialect brings its own marks, assertion count and assertion ranges (suite.marks, mutation.ranges).
export const name = 'go'

/**
 * Top-level group: a test function at column 0 with the doc comment right above it. m[1] = modifier
 * chain (none in Go), m[3] = the doc comment and the func line, where the key is read.
 */
export const groupRe = /^()()((?:\/\/[^\n]*\n)*func\s+Test(?![a-z])\w*)\s*\(/gm

// A literal subtest: m[3] = its name. The marks come from marks() below; this is what the quality
// program reads for traceability.
const RUN = /\b\w+\.Run\(\s*()()["`]([^"`\n]*)["`]/g

/** The code with its comments and the inside of its string and rune literals blanked, same length. */
export function mask(src) {
  const out = src.split('')
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ' }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i)
      const end = e < 0 ? src.length : e
      blank(i, end)
      i = end
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      const end = e < 0 ? src.length : e + 2
      blank(i, end)
      i = end
    } else if (c === '`') {
      const e = src.indexOf('`', i + 1)
      const end = e < 0 ? src.length : e
      blank(i + 1, end)
      i = end + 1
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++ }
      blank(i + 1, j)
      i = j + 1
    } else i++
  }
  return out.join('')
}

/** Index of the bracket closing the one at `open`, in masked code. */
function closing(m, open) {
  const o = m[open]
  const c = o === '(' ? ')' : o === '{' ? '}' : ']'
  let d = 0
  for (let i = open; i < m.length; i++) {
    if (m[i] === o) d++
    else if (m[i] === c && --d === 0) return i
  }
  return m.length - 1
}

/** The Go string literal at p ("…" or `…`): { value, end }, or null. */
export function literalAt(src, p) {
  const q = src[p]
  if (q === '`') {
    const e = src.indexOf('`', p + 1)
    return e < 0 ? null : { value: src.slice(p + 1, e), end: e + 1 }
  }
  if (q !== '"') return null
  let j = p + 1
  while (j < src.length && src[j] !== '"' && src[j] !== '\n') { if (src[j] === '\\') j++; j++ }
  const raw = src.slice(p, j + 1)
  let value
  try { value = JSON.parse(raw) } catch { value = raw.slice(1, -1) }
  return { value, end: j + 1 }
}

/** The name `go test` gives a subtest: spaces become "_" (testing's rewrite); "/" separates levels. */
export const goName = title => [...String(title)].map(ch => (/\s/.test(ch) ? '_' : ch)).join('')

const FUNC = /^func\s+(Test(?![a-z])\w*)\s*\(\s*(\w+)\s+\*testing\.T\s*\)\s*\{/gm
const TVARS = /\b(\w+)\s+\*testing\.T\b/g
const tvarsOf = m => new Set(['t', ...[...m.matchAll(TVARS)].map(x => x[1])])

/** The doc comment right above the line at `start`: its text lines, blank ones left out. */
function docAbove(src, start) {
  const doc = []
  let at = start
  while (at > 0) {
    const prevStart = src.lastIndexOf('\n', at - 2) + 1
    const line = src.slice(prevStart, at - 1).replace(/\r$/, '')
    if (!line.startsWith('//')) break
    doc.unshift(line.replace(/^\/\/\s?/, '').trim())
    at = prevStart
  }
  return { docStart: at, doc: doc.filter(Boolean).join(' ') }
}

/** The body { … } of the func literal after `from` (a subtest's), as [open, close]. */
function bodyAfter(m, from, limit) {
  const open = m.indexOf('{', from)
  return open < 0 || open > limit ? null : [open, closing(m, open)]
}

/** 'skip' or 'todo' when the body skips unconditionally (a t.Skip at its own top level), else null. */
function skipMod(src, m, open, close, tvars) {
  const re = /\b(\w+)\.Skip(?:f|Now)?\s*\(/g
  re.lastIndex = open
  let x
  while ((x = re.exec(m)) && x.index < close) {
    if (!tvars.has(x[1])) continue
    let depth = 0
    for (let i = open; i < x.index; i++) { if (m[i] === '{') depth++; else if (m[i] === '}') depth-- }
    if (depth !== 1) continue
    const at = x.index + x[0].length
    const lit = literalAt(src, at + src.slice(at).match(/^\s*/)[0].length)
    return lit && /^todo\b/i.test(lit.value) ? 'todo' : 'skip'
  }
  return null
}

/**
 * The test functions of a Go test file: { name, start, docStart, doc, group, end, subtests }, each
 * subtest a direct literal t.Run: { title, idx, end, mod }. group is the title its results carry
 * (the doc comment, else the function name).
 */
export function scan(src) {
  const m = mask(src)
  const tvars = tvarsOf(m)
  const funcs = []
  for (const f of m.matchAll(FUNC)) {
    const open = f.index + f[0].length - 1
    const close = closing(m, open)
    const { docStart, doc } = docAbove(src, f.index)
    const subtests = []
    const run = /\b(\w+)\.Run\(\s*/g
    run.lastIndex = open
    let x
    let lastEnd = -1
    while ((x = run.exec(m)) && x.index < close) {
      if (!tvars.has(x[1]) || x.index < lastEnd) continue
      const lit = literalAt(src, x.index + x[0].length)
      if (!lit) continue
      const callEnd = closing(m, x.index + x[0].search(/\(/)) + 1
      const body = bodyAfter(m, lit.end, callEnd)
      subtests.push({ title: lit.value, idx: x.index, end: callEnd, mod: body ? skipMod(src, m, body[0], body[1], tvars) : null })
      lastEnd = callEnd
    }
    funcs.push({ name: f[1], start: f.index, docStart, doc, group: doc || f[1], end: close + 1, mod: skipMod(src, m, open, close, tvars), subtests })
  }
  return funcs
}

/** The scenarios in order: { mod, title, idx, end }. */
export function marks(src) {
  return scan(src).flatMap(f => (f.subtests.length
    ? f.subtests.map(s => ({ mod: f.mod ?? s.mod, title: s.title, idx: s.idx, end: s.end }))
    : [{ mod: f.mod, title: f.name, idx: f.start, end: f.end }]))
}

// A testify call (assert.X / require.X; assert.New is no assertion).
const TESTIFY = /(?<![\w.])(?:assert|require)\.(?!New\b)([A-Z]\w*)\s*\(/g
// A failure report on a *testing.T: t.Error, t.Errorf, t.Fatal, t.Fatalf, t.Fail, t.FailNow.
const REPORT = /(?<![\w.])(\w+)\.(?:Errorf?|Fatalf?|Fail|FailNow)\s*\(/g

/** Assertions in a test body: testify calls and failure reports (t.Errorf, t.Fatal, …). */
export function countAssertions(body) {
  const m = mask(body)
  const tvars = tvarsOf(m)
  return [...m.matchAll(TESTIFY)].length + [...m.matchAll(REPORT)].filter(x => tvars.has(x[1])).length
}

/** The block of `if` at idx: [open, close] of its { … }, or null. */
function ifBlock(m, idx) {
  let depth = 0
  for (let i = idx + 2; i < m.length; i++) {
    const c = m[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === '{' && depth === 0) return [i, closing(m, i)]
    else if (c === '\n' && depth === 0 && /[^\s]/.test(m.slice(idx, i)) && !/[,(&|=!<>+\-*/]\s*$/.test(m.slice(idx, i))) return null
  }
  return null
}

/**
 * { start, end } of each assertion: a testify call (its whole call), and an if whose block reports a
 * failure at its own top level (its "if <cond> " up to the "{": only the condition is mutated).
 */
export function ranges(src) {
  const m = mask(src)
  const tvars = tvarsOf(m)
  const out = []
  for (const x of m.matchAll(TESTIFY)) out.push({ start: x.index, end: closing(m, x.index + x[0].length - 1) + 1 })
  for (const x of m.matchAll(/(?<![\w.])if\s/g)) {
    const b = ifBlock(m, x.index)
    if (!b) continue
    // Only the block's own statements: a report inside a nested block is that block's assertion.
    let inner = ''
    let depth = 0
    for (let i = b[0] + 1; i < b[1]; i++) {
      if (m[i] === '{') depth++
      else if (m[i] === '}') depth--
      else if (depth === 0) inner += m[i]
      if (depth > 0) inner += ' '
    }
    if ([...inner.matchAll(REPORT)].some(r => tvars.has(r[1]))) out.push({ start: x.index, end: b[0] })
  }
  return out.sort((a, b) => a.start - b.start)
}

// testify's opposites; an "f" variant (Equalf) flips to its own "f" variant.
const OPPOSITE = {
  Equal: 'NotEqual', EqualValues: 'NotEqualValues', True: 'False', Nil: 'NotNil', Contains: 'NotContains',
  ErrorIs: 'NotErrorIs', Zero: 'NotZero', Empty: 'NotEmpty', Error: 'NoError', Same: 'NotSame',
  Subset: 'NotSubset', Regexp: 'NotRegexp', Panics: 'NotPanics', Implements: 'NotImplements',
  Greater: 'LessOrEqual', Less: 'GreaterOrEqual',
}
for (const [a, b] of Object.entries({ ...OPPOSITE })) if (!OPPOSITE[b]) OPPOSITE[b] = a
const FLIP_OP = { '==': '!=', '!=': '==', '<': '>=', '>=': '<', '>': '<=', '<=': '>' }
const NUM = /(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g

/** The first number in masked text from `from`: its index, else -1. */
function numberAt(m, from = 0) {
  NUM.lastIndex = from
  const x = NUM.exec(m)
  return x ? { index: x.index, text: x[0] } : null
}

/** The text with the first string literal at or after `from` corrupted (★MUT appended), else null. */
function corruptString(text, m, from = 0) {
  for (let i = from; i < text.length; i++) {
    if (m[i] !== '"' && m[i] !== '`') continue
    const lit = literalAt(text, i)
    if (!lit || !lit.value) return null
    return `${text.slice(0, lit.end - 1)}★MUT${text.slice(lit.end - 1)}`
  }
  return null
}

const plusOne = (text, n) => `${text.slice(0, n.index)}${Number(n.text) + 1}${text.slice(n.index + n.text.length)}`

/** The flips of an if condition ("if <init>; <cond> "): the comparison inverted first. */
function ifFlips(text, add) {
  const m = mask(text)
  // The condition starts after a top-level ";" (if got := f(); got != want).
  let from = 2
  let depth = 0
  for (let i = 2; i < m.length; i++) {
    if ('([{'.includes(m[i])) depth++
    else if (')]}'.includes(m[i])) depth--
    else if (m[i] === ';' && depth === 0) from = i + 1
  }
  const lead = text.slice(0, from).length + (text.slice(from).match(/^\s*/)[0].length)
  const tail = text.slice(lead).match(/\s*$/)[0]
  const cond = text.slice(lead, text.length - tail.length)
  const mc = m.slice(lead, text.length - tail.length)
  // Operators outside parentheses only: f(a == b) is an argument.
  const top = [...mc.matchAll(/&&|\|\||==|!=|<=|>=|<(?!-)|(?<!-)>/g)].filter(x => {
    let d = 0
    for (let i = 0; i < x.index; i++) { if ('([{'.includes(mc[i])) d++; else if (')]}'.includes(mc[i])) d-- }
    return d === 0
  })
  const pre = text.slice(0, lead)
  if (top.length === 1 && FLIP_OP[top[0][0]]) {
    const o = top[0]
    add('flip-compare', `${pre}${cond.slice(0, o.index)}${FLIP_OP[o[0]]}${cond.slice(o.index + o[0].length)}${tail}`)
  } else if (!top.length && /^!\s*[\w.]+(?:\([^()]*\))?$/.test(mc)) {
    add('drop-not', `${pre}${cond.replace(/^!\s*/, '')}${tail}`)
  } else {
    add('negate-if', `${pre}!(${cond})${tail}`)
  }
  // The expected value is on the right of the comparison: change it there first.
  const cmp = top.find(x => FLIP_OP[x[0]])
  const n = (cmp && numberAt(mc, cmp.index)) ?? numberAt(mc)
  if (n) add('num→n+1', `${pre}${plusOne(cond, n)}${tail}`)
  const s = corruptString(cond, mc, cmp ? cmp.index : 0) ?? corruptString(cond, mc)
  if (s) add('corrupt-string', `${pre}${s}${tail}`)
}

/** The flips of one assertion (a testify call, or an if condition), strongest kinds first. */
export function flipMutations(src) {
  const out = []
  const add = (kind, text) => { if (text !== src && !out.some(o => o.text === text)) out.push({ kind, text }) }
  if (/^if\s/.test(src)) {
    ifFlips(src, add)
    return out
  }
  const head = /^((?:assert|require)\.)([A-Z]\w*)(\s*\()/.exec(src)
  if (!head) return out
  const fn = head[2]
  const base = OPPOSITE[fn] ? fn : fn.endsWith('f') && OPPOSITE[fn.slice(0, -1)] ? fn.slice(0, -1) : null
  if (base) add('invert-assert', `${head[1]}${OPPOSITE[base]}${base === fn ? '' : 'f'}${src.slice(head[1].length + fn.length)}`)
  // The values come after the first argument (t).
  const m = mask(src)
  let from = head[0].length
  for (let d = 0; from < m.length; from++) {
    if ('([{'.includes(m[from])) d++
    else if (')]}'.includes(m[from])) d--
    else if (m[from] === ',' && d === 0) { from++; break }
  }
  const n = numberAt(m, from)
  if (n) add('num→n+1', plusOne(src, n))
  const s = corruptString(src, m, from)
  if (s) add('corrupt-string', s)
  return out
}

export const honesty = {
  removedDecl: /^\s*func\s+Test(?![a-z])\w*\s*\(|\b\w+\.Run\s*\(/,
  // testify calls and failure reports on the usual *testing.T names (err.Error() is no report).
  assertionRe: /(?<![\w.])(?:assert|require)\.(?!New\b)[A-Z]\w*\s*\(|(?<![\w.])(?:t|tb|tt|st)\.(?:Errorf?|Fatalf?|Fail|FailNow)\s*\(/,
  // t.Skip("todo …") is "not written yet", as it.todo is: no skip.
  skips: [/(?<![\w.])\w+\.Skip(?:f|Now)?\s*\((?!\s*["`](?:todo|TODO|Todo)\b)/],
  forgiveMoves: false,
  anchorTags: false,
}

/** The rows of each table ([]struct{ … }{ rows }) in the code: a table-driven test's expected values. */
export function tables(src) {
  const m = mask(src)
  const out = []
  for (const x of m.matchAll(/\[\]struct\s*\{/g)) {
    const typeEnd = closing(m, x.index + x[0].length - 1)
    const open = m.slice(typeEnd + 1).search(/\S/) + typeEnd + 1
    if (m[open] === '{') out.push(src.slice(open, closing(m, open) + 1))
  }
  return out
}

// The value check: a field the ticket names must be read in an assertion (unit tests read fields).
// The values are read in the whole assertion (a testify call's arguments, an if's condition) and in
// the rows of a table, which a table-driven test asserts case by case.
export const expected = {
  fieldNames: true,
  readsActual: true,
  parts: block => [...ranges(block).map(r => block.slice(r.start, r.end)), ...tables(block)],
}

export const suite = {
  testRe: RUN,
  marks,
  countAssertions,
  notYet: 'todo',
  skippedGroups: true,
}

// Strongest first: inverting an assertion is the definitive "does it bind anything" mutant.
const mutantRank = k => (k === 'invert-assert' || k === 'flip-compare' || k === 'drop-not' || k === 'negate-if' ? 0 : k === 'num→n+1' ? 1 : 2)

/** A block mutation judges: it ran green, it is not skipped or a todo. */
const eligible = (block, passed) => block.mod !== 'todo' && block.mod !== 'skip' && passed.has(block.title)

/** One mutant per assertion (the strongest) unless thorough; baseline-green tests only, inside the range. */
function plan({ src, passedTitles, range, thorough, blocks, expects }) {
  const passed = new Set(passedTitles)
  const all = []
  for (const ex of expects) {
    if (range && (ex.start < range[0] || ex.start >= range[1])) continue
    const block = blocks.find(b => ex.start >= b.start && ex.start < b.end)
    if (!block || !eligible(block, passed)) continue
    const original = src.slice(ex.start, ex.end)
    for (const flip of flipMutations(original)) {
      all.push({ title: block.title, start: ex.start, end: ex.end, kind: flip.kind, replacement: flip.text, snippet: `${flip.kind}: ${original.replace(/\s+/g, ' ').trim().slice(0, 60)}` })
    }
  }
  if (thorough) return all
  const best = new Map()
  for (const m of all) {
    const cur = best.get(m.start)
    if (!cur || mutantRank(m.kind) < mutantRank(cur.kind)) best.set(m.start, m)
  }
  return [...best.values()].sort((a, b) => a.start - b.start)
}

export const mutation = {
  // A compiled language: a mutated copy next to the spec would not compile (a duplicate function),
  // so the spec itself is mutated and always restored (see checks/mutation.mjs).
  inPlace: true,
  expectRe: /(?<![\w.])(?:assert|require)\.(?!New\b)[A-Z]\w*\s*\(/,
  testRe: RUN,
  marks,
  ranges,
  rank: mutantRank,
  flips: flipMutations,
  eligible,
  plan,
}
