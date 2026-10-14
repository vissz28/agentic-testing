// Expected values: the concrete numbers and quoted texts of the ticket's Then / Expected lines must
// be asserted in the ticket's block. Values the ticket does not state are never required.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractExpectedChunks, extractNaturalAC } from '../criteria.mjs'
import { buildVocabulary } from '../languages/index.mjs'
import { anchorRange } from './suite-honesty.mjs'
import { result } from './result.mjs'

const PAIRS = [['"', '"'], ['“', '”'], ["'", "'"], ['‘', '’'], ['«', '»'], ['`', '`']]
const QUOTED = new RegExp(`(?<![\\w\\\\])(?:${PAIRS.map(([o, c]) => `${o}([^${c}\\n]{2,80})${c}`).join('|')})(?![\\w])`, 'g')
// A number that is not part of a word, a key (ABC-12) or a version (1.2.3).
const NUMBER = /(?<![\w.,\-−])[+\-−]?\d+(?:[.,]\d+)*(?![\w]|[.,]\d)/g
const MATCHERS = ['expect', 'toBe', 'toEqual', 'toStrictEqual', 'toContain', 'toMatchObject', 'toHaveProperty', 'toThrow']
// A dialect may add its own matchers (Playwright's web-first ones: toHaveText, toHaveValue, …).
const callRe = dialect => new RegExp(`(?:\\bexpect|\\.(?:${[...MATCHERS.slice(1), ...(dialect?.expected?.matchers ?? [])].join('|')}))\\s*\\(`, 'g')

/**
 * Every value a written number may mean, as canonical decimal text: "1.234,5", "1,234.5" and
 * "1234.50" all give "1234.5"; "1,000" gives "1000" and "1"; a leading "−" is a minus.
 */
export function normNum(raw) {
  let s = String(raw).trim().replace(/−/g, '-').replace(/^\+/, '')
  const neg = s.startsWith('-')
  if (neg) s = s.slice(1)
  const canon = (int, frac = '') => {
    const i = int.replace(/^0+(?=\d)/, '')
    const f = frac.replace(/0+$/, '')
    const out = f ? `${i}.${f}` : i
    return neg && out !== '0' ? `-${out}` : out
  }
  const seps = s.match(/[.,]/g) ?? []
  if (!seps.length) return [canon(s)]
  const out = new Set()
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
  const groups = s.split(/[.,]/)
  const thousandsShape = groups.slice(1).every(g => g.length === 3) && groups[0].length <= 3
  if (new Set(seps).size === 2) {
    // Both separators: the last one is the decimal point.
    out.add(canon(s.slice(0, lastSep).replace(/[.,]/g, ''), s.slice(lastSep + 1)))
  } else if (seps.length > 1) {
    // The same separator twice or more: thousands only.
    if (thousandsShape) out.add(canon(groups.join('')))
  } else {
    out.add(canon(groups[0], groups[1]))
    if (thousandsShape) out.add(canon(groups.join('')))
  }
  return [...out]
}

const stripQuoted = text => text.replace(QUOTED, m => ' '.repeat(m.length))

const quotedIn = text => [...text.matchAll(QUOTED)].map(m => m.slice(1).find(x => x !== undefined)).filter(x => x.trim().length >= 2)

const numbersIn = text => [...stripQuoted(text).matchAll(NUMBER)].map(m => m[0])

/** The text a check reads: the description and the criteria field, as the ticket file holds them. */
export function ticketText(ticket) {
  if (typeof ticket === 'string') return ticket
  return [ticket?.summary, ticket?.text?.description, ticket?.text?.acField].filter(Boolean).join('\n\n')
}

/**
 * The values the ticket expects: { token, kind, values?, from } per distinct value, from the Then
 * lines, Expected sections and acceptance criteria. Each token is grounded: it is in the ticket text.
 */
export function tokensFrom(ticket, v = buildVocabulary(['en', 'it'])) {
  const description = typeof ticket === 'string' ? ticket : ticket?.text?.description ?? ''
  const acField = typeof ticket === 'string' ? '' : ticket?.text?.acField ?? ''
  const full = ticketText(ticket)
  const chunks = [...new Set([
    ...extractExpectedChunks(v, description),
    ...(acField ? [...extractExpectedChunks(v, acField), ...extractNaturalAC(v, acField, { headingless: true })] : []),
  ])]
  const tokens = []
  const seen = new Set()
  for (const from of chunks) {
    for (const s of quotedIn(from)) {
      const id = `s:${s}`
      if (seen.has(id) || !full.includes(s)) continue
      seen.add(id)
      tokens.push({ token: s, kind: 'string', from })
    }
    for (const n of numbersIn(from)) {
      const values = normNum(n)
      const id = `n:${values.join('|')}`
      if (!values.length || seen.has(id) || !full.includes(n)) continue
      seen.add(id)
      tokens.push({ token: n.replace(/−/g, '-'), kind: 'number', values, from })
    }
  }
  return tokens
}

/** Index just past the ")" closing the "(" at `open`, skipping strings and comments. */
function closeParen(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      i = e < 0 ? src.length : e + 1
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
  }
  return src.length
}

/** The argument text of every assertion call inside the key block; null when there is no block. */
export function surface(specSrc, key, dialect) {
  const range = anchorRange(specSrc, key, dialect)
  if (!range) return null
  const block = specSrc.slice(range[0], range[1])
  const parts = []
  for (const m of block.matchAll(callRe(dialect))) {
    const open = m.index + m[0].length - 1
    parts.push(block.slice(open + 1, closeParen(block, open) - 1))
  }
  return parts.join('\n')
}

const unescape = s => s.replace(/\\(.)/g, '$1')

export function asserted(token, surfaceText) {
  if (token.kind === 'string') return surfaceText.includes(token.token) || unescape(surfaceText).includes(token.token)
  const want = new Set(token.values)
  return [...surfaceText.matchAll(NUMBER)].some(m => normNum(m[0]).some(x => want.has(x)))
}

const short = s => (s.length > 80 ? `${s.slice(0, 77)}…` : s)

export function run({ specs, key = null, ticket = null }, ctx) {
  if (!key) return result('expected', 'not_run', 'no ticket key to find the block')
  let t
  try {
    t = JSON.parse(readFileSync(resolve(ctx.root, ticket ?? ''), 'utf8'))
    if (!t || typeof t !== 'object') throw new Error('not a ticket object')
  } catch (e) {
    return result('expected', 'not_run', `cannot read the ticket file: ${String(e.message).split('\n')[0]}`)
  }
  const surfaces = specs.map(p => surface(readFileSync(resolve(ctx.root, p), 'utf8'), key, ctx.dialect))
  if (surfaces.every(s => s === null)) {
    return result('expected', 'not_run', `no ${key} block in ${specs.join(', ')}`, [{ file: specs.join(', '), kind: 'no anchor block', detail: `no top-level group titled "${key} …"` }])
  }
  const all = surfaces.filter(s => s !== null).join('\n')
  const tokens = tokensFrom(t, buildVocabulary(ctx.config?.languages ?? ['en', 'it']))
  if (!tokens.length) return result('expected', 'pass', 'no concrete expected values in the ticket', [], { tokens: 0, asserted: 0 })
  const missing = tokens.filter(x => !asserted(x, all))
  const data = { tokens: tokens.length, asserted: tokens.length - missing.length, missing: missing.map(x => x.token) }
  if (!missing.length) return result('expected', 'pass', `all ${tokens.length} expected value(s) from the ticket are asserted`, [], data)
  return result('expected', 'fail', `${missing.length} of ${tokens.length} expected value(s) from the ticket not asserted`,
    missing.map(x => ({ kind: 'expected value not asserted', token: x.token, then: short(x.from), detail: `${x.token} (from "${short(x.from)}")` })), data)
}
