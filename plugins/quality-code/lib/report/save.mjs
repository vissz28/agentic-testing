// Reports go to <ticketsDir>/reports/<kind>-<date>.html. Kind and date are validated so user input can't move the path.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { normaliseTicketsDir } from '../config/config.mjs'
import { placeDirs, placeOf } from '../config/places.mjs'
import { tag } from '../core/script-io.mjs'

export const KINDS = ['kpi', 'tickets-eval', 'consumption']
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function reportsRoot(root, cfg, env = process.env) {
  const dir = cfg?.ok ? cfg.config.ticketsDir : placeDirs(root, { source: 'repo' }, placeOf(root, 'repo', env), env).ticketsDir
  return resolve(root, normaliseTicketsDir(dir), 'reports')
}

export function reportPath(dir, kind, date) {
  if (!KINDS.includes(kind) || !DATE.test(String(date))) return null
  const p = resolve(dir, `${kind}-${date}.html`)
  return p.startsWith(resolve(dir) + sep) ? p : null
}

export function saveReport(dir, kind, date, html) {
  const p = reportPath(dir, kind, date)
  if (!p) throw new Error(`cannot name a report for "${kind}" on "${date}"`)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, html)
  return p
}

export function reportLines(path, title, headline) {
  return [`Report: ${path}`, tag('REPORT', { path, title, gauge: headline })]
}
