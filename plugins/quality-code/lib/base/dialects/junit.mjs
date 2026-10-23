// JUnit syntax (Java and Kotlin, JUnit 5 with JUnit 4 tolerated), as the backend checks read it.
// A test is a method annotated @Test, @ParameterizedTest, @RepeatedTest, @TestFactory or
// @TestTemplate; its title is the method name, as the runner reports it. A top-level class is a
// group, titled by its @DisplayName: the ticket's block is @DisplayName("<KEY> …") on the class.
export const name = 'junit'

// A Java or Kotlin string literal, an annotation's argument list, one annotation (@Tag("x"),
// @field:Mock, @org.junit.jupiter.api.Test).
const STR = String.raw`"(?:[^"\\\n]|\\.)*"`
const ARGS = String.raw`\((?:${STR}|[^()"]|\((?:${STR}|[^()"])*\))*\)`
const ANNO = String.raw`@(?:\w+:)?[\w.]+(?:\s*${ARGS})?`
const ANNOS = String.raw`(?:${ANNO}\s*)*`
const TEST_ANNO = String.raw`@(?:org\.junit\.(?:jupiter\.api\.|jupiter\.params\.)?)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b(?:\s*${ARGS})?`
const MODS = String.raw`(?:(?:public|protected|private|internal|static|final|override|open|suspend|abstract|synchronized)\s+)*`
// A Java return type (void, String, Stream<DynamicTest>) or Kotlin's fun.
const RET = String.raw`(?:<[^>\n]*>\s*)?[\w.$]+(?:\s*<[^\n{;]*?>)?(?:\s*\[\s*\])*\s+`
// A not-yet marker: @Disabled("TODO …"). Any other @Disabled or @Ignore is a skip.
const TODO_REASON = String.raw`\s*\(\s*(?:value\s*=\s*)?"\s*[Tt][Oo][Dd][Oo]`
const DISABLED = String.raw`@(?:[\w.]+\.)?`

/**
 * A test mark (no m flag: testMarks drops it, so a line start is "no character but a newline before").
 * Named groups: skip (group 1) and todo (group 2) from the method's annotations; m[3] = the method name
 * (a Kotlin `name with spaces` without its backticks). No group 4: there is no each/for form.
 */
const TEST = new RegExp(String.raw`(?<![^\n])[ \t]*` +
  String.raw`(?:(?=${ANNOS}?${DISABLED}(?<skip>Disabled|Ignore)\b(?!${TODO_REASON}))|)` +
  String.raw`(?:(?=${ANNOS}?${DISABLED}Disabled${TODO_REASON.replace('[Tt][Oo][Dd][Oo]', '(?<todo>[Tt][Oo][Dd][Oo])')})|)` +
  String.raw`${ANNOS}?${TEST_ANNO}\s*${ANNOS}${MODS}${RET}` + '`?((?<=`)[^`\\n]+|[\\w$]+)`?\\s*\\(', 'g')

const CLASS_MODS = String.raw`(?:(?:public|protected|private|internal|abstract|final|open|sealed|data|static|strictfp)\s+)*`

/**
 * Top-level group: a class at column 0. m[1] is empty (no modifier chain: a skip is the named group
 * skip, @Disabled or @Ignore on the class), m[3] = its @DisplayName, the class name is the group cls.
 */
export const groupRe = new RegExp(String.raw`^()` +
  String.raw`(?:(?=${ANNOS}?${DISABLED}(?<skip>Disabled|Ignore)\b)|)` +
  String.raw`(?:(?=${ANNOS}?${DISABLED}DisplayName\s*\(\s*(?:value\s*=\s*)?"((?:[^"\\\n]|\\.)*)")|)` +
  String.raw`${ANNOS}${CLASS_MODS}(?:class|object)\s+(?<cls>\w+)`, 'gm')

// Assertion calls: JUnit 5 and 4 (assertEquals, assertThrows, fail), kotlin.test (assertEquals,
// assertFailsWith<…> { }), Mockito's verify, AssertJ / Hamcrest / Truth assertThat, kotest should*,
// Java's assert keyword.
const ASSERT_CALL = /(?<![\w$])(?:assert(?!That)[A-Z]\w*|fail|verify\w*)\s*(?:<[^>\n]*>\s*)?[({]/g
const ASSERT_THAT = /(?<![\w$])assertThat\w*\s*\(/g
const KOTEST = /(?<![\w$])should(?:Not)?[A-Z]\w*\b/g
const ASSERT_KEYWORD = /(?<![\w$.])assert\b(?=\s*[(\w!])/g

export const honesty = {
  // A removed test annotation, @Nested, or a test class declaration.
  removedDecl: /@(?:[\w.]+\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate|Nested)\b|(?<![\w.:])(?:class|object)\s+\w*(?:Test|Tests|IT)\b/,
  // A removed line holding an assertion (the shared check reads expect( otherwise).
  assertRe: /(?<![\w$])(?:assert[A-Z]\w*|assertThat\w*|fail|verify\w*)\s*(?:<[^>\n]*>\s*)?[({]|(?<![\w$])should(?:Not)?[A-Z]\w*\b|(?<![\w$.])assert\b(?=\s*[(\w!])/,
  // An added line that stops a test from running: @Disabled (not a TODO), @Ignore, a condition, an assumption.
  skipRe: new RegExp(String.raw`@(?:[\w.]+\.)?(?:(?:Disabled|Ignore)\b(?!${TODO_REASON})|DisabledIf\w*|DisabledOn\w*|DisabledFor\w*|EnabledIf\w*|EnabledOn\w*|EnabledFor\w*)|(?<![\w$.])assum(?:e(?:True|False|That)|ingThat)\s*\(`),
  forgiveMoves: false,
  anchorTags: false,
}

// The value check: a field the ticket names must be read in an assertion (unit tests read fields).
// JUnit asserts take the expected value as an argument (assertEquals(108, total)), so the whole call
// is read; AssertJ and kotest matchers are read after their dot (.isEqualTo(108), .shouldBe(108)).
export const expected = {
  fieldNames: true,
  readsActual: true,
  calls: ['assertEquals', 'assertNotEquals', 'assertArrayEquals', 'assertIterableEquals', 'assertLinesMatch', 'assertSame', 'assertTrue', 'assertFalse', 'assertThrows',
    'equalTo', 'is', 'closeTo', 'hasSize', 'containsString', 'hasItem', 'hasItems', 'hasEntry', 'contains', 'containsInAnyOrder', 'startsWith', 'endsWith'],
  matchers: ['isEqualTo', 'isEqualByComparingTo', 'isCloseTo', 'contains', 'containsExactly', 'containsExactlyInAnyOrder', 'containsOnly', 'containsEntry', 'hasSize',
    'hasMessage', 'hasMessageContaining', 'startsWith', 'endsWith', 'isGreaterThan', 'isGreaterThanOrEqualTo', 'isLessThan', 'isLessThanOrEqualTo', 'extracting',
    'shouldBe', 'shouldContain', 'shouldHaveSize', 'shouldStartWith', 'shouldEndWith', 'shouldContainExactly'],
}

/** The code with every comment and string literal blanked (same length, newlines kept): parens and keywords in a string are not read. */
export function mask(src) {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '"' && src.startsWith('"""', i)) {
      const e = src.indexOf('"""', i + 3)
      // A text block is blanked whole, its quotes too: no mutant writes into one.
      const end = e < 0 ? src.length : e + 3
      out += src.slice(i, end).replace(/[^\n]/g, ' ')
      i = end - 1
    } else if (c === '"' || c === "'") {
      out += c
      for (i++; i < src.length && src[i] !== c && src[i] !== '\n'; i++) {
        if (src[i] === '\\') { out += ' '; i++ }
        out += ' '
      }
      if (i < src.length) out += src[i]
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++ }
      if (i < src.length) out += '\n'
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      const end = e < 0 ? src.length : e + 2
      out += src.slice(i, end).replace(/[^\n]/g, ' ')
      i = end - 1
    } else out += c
  }
  return out
}

/** Index just past the ")" closing the "(" at `open`, in masked code. */
function closeAt(code, open) {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')' && --depth === 0) return i + 1
  }
  return code.length
}

/** The top-level comma positions inside the parens that open at `open` (masked code). */
function topCommas(code, open) {
  const out = []
  let depth = 0
  for (let i = open; i < code.length; i++) {
    const c = code[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { if (--depth === 0) break }
    else if (c === ',' && depth === 1) out.push(i)
  }
  return out
}

/**
 * Assertions in a test body: a JUnit or kotlin.test assert call, fail(…), Mockito verify, a kotest
 * should*, Java's assert, and assertThat when it asserts something: an AssertJ chain
 * (assertThat(x).isEqualTo(…)) or a Hamcrest matcher argument (assertThat(x, is(…))). A bare
 * assertThat(x) asserts nothing. assumeTrue is no assertion: it only skips.
 */
export function countAssertions(body) {
  const code = mask(body)
  let n = (code.match(ASSERT_CALL) || []).length + (code.match(KOTEST) || []).length + (code.match(ASSERT_KEYWORD) || []).length
  for (const m of code.matchAll(ASSERT_THAT)) {
    const open = m.index + m[0].length - 1
    if (topCommas(code, open).length || /^\s*\.\s*\w+\s*(?:<[^>\n]*>\s*)?\(/.test(code.slice(closeAt(code, open)))) n++
  }
  return n
}

export const suite = {
  testRe: TEST,
  notYet: 'todo',
  skippedGroups: true,
  countAssertions,
}

const ANNO_BLOCK_END = new RegExp(String.raw`(${ANNOS})(?:(?:public|protected|private|internal|abstract|final|open|sealed|data|static|strictfp|inner)\s+)*$`)
const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', s: ' ' }
/** A Java or Kotlin string literal's text as the program sees it: \" is ", à is à. */
const unescape = s => s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e) => (e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : ESCAPES[e] ?? e))
const displayNameIn = text => {
  const raw = /@(?:[\w.]+\.)?DisplayName\s*\(\s*(?:value\s*=\s*)?"((?:[^"\\\n]|\\.)*)"/.exec(text)?.[1]
  return raw === undefined ? null : unescape(raw)
}

/**
 * The classes and tests of a spec: { pkg, classes: [{ name, binary, parent, displayName, start, end }],
 * tests: [{ title, displayName, idx, cls }] }. binary is the class's name below the package as the
 * JVM knows it (Outer$Inner); cls is the binary name of the class declaring the test.
 */
export function structure(src) {
  const code = mask(src)
  const pkg = /^\s*package\s+([\w.]+)/m.exec(code)?.[1] ?? ''
  const classes = []
  for (const m of code.matchAll(/(?<![\w$.:])(?:class|object)\s+([A-Za-z_$][\w$]*)/g)) {
    const after = m.index + m[0].length
    const brace = code.indexOf('{', after)
    if (brace < 0) continue
    // A class without a body (Kotlin data class P(val a: Int)) must not take the next class's braces.
    let head = code.slice(after, brace)
    for (let prev = ''; prev !== head;) { prev = head; head = head.replace(/\([^()]*\)/g, '') }
    if (/[;}@=]|\b(?:class|object|fun|val|var|interface)\b/.test(head)) continue
    let depth = 0
    let end = code.length
    for (let i = brace; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}' && --depth === 0) { end = i + 1; break }
    }
    const before = ANNO_BLOCK_END.exec(src.slice(Math.max(0, m.index - 4000), m.index))?.[1] ?? ''
    classes.push({ name: m[1], start: m.index, bodyStart: brace, end, displayName: displayNameIn(before) })
  }
  const innermost = idx => classes.filter(c => idx > c.bodyStart && idx < c.end).sort((a, b) => b.bodyStart - a.bodyStart)[0] ?? null
  for (const c of classes) {
    const p = innermost(c.start)
    c.parent = p ? p.name : null
    c.parentRef = p
  }
  for (const c of classes) {
    const chain = []
    for (let k = c; k; k = k.parentRef) chain.unshift(k.name)
    c.binary = chain.join('$')
  }
  const tests = []
  for (const m of src.matchAll(new RegExp(TEST.source, 'g'))) {
    // A mark inside a comment or a string is no test.
    if (!code.slice(m.index, m.index + m[0].length).includes('@')) continue
    const c = innermost(m.index)
    tests.push({ title: m[3], displayName: displayNameIn(m[0]), idx: m.index, cls: c ? c.binary : null })
  }
  return { pkg, classes: classes.map(({ parentRef, bodyStart, ...c }) => c), tests }
}

// Strongest first: inverting an assertion is the definitive "does it bind anything" mutant.
const mutantRank = k => (k === 'invert-assert' || k === 'invert-matcher' || k === 'swap-exception' ? 0 : k === 'num→n+1' ? 1 : 2)

// JUnit and kotlin.test asserts with an opposite; AssertJ matchers with an opposite.
const JUNIT_OPPOSITE = { assertEquals: 'assertNotEquals', assertNotEquals: 'assertEquals', assertTrue: 'assertFalse', assertFalse: 'assertTrue', assertNull: 'assertNotNull', assertNotNull: 'assertNull', assertSame: 'assertNotSame', assertNotSame: 'assertSame' }
const ASSERTJ_OPPOSITE = {
  isEqualTo: 'isNotEqualTo', isNotEqualTo: 'isEqualTo', isTrue: 'isFalse', isFalse: 'isTrue', isNull: 'isNotNull', isNotNull: 'isNull',
  isEmpty: 'isNotEmpty', isNotEmpty: 'isEmpty', isBlank: 'isNotBlank', isNotBlank: 'isBlank', contains: 'doesNotContain', doesNotContain: 'contains',
  containsKey: 'doesNotContainKey', doesNotContainKey: 'containsKey', startsWith: 'doesNotStartWith', endsWith: 'doesNotEndWith', matches: 'doesNotMatch',
  isInstanceOf: 'isNotInstanceOf', isSameAs: 'isNotSameAs', isZero: 'isNotZero', isNotZero: 'isZero', isPresent: 'isEmpty',
  isGreaterThan: 'isLessThanOrEqualTo', isLessThan: 'isGreaterThanOrEqualTo', isGreaterThanOrEqualTo: 'isLessThan', isLessThanOrEqualTo: 'isGreaterThan',
  isEqualToIgnoringCase: 'isNotEqualToIgnoringCase', isEqualByComparingTo: 'isNotEqualByComparingTo',
}
// Asserts whose first argument is the expected value.
const EXPECTED_FIRST = /^(?:assertEquals|assertNotEquals|assertArrayEquals|assertIterableEquals|assertLinesMatch|assertSame|assertNotSame)$/
// An exception no code under test throws: assertThrows(it) fails whatever the code does.
const NO_SUCH_THROW = 'java.lang.annotation.AnnotationFormatError.class'

const NUMBER = /(?<![\w.$])(-?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)([LlFfDd]?)(?![\w.])/

/** Adds 1 to the first number of `part` outside a string, keeping its decimals and suffix. */
function bumpNumber(part) {
  const m = NUMBER.exec(mask(part))
  if (!m) return part
  const raw = m[1].replace(/_/g, '')
  const dec = /\.(\d+)/.exec(raw)?.[1].length ?? 0
  return `${part.slice(0, m.index)}${(Number(raw) + 1).toFixed(dec)}${m[2]}${part.slice(m.index + m[0].length)}`
}

/** Puts #MUT at the end of the first non-empty string literal of `part` (not a text block). */
function corruptString(part) {
  const code = mask(part)
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '"') continue
    if (code.startsWith('"""', i)) return part
    const close = code.indexOf('"', i + 1)
    if (close < 0) return part
    if (close > i + 1 && !part.slice(i + 1, close).includes('#MUT')) return `${part.slice(0, close)}#MUT${part.slice(close)}`
    i = close
  }
  return part
}

/**
 * The mutants of one assertion statement, strongest first by rank. opposite(fn, name): how the spec
 * calls the opposite assert (see oppositeIn). standalone: the statement's value is
 * not kept (no "x = assertThrows(…)"), so assertThrows may expect an exception nothing throws.
 */
export function flipMutations(src, { standalone = true, opposite = (fn, name) => name } = {}) {
  const out = []
  const add = (kind, text) => { if (text !== src && !out.some(o => o.text === text)) out.push({ kind, text }) }
  const code = mask(src)
  const at = (part, from, to) => `${src.slice(0, from)}${part(src.slice(from, to))}${src.slice(to)}`
  // kotest: x shouldBe y, x.shouldBe(y): toggle the Not; what follows the matcher is the expected value.
  const kt = /^\s*(?:[\w.]+\.)?assert\w*\s*\(/.test(code) ? null : /(?<![\w$])should(Not)?([A-Z]\w*)\b/.exec(code)
  if (kt && !/^Throw/.test(kt[2])) {
    const flipped = kt[1] ? `should${kt[2]}` : `shouldNot${kt[2]}`
    add('invert-matcher', `${src.slice(0, kt.index)}${flipped}${src.slice(kt.index + kt[0].length)}`)
    const from = kt.index + kt[0].length
    add('num→n+1', at(bumpNumber, from, src.length))
    add('corrupt-string', at(corruptString, from, src.length))
    return out
  }
  const call = /(?<![\w$])((?:[\w.]+)\.)?(assert\w*)\s*\(/.exec(code)
  if (!call) return out
  const fn = call[2]
  const nameAt = call.index + call[0].indexOf(fn)
  const open = call.index + call[0].length - 1
  const close = closeAt(code, open)
  const commas = topCommas(code, open)
  // A qualified call (Assertions.assertEquals) takes the opposite's bare name; a bare one, how the spec can call it.
  if (JUNIT_OPPOSITE[fn]) add('invert-assert', `${src.slice(0, nameAt)}${call[1] ? JUNIT_OPPOSITE[fn] : opposite(fn, JUNIT_OPPOSITE[fn])}${src.slice(nameAt + fn.length)}`)
  if (fn === 'assertThrows' && standalone) {
    const cls = /^\s*[\w.$]+\.class\s*(?=,)/.exec(src.slice(open + 1))
    if (cls) add('swap-exception', `${src.slice(0, open + 1)}${cls[0].match(/^\s*/)[0]}${NO_SUCH_THROW}${src.slice(open + 1 + cls[0].length)}`)
  }
  if (EXPECTED_FIRST.test(fn)) {
    const end = commas[0] ?? close - 1
    add('num→n+1', at(bumpNumber, open + 1, end))
    add('corrupt-string', at(corruptString, open + 1, end))
  } else if (/^assertThat/.test(fn) && commas.length) {
    // Hamcrest: the matcher is the last argument; not(…) inverts it, by its full name so no import is needed.
    const from = commas.at(-1) + 1
    const lead = /^\s*/.exec(src.slice(from))[0].length
    add('invert-matcher', `${src.slice(0, from + lead)}org.hamcrest.CoreMatchers.not(${src.slice(from + lead, close - 1).trimEnd()})${src.slice(close - 1)}`)
    add('num→n+1', at(bumpNumber, from, close - 1))
    add('corrupt-string', at(corruptString, from, close - 1))
  } else if (/^assertThat/.test(fn)) {
    // AssertJ: the first matcher of the chain with an opposite; its arguments hold the expected value.
    const re = /\.\s*(\w+)\s*(?=\()/g
    re.lastIndex = close
    let m
    while ((m = re.exec(code))) {
      if (!ASSERTJ_OPPOSITE[m[1]]) continue
      const s = m.index + m[0].indexOf(m[1])
      add('invert-matcher', `${src.slice(0, s)}${ASSERTJ_OPPOSITE[m[1]]}${src.slice(s + m[1].length)}`)
      break
    }
    add('num→n+1', at(bumpNumber, close, src.length))
    add('corrupt-string', at(corruptString, close, src.length))
  }
  return out
}

/** kotest assertions, infix (total shouldBe 108) or dotted (total.shouldBe(108)): the statement is the rest of the line. */
function kotestRanges(src) {
  const code = mask(src)
  const out = []
  for (const m of code.matchAll(/^([ \t]*)(\S[^\n]*?(?<![\w$])should(?:Not)?[A-Z]\w*\b[^\n]*)$/gm)) {
    if (/^(?:assert|fun\b|@)/.test(m[2]) || /(?<![\w$])should(?:Not)?Throw/.test(m[2])) continue
    const start = m.index + m[1].length
    out.push({ start, end: start + m[2].replace(/\s+$/, '').length })
  }
  return out
}

/**
 * How a spec can call the opposite of a statically imported assert: by its bare name when the spec
 * imports it (or the class's *), else by its full name (org.junit.jupiter.api.Assertions.assertNotEquals),
 * so a mutant compiles whatever the spec imports.
 */
export function oppositeIn(src) {
  const code = mask(src)
  const esc = s => s.replace(/[.$]/g, '\\$&')
  return (fn, name) => {
    const owner = new RegExp(`^\\s*import\\s+(?:static\\s+)?([\\w.]+)\\.${fn}\\b`, 'm').exec(code)?.[1]
    if (!owner) return name
    const has = new RegExp(`^\\s*import\\s+(?:static\\s+)?${esc(owner)}\\.(?:${name}\\b|\\*)`, 'm').test(code)
    return has ? name : `${owner}.${name}`
  }
}

/** A block mutation judges: it ran green, it is not disabled or a todo. */
const eligible = (block, passed) => block.mod !== 'todo' && block.mod !== 'skip' && passed.has(block.title)

/** One mutant per assertion (the strongest) unless thorough; baseline-green tests only, inside the range. */
function plan({ src, passedTitles, range, thorough, blocks, expects }) {
  const passed = new Set(passedTitles)
  // An assertion in a comment or a string is no assertion: the masked code has blanked it.
  const code = mask(src)
  const ranges = expects.filter(e => code[e.start] === src[e.start])
  for (const k of kotestRanges(src)) if (!ranges.some(e => k.start < e.end && e.start < k.end)) ranges.push(k)
  ranges.sort((a, b) => a.start - b.start)
  const all = []
  for (const ex of ranges) {
    if (range && (ex.start < range[0] || ex.start >= range[1])) continue
    const block = blocks.find(b => ex.start >= b.start && ex.start < b.end)
    if (!block || !eligible(block, passed)) continue
    const original = src.slice(ex.start, ex.end)
    const lineStart = src.lastIndexOf('\n', ex.start - 1) + 1
    const standalone = /^\s*$/.test(src.slice(lineStart, ex.start))
    for (const flip of flipMutations(original, { standalone, opposite: oppositeIn(src) })) {
      all.push({ title: block.title, start: ex.start, end: ex.end, kind: flip.kind, replacement: flip.text, snippet: `${flip.kind}: ${original.replace(/\s+/g, ' ').slice(0, 60)}` })
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
  // A compiled language: a mutated copy next to the spec would not compile (a duplicate class or
  // function), so the spec itself is mutated and always restored (see checks/mutation.mjs).
  inPlace: true,
  expectRe: /(?<![\w$])(?:(?:org\.junit\.jupiter\.api\.)?(?:Assertions|Assert)\.)?(?:assert(?:Equals|NotEquals|True|False|Null|NotNull|Same|NotSame|ArrayEquals|IterableEquals|LinesMatch|Throws)|assertThat)\s*\(/,
  testRe: TEST,
  rank: mutantRank,
  flips: flipMutations,
  eligible,
  plan,
}
