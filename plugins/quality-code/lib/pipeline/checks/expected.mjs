// Expected values: the concrete numbers and quoted texts of the ticket's Then / Expected lines must
// be asserted in the ticket's block. Values the ticket does not state are never required. A negated
// matcher (.not.toBe) or a commented-out expect asserts nothing; a field the ticket names (unit_cost)
// must be read in a Vitest assertion; a bug test that asserts the reported wrong result says so.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractExpectedChunks, extractNaturalAC } from '../../ticket/criteria.mjs'
import { buildVocabulary } from '../../ticket/languages/index.mjs'
import { anchorRange } from './suite-honesty.mjs'
import { result } from '../../base/result.mjs'

const PAIRS = [['"', '"'], ['“', '”'], ["'", "'"], ['‘', '’'], ['«', '»'], ['`', '`']]
const QUOTED = new RegExp(`(?<![\\w\\\\])(?:${PAIRS.map(([o, c]) => `${o}([^${c}\\n]{2,80})${c}`).join('|')})(?![\\w])`, 'g')
// A number that is not part of a word, a key (ABC-12) or a version (1.2.3).
const NUMBER = /(?<![\w.,\-−])[+\-−]?\d+(?:[.,]\d+)*(?![\w]|[.,]\d)/g
// Every matcher whose argument is a value the test pins (the old backend check also read toBeCloseTo and the comparisons).
const MATCHERS = ['expect', 'toBe', 'toEqual', 'toStrictEqual', 'toContain', 'toContainEqual', 'toMatchObject', 'toHaveProperty', 'toThrow',
  'toBeCloseTo', 'toBeGreaterThan', 'toBeGreaterThanOrEqual', 'toBeLessThan', 'toBeLessThanOrEqual', 'toHaveLength', 'toMatch', 'toHaveBeenCalledWith']
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
/** The ticket's Then lines, Expected sections and acceptance criteria. */
export function expectedChunks(ticket, v = buildVocabulary(['en', 'it'])) {
  const description = typeof ticket === 'string' ? ticket : ticket?.text?.description ?? ''
  const acField = typeof ticket === 'string' ? '' : ticket?.text?.acField ?? ''
  return [...new Set([
    ...extractExpectedChunks(v, description),
    ...(acField ? [...extractExpectedChunks(v, acField), ...extractNaturalAC(v, acField, { headingless: true })] : []),
  ])]
}

export function tokensFrom(ticket, v = buildVocabulary(['en', 'it'])) {
  const full = ticketText(ticket)
  const chunks = expectedChunks(ticket, v)
  const tokens = []
  const seen = new Set()
  for (const from of chunks) {
    for (const s of quotedIn(from)) {
      const id = `s:${s}`
      if (seen.has(id) || !full.includes(s)) continue
      seen.add(id)
      tokens.push({ token: s, kind: 'string', from })
    }
    // "shows 150 instead of 80": 150 is the wrong result, never an expected value.
    const wrong = new Set([...from.matchAll(v.beforeInsteadOf)].flatMap(m => normNum(m[1])))
    for (const n of numbersIn(from)) {
      const values = normNum(n)
      if (values.some(x => wrong.has(x))) continue
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

/** The code without its line and block comments; strings are kept as they are. */
export function stripCodeComments(src) {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      const start = i
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
      out += src.slice(start, i + 1)
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      i = e < 0 ? src.length : e + 1
    } else out += c
  }
  return out
}

/**
 * The argument text of every assertion call inside the key block; null when there is no block. A
 * commented-out call is not read, nor the argument of a negated matcher: .not.toBe(80) does not
 * assert 80. actual: false reads expect(...) itself only when its matcher takes no argument
 * (expect(getByText('80')).toBeVisible()): in expect(total([80])).toBeGreaterThan(0), 80 is an input.
 */
export function surface(specSrc, key, dialect, { actual = true } = {}) {
  const range = anchorRange(specSrc, key, dialect)
  if (!range) return null
  const block = stripCodeComments(specSrc.slice(range[0], range[1]))
  // A dialect whose assertions are no matcher call (Go's if got != want) gives their text itself.
  if (dialect?.expected?.parts) return dialect.expected.parts(block).join('\n')
  const parts = []
  for (const m of block.matchAll(callRe(dialect))) {
    const open = m.index + m[0].length - 1
    if (m[0].startsWith('.') && /\.not\s*$/.test(block.slice(Math.max(0, m.index - 12), m.index))) continue
    const close = closeParen(block, open)
    if (!actual && !m[0].startsWith('.') && !/^(?:\s*\.\s*(?:not|resolves|rejects))*\s*\.\s*\w+\s*\(\s*\)/.test(block.slice(close))) continue
    parts.push(block.slice(open + 1, close - 1))
  }
  // A dialect may read its literals as the ticket writes them (C#'s 13.50m is 13.50).
  const text = parts.join('\n')
  return dialect?.expected?.literals ? dialect.expected.literals(text) : text
}

/** The numbers a bug reports as its wrong result: under its Actual heading, and "N instead of". */
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

/** The field names a Then line names (unit_cost, unitCost), leaving out the negated ones ("not unit_price"). */
export function fieldTokensFrom(chunks, v = buildVocabulary(['en', 'it'])) {
  const out = new Map()
  for (const from of chunks) {
    for (const w of stripQuoted(from).replace(v.negatedWord, ' ').split(/[^\w-]+/)) {
      if (looksLikeField(w) && !out.has(fold(w))) out.set(fold(w), { token: w, kind: 'field', from })
    }
  }
  return [...out.values()]
}

/** The values the model says the tests pin, kept only when the ticket's expected text holds them. */
export function groundCandidates(candidates, chunks, have = []) {
  const text = chunks.join('\n')
  const nums = new Set(numbersIn(text).flatMap(normNum))
  const known = new Set(have.map(t => (t.kind === 'number' ? `n:${t.values.join('|')}` : fold(t.token))))
  const kept = []
  const ignored = []
  for (const raw of candidates) {
    const c = String(raw ?? '').trim()
    if (!c) continue
    const isNum = /^[+\-−]?\d+(?:[.,]\d+)*$/.test(c)
    const grounded = isNum ? normNum(c).some(x => nums.has(x)) : c.length >= 2 && c.length <= 80 && text.includes(c)
    if (!grounded) { ignored.push(c); continue }
    const t = isNum ? { token: c, kind: 'number', values: normNum(c) } : { token: c, kind: looksLikeField(c) ? 'field' : 'string' }
    const id = t.kind === 'number' ? `n:${t.values.join('|')}` : fold(c)
    if (known.has(id)) continue
    known.add(id)
    kept.push({ ...t, from: chunks.find(ch => (isNum ? numbersIn(ch).some(n => normNum(n).some(x => t.values.includes(x))) : ch.includes(c))) ?? c })
  }
  return { kept, ignored }
}

const unescape = s => s.replace(/\\(.)/g, '$1')

export function asserted(token, surfaceText) {
  if (token.kind === 'field') return fold(surfaceText).includes(fold(token.token))
  if (token.kind === 'string') return surfaceText.includes(token.token) || unescape(surfaceText).includes(token.token)
  const want = new Set(token.values)
  return [...surfaceText.matchAll(NUMBER)].some(m => normNum(m[0]).some(x => want.has(x)))
}

const short = s => (s.length > 80 ? `${s.slice(0, 77)}…` : s)

export function run({ specs, key = null, ticket = null, candidates = [] }, ctx) {
  if (!key) return result('expected', 'not_run', 'no ticket key to find the block')
  let t
  try {
    // The ticket file's path, or the ticket itself (a frozen eval's).
    t = ticket && typeof ticket === 'object' ? ticket : JSON.parse(readFileSync(resolve(ctx.root, ticket ?? ''), 'utf8'))
    if (!t || typeof t !== 'object') throw new Error('not a ticket object')
  } catch (e) {
    return result('expected', 'not_run', `cannot read the ticket file: ${String(e.message).split('\n')[0]}`)
  }
  // A fullstack run reads each spec in its own dialect (ctx.dialectOf).
  const dialectOf = p => ctx.dialectOf?.(p) ?? ctx.dialect
  // Values count where the test pins them (Vitest: the matcher's argument); a field is read anywhere in the assertion.
  const surfaces = specs.map(p => {
    const src = readFileSync(resolve(ctx.root, p), 'utf8')
    const d = dialectOf(p)
    return { dialect: d, text: surface(src, key, d, { actual: Boolean(d?.expected?.readsActual) }), fieldText: surface(src, key, d) }
  })
  if (surfaces.every(s => s.text === null)) {
    return result('expected', 'not_run', `no ${key} block in ${specs.join(', ')}`, [{ file: specs.join(', '), kind: 'no anchor block', detail: `no top-level group titled "${key} …"` }])
  }
  const all = surfaces.filter(s => s.text !== null).map(s => s.text).join('\n')
  const v = buildVocabulary(ctx.config?.languages ?? ['en', 'it'])
  const chunks = expectedChunks(t, v)
  // Field names bind a unit test to the right column; an e2e test asserts what the screen shows instead.
  const fieldSpecs = surfaces.filter(s => s.text !== null && s.dialect?.expected?.fieldNames)
  const fields = fieldSpecs.length ? fieldTokensFrom(chunks, v) : []
  const ticketTokens = [...tokensFrom(t, v), ...fields]
  const { kept, ignored } = groundCandidates(candidates, chunks, ticketTokens)
  const tokens = [...ticketTokens, ...kept.filter(x => x.kind !== 'field' || fieldSpecs.length)]
  const extra = ignored.length ? { ignored } : {}
  if (!tokens.length) return result('expected', 'pass', 'no concrete expected values in the ticket', [], { tokens: 0, asserted: 0, ...extra })
  const fieldText = fieldSpecs.map(s => s.fieldText).join('\n')
  const missing = tokens.filter(x => !asserted(x, x.kind === 'field' ? fieldText : all))
  const data = { tokens: tokens.length, asserted: tokens.length - missing.length, missing: missing.map(x => x.token), ...extra }
  if (!missing.length) return result('expected', 'pass', `all ${tokens.length} expected value(s) from the ticket are asserted`, [], data)
  // A bug test that pins the reported wrong result instead of the expected one.
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
