// pytest syntax, as the backend checks read it. A test is a function named test_* (def or async def), at
// the top level of the file or inside a class. A group is a top-level class; its title is the first line
// of its docstring when it has one, else its name: class TestTotals: """ABC-123 Line totals""" is the
// ABC-123 block (a class name cannot hold the "-" of a key). Assertions are plain assert statements and
// with pytest.raises(...) blocks.
export const name = 'pytest'

// A decorator line and the lines a long decorator wraps onto (none starts a decorator, def or class).
const STOP = String.raw`[ \t]*(?:@|(?:async[ \t]+)?def[ \t]|class[ \t])`
const DECO = String.raw`@[^\n]*\n(?:(?!${STOP})[^\n]*\n)*?[ \t]*`
// A test's def line, then its body up to a "pytest." call: the body ends at the next decorator, def or class.
const BODY = String.raw`(?:${DECO})*(?:async[ \t]+)?def[ \t]+test\w*[^\n]*\n(?:(?!${STOP})[^\n]*\n)*?(?!${STOP})[^\n#]*?\bpytest\.`
const MARK = String.raw`(?:${DECO})*?@[\w.]*?\.`

/**
 * Top-level group (column 0): a class or a function, so a top-level test after a class is outside that
 * class's block. m[1] = its decorators (a .skip there skips the class), m[3] = its title: the class
 * docstring's first line, else the name.
 */
export const groupRe = new RegExp(
  String.raw`(?<![^\n])((?:@[^\n]*\n(?:(?!(?:@|(?:async[ \t]+)?def[ \t]|class[ \t]))[^\n]*\n)*?)*)(?:async[ \t]+)?(?:class|def)[ \t]+` +
  String.raw`(?:(?<=class[ \t]+)\w+[^\n]*:[ \t]*(?:#[^\n]*)?\n(?:[ \t]*(?:#[^\n]*)?\n)*[ \t]+[rRuU]?("""|'''|"|')(?:[ \t]*\n)?[ \t]*)?` +
  String.raw`((?<=(?:"""|'''|"|')\s*)[^\n]*?(?=[ \t]*(?:\2|\n|$))|\w+)`, 'gm')

/**
 * A test: m[1] = its mark (skip for skip and skipif, xfail, parametrize; a skip or xfail call in the body
 * counts as the mark), m[3] = the function name. The mark is read from a lookahead, strongest first.
 */
const TEST = new RegExp(
  String.raw`(?<![^\n])[ \t]*(?:(?=(?:${MARK}(?=skip)|${BODY}(?=skip\s*\()|${MARK}(?=xfail\b)|${BODY}(?=xfail\s*\()|${MARK}(?=parametrize\b))(skip|xfail|parametrize))|)` +
  String.raw`(?:${DECO})*(async[ \t]+)?def[ \t]+(test\w*)`, 'g')

export const honesty = {
  removedDecl: /(?<![\w.])(?:(?:async\s+)?def\s+test\w*|class\s+Test\w*)\b/,
  forgiveMoves: false,
  anchorTags: false,
}

/** A removed line that held an assertion (the honesty check's "assertion removed"). */
export const removedAssertion = /(?<![\w.])assert\b|\b(?:pytest\.)?(?:raises|approx|fail)\s*\(|\.assert[A-Z]\w*\s*\(/

/** Added lines that stop a test from running or failing, besides the shared .skip( forms. */
export const skipMarks = [/@(?:\w+\.)*mark\.(?:skip(?:if)?|xfail)\b/, /\bpytest\.(?:skip|xfail|importorskip)\s*\(/]

// ---- A small Python lexer: what is code, what is a string, what is a comment. ----

const STR_START = /^([rRbBuUfF]{0,2})("""|'''|"|')/

/**
 * The source with every string's content and every comment blanked to spaces (newlines kept), so
 * offsets stay the same and "assert" in a docstring or a comment is never read as code. Also returns
 * the string literals: { start, end, prefix, quote } (start at the prefix, end past the closing quote),
 * and bare: the source with only its comments blanked.
 */
export function lex(src) {
  const out = src.split('')
  const bare = src.split('')
  const strings = []
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '#') {
      for (; i < src.length && src[i] !== '\n'; i++) out[i] = bare[i] = ' '
      i--
      continue
    }
    // A prefix only starts a string at a word start: the "f" of "if" is no prefix.
    const atWord = i === 0 || !/[\w]/.test(src[i - 1])
    const m = (c === '"' || c === "'" || (atWord && /[rRbBuUfF]/.test(c))) ? STR_START.exec(src.slice(i, i + 5)) : null
    if (!m) continue
    const start = i
    const q = m[2]
    let j = i + m[0].length
    for (; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue }
      if (q.length === 1 && src[j] === '\n') break
      if (src.startsWith(q, j)) break
    }
    const end = Math.min(src.length, j + (src.startsWith(q, j) ? q.length : 0))
    for (let k = i + m[0].length; k < end - (src.startsWith(q, j) ? q.length : 0); k++) if (src[k] !== '\n') out[k] = ' '
    strings.push({ start, end, prefix: m[1], quote: q })
    i = end - 1
  }
  return { code: out.join(''), bare: bare.join(''), strings }
}

const OPEN = { '(': ')', '[': ']', '{': '}' }

/** Index past the bracket closing the one at `open`, in lexed code. */
function closeOf(code, open) {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (OPEN[code[i]]) depth++
    else if (code[i] === ')' || code[i] === ']' || code[i] === '}') { if (--depth === 0) return i + 1 }
  }
  return code.length
}

/** The bracket depth at `at`, counted from `from` (lexed code). */
function depthAt(code, from, at) {
  let depth = 0
  for (let i = from; i < at; i++) {
    if (OPEN[code[i]]) depth++
    else if (code[i] === ')' || code[i] === ']' || code[i] === '}') depth--
  }
  return depth
}

/** End of the logical line that starts at `from`: a newline outside brackets and not after a "\". */
function lineEnd(code, from) {
  let depth = 0
  for (let i = from; i < code.length; i++) {
    const c = code[i]
    if (OPEN[c]) depth++
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (c === ';' || (c === '\n' && code[i - 1] !== '\\'))) return i
  }
  return code.length
}

/** Top-level commas and comparison operators of an expression (lexed), outside brackets. */
function topLevel(code) {
  const commas = []
  let compare = null
  let depth = 0
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (OPEN[c]) { depth++; continue }
    if (c === ')' || c === ']' || c === '}') { depth--; continue }
    if (depth) continue
    if (c === ',') { commas.push(i); continue }
    if (compare) continue
    const rest = code.slice(i)
    const word = i === 0 || /[^\w.]/.test(code[i - 1])
    let m = null
    if (word && (m = /^not[ \t]+in\b/.exec(rest))) compare = { at: i, op: m[0], to: 'in' }
    else if (word && (m = /^is[ \t]+not\b/.exec(rest))) compare = { at: i, op: m[0], to: 'is' }
    else if (word && (m = /^in\b/.exec(rest))) compare = { at: i, op: m[0], to: 'not in' }
    else if (word && (m = /^is\b/.exec(rest))) compare = { at: i, op: m[0], to: 'is not' }
    else if ((m = /^(?:==|!=|<=|>=)/.exec(rest))) compare = { at: i, op: m[0], to: { '==': '!=', '!=': '==', '<=': '>', '>=': '<' }[m[0]] }
    else if ((m = /^[<>](?![<>=])/.exec(rest)) && code[i - 1] !== '<' && code[i - 1] !== '>' && code[i - 1] !== '-') compare = { at: i, op: m[0], to: m[0] === '<' ? '>=' : '<=' }
  }
  return { commas, compare }
}

/**
 * The assertions of a source, in order: { kind: 'assert'|'raises', start, end, expr: [a, b] }. An assert
 * runs to the end of its logical line; expr is its expression, without the message after a top-level
 * comma. A raises is the pytest.raises(...) call of a with statement.
 */
export function assertions(src) {
  const { code } = lex(src)
  const out = []
  for (const m of code.matchAll(/(?<=(?:^|[\n;:])[ \t]*)assert\b|\bwith[ \t]+((?:pytest\.)?raises)\s*\(|(?<![\w.])(?:pytest\.)?(?:raises|fail)\s*\(|\.assert[A-Z]\w*\s*\(/g)) {
    if (m[0].startsWith('assert')) {
      const end = trimEnd(code, lineEnd(code, m.index))
      const from = m.index + 6
      const { commas } = topLevel(code.slice(from, end))
      out.push({ kind: 'assert', start: m.index, end, expr: [from, commas.length ? from + commas[0] : end] })
    } else if (m[1]) {
      const start = m.index + m[0].indexOf(m[1])
      const end = closeOf(code, m.index + m[0].length - 1)
      out.push({ kind: 'raises', start, end, expr: [start, end] })
    } else {
      // pytest.raises(X, fn) as a call, pytest.fail(...), self.assertEqual(...): assertions mutation cannot flip.
      out.push({ kind: 'other', start: m.index, end: closeOf(code, m.index + m[0].length - 1), expr: null })
    }
  }
  // A "with raises(" is also matched by the call pattern: keep the with statement's.
  return out.filter((a, i) => !(a.kind === 'other' && out.some((b, j) => j !== i && b.kind === 'raises' && a.start >= b.start && a.start < b.end)))
}

function trimEnd(code, end) {
  while (end > 0 && /\s/.test(code[end - 1])) end--
  return end
}

/** The number of assertions in a test's text: assert statements, pytest.raises, pytest.fail and self.assert*(. */
export const countAssertions = body => assertions(body).length

// ---- Mutation ----

// Strongest first: inverting an assertion is the definitive "does it bind anything" mutant.
const mutantRank = k => (k === 'invert-assert' || k === 'true→false' || k === 'drop-raises' ? 0 : k === 'num→n+1' ? 1 : 2)

const NUM = /(?<![\w.])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])/

/** The mutants of one assertion's text (an assert statement, or a pytest.raises(...) call). */
export function flipMutations(text) {
  const out = []
  const add = (kind, t) => { if (t !== text) out.push({ kind, text: t }) }
  const { code, strings } = lex(text)
  if (/^(?:pytest\.)?raises\s*\(/.test(text)) {
    // No exception expected any more: the code under test must raise for the test to pass.
    add('drop-raises', '__import__("contextlib").nullcontext()')
    return out
  }
  if (!/^assert\b/.test(text)) return out
  const from = text.slice(6).search(/\S/) + 6
  const { commas, compare } = topLevel(code.slice(from))
  const exprEnd = commas.length ? from + commas[0] : text.length
  const expr = text.slice(from, exprEnd)
  add('invert-assert', `assert not (${expr.trimEnd()})${text.slice(from + expr.trimEnd().length)}`)
  if (!compare) return out
  const opAt = from + compare.at
  const opEnd = opAt + compare.op.length
  const left = [from, opAt]
  const right = [opEnd, exprEnd]
  const rightText = text.slice(...right)
  if (/^\s*(?:True|False)\s*$/.test(rightText) && /^(?:==|is|!=|is[ \t]+not)$/.test(compare.op)) {
    add('true→false', `${text.slice(0, opEnd)}${rightText.replace(/True|False/, b => (b === 'True' ? 'False' : 'True'))}${text.slice(exprEnd)}`)
  }
  add('flip-compare', `${text.slice(0, opAt)}${compare.to}${text.slice(opEnd)}`)
  // The compared literal: the right operand's first, else a bare one on the left (not a subscript or
  // an argument there: result[0] and total([40]) are no expected values).
  const bare = (at, [a]) => a === opEnd || depthAt(code, a, at) === 0
  for (const range of [right, left]) {
    const m = [...code.slice(...range).matchAll(new RegExp(NUM.source, 'g'))].find(x => bare(range[0] + x.index, range))
    if (!m) continue
    const at = range[0] + m.index
    add('num→n+1', `${text.slice(0, at)}${Number(m[0]) + 1}${text.slice(at + m[0].length)}`)
    break
  }
  for (const range of [right, left]) {
    const [a, b] = range
    const s = strings.find(x => x.start >= a && x.end <= b && bare(x.start, range) && !/[bB]/.test(x.prefix) && x.end - x.start > x.prefix.length + 2 * x.quote.length)
    if (!s) continue
    const close = s.end - s.quote.length
    add('corrupt-string', `${text.slice(0, close)}★MUT${text.slice(close)}`)
    break
  }
  return out
}

/** Every passed title of a test: its own, or its parametrized cases' (test_total[a-1]). */
const ran = (title, passed) => passed.has(title) || [...passed].some(p => p.startsWith(`${title}[`))

/** A block mutation judges: it ran green (all its cases, for a parametrized test), not skipped nor xfail. */
const eligible = (block, passed) => block.mod !== 'skip' && block.mod !== 'xfail' && ran(block.title, passed)

/** One mutant per assertion (the strongest) unless thorough; baseline-green tests only, inside the range. */
function plan({ src, passedTitles, range, thorough, blocks }) {
  const passed = new Set(passedTitles)
  const all = []
  for (const a of assertions(src)) {
    if (a.kind === 'other') continue
    if (range && (a.start < range[0] || a.start >= range[1])) continue
    const block = blocks.find(b => a.start >= b.start && a.start < b.end)
    if (!block || !eligible(block, passed)) continue
    const original = src.slice(a.start, a.end)
    for (const flip of flipMutations(original)) {
      all.push({ title: block.title, start: a.start, end: a.end, kind: flip.kind, replacement: flip.text, snippet: `${flip.kind}: ${original.replace(/\s+/g, ' ').slice(0, 60)}` })
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

// ---- The value check ----

/** The text with the arguments of every call blanked: f(80) == 72 pins 72, not 80. */
function blankCalls(text) {
  const { code } = lex(text)
  const out = text.split('')
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '(' || !/[\w)\]]\s*$/.test(code.slice(Math.max(0, i - 40), i))) continue
    const end = closeOf(code, i)
    for (let k = i + 1; k < end - 1; k++) out[k] = ' '
    i = end - 1
  }
  return out.join('')
}

/**
 * The value check's reading of a key block: the expression of every assert (its message is no
 * assertion) and the arguments of every pytest.raises. actual: false leaves out what the test feeds
 * in: the call arguments of the left operand of a comparison (write actual == expected).
 */
function surface(block, { actual = true } = {}) {
  const clean = lex(block).bare
  const parts = []
  for (const a of assertions(block)) {
    if (!a.expr) continue
    const text = clean.slice(...a.expr)
    if (actual || a.kind === 'raises') { parts.push(text); continue }
    const { compare } = topLevel(lex(text).code)
    parts.push(compare ? `${blankCalls(text.slice(0, compare.at))}${text.slice(compare.at)}` : blankCalls(text))
  }
  return parts.join('\n')
}

// The value check: a field the ticket names must be read in an assertion (unit tests read fields).
export const expected = { fieldNames: true, surface }

export const suite = {
  testRe: TEST,
  notYet: 'xfail',
  skippedGroups: true,
}

export const mutation = {
  // A copy next to the spec runs as a module of its own: the temp-copy path, as for Vitest.
  inPlace: false,
  expectRe: /(?<![\w.])assert\b|\bwith[ \t]+(?:pytest\.)?raises\s*\(/,
  testRe: TEST,
  rank: mutantRank,
  flips: flipMutations,
  eligible,
  plan,
}

// ---- Where a test is, for the runner ----

/** The title of each top-level class, by name: its docstring's first line, else its name. */
export function classTitles(src) {
  const out = new Map()
  for (const m of src.matchAll(new RegExp(groupRe.source, 'gm'))) {
    const cls = /(?:^|\n)(?:async[ \t]+)?class[ \t]+(\w+)/.exec(m[0].slice(m[1].length))
    if (cls) out.set(cls[1], m[3] || cls[1])
  }
  return out
}

/** The tests of a source with the classes around each: [{ name, classes: ['TestA', 'TestNested'] }]. */
export function locate(src) {
  const { code } = lex(src)
  const stack = []
  const out = []
  for (const m of code.matchAll(/(?<![^\n])([ \t]*)(?:(class)[ \t]+(\w+)|(?:async[ \t]+)?def[ \t]+(\w+))/g)) {
    const indent = m[1].replace(/\t/g, '        ').length
    while (stack.length && stack.at(-1).indent >= indent) stack.pop()
    if (m[2]) stack.push({ indent, name: m[3] })
    else {
      if (/^test/.test(m[4])) out.push({ name: m[4], classes: stack.map(s => s.name) })
      // A def opens a scope too: a class inside a function holds no collected test.
      stack.push({ indent, name: null })
    }
  }
  return out.filter(t => !t.classes.includes(null))
}
