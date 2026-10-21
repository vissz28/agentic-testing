// Totals, groups and the plain-text card for /quality-code:consumption. Dates are UTC.
import { costOf, priceFor } from './prices.mjs'

const DAY = 86400000
export const BY = ['command', 'ticket', 'day', 'model']
const day = ms => new Date(ms).toISOString().slice(0, 10)
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** { since, until, label } in ms, until exclusive. Throws a plain message. */
export function parsePeriod({ since = '30d', until = null } = {}, now = Date.now()) {
  const date = (s, flag) => {
    const t = DATE.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN
    // Date.parse rolls 2026-02-31 over to March: only a date that reads back the same is one.
    if (Number.isNaN(t) || day(t) !== s) throw new Error(`${flag} must be a date like 2026-10-01${flag === '--since' ? ', or 7d or 30d' : ''}, not "${s}"`)
    return t
  }
  const end = until === null ? now : date(until, '--until') + DAY
  const rel = String(since).match(/^([1-9]\d{0,3})d$/)
  // 7d and 30d count back from the period's last day: today, or --until.
  const start = rel ? Math.floor((end - 1) / DAY) * DAY - (Number(rel[1]) - 1) * DAY : date(since, '--since')
  if (start >= end) throw new Error(`--since ${since} is after --until ${until ?? 'today'}`)
  const label = rel && until === null ? `last ${rel[1]} days` : `${day(start)} to ${day(end - 1)}`
  return { since: start, until: end, label }
}

const zero = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })
function bucket(name) {
  return { name, runs: new Set(), requests: 0, tokens: zero(), cost: 0, unpriced: 0 }
}
function add(b, e, prices, unknown) {
  b.requests++
  b.tokens.input += e.tokens.input
  b.tokens.output += e.tokens.output
  b.tokens.cacheWrite += e.tokens.cacheWrite5m + e.tokens.cacheWrite1h
  b.tokens.cacheRead += e.tokens.cacheRead
  const price = e.fast ? null : priceFor(e.model, prices)
  const c = costOf(e.tokens, price)
  if (c === null) {
    b.unpriced++
    unknown.add(e.fast ? `${e.model} (fast mode)` : e.model)
  } else b.cost += c
  if (e.run) b.runs.add(e.run)
}
const round = n => Math.round(n * 1e6) / 1e6
function out(b) {
  const runs = b.runs.size
  const cost = b.requests && b.unpriced === b.requests ? null : round(b.cost)
  return {
    name: b.name, runs, requests: b.requests, tokens: b.tokens, cost,
    costPartial: b.unpriced > 0 && cost !== null,
    costPerRun: cost !== null && runs ? round(cost / runs) : null,
  }
}

/** The report object behind the card and CONSUMPTION_JSON. */
export function buildReport({ runs, events }, { period, by = 'command', prices, project, priceInfo }) {
  const inPeriod = t => t >= period.since && t < period.until
  const runsIn = runs.filter(r => inPeriod(r.start))
  const keep = new Set(runsIn)
  const unknown = new Set()
  const total = bucket('total')
  const other = bucket('other')
  const groups = new Map()
  const groupOf = (e, r) => by === 'command' ? r.command : by === 'ticket' ? r.key ?? 'no ticket' : by === 'day' ? day(r.start) : e.model
  for (const r of runsIn) {
    total.runs.add(r)
    if (by !== 'model') {
      const g = groupOf(null, r)
      if (!groups.has(g)) groups.set(g, bucket(g))
      groups.get(g).runs.add(r)
    }
  }
  for (const e of events) {
    if (e.run ? !keep.has(e.run) : !inPeriod(e.t)) continue
    if (!e.run) { add(other, e, prices, unknown); continue }
    add(total, e, prices, unknown)
    const g = groupOf(e, e.run)
    if (!groups.has(g)) groups.set(g, bucket(g))
    add(groups.get(g), e, prices, unknown)
  }
  const sorted = [...groups.values()].map(out).sort((a, b) => by === 'day' ? (a.name < b.name ? -1 : 1) : (b.cost ?? -1) - (a.cost ?? -1) || b.runs - a.runs || (a.name < b.name ? -1 : 1))
  return {
    project,
    period: { since: day(period.since), until: day(period.until - 1), label: period.label },
    by,
    totals: { ...out(total), sessions: new Set(runsIn.map(r => r.sessionId)).size },
    groups: sorted,
    other: out(other),
    unknownModels: [...unknown].sort(),
    prices: priceInfo,
  }
}

export function fmtTokens(n) {
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`
}
export function fmtCost(c, partial = false) {
  if (c === null) return 'unknown price'
  const s = c > 0 && c < 0.01 ? '<$0.01' : `$${c.toFixed(2)}`
  return partial ? `${s} + unknown` : s
}
const cache = t => t.cacheWrite + t.cacheRead
const HEAD = { command: 'By command', ticket: 'By ticket', day: 'By day (UTC)', model: 'By model' }

function table(rows, by) {
  const head = [HEAD[by], 'runs', 'in', 'out', 'cache', 'cost', 'per run']
  const body = rows.map(g => [g.name, String(g.runs), fmtTokens(g.tokens.input), fmtTokens(g.tokens.output), fmtTokens(cache(g.tokens)), fmtCost(g.cost, g.costPartial), g.costPerRun === null ? '-' : fmtCost(g.costPerRun, g.costPartial)])
  const w = head.map((h, i) => Math.max(h.length + (i ? 0 : -2), ...body.map(r => r[i].length)))
  const line = (r, first) => (first ? r[0].padEnd(w[0] + 2) : `  ${r[0].padEnd(w[0])}`) + r.slice(1).map((c, i) => `   ${c.padStart(w[i + 1])}`).join('')
  return [line(head, true), ...body.map(r => line(r))]
}

export function formatCard(r) {
  const t = r.totals
  const lines = [`quality-code consumption · ${r.period.label} · ${r.project}`, '']
  if (!t.runs) lines.push(`No quality-code runs from ${r.period.since} to ${r.period.until}.`)
  else {
    lines.push(
      `Runs      ${t.runs} run${t.runs === 1 ? '' : 's'} in ${t.sessions} session${t.sessions === 1 ? '' : 's'} · ${t.requests} API request${t.requests === 1 ? '' : 's'}`,
      `Tokens    in ${fmtTokens(t.tokens.input)} · out ${fmtTokens(t.tokens.output)} · cache write ${fmtTokens(t.tokens.cacheWrite)} · cache read ${fmtTokens(t.tokens.cacheRead)}`,
      `Cost      ${fmtCost(t.cost, t.costPartial)} estimated${t.costPerRun === null ? '' : ` · ${fmtCost(t.costPerRun, t.costPartial)} per run`}`,
      '',
      ...table(r.groups, r.by),
    )
  }
  const o = r.other
  lines.push('', `Other (not quality-code): ${o.requests} request${o.requests === 1 ? '' : 's'} · in ${fmtTokens(o.tokens.input)} · out ${fmtTokens(o.tokens.output)} · cache ${fmtTokens(cache(o.tokens))} · ${fmtCost(o.cost, o.costPartial)}`)
  if (r.unknownModels.length) lines.push(`Unknown price for ${r.unknownModels.join(', ')}: tokens counted, no cost.`)
  lines.push(`Estimate at API list prices as of ${r.prices.asOf ?? 'unknown date'} (${r.prices.override ? `with ${r.prices.override}` : 'claude-api skill'}); subscription plans are not billed this way.`)
  lines.push(`CONSUMPTION_JSON:${JSON.stringify(r)}`)
  return lines.join('\n')
}
