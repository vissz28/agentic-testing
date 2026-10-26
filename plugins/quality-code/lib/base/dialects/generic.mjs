// The generic tier's syntax: the specs of every other JavaScript runner (Jest, Mocha, node --test,
// Cypress), read as what they share: describe/context/suite groups, it/test/specify tests (x- and f-
// prefixed too), and four assertion styles: expect matchers (Jest, Jasmine), Chai chains (Mocha,
// Cypress), assert calls (node:assert, Chai's assert) and Cypress's .should(). Looser than the Vitest and Playwright dialects, which know their runner's every modifier
// and matcher. One per kind of test: unit tests read field names, e2e tests what the screen shows.
import { eligible, flipMutations as expectFlips, mutation as vitest, planOf } from './vitest.mjs'

/** Top-level group: column 0. m[1] = modifier chain, m[3] = title; groups() reads an x- or f- prefix itself. */
const GROUP = /^[xf]?(?:describe|context|suite)((?:\.\w+)*)\s*\(\s*(['"`])(.*?)\2/gm

// A test mark: m[1] = modifier, m[3] = title; m[4] = each, whose title follows the table. testMarks()
// reads an x- or f- prefix itself.
const TEST = /(?<![.\w$])[xf]?(?:it|test|specify)(?:\.(skip|todo|only|concurrent|fails|failing))?(?:\s*\(\s*(['"`])(.*?)\2|(?:\.\w+)*\.(each)\s*\()/g

// Chai's terminal calls whose argument is the value a test pins.
const CHAI_MATCHERS = ['equal', 'equals', 'eql', 'include', 'includes', 'contain', 'contains', 'members', 'property', 'lengthOf', 'string', 'match', 'above', 'below', 'least', 'most', 'closeTo', 'within', 'oneOf']
// node:assert's checks whose arguments hold the value a test pins (equal and match are Chai's too).
const ASSERT_MATCHERS = ['strictEqual', 'deepStrictEqual', 'deepEqual', 'partialDeepStrictEqual', 'throws', 'rejects']
// An assert method and its negation, both ways: node:assert and Chai's assert share these names.
const ASSERT_PAIRS = [['strictEqual', 'notStrictEqual'], ['deepStrictEqual', 'notDeepStrictEqual'], ['deepEqual', 'notDeepEqual'], ['equal', 'notEqual'], ['match', 'doesNotMatch'], ['throws', 'doesNotThrow'], ['rejects', 'doesNotReject'], ['include', 'notInclude'], ['isTrue', 'isFalse']]

/** Index just past the ")" closing the first "(" (the expect's or the should's own arguments). */
function argsEnd(src) {
  let depth = 0
  for (let i = src.indexOf('('); i >= 0 && i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return i + 1
  }
  return src.length
}

const corrupt = (src, re) => src.replace(re, (_, pre, q, s) => `${pre}${q}${s}★MUT${q}`)
const bump = (src, re) => src.replace(re, (_, pre, n) => `${pre}${Number(n) + 1}`)

/**
 * Cypress: .should('have.text', 'x'). Cypress retries it until it passes, so a negated mutant passes
 * while the page still loads and proves nothing: break the value instead, or ask for an impossible
 * count, which always fails (as the Playwright dialect does). Only a not. is ever flipped: dropped.
 */
function shouldFlips(src) {
  const out = []
  const add = (kind, text) => { if (text !== src) out.push({ kind, text }) }
  const chainer = /^(\.should\s*\(\s*)(['"`])not\./.exec(src)
  if (chainer) return [{ kind: 'drop-not', text: src.replace(chainer[0], `${chainer[1]}${chainer[2]}`) }]
  add('num→n+1', bump(src, /^(\.should\s*\(\s*['"`][^'"`]*['"`]\s*,\s*)(-?\d+(?:\.\d+)?)/))
  add('corrupt-string', corrupt(src, /^(\.should\s*\(\s*['"`][^'"`]*['"`]\s*,\s*)(['"`])([^'"`★]+)\2/))
  if (!out.length && /^\.should\s*\(\s*['"`]/.test(src)) add('impossible-count', `.should('have.length', 999)${src.slice(argsEnd(src))}`)
  return out
}

/** Chai: expect(x).to.equal(1): negate the chain (or drop its not), then the value its terminal call pins. */
function chaiFlips(src) {
  const out = []
  const add = (kind, text) => { if (text !== src) out.push({ kind, text }) }
  const at = argsEnd(src)
  const head = src.slice(0, at)
  const chain = src.slice(at)
  if (/\.\s*not\b/.test(chain)) add('drop-not', head + chain.replace(/\.\s*not\b/, ''))
  else add('invert-matcher', head + chain.replace(/^(\s*\.\s*to)\b/, '$1.not'))
  if (/\.\s*true\b/.test(chain)) add('truthy→falsy', head + chain.replace(/\.\s*true\b/, '.false'))
  if (/\.\s*false\b/.test(chain)) add('falsy→truthy', head + chain.replace(/\.\s*false\b/, '.true'))
  const terminal = CHAI_MATCHERS.join('|')
  add('num→n+1', head + bump(chain, new RegExp(`(\\.(?:${terminal})\\s*\\(\\s*)(-?\\d+(?:\\.\\d+)?)`)))
  add('corrupt-string', head + corrupt(chain, new RegExp(`(\\.(?:${terminal})\\s*\\(\\s*)(['"\`])([^'"\`★]+)\\2`)))
  return out
}

/** node:assert or Chai's assert: assert.strictEqual(total, 108) and assert(ok): negate the method, then the value it pins. */
function assertFlips(src) {
  const out = []
  const add = (kind, text) => { if (text !== src) out.push({ kind, text }) }
  const m = /^((?:await\s+)?assert)(?:\.(\w+))?(\s*\()/.exec(src)
  if (!m) return out
  const method = m[2] ?? null
  const pair = ASSERT_PAIRS.find(p => p.includes(method))
  if (pair) add(method === pair[0] ? 'invert-matcher' : 'drop-not', `${m[1]}.${method === pair[0] ? pair[1] : pair[0]}${src.slice(m[1].length + 1 + method.length)}`)
  else if (method === null || method === 'ok') add('invert-matcher', `${m[1]}${method ? '.ok' : ''}${m[3]}!(${src.slice(m[0].length, argsEnd(src) - 1)})${src.slice(argsEnd(src) - 1)}`)
  // The value it pins: the second argument, as written.
  const at = method === null ? -1 : secondArg(src, m[0].length - 1)
  if (at > 0) {
    const head = src.slice(0, at)
    add('num→n+1', head + bump(src.slice(at), /^(\s*)(-?\d+(?:\.\d+)?)(?![\w.])/))
    add('corrupt-string', head + corrupt(src.slice(at), /^(\s*)(['"`])([^'"`★]+)\2/))
  }
  return out
}

/** Index just past the comma that ends the first argument of the call opened at `open`; -1 when there is one argument. */
function secondArg(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++ }
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c) && --depth === 0) return -1
    else if (c === ',' && depth === 1) return i + 1
  }
  return -1
}

/** The flips of one assertion, in the style it is written in. */
export function flipMutations(src) {
  if (/^\.should\s*\(/.test(src)) return shouldFlips(src)
  if (/^(?:await\s+)?assert\b/.test(src)) return assertFlips(src)
  // Chai's chain starts with .to (or .not.to); Jest's matchers are toBe, toEqual, …
  if (/^\s*\.\s*(?:not\s*\.\s*)?to(?![\w$])/.test(src.slice(argsEnd(src)))) return chaiFlips(src)
  return expectFlips(src)
}

/** The dialect of the generic tier for one kind of test: "unit" or "e2e". */
export function generic(kind) {
  return Object.freeze({
    name: 'generic',
    groupRe: GROUP,
    honesty: {
      removedDecl: /(?<![.\w$])[xf]?(?:it|test|specify|describe|context|suite)(?:\.(?:only|concurrent|each))?\s*\(/,
      assertion: /\bexpect\s*\(|\.should\b[\w.]*\s*\(|(?<![.\w$])assert(?:\.\w+)?\s*\(/,
      forgiveMoves: false,
      anchorTags: false,
    },
    // A unit test reads the fields the ticket names; an e2e test, what the screen shows (Cypress's should).
    expected: kind === 'e2e' ? { readsActual: true, matchers: [...CHAI_MATCHERS, 'should', 'and'] } : { fieldNames: true, matchers: [...CHAI_MATCHERS, ...ASSERT_MATCHERS] },
    suite: { testRe: TEST, notYet: 'todo', skippedGroups: true, chai: true },
    mutation: {
      expectRe: /\b(?:await\s+)?expect(?:\.soft)?\s*\(|\.should\s*\(|(?<![.\w$])(?:await\s+)?assert(?:\.\w+)?\s*\(/,
      testRe: TEST,
      rank: vitest.rank,
      flips: flipMutations,
      eligible,
      plan: planOf(flipMutations, vitest.rank),
    },
  })
}
