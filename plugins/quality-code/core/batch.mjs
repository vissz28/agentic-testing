import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sanitizeTicket } from './sanitize.mjs'
import { buildBrief } from './score.mjs'
import { normaliseTicketsDir } from './config.mjs'

/** Share of `n` in `total` as a whole percent (half up); 0 for an empty set. */
const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0)

/**
 * Sanitize and score every raw ticket the way `cli.mjs score` does (a fullstack config scores both
 * sides and takes the lower). Pure: no I/O, nothing sent. Returns the rows, the project summary and
 * the sanitized tickets (so the caller may save them).
 */
export function evalTickets(config, tickets) {
  const clean = tickets.map(t => sanitizeTicket(config, t))
  const rows = clean.map(t => {
    const b = buildBrief(config, t)
    return {
      key: b.key ?? t.key ?? '?',
      score: b.score,
      gate: b.gate,
      legacy: b.legacy,
      missing: b.missing.map(m => m.label),
      biggestMissing: b.missing[0]?.label ?? null,
    }
  })
  rows.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key, 'en', { numeric: true }))
  const count = new Map()
  for (const r of rows) for (const m of r.missing) count.set(m, (count.get(m) ?? 0) + 1)
  const mostMissing = [...count.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 3)
    .map(([item, tickets]) => ({ item, tickets }))
  const passing = rows.filter(r => r.gate === 'pass').length
  const summary = {
    scored: rows.length,
    passing,
    passingPercent: pct(passing, rows.length),
    average: rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0,
    mostMissing,
  }
  return { rows, summary, clean }
}

/** The card: one line per ticket (lowest score first), then the project summary. */
export function formatCard({ rows, summary }) {
  if (!rows.length) return 'No tickets to score.'
  const lines = rows.map(r => `${r.key} · ${r.score}% · ${r.gate}${r.biggestMissing ? ` · missing: ${r.biggestMissing}` : ''}`)
  const s = summary
  return [
    ...lines,
    '',
    `Project: ${s.scored} ticket${s.scored === 1 ? '' : 's'} scored`,
    `Passing: ${s.passing} of ${s.scored} (${s.passingPercent}%)`,
    `Average score: ${s.average}%`,
    s.mostMissing.length
      ? `Most often missing: ${s.mostMissing.map(m => `${m.item} (${m.tickets})`).join(', ')}`
      : 'Most often missing: nothing',
  ].join('\n')
}

/** Write each sanitized ticket to <ticketsDir>/<KEY>/ticket.json. Only used with --save. */
export function saveTickets(root, config, clean) {
  const dir = normaliseTicketsDir(config.ticketsDir ?? '.claude/quality-code/tickets')
  for (const t of clean) {
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(t.key ?? '')) continue
    const d = resolve(root, dir, t.key)
    mkdirSync(d, { recursive: true })
    writeFileSync(resolve(d, 'ticket.json'), `${JSON.stringify(t)}\n`)
  }
}
