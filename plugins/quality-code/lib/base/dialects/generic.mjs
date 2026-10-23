// The generic tier's syntax: the specs of every other JavaScript runner (Jest, Mocha, Cypress), read as
// what they share: describe/context/suite groups, it/test/specify tests (x- and f- prefixed too), and
// three assertion styles: expect matchers (Jest, Jasmine), Chai chains (Mocha, Cypress) and Cypress's
// .should(). Looser than the Vitest and Playwright dialects, which know their runner's every modifier
// and matcher. One per kind of test: unit tests read field names, e2e tests what the screen shows.
import { eligible, flipMutations as expectFlips, mutation as vitest, planOf } from './vitest.mjs'

/** Top-level group: column 0. m[1] = modifier chain, m[3] = title; groups() reads an x- or f- prefix itself. */
const GROUP = /^[xf]?(?:describe|context|suite)((?:\.\w+)*)\s*\(\s*(['"`])(.*?)\2/gm

// A test mark: m[1] = modifier, m[3] = title; m[4] = each, whose title follows the table. testMarks()
// reads an x- or f- prefix itself.
const TEST = /(?<![.\w$])[xf]?(?:it|test|specify)(?:\.(skip|todo|only|concurrent|fails|failing))?(?:\s*\(\s*(['"`])(.*?)\2|(?:\.\w+)*\.(each)\s*\()/g

// Chai's terminal calls whose argument is the value a test pins.
const CHAI_MATCHERS = ['equal', 'equals', 'eql', 'include', 'includes', 'contain', 'contains', 'members', 'property', 'lengthOf', 'string', 'match', 'above', 'below', 'least', 'most', 'closeTo', 'within', 'oneOf']

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

/** The flips of one assertion, in the style it is written in. */
export function flipMutations(src) {
  if (/^\.should\s*\(/.test(src)) return shouldFlips(src)
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
    expected: kind === 'e2e' ? { readsActual: true, matchers: [...CHAI_MATCHERS, 'should', 'and'] } : { fieldNames: true, matchers: CHAI_MATCHERS },
    suite: { testRe: TEST, notYet: 'todo', skippedGroups: true, chai: true },
    mutation: {
      expectRe: /\b(?:await\s+)?expect(?:\.soft)?\s*\(|\.should\s*\(/,
      testRe: TEST,
      rank: vitest.rank,
      flips: flipMutations,
      eligible,
      plan: planOf(flipMutations, vitest.rank),
    },
  })
}
