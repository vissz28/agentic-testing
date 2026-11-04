// Where a report file goes: <ticketsDir>/reports/<kind>-<date>.html, in the folder the person's place rules give
// (guides/save-place.md). The name is built from a fixed kind and a checked date only, so nothing typed can move it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { normaliseTicketsDir } from '../base/config.mjs'
import { placeDirs, placeOf } from '../base/places.mjs'

export const KINDS = ['kpi', 'tickets-eval', 'consumption']
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The tickets folder in force: the loaded config's (already moved to the place), else the place's default. */
export function reportsRoot(root, cfg, env = process.env) {
  const dir = cfg?.ok ? cfg.config.ticketsDir : placeDirs(root, { source: 'repo' }, placeOf(root, 'repo', env), env).ticketsDir
  return resolve(root, normaliseTicketsDir(dir), 'reports')
}

/** The file for a kind and a day, or null when either is not a plain one or the path would leave the folder. */
export function reportPath(dir, kind, date) {
  if (!KINDS.includes(kind) || !DATE.test(String(date))) return null
  const p = resolve(dir, `${kind}-${date}.html`)
  return p.startsWith(resolve(dir) + sep) ? p : null
}

/** Write the report (creating the folder) and return its absolute path. */
export function saveReport(dir, kind, date, html) {
  const p = reportPath(dir, kind, date)
  if (!p) throw new Error(`cannot name a report for "${kind}" on "${date}"`)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, html)
  return p
}

/** The lines the commands print after the card: the file, and the headline for the small gauge card. */
export function reportLines(path, title, headline) {
  return [`Report: ${path}`, `REPORT_JSON:${JSON.stringify({ path, title, gauge: headline })}`]
}
