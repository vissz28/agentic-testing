// Playwright syntax, as the frontend checks read it.
export const name = 'playwright'

/** Top-level group: column 0. m[1] = modifier, m[3] = title. */
export const groupRe = /^test\.describe(?:\.(skip|only))?\s*\(\s*(['"`])(.*?)\2/gm

export const honesty = {
  removedDecl: /\b(?:test|it)(?:\.(?:describe|only))?\s*\(/,
  forgiveMoves: true,
  anchorTags: true,
}

export const suite = {
  testRe: /\b(?:test|it)(?:\.(skip|fixme|only))?\s*\(\s*(['"`])(.*?)\2/g,
  notYet: 'fixme',
  skippedGroups: false,
  // Design-conformance captures screenshot and never assert; they are not graded.
  isCapture: title => /conformance|capture/i.test(title),
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
  return out
}

/** Every flip of every expect in a baseline-green test (by title or title prefix), inside the range. */
function plan({ src, passedTitles, range, blocks, expects }) {
  const passed = new Set(passedTitles)
  const mutants = []
  for (const ex of expects) {
    if (range && (ex.start < range[0] || ex.start >= range[1])) continue
    const block = blocks.find(b => ex.start >= b.start && ex.start < b.end)
    if (!block) continue
    if (block.mod === 'fixme' || block.mod === 'skip') continue
    if (/conformance|capture/i.test(block.title)) continue
    const key = block.title.split(' — ')[0]
    const green = passed.has(block.title) || [...passed].some(t => t === key || t.startsWith(key))
    if (!green) continue
    const original = src.slice(ex.start, ex.end)
    for (const flip of flipMutations(original)) {
      mutants.push({ title: block.title, start: ex.start, end: ex.end, kind: flip.kind, replacement: flip.text, snippet: `${flip.kind}: ${original.replace(/\s+/g, ' ').slice(0, 60)}` })
    }
  }
  return mutants
}

// Web-first matchers whose arguments hold the values a ticket expects (the expected check reads them).
export const expected = {
  matchers: ['toHaveText', 'toContainText', 'toHaveValue', 'toHaveValues', 'toHaveCount', 'toHaveURL', 'toHaveTitle', 'toHaveAttribute', 'toHaveAccessibleName', 'toHaveAccessibleDescription', 'toHaveJSProperty', 'toHaveCSS', 'toHaveId', 'toHaveClass'],
}

export const mutation = {
  expectRe: /\bawait\s+expect\s*\(/,
  testRe: /\btest(?:\.(skip|fixme|only))?\s*\(\s*(['"`])(.*?)\2/,
  rank: () => 0,
  flips: flipMutations,
  plan,
}
