// Generic dialect for Jest, Mocha, node --test and Cypress, looser than Vitest's and Playwright's.
// Reads expect matchers, Chai chains, assert calls and Cypress .should().
import { eligible, flipMutations as expectFlips, mutation as vitest, planOf } from './vitest.mjs'

/** Top-level group: column 0. m[1] = modifier chain, m[3] = title; groups() reads an x- or f- prefix itself. */
const GROUP = /^[xf]?(?:describe|context|suite)((?:\.\w+)*)\s*\(\s*(['"`])(.*?)\2/gm

// m[1] = modifier, m[3] = title, m[4] = each (title follows the table). testMarks() handles x-/f-.
const TEST = /(?<![.\w$])[xf]?(?:it|test|specify)(?:\.(skip|todo|only|concurrent|fails|failing))?(?:\s*\(\s*(['"`])(.*?)\2|(?:\.\w+)*\.(each)\s*\()/g

// Chai terminal calls whose argument is the pinned value.
const CHAI_MATCHERS = ['equal', 'equals', 'eql', 'include', 'includes', 'contain', 'contains', 'members', 'property', 'lengthOf', 'string', 'match', 'above', 'below', 'least', 'most', 'closeTo', 'within', 'oneOf']
// node:assert calls holding the pinned value (equal and match are in Chai's list).
const ASSERT_MATCHERS = ['strictEqual', 'deepStrictEqual', 'deepEqual', 'partialDeepStrictEqual', 'throws', 'rejects']
// Method and its negation; node:assert and Chai's assert share these names.
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

// Cypress retries .should() until it passes, so a negated mutant passes while the page loads.
// Break the value or ask for an impossible count instead; an existing not. is just dropped.
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

/** Chai: negate the chain (or drop its not), then mutate the pinned value. */
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

/** assert.strictEqual(total, 108), assert(ok): negate the method, then mutate the pinned value. */
function assertFlips(src) {
  const out = []
  const add = (kind, text) => { if (text !== src) out.push({ kind, text }) }
  const m = /^((?:await\s+)?assert)(?:\.(\w+))?(\s*\()/.exec(src)
  if (!m) return out
  const method = m[2] ?? null
  const pair = ASSERT_PAIRS.find(p => p.includes(method))
  if (pair) add(method === pair[0] ? 'invert-matcher' : 'drop-not', `${m[1]}.${method === pair[0] ? pair[1] : pair[0]}${src.slice(m[1].length + 1 + method.length)}`)
  else if (method === null || method === 'ok') add('invert-matcher', `${m[1]}${method ? '.ok' : ''}${m[3]}!(${src.slice(m[0].length, argsEnd(src) - 1)})${src.slice(argsEnd(src) - 1)}`)
  // The pinned value is the second argument.
  const at = method === null ? -1 : secondArg(src, m[0].length - 1)
  if (at > 0) {
    const head = src.slice(0, at)
    add('num→n+1', head + bump(src.slice(at), /^(\s*)(-?\d+(?:\.\d+)?)(?![\w.])/))
    add('corrupt-string', head + corrupt(src.slice(at), /^(\s*)(['"`])([^'"`★]+)\2/))
  }
  return out
}

/** Index past the first argument's comma in the call opened at `open`; -1 with one argument. */
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

export function flipMutations(src) {
  if (/^\.should\s*\(/.test(src)) return shouldFlips(src)
  if (/^(?:await\s+)?assert\b/.test(src)) return assertFlips(src)
  // Chai's chain starts with .to (or .not.to); Jest's matchers are toBe, toEqual, …
  if (/^\s*\.\s*(?:not\s*\.\s*)?to(?![\w$])/.test(src.slice(argsEnd(src)))) return chaiFlips(src)
  return expectFlips(src)
}

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
    // Unit tests read the ticket's fields; e2e tests what the screen shows.
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
