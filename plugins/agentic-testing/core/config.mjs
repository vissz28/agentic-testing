// Find, load and validate the team config. The only module that knows where it lives.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONFIG_REL = '.claude/agentic-testing.json'
const SETUP = 'Run /agentic-testing:setup.'
const KEY = /^[A-Z][A-Z0-9]+$/
const FIELDS = new Set(['version', 'adapter', 'jira', 'languages', 'features', 'titlePrefixes', 'ticketTemplates', 'ticketsDir', 'redact', 'messages'])
const LANGS = new Set(['en', 'it'])

export const DEFAULTS = Object.freeze({
  titlePrefixes: ['FE', 'BE', 'FS'],
  ticketsDir: '.claude/agentic-testing/tickets',
  redact: { customerId: 'U\\d{5,}' },
  messages: {},
  ticketTemplates: { bug: null, story: null },
})

export const projectRoot = (env = process.env, cwd = process.cwd()) => env.CLAUDE_PROJECT_DIR || cwd
export const configPath = root => join(root, CONFIG_REL)

export function validateConfig(input) {
  const e = []
  const c = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  for (const k of Object.keys(c)) if (!FIELDS.has(k)) e.push(`${k}: unknown field (remove it, or re-run /agentic-testing:setup)`)
  if (c.version !== 1) e.push(`version: must be 1 (found ${JSON.stringify(c.version)}); re-run /agentic-testing:setup`)
  if (!['playwright', 'vitest'].includes(c.adapter)) e.push(`adapter: must be "playwright" or "vitest" (found ${JSON.stringify(c.adapter)})`)
  const j = c.jira ?? {}
  if (typeof j.site !== 'string' || !/^https:\/\/[^/\s]+$/.test(j.site)) e.push('jira.site: must be an https URL like "https://example.atlassian.net"')
  if (!Array.isArray(j.projects) || j.projects.length === 0) e.push('jira.projects: must be a non-empty list of keys like "ABC"')
  else j.projects.forEach((p, i) => { if (!KEY.test(p)) e.push(`jira.projects[${i}] "${p}" must be upper-case letters and digits, like "ABC"`) })
  if (!('acceptanceCriteriaField' in j) || !(j.acceptanceCriteriaField === null || /^customfield_\d+$/.test(j.acceptanceCriteriaField)))
    e.push('jira.acceptanceCriteriaField: must be null or like "customfield_10001"')
  ;(j.trackingProjects ?? []).forEach((p, i) => { if (!KEY.test(p)) e.push(`jira.trackingProjects[${i}] "${p}" must be upper-case letters and digits`) })
  if (!Array.isArray(c.languages) || c.languages.length === 0) e.push('languages: must list at least one of "en", "it"')
  else c.languages.forEach((l, i) => { if (!LANGS.has(l)) e.push(`languages[${i}] "${l}" is not supported (supported: en, it)`) })
  if (!Array.isArray(c.features)) e.push('features: must be a list (it may be empty)')
  else {
    const seen = new Set()
    c.features.forEach((f, i) => {
      if (!f || typeof f.label !== 'string' || !f.label.trim()) e.push(`features[${i}].label: must be a non-empty text`)
      else if (seen.has(f.label)) e.push(`features[${i}].label "${f.label}" appears twice`)
      else seen.add(f.label)
      if (f?.route != null && !/^\//.test(f.route)) e.push(`features[${i}].route "${f.route}" must start with "/"`)
    })
  }
  for (const [name, src] of Object.entries(c.redact ?? {})) {
    try { new RegExp(src) } catch { e.push(`redact.${name}: not a valid regular expression`) }
  }
  if (e.length) return { ok: false, errors: e }
  return {
    ok: true,
    config: {
      ...c,
      jira: { trackingProjects: [], ...j },
      titlePrefixes: c.titlePrefixes ?? DEFAULTS.titlePrefixes,
      ticketsDir: c.ticketsDir ?? DEFAULTS.ticketsDir,
      redact: c.redact ?? DEFAULTS.redact,
      messages: c.messages ?? DEFAULTS.messages,
      ticketTemplates: { ...DEFAULTS.ticketTemplates, ...(c.ticketTemplates ?? {}) },
    },
  }
}

export function loadConfig(root) {
  const p = configPath(root)
  if (!existsSync(p)) return { ok: false, missing: true, errors: [`This repo is not set up. ${SETUP}`] }
  let obj
  try { obj = JSON.parse(readFileSync(p, 'utf8')) } catch (err) {
    return { ok: false, errors: [`${CONFIG_REL} is not valid JSON (${err.message}). ${SETUP}`] }
  }
  return validateConfig(obj)
}
