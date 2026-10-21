// The acceptance-criteria field of each Jira project, found when a ticket is first checked and
// remembered on this machine. A field named in the team config always wins.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const FIELDS_REL = '.claude/quality-code/jira-fields.json'
const KEY = /^[A-Z][A-Z0-9_]+$/
const FIELD = /^customfield_\d+$/

function stored(root) {
  try {
    const d = JSON.parse(readFileSync(join(root, FIELDS_REL), 'utf8'))
    return d && typeof d.projects === 'object' && d.projects !== null && !Array.isArray(d.projects) ? d.projects : {}
  } catch {
    return {}
  }
}

/** { field, source }: source "config" or "stored" (field is an id or null), else "unknown". */
export function resolveField(root, config, project) {
  if (config.jira && 'acceptanceCriteriaField' in config.jira) return { field: config.jira.acceptanceCriteriaField, source: 'config' }
  const p = stored(root)
  if (Object.hasOwn(p, project) && (p[project] === null || FIELD.test(p[project]))) return { field: p[project], source: 'stored' }
  return { field: undefined, source: 'unknown' }
}

/** value: customfield_<digits>, or "none" when the project has no criteria field. */
export function storeField(root, project, value) {
  if (!KEY.test(String(project))) return { ok: false, error: `project "${project}" must be upper-case letters, digits and "_", like "ABC"` }
  if (value !== 'none' && !FIELD.test(String(value))) return { ok: false, error: `the field must be customfield_<digits> or none (got "${value}")` }
  const projects = { ...stored(root), [project]: value === 'none' ? null : value }
  const p = join(root, FIELDS_REL)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `${JSON.stringify({ projects }, null, 2)}\n`)
  return { ok: true }
}
