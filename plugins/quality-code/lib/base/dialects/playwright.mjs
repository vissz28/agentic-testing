// Playwright syntax, as the frontend checks read it.
import { flipMutations as valueFlips, mutation as vitest } from './vitest.mjs'

export const name = 'playwright'

/** Top-level group: column 0. m[1] = modifier chain (.skip, .serial, .fixme), m[3] = title. */
export const groupRe = /^test\.describe((?:\.\w+)*)\s*\(\s*(['"`])(.*?)\2/gm

export const honesty = {
  removedDecl: /(?<![.\w$])(?:test|it)(?:\.(?:describe|only))?\s*\(/,
  forgiveMoves: true,
  anchorTags: true,
}

export const suite = {
  testRe: /(?<![.\w$])(?:test|it)(?:\.(skip|fixme|only|fail))?\s*\(\s*(['"`])(.*?)\2/g,
  notYet: 'fixme',
  skippedGroups: false,
}

function flipMutations(expectSrc) {
  const out = []
  const add = (kind, text) => { if (text !== expectSrc) out.push({ kind, text }) }
  // toBeHidden / toHaveCount(0) can pass during load; an impossible count always fails.
  if (/\.toBeVisible\s*\(/.test(expectSrc)) add('flip-visible→count-999', expectSrc.replace(/\.toBeVisible\s*\([^)]*\)/, '.toHaveCount(999, { timeout: 2000 })'))
  if (/\.toBeHidden\s*\(/.test(expectSrc)) add('flip-hidden→count-999', expectSrc.replace(/\.toBeHidden\s*\([^)]*\)/, '.toHaveCount(999, { timeout: 2000 })'))
  if (/\.toBeEnabled\s*\(/.test(expectSrc)) add('flip-enabled→disabled', expectSrc.replace(/\.toBeEnabled\s*\(/g, '.toBeDisabled('))
  if (/\.toBeDisabled\s*\(/.test(expectSrc)) add('flip-disabled→enabled', expectSrc.replace(/\.toBeDisabled\s*\(/g, '.toBeEnabled('))
  if (/\.toBeChecked\s*\(/.test(expectSrc)) add('flip-checked→unchecked', expectSrc.replace(/\.toBeChecked\s*\(/g, '.not.toBeChecked('))
  if (/\.toHaveCount\s*\(\s*0\s*\)/.test(expectSrc)) add('flip-count-0→1', expectSrc.replace(/\.toHaveCount\s*\(\s*0\s*\)/, '.toHaveCount(1)'))
  if (/\.toHaveCount\s*\(\s*([1-9]\d*)\s*\)/.test(expectSrc)) add('flip-count-n→n+1', expectSrc.replace(/\.toHaveCount\s*\(\s*([1-9]\d*)\s*\)/, (_, n) => `.toHaveCount(${Number(n) + 1})`))
  if (/\.toBeTruthy\s*\(/.test(expectSrc)) add('flip-truthy→falsy', expectSrc.replace(/\.toBeTruthy\s*\(/g, '.toBeFalsy('))
  if (/\.toBeFalsy\s*\(/.test(expectSrc)) add('flip-falsy→truthy', expectSrc.replace(/\.toBeFalsy\s*\(/g, '.toBeTruthy('))
  add('corrupt-getBy-string', expectSrc.replace(/(getBy(?:Text|Label|Placeholder|AltText|Title)\(\s*)(['"`])([^'"`★]+)\2/, (_, pre, q, s) => `${pre}${q}${s}★MUT${q}`))
  add('corrupt-role-name', expectSrc.replace(/(name:\s*)(['"`])([^'"`★]+)\2/, (_, pre, q, s) => `${pre}${q}${s}★MUT${q}`))
  // A plain value check (expect(await rows.count()).toBe(3), expect(r.status()).toBe(200)): the strongest value flip.
  if (!out.length) out.push(...valueFlips(expectSrc).sort((a, b) => vitest.rank(a.kind) - vitest.rank(b.kind)).slice(0, 1))
  return out
}

/** A block mutation judges: ran green (by title or title prefix), not skipped, fixme, an expected failure or ungraded. */
function eligible(block, passed, ungraded = null) {
  if (block.mod === 'fixme' || block.mod === 'skip' || block.mod === 'fail' || ungraded?.test(block.title)) return false
  const key = block.title.split(' — ')[0]
  return passed.has(block.title) || [...passed].some(t => t === key || t.startsWith(key))
}

/** Every flip of every expect in a baseline-green test (by title or title prefix), inside the range. */
function plan({ src, passedTitles, range, blocks, expects, ungraded = null }) {
  const passed = new Set(passedTitles)
  const mutants = []
  for (const ex of expects) {
    if (range && (ex.start < range[0] || ex.start >= range[1])) continue
    const block = blocks.find(b => ex.start >= b.start && ex.start < b.end)
    if (!block || !eligible(block, passed, ungraded)) continue
    const original = src.slice(ex.start, ex.end)
    for (const flip of flipMutations(original)) {
      mutants.push({ title: block.title, start: ex.start, end: ex.end, kind: flip.kind, replacement: flip.text, snippet: `${flip.kind}: ${original.replace(/\s+/g, ' ').slice(0, 60)}` })
    }
  }
  return mutants
}

// Web-first matchers whose arguments hold the values a ticket expects (the expected check reads them).
// expect(...) itself is read too: the locator's text is the value the screen shows.
export const expected = {
  readsActual: true,
  matchers: ['toHaveText', 'toContainText', 'toHaveValue', 'toHaveValues', 'toHaveCount', 'toHaveURL', 'toHaveTitle', 'toHaveAttribute', 'toHaveAccessibleName', 'toHaveAccessibleDescription', 'toHaveJSProperty', 'toHaveCSS', 'toHaveId', 'toHaveClass'],
}

export const mutation = {
  expectRe: /\b(?:await\s+)?expect(?:\.soft)?\s*\(/,
  testRe: /(?<![.\w$])test(?:\.(skip|fixme|only|fail))?\s*\(\s*(['"`])(.*?)\2/,
  rank: () => 0,
  flips: flipMutations,
  eligible,
  plan,
}
