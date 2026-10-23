// .NET syntax (C#: xUnit, NUnit, MSTest, FluentAssertions), as the backend checks read it.
// A test is a method under a test attribute; a group is a test class. The ticket's block is the class
// right under a "// <KEY> <summary>" comment line (attributes and other comment lines may sit between):
// C# has no class title, so the comment is the title the checks and the runner read.
export const name = 'dotnet'

// The words in front of "class": access, sealed, partial, … as a C# file writes them.
const MODS = String.raw`(?:(?:public|internal|private|protected|sealed|static|abstract|partial|file|unsafe|new)\s+)*`
const CLASS = String.raw`${MODS}(?:class|record(?:\s+class)?)\s+`
// One line between a key comment and its class: an attribute, a comment, or nothing.
const BETWEEN = String.raw`[ \t]*(?:\[[^\n]*\]|\/\/[^\n]*)?[ \t]*\r?\n`
// A ticket key at the start of the comment: ABC-123.
const KEY_START = String.raw`(?=[A-Z][A-Z0-9_]*-\d+\b)`

/**
 * Top-level group: a test class. m[1] = modifier chain (none in C#), m[3] = title: the key comment
 * above the class (from the key to the end of its line), else the class name. m[4] = the class name
 * when a key comment titles it.
 */
export const groupRe = new RegExp(String.raw`(?<![^\n])[ \t]*()()(?:\/\/\/?[ \t]*(?:<summary>[ \t]*)?${KEY_START}|${CLASS})([^\n]*?)(?:(?<=\/\/[^\n]*)[ \t]*(?:<\/summary>)?[ \t]*\r?\n(?:${BETWEEN})*?[ \t]*${CLASS}(\w+)|(?<!\/\/[^\n]*)(?=\W))`, 'gm')

// The test attributes of xUnit, NUnit and MSTest (with or without the Attribute suffix).
const TEST_ATTR = String.raw`(?<![\w."])(?:Fact|Theory|SkippableFact|SkippableTheory|Test|TestCase|TestCaseSource|TestMethod|DataTestMethod)(?:Attribute)?\b(?!\s*=)`
// One attribute line, with the indent of the next line.
const ATTR_LINE = String.raw`\[[^\n]*\][ \t]*(?:\/\/[^\n]*)?\r?\n[ \t]*`
// A method declaration after its attributes: modifiers, a return type, the name.
const METHOD = String.raw`(?:(?:public|private|protected|internal|static|async|override|virtual|new|unsafe)\s+)*[\w.]+(?:<[^\n]*?>)?\??\s+(\w+)\s*(?:<[^\n>]*>)?\s*\(`

/**
 * A test mark: the attribute block of a test method, from its first attribute line. m[1] = Skip or
 * Ignore when the test does not run (modOf makes it "skip"), m[3] = the method name: the title the
 * runner reports, a theory's cases included.
 */
const testRe = new RegExp(String.raw`(?<![^\n])[ \t]*(?<!\][ \t]*(?:\/\/[^\n]*)?\r?\n[ \t]*)(?=\[)(?=(?:(?:${ATTR_LINE})*?[^\n]*?((?<![\w.])Skip(?=\s*=)|(?<=[[,]\s*)Ignore\b))?)(?=(?:${ATTR_LINE})*?\[[^\n]*?${TEST_ATTR})(?:${ATTR_LINE})+()${METHOD}`, 'g')

/** The mark's modifier as the checks know it: a Skip = "…" or an [Ignore] is a skip. */
export const modOf = raw => (raw === 'Skip' || raw === 'Ignore' ? 'skip' : raw || null)

export const honesty = {
  // A removed test attribute, test method or test class.
  removedDecl: new RegExp(String.raw`\[[^\n]*${TEST_ATTR}|(?<![\w.])(?:Test)?Fixture\b|\[TestClass\b|^\s*${CLASS}\w+`),
  // A removed assertion: an Assert call or a FluentAssertions Should().
  assertRe: /(?<![\w.])(?:Classic|String|Collection)?Assert\.\w+|\.Should\s*\(/,
  // A newly added skip: Skip = "…", [Ignore], [Ignore("…")].
  skipRe: /(?<![\w.])Skip\s*=|\[\s*(?:[^\]\n]*,\s*)?Ignore\b/,
  forgiveMoves: false,
  anchorTags: false,
}

// The value check: a field the ticket names must be read in an assertion (unit tests read fields). The
// call names whose arguments hold the expected value, as expected.mjs reads them (".Name(").
export const expected = {
  fieldNames: true,
  matchers: ['Equal', 'AreEqual', 'StrictEqual', 'Equivalent', 'That', 'EqualTo', 'EquivalentTo', 'Contains', 'StartsWith', 'EndsWith', 'Matches',
    'InRange', 'Throws', 'ThrowsAsync', 'ThrowsAny', 'True', 'False', 'IsTrue', 'IsFalse', 'Single',
    'Be', 'BeEquivalentTo', 'Contain', 'ContainSingle', 'ContainKey', 'HaveCount', 'StartWith', 'EndWith', 'Match', 'BeApproximately',
    'BeGreaterThan', 'BeLessThan', 'BeGreaterThanOrEqualTo', 'BeLessThanOrEqualTo', 'WithMessage', 'HaveValue', 'Verify'],
  // A number's type suffix is no part of its value: 13.50m, 2.5d, 10L read as 13.50, 2.5, 10.
  literals: text => text.replace(/(\d)(?:[mMdDfF]|[uU]?[lL]|[lL]?[uU])\b/g, '$1'),
}

/**
 * The code with every comment and string blanked out, the same length as the source: an Assert in a
 * string or a comment is not read, and an index in it is an index in the source.
 */
export function codeOnly(src) {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '@' && src[i + 1] === '"') {
      // A verbatim string: "" is a quote, a backslash is a backslash.
      out += '@"'
      for (i += 2; i < src.length; i++) {
        if (src[i] === '"' && src[i + 1] === '"') { i++; out += '  '; continue }
        if (src[i] === '"') break
        out += src[i] === '\n' ? '\n' : ' '
      }
      if (i < src.length) out += '"'
    } else if (c === '"' || c === "'") {
      out += c
      for (i++; i < src.length && src[i] !== c && src[i] !== '\n'; i++) { if (src[i] === '\\') { i++; out += ' ' } out += ' ' }
      // An unclosed text ends at its line.
      if (i < src.length) out += src[i] === '\n' ? '\n' : c
    } else if (c === '/' && src[i + 1] === '/') {
      for (; i < src.length && src[i] !== '\n'; i++) out += ' '
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

// An assertion call: Assert.X( (xUnit, NUnit, MSTest), StringAssert / CollectionAssert / ClassicAssert,
// FluentAssertions' .Should(, Moq's .Verify(. Assert.Multiple only groups others; Fail and Pass assert nothing.
const ASSERT_CALL = /(?<![\w.])(?:Classic|String|Collection)?Assert\.(?!Multiple\b|Fail\b|Pass\b|Inconclusive\b|Ignore\b|Skip\b)\w+(?:<[^\n()]*?>)?\s*\(|\.Should\s*\(|\.Verify\w*\s*\(/g

/** Assertions in a test body: each Assert call, Should() chain or Verify call; comments and strings are not read. */
export const countAssertions = body => (codeOnly(body).match(ASSERT_CALL) || []).length

export const suite = {
  testRe,
  modOf,
  countAssertions,
  // C# has no "not written yet" mark: an unfinished test is a skip with a ticket key in its reason.
  notYet: 'todo',
  skippedGroups: false,
}

// Strongest first: inverting an assertion is the definitive "does it bind anything" mutant.
const INVERT = new Set(['invert-assert', 'invert-should', 'drop-not', 'add-not', 'true→false', 'false→true'])
const mutantRank = k => (INVERT.has(k) ? 0 : k === 'num→n+1' ? 1 : 2)

// Assert method pairs (xUnit, NUnit classic, MSTest): each name and its opposite.
const ASSERT_PAIRS = [['Equal', 'NotEqual'], ['StrictEqual', 'NotStrictEqual'], ['AreEqual', 'AreNotEqual'], ['Same', 'NotSame'], ['AreSame', 'AreNotSame'],
  ['Null', 'NotNull'], ['IsNull', 'IsNotNull'], ['Empty', 'NotEmpty'], ['IsEmpty', 'IsNotEmpty'], ['Contains', 'DoesNotContain'],
  ['Matches', 'DoesNotMatch'], ['InRange', 'NotInRange'], ['Equivalent', 'NotEquivalent'], ['AreEquivalent', 'AreNotEquivalent'], ['IsInstanceOfType', 'IsNotInstanceOfType'], ['IsType', 'IsNotType']]
const ASSERT_FLIP = new Map(ASSERT_PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]))
const TRUE_FALSE = { True: 'False', False: 'True', IsTrue: 'IsFalse', IsFalse: 'IsTrue' }
// FluentAssertions: the assertions that have a Not twin (Be → NotBe, BeNull → NotBeNull, …).
const SHOULD_NOT = new Set(['Be', 'BeEquivalentTo', 'Contain', 'ContainKey', 'ContainValue', 'BeNull', 'BeEmpty', 'BeNullOrEmpty', 'BeNullOrWhiteSpace',
  'Equal', 'BeSameAs', 'HaveCount', 'StartWith', 'EndWith', 'Match', 'MatchRegex', 'BeOfType', 'BeAssignableTo', 'HaveValue', 'Throw', 'ThrowAsync', 'BeInRange', 'BeOneOf', 'HaveElementAt', 'ContainSingle'])

/** Index just past the ")" closing the "(" at `open`, skipping strings. */
function closeAt(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"') { for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++ }
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
  }
  return src.length
}

/** [start, end) of the top-level arguments of the call whose "(" is at `open`. */
function args(src, open) {
  const end = closeAt(src, open) - 1
  const out = []
  let depth = 0
  let from = open + 1
  for (let i = open + 1; i < end; i++) {
    const c = src[i]
    if (c === '"') { for (i++; i < end && src[i] !== '"'; i++) if (src[i] === '\\') i++ }
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) { out.push([from, i]); from = i + 1 }
  }
  out.push([from, end])
  return out
}

/** [start, end) of the text that holds the expected value: what the test pins, not its input. */
function expectedSpan(src) {
  const should = /\.Should\s*\(\s*\)/.exec(src)
  if (should) return [should.index + should[0].length, src.length]
  const m = /^(?:\w+\.)*?(Classic|String|Collection)?Assert\.(\w+)(?:<[^()]*?>)?\s*\(/.exec(src)
  if (!m) return [0, src.length]
  const list = args(src, m[0].length - 1)
  // StringAssert and CollectionAssert put the expected value first or last, by framework: any argument.
  if (m[1] === 'String' || m[1] === 'Collection') return [list[0][0], list.at(-1)[1]]
  // NUnit: Assert.That(actual, constraint): the constraint holds the value.
  if (m[2] === 'That') return list[1] ?? [0, 0]
  // The others take the expected value first: Assert.Equal(expected, actual).
  return list.length > 1 ? list[0] : [0, 0]
}

const NUM = /(?<![\w.])(-?\d+(?:\.\d+)?)([mMdDfFlLuU]{0,2})(?![\w.])/

export function flipMutations(src) {
  const out = []
  const add = (kind, text) => { if (text !== src) out.push({ kind, text }) }
  const shouldAt = src.search(/\.Should\s*\(\s*\)/)
  if (shouldAt >= 0) {
    // FluentAssertions: x.Should().Be(5) → NotBe(5); BeTrue ↔ BeFalse; NotBe → Be.
    const tail = src.slice(shouldAt)
    const m = /\.Should\s*\(\s*\)\s*\.\s*(\w+)/.exec(tail)
    const verb = m?.[1] ?? ''
    const at = shouldAt + m?.index + m?.[0].length - verb.length
    const swap = word => `${src.slice(0, at)}${word}${src.slice(at + verb.length)}`
    if (verb === 'BeTrue') add('true→false', swap('BeFalse'))
    else if (verb === 'BeFalse') add('false→true', swap('BeTrue'))
    else if (/^Not[A-Z]/.test(verb) && SHOULD_NOT.has(verb.slice(3))) add('invert-should', swap(verb.slice(3)))
    else if (SHOULD_NOT.has(verb)) add('invert-should', swap(`Not${verb}`))
  } else {
    const a = /^((?:\w+\.)*?(?:Classic|String|Collection)?Assert\.)(\w+)/.exec(src)
    const verb = a?.[2] ?? ''
    const swap = word => `${a[1]}${word}${src.slice(a[0].length)}`
    if (verb === 'That') {
      // NUnit constraints: Is.EqualTo(5) → Is.Not.EqualTo(5); Is.Not.Null → Is.Null; Is.True ↔ Is.False.
      if (/\b(?:Is|Does|Has)\.Not\./.test(src)) add('drop-not', src.replace(/\b(Is|Does|Has)\.Not\./, '$1.'))
      else if (/\bIs\.True\b/.test(src)) add('true→false', src.replace(/\bIs\.True\b/, 'Is.False'))
      else if (/\bIs\.False\b/.test(src)) add('false→true', src.replace(/\bIs\.False\b/, 'Is.True'))
      else if (/\b(?:Is|Does)\.(?!Not\b)\w/.test(src)) add('add-not', src.replace(/\b(Is|Does)\.(?!Not\b)/, '$1.Not.'))
    } else if (TRUE_FALSE[verb]) add(verb.endsWith('True') ? 'true→false' : 'false→true', swap(TRUE_FALSE[verb]))
    else if (ASSERT_FLIP.has(verb)) add('invert-assert', swap(ASSERT_FLIP.get(verb)))
  }
  // The expected value itself: a number one up, a text that cannot match.
  const [s, e] = expectedSpan(src)
  const span = src.slice(s, e)
  // A number inside a text ("A-1") is part of the text: the corrupt-string flip covers it.
  const n = NUM.exec(codeOnly(span))
  if (n) add('num→n+1', `${src.slice(0, s)}${span.slice(0, n.index)}${Number(n[1]) + 1}${n[2]}${span.slice(n.index + n[0].length)}${src.slice(e)}`)
  const q = /(?<![@$\w])"((?:[^"\\\n★]|\\.)+)"/.exec(span)
  if (q) add('corrupt-string', `${src.slice(0, s)}${span.slice(0, q.index)}"${q[1]}★MUT"${span.slice(q.index + q[0].length)}${src.slice(e)}`)
  return out
}

/** A block mutation judges: it ran green and is not skipped. A theory's cases share its method's title. */
const eligible = (block, passed) => block.mod !== 'skip' && passed.has(block.title)

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
  // A compiled language: a mutated copy next to the spec would be a duplicate class, so the spec itself
  // is mutated and always restored (see checks/mutation.mjs).
  inPlace: true,
  // Assert.X( and its generic form; a FluentAssertions chain from its .Should(. Not in a string or a line comment.
  expectRe: /(?<=(?:^|\n)(?:[^"\n/]|\/(?!\/)|"(?:[^"\\\n]|\\.)*")*)(?:(?<![\w.])(?:Classic|String|Collection)?Assert\.(?!Multiple\b|Fail\b|Pass\b|Inconclusive\b|Ignore\b|Skip\b)\w+(?:<[^\n()]*?>)?\s*\(|\.Should\s*\()/,
  testRe,
  modOf,
  rank: mutantRank,
  flips: flipMutations,
  eligible,
  plan,
}

/**
 * The test classes of a C# file, in order: { name, namespace, fqn, title }. The title is the group's:
 * the key comment above the class, else its name. The runner names each result's group with it.
 */
export function classesOf(src) {
  const namespaces = [...src.matchAll(/(?<![^\n])[ \t]*namespace\s+([\w.]+)/g)].map(m => ({ idx: m.index, name: m[1] }))
  const out = []
  for (const m of src.matchAll(new RegExp(groupRe.source, 'gm'))) {
    const name = m[4] ?? m[3]
    const namespace = namespaces.filter(n => n.idx < m.index).at(-1)?.name ?? ''
    out.push({ name, namespace, fqn: namespace ? `${namespace}.${name}` : name, title: m[3].trim(), idx: m.index })
  }
  return out
}
