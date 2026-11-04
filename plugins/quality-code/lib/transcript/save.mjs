// Where the sprint goal is saved: <ticketsDir>/sprint/<date>-goal.md. The file name is built from a checked date
// only, so nothing the transcript or the person typed can move it out of the folder.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar date written YYYY-MM-DD. */
export function isDate(s) {
  const m = DATE.exec(String(s ?? ''))
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

/** The path of the goal file for a date, or null when the date is not a real YYYY-MM-DD or the path would leave the folder. */
export function goalPath(ticketsRoot, date) {
  if (!isDate(date)) return null
  const dir = resolve(ticketsRoot, 'sprint')
  const p = resolve(dir, `${date}-goal.md`)
  return p.startsWith(dir + sep) ? p : null
}

const list = items => (items.length ? items.map(x => `- ${x}`).join('\n') : '- none')

/** The saved file: the goal, decisions, numbered tasks, risks and open questions. */
export function renderGoal(result, date) {
  const tasks = result.tasks.length
    ? result.tasks.map((t, i) => `${i + 1}. ${t.title}${t.owner ? ` (owner: ${t.owner})` : ''}${t.estimate != null ? ` (estimate: ${t.estimate})` : ''}${t.ticket ? ` [${t.ticket}]` : ''}`).join('\n')
    : '- none'
  return `# Sprint goal ${date}\n\n${result.goal}\n\n## Decisions\n\n${list(result.decisions)}\n\n## Tasks\n\n${tasks}\n\n## Risks and dependencies\n\n${list(result.risks)}\n\n## Open questions\n\n${list(result.openQuestions)}\n`
}

/** Write the goal file (creating <ticketsDir>/sprint/). Returns its path. */
export function saveGoal(ticketsRoot, date, text) {
  const p = goalPath(ticketsRoot, date)
  if (!p) throw new Error(`"${date}" is not a date like 2026-11-04`)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
  return p
}
