// Vitest dialect for the unit checks.
import { collapseSpaces } from '../../core/text.mjs'

export const name = 'vitest'

/** Top-level group: column 0. m[1] = modifier chain (.skip, .concurrent.only), m[3] = title. */
export const groupRe = /^(?:describe|suite)((?:\.\w+)*)\s*\(\s*(['"`])(.*?)\2/gm

// m[1] = modifier, m[3] = title, m[4] = each/for (title follows the table). Lookbehind skips re.test('x').
const TEST = /(?<![.\w$])(?:it|test)(?:\.(skip|todo|only|concurrent|fails))?(?:\s*\(\s*(['"`])(.*?)\2|(?:\.\w+)*\.(each|for)\s*\()/g

export const honesty = {
  removedDecl: /(?<![.\w$])(?:it|test|describe|suite)(?:\.(?:only|concurrent|each))?\s*\(/,
  forgiveMoves: false,
  anchorTags: false,
}

// Fields the ticket names must be read in an assertion.
export const expected = { fieldNames: true }

export const suite = {
  testRe: TEST,
  notYet: 'todo',
  skippedGroups: true,
}

// Strongest first: inverting an assertion best shows whether it checks anything.
const mutantRank = k =>
  k === 'invert-matcher' || k === 'drop-not' || k === 'truthy→falsy' || k === 'falsy→truthy' ? 0 : k === 'num→n+1' ? 1 : 2

/** Index just past the ")" closing the first "(" (the expect's own arguments). */
function argsEnd(src) {
  let depth = 0
  for (let i = src.indexOf('('); i >= 0 && i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return i + 1
  }
  return src.length
}

export function flipMutations(expectSrc) {
  const out = []
  const add = (kind, text) => { if (text !== expectSrc) out.push({ kind, text }) }
  if (/\.not\./.test(expectSrc)) {
    add('drop-not', expectSrc.replace(/\.not\./, '.'))
  } else {
    // Any matcher after expect(...), custom ones too, but not snapshots: they have no .not.
    const from = argsEnd(expectSrc)
    const mm = expectSrc.slice(from).match(/\.(to(?![A-Za-z]*Snapshot)[A-Z]\w*)\b/)
    if (mm) add('invert-matcher', `${expectSrc.slice(0, from + mm.index)}.not${expectSrc.slice(from + mm.index)}`)
  }
  if (/\.toBeTruthy\s*\(/.test(expectSrc)) add('truthy→falsy', expectSrc.replace(/\.toBeTruthy\s*\(/, '.toBeFalsy('))
  if (/\.toBeFalsy\s*\(/.test(expectSrc)) add('falsy→truthy', expectSrc.replace(/\.toBeFalsy\s*\(/, '.toBeTruthy('))
  add('num→n+1', expectSrc.replace(
    /(\.(?:toBe|toEqual|toBeCloseTo|toHaveLength|toHaveBeenCalledTimes|toBeGreaterThan|toBeLessThan)\s*\(\s*)(-?\d+(?:\.\d+)?)/,
    (_, pre, n) => `${pre}${Number(n) + 1}`))
  add('corrupt-string', expectSrc.replace(
    /(\.(?:toBe|toEqual|toContain|toMatch|toHaveProperty|toHaveBeenCalledWith)\s*\(\s*)(['"`])([^'"`★]+)\2/,
    (_, pre, q, s) => `${pre}${q}${s}★MUT${q}`))
  return out
}

/** Green and not skip/todo. each/for titles are formatted at run time, so they never match. */
export const eligible = (block, passed) => block.mod !== 'todo' && block.mod !== 'skip' && block.mod !== 'each' && passed.has(block.title)

/** One mutant per expect (the strongest), in baseline-green tests inside the range. */
export const planOf = (flips, rank) => ({ src, passedTitles, range, blocks, expects }) => {
  const passed = new Set(passedTitles)
  const all = []
  for (const ex of expects) {
    if (range && (ex.start < range[0] || ex.start >= range[1])) continue
    const block = blocks.find(b => ex.start >= b.start && ex.start < b.end)
    if (!block || !eligible(block, passed)) continue
    const original = src.slice(ex.start, ex.end)
    for (const flip of flips(original)) {
      all.push({ title: block.title, start: ex.start, end: ex.end, kind: flip.kind, replacement: flip.text, snippet: `${flip.kind}: ${collapseSpaces(original).slice(0, 60)}` })
    }
  }
  const best = new Map()
  for (const m of all) {
    const cur = best.get(m.start)
    if (!cur || rank(m.kind) < rank(cur.kind)) best.set(m.start, m)
  }
  return [...best.values()].sort((a, b) => a.start - b.start)
}

export const mutation = {
  expectRe: /\b(?:await\s+)?expect(?:\.soft)?\s*\(/,
  testRe: TEST,
  rank: mutantRank,
  flips: flipMutations,
  eligible,
  plan: planOf(flipMutations, mutantRank),
}
