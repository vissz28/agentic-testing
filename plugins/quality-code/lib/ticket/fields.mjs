// The acceptance-criteria field of each Jira project, found when a ticket is first checked and
// remembered on this machine. A field named in the team config always wins.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { packWords } from './languages/index.mjs'
import { alt } from './text.mjs'

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

/**
 * The criteria fields in a saved Jira field-metadata result (getJiraIssueTypeMetaWithFields): every
 * { key|fieldId|id: customfield_N, name } whose name starts with the configured languages' criteria
 * heading ("Acceptance criteria", "Criteri di accettazione", "AC"). The file may carry text around
 * the JSON; it is read from its first { or [. Returns { ok, matches: [{ key, name }] } or { ok: false, error }.
 */
export function findFields(config, text) {
  const s = String(text)
  let data
  for (const start of [0, s.search(/[[{]/)]) {
    try { data = JSON.parse(s.slice(Math.max(0, start))); break } catch { /* try from the first bracket */ }
  }
  if (data === undefined) return { ok: false, error: 'field find: the file is not JSON field metadata' }
  const heading = new RegExp(`^\\s*(?:${alt(packWords(config.languages, 'acHeading'))})\\b`, 'i')
  const matches = new Map()
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const key = [node.key, node.fieldId, node.id].find(k => typeof k === 'string' && FIELD.test(k))
    if (key && typeof node.name === 'string' && heading.test(node.name) && !matches.has(key)) matches.set(key, { key, name: node.name })
    Object.values(node).forEach(walk)
  }
  walk(data)
  return { ok: true, matches: [...matches.values()] }
}
