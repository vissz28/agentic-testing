// Per-project Jira AC field, cached locally. The team config always wins.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { packWords } from './languages/index.mjs'
import { alt } from './text.mjs'
import { configHome } from '../config/config.mjs'
import { ignoreFolder } from '../core/ignore.mjs'
import { FIELDS_FILE, placeFolder, placeOf } from '../config/places.mjs'
import { readJson } from '../core/files.mjs'
import { isObject } from '../core/is.mjs'

export const FIELDS_REL = '.claude/quality-code/jira-fields.json'
const KEY = /^[A-Z][A-Z0-9_]+$/
const FIELD = /^customfield_\d+$/

// Lives with the user's chosen place (session temp until they pick), never in .claude/ before that. Old .claude/ files still count.
const placedPath = (home, env = process.env) => join(placeFolder(home, env), FIELDS_FILE)

function readFields(path) {
  try {
    const d = readJson(path)
    return isObject(d?.projects) ? d.projects : {}
  } catch {
    return {}
  }
}
const storedAt = (dir, env) => ({ ...readFields(join(dir, FIELDS_REL)), ...readFields(placedPath(dir, env)) })

// A Jira project's criteria field is one fact for the repo, not for each project folder of a monorepo: it is kept
// where the config is, and a file saved in the project folder before that still counts.
const stored = (root, env) => ({ ...storedAt(configHome(root, env), env), ...storedAt(root, env) })

/** source: "config", "stored" or "unknown"; field is an id or null. */
export function resolveField(root, config, project, env = process.env) {
  if (config.jira && 'acceptanceCriteriaField' in config.jira) return { field: config.jira.acceptanceCriteriaField, source: 'config' }
  const p = stored(root, env)
  if (Object.hasOwn(p, project) && (p[project] === null || FIELD.test(p[project]))) return { field: p[project], source: 'stored' }
  return { field: undefined, source: 'unknown' }
}

/** value: customfield_<digits>, or "none" for no AC field. */
export function storeField(root, project, value, env = process.env) {
  if (!KEY.test(String(project))) return { ok: false, error: `project "${project}" must be upper-case letters, digits and "_", like "ABC"` }
  if (value !== 'none' && !FIELD.test(String(value))) return { ok: false, error: `the field must be customfield_<digits> or none (got "${value}")` }
  const home = configHome(root, env)
  const projects = { ...storedAt(home, env), [project]: value === 'none' ? null : value }
  const p = placedPath(home, env)
  if (placeOf(home, 'repo', env) === 'repo') ignoreFolder(dirname(p))
  else mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `${JSON.stringify({ projects }, null, 2)}\n`)
  return { ok: true }
}

/**
 * AC fields in saved getJiraIssueTypeMetaWithFields output: custom fields named like the AC heading.
 * The file may wrap the JSON in other text, so parsing retries from the first { or [.
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
