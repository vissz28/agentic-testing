import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sanitizeTicket } from './sanitize.mjs'
import { buildBrief } from './score.mjs'
import { DEFAULTS, normaliseTicketsDir } from '../base/config.mjs'

/** Share of `n` in `total` as a whole percent (half up); 0 for an empty set. */
const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0)

/**
 * Sanitize and score every raw ticket the way `ticket.mjs score` does (a fullstack config scores
 * both sides and takes the lower). Pure: no I/O, nothing sent. Returns the rows, the project
 * summary and the sanitized tickets (so the caller may save them).
 */
export function evalTickets(config, tickets) {
  const clean = tickets.map(t => sanitizeTicket(config, t))
  const rows = clean.map(t => {
    const b = buildBrief(config, t)
    const shown = b.missing.filter(m => !b.omitted.has(m.key))
    return {
      key: b.key ?? t.key ?? '?',
      // The team is the ticket's first Jira component: no setup, Jira already says who owns it.
      team: (Array.isArray(t.components) && typeof t.components[0] === 'string' && t.components[0]) || null,
      files: Number(t.attachments) > 0,
      score: b.score,
      gate: b.gate,
      legacy: b.legacy,
      missing: shown.map(m => m.label),
      biggestMissing: shown[0]?.label ?? null,
    }
  })
  rows.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key, 'en', { numeric: true }))
  const passing = rows.filter(r => r.gate === 'pass').length
  // Not Map.groupBy: Node 20 is supported.
  const groups = new Map()
  for (const r of rows) groups.set(r.team ?? 'no component', [...(groups.get(r.team ?? 'no component') ?? []), r])
  const summary = {
    scored: rows.length,
    passing,
    passingPercent: pct(passing, rows.length),
    average: rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0,
    mostMissing: mostMissing(rows, 3),
    // Refused with files on the ticket: the batch reads no file, so their criteria may be in one.
    unreadFiles: rows.filter(r => r.gate === 'refuse' && r.files).length,
    // Only when the tickets name more than one component: one group is the project line again.
    byTeam: groups.size < 2 ? [] : [...groups].map(([team, rs]) => {
      const p = rs.filter(r => r.gate === 'pass').length
      return { team, scored: rs.length, passing: p, passingPercent: pct(p, rs.length), mostMissing: mostMissing(rs, 1)[0]?.item ?? null }
    }).sort((a, b) => a.passingPercent - b.passingPercent || a.team.localeCompare(b.team)),
  }
  return { rows, summary, clean }
}

/** The `top` items missing from the most rows, most first (ties by name). */
function mostMissing(rows, top) {
  const count = new Map()
  for (const r of rows) for (const m of r.missing) count.set(m, (count.get(m) ?? 0) + 1)
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, top)
    .map(([item, tickets]) => ({ item, tickets }))
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
    ...(s.byTeam?.length ? ['', 'By component (lowest pass rate first):', ...s.byTeam.map(t => `  ${t.team}: ${t.passing} of ${t.scored} pass (${t.passingPercent}%)${t.mostMissing ? ` · most often missing: ${t.mostMissing}` : ''}`)] : []),
    ...(s.unreadFiles ? [`${s.unreadFiles} refused ticket${s.unreadFiles === 1 ? ' has' : 's have'} files this report does not read: their criteria may be in a file. /quality-code:ticket-eval <KEY> reads them.`] : []),
  ].join('\n')
}

/** Write each sanitized ticket to <ticketsDir>/<KEY>/ticket.json. Only used with --save. */
export function saveTickets(root, config, clean) {
  const dir = normaliseTicketsDir(config.ticketsDir ?? DEFAULTS.ticketsDir)
  for (const t of clean) {
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(t.key ?? '')) continue
    const d = resolve(root, dir, t.key)
    mkdirSync(d, { recursive: true })
    writeFileSync(resolve(d, 'ticket.json'), `${JSON.stringify(t)}\n`)
  }
}
