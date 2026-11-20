// Expected values: numbers and quoted text from the ticket's Then/Expected lines must be asserted in its block.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractExpectedChunks, extractNaturalAC, outcomeOf } from '../../ticket/criteria.mjs'
import { buildVocabulary } from '../../ticket/languages/index.mjs'
import { anchorRange } from './suite-honesty.mjs'
import { result } from '../result.mjs'
import { configHome } from '../../config/config.mjs'
import { externalChecks } from './external.mjs'
import { readJson } from '../../core/files.mjs'
import { escapeRegExp, stripCodeComments, stripUrls } from '../../core/text.mjs'

const PAIRS = [['"', '"'], ['“', '”'], ["'", "'"], ['‘', '’'], ['«', '»'], ['`', '`']]
const QUOTED = new RegExp(`(?<![\\w\\\\])(?:${PAIRS.map(([o, c]) => `${o}([^${c}\\n]{2,80})${c}`).join('|')})(?![\\w])`, 'g')
// Not part of a word, a key (ABC-12) or a version (1.2.3).
const NUMBER = /(?<![\w.,\-−])[+\-−]?\d+(?:[.,]\d+)*(?![\w]|[.,]\d)/g
// Matchers whose argument is a pinned value.
const MATCHERS = ['expect', 'toBe', 'toEqual', 'toStrictEqual', 'toContain', 'toContainEqual', 'toMatchObject', 'toHaveProperty', 'toThrow',
  'toBeCloseTo', 'toBeGreaterThan', 'toBeGreaterThanOrEqual', 'toBeLessThan', 'toBeLessThanOrEqual', 'toHaveLength', 'toMatch', 'toHaveBeenCalledWith']
// Dialects add matchers (Playwright toHaveText, …) and bare assertion calls (JUnit assertEquals).
const bareCalls = dialect => (dialect?.expected?.calls?.length ? `|(?<![\\w$])(?:${dialect.expected.calls.join('|')})` : '')
const callRe = dialect => new RegExp(`(?:\\bexpect|\\.(?:${[...MATCHERS.slice(1), ...(dialect?.expected?.matchers ?? [])].join('|')})${bareCalls(dialect)})\\s*\\(`, 'g')

/** Every reading of a number: "1.234,5", "1,234.5", "1234.50" -> "1234.5"; "1,000" -> "1000" and "1". */
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
    // Both separators: the last is the decimal point.
    out.add(canon(s.slice(0, lastSep).replace(/[.,]/g, ''), s.slice(lastSep + 1)))
  } else if (seps.length > 1) {
    // Same separator repeated: thousands only.
    if (thousandsShape) out.add(canon(groups.join('')))
  } else {
    out.add(canon(groups[0], groups[1]))
    if (thousandsShape) out.add(canon(groups.join('')))
  }
  return [...out]
}

const stripQuoted = text => text.replace(QUOTED, m => ' '.repeat(m.length))

const quotedIn = text => [...stripUrls(text).matchAll(QUOTED)].map(m => m.slice(1).find(x => x !== undefined)).filter(x => x.trim().length >= 2)

const numbersIn = text => [...stripQuoted(stripUrls(text)).matchAll(NUMBER)].map(m => m[0])

export function ticketText(ticket) {
  if (typeof ticket === 'string') return ticket
  return [ticket?.summary, ticket?.text?.description, ticket?.text?.acField].filter(Boolean).join('\n\n')
}

/** Then lines, Expected sections and acceptance criteria. */
export function expectedChunks(ticket, v = buildVocabulary(['en', 'it'])) {
  const description = typeof ticket === 'string' ? ticket : ticket?.text?.description ?? ''
  const acField = typeof ticket === 'string' ? '' : ticket?.text?.acField ?? ''
  return [...new Set([
    ...extractExpectedChunks(v, description),
    ...(acField ? [...extractExpectedChunks(v, acField), ...extractNaturalAC(v, acField, { headingless: true })] : []),
  ])]
}

export { outcomeOf }

/** Distinct expected values, each one present verbatim in the ticket text. */
// A code written with leading zeros ("000", "007") is that code, not the number: 0 does not assert it.
const isCode = token => /^0\d/.test(String(token ?? ''))
const numberId = (token, values) => (isCode(token) ? `c:${token}` : `n:${values.join('|')}`)

export function tokensFrom(ticket, v = buildVocabulary(['en', 'it'])) {
  const full = ticketText(ticket)
  const chunks = expectedChunks(ticket, v)
  const tokens = []
  const seen = new Set()
  for (const whole of chunks) {
    const from = outcomeOf(whole, v)
    for (const s of quotedIn(from)) {
      const id = `s:${s}`
      if (seen.has(id) || !full.includes(s)) continue
      seen.add(id)
      tokens.push({ token: s, kind: 'string', from })
    }
    // "shows 150 instead of 80": 150 is the wrong result, not an expected value.
    const wrong = new Set([...from.matchAll(v.beforeInsteadOf)].flatMap(m => normNum(m[1])))
    for (const n of numbersIn(from)) {
      const values = normNum(n)
      if (values.some(x => wrong.has(x))) continue
      const id = numberId(n, values)
      if (!values.length || seen.has(id) || !full.includes(n)) continue
      seen.add(id)
      tokens.push({ token: n.replace(/−/g, '-'), kind: 'number', values, from })
    }
  }
  return tokens
}

/** Index past the matching ")", skipping strings and comments. */
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

/** Like closeParen, for any of ( [ {. */
function closeBracket(src, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' }
  const stack = []
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      i = e < 0 ? src.length : e + 1
    } else if (pairs[c]) stack.push(pairs[c])
    else if (c === stack.at(-1)) { stack.pop(); if (!stack.length) return i + 1 }
  }
  return src.length
}

const hasAssertion = (text, dialect) => new RegExp(callRe(dialect).source).test(text)

/**
 * Values that reach assertions indirectly: it.each/for-of/forEach tables whose body asserts,
 * and variables an assertion reads (const expected = {...}).
 */
function feeders(block, parts, dialect) {
  const out = []
  const expression = (text, from) => {
    // A bracketed literal, or up to the end of the statement.
    let i = from
    while (/\s/.test(text[i] ?? '')) i++
    if ('[{('.includes(text[i])) return text.slice(i, closeBracket(text, i))
    const end = text.slice(i).search(/[;\n]/)
    return text.slice(i, end < 0 ? text.length : i + end)
  }
  for (const m of block.matchAll(/\b(?:it|test|describe)(?:\.\w+)*\.each\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const table = block.slice(open + 1, closeBracket(block, open) - 1)
    const next = block.indexOf('(', closeBracket(block, open))
    const body = next < 0 ? '' : block.slice(next, closeBracket(block, next))
    if (hasAssertion(body, dialect)) out.push(table)
  }
  for (const m of block.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+[^)]*?\bof\s+/g)) {
    const from = m.index + m[0].length
    const head = closeBracket(block, block.indexOf('(', m.index))
    const list = expression(block.slice(0, head - 1), from)
    const brace = block.indexOf('{', head)
    const body = brace < 0 ? '' : block.slice(brace, closeBracket(block, brace))
    if (hasAssertion(body, dialect)) out.push(list)
  }
  for (const m of block.matchAll(/([\w$.]+|\[[^\]]*\])\s*\.forEach\s*\(/g)) {
    const open = m.index + m[0].length - 1
    if (hasAssertion(block.slice(open, closeBracket(block, open)), dialect)) out.push(m[1])
  }
  // Variables the assertions read, and what they're built from (three levels deep).
  const seen = new Set()
  let pending = [...parts, ...out].join('\n')
  for (let depth = 0; depth < 3 && pending; depth++) {
    const names = [...new Set([...pending.matchAll(/(?<![\w$'"`])(?<![\w$)\]]\.)[A-Za-z_$][\w$]*/g)].map(x => x[0]))].filter(n => !seen.has(n))
    let found = ''
    for (const name of names) {
      seen.add(name)
      const decl = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/[$]/g, '\\$&')}\\s*=\\s*`).exec(block)
      if (decl) found += `\n${expression(block, decl.index + decl[0].length)}`
    }
    out.push(found)
    pending = found
  }
  return out.filter(Boolean)
}

/**
 * Assertion arguments in the key block (null if no block); comments and .not matchers are skipped.
 * actual: false reads expect(x) only for no-arg matchers: expect(getByText('80')).toBeVisible() pins 80,
 * expect(total([80])).toBeGreaterThan(0) doesn't.
 */
export function surface(specSrc, key, dialect, { actual = true, whole = false } = {}) {
  const range = anchorRange(specSrc, key, dialect, { whole })
  if (!range) return null
  // pytest's assert statement isn't a matcher call: the dialect reads the block.
  if (dialect?.expected?.surface) return dialect.expected.surface(specSrc.slice(range[0], range[1]), { actual })
  const block = stripCodeComments(specSrc.slice(range[0], range[1]))
  // Same for Go's if got != want.
  if (dialect?.expected?.parts) return dialect.expected.parts(block).join('\n')
  const parts = []
  for (const m of block.matchAll(callRe(dialect))) {
    const open = m.index + m[0].length - 1
    if (m[0].startsWith('.') && /\.not\s*$/.test(block.slice(Math.max(0, m.index - 12), m.index))) continue
    const close = closeParen(block, open)
    if (!actual && !m[0].startsWith('.') && !/^(?:\s*\.\s*(?:not|resolves|rejects))*\s*\.\s*\w+\s*\(\s*\)/.test(block.slice(close))) continue
    parts.push(block.slice(open + 1, close - 1))
  }
  // Normalize dialect literals (C#'s 13.50m is 13.50).
  const text = [...parts, ...feeders(block, parts, dialect)].join('\n')
  return dialect?.expected?.literals ? dialect.expected.literals(text) : text
}

/** The wrong result a bug reports: under its Actual heading, or "N instead of". */
export function actualValues(ticket, v = buildVocabulary(['en', 'it'])) {
  const text = [ticket?.text?.description, ticket?.text?.acField].filter(Boolean).join('\n')
  const chunks = []
  for (const m of text.matchAll(v.actualSection)) {
    const rest = text.slice(m.index + m[0].length)
    const next = rest.search(/\n\s*(?:#{1,6}\s*|\*\*)/)
    chunks.push(rest.slice(0, next < 0 ? rest.length : next))
  }
  for (const m of text.matchAll(v.beforeInsteadOf)) chunks.push(m[1])
  const seen = new Map()
  for (const n of chunks.flatMap(numbersIn)) seen.set(normNum(n).join('|'), { token: n.replace(/−/g, '-'), values: normNum(n) })
  return [...seen.values()]
}

const looksLikeField = w => w.length >= 4 && w.length <= 40 && !/^\d/.test(w) && /_|[a-z][A-Z]/.test(w)
const fold = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

/** Field names in Then lines (unit_cost, unitCost), minus negated ones ("not unit_price"). */
export function fieldTokensFrom(chunks, v = buildVocabulary(['en', 'it'])) {
  const out = new Map()
  for (const chunk of chunks) {
    const from = outcomeOf(chunk, v)
    for (const w of stripQuoted(stripUrls(from)).replace(v.negatedWord, ' ').split(/[^\w-]+/)) {
      if (looksLikeField(w) && !out.has(fold(w))) out.set(fold(w), { token: w, kind: 'field', from })
    }
  }
  return [...out.values()]
}

/** Keep model-suggested values only if the ticket text contains them; they can only make the check stricter. */
export function groundCandidates(candidates, chunks, have = [], ticketFull = '') {
  // Expected lines plus the full text, for values from the Notes.
  const text = stripUrls([...chunks, ticketFull].filter(Boolean).join('\n'))
  const nums = new Set(numbersIn(text).flatMap(normNum))
  const known = new Set(have.map(t => (t.kind === 'number' ? numberId(t.token, t.values) : fold(t.token))))
  const kept = []
  const ignored = []
  for (const raw of candidates) {
    const c = String(raw ?? '').trim()
    if (!c) continue
    const isNum = /^[+\-−]?\d+(?:[.,]\d+)*$/.test(c)
    const grounded = isNum ? normNum(c).some(x => nums.has(x)) : c.length >= 2 && c.length <= 80 && text.includes(c)
    if (!grounded) { ignored.push(c); continue }
    const t = isNum ? { token: c, kind: 'number', values: normNum(c) } : { token: c, kind: looksLikeField(c) ? 'field' : 'string' }
    const id = t.kind === 'number' ? numberId(c, t.values) : fold(c)
    if (known.has(id)) continue
    known.add(id)
    kept.push({ ...t, from: [...chunks, ticketFull].find(ch => ch && (isNum ? numbersIn(ch).some(n => normNum(n).some(x => t.values.includes(x))) : ch.includes(c))) ?? c })
  }
  return { kept, ignored }
}

const unescape = s => s.replace(/\\(.)/g, '$1')

// Whole words only: "EU" isn't asserted by "NON-EUROPE".
const hasWhole = (text, tok) => new RegExp(`${/^\w/.test(tok) ? '(?<!\\w)' : ''}${escapeRegExp(tok)}${/\w$/.test(tok) ? '(?!\\w)' : ''}`).test(text)

export function asserted(token, surfaceText) {
  if (token.kind === 'field') return fold(surfaceText).includes(fold(token.token))
  if (token.kind === 'string' || (token.kind === 'number' && isCode(token.token))) return hasWhole(surfaceText, token.token) || hasWhole(unescape(surfaceText), token.token)
  const want = new Set(token.values)
  return [...surfaceText.matchAll(NUMBER)].some(m => normNum(m[0]).some(x => want.has(x)))
}

const short = s => (s.length > 80 ? `${s.slice(0, 77)}…` : s)

export function run({ specs, key = null, ticket = null, candidates = [], whole = false }, ctx) {
  if (!key) return result('expected', 'not_run', 'no ticket key to find the block')
  let t
  try {
    // A path, or the ticket object itself (frozen evals).
    t = ticket && typeof ticket === 'object' ? ticket : readJson(resolve(ctx.root, ticket ?? ''))
    if (!t || typeof t !== 'object') throw new Error('not a ticket object')
  } catch (e) {
    return result('expected', 'not_run', `cannot read the ticket file: ${String(e.message).split('\n')[0]}`)
  }
  // Fullstack: each spec in its own dialect.
  const dialectOf = p => ctx.dialectOf?.(p) ?? ctx.dialect
  // Values count only where pinned (the matcher's argument); fields count anywhere in the assertion.
  const surfaces = specs.map(p => {
    const src = readFileSync(resolve(ctx.root, p), 'utf8')
    const d = dialectOf(p)
    return { dialect: d, text: surface(src, key, d, { actual: Boolean(d?.expected?.readsActual), whole }), fieldText: surface(src, key, d, { whole }) }
  })
  if (surfaces.every(s => s.text === null)) {
    return result('expected', 'not_run', `no ${key} block in ${specs.join(', ')}`, [{ file: specs.join(', '), kind: 'no anchor block', detail: `no top-level group titled "${key} …"` }])
  }
  const all = surfaces.filter(s => s.text !== null).map(s => s.text).join('\n')
  const v = buildVocabulary(ctx.config?.languages ?? ['en', 'it'])
  const chunks = expectedChunks(t, v)
  // Field names apply to unit tests; e2e asserts what the screen shows.
  // config.expected: ignore (names owned elsewhere), aliases (UI wording), fields: false (frontend workspace).
  const own = ctx.config?.expected ?? {}
  const skip = new Set((own.ignore ?? []).map(x => fold(x)))
  const fieldSpecs = own.fields === false ? [] : surfaces.filter(s => s.text !== null && s.dialect?.expected?.fieldNames)
  const fields = fieldSpecs.length ? fieldTokensFrom(chunks, v) : []
  const ticketTokens = [...tokensFrom(t, v), ...fields].filter(x => !skip.has(fold(x.token)))
  const { kept, ignored } = groundCandidates(candidates, chunks, ticketTokens, ticketText(t))
  const tokens = [...ticketTokens, ...kept.filter(x => (x.kind !== 'field' || fieldSpecs.length) && !skip.has(fold(x.token)))]
  const extra = ignored.length ? { ignored } : {}
  if (!tokens.length) return result('expected', 'pass', 'no concrete expected values in the ticket', [], { tokens: 0, asserted: 0, ...extra })
  const fieldText = fieldSpecs.map(s => s.fieldText).join('\n')
  // e.g. criterion "Rectify demographic data", screen "Reinvio per variazione".
  const aliasesOf = x => [].concat(Object.entries(own.aliases ?? {}).find(([k]) => fold(k) === fold(x.token))?.[1] ?? [])
  const isAsserted = x => asserted(x, x.kind === 'field' ? fieldText : all) || aliasesOf(x).some(a => asserted({ kind: x.kind === 'number' ? 'string' : x.kind, token: a }, x.kind === 'field' ? fieldText : all))
  // Values only an external check can verify (seeded rows): read config.externalChecks, never run them.
  const external = tokens.some(x => x.kind !== 'field' && !isAsserted(x)) ? externalChecks(configHome(ctx.root), ctx.config?.externalChecks) : []
  const carriedBy = x => (x.kind === 'field' ? [] : external.filter(f => asserted(x, f.text)).map(f => f.file))
  const outside = tokens.filter(x => !isAsserted(x) && carriedBy(x).length)
  const missing = tokens.filter(x => !isAsserted(x) && !carriedBy(x).length)
  const files = [...new Set(outside.flatMap(carriedBy))]
  const data = { tokens: tokens.length, asserted: tokens.length - missing.length, missing: missing.map(x => x.token), ...(outside.length ? { outside: outside.map(x => x.token), outsideFiles: files } : {}), ...extra }
  if (!missing.length) {
    const note = outside.length ? ` (${outside.length} checked in ${files.join(', ')}, outside the unit tests: read, not run by Quality Code)` : ''
    return result('expected', 'pass', `all ${tokens.length} expected value(s) from the ticket are asserted${note}`, [], data)
  }
  // Bug test pinning the reported wrong result instead of the expected one.
  const expectedNums = new Set(tokens.filter(x => x.kind === 'number').flatMap(x => x.values))
  const wrong = actualValues(t, v).filter(a => !a.values.some(x => expectedNums.has(x)) && asserted({ kind: 'number', values: a.values }, all))
  if (wrong.length && missing.some(x => x.kind === 'number')) {
    const shown = wrong.map(a => a.token).join(', ')
    return result('expected', 'fail', `asserts ${shown}, the wrong result the ticket reports, not the expected value`,
      missing.map(x => ({ kind: 'asserts the actual result', token: x.token, actual: shown, then: short(x.from), detail: `asserts ${shown}; expected ${x.token} (from "${short(x.from)}")` })), { ...data, actual: wrong.map(a => a.token) })
  }
  return result('expected', 'fail', `${missing.length} of ${tokens.length} expected value(s) from the ticket not asserted`,
    missing.map(x => ({ kind: x.kind === 'field' ? 'field not asserted' : 'expected value not asserted', token: x.token, then: short(x.from), detail: `${x.token} (from "${short(x.from)}")` })), data)
}
