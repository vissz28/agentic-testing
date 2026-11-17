import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sanitizeTicket } from './sanitize.mjs'
import { buildBrief } from './score.mjs'
import { DEFAULTS } from '../config/config.mjs'
import { pct, plural } from '../core/text.mjs'
import { readJsonOr } from '../core/files.mjs'
import { cleanRelPath } from '../core/paths.mjs'
import { isTicketKey } from '../core/is.mjs'

/** Share of `n` in `total` as a whole percent (half up); 0 for an empty set. */

/** Same scoring as `ticket.mjs score`, no I/O. Returns the sanitized tickets so the caller can save them. */
export function evalTickets(config, tickets) {
  const clean = tickets.map(t => sanitizeTicket(config, t))
  const rows = clean.map(t => {
    const b = buildBrief(config, t)
    const shown = b.missing.filter(m => !b.omitted.has(m.key))
    return {
      key: b.key ?? t.key ?? '?',
      // Team = first Jira component.
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
    passingPercent: pct(passing, rows.length) ?? 0,
    average: rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0,
    mostMissing: mostMissing(rows, 3),
    // The batch doesn't read attachments, so criteria may be hiding in one.
    unreadFiles: rows.filter(r => r.gate === 'refuse' && r.files).length,
    // A single group would just repeat the project line.
    byTeam: groups.size < 2 ? [] : [...groups].map(([team, rs]) => {
      const p = rs.filter(r => r.gate === 'pass').length
      return { team, scored: rs.length, passing: p, passingPercent: pct(p, rs.length) ?? 0, mostMissing: mostMissing(rs, 1)[0]?.item ?? null }
    }).sort((a, b) => a.passingPercent - b.passingPercent || a.team.localeCompare(b.team)),
  }
  return { rows, summary, clean }
}

function mostMissing(rows, top) {
  const count = new Map()
  for (const r of rows) for (const m of r.missing) count.set(m, (count.get(m) ?? 0) + 1)
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, top)
    .map(([item, tickets]) => ({ item, tickets }))
}

export function formatCard({ rows, summary }) {
  if (!rows.length) return 'No tickets to score.'
  const lines = rows.map(r => `${r.key} · ${r.score}/100 · ${r.gate}${r.biggestMissing ? ` · missing: ${r.biggestMissing}` : ''}`)
  const s = summary
  return [
    ...lines,
    '',
    `Project: ${plural(s.scored, 'ticket')} scored`,
    `Passing: ${s.passing} of ${s.scored} (${s.passingPercent}%)`,
    `Average score: ${s.average}%`,
    s.mostMissing.length
      ? `Most often missing: ${s.mostMissing.map(m => `${m.item} (${m.tickets})`).join(', ')}`
      : 'Most often missing: nothing',
    ...(s.byTeam?.length ? ['', 'By component (lowest pass rate first):', ...s.byTeam.map(t => `  ${t.team}: ${t.passing} of ${t.scored} pass (${t.passingPercent}%)${t.mostMissing ? ` · most often missing: ${t.mostMissing}` : ''}`)] : []),
    ...(s.unreadFiles ? [`${s.unreadFiles} refused ticket${s.unreadFiles === 1 ? ' has' : 's have'} files this report does not read: their criteria may be in a file. /quality-code:ticket <KEY> --eval reads them.`] : []),
  ].join('\n')
}

// --save only. Keeps `filled`/`sent` from an existing file: Jira doesn't hold them.
export function saveTickets(root, config, clean) {
  const dir = cleanRelPath(config.ticketsDir ?? DEFAULTS.ticketsDir)
  for (const t of clean) {
    if (!isTicketKey(t.key)) continue
    const d = resolve(root, dir, t.key)
    const file = resolve(d, 'ticket.json')
    const old = readJsonOr(file, {})
    const kept = Object.fromEntries(['filled', 'sent'].filter(k => old?.[k] !== undefined).map(k => [k, old[k]]))
    mkdirSync(d, { recursive: true })
    writeFileSync(file, `${JSON.stringify({ ...t, ...kept })}\n`)
  }
}
