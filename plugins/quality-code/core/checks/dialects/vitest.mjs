// Vitest syntax, as the backend checks read it.
export const name = 'vitest'

/** Top-level group: column 0. m[1] = modifier, m[3] = title. */
export const groupRe = /^describe(?:\.(skip|only))?\s*\(\s*(['"`])(.*?)\2/gm

export const honesty = {
  removedDecl: /\b(?:it|test|describe)(?:\.(?:only|concurrent|each))?\s*\(/,
  forgiveMoves: false,
  anchorTags: false,
}

export const suite = {
  testRe: /\b(?:it|test)(?:\.(skip|todo|only|concurrent|fails))?\s*\(\s*(['"`])(.*?)\2/g,
  notYet: 'todo',
  skippedGroups: true,
  isCapture: () => false,
}

// Strongest first: inverting an assertion is the definitive "does it bind anything" mutant.
const mutantRank = k =>
  k === 'invert-matcher' || k === 'drop-not' || k === 'truthy→falsy' || k === 'falsy→truthy' ? 0 : k === 'num→n+1' ? 1 : 2

function flipMutations(expectSrc) {
  const out = []
  const add = (kind, text) => { if (text !== expectSrc) out.push({ kind, text }) }
  if (/\.not\./.test(expectSrc)) {
    add('drop-not', expectSrc.replace(/\.not\./, '.'))
  } else {
    const mm = expectSrc.match(/\.(toBe|toEqual|toStrictEqual|toContain|toContainEqual|toMatch|toMatchObject|toHaveBeenCalledWith|toHaveBeenCalledTimes|toHaveBeenCalled|toHaveLength|toHaveProperty|toBeNull|toBeUndefined|toBeDefined|toBeNaN|toBeInstanceOf|toBeGreaterThanOrEqual|toBeLessThanOrEqual|toBeGreaterThan|toBeLessThan|toThrowError|toThrow|toBeCloseTo)\b/)
    if (mm) add('invert-matcher', `${expectSrc.slice(0, mm.index)}.not${expectSrc.slice(mm.index)}`)
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

/** One mutant per expect (the strongest) unless thorough; baseline-green tests only, inside the range. */
function plan({ src, passedTitles, range, thorough, blocks, expects }) {
  const passed = new Set(passedTitles)
  const all = []
  for (const ex of expects) {
    if (range && (ex.start < range[0] || ex.start >= range[1])) continue
    const block = blocks.find(b => ex.start >= b.start && ex.start < b.end)
    if (!block) continue
    if (block.mod === 'todo' || block.mod === 'skip') continue
    if (!passed.has(block.title)) continue
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
  expectRe: /\b(?:await\s+)?expect\s*\(/,
  testRe: /\b(?:it|test)(?:\.(skip|todo|only|concurrent|fails))?\s*\(\s*(['"`])(.*?)\2/,
  rank: mutantRank,
  flips: flipMutations,
  plan,
}
